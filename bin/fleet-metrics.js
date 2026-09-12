#!/usr/bin/env node
'use strict';

/**
 * fleet-metrics.js — deterministic, zero-dependency code-quality metrics for a fleet of repos.
 *
 * Usage:
 *   node fleet-metrics.js --repo <path> [--json]
 *   node fleet-metrics.js --list <repos.txt> --out <dir> [--json] [--exclude "pat1,pat2"] [--timeout ms] [--budget ms]
 *
 * Zero npm deps. Uses each repo's own node_modules/typescript for AST-accurate parsing of
 * TS/TSX/JS/JSX when present; otherwise falls back to a regex/brace-matching heuristic and
 * marks parser:"regex" in the output. Python (.py) is always analyzed with line/indent
 * heuristics (no AST). Never writes into a scanned repo. Always exits 0 — this is a report
 * tool; per-repo failures are captured in the JSON, not thrown.
 *
 * --repo accepts relative paths ('.', '../x'); they are resolved against process.cwd() before
 * anything else happens. Any downgrade to the regex parser (repo-level or per-file) is NEVER
 * silent: it lands in `warnings` in the JSON and on stderr, because the regex parser undercounts
 * functions 3-5x and these numbers get committed as baselines and cited in PR bodies.
 */

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Thresholds & fixed sets (named, not magic numbers — tune here, nowhere else)
// ---------------------------------------------------------------------------
const FN_LONG_LINES = 60; // function length flagged as "long"
const FN_VERY_LONG_LINES = 100; // function length flagged as "very long"
const PARAM_COUNT_THRESHOLD = 4; // params > this count is flagged
const NESTING_DEPTH_THRESHOLD = 3; // control-flow nesting > this is flagged
const FILE_LARGE_LOC = 400; // file line count flagged as large
const FILE_HUGE_LOC = 1000; // file line count flagged as huge
const SHORT_ID_MAX_LEN = 2; // identifier name length considered "short"
const SHORT_ID_ALLOW = new Set(['i', 'j', 'k', 'x', 'y', 'z', '_', 'e', 't', 'id', 'db', 'fn', 'cb', 'ok', 'el', 'ev', 'rx']);
const TOP_LARGE_FILES = 5; // how many largest files to list per repo
const TOP_IDENTIFIERS = 10; // how many short-identifier names to list per repo
const TOP_OFFENDERS = 5; // how many repos to list per "worst offenders" metric
const JSX_MIN_LETTERS = 2; // JSX text node needs this many letters to count as hardcoded copy
const REPO_TIMEOUT_MS = 60_000; // cooperative per-repo timeout
const DEFAULT_BUDGET_MS = 9 * 60 * 1000; // total run budget, kept under the 10-minute cap
const SANE_COMMENT_SCAN_BOUND = 200; // lines to look upward for a JSDoc block before giving up

const EXCLUDED_DIRS = new Set([
  'node_modules', 'dist', 'build', '.next', 'coverage', 'out', '.turbo', '.vercel',
  '.output', 'venv', '.venv', '__pycache__', '.cache', 'playwright-report',
]);
// Directories whose contents count as "src-like" per the spec, plus test-only dirs so
// e2e/tests files get scanned and correctly flagged as tests (they'd otherwise be invisible).
const SRC_LIKE_TOP_SEGMENTS = new Set(['src', 'app', 'lib', 'scripts', 'e2e', 'test', 'tests', '__tests__']);
const CODE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx']);
const PY_EXT = '.py';
const TEST_PATH_PATTERNS = [
  /\.(test|spec)\.[jt]sx?$/i,
  /(^|\/)tests?(\/|$)/i,
  /(^|\/)__tests__(\/|$)/i,
  /(^|\/)e2e(\/|$)/i,
];
const GENERATED_FILE_PATTERNS = [/\.gen\.ts$/i, /\.d\.ts$/i, /routeTree\.gen\.ts$/i];

const CONTROL_KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'do', 'else', 'function', 'return']);
const HANDLED_CATCH_RX = /console\.|logger\.|throw\b|report\(|captureException|toast/i;
const ANY_USAGE_RX = /:\s*any\b|\bas\s+any\b/g;
const TS_IGNORE_RX = /@ts-ignore|@ts-expect-error/g;
const ESLINT_DISABLE_RX = /eslint-disable/g;
const TODO_RX = /\b(TODO|FIXME|HACK)\b/g;
const CONSOLE_LOG_RX = /console\.log\s*\(/g;

// ---------------------------------------------------------------------------
// Path / CLI helpers
// ---------------------------------------------------------------------------

// Git Bash passes POSIX-style drive paths ("/c/Users/...") to argv; Windows Node's fs
// layer does not understand them, so normalize before ever touching the filesystem.
function normalizePath(p) {
  const m = /^\/([A-Za-z])(\/.*)?$/.exec(p);
  if (m) return `${m[1].toUpperCase()}:${m[2] || '/'}`;
  return p;
}

// A repo path MUST be absolute before it reaches require.resolve: path.join('.', 'node_modules', 'typescript')
// normalizes to the bare 'node_modules/typescript', which require.resolve treats as a MODULE SPECIFIER looked up
// from THIS file's directory (~/.claude/bin), not from the repo. The TypeScript parser then vanished silently
// (`--repo .` on calculator-app: 362 functions vs 1615 with the absolute path, 2026-09-05). Forward slashes keep
// the `repo` field byte-identical for the absolute forward-slash paths existing callers already pass.
function toAbsoluteRepoPath(p) {
  return path.resolve(normalizePath(String(p))).split(path.sep).join('/');
}

function parseArgs(argv) {
  const args = { repo: null, list: null, out: null, json: false, exclude: [], timeout: REPO_TIMEOUT_MS, budget: DEFAULT_BUDGET_MS };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--repo') args.repo = argv[++i];
    else if (a === '--list') args.list = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--json') args.json = true;
    else if (a === '--exclude') args.exclude = String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--timeout') args.timeout = parseInt(argv[++i], 10) || REPO_TIMEOUT_MS;
    else if (a === '--budget') args.budget = parseInt(argv[++i], 10) || DEFAULT_BUDGET_MS;
  }
  return args;
}

function globMatch(name, pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`, 'i').test(name);
}

// ---------------------------------------------------------------------------
// File-system walk & inclusion rules
// ---------------------------------------------------------------------------

function walkRepo(repoRoot, deadline) {
  const results = [];
  const stack = [repoRoot];
  while (stack.length) {
    if (Date.now() > deadline) break;
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue; // unreadable dir (permissions, symlink loop) — skip, don't crash the whole repo
    }
    for (const ent of entries) {
      if (ent.isDirectory()) {
        if (ent.name.startsWith('.') || EXCLUDED_DIRS.has(ent.name)) continue;
        stack.push(path.join(dir, ent.name));
      } else if (ent.isFile()) {
        const ext = path.extname(ent.name).toLowerCase();
        if (CODE_EXTS.has(ext) || ext === PY_EXT) results.push(path.join(dir, ent.name));
      }
    }
  }
  return results;
}

function isSrcLikeDirSegments(dirSegments) {
  if (dirSegments.some((s) => SRC_LIKE_TOP_SEGMENTS.has(s))) return true;
  const si = dirSegments.indexOf('supabase');
  return si !== -1 && dirSegments[si + 1] === 'functions';
}

function includeFile(repoRoot, absPath) {
  const rel = path.relative(repoRoot, absPath);
  const segments = rel.split(path.sep);
  const fileName = segments[segments.length - 1];
  const ext = path.extname(fileName).toLowerCase();
  if (GENERATED_FILE_PATTERNS.some((rx) => rx.test(fileName))) return false;
  if (ext === PY_EXT) return true; // python counted wherever found (excluded dirs already filtered)
  if (CODE_EXTS.has(ext)) return isSrcLikeDirSegments(segments.slice(0, -1));
  return false;
}

function toPosixRel(repoRoot, absPath) {
  return path.relative(repoRoot, absPath).split(path.sep).join('/');
}

function isTestPath(relPosix) {
  return TEST_PATH_PATTERNS.some((rx) => rx.test(relPosix));
}

// ---------------------------------------------------------------------------
// Shared text-level scans (identical regardless of parser mode)
// ---------------------------------------------------------------------------

function countMatches(rx, text) {
  const m = text.match(rx);
  return m ? m.length : 0;
}

// Line-scan comment counter: only counts lines that are *entirely* comment (mixed
// code+comment lines are not counted) — a deliberate simplification for a heuristic ratio.
function countCommentLines(lines) {
  let count = 0;
  let inBlock = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (inBlock) {
      count++;
      if (line.includes('*/')) inBlock = false;
      continue;
    }
    if (line.startsWith('//')) { count++; continue; }
    if (line.startsWith('/*')) {
      count++;
      if (!line.includes('*/')) inBlock = true;
    }
  }
  return count;
}

function analyzeCommonPatterns(text, lines, isTest) {
  return {
    anyUsage: countMatches(ANY_USAGE_RX, text),
    tsIgnore: countMatches(TS_IGNORE_RX, text),
    eslintDisable: countMatches(ESLINT_DISABLE_RX, text),
    todoFixmeHack: countMatches(TODO_RX, text),
    consoleLog: isTest ? 0 : countMatches(CONSOLE_LOG_RX, text),
    commentLines: countCommentLines(lines),
  };
}

function addIdentifier(map, name) {
  if (!name) return;
  if (name.length <= SHORT_ID_MAX_LEN && !SHORT_ID_ALLOW.has(name)) {
    map.set(name, (map.get(name) || 0) + 1);
  }
}

// ---------------------------------------------------------------------------
// AST-based analysis (TypeScript compiler API, when the target repo has it installed)
// ---------------------------------------------------------------------------

function isFunctionLikeNode(node, ts) {
  return (
    ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node) ||
    ts.isGetAccessor(node) || ts.isSetAccessor(node)
  );
}

function getFunctionName(node, ts) {
  if (node.name && ts.isIdentifier(node.name)) return node.name.text;
  const p = node.parent;
  if (p) {
    if (ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) return p.name.text;
    if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name)) return p.name.text;
    if (ts.isBinaryExpression(p) && ts.isIdentifier(p.left)) return p.left.text;
    if (ts.isPropertyDeclaration(p) && ts.isIdentifier(p.name)) return p.name.text;
  }
  if (ts.isConstructorDeclaration(node)) return 'constructor';
  return '<anonymous>';
}

function hasExportModifier(node, ts) {
  const mods = typeof ts.canHaveModifiers === 'function'
    ? (ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined)
    : node.modifiers;
  return !!mods && mods.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

function hasJSDocAbove(sf, node, ts) {
  const full = typeof node.getFullStart === 'function' ? node.getFullStart() : node.pos;
  const ranges = ts.getLeadingCommentRanges(sf.text, full) || [];
  return ranges.some((r) => sf.text.slice(r.pos, r.pos + 3) === '/**');
}

function analyzeWithTS(ts, text, absPath, ext, relPath) {
  const scriptKind = ext === '.tsx' ? ts.ScriptKind.TSX
    : ext === '.ts' ? ts.ScriptKind.TS
      : ext === '.jsx' ? ts.ScriptKind.JSX
        : ts.ScriptKind.JS;
  const sf = ts.createSourceFile(absPath, text, ts.ScriptTarget.Latest, true, scriptKind);

  const functions = [];
  const shortIdentifierCounts = new Map();
  let catchTotal = 0;
  let catchSilent = 0;
  let jsxTextCount = 0;
  const exported = [];

  const NESTING_KINDS = new Set([
    ts.SyntaxKind.IfStatement, ts.SyntaxKind.ForStatement, ts.SyntaxKind.ForInStatement,
    ts.SyntaxKind.ForOfStatement, ts.SyntaxKind.WhileStatement, ts.SyntaxKind.DoStatement,
    ts.SyntaxKind.SwitchStatement, ts.SyntaxKind.TryStatement, ts.SyntaxKind.CatchClause,
  ]);

  function lineOf(pos) { return sf.getLineAndCharacterOfPosition(pos).line + 1; }

  // Max control-flow nesting inside a function body. Nested function-like nodes are
  // skipped — they are measured as their own, separate function entries.
  function maxNesting(container, depth) {
    let best = depth;
    ts.forEachChild(container, (child) => {
      if (isFunctionLikeNode(child, ts)) return;
      const d = NESTING_KINDS.has(child.kind) ? depth + 1 : depth;
      const sub = maxNesting(child, d);
      if (sub > best) best = sub;
    });
    return best;
  }

  function visit(node) {
    if (isFunctionLikeNode(node, ts) && node.body) {
      const name = getFunctionName(node, ts);
      const startLine = lineOf(node.getStart(sf));
      const endLine = lineOf(node.getEnd());
      node.parameters.forEach((p) => {
        if (ts.isIdentifier(p.name)) addIdentifier(shortIdentifierCounts, p.name.text);
      });
      if (node.name && ts.isIdentifier(node.name)) addIdentifier(shortIdentifierCounts, node.name.text);
      functions.push({
        name,
        file: relPath,
        startLine,
        length: endLine - startLine + 1,
        params: node.parameters.length,
        nesting: maxNesting(node.body, 0),
      });
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      addIdentifier(shortIdentifierCounts, node.name.text);
    }
    if (ts.isCatchClause(node) && node.block) {
      catchTotal++;
      if (!HANDLED_CATCH_RX.test(node.block.getText(sf))) catchSilent++;
    }
    if (ts.isJsxText(node)) {
      const letters = (node.getText(sf).match(/\p{L}/gu) || []).length;
      if (letters >= JSX_MIN_LETTERS) jsxTextCount++;
    }
    ts.forEachChild(node, visit);
  }

  ts.forEachChild(sf, (stmt) => {
    if (ts.isFunctionDeclaration(stmt) && hasExportModifier(stmt, ts)) {
      exported.push({ documented: hasJSDocAbove(sf, stmt, ts) });
    } else if (ts.isVariableStatement(stmt) && hasExportModifier(stmt, ts)) {
      const documented = hasJSDocAbove(sf, stmt, ts);
      stmt.declarationList.declarations.forEach(() => exported.push({ documented }));
    }
  });

  visit(sf);

  return { functions, shortIdentifierCounts, catchTotal, catchSilent, jsxTextCount, exported };
}

// ---------------------------------------------------------------------------
// Regex/brace-matching fallback (used when a repo has no node_modules/typescript,
// or a specific file fails to parse). Heuristic by design — see inline notes for
// known gaps (e.g. inline object-literal return types can confuse brace matching).
// ---------------------------------------------------------------------------

// Blanks out string/template/comment contents while preserving length and newlines,
// so later brace-matching and keyword regexes can't be fooled by text inside them.
function sanitize(text) {
  let out = '';
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    const c2 = text[i + 1];
    if (c === '/' && c2 === '/') {
      while (i < n && text[i] !== '\n') { out += ' '; i++; }
      continue;
    }
    if (c === '/' && c2 === '*') {
      out += '  ';
      i += 2;
      while (i < n && !(text[i] === '*' && text[i + 1] === '/')) { out += text[i] === '\n' ? '\n' : ' '; i++; }
      if (i < n) { out += '  '; i += 2; }
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      out += ' ';
      i++;
      while (i < n && text[i] !== quote) {
        if (text[i] === '\\') { out += '  '; i += 2; continue; }
        out += text[i] === '\n' ? '\n' : ' ';
        i++;
      }
      if (i < n) { out += ' '; i++; }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

function buildLineIndex(text) {
  const offsets = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') offsets.push(i + 1);
  return offsets;
}

function lineNumberAt(offsets, index) {
  let lo = 0;
  let hi = offsets.length - 1;
  let ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (offsets[mid] <= index) { ans = mid; lo = mid + 1; } else { hi = mid - 1; }
  }
  return ans + 1;
}

function findMatchingBrace(text, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') { depth--; if (depth === 0) return i; }
  }
  return text.length - 1;
}

function splitTopLevelParams(paramsText) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const ch of paramsText) {
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    if (ch === ')' || ch === ']' || ch === '}') depth--;
    if (ch === ',' && depth === 0) { parts.push(current); current = ''; } else current += ch;
  }
  if (current.trim() !== '') parts.push(current);
  return parts.filter((p) => p.trim() !== '');
}

// Max brace-nesting depth within a function body, skipping over spans already
// identified as nested functions (those are measured separately, as in AST mode).
function computeNestingRegex(bodyText, nestedSpans) {
  let depth = 0;
  let max = 0;
  let i = 0;
  const skip = nestedSpans.slice().sort((a, b) => a[0] - b[0]);
  let si = 0;
  while (i < bodyText.length) {
    if (si < skip.length && i === skip[si][0]) { i = skip[si][1]; si++; continue; }
    const ch = bodyText[i];
    if (ch === '{') { depth++; if (depth > max) max = depth; } else if (ch === '}') depth--;
    i++;
  }
  return max;
}

// function decl | assigned function expr | assigned arrow (block body) | method-shorthand.
// The optional `(?::[^{;]*)?` / `(?::[^{;=]*)?` segments tolerate a TS return-type
// annotation between the params and the opening brace/arrow.
const FUNC_RX = new RegExp(
  '\\bfunction\\s*\\*?\\s*([A-Za-z_$][\\w$]*)?\\s*\\(([^)]*)\\)\\s*(?::[^{;]*)?\\{'
  + '|\\b([A-Za-z_$][\\w$]*)\\s*[:=]\\s*(?:async\\s+)?function\\s*\\(([^)]*)\\)\\s*(?::[^{;]*)?\\{'
  + '|\\b([A-Za-z_$][\\w$]*)\\s*[:=]\\s*(?:async\\s+)?\\(([^)]*)\\)\\s*(?::[^{;=]*)?=>\\s*\\{'
  + '|\\b(?:async\\s+)?([A-Za-z_$][\\w$]*)\\s*\\(([^)]*)\\)\\s*(?::[^{;]*)?\\{',
  'g',
);
const CATCH_RX = /\bcatch\s*(?:\([^)]*\))?\s*\{/g;
// Deliberately allows newlines in the captured span — Prettier-formatted JSX puts
// children on their own line, so excluding \n here would miss almost all real JSX text.
// Can over-match in files with heavy generic/comparison-operator use (`Array<T>`, `a < b`);
// the >=2-letter filter below (JSX_MIN_LETTERS) removes most such false positives.
const JSXTEXT_APPROX_RX = />([^<>{}]{2,})</g;
const EXPORTED_DECL_RX = /^\s*export\s+(?:default\s+)?(?:async\s+)?function\s+[A-Za-z_$]|^\s*export\s+const\s+[A-Za-z_$][\w$]*\s*=/;

function textHasJsDocAbove(lines, endIdx) {
  let k = endIdx;
  while (k >= 0 && !lines[k].trim().startsWith('/**')) {
    if (lines[k].trim().startsWith('//')) return false;
    if (endIdx - k > SANE_COMMENT_SCAN_BOUND) return false;
    k--;
  }
  return k >= 0;
}

function analyzeWithRegex(text, relPath) {
  const sanitized = sanitize(text);
  const offsets = buildLineIndex(text);
  const shortIdentifierCounts = new Map();
  const found = [];

  let m;
  FUNC_RX.lastIndex = 0;
  while ((m = FUNC_RX.exec(sanitized))) {
    const name = m[1] || m[3] || m[5] || m[7] || '<anonymous>';
    if (CONTROL_KEYWORDS.has(name)) continue;
    const paramsText = m[2] ?? m[4] ?? m[6] ?? m[8] ?? '';
    const braceIdx = m.index + m[0].length - 1;
    const endIdx = findMatchingBrace(sanitized, braceIdx);
    const params = splitTopLevelParams(paramsText);
    params.forEach((p) => {
      const pm = /^[\s.]*([A-Za-z_$][\w$]*)/.exec(p.trim());
      if (pm) addIdentifier(shortIdentifierCounts, pm[1]);
    });
    if (name !== '<anonymous>') addIdentifier(shortIdentifierCounts, name);
    found.push({
      name,
      startLine: lineNumberAt(offsets, m.index),
      endLine: lineNumberAt(offsets, endIdx),
      params: params.length,
      bodyStart: braceIdx + 1,
      bodyEnd: endIdx,
    });
  }

  const functions = found.map((f) => {
    const nestedSpans = found
      .filter((g) => g !== f && g.bodyStart >= f.bodyStart && g.bodyEnd <= f.bodyEnd)
      .map((g) => [g.bodyStart - f.bodyStart, g.bodyEnd - f.bodyStart + 1]);
    const bodyText = sanitized.slice(f.bodyStart, f.bodyEnd);
    return {
      name: f.name,
      file: relPath,
      startLine: f.startLine,
      length: f.endLine - f.startLine + 1,
      params: f.params,
      nesting: computeNestingRegex(bodyText, nestedSpans),
    };
  });

  const DECL_RX = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g;
  while ((m = DECL_RX.exec(sanitized))) addIdentifier(shortIdentifierCounts, m[1]);

  let catchTotal = 0;
  let catchSilent = 0;
  CATCH_RX.lastIndex = 0;
  while ((m = CATCH_RX.exec(sanitized))) {
    catchTotal++;
    const braceIdx = m.index + m[0].length - 1;
    const endIdx = findMatchingBrace(sanitized, braceIdx);
    const blockOriginal = text.slice(braceIdx + 1, endIdx);
    if (!HANDLED_CATCH_RX.test(blockOriginal)) catchSilent++;
  }

  let jsxTextCount = 0;
  JSXTEXT_APPROX_RX.lastIndex = 0;
  while ((m = JSXTEXT_APPROX_RX.exec(text))) {
    const letters = (m[1].match(/\p{L}/gu) || []).length;
    if (letters >= JSX_MIN_LETTERS) jsxTextCount++;
  }

  const exported = [];
  const lines = text.split(/\r?\n/);
  for (let li = 0; li < lines.length; li++) {
    if (!EXPORTED_DECL_RX.test(lines[li])) continue;
    let k = li - 1;
    while (k >= 0 && lines[k].trim() === '') k--;
    const documented = k >= 0 && lines[k].trim().endsWith('*/') && textHasJsDocAbove(lines, k);
    exported.push({ documented });
  }

  return { functions, shortIdentifierCounts, catchTotal, catchSilent, jsxTextCount, exported };
}

// ---------------------------------------------------------------------------
// Python analysis (indentation/regex heuristics — no AST dependency)
// ---------------------------------------------------------------------------

function analyzePythonFile(text, lines, relPath, loc) {
  const DEF_RX = /^(\s*)def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/;
  const funcs = [];
  let i = 0;
  while (i < lines.length) {
    const m = DEF_RX.exec(lines[i]);
    if (!m) { i++; continue; }
    const indent = m[1].length;
    const name = m[2];
    const startLine = i + 1;
    let j = i + 1;
    while (j < lines.length) {
      const line = lines[j];
      if (line.trim() === '') { j++; continue; }
      const lineIndent = /^(\s*)/.exec(line)[1].length;
      if (lineIndent <= indent) break;
      j++;
    }
    let k = i + 1;
    while (k < lines.length && lines[k].trim() === '') k++;
    const bodyFirst = k < lines.length ? lines[k].trim() : '';
    const hasDocstring = /^[uUrRbB]{0,2}("""|''')/.test(bodyFirst);
    funcs.push({ name, file: relPath, startLine, length: j - i, isPublic: !name.startsWith('_'), hasDocstring });
    i = j;
  }

  let bareExcept = 0;
  for (let li = 0; li < lines.length; li++) {
    if (/^\s*except\s*:\s*$/.test(lines[li])) { bareExcept++; continue; }
    if (/^\s*except\s+Exception\s*:\s*$/.test(lines[li])) {
      let k = li + 1;
      while (k < lines.length && lines[k].trim() === '') k++;
      if (k < lines.length && lines[k].trim() === 'pass') bareExcept++;
    }
  }

  return { relPath, loc, isPython: true, funcs, bareExcept, todoFixmeHack: countMatches(TODO_RX, text) };
}

// ---------------------------------------------------------------------------
// Per-file dispatch
// ---------------------------------------------------------------------------

function analyzeFile(tsModule, absPath, relPath, isTest) {
  let text;
  try {
    text = fs.readFileSync(absPath, 'utf8');
  } catch (e) {
    return { relPath, error: e.message };
  }
  const lines = text.split(/\r?\n/);
  const loc = lines.length;
  const ext = path.extname(absPath).toLowerCase();

  if (ext === PY_EXT) return { ...analyzePythonFile(text, lines, relPath, loc), isTest };

  const common = analyzeCommonPatterns(text, lines, isTest);
  let structural;
  let usedFallback = false;
  if (tsModule) {
    try {
      structural = analyzeWithTS(tsModule, text, absPath, ext, relPath);
    } catch {
      structural = analyzeWithRegex(text, relPath);
      usedFallback = true;
    }
  } else {
    structural = analyzeWithRegex(text, relPath);
  }
  return { relPath, loc, isTest, isPython: false, usedFallback, ...common, ...structural };
}

// ---------------------------------------------------------------------------
// Per-repo aggregation
// ---------------------------------------------------------------------------

function round2(n) { return Math.round(n * 100) / 100; }
function round4(n) { return Math.round(n * 10000) / 10000; }

function aggregateRepo(repoPath, records, meta) {
  const warnings = meta.warnings.slice();
  let files = 0;
  let loc = 0;
  let testFiles = 0;
  let fnTotal = 0;
  let fnOver60 = 0;
  let fnOver100 = 0;
  let paramsOver4 = 0;
  let nestingOver3 = 0;
  let maxLen = { length: 0, name: null, file: null };
  const fileLocList = [];
  const shortIdCounts = new Map();
  let anyUsage = 0;
  let tsIgnore = 0;
  let eslintDisable = 0;
  let todoFixmeHack = 0;
  let consoleLog = 0;
  let commentLinesTotal = 0;
  let locForComments = 0;
  let catchTotal = 0;
  let catchSilent = 0;
  let jsxTextCount = 0;
  let exportedTotal = 0;
  let exportedDocumented = 0;
  let pyFuncsOver60 = 0;
  let pyMissingDocstring = 0;
  let pyBareExcept = 0;
  let pyFuncsTotal = 0;
  let pyPublicFuncsTotal = 0;

  for (const r of records) {
    if (r.error) { warnings.push(`read-error ${r.relPath}: ${r.error}`); continue; }
    files++;
    loc += r.loc;
    if (r.isTest) testFiles++;
    fileLocList.push({ file: r.relPath, loc: r.loc });

    if (r.isPython) {
      pyBareExcept += r.bareExcept;
      todoFixmeHack += r.todoFixmeHack;
      for (const f of r.funcs) {
        pyFuncsTotal++;
        if (f.isPublic) pyPublicFuncsTotal++;
        if (f.length > FN_LONG_LINES) pyFuncsOver60++;
        if (f.isPublic && !f.hasDocstring) pyMissingDocstring++;
      }
      continue;
    }

    anyUsage += r.anyUsage;
    tsIgnore += r.tsIgnore;
    eslintDisable += r.eslintDisable;
    todoFixmeHack += r.todoFixmeHack;
    consoleLog += r.consoleLog;
    commentLinesTotal += r.commentLines;
    locForComments += r.loc;
    catchTotal += r.catchTotal;
    catchSilent += r.catchSilent;
    jsxTextCount += r.jsxTextCount;
    for (const e of r.exported) { exportedTotal++; if (e.documented) exportedDocumented++; }
    for (const [name, count] of r.shortIdentifierCounts) shortIdCounts.set(name, (shortIdCounts.get(name) || 0) + count);
    for (const fn of r.functions) {
      fnTotal++;
      if (fn.length > FN_LONG_LINES) fnOver60++;
      if (fn.length > FN_VERY_LONG_LINES) fnOver100++;
      if (fn.params > PARAM_COUNT_THRESHOLD) paramsOver4++;
      if (fn.nesting > NESTING_DEPTH_THRESHOLD) nestingOver3++;
      if (fn.length > maxLen.length) maxLen = { length: fn.length, name: fn.name, file: fn.file };
    }
  }

  fileLocList.sort((a, b) => b.loc - a.loc);
  const over400 = fileLocList.filter((f) => f.loc > FILE_LARGE_LOC);
  const over1000 = fileLocList.filter((f) => f.loc > FILE_HUGE_LOC);
  const topShortIds = [...shortIdCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP_IDENTIFIERS)
    .map(([name, count]) => ({ name, count }));
  const shortIdTotal = [...shortIdCounts.values()].reduce((a, b) => a + b, 0);
  const nonTestFiles = files - testFiles;
  const srcToTestRatio = testFiles > 0 ? round2(nonTestFiles / testFiles) : null;

  return {
    repo: repoPath,
    name: path.basename(repoPath),
    ok: true,
    error: null,
    parser: meta.parser,
    parserFallbackFiles: meta.parserFallbackFiles,
    timedOut: meta.timedOut,
    elapsedMs: meta.elapsedMs,
    warnings,
    files,
    loc,
    testFiles,
    srcToTestRatio,
    functions: {
      total: fnTotal,
      over60: fnOver60,
      over100: fnOver100,
      maxLen: maxLen.name ? maxLen : null,
      paramsOver4,
      nestingOver3,
    },
    largeFiles: {
      over400Count: over400.length,
      over400Top5: over400.slice(0, TOP_LARGE_FILES),
      over1000Count: over1000.length,
    },
    shortIdentifiers: { count: shortIdTotal, top10: topShortIds },
    anyUsage,
    tsIgnore,
    eslintDisable,
    catchBlocks: { total: catchTotal, silent: catchSilent },
    consoleLog,
    todoFixmeHack,
    comments: {
      commentLines: commentLinesTotal,
      loc: locForComments,
      ratio: locForComments > 0 ? round4(commentLinesTotal / locForComments) : null,
    },
    docCoverage: {
      exportedTotal,
      documented: exportedDocumented,
      ratio: exportedTotal > 0 ? round4(exportedDocumented / exportedTotal) : null,
    },
    jsxHardcodedText: jsxTextCount,
    python: {
      functionsTotal: pyFuncsTotal,
      publicFunctionsTotal: pyPublicFuncsTotal,
      functionsOver60: pyFuncsOver60,
      missingDocstring: pyMissingDocstring,
      bareExcept: pyBareExcept,
    },
  };
}

// Returns { ts, reason }: `ts` is the repo's own TypeScript module or null, `reason` says why it is null
// (missing vs present-but-broken) so the caller can surface it instead of quietly downgrading.
// `repoPath` must already be absolute — see toAbsoluteRepoPath.
function loadRepoTypescript(repoPath) {
  const tsDir = path.join(repoPath, 'node_modules', 'typescript');
  if (!fs.existsSync(path.join(tsDir, 'package.json'))) {
    return { ts: null, reason: `no node_modules/typescript under ${repoPath} (dependencies not installed?)` };
  }
  try {
    return { ts: require(require.resolve(tsDir)), reason: null };
  } catch (e) {
    return { ts: null, reason: `node_modules/typescript is present but failed to load: ${e && e.message ? e.message : e}` };
  }
}

function warnRepo(warnings, repoName, message) {
  warnings.push(message);
  process.stderr.write(`fleet-metrics: ${repoName}: WARNING ${message}\n`);
}

function analyzeRepo(repoPathInput, opts) {
  const startedAt = Date.now();
  const deadline = startedAt + (opts.timeoutMs || REPO_TIMEOUT_MS);
  const repoPath = toAbsoluteRepoPath(repoPathInput);
  const repoName = path.basename(repoPath);

  if (!fs.existsSync(repoPath)) {
    return { repo: repoPath, name: repoName, ok: false, error: 'path not found', elapsedMs: 0 };
  }

  const warnings = [];
  const { ts: tsModule, reason: tsUnavailable } = loadRepoTypescript(repoPath);
  const parser = tsModule ? 'typescript' : 'regex';
  if (!tsModule) {
    warnRepo(warnings, repoName, `TypeScript parser unavailable (${tsUnavailable}); using regex fallback — function/params/nesting/short-identifier counts are approximate and typically undercount`);
  }

  let allFiles;
  try {
    allFiles = walkRepo(repoPath, deadline);
  } catch (e) {
    return { repo: repoPath, name: path.basename(repoPath), ok: false, error: `walk failed: ${e.message}`, elapsedMs: Date.now() - startedAt };
  }
  let timedOut = Date.now() > deadline;

  const candidates = allFiles.filter((f) => includeFile(repoPath, f));
  const records = [];
  let parserFallbackFiles = 0;
  for (const abs of candidates) {
    if (Date.now() > deadline) { timedOut = true; warnings.push('per-repo timeout reached; partial results only'); break; }
    const rel = toPosixRel(repoPath, abs);
    const isTest = isTestPath(rel);
    const rec = analyzeFile(tsModule, abs, rel, isTest);
    if (rec.usedFallback) parserFallbackFiles++;
    records.push(rec);
  }
  if (parserFallbackFiles > 0) {
    const jsTsFiles = records.filter((rec) => !rec.error && !rec.isPython).length;
    warnRepo(warnings, repoName, `${parserFallbackFiles} of ${jsTsFiles} JS/TS files fell back to the regex parser because the TypeScript parser threw; their counts are approximate`);
  }

  return aggregateRepo(repoPath, records, {
    parser,
    parserFallbackFiles,
    timedOut,
    elapsedMs: Date.now() - startedAt,
    warnings,
  });
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function pct(ratio) { return ratio === null || ratio === undefined ? 'n/a' : `${Math.round(ratio * 100)}%`; }
function sumBy(arr, fn) { return arr.reduce((a, x) => a + fn(x), 0); }

function formatRepoSummary(r) {
  if (!r.ok) return `${r.name}: FAILED - ${r.error}`;
  return [
    `${r.name} (parser=${r.parser}${r.timedOut ? ', TIMED OUT (partial)' : ''})`,
    `files=${r.files} loc=${r.loc} testFiles=${r.testFiles} srcToTestRatio=${r.srcToTestRatio}`,
    `functions: total=${r.functions.total} >60=${r.functions.over60} >100=${r.functions.over100} params>4=${r.functions.paramsOver4} nesting>3=${r.functions.nestingOver3}`,
    `largeFiles: >400=${r.largeFiles.over400Count} >1000=${r.largeFiles.over1000Count}`,
    `shortIdentifiers=${r.shortIdentifiers.count} any=${r.anyUsage} tsIgnore=${r.tsIgnore} eslintDisable=${r.eslintDisable}`,
    `catch silent/total=${r.catchBlocks.silent}/${r.catchBlocks.total} consoleLog=${r.consoleLog} todo=${r.todoFixmeHack}`,
    `commentRatio=${pct(r.comments.ratio)} docCoverage=${pct(r.docCoverage.ratio)} jsxHardcodedText=${r.jsxHardcodedText}`,
    `python: fn>60=${r.python.functionsOver60} missingDocstring=${r.python.missingDocstring} bareExcept=${r.python.bareExcept}`,
  ].join('\n');
}

const WORST_OFFENDER_METRICS = [
  ['Longest function (lines)', (r) => (r.functions.maxLen ? r.functions.maxLen.length : 0),
    (r) => (r.functions.maxLen ? `${r.functions.maxLen.name} (${r.functions.maxLen.file})` : '')],
  ['Functions >60 lines', (r) => r.functions.over60],
  ['Functions >100 lines', (r) => r.functions.over100],
  ['Params >4', (r) => r.functions.paramsOver4],
  ['Nesting >3', (r) => r.functions.nestingOver3],
  ['Files >400 loc', (r) => r.largeFiles.over400Count],
  ['Files >1000 loc', (r) => r.largeFiles.over1000Count],
  ['Short identifiers', (r) => r.shortIdentifiers.count],
  [': any / as any', (r) => r.anyUsage],
  ['@ts-ignore / @ts-expect-error', (r) => r.tsIgnore],
  ['eslint-disable', (r) => r.eslintDisable],
  ['Silent catch blocks', (r) => r.catchBlocks.silent],
  ['console.log (non-test)', (r) => r.consoleLog],
  ['TODO/FIXME/HACK', (r) => r.todoFixmeHack],
  ['JSX hardcoded text', (r) => r.jsxHardcodedText],
  ['Python functions >60 lines', (r) => r.python.functionsOver60],
  ['Python missing docstring', (r) => r.python.missingDocstring],
  ['Python bare except', (r) => r.python.bareExcept],
];

const FLEET_SIGNAL_METRICS = [
  ['functions>60', (r) => r.functions.over60],
  ['functions>100', (r) => r.functions.over100],
  ['params>4', (r) => r.functions.paramsOver4],
  ['nesting>3', (r) => r.functions.nestingOver3],
  ['files>400', (r) => r.largeFiles.over400Count],
  ['files>1000', (r) => r.largeFiles.over1000Count],
  ['shortIdentifiers', (r) => r.shortIdentifiers.count],
  ['anyUsage', (r) => r.anyUsage],
  ['tsIgnore', (r) => r.tsIgnore],
  ['eslintDisable', (r) => r.eslintDisable],
  ['silentCatch', (r) => r.catchBlocks.silent],
  ['consoleLog', (r) => r.consoleLog],
  ['todoFixmeHack', (r) => r.todoFixmeHack],
  ['jsxHardcodedText', (r) => r.jsxHardcodedText],
  ['python.functionsOver60', (r) => r.python.functionsOver60],
  ['python.missingDocstring', (r) => r.python.missingDocstring],
  ['python.bareExcept', (r) => r.python.bareExcept],
];

// Disambiguates repos that share a basename (e.g. two differently-located "calculator-app"
// checkouts) so the markdown report doesn't silently conflate them.
function buildDisplayNames(results) {
  const byName = new Map();
  for (const r of results) {
    if (!byName.has(r.name)) byName.set(r.name, []);
    byName.get(r.name).push(r);
  }
  const display = new Map();
  for (const [name, group] of byName) {
    if (group.length === 1) { display.set(group[0].repo, name); continue; }
    for (const r of group) display.set(r.repo, `${name} [${path.basename(path.dirname(r.repo))}]`);
  }
  return display;
}

function buildMarkdownReport(results) {
  const ok = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);
  const displayNames = buildDisplayNames(results);
  const dn = (r) => displayNames.get(r.repo) || r.name;
  const lines = [];

  lines.push('# Fleet Code Quality Metrics (A1)', '');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Repos analyzed: ${results.length} (ok: ${ok.length}, failed: ${failed.length})`, '');

  lines.push('## Fleet-wide table', '');
  lines.push('| Repo | Parser | Files | LOC | Test | Fn>60 | Fn>100 | Params>4 | Nest>3 | F>400 | F>1000 | ShortID | any | ts-ignore | eslint-dis | catch silent/total | console.log | TODO | comment% | doc% | JSX text | Py fn>60 | Py no-doc | Py bare-except |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of ok) {
    lines.push(`| ${dn(r)} | ${r.parser}${r.timedOut ? ' (TO)' : ''} | ${r.files} | ${r.loc} | ${r.testFiles} | ${r.functions.over60} | ${r.functions.over100} | ${r.functions.paramsOver4} | ${r.functions.nestingOver3} | ${r.largeFiles.over400Count} | ${r.largeFiles.over1000Count} | ${r.shortIdentifiers.count} | ${r.anyUsage} | ${r.tsIgnore} | ${r.eslintDisable} | ${r.catchBlocks.silent}/${r.catchBlocks.total} | ${r.consoleLog} | ${r.todoFixmeHack} | ${pct(r.comments.ratio)} | ${pct(r.docCoverage.ratio)} | ${r.jsxHardcodedText} | ${r.python.functionsOver60} | ${r.python.missingDocstring} | ${r.python.bareExcept} |`);
  }

  if (failed.length) {
    lines.push('', '## Failed / skipped repos');
    for (const r of failed) lines.push(`- ${dn(r)}: ${r.error}`);
  }

  lines.push('', '## Worst offenders per metric');
  for (const [label, valueFn, extraFn] of WORST_OFFENDER_METRICS) {
    const ranked = ok.map((r) => ({ r, v: valueFn(r) })).filter((x) => x.v > 0).sort((a, b) => b.v - a.v).slice(0, TOP_OFFENDERS);
    lines.push('', `**${label}**`);
    if (!ranked.length) { lines.push('- none'); continue; }
    for (const { r, v } of ranked) lines.push(`- ${dn(r)}: ${v}${extraFn ? ` — ${extraFn(r)}` : ''}`);
  }

  lines.push('', '## Signals ranked by fleet-wide frequency (per 1k LOC)', '');
  const totalLoc = sumBy(ok, (r) => r.loc) || 1;
  const ranked = FLEET_SIGNAL_METRICS
    .map(([name, fn]) => {
      const total = sumBy(ok, fn);
      return { name, total, per1k: round2((total / totalLoc) * 1000) };
    })
    .sort((a, b) => b.per1k - a.per1k);
  lines.push('| Rank | Signal | Total | Per 1k LOC |');
  lines.push('|---|---|---|---|');
  ranked.forEach((s, idx) => lines.push(`| ${idx + 1} | ${s.name} | ${s.total} | ${s.per1k} |`));

  return `${lines.join('\n')}\n`;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.repo) {
    const result = analyzeRepo(normalizePath(args.repo), { timeoutMs: args.timeout });
    process.stdout.write(args.json ? `${JSON.stringify(result, null, 2)}\n` : `${formatRepoSummary(result)}\n`);
    process.exit(0);
  }

  if (!args.list) {
    process.stderr.write('fleet-metrics: provide --repo <path> or --list <repos-file>\n');
    process.exit(0);
  }

  const listPath = normalizePath(args.list);
  let lines;
  try {
    lines = fs.readFileSync(listPath, 'utf8').split(/\r?\n/);
  } catch (e) {
    process.stderr.write(`fleet-metrics: cannot read list file: ${e.message}\n`);
    process.exit(0);
    return;
  }

  const repoPaths = lines
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map(normalizePath)
    .filter((p) => !args.exclude.some((pat) => globMatch(path.basename(p), pat)));

  const globalDeadline = Date.now() + args.budget;
  const results = [];
  for (const repoPath of repoPaths) {
    if (Date.now() > globalDeadline) {
      results.push({ repo: repoPath, name: path.basename(repoPath), ok: false, error: 'skipped: global time budget exceeded', elapsedMs: 0 });
      continue;
    }
    try {
      results.push(analyzeRepo(repoPath, { timeoutMs: args.timeout }));
    } catch (e) {
      results.push({ repo: repoPath, name: path.basename(repoPath), ok: false, error: `analyzeRepo crashed: ${e.message}`, elapsedMs: 0 });
    }
  }

  const outDir = args.out ? normalizePath(args.out) : process.cwd();
  fs.mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, 'A1-fleet-metrics.json');
  const mdPath = path.join(outDir, 'A1-fleet-metrics.md');
  const payload = { generatedAt: new Date().toISOString(), results };
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2));
  fs.writeFileSync(mdPath, buildMarkdownReport(results));

  process.stdout.write(args.json
    ? `${JSON.stringify(payload, null, 2)}\n`
    : `fleet-metrics: analyzed ${results.length} repos -> ${jsonPath}\n`);
  process.exit(0);
}

try {
  main();
} catch (e) {
  process.stderr.write(`fleet-metrics: fatal error (reported, not thrown): ${e && e.stack ? e.stack : e}\n`);
  process.exit(0);
}

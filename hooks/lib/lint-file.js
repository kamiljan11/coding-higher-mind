'use strict';
// Wspolna logika lint + typecheck dla hookow: post-edit-check (Edit/Write/MCP),
// post-bash-edit-check (sed / heredoc / redirect) i stop-gate (wszystko zmienione w repo).
// Zasady:
//  - fail-open na BRAK narzedzia / timeout: hook nigdy nie wiesza sesji,
//  - ale kazdy skip trafia do logu bramek (skip niewidoczny = bramka, ktorej nie ma),
//  - jeden lint na jezyk i jeden typecheck na repo (nie per plik) — stop-gate podaje wiele plikow,
//  - `tsc -b` gdy tsconfig ma "references" (vite): `tsc --noEmit` sprawdza tam NIC (luka z QA sweep 2026-08-08).
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { log } = require('./gate-log');

const JS_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs']);
const TIMEOUT_LINT_MS = 45000;
const TIMEOUT_TSC_MS = 90000;
const TIMEOUT_PYRIGHT_MS = 60000;
const MAX_REPORT_LINES = 60;
const MAX_ROOT_SEARCH_DEPTH = 15;
// Brak pakietu w (nieaktywnym) venv to nie blad kodu — nie blokujemy na tym.
const PYRIGHT_SOFT_RULES = /^(reportMissingImports|reportMissingModuleSource)$/;
// "Narzedzie nie istnieje / srodowisko" — sprawdzane na komunikacie procesu i poczatku stderr,
// nigdy na calym outpucie lintera (komunikat lintu "not found" nie moze udawac braku narzedzia).
const TOOL_MISSING_RX = /ENOENT|not recognized|command not found|No module named|could not determine executable/i;
// Realny wynik lintera/typechecka — jesli to widzimy, narzedzie zadzialalo.
const REAL_FINDING_RX = /error TS\d|:\d+:\d+\s+(error|warning)|:\d+:\d+: [A-Z]\d{3,4}|"generalDiagnostics"|✖|\d+ problems?/i;
const STDERR_PROBE_CHARS = 400;
// JSON z komentarzami — JSON.parse by je odrzucil, a to nie blad.
const JSONC_FILE_RX = /^(tsconfig|jsconfig)|\.jsonc$/;
const JSONC_DIR_RX = /[\/\\]\.(vscode|devcontainer)[\/\\]/;
// Komendy Bash/PowerShell, ktore moga zapisac plik z pominieciem narzedzi Edit/Write.
// `>` i `>>` (append — najczestszy wzorzec `printf ... >> plik.py`, przepuszczony w v3.0), `sed -i` / `--in-place`.
const WRITE_COMMAND_RX = /(\bsed\b[^|\n]*\s(-i|--in-place)|\bperl\b[^|\n]*\s-p?i|(^|[^>&\d])>{1,2}\s*["']?[^\s"'|&;<>]+|\btee\b|<<-?\s*['"]?\w+|\b(Set-Content|Out-File|Add-Content)\b|\b(mv|cp|move|copy)\b\s|open\([^)]*['"][wa]|--write\b|--fix\b)/;

const typecheckCache = new Map(); // root -> wynik; jedno repo = jeden tsc na proces hooka

function findRoot(startFile) {
  let dir = path.dirname(path.resolve(startFile));
  for (let i = 0; i < MAX_ROOT_SEARCH_DEPTH; i++) {
    if (fs.existsSync(path.join(dir, 'package.json')) || fs.existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.dirname(path.resolve(startFile));
}

function hasBin(root, name) {
  const bin = path.join(root, 'node_modules', '.bin', name);
  return fs.existsSync(bin) || fs.existsSync(bin + '.cmd');
}

const quote = (s) => '"' + String(s).replace(/"/g, '\\"') + '"';
const shortCmd = (cmd) => cmd.split(' ').slice(0, 3).join(' ');

// Wszystkie procesy potomne (git, lintery) dostaja env, w ktorym repo NIE moze wykonac kodu przez wlasny
// .git/config: `core.fsmonitor` (RCE z `git status` w podrzuconym repo — finding security-reviewer 2026-09-05).
const CHILD_ENV = Object.assign({}, process.env, {
  CI: '1',
  GIT_CONFIG_PARAMETERS: "'core.fsmonitor=false' 'core.untrackedCache=false' 'core.hooksPath=/dev/null'",
});
// Usuwamy sciezki (w cudzyslowach) zanim szukamy sygnatur "brak narzedzia" — plik `ENOENT.ts` nie moze
// zamienic realnego bledu lintu w cichy skip (finding security-reviewer 2026-09-05).
const stripQuoted = (s) => String(s || '').replace(/"[^"]*"|'[^']*'/g, '');

// Wynik: { ok:true } | { missing:true, why } | { out } (narzedzie zadzialalo i zglosilo problemy)
function run(cmd, cwd, timeoutMs) {
  try {
    execSync(cmd, { cwd, stdio: ['ignore', 'pipe', 'pipe'], timeout: timeoutMs, env: CHILD_ENV });
    return { ok: true };
  } catch (e) {
    const stderr = String(e.stderr || '');
    const out = (String(e.stdout || '') + '\n' + stderr).trim();
    if (e.code === 'ETIMEDOUT' || e.signal === 'SIGTERM') return { missing: true, why: `timeout ${timeoutMs}ms: ${shortCmd(cmd)}` };
    const spawnFailed = e.code === 'ENOENT' || /\bspawn\b.*\bENOENT\b/.test(stripQuoted(e.message));
    const looksMissing = spawnFailed || TOOL_MISSING_RX.test(stripQuoted(stderr.slice(0, STDERR_PROBE_CHARS)));
    if (looksMissing && !REAL_FINDING_RX.test(out)) return { missing: true, why: `tool missing: ${shortCmd(cmd)}` };
    return { out: out || String(e.message || 'unknown error') };
  }
}

const trimReport = (out) => String(out).split('\n').slice(0, MAX_REPORT_LINES).join('\n');
const skipped = (hook, why, target) => log({ hook, event: 'skipped', reason: why, target });
const baseNames = (files) => files.map((f) => path.basename(f)).join(', ');

function lintJsFiles(files, root, hook) {
  if (!fs.existsSync(path.join(root, 'package.json'))) { skipped(hook, 'no package.json', root); return null; }
  const list = files.map(quote).join(' ');
  let result;
  if (hasBin(root, 'eslint')) result = run('npx --no-install eslint --max-warnings=0 ' + list, root, TIMEOUT_LINT_MS);
  else if (hasBin(root, 'oxlint')) result = run('npx --no-install oxlint --deny-warnings ' + list, root, TIMEOUT_LINT_MS);
  else { skipped(hook, 'no eslint/oxlint in node_modules', root); return null; }
  if (result.missing) { skipped(hook, result.why, root); return null; }
  if (result.out) return { blocked: true, header: `Lint znalazl problemy (${baseNames(files)}) — popraw je teraz:`, out: trimReport(result.out) };
  return null;
}

function tscCommand(root) {
  try {
    if (/"references"\s*:/.test(fs.readFileSync(path.join(root, 'tsconfig.json'), 'utf8'))) return 'npx --no-install tsc -b';
  } catch (e) { /* nieczytelny tsconfig => zwykla sciezka */ }
  return 'npx --no-install tsc --noEmit --incremental';
}

function typecheckRepo(root, hook) {
  if (typecheckCache.has(root)) return typecheckCache.get(root);
  let result = null;
  if (!fs.existsSync(path.join(root, 'tsconfig.json'))) skipped(hook, 'no tsconfig.json', root);
  else if (!hasBin(root, 'tsc')) skipped(hook, 'no tsc in node_modules', root);
  else {
    const r = run(tscCommand(root), root, TIMEOUT_TSC_MS);
    if (r.missing) skipped(hook, r.why, root);
    else if (r.out && /error TS/.test(r.out)) result = { blocked: true, header: 'TypeScript — bledy typow, popraw je teraz:', out: trimReport(r.out) };
  }
  typecheckCache.set(root, result);
  return result;
}

// null = output nie byl JSON-em pyrighta (pokazemy surowy)
function pyrightHardErrors(out) {
  try {
    const parsed = JSON.parse(out.slice(out.indexOf('{')));
    return (parsed.generalDiagnostics || [])
      .filter((d) => d.severity === 'error' && !PYRIGHT_SOFT_RULES.test(String(d.rule || '')))
      .map((d) => `${path.basename(d.file || '?')}:${(d.range && d.range.start.line + 1) || '?'}: ${d.message}`);
  } catch (e) { return null; }
}

function lintPyFiles(files, root, hook) {
  const list = files.map(quote).join(' ');
  // B006 (mutowalny default argumentu) = error wg pg/paradigm.md:43; domyslny zestaw ruffa
  // nie zawiera regul B, wiec bez tej flagi reguła istniała tylko na papierze (2026-09-06).
  let ruff = run('ruff check --extend-select B006,B008 ' + list, root, TIMEOUT_LINT_MS);
  if (ruff.missing) ruff = run('python -m ruff check ' + list, root, TIMEOUT_LINT_MS); // pip --user bez PATH
  if (ruff.missing) skipped(hook, ruff.why, root);
  else if (ruff.out) return { blocked: true, header: `Ruff znalazl problemy (${baseNames(files)}) — popraw je teraz:`, out: trimReport(ruff.out) };

  const pyright = run('pyright --outputjson ' + list, root, TIMEOUT_PYRIGHT_MS);
  if (pyright.missing) { skipped(hook, pyright.why, root); return null; }
  if (!pyright.out) return null;
  const errors = pyrightHardErrors(pyright.out);
  if (errors === null) return { blocked: true, header: 'pyright — bledy typow, popraw je teraz:', out: trimReport(pyright.out) };
  if (!errors.length) return null;
  return { blocked: true, header: 'pyright — bledy typow, popraw je teraz:', out: trimReport(errors.join('\n')) };
}

function lintJsonFile(file) {
  if (JSONC_FILE_RX.test(path.basename(file).toLowerCase()) || JSONC_DIR_RX.test(file)) return null;
  try { JSON.parse(fs.readFileSync(file, 'utf8')); return null; } catch (e) {
    return { blocked: true, header: `JSON niepoprawny w ${path.basename(file)} — napraw skladnie:`, out: String(e.message) };
  }
}

const isJsFile = (f) => JS_EXTENSIONS.has(path.extname(f).toLowerCase());
const isPyFile = (f) => path.extname(f).toLowerCase() === '.py';
const isJsonFile = (f) => path.extname(f).toLowerCase() === '.json';
const isCodeFile = (f) => isJsFile(f) || isPyFile(f);

function groupBy(items, keyFn) {
  const groups = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return groups;
}

// Komendy skladamy jako string (npx/*.cmd na Windows wymaga shella), wiec sciezka z metaznakami
// shella nie wchodzi do komendy — jest pomijana i logowana. W repo kodu takich nazw nie ma.
const SAFE_PATH_RX = /^[^"$`;&|<>%^\n\r]+$/; // %^ = metaznaki cmd.exe (Windows)

// Lintuje ZBIOR plikow. opts: { hook: nazwa do logu, typecheck: bool (domyslnie true) }.
// Zwraca pierwszy blok { blocked, header, out } albo null, gdy czysto / wszystko pominiete.
function lintFiles(files, opts) {
  const hook = (opts && opts.hook) || 'lint';
  const typecheck = !opts || opts.typecheck !== false;
  const existing = files.filter((f) => {
    if (!fs.existsSync(f)) return false;
    if (SAFE_PATH_RX.test(f)) return true;
    skipped(hook, 'unsafe path chars', f);
    return false;
  });
  const byRoot = groupBy(existing, findRoot);
  for (const [root, group] of byRoot) {
    const js = group.filter(isJsFile);
    const py = group.filter(isPyFile);
    const json = group.filter(isJsonFile);
    let result = null;
    if (js.length) result = lintJsFiles(js, root, hook) || (typecheck ? typecheckRepo(root, hook) : null);
    if (!result && py.length) result = lintPyFiles(py, root, hook);
    if (!result) for (const j of json) { result = lintJsonFile(j); if (result) break; }
    if (result) { log({ hook, event: 'blocked', reason: result.header.split(' (')[0].split(' —')[0], target: root }); return result; }
  }
  log({ hook, event: 'ran', reason: `${existing.length} files`, target: [...byRoot.keys()].join(';') });
  return null;
}

module.exports = { lintFiles, typecheckRepo, findRoot, hasBin, run, quote, isCodeFile, isJsFile, isPyFile, isJsonFile, WRITE_COMMAND_RX, CHILD_ENV };

#!/usr/bin/env node
'use strict';

/**
 * Unit test for fleet-metrics.js. Runs the tool (regex-fallback path — the fixture has
 * no node_modules/typescript, which is the higher-risk code path) against a small fixture
 * with known, hand-verified structure, and asserts the resulting counts.
 */

const { execFileSync, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

// FLEET_METRICS_TOOL lets you point the suite at another copy (e.g. a pre-fix backup) to prove a case discriminates.
const TOOL_PATH = process.env.FLEET_METRICS_TOOL || path.join(__dirname, 'fleet-metrics.js');
const SCRATCH_ROOT = process.env.FLEET_METRICS_SCRATCH
  || '$TMP/claude';
// Fixture trwaly (2026-09-05): scratchpad sesji znika — test nie moze od niego zalezec.
const FIXTURE_DIR = path.join(require('os').homedir(), '.claude', 'pg', 'eval', 'fixtures', 'fleet-metrics');

let pass = 0;
let fail = 0;

function assert(cond, label) {
  if (cond) { pass++; console.log(`PASS: ${label}`); } else { fail++; console.error(`FAIL: ${label}`); }
}

function assertEqual(actual, expected, label) {
  assert(actual === expected, `${label} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
}

function assertAtLeast(actual, min, label) {
  assert(actual >= min, `${label} (expected >= ${min}, got ${JSON.stringify(actual)})`);
}

if (!fs.existsSync(path.join(FIXTURE_DIR, 'src', 'sample.tsx')) || !fs.existsSync(path.join(FIXTURE_DIR, 'src', 'sample.py'))) {
  console.error(`FAIL: fixture missing under ${FIXTURE_DIR}`);
  process.exit(1);
}

let raw;
try {
  raw = execFileSync(process.execPath, [TOOL_PATH, '--repo', FIXTURE_DIR, '--json'], { encoding: 'utf8', timeout: 30_000 });
} catch (e) {
  console.error('FAIL: tool invocation threw (tool must always exit 0)');
  console.error(e.message);
  process.exit(1);
}

let r;
try {
  r = JSON.parse(raw);
} catch (e) {
  console.error('FAIL: tool did not emit valid JSON on --json');
  console.error(raw);
  process.exit(1);
}

// --- basic shape ---
assertEqual(r.ok, true, 'repo analysis reports ok');
assertEqual(r.parser, 'regex', 'fixture (no node_modules/typescript) uses regex fallback');
assertEqual(r.files, 2, 'two fixture files scanned (sample.tsx + sample.py)');

// --- functions: length / params / nesting ---
assertAtLeast(r.functions.total, 6, 'at least 6 functions detected in sample.tsx');
assertEqual(r.functions.over60, 1, 'exactly one function >60 lines (longFunction, 70 lines)');
assertEqual(r.functions.over100, 0, 'no function >100 lines');
assert(!!r.functions.maxLen, 'maxLen populated');
assertEqual(r.functions.maxLen.length, 70, 'longFunction measured at exactly 70 lines');
assertEqual(r.functions.maxLen.name, 'longFunction', 'maxLen names longFunction');
assertEqual(r.functions.paramsOver4, 1, 'exactly one function with >4 params (manyParams, 5 params)');
assertEqual(r.functions.nestingOver3, 1, 'exactly one function with nesting >3 (deepNesting, depth 4)');

// --- silent catch ---
assertEqual(r.catchBlocks.total, 1, 'one catch block in fixture');
assertEqual(r.catchBlocks.silent, 1, 'that catch block is silent (no console/throw/etc inside)');

// --- as any ---
assertAtLeast(r.anyUsage, 1, '`as any` usage detected');

// --- short identifiers ---
assertAtLeast(r.shortIdentifiers.count, 6, 'multiple short identifiers detected');
const shortNames = r.shortIdentifiers.top10.map((x) => x.name);
assert(shortNames.includes('zz'), 'short identifier "zz" present in top10');
assert(shortNames.includes('q1'), 'short identifier "q1" present in top10');
assert(!shortNames.includes('id') && !shortNames.includes('ok'), 'allowlisted short names (id, ok, ...) excluded');

// --- JSX hardcoded text ---
assertAtLeast(r.jsxHardcodedText, 1, 'hardcoded JSX text ("Hello world") detected');

// --- TODO / eslint-disable ---
assertAtLeast(r.todoFixmeHack, 1, 'TODO comment detected');
assertAtLeast(r.eslintDisable, 1, 'eslint-disable comment detected');

// --- doc coverage ---
assertEqual(r.docCoverage.exportedTotal, 3, 'three exported top-level declarations');
assertEqual(r.docCoverage.documented, 1, 'exactly one of them has a leading JSDoc block');

// --- python ---
assertAtLeast(r.python.functionsOver60, 1, 'python function >60 lines detected');
assertAtLeast(r.python.missingDocstring, 1, 'python public function missing docstring detected');
assertEqual(r.python.bareExcept, 2, 'both bare-except forms detected (except: and except Exception: pass)');

// --- tool-level contract: always exits 0, even for a bad path ---
const badResult = execFileSync(process.execPath, [TOOL_PATH, '--repo', path.join(FIXTURE_DIR, 'does-not-exist'), '--json'], { encoding: 'utf8' });
const badParsed = JSON.parse(badResult);
assertEqual(badParsed.ok, false, 'nonexistent repo path reported as ok:false, not thrown');
assert(typeof badParsed.error === 'string' && badParsed.error.length > 0, 'nonexistent repo path carries an error message');

// --- parser downgrade must be LOUD (fixture has no node_modules/typescript) ---
function runTool(cliArgs, cwd) {
  const res = spawnSync(process.execPath, [TOOL_PATH, ...cliArgs], { cwd, encoding: 'utf8', timeout: 30_000 });
  return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
}
function parseJsonOrFail(text, label) {
  try { return JSON.parse(text); } catch (e) { assert(false, `${label}: valid JSON on stdout (${e.message})`); return null; }
}

const regexRun = runTool(['--repo', '.', '--json'], FIXTURE_DIR);
assertEqual(regexRun.status, 0, 'relative `--repo .` run from the fixture cwd exits 0');
const rel = parseJsonOrFail(regexRun.stdout, 'relative --repo .');
if (rel) {
  assertEqual(rel.ok, true, 'relative `--repo .` analyzes ok');
  assert(path.isAbsolute(rel.repo) && path.resolve(rel.repo) === path.resolve(FIXTURE_DIR), 'relative `--repo .` is resolved to the absolute fixture path');
  assertEqual(rel.repo, r.repo, '`repo` field is identical for relative and absolute invocations');
  assertEqual(rel.files, r.files, 'relative and absolute invocations scan the same file set');
  assert(rel.warnings.some((w) => /regex fallback/.test(w)), 'regex downgrade is surfaced in warnings[]');
  assert(/WARNING.*regex fallback/.test(regexRun.stderr), 'regex downgrade is printed to stderr');
}

// --- THE bug (2026-09-05): relative --repo must find the repo's OWN node_modules/typescript ---
// Deterministic stand-in for a real TypeScript install: a stub package whose API throws on use.
// Pre-fix tool: require.resolve('node_modules/typescript') looked under ~/.claude/bin -> parser:"regex", no warning.
// Fixed tool: parser:"typescript" (resolution hit the repo), every file falls back (stub throws) and SAYS so.
const tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-metrics-relpath-'));
try {
  fs.mkdirSync(path.join(tmpRepo, 'src'), { recursive: true });
  fs.copyFileSync(path.join(FIXTURE_DIR, 'src', 'sample.tsx'), path.join(tmpRepo, 'src', 'sample.tsx'));
  const stubDir = path.join(tmpRepo, 'node_modules', 'typescript');
  fs.mkdirSync(stubDir, { recursive: true });
  fs.writeFileSync(path.join(stubDir, 'package.json'), JSON.stringify({ name: 'typescript', version: '0.0.0-stub', main: 'index.js' }));
  fs.writeFileSync(path.join(stubDir, 'index.js'), 'module.exports = { __fleetMetricsStub: true };\n');

  const stubRun = runTool(['--repo', '.', '--json'], tmpRepo);
  assertEqual(stubRun.status, 0, 'stub repo: relative `--repo .` exits 0');
  const s = parseJsonOrFail(stubRun.stdout, 'stub repo relative --repo .');
  if (s) {
    assertEqual(s.parser, 'typescript', 'relative `--repo .` resolves node_modules/typescript INSIDE the repo (not next to the tool)');
    assertEqual(s.files, 1, 'stub repo: one source file scanned');
    assertEqual(s.parserFallbackFiles, 1, 'stub parser throws -> per-file regex fallback counted');
    assert(s.warnings.some((w) => /fell back to the regex parser/.test(w)), 'per-file fallback surfaced in warnings[]');
    assert(/WARNING.*fell back to the regex parser/.test(stubRun.stderr), 'per-file fallback printed to stderr');
    assertEqual(s.functions.over60, r.functions.over60, 'per-file fallback yields the same over60 count as the pure-regex run');
  }

  // --list with a relative entry goes through the same resolution
  fs.writeFileSync(path.join(tmpRepo, 'repos.txt'), '.\n');
  const listRun = runTool(['--list', 'repos.txt', '--out', 'out', '--json'], tmpRepo);
  assertEqual(listRun.status, 0, '--list run with a relative entry exits 0');
  const payload = parseJsonOrFail(listRun.stdout, '--list relative entry');
  if (payload) {
    assertEqual(payload.results.length, 1, '--list with one relative entry analyzes exactly one repo');
    assertEqual(payload.results[0].parser, 'typescript', '--list relative entry resolves the repo-local typescript too');
  }
} finally {
  fs.rmSync(tmpRepo, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

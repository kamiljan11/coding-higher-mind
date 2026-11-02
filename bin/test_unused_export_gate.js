#!/usr/bin/env node
// Testy bin/unused-export-gate.js (observe, 2026-10-26). Uruchom: node ~/.claude/bin/test_unused_export_gate.js
'use strict';
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'unused-export-'));
process.env.PG_GATE_LOG = path.join(TMP, 'gates.jsonl');
const GATE = path.join(__dirname, 'unused-export-gate.js');
const { addedDefinitions } = require(GATE);

let n = 0;
const it = (name, fn) => { fn(); n++; console.log('ok   ' + name); };
const repo = path.join(TMP, 'repo');
const git = (...a) => execFileSync('git', ['-C', repo, '-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'core.hooksPath=/dev/null', ...a], { encoding: 'utf8' });
const write = (rel, text) => { const f = path.join(repo, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
const run = (...extra) => spawnSync('node', [GATE, '--repo', repo, '--base', 'base', ...extra], { encoding: 'utf8' });

fs.mkdirSync(repo);
git('init', '-q');
write('src/used.ts', 'export const old = 1;\n');
git('add', '.'); git('commit', '-qm', 'base'); git('tag', 'base');

it('nowy eksport bez uzycia = werdykt (exit 1) z plikiem i linia', () => {
  write('src/lib/math.ts', 'export function add(a: number, b: number) { return a + b; }\nexport function speculativeHelper() { return 42; }\n');
  write('src/app.ts', 'import { add } from "./lib/math";\nconsole.log(add(1, 2));\n');
  git('add', '.'); git('commit', '-qm', 'feat');
  const r = run();
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /src\/lib\/math\.ts:2: speculativeHelper/);
  assert.doesNotMatch(r.stdout, /\badd\b —/);
});

it('eksport uzywany w tym samym pliku nie jest martwy', () => {
  write('src/self.ts', 'export const LIMIT = 5;\nexport function check(x: number) { return x < LIMIT; }\nconsole.log(check(1));\n');
  git('add', '.'); git('commit', '-qm', 'self');
  assert.doesNotMatch(run().stdout, /LIMIT|check —/);
});

it('konwencje frameworkow, testy, configi i publiczne API paczki sa pomijane', () => {
  write('src/routes/index.tsx', 'export const Route = 1;\nexport async function loader() {}\nexport function GET() {}\n');
  write('src/x.test.ts', 'export function onlyInTest() {}\n');
  write('vite.config.ts', 'export const viteOnly = 1;\n');
  write('package.json', JSON.stringify({ name: 'p', main: './src/public.js' }));
  write('src/public.js', 'export function publicApi() {}\n');
  git('add', '.'); git('commit', '-qm', 'conv');
  const out = run().stdout;
  for (const name of ['Route', 'loader', 'GET', 'onlyInTest', 'viteOnly', 'publicApi']) assert.doesNotMatch(out, new RegExp(`: ${name} —`), name);
});

it('python: nowa funkcja bez uzycia = werdykt; dekorowana i prywatna pomijane', () => {
  write('app/service.py', '@app.get("/x")\ndef route():\n    return 1\n\n\ndef _private():\n    return 2\n\n\ndef unused_py():\n    return 3\n');
  git('add', '.'); git('commit', '-qm', 'py');
  const out = run().stdout;
  assert.match(out, /app\/service\.py:10: unused_py/);
  assert.doesNotMatch(out, /: route —|_private/);
});

it('--staged patrzy na indeks; --from loguje would_block do gates.jsonl', () => {
  write('src/staged.ts', 'export const stagedOnly = 1;\n');
  git('add', 'src/staged.ts');
  const r = spawnSync('node', [GATE, '--repo', repo, '--staged', '--from', 'test'], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /stagedOnly/);
  const events = fs.readFileSync(process.env.PG_GATE_LOG, 'utf8').trim().split('\n').map(JSON.parse);
  assert.ok(events.some((e) => e.hook === 'unused-export-gate' && e.event === 'would_block' && e.source === 'test'));
  git('commit', '-qm', 'staged');
});

it('bez --from nie ma telemetrii (reczne uruchomienia nie zasmiecaja metryki)', () => {
  const before = fs.readFileSync(process.env.PG_GATE_LOG, 'utf8');
  run();
  assert.equal(fs.readFileSync(process.env.PG_GATE_LOG, 'utf8'), before);
});

it('blad narzedzia (nieznana baza) = exit 2, nie werdykt', () => {
  const r = spawnSync('node', [GATE, '--repo', repo, '--base', 'nie-ma-takiej-galezi'], { encoding: 'utf8' });
  assert.equal(r.status, 2, r.stderr);
});

it('addedDefinitions: liczy numery linii po hunkach i ignoruje usuniete linie', () => {
  const diff = ['+++ b/src/a.ts', '@@ -0,0 +3,2 @@', '+export const a = 1;', '+export type B = string;', '--- a/src/b.ts', '+++ b/src/b.ts', '@@ -5 +5 @@', '-export const gone = 1;', '+export const kept = 2;'].join('\n');
  assert.deepEqual(addedDefinitions(diff).map((d) => `${d.file}:${d.line}:${d.name}`), ['src/a.ts:3:a', 'src/a.ts:4:B', 'src/b.ts:5:kept']);
});

it('package.json -> /dev/zero i FIFO .py: bramka konczy sie szybko, nie czyta urzadzenia (security r9)', () => {
  fs.rmSync(path.join(repo, 'package.json'));
  fs.symlinkSync('/dev/zero', path.join(repo, 'package.json'));
  git('add', '.'); git('commit', '-qm', 'zero');
  const t0 = Date.now();
  const r = spawnSync('node', [GATE, '--repo', repo, '--base', 'HEAD~1'], { encoding: 'utf8', timeout: 20000 });
  assert.notEqual(r.signal, 'SIGTERM', 'bramka wisi na /dev/zero');
  assert.ok(Date.now() - t0 < 15000);
  write('app/fifo.py', 'def via_fifo():\n    return 1\n');
  git('add', '.'); git('commit', '-qm', 'fifo');
  fs.rmSync(path.join(repo, 'app/fifo.py'));
  execFileSync('mkfifo', [path.join(repo, 'app/fifo.py')]);
  const f = spawnSync('node', [GATE, '--repo', repo, '--base', 'HEAD~1'], { encoding: 'utf8', timeout: 20000 });
  assert.notEqual(f.signal, 'SIGTERM', 'bramka wisi na FIFO');
  assert.ok([0, 1].includes(f.status), f.stderr);
});

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n${n} testow OK`);

#!/usr/bin/env node
// Testy POZYTYWNE bramek anty-slop: kazda bramka MUSI zablokowac swoj przypadek i MUSI przepuscic negatyw.
// Uruchom: node ~/.claude/bin/test_slop_gates.js   (buduje tymczasowe repo git w %TEMP%, nic nie dotyka floty)
// Bramki: commented-code-gate, diff-size-gate, dup-literals (unit: test_dup_literals.js), dep-exists (offline: czyste funkcje).
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const BIN = __dirname;
const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-slop-gates-'));
const git = (...a) => {
  const r = spawnSync('git', a, { cwd: repo, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${a.join(' ')} -> ${r.status}: ${(r.stderr || r.stdout || '').trim()}`);
  return r.stdout;
};
const run = (script, ...a) => spawnSync(process.execPath, [path.join(BIN, script), ...a], { cwd: repo, encoding: 'utf8' });
const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true }); fs.writeFileSync(path.join(repo, rel), text); };
const stage = (...files) => { git('add', ...files); };
const reset = () => { git('reset', '-q'); for (const f of fs.readdirSync(path.join(repo, 'src'))) fs.unlinkSync(path.join(repo, 'src', f)); };

// Fixture: globalne hooki (core.hooksPath -> ~/.claude/git-hooks) nie maja tu nic do roboty — to repo
// tymczasowe, a testujemy bramki BEZPOSREDNIO. Pusty katalog hookow zamiast --no-verify.
const noHooks = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-nohooks-'));
git('init', '-q', '.'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't'); git('config', 'core.hooksPath', noHooks);
write('src/base.ts', 'export const base = 1;\n'); stage('src/base.ts'); git('commit', '-q', '-m', 'chore: base fixture');

let n = 0;
const it = (name, fn) => { fn(); n++; console.log('ok   ' + name); };

it('commented-code-gate BLOKUJE 3 linie kodu w komentarzu', () => {
  reset(); write('src/a.ts', 'export const x = 1;\n// const old = f(1);\n// if (old) { return old; }\n// return null;\n'); stage('src/a.ts');
  const r = run('commented-code-gate.js', '--staged'); assert.equal(r.status, 1, r.stdout);
});
it('commented-code-gate przepuszcza komentarz-opis i TODO', () => {
  reset(); write('src/a.ts', '// return early when empty\n// TODO: const x = 1;\nexport const x = 1;\n'); stage('src/a.ts');
  assert.equal(run('commented-code-gate.js', '--staged').status, 0);
});
it('commented-code-gate NIE blokuje polskiej prozy w naglowkach hookow (falszywy alarm z 2026-09-06)', () => {
  reset(); write('src/a.ts', [
    '// bash-guard: blokuje --no-verify, force-push, reset --hard, git clean -f, rm -rf poza build/cache,',
    '// sekrety w linii komend, curl|sh. Exit 2 => komenda NIE wykonuje sie, powod idzie do agenta.',
    '// `.env`, `.env.local`, `.env.production`, `.env.<x>.local` = sekrety (T3), `.env.example` = T0.',
    '// Zrodla: hono / zod / TanStack Query (audyt wzorcow A6), Google "What to look for in a review".',
    '// Parabolic interpolation for y',
    'export const x = 1;',
  ].join('\n') + '\n'); stage('src/a.ts');
  const r = run('commented-code-gate.js', '--staged'); assert.equal(r.status, 0, r.stdout);
});
it('commented-code-gate BLOKUJE zakomentowany Python (def/return/self.)', () => {
  reset(); write('src/p.py', 'x = 1\n# def old(self):\n#     self.total = 0\n#     return self.total\n'); stage('src/p.py');
  assert.equal(run('commented-code-gate.js', '--staged').status, 1);
});
it('diff-size-gate BLOKUJE 500 linii zrodlowych', () => {
  reset(); write('src/big.ts', Array.from({ length: 500 }, (_, i) => `export const v${i} = ${i};`).join('\n') + '\n'); stage('src/big.ts');
  assert.equal(run('diff-size-gate.js', '--staged', '--max', '400').status, 1);
});
it('diff-size-gate ignoruje testy, lockfile i migracje', () => {
  reset(); const big = Array.from({ length: 500 }, (_, i) => `export const v${i} = ${i};`).join('\n');
  write('src/big.test.ts', big); write('package-lock.json', '{}'); write('supabase/migrations/1.sql', big); stage('src/big.test.ts', 'package-lock.json', 'supabase/migrations/1.sql');
  assert.equal(run('diff-size-gate.js', '--staged', '--max', '400').status, 0);
});
it('dup-literals BLOKUJE literal x3 w 2 plikach', () => {
  reset(); write('src/a.ts', 'const a = "Acme Rentals Ltd.";\nconst b = "Acme Rentals Ltd.";\n'); write('src/b.ts', 'const c = "Acme Rentals Ltd.";\n'); stage('src/a.ts', 'src/b.ts');
  assert.equal(run('dup-literals.js', '--staged').status, 1);
});
it('dep-exists: czyste funkcje — nowe zaleznosci i typosquat (Damerau-1)', () => {
  const { npmDeps, pyDeps, editDistance1 } = require(path.join(BIN, 'dep-exists.js'));
  assert.deepEqual([...npmDeps('{"dependencies":{"zod":"1"},"devDependencies":{"vitest":"2"}}')].sort(), ['vitest', 'zod']);
  assert.deepEqual([...pyDeps('[project]\ndependencies = [\n  "requests>=2",\n  "pydantic[email]==2.0",\n]\n')].sort(), ['pydantic', 'requests']);
  assert.equal(editDistance1('lodahs', 'lodash'), true);
  assert.equal(editDistance1('reqests', 'requests'), true);
  assert.equal(editDistance1('vite', 'vue'), false);
});

it('base-check: inna historia = blok, za baza = ostrzezenie, strict = blok, bez origin = info', () => {
  const { verdict } = require(path.join(BIN, 'base-check.js'));
  assert.equal(verdict({ hasOrigin: true, fetchOk: true, mergeBase: null, behind: 0, dirty: 0, strict: false }).code, 1);
  assert.equal(verdict({ hasOrigin: true, fetchOk: true, mergeBase: 'abc', behind: 16, dirty: 0, strict: false }).level, 'warn');
  assert.equal(verdict({ hasOrigin: true, fetchOk: true, mergeBase: 'abc', behind: 16, dirty: 0, strict: true }).level, 'block');
  assert.equal(verdict({ hasOrigin: true, fetchOk: true, mergeBase: 'abc', behind: 0, dirty: 0, strict: true }).level, 'ok');
  assert.equal(verdict({ hasOrigin: false, fetchOk: false, mergeBase: '', behind: 0, dirty: 2, strict: true }).level, 'info');
});
it('base-check na tym repo fixture (origin brak) = info, exit 0', () => {
  assert.equal(run('base-check.js', '--repo', repo, '--quiet').status, 0);
});

fs.rmSync(repo, { recursive: true, force: true });
console.log(`TESTY: ${n} OK`);

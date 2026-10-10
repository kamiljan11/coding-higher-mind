#!/usr/bin/env node
// Testy merge-integrity.js na sztucznym repo git w %TEMP%. Uruchom: node ~/.claude/bin/test_merge_integrity.js
'use strict';
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { addedLinesByFile, lostLines, mergesExit } = require('./merge-integrity.js');

const CLI = path.join(__dirname, 'merge-integrity.js');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-integrity-'));
const ENV = Object.assign({}, process.env, {
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
});
const git = (...args) => execFileSync('git', ['-C', TMP, ...args], { env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const write = (f, s) => { fs.mkdirSync(path.dirname(path.join(TMP, f)), { recursive: true }); fs.writeFileSync(path.join(TMP, f), s); };
const commit = (msg) => { git('add', '-A'); git('commit', '-q', '--no-verify', '-m', msg); };
const cli = (...args) => spawnSync(process.execPath, [CLI, '--repo', TMP, ...args], { encoding: 'utf8' });

let n = 0;
const it = (name, fn) => { fn(); n++; console.log('ok   ' + name); };

it('addedLinesByFile / lostLines: czyste funkcje', () => {
  const d = 'diff --git a/x.css b/x.css\n--- a/x.css\n+++ b/x.css\n@@ -1,0 +2,2 @@\n+.a { }\n+}\n';
  assert.deepEqual(addedLinesByFile(d).get('x.css'), ['.a { }', '}']);
  assert.deepEqual(lostLines(['.a { }', '}', ''], '  .a { }\n'), [{ line: '}', reason: 'dodana 1x w galezi, w head 0x' }]);
  assert.equal(lostLines(['x'], null)[0].reason, 'plik nie istnieje w head');
});

// Repo: base -> galezie a (sekcja @media) i b (nowa sekcja) -> scalenie „recznie" ucina `}` z galezi a.
git('init', '-q', '-b', 'main');
write('src/app.css', '.hero { color: red; }\n');
write('src/util.ts', 'export const x = 1;\n');
commit('base');
git('branch', 'base');
git('checkout', '-q', '-b', 'a');
write('src/app.css', '.hero { color: red; }\n@media (max-width: 600px) {\n  .hero { font-size: 1rem; }\n}\n');
commit('a');
git('checkout', '-q', 'base');
git('checkout', '-q', '-b', 'b');
write('src/app.css', '.hero { color: red; }\n/* ===== cennik ===== */\n.pricing { display: grid; }\n');
write('src/util.ts', 'export const x = 1;\nexport function y() {\n  return 2;\n}\n');
commit('b');

it('dobre scalenie (wszystkie linie obu galezi, nawiasy domkniete) = exit 0', () => {
  git('checkout', '-q', '-b', 'good', 'base');
  write('src/app.css', '.hero { color: red; }\n@media (max-width: 600px) {\n  .hero { font-size: 1rem; }\n}\n/* ===== cennik ===== */\n.pricing { display: grid; }\n');
  write('src/util.ts', 'export const x = 1;\nexport function y() {\n  return 2;\n}\n');
  commit('merge good');
  const r = cli('--base', 'base', '--branches', 'a,b');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /OK/);
});

it('scalenie ours+theirs z ucietym } = exit 1: niezbilansowany CSS + zgubiona linia z galezi a', () => {
  git('checkout', '-q', '-b', 'bad', 'base');
  write('src/app.css', '.hero { color: red; }\n@media (max-width: 600px) {\n  .hero { font-size: 1rem; }\n/* ===== cennik ===== */\n.pricing { display: grid; }\n');
  write('src/util.ts', 'export const x = 1;\nexport function y() {\n  return 2;\n}\n');
  commit('merge bad');
  const r = cli('--base', 'base', '--branches', 'a,b', '--json');
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const rep = JSON.parse(r.stdout);
  assert.equal(rep.unbalanced.length, 1);
  assert.equal(rep.unbalanced[0].file, 'src/app.css');
  assert.equal(rep.unbalanced[0].line, 2);
  assert.deepEqual(rep.lost.map((l) => `${l.branch}:${l.file}:${l.line}`), ['a:src/app.css:}']);
  const txt = cli('--base', 'base', '--branches', 'a,b');
  assert.match(txt.stdout, /src\/app\.css:2:/);
  assert.match(txt.stdout, /\[a\] src\/app\.css: \}/);
});

it('zgubiona linia TS z galezi b = exit 1 (nawet gdy nawiasy sie bilansuja)', () => {
  git('checkout', '-q', '-b', 'lost', 'good');
  write('src/util.ts', 'export const x = 1;\nexport function y() {\n}\n');
  commit('lost return');
  const r = cli('--base', 'base', '--branches', 'a,b', '--json');
  assert.equal(r.status, 1);
  const rep = JSON.parse(r.stdout);
  assert.equal(rep.unbalanced.length, 0);
  assert.deepEqual(rep.lost.map((l) => l.line), ['return 2;']);
});

it('nazwy ze spacja/ogonkami i linia tresci "++ x" (w diffie "+++ x"): dobre scalenie = 0, zgubione = 1 z poprawna nazwa', () => {
  git('checkout', '-q', '-b', 'pl', 'base');
  write('src/styl ł.css', '.a { color: red; }\n');
  write('notes.md', 'x\n++ plus\n');
  commit('pl');
  git('checkout', '-q', '-b', 'pl-good', 'pl');
  assert.equal(cli('--base', 'base', '--branches', 'pl').status, 0);
  git('checkout', '-q', '-b', 'pl-bad', 'base');
  write('src/styl ł.css', '.a { color: red;\n');
  write('notes.md', 'x\n');
  commit('pl bad');
  const r = cli('--base', 'base', '--branches', 'pl', '--json');
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const rep = JSON.parse(r.stdout);
  assert.deepEqual(rep.unbalanced.map((u) => u.file), ['src/styl ł.css']);
  assert.deepEqual(rep.lost.map((l) => `${l.file}|${l.line}`).sort(), ['notes.md|++ plus', 'src/styl ł.css|.a { color: red; }']);
});

it('bledy uzycia / gita = exit 2', () => {
  assert.equal(cli('--branches', 'a').status, 2);
  assert.equal(cli('--base', 'base').status, 2);
  assert.equal(cli('--base', '--upload-pack=x', '--branches', 'a').status, 2);
  assert.equal(cli('--base', 'base', '--branches', 'nie-ma-takiej').status, 2);
});

it('mergesExit: blokuje tylko CSS nadal rozbity na wierzcholku', () => {
  assert.equal(mergesExit([]), 0);
  assert.equal(mergesExit([{ stillBroken: [] }, { stillBroken: [] }]), 0);
  assert.equal(mergesExit([{ stillBroken: [] }, { stillBroken: [{ file: 'a.css', line: 1 }] }]), 1);
  // pominiete scalenie (blad gita) = 2 (ostrzezenie + log), ale rozbity CSS gdzie indziej nadal blokuje
  assert.equal(mergesExit([{ stillBroken: [], error: true }, { stillBroken: [] }]), 2);
  assert.equal(mergesExit([{ stillBroken: [], error: true }, { stillBroken: [{ file: 'a.css', line: 1 }] }]), 1);
});

it('--merges-of: JSX z apostrofem nie jest bledem; CSS rozbity w scaleniu blokuje, poprawiony pozniej nie', () => {
  git('checkout', '-q', '-b', 'mo-base', 'base');
  write('src/ok.tsx', 'export const A = () => <p>Don\'t panic</p>;\n');
  write('src/m.css', '.a { color: red; }\n');
  commit('mo base');
  git('checkout', '-q', '-b', 'mo-x', 'mo-base');
  write('src/m.css', '.a { color: red; }\n.x { color: blue; }\n');
  commit('x');
  git('checkout', '-q', '-b', 'mo-y', 'mo-base');
  write('src/ok.tsx', 'export const A = () => <p>Don\'t panic</p>;\nexport const B = (i: number) => i++ / 2;\n');
  commit('y');
  git('merge', '-q', '--no-edit', '--no-verify', 'mo-x');
  const good = cli('--merges-of', 'HEAD');
  assert.equal(good.status, 0, good.stdout + good.stderr);
  // scalenie, ktore ucina '}' (jak 2026-10-06), a potem poprawka
  git('checkout', '-q', '-b', 'mo-bad', 'mo-y^1');
  git('merge', '-q', '--no-commit', '--no-verify', 'mo-x');
  write('src/m.css', '.a { color: red;\n.x { color: blue; }\n');
  commit('merge ucina klamre');
  const bad = cli('--merges-of', 'HEAD');
  assert.equal(bad.status, 1, bad.stdout + bad.stderr);
  write('src/m.css', '.a { color: red; }\n.x { color: blue; }\n');
  commit('poprawka');
  const fixed = cli('--merges-of', 'HEAD');
  assert.equal(fixed.status, 0, fixed.stdout + fixed.stderr);
});

it('git-hooks/pre-push: rozbity CSS w scaleniu blokuje push, ALLOW_MERGE_INTEGRITY=1 przepuszcza, poprawka zdejmuje blokade', () => {
  const hook = path.join(__dirname, '..', 'git-hooks', 'pre-push');
  const push = (extraEnv) => {
    const sha = git('rev-parse', 'HEAD').trim();
    const env = Object.assign({}, ENV, { PG_GATE_LOG: path.join(TMP, 'gates.jsonl') }, extraEnv);
    return spawnSync('sh', [hook, 'origin', 'https://example.invalid/x.git'], { cwd: TMP, env, encoding: 'utf8', input: `refs/heads/feat ${sha} refs/heads/feat 0000000000000000000000000000000000000000\n` });
  };
  git('checkout', '-q', '-b', 'pp-bad', 'mo-y^1');
  git('merge', '-q', '--no-commit', '--no-verify', 'mo-x');
  write('src/m.css', '.a { color: red;\n.x { color: blue; }\n');
  commit('merge ucina klamre (pre-push)');
  const blocked = push({});
  assert.equal(blocked.status, 1, blocked.stdout + blocked.stderr);
  assert.match(blocked.stderr, /merge-integrity/);
  assert.equal(push({ ALLOW_MERGE_INTEGRITY: '1' }).status, 0);
  write('src/m.css', '.a { color: red; }\n.x { color: blue; }\n');
  commit('poprawka (pre-push)');
  const ok = push({});
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  // exit 2 (blad narzedzia: nieistniejacy commit) = ostrzezenie, push idzie dalej, wpis `skipped` w logu bramek
  const env = Object.assign({}, ENV, { PG_GATE_LOG: path.join(TMP, 'gates.jsonl') });
  const bogus = spawnSync('sh', [hook, 'origin', 'https://example.invalid/x.git'], { cwd: TMP, env, encoding: 'utf8', input: 'refs/heads/feat 1111111111111111111111111111111111111111 refs/heads/feat 0000000000000000000000000000000000000000\n' });
  assert.equal(bogus.status, 0, bogus.stdout + bogus.stderr);
  assert.match(bogus.stderr, /nie udalo sie sprawdzic scalen/);
  assert.match(fs.readFileSync(path.join(TMP, 'gates.jsonl'), 'utf8'), /merge-integrity: blad narzedzia/);
});

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n${n} testow OK`);

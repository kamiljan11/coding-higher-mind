#!/usr/bin/env node
// Testy css-balance.js + integracji w lint-file.js (CSS po edycji). Uruchom: node ~/.claude/bin/test_css_balance.js
'use strict';
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Log bramek do %TEMP% — testy nie pisza do produkcyjnego gates.jsonl.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'css-balance-'));
process.env.PG_GATE_LOG = path.join(TMP, 'gates.jsonl');
const LIB = path.join(__dirname, '..', 'hooks', 'lib');
const { checkBalance, checkFile, kindOf } = require(path.join(LIB, 'css-balance.js'));
const { lintFiles, isCssFile } = require(path.join(LIB, 'lint-file.js'));

let n = 0;
const it = (name, fn) => { fn(); n++; console.log('ok   ' + name); };

// Przypadek z 2026-10-06: niedomkniety @media przed kolejna sekcja — build, tsc, vitest i qa-matrix byly zielone.
const TODAY = [
  '.hero { color: red; }',
  '@media (max-width: 600px) {',
  '  .hero { font-size: 1rem; }',
  '',
  '/* ===== Sekcja: cennik ===== */',
  '.pricing { display: grid; }',
  '',
].join('\n');

it('niedomkniety @media = blad z linia otwarcia i podejrzana linia nowej sekcji', () => {
  const err = checkBalance(TODAY, 'css');
  assert.ok(err);
  assert.equal(err.line, 2);
  assert.match(err.message, /linii 2/);
  assert.match(err.message, /linia 5 zaczyna nowa sekcje/);
});

it('zbilansowany CSS z nawiasami w komentarzach i stringach = OK', () => {
  const css = '/* { nie liczy sie */\n.a::before { content: "{"; }\n.b { background: url(\'x{.png\'); }\n@media (min-width: 1px) {\n  .c { color: red; }\n}\n';
  assert.equal(checkBalance(css, 'css'), null);
});

it('nadmiarowe } = blad z linia zamkniecia', () => {
  const err = checkBalance('.a { }\n}\n', 'css');
  assert.equal(err.line, 2);
  assert.match(err.message, /nadmiarowe/);
});

it('scss: // komentarz pomijany, url(http://...) nie jest komentarzem', () => {
  assert.equal(checkBalance('// {\n.a { b: url(http://x.is/a.png); }\n', 'scss'), null);
  assert.ok(checkBalance('.a { b: url(http://x.is/{.png);\n', 'scss'));
});

it('js/tsx: regex, template literal, JSX zamkniecie i apostrof w tekscie nie psuja bilansu', () => {
  const ts = [
    'const re = /[{(]/g;',
    'const t = `a ${fn({ x: 1 })} b`;',
    'export const C = () => (<p>{name}</p>);',
    'const D = () => (<div>{x ? <A t={y} /> : null}</div>);',
    'const E = () => (<span>(od https://)</span>);',
    "const s = 'x}';",
    'const d = a / b / c;',
    'const o = xs.find((a) => /^of=/.test(a)); if (o) out.push(o.slice(3));',
  ].join('\n');
  assert.equal(checkBalance(ts, 'js'), null);
  const bad = checkBalance('function f() {\n  if (x) {\n    y();\n}\n', 'js');
  assert.equal(bad.line, 1);
});

it('niepasujace zamkniecie: ( zamkniete przez }', () => {
  const err = checkBalance('f(a, {b: 1);\n', 'js');
  assert.ok(err);
  assert.match(err.message, /zamkniete przez/);
});

it('kindOf / checkFile: rozszerzenia', () => {
  assert.equal(kindOf('a.CSS'), 'css');
  assert.equal(kindOf('a.tsx'), 'js');
  assert.equal(kindOf('a.json'), 'json');
  assert.equal(kindOf('a.md'), null);
  assert.equal(checkFile('a.md', '{'), null);
  assert.ok(checkFile('a.json', '{"a": [1, 2}'));
});

it('css: escape w selektorze (Tailwind \\[ \\{ \\\'), url(//cdn) w scss, JSONC z komentarzem = bez falszywego alarmu', () => {
  assert.equal(checkBalance(".before\\:content-\\[\\'\\'\\]::before { content: ''; }\n.x\\{ { color: red; }\n.w-\\[2px\\] { width: 2px; }\n", 'css'), null);
  assert.equal(checkBalance('.a { background: url(//cdn.x/y.png); }\n', 'scss'), null);
  assert.equal(checkBalance('{\n  // patrz (docs\n  /* "x": [ */\n  "a": 1\n}\n', 'json'), null);
});

it('niedomkniety komentarz /* (uciete */ przy scalaniu) = blad z linia otwarcia', () => {
  const err = checkBalance('.a { color: red; }\n/* sekcja\n.b { color: blue; }\n', 'css');
  assert.ok(err);
  assert.equal(err.line, 2);
  assert.match(err.message, /komentarz/);
});

it('lint-file: edycja .css z niedomknietym @media blokuje z numerem linii; poprawny przechodzi', () => {
  const bad = path.join(TMP, 'globals.css');
  fs.writeFileSync(bad, TODAY);
  const res = lintFiles([bad], { hook: 'test-css' });
  assert.ok(res && res.blocked);
  assert.match(res.header, /CSS niezbilansowany/);
  assert.match(res.out, /globals\.css:2:/);
  const good = path.join(TMP, 'ok.scss');
  fs.writeFileSync(good, '.a {\n  .b { c: d; }\n}\n');
  assert.equal(lintFiles([good], { hook: 'test-css' }), null);
  assert.ok(isCssFile(good) && isCssFile(bad) && !isCssFile('x.ts'));
});

it('post-bash-edit-check: CSS zmieniony przez Bash (sed -i / merge) tez blokuje z plik:linia', () => {
  const { execFileSync, spawnSync } = require('child_process');
  const repo = path.join(TMP, 'repo');
  fs.mkdirSync(repo);
  execFileSync('git', ['-C', repo, 'init', '-q'], { env: Object.assign({}, process.env, { GIT_CONFIG_GLOBAL: '/dev/null' }) });
  fs.writeFileSync(path.join(repo, 'globals.css'), TODAY);
  const hook = path.join(__dirname, '..', 'hooks', 'post-bash-edit-check.js');
  const run = () => spawnSync(process.execPath, [hook], { encoding: 'utf8', env: process.env,
    input: JSON.stringify({ tool_name: 'Bash', cwd: repo, tool_input: { command: "sed -i 's/red/blue/' globals.css" } }) });
  const r = run();
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /CSS niezbilansowany/);
  assert.match(r.stderr, /globals\.css:2:/);
  fs.writeFileSync(path.join(repo, 'globals.css'), TODAY + '}\n');
  assert.equal(run().status, 0);
});

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n${n} testow OK`);

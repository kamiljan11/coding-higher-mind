#!/usr/bin/env node
// Testy dup-literals.js — czyste funkcje, bez gita. Uruchom: node ~/.claude/bin/test_dup_literals.js
'use strict';
const assert = require('node:assert/strict');
const { addedLines, collectLiterals, offenders } = require('./dup-literals.js');

function diff(files) {
  // files: { 'src/a.ts': ['linia1', 'linia2'] } -> minimalny unified diff z samymi dodanymi liniami
  return Object.entries(files).map(([f, lines]) =>
    `diff --git a/${f} b/${f}\n--- /dev/null\n+++ b/${f}\n@@ -0,0 +1,${lines.length} @@\n` + lines.map((l) => '+' + l).join('\n'),
  ).join('\n');
}
const run = (files, opts = {}) => offenders(collectLiterals(addedLines(diff(files)), opts.minLen ?? 12), opts.maxCopies ?? 3);
const LIT = '"Acme Rentals Ltd."';
let n = 0;
const it = (name, fn) => { fn(); n++; console.log('ok   ' + name); };

it('3 kopie w 2 plikach = blokada (blizna: 45 kopii tozsamosci firmy)', () => {
  const out = run({ 'src/a.ts': [`const x = ${LIT};`, `const y = ${LIT};`], 'src/b.tsx': [`<h1>{${LIT}}</h1>`] });
  assert.equal(out.length, 1);
  assert.equal(out[0].count, 3);
  assert.equal(out[0].files, 2);
});

it('3 kopie w JEDNYM pliku = nie blokuje (tablica danych to nie slop)', () => {
  assert.deepEqual(run({ 'src/seed.ts': [`${LIT},`, `${LIT},`, `${LIT},`] }), []);
});

it('2 kopie = ponizej progu', () => {
  assert.deepEqual(run({ 'src/a.ts': [`x(${LIT})`], 'src/b.ts': [`y(${LIT})`] }), []);
});

it('testy, i18n, seed.sql, json i markdown sa ignorowane', () => {
  const files = {
    'src/a.test.ts': [`expect(${LIT})`], 'src/i18n/pl.ts': [`t: ${LIT}`], 'supabase/seed.sql': [`insert ('Acme Rentals Ltd.')`],
    'docs/x.md': [`# Acme Rentals Ltd.`], 'src/b.ts': [`const z = ${LIT};`],
  };
  assert.deepEqual(run(files), []);
});

it('sciezki importow, URL-e i dyrektywy nie licza sie jako literal', () => {
  const files = {
    'src/a.ts': [`import { x } from "@/components/ui/button";`, `"use client";`, `fetch("https://example.is/api/v1")`],
    'src/b.ts': [`import { y } from "@/components/ui/button";`, `"use client";`, `fetch("https://example.is/api/v1")`],
    'src/c.ts': [`import { z } from "@/components/ui/button";`, `"use client";`, `fetch("https://example.is/api/v1")`],
  };
  assert.deepEqual(run(files), []);
});

it('krotkie literaly ponizej min-len sa pomijane', () => {
  assert.deepEqual(run({ 'src/a.ts': ['"ok"', '"ok"'], 'src/b.ts': ['"ok"'] }), []);
});

it('linie usuniete i komentarze nie wchodza do skanu', () => {
  const d = `diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,2 +1,2 @@\n-const a = ${LIT};\n+// ${LIT} w komentarzu\n+const b = 1;\n`;
  const rows = addedLines(d);
  assert.equal(rows.length, 2);
  assert.deepEqual(offenders(collectLiterals(rows, 12), 1), []);
});

it('numery linii z hunka sa poprawne', () => {
  const d = `diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -10,0 +11,2 @@\n+const a = ${LIT};\n+const b = ${LIT};\n`;
  const rows = addedLines(d);
  assert.deepEqual(rows.map((r) => r.line), [11, 12]);
});

it('pliki test_*.js|py i katalog tests/ sa ignorowane (konwencja ~/.claude i Pythona)', () => {
  assert.deepEqual(run({ 'bin/test_x.js': [`a(${LIT})`, `b(${LIT})`], 'tests/y.py': [`c(${LIT})`], 'src/z.ts': [`d(${LIT})`] }), []);
});

it('nazwa pliku jako literal (odwolanie do narzedzia) nie jest duplikatem', () => {
  const files = { 'hooks/a.js': ['run("phase-gate.js")', 'run("phase-gate.js")'], 'hooks/b.py': ['check("phase-gate.js")', 'check("RUNBOOK.md")', 'x("RUNBOOK.md")'], 'hooks/c.js': ['y("RUNBOOK.md")'] };
  assert.deepEqual(run(files), []);
});

it('specyfikator modulu w require/import nie jest duplikatem', () => {
  const files = { 'bin/a.js': ["const { execFileSync } = require('child_process');"], 'bin/b.js': ["const cp = require('child_process');"], 'bin/c.js': ["const x = require('child_process');"], 'bin/d.mjs': ["import { spawn } from 'child_process';"] };
  assert.deepEqual(run(files), []);
});

it('klucz konfiguracji (core.hooksPath) i znany katalog (node_modules) nie sa duplikatami — samodzielne skrypty instalatora', () => {
  const files = { 'a.mjs': ['git("core.hooksPath")', 'x("node_modules")'], 'b.mjs': ['cfg("core.hooksPath")', 'y("node_modules")'], 'c.js': ['z("core.hooksPath")', 'w("node_modules")'] };
  assert.deepEqual(run(files), []);
});

it('tozsamosc firmy w plikach kodu nadal blokuje po wyjatkach (regresja)', () => {
  const out = run({ 'hooks/a.js': [`const x = ${LIT};`, `run("phase-gate.js")`], 'hooks/b.js': [`const y = ${LIT};`], 'hooks/c.js': [`const z = ${LIT};`] });
  assert.equal(out.length, 1);
  assert.equal(out[0].literal, 'Acme Rentals Ltd.');
});

console.log(`TESTY: ${n} OK`);

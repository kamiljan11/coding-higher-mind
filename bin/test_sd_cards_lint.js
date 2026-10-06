#!/usr/bin/env node
// Testy sd-cards-lint.js: czyste funkcje (parser kart, kolejnosc sekcji, odsylacze) + pelny przebieg na fikstorze i na realnym katalogu sd.
// Uruchom: node ~/.claude/bin/test_sd_cards_lint.js
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const L = require('./sd-cards-lint.js');

let n = 0;
const it = (name, fn) => { fn(); n++; console.log('ok   ' + name); };

const card = (title, opts = {}) => [
  `### ${title}`, '',
  '**Problem.** p.', '',
  '**Domyślnie u nas.** d.',
  '| Wariant | Koszt operacyjny | Finansowy | Poznawczy |', '|---|---|---|---|', '| a | b | c | d |', '',
  ...(opts.noAwarie ? [] : ['**Awarie i detekcja.**', '- *x* — `rg -n x src`', '']),
  '**Audyt „czy się trzymamy".**', '1. ok', '',
  opts.newNpj ? '**Nie potrzebujesz jeszcze** (wariant → sygnał powrotu):' : '**Nie potrzebujesz jeszcze.** nic.', '',
  '---', '',
].join('\n');

it('parseCards: naglowki ### dziela plik na karty z numerem linii', () => {
  const cards = L.parseCards('# Plik\n\n' + card('Alfa') + card('Beta'));
  assert.deepEqual(cards.map((c) => c.title), ['Alfa', 'Beta']);
  assert.equal(cards[0].line, 3);
});

it('parseCards: naglowek ### w bloku ``` nie tworzy karty', () => {
  const md = card('Alfa').replace('**Problem.** p.', '**Problem.** p.\n```md\n### Przyklad naglowka\n```');
  const cards = L.parseCards(md);
  assert.deepEqual(cards.map((c) => c.title), ['Alfa']);
  assert.deepEqual(L.checkCardSections(cards[0]), []);
});

it('checkCardSections: komplet = OK, oba warianty "Nie potrzebujesz jeszcze"', () => {
  assert.deepEqual(L.checkCardSections(L.parseCards(card('A'))[0]), []);
  assert.deepEqual(L.checkCardSections(L.parseCards(card('A', { newNpj: true }))[0]), []);
});

it('checkCardSections: brak sekcji i zla kolejnosc wykryte', () => {
  assert.deepEqual(L.checkCardSections(L.parseCards(card('A', { noAwarie: true }))[0]), ['brak sekcji "Awarie i detekcja"']);
  const swapped = card('B').replace('**Problem.** p.', 'tmp').replace('**Audyt „czy się trzymamy".**', '**Problem.** p.').replace('tmp', '**Audyt „czy się trzymamy".**');
  const errs = L.checkCardSections(L.parseCards(swapped)[0]);
  assert.ok(errs.some((e) => /poza kolejnoscia/.test(e)), errs.join(';'));
});

it('extractRefs + resolveRef: prefiks tytulu, przecinek konczy nazwe, tabela | konczy nazwe', () => {
  const refs = L.extractRefs('→ 02 › Model danych, 05 › Kopie zapasowe\n| x | `07 › Koszt, uzależnienie od dostawcy i region` |');
  assert.deepEqual(refs.map((r) => `${r.num}:${r.name}`), ['02:Model danych', '05:Kopie zapasowe', '07:Koszt']);
  const by = { '02': ['Model danych, constrainty i migracje'], '05': ['Kopie zapasowe i odtwarzanie'], '07': ['Koszt, uzależnienie od dostawcy i region'] };
  assert.ok(refs.every((r) => L.resolveRef(r, by)));
  assert.equal(L.resolveRef({ num: '05', name: 'Nieistniejąca' }, by), false);
  assert.equal(L.resolveRef({ num: '09', name: 'Model danych' }, by), false);
});

it('lint: fikstura — zly odsylacz, karta bez indeksu i brak sekcji daja 3 bledy; poprawiona = OK', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-lint-'));
  try {
    fs.writeFileSync(path.join(dir, '01-a.md'), '# 01\n\n' + card('Alfa karta') + card('Beta karta', { noAwarie: true }));
    fs.writeFileSync(path.join(dir, 'README.md'), '# sd\n\n## Indeks po problemach\n| P | K |\n|---|---|\n| a | `01 › Alfa karta` |\n| z | `01 › Gamma` |\n\n## Inne\n');
    let r = L.lint(dir);
    assert.equal(r.ok, false);
    assert.equal(r.errors.length, 3, r.errors.join('\n'));
    assert.ok(r.errors.some((e) => /Beta karta.*Awarie/.test(e)));
    assert.ok(r.errors.some((e) => /01 › Gamma/.test(e)));
    assert.ok(r.errors.some((e) => /Beta karta" nie ma wiersza/.test(e)));
    fs.writeFileSync(path.join(dir, '01-a.md'), '# 01\n\n' + card('Alfa karta') + card('Beta karta'));
    fs.writeFileSync(path.join(dir, 'README.md'), '# sd\n\n## Indeks po problemach\n| a | `01 › Alfa karta`, `01 › Beta` |\n');
    r = L.lint(dir);
    assert.equal(r.ok, true, r.errors.join('\n'));
    assert.equal(r.cards, 2);
    // CLI: exit 1 przy bledach, 2 przy zlym uzyciu
    fs.writeFileSync(path.join(dir, 'review-checklists.md'), '1. punkt → 01 › Delta\n');
    let code = 0;
    try { execFileSync(process.execPath, [path.join(__dirname, 'sd-cards-lint.js'), '--dir', dir], { stdio: 'pipe' }); } catch (e) { code = e.status; }
    assert.equal(code, 1);
    code = 0;
    try { execFileSync(process.execPath, [path.join(__dirname, 'sd-cards-lint.js'), '--dir'], { stdio: 'pipe' }); } catch (e) { code = e.status; }
    assert.equal(code, 2);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

it('lint: realny katalog sd przechodzi (format kart, odsylacze, indeks README)', () => {
  const dir = path.join(__dirname, '..', 'skills', 'architecture-advisor', 'references', 'sd');
  if (!fs.existsSync(dir)) { console.log('     (pominiete: brak katalogu sd)'); return; }
  const r = L.lint(dir);
  assert.equal(r.ok, true, r.errors.join('\n'));
  assert.ok(r.cards >= 40);
});

console.log(`\n${n} testow OK`);

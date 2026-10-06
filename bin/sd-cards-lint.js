#!/usr/bin/env node
// sd-cards-lint: pilnuje formatu kart system design (skills/architecture-advisor/references/sd).
// Sprawdza: (1) kazda karta `### ` w 0N-*.md ma 6 sekcji w stalej kolejnosci;
// (2) kazdy odsylacz `NN › Karta` (README, review-checklists, karty) wskazuje istniejaca karte;
// (3) kazda karta jest w indeksie README (tabela "Indeks po problemach").
// Uzycie: node sd-cards-lint.js [--dir <katalog sd>] [--json]   exit 0 = OK, 1 = bledy, 2 = zle uzycie.
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const SECTIONS = [
  ['Problem', /^\*\*Problem\.\*\*/],
  ['Domyślnie u nas', /^\*\*Domyślnie u nas/],
  ['Warianty (tabela)', /^\| Wariant \|/],
  ['Awarie i detekcja', /^\*\*Awarie i detekcja\.\*\*/],
  ['Audyt', /^\*\*Audyt „czy się trzymamy"\.\*\*/],
  // dwa warianty: "**Nie potrzebujesz jeszcze.** ..." albo "**Nie potrzebujesz jeszcze** (wariant → sygnał powrotu):"
  ['Nie potrzebujesz jeszcze', /^\*\*Nie potrzebujesz jeszcze(\.\*\*|\*\*)/],
];
const REF_RE = /\b(0[1-9]) › ([^,`\n;()|]+)/g;

function parseCards(text) {
  // Zwraca [{title, line, body:[linie]}] dla naglowkow `### `.
  const lines = text.split('\n');
  const cards = [];
  let cur = null;
  let inFence = false; // `### ` w bloku ``` (np. przyklad markdown) nie jest karta
  lines.forEach((l, i) => {
    if (/^\s*```/.test(l)) inFence = !inFence;
    const m = inFence ? null : /^### (.+?)\s*$/.exec(l);
    if (m) { cur = { title: m[1], line: i + 1, body: [] }; cards.push(cur); return; }
    if (cur) cur.body.push(l);
  });
  return cards;
}

function checkCardSections(card) {
  // Zwraca liste brakow/zlej kolejnosci; pusta = OK.
  const errs = [];
  let last = -1;
  for (const [name, re] of SECTIONS) {
    const idx = card.body.findIndex((l) => re.test(l));
    if (idx < 0) { errs.push(`brak sekcji "${name}"`); continue; }
    if (idx < last) errs.push(`sekcja "${name}" poza kolejnoscia`);
    last = Math.max(last, idx);
  }
  return errs;
}

function extractRefs(text) {
  const out = [];
  text.split('\n').forEach((l, i) => {
    for (const m of l.matchAll(REF_RE)) {
      const name = m[2].trim().replace(/[.:»"”]+$/, '').trim();
      if (name) out.push({ num: m[1], name, line: i + 1 });
    }
  });
  return out;
}

function resolveRef(ref, cardsByNum) {
  const titles = cardsByNum[ref.num] || [];
  return titles.some((t) => t.startsWith(ref.name) || ref.name.startsWith(t));
}

function lint(dir) {
  const errors = [];
  const files = fs.readdirSync(dir).filter((f) => /^0[1-9]-.*\.md$/.test(f)).sort();
  const cardsByNum = {};
  for (const f of files) {
    const cards = parseCards(fs.readFileSync(path.join(dir, f), 'utf8'));
    cardsByNum[f.slice(0, 2)] = cards.map((c) => c.title);
    for (const c of cards) for (const e of checkCardSections(c)) errors.push(`${f}:${c.line} [${c.title}] ${e}`);
  }
  const refFiles = files.concat(['README.md', 'review-checklists.md', 'capacity.md'].filter((f) => fs.existsSync(path.join(dir, f))));
  for (const f of refFiles) {
    for (const r of extractRefs(fs.readFileSync(path.join(dir, f), 'utf8'))) {
      if (!resolveRef(r, cardsByNum)) errors.push(`${f}:${r.line} odsylacz "${r.num} › ${r.name}" nie wskazuje istniejacej karty`);
    }
  }
  const readme = path.join(dir, 'README.md');
  if (fs.existsSync(readme)) {
    const txt = fs.readFileSync(readme, 'utf8');
    const start = txt.indexOf('## Indeks po problemach');
    const end = start < 0 ? -1 : txt.indexOf('\n## ', start + 5);
    const idx = start < 0 ? '' : txt.slice(start, end < 0 ? undefined : end);
    if (start < 0) errors.push('README.md: brak sekcji "## Indeks po problemach"');
    const indexed = extractRefs(idx);
    for (const [num, titles] of Object.entries(cardsByNum)) {
      for (const t of titles) {
        if (!indexed.some((r) => r.num === num && (t.startsWith(r.name) || r.name.startsWith(t)))) {
          errors.push(`README.md: karta "${num} › ${t}" nie ma wiersza w indeksie po problemach`);
        }
      }
    }
  }
  const count = Object.values(cardsByNum).reduce((s, a) => s + a.length, 0);
  return { ok: errors.length === 0, cards: count, errors };
}

function main(argv) {
  const di = argv.indexOf('--dir');
  if (di >= 0 && !argv[di + 1]) { console.error('uzycie: sd-cards-lint.js [--dir <katalog>] [--json]'); return 2; }
  const dir = di >= 0 ? argv[di + 1] : path.join(__dirname, '..', 'skills', 'architecture-advisor', 'references', 'sd');
  if (!fs.existsSync(dir)) { console.error(`brak katalogu: ${dir}`); return 2; }
  const res = lint(dir);
  if (argv.includes('--json')) console.log(JSON.stringify(res, null, 2));
  else {
    for (const e of res.errors) console.log('BLAD ' + e);
    console.log(`${res.ok ? 'OK' : 'FAIL'}: ${res.cards} kart, ${res.errors.length} bledow`);
  }
  return res.ok ? 0 : 1;
}

module.exports = { parseCards, checkCardSections, extractRefs, resolveRef, lint, SECTIONS };
if (require.main === module) process.exit(main(process.argv.slice(2)));

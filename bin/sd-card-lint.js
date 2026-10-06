#!/usr/bin/env node
// sd-card-lint.js — bramka 0-tokenowa dla kart system design (skills/architecture-advisor/references/sd/0*.md).
// Sprawdza format karty (Problem -> Domyslnie -> tabela Wariant -> Awarie -> Audyt -> Nie potrzebujesz jeszcze),
// komende przy kazdym pytaniu audytu, domkniete bloki ```, komendy `rg -n | rg [0-9]` oraz (z --signals) sygnal powrotu przy kazdym
// wariancie z "Nie potrzebujesz jeszcze" (lista "- wariant -> sygnal").
// Uzycie: node ~/.claude/bin/sd-card-lint.js [--signals] [--json] [plik.md ...]   (bez plikow: wszystkie 0*.md)
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const SD_DIR = path.join(__dirname, '..', 'skills', 'architecture-advisor', 'references', 'sd');
const ARROW = '→';
// kolejnosc sekcji karty (README.md "Format karty")
const ORDER = [
  ['problem', /^\*\*Problem\.\*\*/m],
  ['domyslnie', /^\*\*Domyślnie u nas\.\*\*/m],
  ['tabela-wariantow', /^\| *Wariant *\|/m],
  ['awarie', /^\*\*Awarie i detekcja\.\*\*/m],
  ['audyt', /^\*\*Audyt „czy się trzymamy"\.\*\*/m],
  ['nie-potrzebujesz', /^\*\*Nie potrzebujesz jeszcze/m],
];
const NPJ_LIST = '**Nie potrzebujesz jeszcze** (wariant → sygnał powrotu):';

function splitCards(md) {
  const lines = md.split('\n');
  const cards = [];
  let cur = null;
  let inFence = false;
  lines.forEach((l, i) => {
    if (/^```/.test(l)) inFence = !inFence;
    if (!inFence && /^### /.test(l)) {
      cur = { title: l.slice(4).trim(), line: i + 1, body: [] };
      cards.push(cur);
    } else if (cur) cur.body.push(l);
  });
  return cards.map((c) => ({ ...c, body: c.body.join('\n') }));
}

// tekst karty bez blokow kodu (zeby SQL w ``` nie udawal naglowka)
function stripFences(text) {
  return text.replace(/^```[\s\S]*?^```/gm, '');
}

function checkFormat(card) {
  const errs = [];
  const body = stripFences(card.body);
  let last = -1;
  let lastName = '';
  for (const [name, re] of ORDER) {
    const m = re.exec(body);
    if (!m) { errs.push(`brak sekcji: ${name}`); continue; }
    if (m.index < last) errs.push(`zla kolejnosc: ${name} przed ${lastName}`);
    last = m.index; lastName = name;
  }
  return errs;
}

function sectionAfter(body, re, stopRe) {
  const m = re.exec(body);
  if (!m) return '';
  const rest = body.slice(m.index + m[0].length);
  const s = stopRe ? rest.search(stopRe) : -1;
  return s >= 0 ? rest.slice(0, s) : rest;
}

function checkAudit(card) {
  const body = stripFences(card.body);
  const sec = sectionAfter(body, ORDER[4][1], /^\*\*Nie potrzebujesz/m);
  const items = sec.split('\n').filter((l) => /^\d+\. /.test(l));
  const errs = [];
  if (sec && items.length === 0) errs.push('audyt bez numerowanych pytan');
  for (const it of items) if (!it.includes(ARROW)) errs.push(`pytanie audytu bez komendy (${ARROW}): ${it.slice(0, 60)}`);
  return errs;
}

function checkSignals(card) {
  const body = stripFences(card.body);
  const idx = body.indexOf(NPJ_LIST);
  if (idx < 0) return ['"Nie potrzebujesz jeszcze" bez listy "wariant → sygnał powrotu"'];
  const after = body.slice(idx + NPJ_LIST.length).split('\n').slice(1);
  const items = [];
  for (const l of after) { if (/^- /.test(l)) items.push(l); else if (l.trim() === '' || /^---/.test(l)) break; }
  const errs = [];
  if (items.length === 0) errs.push('pusta lista "Nie potrzebujesz jeszcze"');
  for (const it of items) {
    const k = it.indexOf(ARROW);
    if (k < 0 || it.slice(k + 1).trim().length < 8) errs.push(`wariant bez sygnalu powrotu: ${it.slice(0, 60)}`);
  }
  return errs;
}

function checkFences(md) {
  const n = md.split('\n').filter((l) => /^```/.test(l)).length;
  return n % 2 === 0 ? [] : [`niedomkniety blok \`\`\` (liczba ogrodzen: ${n})`];
}

// komendy w kartach: `rg -n`/`grep -n` przepuszczone przez filtr cyfr — numer linii (cyfra) psuje filtr
// (blizna 2026-10-06: `rg -n -i "RPO|RTO" RUNBOOK | rg -v "[0-9]"` nigdy niczego nie zglaszal)
// potok dzielimy po " | " (ze spacjami), bo "a|b" w cudzyslowie to alternatywa regexu, nie potok
const HAS_LINE_NO = /^\s*(rg|grep)\b.*\s(-[A-Za-z]*n[A-Za-z]*|--line-number)\b/;
const DIGIT_FILTER = /^\s*(rg|grep)\b.*(\[0-9\]|\\d)/;
function checkCommands(md) {
  const errs = [];
  md.split('\n').forEach((l, i) => {
    for (const span of l.match(/`[^`]+`/g) || []) {
      const segs = span.slice(1, -1).split(/\s\|\s/);
      for (let k = 0; k + 1 < segs.length; k++) {
        if (HAS_LINE_NO.test(segs[k]) && DIGIT_FILTER.test(segs[k + 1])) {
          errs.push({ line: i + 1, error: `komenda z -n przed filtrem cyfr (numer linii psuje filtr): ${span.slice(0, 60)}` });
          break;
        }
      }
    }
  });
  return errs;
}

function lintText(md, opts = {}) {
  const out = [];
  for (const e of checkFences(md)) out.push({ card: '(plik)', line: 0, error: e });
  for (const e of checkCommands(md)) out.push({ card: '(komenda)', ...e });
  const cards = splitCards(md);
  if (cards.length === 0) out.push({ card: '(plik)', line: 0, error: 'brak kart (### )' });
  for (const c of cards) {
    const errs = [...checkFormat(c), ...checkAudit(c), ...(opts.signals ? checkSignals(c) : [])];
    for (const e of errs) out.push({ card: c.title, line: c.line, error: e });
  }
  return out;
}

function main(argv) {
  const signals = argv.includes('--signals');
  const json = argv.includes('--json');
  let files = argv.filter((a) => !a.startsWith('--'));
  if (files.length === 0) files = fs.readdirSync(SD_DIR).filter((f) => /^0\d-.*\.md$/.test(f)).sort().map((f) => path.join(SD_DIR, f));
  const report = [];
  for (const f of files) for (const r of lintText(fs.readFileSync(f, 'utf8'), { signals })) report.push({ file: path.basename(f), ...r });
  if (json) process.stdout.write(JSON.stringify({ ok: report.length === 0, files: files.length, errors: report }, null, 2) + '\n');
  else if (report.length === 0) console.log(`sd-card-lint: OK (${files.length} plikow${signals ? ', z sygnalami' : ''})`);
  else for (const r of report) console.log(`${r.file}:${r.line} [${r.card}] ${r.error}`);
  return report.length === 0 ? 0 : 1;
}

module.exports = { splitCards, checkFormat, checkAudit, checkSignals, checkFences, checkCommands, lintText, SD_DIR };
if (require.main === module) process.exitCode = main(process.argv.slice(2));

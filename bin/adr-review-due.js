#!/usr/bin/env node
// adr-review-due — ADR, ktorych petla decyzji sie nie zamknela (OODA Act -> Observe; kolejka 2026-11-02, propozycja P1).
// Szuka w <repo>/docs/adr/*.md i <repo>/pg/adr/*.md:
//   overdue  = data przegladu (pole `Przeglad: RRRR-MM-DD` w naglowku albo linia z „przeglad” i data) minela,
//              a status nie jest koncowy (odrzucone / przestarzale / zastapione);
//   proposed = status „proponowane” dluzej niz PROPOSED_DAYS od pierwszego commitu pliku (decyzja wdrozona bez zmiany statusu).
// Observe: nic nie blokuje; konsumenci: hooks/session-context.js (1 linia dla repo sesji), hooks/guard_health.py (WARN dla ~/.claude).
// Uzycie: node adr-review-due.js --repo <sciezka> [--json] [--today RRRR-MM-DD]. Exit 0 = brak, 1 = sa pozycje, 2 = blad narzedzia.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ADR_DIRS = ['docs/adr', 'pg/adr'];
const PROPOSED_DAYS = 14;
const HEADER_LINES = 6;
const DAY_MS = 24 * 60 * 60 * 1000;

const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/Ł/g, 'L').toLowerCase();

// -> { status, review } z tresci ADR; review = najwczesniejsza data przegladu (naglowek albo linia z „przeglad”).
function parseAdr(text) {
  const lines = text.split('\n');
  const header = fold(lines.slice(0, HEADER_LINES).join('\n'));
  const st = header.match(/status:\s*([^|\n(]+)/);
  const dates = [];
  for (const line of lines) {
    const f = fold(line);
    // tylko rzeczownik „przeglad” (nie „przegladu floty”) i data do 40 znakow dalej: `Przeglad: X`, `Przeglad razem z ADR-0007: X`, `(przeglad X)`
    for (const m of f.matchAll(/\bprzeglad\b[^|\n]{0,40}?(\d{4}-\d{2}-\d{2})/g)) dates.push(m[1]);
  }
  return { status: st ? st[1].trim() : '', review: dates.sort()[0] || null };
}

// „zastapione czesciowo” = reszta decyzji obowiazuje, wiec przeglad dalej sie liczy (A29 code-1).
const isFinal = (status) => /^(odrzucon|przestarzal)/.test(status) || (/^zastapion/.test(status) && !/czesciow/.test(status));
// Nazwa pliku z obcego repo trafia do kontekstu modelu (session-context): tylko bezpieczne znaki (A29 security-1).
const safeName = (file) => path.basename(file).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80);

function firstCommitDay(repo, rel) {
  try {
    const out = execFileSync('git', ['-C', repo, 'log', '--diff-filter=A', '--format=%cs', '--', rel],
      { encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('\n').filter(Boolean);
    return out.length ? out[out.length - 1] : null;
  } catch (e) { return null; } // poza gitem / plik niesledzony: brak daty = brak oceny „proposed”
}

// -> [{ file, kind, date, status }]
function scan(repo, today) {
  const items = [];
  for (const dir of ADR_DIRS) {
    let names;
    // 0000 = szablon ADR, nie decyzja
    try { names = fs.readdirSync(path.join(repo, dir)).filter((n) => /^\d{4}-.*\.md$/.test(n) && !n.startsWith('0000-')); } catch (e) { continue; }
    for (const name of names.sort()) {
      const rel = path.join(dir, name);
      const { status, review } = parseAdr(fs.readFileSync(path.join(repo, rel), 'utf8'));
      if (isFinal(status)) continue;
      if (review && review < today) items.push({ file: rel, kind: 'overdue', date: review, status });
      if (/^proponowan/.test(status)) {
        const added = firstCommitDay(repo, rel);
        if (added && (Date.parse(today) - Date.parse(added)) / DAY_MS > PROPOSED_DAYS) items.push({ file: rel, kind: 'proposed', date: added, status });
      }
    }
  }
  return items;
}

function render(items) {
  return items.map((i) => (i.kind === 'overdue' ? `${safeName(i.file)}: przeglad po terminie (${i.date})`
    : `${safeName(i.file)}: „proponowane” od ${i.date} (> ${PROPOSED_DAYS} dni)`)).join('; ');
}

module.exports = { parseAdr, scan, render, PROPOSED_DAYS };

if (require.main === module) {
  const args = process.argv.slice(2);
  const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
  const repo = opt('--repo');
  const today = opt('--today') || new Date().toISOString().slice(0, 10);
  if (!repo || !/^\d{4}-\d{2}-\d{2}$/.test(today)) {
    console.error('adr-review-due: uzycie --repo <sciezka> [--json] [--today RRRR-MM-DD]');
    process.exit(2);
  }
  try {
    const items = scan(path.resolve(repo), today);
    if (args.includes('--json')) console.log(JSON.stringify(items));
    else console.log(items.length ? `adr-review-due: ${items.length} — ${render(items)}` : 'adr-review-due: OK — brak ADR po terminie');
    process.exit(items.length ? 1 : 0);
  } catch (e) {
    console.error(`adr-review-due: blad narzedzia: ${e.message}`);
    process.exit(2);
  }
}

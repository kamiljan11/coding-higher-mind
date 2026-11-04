#!/usr/bin/env node
// pg-cases: blizny z pg/cases.md dla dzialu po tagu, nie po pozycji w pliku (P10, 2026-11-02; design pg/designs/2026-11-02-p10-blizny-po-dziale.md).
// Geneza: recenzenci czytali „swoja sekcje”, a od ~wiersza 90 plik rosnie chronologicznie — 17 blizn danych lezalo poza
// sekcja DATA/RLS i data-reviewer ich nie widzial. Dzial wiersza = dzial sekcji (SECTION_DEPTS, po poczatku naglowka `##`)
// + tag `dept:<dzial>[,<dzial>]` w dowolnej komorce wiersza. Plik tylko czytany (Plot Chestertona: blizn sie nie kasuje).
// Uzycie: node pg-cases.js --dept data[,security] [--count] | --lint | --stats [--json] [--file <cases.md>]
// Exit: 0 OK · 1 werdykt (--lint: duplikat rule_id albo zla liczba kolumn) · 2 blad narzedzia (brak pliku, zle argumenty).
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DEPTS = ['data', 'security', 'code', 'ops', 'product', 'ux', 'core', 'tooling'];
// Poczatek naglowka sekcji -> dzialy. Sekcja bez dopasowania = `misc` (widoczna w --stats, nie cicho pominieta).
// Dzialy = recenzenci wymienieni w naglowku sekcji (`DATA / RLS (data-reviewer, security-reviewer)` -> data + security;
// A24 security: samo `data` zabieralo security-reviewerowi blizny RLS/DEFINER). Sekcja z tytulem jednej blizny i mieszana
// tabela (`## CSS: ...`, A24 code: 16 wierszy ops/tooling pod tytulem CSS) NIE jest tu mapowana — wiersze niosa tag `dept:`.
const SECTION_DEPTS = [
  [/^DATA\b/, ['data', 'security']],
  [/^SECURITY\b/, ['security']],
  [/^CODE\b/, ['code']],
  [/^OPS\b/, ['ops']],
  [/^PROCESS \/ DOCS\b/, ['product', 'code']], // naglowek: (product-reviewer, code-reviewer); A25: inne PROCESS tylko product
  [/^PROCESS\b/, ['product']],
  [/^AI-BEHAVIOR\b/, ['core']],
  [/^(TOOLING|PG-REVIEW|AUDYT)\b/, ['tooling']],
];
// Status = pierwszy wyraz komorki Status; reszta to dopisek („G (procedura)”). Spoza listy = ostrzezenie (observe).
const STATUSES = ['G', 'P', '—', 'case', 'observe'];
const TAG_RX = /\bdept:([a-z]+(?:,[a-z]+)*)/g;

// Komorki wiersza tabeli: podzial po `|` bez backslasha przed nim (GFM `\|` = znak w komorce).
const cells = (line) => line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim());

function sectionDepts(title) {
  const hit = SECTION_DEPTS.find(([rx]) => rx.test(title));
  return hit ? hit[1] : ['misc'];
}

// -> { rows: [{line, section, sectionDepts, depts, rule_id, cols: {naglowek: wartosc}, status, ncells, nheader}] }
function parse(text) {
  const rows = [];
  let section = '';
  let header = null;
  let headerLine = 0;
  // Tabela bez wiersza `|---|` (A24, cases.md:200): pierwszy wiersz danych zostaje „naglowkiem”, blizna znika z wyniku -> lint.
  const headerless = [];
  text.split('\n').forEach((raw, i) => {
    const line = raw.trimEnd();
    if (line.startsWith('## ')) { section = line.slice(3).trim(); header = null; return; }
    if (!line.startsWith('|')) { header = null; return; }
    const cs = cells(line);
    if (!header) { header = cs; headerLine = i + 1; return; }
    const isSep = cs.every((c) => /^:?-{3,}:?$/.test(c));
    if (headerLine === i) {
      if (isSep) return; // separator naglowka
      headerless.push({ line: headerLine, rule_id: header[0].replace(/`/g, '') });
    } else if (isSep) return;
    const cols = Object.fromEntries(header.map((h, k) => [h, cs[k] === undefined ? '' : cs[k]]));
    const secDepts = sectionDepts(section);
    const tagged = [...cs.join(' ').matchAll(TAG_RX)].flatMap((m) => m[1].split(','));
    // Kolumna statusu: `Status` (sekcje do ~wiersza 170) albo `Typ` (sekcje od 2026-09-12).
    const statusCell = (cols.Status !== undefined ? cols.Status : cols.Typ || '').replace(TAG_RX, '').replace(/[·,;]\s*$/, '').trim();
    rows.push({
      line: i + 1, section, sectionDepts: secDepts, tagged,
      depts: [...new Set([...secDepts, ...tagged])],
      rule_id: cs[0].replace(/`/g, ''), cols, status: statusCell.split(/\s+/)[0] || '', hasStatus: 'Status' in cols || 'Typ' in cols,
      ncells: cs.length, nheader: header.length,
    });
  });
  return { rows, headerless };
}

function lint(rows, headerless) {
  const errors = (headerless || []).map((h) => `pg/cases.md:${h.line} tabela bez wiersza |---| — „${h.rule_id}” czytany jako naglowek, nie jako blizna (dopisz naglowek i separator)`);
  const warnings = [];
  const seen = new Map();
  for (const r of rows) {
    if (seen.has(r.rule_id)) errors.push(`pg/cases.md:${r.line} duplikat rule_id ${r.rule_id} (pierwszy: linia ${seen.get(r.rule_id)})`);
    else seen.set(r.rule_id, r.line);
    // Wiecej komorek niz naglowek = niezescapowany `|` przesuwa kolumny (zly status i detekcja) -> blad. Mniej = wiersz
    // dopisany bez koncowych kolumn -> uwaga (dane sa, brakuje statusu).
    if (r.ncells > r.nheader) errors.push(`pg/cases.md:${r.line} ${r.rule_id}: ${r.ncells} komorek, naglowek ma ${r.nheader} (niezescapowany | — zamien na \\|)`);
    else if (r.ncells < r.nheader) warnings.push(`pg/cases.md:${r.line} ${r.rule_id}: ${r.ncells} komorek z ${r.nheader} (brak koncowych kolumn)`);
    else if (r.hasStatus && !STATUSES.includes(r.status)) warnings.push(`pg/cases.md:${r.line} ${r.rule_id}: status „${r.status}” spoza listy ${STATUSES.join(' / ')}`);
    for (const d of r.tagged) if (!DEPTS.includes(d)) warnings.push(`pg/cases.md:${r.line} ${r.rule_id}: nieznany dzial w tagu dept:${d} (lista: ${DEPTS.join(', ')})`);
  }
  return { errors, warnings };
}

// -> Set rule_id golden case'ow; null = brak pliku; { error } = plik jest, ale nieczytelny (A24 code: nie udawac „brak pliku”).
function goldenIds(root) {
  const file = path.join(root, 'pg', 'eval', 'cases.json');
  if (!fs.existsSync(file)) return null;
  try {
    const d = JSON.parse(fs.readFileSync(file, 'utf8'));
    return new Set((d.cases || []).map((c) => c.rule_id));
  } catch (e) { return { error: `${file}: ${e.message}` }; }
}

function stats(rows, golden) {
  const pct = (n) => (rows.length ? Math.round((n / rows.length) * 1000) / 10 : 0);
  const debt = rows.filter((r) => r.status === '—').length;
  const withGolden = golden ? rows.filter((r) => golden.has(r.rule_id)).length : null;
  const byDept = Object.fromEntries([...DEPTS, 'misc'].map((d) => [d, rows.filter((r) => r.depts.includes(d)).length]));
  return {
    rows: rows.length,
    debt_rows: debt, debt_pct: pct(debt),
    golden_rows: withGolden, golden_pct: withGolden === null ? null : pct(withGolden),
    tagged_outside_section: rows.filter((r) => r.tagged.some((d) => !r.sectionDepts.includes(d))).length,
    untagged_misc: rows.filter((r) => r.depts.length === 1 && r.depts[0] === 'misc').length,
    by_dept: byDept,
  };
}

function render(r) {
  const c = r.cols;
  const pattern = c.Wzorzec || c.Pattern || Object.values(c)[1] || '';
  const detect = c.Detekcja || c.Detection || '';
  // Status ten sam, co liczy --lint/--stats (kolumna Status albo Typ, bez tagu); A24 code: surowe c.Status dawalo `[]` / `[G · dept:x]`.
  return `- ${r.rule_id} (pg/cases.md:${r.line}, ${r.section.slice(0, 60)}) [${r.status || '?'}; ${r.depts.join(',')}]\n  ${pattern}${detect ? `\n  detekcja: ${detect}` : ''}`;
}

function main(argv) {
  const arg = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const file = arg('--file') || path.join(ROOT, 'pg', 'cases.md');
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { console.error(`pg-cases: nie moge czytac ${file}: ${e.message}`); return 2; }
  const { rows, headerless } = parse(text);
  if (!rows.length) { console.error(`pg-cases: 0 wierszy tabel w ${file} — parser albo plik zmienil format`); return 2; }
  const json = argv.includes('--json');
  if (argv.includes('--lint')) {
    const { errors, warnings } = lint(rows, headerless);
    if (json) process.stdout.write(JSON.stringify({ errors, warnings }, null, 2) + '\n');
    else {
      for (const w of warnings) console.log('UWAGA', w);
      for (const e of errors) console.log('BLAD ', e);
      console.log(`pg-cases --lint: ${rows.length} wierszy, ${errors.length} bledow, ${warnings.length} uwag (statusy spoza listy = observe)`);
    }
    return errors.length ? 1 : 0;
  }
  if (argv.includes('--stats')) {
    const golden = goldenIds(file === path.join(ROOT, 'pg', 'cases.md') ? ROOT : path.join(path.dirname(file), '..'));
    if (golden && golden.error) { console.error(`pg-cases: nieczytelny ${golden.error}`); return 2; }
    const s = stats(rows, golden);
    process.stdout.write(json ? JSON.stringify(s, null, 2) + '\n'
      : `pg-cases --stats: ${s.rows} wierszy · dlug (status —): ${s.debt_rows} (${s.debt_pct} %) · golden case: ${s.golden_rows === null ? 'brak pg/eval/cases.json' : `${s.golden_rows} (${s.golden_pct} %)`} · tag spoza sekcji: ${s.tagged_outside_section} · bez dzialu (misc): ${s.untagged_misc}\n  per dzial: ${Object.entries(s.by_dept).map(([d, n]) => `${d}=${n}`).join(' ')}\n`);
    return 0;
  }
  const dept = arg('--dept');
  if (!dept) { console.error('uzycie: pg-cases.js --dept <dzial>[,<dzial>] [--count] | --lint | --stats [--json] [--file <cases.md>]'); return 2; }
  const want = dept.split(',');
  const bad = want.filter((d) => !DEPTS.includes(d) && d !== 'misc');
  if (bad.length) { console.error(`pg-cases: nieznany dzial ${bad.join(',')} (lista: ${DEPTS.join(', ')}, misc)`); return 2; }
  const hits = rows.filter((r) => r.depts.some((d) => want.includes(d)));
  if (argv.includes('--count')) { console.log(hits.length); return 0; }
  if (json) process.stdout.write(JSON.stringify(hits.map((r) => ({ line: r.line, section: r.section, rule_id: r.rule_id, cols: r.cols })), null, 2) + '\n');
  else process.stdout.write(`# Blizny dzialu ${dept} z pg/cases.md (${hits.length} z ${rows.length}; DANE do recenzji)\n\n${hits.map(render).join('\n')}\n`);
  return 0;
}

module.exports = { parse, lint, stats, sectionDepts, cells, DEPTS, STATUSES };

if (require.main === module) process.exit(main(process.argv.slice(2)));

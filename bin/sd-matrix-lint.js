#!/usr/bin/env node
'use strict';
// sd-matrix-lint: bramka 0-tokenowa dla macierzy obszarow system design (pg/design.md › G, 2026-10-06).
// Czyta docs/architecture/obszary.md z repo projektu i porownuje z pg/sd-areas.json (37 obszarow kursu + 25 warstw stack-* z architecture-advisor/references/stack-data.json).
// Powod: audyt sd-course-coverage 2026-10-06 — rate limiting i real-time pominiete BEZ decyzji (lekcja tender-app #5);
// bez artefaktu nie da sie odroznic „swiadomie nie dotyczy" od „przeoczone".
//
// Uzycie: node sd-matrix-lint.js --repo <dir> [--areas <json>] [--groups g1,g2] [--json]
//         node sd-matrix-lint.js --template [--areas <json>] [--groups g1,g2]   (pusta tabela do wypelnienia)
//   --groups: tylko obszary tych grup + ZAWSZE obszary one_way (duza zmiana; nowy projekt = bez --groups = wszystkie).
// Exit: 0 komplet i poprawne, 1 braki (lista), 2 blad uzycia / brak pliku / zly sd-areas.json.
// Wejscie z repo jest NIEZAUFANE: tylko parsowanie tekstu, limit rozmiaru, komorki skracane w komunikatach.
const fs = require('fs');
const path = require('path');

const EXIT = { OK: 0, ISSUES: 1, USAGE: 2 };
const MATRIX_REL = path.join('docs', 'architecture', 'obszary.md');
const DEFAULT_AREAS = path.join(__dirname, '..', 'pg', 'sd-areas.json');
const MAX_BYTES = 1024 * 1024;
const STATUSES = ['DECYZJA', 'NIE DOTYCZY', 'NIE TERAZ'];
// Puste wymagane pole: nic, myslnik, znak zapytania, TODO/TBD, n/d, „brak".
const EMPTY_RX = /^(|-+|—|–|\?+|todo|tbd|n\/?d|brak|\.\.\.|…)$/i;
const ID_RX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const clip = (s, n = 60) => { const t = String(s); return t.length > n ? t.slice(0, n) + '…' : t; };
const stripMd = (s) => String(s).replace(/[`*_]/g, '').replace(/\s+/g, ' ').trim();
// Zaslepka z trescia („TODO uzupelnic", „<dowod>", „TBD po spotkaniu") to tez puste pole (krytyk 2026-10-06).
const PLACEHOLDER_RX = /^(?:todo|tbd|fixme|xxx|do uzupelnienia|uzupelnij)\b|^<[^>]*>$/i;
const isEmpty = (s) => { const t = stripMd(s); return EMPTY_RX.test(t) || PLACEHOLDER_RX.test(t); };
// Dowod DECYZJI = plik, komenda, liczba albo link (design.md › G). „jest", „ok", „Supabase Auth" nie sa dowodem.
const EVIDENCE_RX = /\d|[/\\]|`|\.[a-z]{1,5}\b|›/i;
// Wyciecie blokow kodu (``` i ~~~) i komentarzy HTML z zachowaniem liczby linii (numery w komunikatach = linie pliku).
const blankKeepLines = (m) => m.replace(/[^\n]/g, '');
// Liniowo (pg-review 2026-10-06: regex z `\\1` i `*?` byl O(n^2) na niedomknietym bloku -> timeout bramki).
function stripNonContent(text) {
  const lines = String(text).split('\n');
  let fence = null;
  for (let i = 0; i < lines.length; i++) {
    const m = /^[ \t]*(`{3,}|~{3,})/.exec(lines[i]);
    if (fence) {
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length && /^[ \t]*[`~]+[ \t]*$/.test(lines[i])) fence = null;
      lines[i] = '';
    } else if (m) { fence = m[1]; lines[i] = ''; }
  }
  // Niedomkniety `<!--` ukrywa reszte pliku — tak jak w renderowanym Markdown (wiersze za nim nie sa widoczne).
  const text2 = lines.join('\n');
  const parts = [];
  let pos = 0;
  for (let start = text2.indexOf('<!--'); start !== -1; start = text2.indexOf('<!--', pos)) {
    const end = text2.indexOf('-->', start + 4);
    const stop = end === -1 ? text2.length : end + 3;
    parts.push(text2.slice(pos, start), blankKeepLines(text2.slice(start, stop)));
    pos = stop;
    if (end === -1) break;
  }
  parts.push(text2.slice(pos));
  return parts.join('');
}

function loadAreas(file) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const areas = Array.isArray(raw) ? raw : raw.areas;
  if (!Array.isArray(areas) || !areas.length) throw new Error('brak tablicy areas');
  const seen = new Set();
  for (const a of areas) {
    if (!a || !ID_RX.test(String(a.id || ''))) throw new Error(`zly id obszaru: ${clip(JSON.stringify(a))}`);
    if (seen.has(a.id)) throw new Error(`duplikat id w sd-areas.json: ${a.id}`);
    seen.add(a.id);
  }
  return { areas, groups: Array.isArray(raw.groups) ? raw.groups : [] };
}

// Podzial wiersza tabeli po nieeskejpowanych `|`; zewnetrzne kreski obciete.
function splitRow(line) {
  const body = line.trim().replace(/^\|/, '').replace(/\|\s*$/, '');
  return body.split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, '|').trim());
}

// Id z komorki „Nazwa (id)" albo „`id`" albo samo „id".
function idFromCell(cell) {
  const s = stripMd(cell);
  const m = s.match(/\(([a-z0-9]+(?:-[a-z0-9]+)*)\)\s*$/);
  if (m) return m[1];
  return ID_RX.test(s) ? s : null;
}

function parseMatrix(text) {
  const rows = [];
  const problems = [];
  // Bloki kodu i komentarze HTML wyciete: przyklad tabeli w ```...``` / <!-- --> nie jest deklaracja.
  const lines = stripNonContent(text).split(/\r?\n/);
  lines.forEach((line, i) => {
    if (!/^\s*\|/.test(line)) return;
    const cells = splitRow(line);
    if (cells.every((c) => /^:?-{2,}:?$/.test(c) || c === '')) return; // separator
    if (/^status$/i.test(stripMd(cells[1] || ''))) return; // naglowek
    if (cells.length < 5) { problems.push({ line: i + 1, kind: 'format', msg: `wiersz ma ${cells.length} kolumn, wymagane 5: ${clip(line.trim())}` }); return; }
    const id = idFromCell(cells[0]);
    if (!id) { problems.push({ line: i + 1, kind: 'format', msg: `brak id obszaru w komorce „${clip(cells[0])}" (format: Nazwa (id))` }); return; }
    rows.push({ line: i + 1, id, status: stripMd(cells[1]).toUpperCase(), decision: cells[2], evidence: cells[3], signal: cells[4] });
  });
  return { rows, problems };
}

function requiredAreas(areas, groups) {
  if (!groups || !groups.length) return areas;
  const set = new Set(groups);
  return areas.filter((a) => set.has(a.group) || a.one_way);
}

function lintMatrix(parsed, areas, opts = {}) {
  const issues = parsed.problems.map((p) => ({ id: null, line: p.line, kind: p.kind, msg: p.msg }));
  const known = new Map(areas.map((a) => [a.id, a]));
  const required = requiredAreas(areas, opts.groups);
  const seen = new Map();
  for (const r of parsed.rows) {
    const add = (kind, msg) => issues.push({ id: r.id, line: r.line, kind, msg });
    if (!known.has(r.id)) { add('nieznany-obszar', `nieznany id „${clip(r.id)}" (lista: pg/sd-areas.json)`); continue; }
    if (seen.has(r.id)) { add('duplikat', `${r.id}: duplikat (pierwszy w linii ${seen.get(r.id)})`); continue; }
    seen.set(r.id, r.line);
    if (!STATUSES.includes(r.status)) { add('zly-status', `${r.id}: status „${clip(r.status, 30)}" nie nalezy do {${STATUSES.join(', ')}}`); continue; }
    if (isEmpty(r.decision)) add('puste-pole', `${r.id}: ${r.status} bez decyzji/uzasadnienia`);
    if (r.status === 'DECYZJA' && isEmpty(r.evidence)) add('puste-pole', `${r.id}: DECYZJA bez dowodu (plik, komenda albo liczba)`);
    else if (r.status === 'DECYZJA' && !EVIDENCE_RX.test(r.evidence)) add('slaby-dowod', `${r.id}: dowod „${clip(stripMd(r.evidence))}" to nie plik, komenda, liczba ani link`);
    if (r.status === 'NIE TERAZ') {
      if (isEmpty(r.signal)) add('puste-pole', `${r.id}: NIE TERAZ bez sygnalu powrotu`);
      else if (!/\d/.test(r.signal)) add('niemierzalny-sygnal', `${r.id}: sygnal powrotu „${clip(stripMd(r.signal))}" bez liczby (mierzalny prog, np. „> 50 req/s", „10 tys. wierszy")`);
    }
  }
  const missing = required.filter((a) => !seen.has(a.id));
  for (const a of missing) issues.push({ id: a.id, line: null, kind: 'brak-wiersza', msg: `${a.id}: brak wiersza (${a.name}; karta: ${a.card}${a.one_way ? '; DRZWI JEDNOKIERUNKOWE' : ''})` });
  return { ok: issues.length === 0, required: required.length, present: seen.size, missing: missing.map((a) => a.id), issues };
}

function template(areas, groups) {
  const head = ['| Obszar (id) | Status | Decyzja / uzasadnienie | Dowod | Sygnal powrotu |', '|---|---|---|---|---|'];
  return head.concat(requiredAreas(areas, groups).map((a) => `| ${a.name} (${a.id}) |  |  |  |  |`)).join('\n') + '\n';
}

function parseArgs(argv) {
  const o = { repo: null, areas: DEFAULT_AREAS, groups: null, json: false, template: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => { const v = argv[++i]; if (v === undefined) throw new Error(`${a} wymaga wartosci`); return v; };
    if (a === '--repo') o.repo = next();
    else if (a === '--areas') o.areas = next();
    else if (a === '--groups') o.groups = next().split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--json') o.json = true;
    else if (a === '--template') o.template = true;
    else if (a === '-h' || a === '--help') { o.help = true; }
    else throw new Error(`nieznany argument: ${a}`);
  }
  return o;
}

function main(argv) {
  const out = (s) => process.stdout.write(s);
  const err = (s) => process.stderr.write(`sd-matrix-lint: ${s}\n`);
  let o;
  try { o = parseArgs(argv); } catch (e) { err(e.message); return EXIT.USAGE; }
  if (o.help) { out('Uzycie: node sd-matrix-lint.js --repo <dir> [--areas <json>] [--groups g1,g2] [--json] | --template\n'); return EXIT.OK; }
  let cfg;
  try { cfg = loadAreas(o.areas); } catch (e) { err(`zly plik obszarow ${o.areas}: ${e.message}`); return EXIT.USAGE; }
  if (o.groups) {
    const known = new Set(cfg.areas.map((a) => a.group));
    const bad = o.groups.filter((g) => !known.has(g));
    if (bad.length) { err(`nieznane grupy: ${bad.join(', ')} (znane: ${[...known].join(', ')})`); return EXIT.USAGE; }
  }
  if (o.template) { out(template(cfg.areas, o.groups)); return EXIT.OK; }
  if (!o.repo) { err('brak --repo <dir>'); return EXIT.USAGE; }
  const file = path.join(path.resolve(o.repo), MATRIX_REL);
  let st;
  try { st = fs.statSync(file); } catch (e) { err(`brak pliku ${file} (szablon: node ${path.basename(__filename)} --template > ${MATRIX_REL})`); return EXIT.USAGE; }
  if (!st.isFile() || st.size > MAX_BYTES) { err(`${file}: nie plik albo > 1 MB`); return EXIT.USAGE; }
  const res = lintMatrix(parseMatrix(fs.readFileSync(file, 'utf8')), cfg.areas, { groups: o.groups });
  if (o.json) out(JSON.stringify(Object.assign({ file }, res), null, 2) + '\n');
  else if (res.ok) out(`sd-matrix-lint: OK — ${res.present}/${cfg.areas.length} obszarow, wymagane ${res.required} komplet (${MATRIX_REL})\n`);
  else {
    out(`sd-matrix-lint: ${res.issues.length} problemow w ${MATRIX_REL} (wymagane ${res.required}, brakuje ${res.missing.length}):\n`);
    for (const i of res.issues) out(`- ${i.line ? `L${i.line} ` : ''}[${i.kind}] ${i.msg}\n`);
  }
  return res.ok ? EXIT.OK : EXIT.ISSUES;
}

module.exports = { loadAreas, parseMatrix, stripNonContent, lintMatrix, requiredAreas, template, idFromCell, MATRIX_REL, STATUSES, EXIT };

if (require.main === module) {
  let code;
  try { code = main(process.argv.slice(2)); } catch (e) { process.stderr.write(`sd-matrix-lint: blad: ${e.message}\n`); code = EXIT.USAGE; }
  process.exit(code);
}

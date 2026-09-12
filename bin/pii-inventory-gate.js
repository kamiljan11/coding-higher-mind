#!/usr/bin/env node
'use strict';
// pii-inventory-gate: kazda kolumna z danymi osobowymi ma wiersz `tabela.kolumna` w docs/PRIVACY.md
// (dana, cel, podstawa, retencja, procesor, jak usunac) — RODO art. 30 (rejestr czynnosci) w wersji, ktora
// da sie sprawdzic 0-tokenowo. Slownik SH: prawnik IT / „danych klienta nie wrzucamy bez ustalenia"; PG gap L5.
// Wykrywa kolumny po NAZWIE (email, phone, kennitala, pesel, nip, address, birth_date, iban, first_name...)
// w `CREATE TABLE (...)` i `ALTER TABLE ... ADD COLUMN`.
// Uzycie: node pii-inventory-gate.js --staged [--json]      (pre-commit: tylko kolumny w DODANYCH liniach migracji)
//         node pii-inventory-gate.js --repo <sciezka> [--json] (pelny inwentarz: wszystkie migracje vs PRIVACY.md)
// Exit: 0 OK, 1 brakuje wierszy (albo brak docs/PRIVACY.md przy PII), 2 blad uzycia.
const fs = require('fs');
const path = require('path');
const { addedLines } = require(path.join(__dirname, 'commented-code-gate.js'));
const { stagedDiff, stagedFiles, stagedContent, failOpen } = require(path.join(__dirname, 'lib', 'git-staged.js'));

const PII_COLUMN_RX = /^(e_?mail|phone(_number)?|tel(efon|ephone)?|mobile|kennitala|pesel|nip|ssn|passport(_no)?|birth_?(date|day)|dob|date_of_birth|address(_line\d?)?|street|zip(_code)?|postal_code|postcode|iban|card_number|first_name|last_name|full_name|surname|ip_address|national_id)$/i;
const MIGRATION_FILE_RX = /(^|\/)migrations\/[^/]+\.sql$/i;
// Fikstury lintera/golden set (pg/eval/cases, */fixtures/) celowo zawieraja kolumny PII — to nie sa migracje produktu (2026-09-12).
const FIXTURE_PATH_RX = /(^|\/)(fixtures?|__fixtures__|eval\/cases)\//i;
const CREATE_RX = /^\s*create\s+table\s+(?:if\s+not\s+exists\s+)?("?[\w.]+"?)\s*\(/i;
const ALTER_ADD_RX = /^\s*alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?("?[\w.]+"?)\s+add\s+(?:column\s+)?(?:if\s+not\s+exists\s+)?("?[\w]+"?)/i;
const COLUMN_LINE_RX = /^\s*("?[a-z_][a-z0-9_]*"?)\s+[a-z]/i;
const NOT_A_COLUMN_RX = /^\s*(constraint|primary|foreign|unique|check|exclude|like|index)\b/i;
const PRIVACY_ROW_RX = /`?([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*|\*)`?/g;

const bare = (ident) => ident.replace(/"/g, '').split('.').pop().toLowerCase();

/** SQL migracji -> [{table, column, line}] kolumn o nazwach osobowych. Czysta funkcja. */
function piiColumnsFromSql(sqlText) {
  const found = [];
  let table = null;
  sqlText.split(/\r?\n/).forEach((line, i) => {
    const lineNo = i + 1;
    const create = line.match(CREATE_RX);
    if (create) {
      table = bare(create[1]);
      // Jednoliniowe `create table t (email text, phone text);` — kolumny sa w TEJ SAMEJ linii (recheck 2026-09-12: bug, gate milczal).
      const rest = line.slice(line.indexOf('(') + 1);
      for (const def of rest.split(',')) {
        const col = def.trim().match(/^"?([a-z_][a-z0-9_]*)"?\s+[a-z]/i);
        if (col && !NOT_A_COLUMN_RX.test(def) && PII_COLUMN_RX.test(bare(col[1]))) found.push({ table, column: bare(col[1]), line: lineNo });
      }
      if (/\)\s*;/.test(rest)) table = null;
      return;
    }
    const alter = line.match(ALTER_ADD_RX);
    if (alter) { const col = bare(alter[2]); if (PII_COLUMN_RX.test(col)) found.push({ table: bare(alter[1]), column: col, line: lineNo }); return; }
    if (!table) return;
    if (/^\s*\)\s*;?/.test(line) || /\)\s*;/.test(line)) { table = null; return; }
    if (NOT_A_COLUMN_RX.test(line)) return;
    const col = line.match(COLUMN_LINE_RX);
    if (col && PII_COLUMN_RX.test(bare(col[1]))) found.push({ table, column: bare(col[1]), line: lineNo });
  });
  return found;
}

/** docs/PRIVACY.md -> Set('tabela.kolumna' | 'tabela.*'). Czysta funkcja. */
function documentedColumns(privacyMd) {
  const set = new Set();
  for (const line of privacyMd.split(/\r?\n/)) {
    if (!line.trim().startsWith('|')) continue;
    for (const m of line.matchAll(PRIVACY_ROW_RX)) set.add(`${m[1].toLowerCase()}.${m[2].toLowerCase()}`);
  }
  return set;
}

function missingRows(columns, documented) {
  return columns.filter((c) => !documented.has(`${c.table}.${c.column}`) && !documented.has(`${c.table}.*`));
}

function collectStaged() {
  const files = stagedFiles().filter((f) => MIGRATION_FILE_RX.test(f) && !FIXTURE_PATH_RX.test(f));
  const diff = files.length ? stagedDiff(files) : '';
  const addedByFile = new Map();
  for (const r of addedLines(diff)) if (r.text !== null) { if (!addedByFile.has(r.file)) addedByFile.set(r.file, new Set()); addedByFile.get(r.file).add(r.line); }
  const columns = [];
  for (const file of files) {
    let staged = '';
    try { staged = stagedContent(file); } catch (e) { process.stderr.write(`pii-inventory-gate: nie moge odczytac ${file} z indeksu (${String(e.message).split('\n')[0]}) — plik pominiety\n`); continue; }
    const added = addedByFile.get(file) || new Set();
    for (const c of piiColumnsFromSql(staged)) if (added.has(c.line)) columns.push(Object.assign({ file }, c));
  }
  return columns;
}

function collectRepo(repo) {
  const dir = path.join(repo, 'supabase', 'migrations');
  let names = [];
  try { names = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort(); } catch (e) { return []; }
  const columns = [];
  for (const name of names) for (const c of piiColumnsFromSql(fs.readFileSync(path.join(dir, name), 'utf8'))) columns.push(Object.assign({ file: `supabase/migrations/${name}` }, c));
  return columns;
}

function main() {
  const argv = process.argv.slice(2);
  const repoIdx = argv.indexOf('--repo');
  const staged = argv.includes('--staged');
  if (!staged && repoIdx < 0) { process.stderr.write('pii-inventory-gate: uzycie: --staged | --repo <sciezka> [--json]\n'); return 2; }
  const repo = path.resolve(repoIdx >= 0 ? argv[repoIdx + 1] || '.' : '.');
  let columns = [];
  try { columns = staged ? collectStaged() : collectRepo(repo); }
  catch (e) { return failOpen('pii-inventory-gate', e); }
  const privacyPath = path.join(repo, 'docs', 'PRIVACY.md');
  const privacy = fs.existsSync(privacyPath) ? fs.readFileSync(privacyPath, 'utf8') : null;
  const missing = privacy === null ? columns : missingRows(columns, documentedColumns(privacy));
  const result = { piiColumns: columns.length, privacyExists: privacy !== null, missing };
  if (argv.includes('--json')) { process.stdout.write(JSON.stringify(result) + '\n'); return missing.length ? 1 : 0; }
  if (!columns.length) { process.stdout.write('pii-inventory-gate: OK — brak kolumn o nazwach osobowych w zakresie\n'); return 0; }
  if (!missing.length) { process.stdout.write(`pii-inventory-gate: OK — ${columns.length} kolumn PII, wszystkie maja wiersz w docs/PRIVACY.md\n`); return 0; }
  process.stdout.write(privacy === null
    ? `pii-inventory-gate: BLOK — ${columns.length} kolumn PII, a docs/PRIVACY.md NIE ISTNIEJE (skopiuj ~/.claude/templates/repo/docs/PRIVACY.md):\n`
    : `pii-inventory-gate: BLOK — ${missing.length}/${columns.length} kolumn PII bez wiersza \`tabela.kolumna\` w docs/PRIVACY.md:\n`);
  for (const m of missing.slice(0, 15)) process.stdout.write(`  ${m.table}.${m.column}  (${m.file}:${m.line})\n`);
  process.stdout.write('Wiersz: dana | tabela.kolumna | cel | podstawa | retencja | procesor (DPA) | jak usunac. Dane do AI/API zewnetrznego = procesor wpisany.\n');
  return 1;
}

module.exports = { piiColumnsFromSql, documentedColumns, missingRows, PII_COLUMN_RX };
if (require.main === module) process.exit(main());

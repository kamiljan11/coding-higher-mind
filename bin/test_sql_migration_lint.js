#!/usr/bin/env node
'use strict';
/*
 * test_sql_migration_lint.js — fixture-based tests for sql-migration-lint.js.
 * No test framework (zero deps, matches the linter itself). Exits 1 on first
 * failed assertion group, 0 if everything passes, printing a PASS/FAIL line
 * per assertion so failures are traceable without re-running with a debugger.
 */

const path = require('path');
const { runChecks, SEVERITY } = require('./sql-migration-lint.js');

// Fixture'y trwale (2026-09-05): scratchpad sesji znika — testy nie moga od niego zalezec.
const FIXTURES = path.join(require('os').homedir(), '.claude', 'pg', 'eval', 'fixtures', 'sql-lint');

let failures = 0;
function ok(desc, cond) {
  if (cond) {
    console.log(`PASS: ${desc}`);
  } else {
    console.log(`FAIL: ${desc}`);
    failures++;
  }
}

function idsOf(findings) { return findings.map((f) => f.id); }
function countOf(findings, id) { return findings.filter((f) => f.id === id).length; }
function messagesFor(findings, id) { return findings.filter((f) => f.id === id).map((f) => f.message); }

// ---------------------------------------------------------------------------
// main-repo: one positive violation per rule + matching clean counterpart.
// ---------------------------------------------------------------------------
const main = runChecks(path.join(FIXTURES, 'main-repo'));
const ids = idsOf(main.findings);

for (const id of ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9', 'R10', 'R11', 'R13']) {
  ok(`main-repo: ${id} fires on the positive fixture`, ids.includes(id));
}

ok('R1: fires for "widgets" (no RLS)', messagesFor(main.findings, 'R1').some((m) => m.includes('widgets')));
ok('R1: does not fire for "clean_widgets" (RLS enabled)', !messagesFor(main.findings, 'R1').some((m) => m.includes('clean_widgets')));

ok('R2: has an UPDATE-without-WITH-CHECK message', messagesFor(main.findings, 'R2').some((m) => /UPDATE/.test(m)));
ok('R2: has an INSERT-using-instead-of-WITH-CHECK message', messagesFor(main.findings, 'R2').some((m) => /INSERT/.test(m)));
ok('R2: does not flag clean cw_update/cw_insert policies', !messagesFor(main.findings, 'R2').some((m) => /cw_update|cw_insert/.test(m)));

ok('R3: flags the anon insert policy', messagesFor(main.findings, 'R3').length > 0);
ok('R3: exactly one finding (authenticated-only insert is not TO public/anon)', countOf(main.findings, 'R3') === 1);

ok('R4: flags missing search_path for do_thing', messagesFor(main.findings, 'R4').some((m) => m.includes('do_thing') && m.includes('search_path')));
ok('R4: flags missing REVOKE/GRANT lockdown for do_thing', messagesFor(main.findings, 'R4').some((m) => m.includes('do_thing') && m.includes('never REVOKEd')));
ok('R4: does not flag safe_fn (search_path set + revoked)', !messagesFor(main.findings, 'R4').some((m) => m.includes('safe_fn')));

ok('R5: flags insert/update grant to anon', messagesFor(main.findings, 'R5').some((m) => m.includes('anon')));
ok('R5: does not flag select-only grant to anon', countOf(main.findings, 'R5') === 1);

ok('R6: flags drop table without if exists', messagesFor(main.findings, 'R6').some((m) => m.includes('TABLE')));
ok('R6: suppression comment filters the waived drop out, leaving exactly one', countOf(main.findings, 'R6') === 1);

ok('R7: flags NOT NULL without DEFAULT ("urgent")', messagesFor(main.findings, 'R7').some((m) => m.includes('urgent') && !m.includes('urgent2')));
ok('R7: does not flag nickname (nullable) or urgent2 (has default)', !messagesFor(main.findings, 'R7').some((m) => m.includes('nickname') || m.includes('urgent2')));

ok('R8: flags vendor_id (no index anywhere)', messagesFor(main.findings, 'R8').some((m) => m.includes('vendor_id')));
ok('R8: does not flag customer_id (indexed in the clean fixture)', !messagesFor(main.findings, 'R8').some((m) => m.includes('customer_id')));

ok('R9: flags job_notes (no org column, no same_org trigger)', messagesFor(main.findings, 'R9').some((m) => m.includes('job_notes') && !m.includes('clean_job_notes')));
ok('R9: does not flag clean_job_notes (has org_id)', !messagesFor(main.findings, 'R9').some((m) => m.includes('"clean_job_notes"')));
ok('R9: does not flag clean_job_notes2 (has same_org trigger)', !messagesFor(main.findings, 'R9').some((m) => m.includes('clean_job_notes2')));

ok('R10: flags get_job (id param, no auth.uid()/org in body)', messagesFor(main.findings, 'R10').some((m) => m.includes('get_job')));
ok('R10: does not flag safe_fn (auth.uid() checked in body)', !messagesFor(main.findings, 'R10').some((m) => m.includes('safe_fn')));

ok('R11: flags USING (true) on secret_table', messagesFor(main.findings, 'R11').some((m) => m.includes('secret_table')));
ok('R11: does not flag USING (true) on public_catalog (name hint)', !messagesFor(main.findings, 'R11').some((m) => m.includes('public_catalog')));
ok('R11: suppression comment hides weird_table', !messagesFor(main.findings, 'R11').some((m) => m.includes('weird_table')));

ok('R13: fires as INFO severity', main.findings.filter((f) => f.id === 'R13').every((f) => f.severity === SEVERITY.INFO));

// ---------------------------------------------------------------------------
// r12-naming: bad filename + duplicate timestamp prefix.
// ---------------------------------------------------------------------------
const r12 = runChecks(path.join(FIXTURES, 'r12-naming'));
ok('R12: flags the non-timestamp filename', r12.findings.some((f) => f.id === 'R12' && f.file === 'not-a-timestamp.sql'));
ok('R12: flags the duplicate timestamp prefix', r12.findings.some((f) => f.id === 'R12' && /duplicate timestamp/.test(f.message)));
ok('R12: does not flag the first user of a timestamp prefix', !r12.findings.some((f) => f.id === 'R12' && f.file === '20260101000001_a.sql'));

// ---------------------------------------------------------------------------
// r6-downgrade: 10 plikow, R6 w 7 (70% > 60%) -> auto-downgrade do INFO. Ponizej MIN_FILES_FOR_DOWNGRADE (10)
// downgrade NIE dziala (naprawa 2026-09-05: bramka pre-commit nie odpalala na 1 zlej migracji).
// ---------------------------------------------------------------------------
const r6d = runChecks(path.join(FIXTURES, 'r6-downgrade'));
const r6Findings = r6d.findings.filter((f) => f.id === 'R6');
ok('R6-downgrade: still detects all 7 violations', r6Findings.length === 7);
ok('R6-downgrade: severity downgraded to INFO when >60% of files fire', r6Findings.every((f) => f.severity === SEVERITY.INFO));
ok('R6-downgrade: a downgrade note is recorded', r6d.downgradeNotes.some((n) => n.startsWith('R6')));

// ---------------------------------------------------------------------------
// all-clean: nothing HIGH -> --strict-equivalent check should pass (exit 0).
// ---------------------------------------------------------------------------
const clean = runChecks(path.join(FIXTURES, 'all-clean'));
const highInClean = clean.findings.filter((f) => f.severity === SEVERITY.HIGH);
ok('all-clean: no HIGH-severity findings (strict would exit 0)', highInClean.length === 0);

// ---------------------------------------------------------------------------
// main-repo has HIGH findings -> --strict-equivalent check should fail (exit 1).
// ---------------------------------------------------------------------------
const highInMain = main.findings.filter((f) => f.severity === SEVERITY.HIGH);
ok('main-repo: has HIGH-severity findings (strict would exit 1)', highInMain.length > 0);

// ---------------------------------------------------------------------------
// small sample (< MIN_FILES_FOR_DOWNGRADE): 1 file, R2 fires on 100% -> must STAY HIGH (pre-commit gate on a fresh migration).
// ---------------------------------------------------------------------------
{
  const small = runChecks(path.join(FIXTURES, '..', '..', 'cases', 'rls-using-no-check'));
  const r2 = small.findings.filter((f) => f.id === 'R2');
  ok('small-sample: R2 detected on single-file repo', r2.length === 1);
  ok('small-sample: R2 stays HIGH (no downgrade below 10 files)', r2.every((f) => f.severity === SEVERITY.HIGH));
}

// ---------------------------------------------------------------------------
// expand-contract (2026-10-11): R14 zmiany niezgodne wstecz + R7 HIGH bez falszywych trafien na nowej tabeli.
// ---------------------------------------------------------------------------
const ec = runChecks(path.join(FIXTURES, 'expand-contract'));
const r14 = ec.findings.filter((f) => f.id === 'R14');
const r14In = (file) => r14.filter((f) => f.file === file).map((f) => f.message);
const bad = r14In('20261011000001_bad.sql');
ok('R14: RENAME COLUMN na istniejacej tabeli', bad.some((m) => m.startsWith('RENAME COLUMN orders.a')));
ok('R14: DROP COLUMN na istniejacej tabeli', bad.some((m) => m.startsWith('DROP COLUMN orders.c')));
ok('R14: SET NOT NULL na istniejacej kolumnie', bad.some((m) => m.startsWith('SET NOT NULL on existing column orders.d')));
ok('R14: RENAME TABLE', bad.some((m) => m.startsWith('RENAME TABLE orders')));
ok('R14: DROP TABLE istniejacej tabeli', bad.some((m) => m.startsWith('DROP TABLE legacy')));
ok('R14: dokladnie 5 trafien w zlym pliku', bad.length === 5);
ok('R14 jest HIGH (pre-commit blokuje stagowane)', r14.every((f) => f.severity === SEVERITY.HIGH));
ok('R14: nic w pliku tworzacym tabele (rename/drop nowej tabeli)', r14In('20261011000000_init.sql').length === 0);
ok('R14: nic przy expand (ADD COLUMN, DROP NOT NULL, DROP CHECK, nowa tabela)', r14In('20261011000002_ok.sql').length === 0);
ok('R14: plik z `-- pg:contract` przepuszczony', r14In('20261011000003_contract.sql').length === 0);
ok('R14: `-- lint-ignore R14` dziala', r14In('20261011000004_ignored.sql').length === 0);
const r7 = ec.findings.filter((f) => f.id === 'R7');
ok('R7: ADD COLUMN NOT NULL bez DEFAULT na istniejacej tabeli = HIGH', r7.some((f) => f.file === '20261011000001_bad.sql' && f.severity === SEVERITY.HIGH));
ok('R7: brak trafienia dla nowej tabeli z tego samego pliku i dla kolumny z DEFAULT', !r7.some((f) => f.file === '20261011000002_ok.sql'));

// Przypadki z recenzji code/data 2026-10-11 (kazdy byl obejsciem albo slepa plamka pierwszej wersji R14). Osobny katalog:
// < 10 plikow, wiec auto-downgrade (>60% plikow) nie maskuje HIGH.
const ecr = runChecks(path.join(FIXTURES, 'expand-contract-review'));
const r14r = ecr.findings.filter((f) => f.id === 'R14');
const r7r = ecr.findings.filter((f) => f.id === 'R7');
ok('expand-contract-review: R14 i R7 HIGH (bez downgrade)', r14r.length > 0 && [...r14r, ...r7r].every((f) => f.severity === SEVERITY.HIGH));
const r14rIn = (file) => r14r.filter((f) => f.file === file).map((f) => f.message);
const has = (file, prefix) => r14rIn(file).some((m) => m.startsWith(prefix));
ok('R14: "public"."orders" rename (format supabase db diff) wykryty z pelna nazwa', has('20261011000005_quoted.sql', 'RENAME COLUMN public.orders.b'));
ok('R7: nowa tabela "public"."x" w pliku NIE zwalnia ALTER innej tabeli w cudzyslowach (regresja)', r7r.some((f) => f.file === '20261011000005_quoted.sql'));
ok('R14: `create table if not exists` istniejacej tabeli nie zwalnia SET NOT NULL', has('20261011000006_order.sql', 'SET NOT NULL on existing column orders.d'));
ok('R14: create PO alterze nie zwalnia altera', has('20261011000006_order.sql', 'DROP COLUMN late_t.k'));
ok('R14: DROP bez slowa COLUMN + kazda akcja z listy', has('20261011000007_syntax.sql', 'DROP COLUMN orders.e') && has('20261011000007_syntax.sql', 'ALTER COLUMN TYPE orders.h'));
ok('R14: SET SCHEMA = rename dla starego kodu', has('20261011000007_syntax.sql', 'SET SCHEMA orders'));
ok('R14: DROP TABLE a, b -> obie tabele', has('20261011000007_syntax.sql', 'DROP TABLE t1') && has('20261011000007_syntax.sql', 'DROP TABLE t2'));
const objs = r14rIn('20261011000008_objects.sql');
ok('R14: DROP FUNCTION/VIEW/SCHEMA, RENAME funkcji i wartosci enum (RPC i widoki starego kodu)', objs.length === 5);
ok('R14: DROP VIEW odtworzonego w tym samym pliku = podmiana, bez trafienia', !objs.some((m) => m.includes('v2')));
ok('R14: `-- pg:contract` w srodku pliku albo w literale NIE zwalnia', has('20261011000009_contract_mid.sql', 'DROP COLUMN orders.k'));
ok('R14/R7: `create table if not exists` nigdy nie zwalnia (tabela mogla powstac poza historia migracji)', r14rIn('20261011000010_newif.sql').length === 1 && r7r.some((f) => f.file === '20261011000010_newif.sql'));
const r2 = r14rIn('20261011000012_round2.sql');
ok('R14: DROP + CREATE funkcji z INNA liczba argumentow = zmiana sygnatury RPC', r2.some((m) => m.startsWith('DROP FUNCTION public.get_orders')));
ok('R14: DROP + CREATE funkcji z ta sama sygnatura = podmiana, bez trafienia', !r2.some((m) => m.includes('same_sig')));
ok('R14: DROP VIEW a, b -> oba widoki', r2.some((m) => m.startsWith('DROP VIEW public.va')) && r2.some((m) => m.startsWith('DROP VIEW public.vb')));
ok('R14: SET SCHEMA funkcji', r2.some((m) => m.startsWith('SET SCHEMA on FUNCTION public.calc')));
ok("R14: DEFAULT '--' nie ucina reszty instrukcji", r2.some((m) => m.startsWith('DROP COLUMN orders.legacy_note')));
ok('R14: DDL w bloku do $$ (if exists ... then alter) wykryty', r2.some((m) => m.startsWith('RENAME COLUMN orders.a')));
ok('R14: DROP DEFAULT i DROP unikalnego constraintu (upsert onConflict); zwykly CHECK bez trafienia', r2.some((m) => m.startsWith('DROP DEFAULT orders.s')) && r2.some((m) => m.startsWith('DROP CONSTRAINT orders.orders_org_email_key')) && !r2.some((m) => m.includes('orders_a_check')));
ok('R7: bigserial NOT NULL ma niejawny DEFAULT -> bez trafienia', !r7r.some((f) => f.file === '20261011000012_round2.sql'));
ok('R14: runda 2 = dokladnie 8 trafien', r2.length === 8);
const r3 = r14rIn('20261011000013_round3.sql');
ok('R14: DROP+CREATE funkcji z innym TYPEM argumentu = nowa sygnatura', r3.some((m) => m.startsWith('DROP FUNCTION public.typed')));
ok('R14: ta sama sygnatura z nazwami parametrow i DEFAULT = podmiana', !r3.some((m) => m.includes('named')));
ok("R14: 'drop table' w literale raise notice (do $$) to nie DDL", !r3.some((m) => m.startsWith('DROP TABLE')));
ok('R14: DROP constraintu *_uq', r3.some((m) => m.includes('orders_org_email_uq')));
ok('R7: serial4 NOT NULL ma niejawny DEFAULT', !r7r.some((f) => f.file === '20261011000013_round3.sql'));
ok('R14: runda 3 = dokladnie 2 trafienia', r3.length === 2);
const r3c = r14rIn('20261011000015_round3c.sql');
ok('R14: rename parametru RPC (p_org -> org) wzgledem definicji z repo = PGRST202 dla starego kodu', r3c.some((m) => m.startsWith('DROP FUNCTION public.rpc_named')));
ok('R14: nowy parametr z DEFAULT = zgodne wstecz, bez trafienia', !r3c.some((m) => m.includes('rpc_default')));
ok('R14: DROP funkcji bez listy argumentow i bez znanej definicji = trafienie', r3c.some((m) => m.startsWith('DROP FUNCTION public.rpc_noargs')));
ok('R14: DROP unikalnego indeksu i constraintu o nazwach z repo', r3c.some((m) => m.startsWith('DROP INDEX public.orders_org_email_uidx2')) && r3c.some((m) => m.includes('orders_custom_unq')));
ok("R14: E'it\\'s' nie ukrywa DROP COLUMN w tym samym ALTER", r3c.some((m) => m.startsWith('DROP COLUMN orders.legacy3')));
ok('R14: SET DEFAULT NULL = DROP DEFAULT', r3c.some((m) => m.startsWith('DROP DEFAULT orders.s')));
ok('R14: runda 3c = dokladnie 6 trafien (rpc_default zgodne)', r3c.length === 6);
const r3e = r14rIn('20261011000017_round3e.sql');
ok('R14: odtworzenie unikalnego indeksu z tymi samymi kolumnami = podmiana; inne kolumny = trafienie (inny cel onConflict)', r3e.length === 1 && r3e[0].startsWith('DROP INDEX orders_diff_uidx'), JSON.stringify(r3e));
{
  // ops 2026-10-11: R14/R7 NIE podlegaja auto-downgrade (>60% plikow) — dlug historyczny nie wycisza nowej zmiany
  ok('noDowngrade: R7 i R14 zostaja HIGH mimo >60% plikow', ecr.downgradeNotes.every((n) => !/^R(7|14)\b/.test(n)) && r14r.every((f) => f.severity === SEVERITY.HIGH));
}
ok('R14: bez falszywych alarmow (rename constraint, drop not null, alter index, plpgsql)', r14rIn('20261011000011_fp.sql').length === 0);

// ---------------------------------------------------------------------------
// --since <ref>: tylko migracje zmienione od merge-base (historyczne nie blokuja --strict); zly ref = exit 2.
// ---------------------------------------------------------------------------
{
  const fs = require('fs');
  const os = require('os');
  const { spawnSync } = require('child_process');
  const R = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-sqlsince-'));
  const g = (...a) => spawnSync('git', ['-C', R, '-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...a], { encoding: 'utf8' });
  const lint = (...a) => spawnSync(process.execPath, [path.join(__dirname, 'sql-migration-lint.js'), '--repo', R, ...a], { encoding: 'utf8' });
  try {
    const dir = path.join(R, 'supabase', 'migrations');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '20260101000000_init.sql'), 'create table orders (id uuid primary key, a text, x text);\nalter table orders enable row level security;\n');
    fs.writeFileSync(path.join(dir, '20260101000001_old.sql'), 'alter table orders drop column x;\n');
    g('init', '-q'); g('add', '-A'); g('commit', '-qm', 'base');
    fs.writeFileSync(path.join(dir, '20260102000000_new.sql'), 'alter table orders rename column a to b;\n');
    let r = lint('--json', '--strict', '--since', 'HEAD');
    const files = JSON.parse(r.stdout).findings.filter((f) => f.id === 'R14').map((f) => f.file);
    ok('--since: tylko nowa migracja (historyczny DROP COLUMN pominiety), --strict exit 1', r.status === 1 && files.length === 1 && files[0] === '20260102000000_new.sql', `exit=${r.status} ${files}`);
    r = lint('--json');
    ok('bez --since: obie migracje (kontekst caly zestaw)', JSON.parse(r.stdout).findings.filter((f) => f.id === 'R14').length === 2);
    fs.rmSync(path.join(dir, '20260102000000_new.sql'));
    r = lint('--strict', '--since', 'HEAD');
    ok('--since bez zmian w migracjach: --strict exit 0', r.status === 0, `exit=${r.status}`);
    r = lint('--strict', '--since', 'nie-ma-takiego-refa');
    ok('--since ze zlym refem: exit 2 + komunikat (nie cichy sukces)', r.status === 2 && /--since/.test(r.stderr), `exit=${r.status} ${r.stderr}`);
  } finally { fs.rmSync(R, { recursive: true, force: true }); }
}

console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);

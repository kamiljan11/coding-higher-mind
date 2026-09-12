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

console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);

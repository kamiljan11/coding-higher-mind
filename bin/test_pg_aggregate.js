// Testy pg-aggregate: minor z agreement 1 = note BEZ weryfikacji (audyt PG 2026-10-06 #6/#7).
// Uruchom: node test_pg_aggregate.js  (0 sieci, 0 modeli; fixture w os.tmpdir(), kasowany)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { aggregate } = require(path.join(__dirname, 'pg-aggregate.js'));

let failures = 0;
const check = (name, cond, detail) => { if (cond) console.log('ok  ', name); else { failures++; console.log('FAIL', name, detail || ''); } };

const finding = (over) => Object.assign({ file: 'src/a.ts', line_range: [10, 12], rule_id: 'R', severity: 'minor', claim: 'c', evidence: 'rg -> 11: x', repro_cmd: 'rg -n x src/a.ts', confidence: 0.8 }, over);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-agg-minor-'));
try {
  fs.writeFileSync(path.join(dir, 'findings.code.json'), JSON.stringify({ findings: [
    finding({ rule_id: 'LONE-MINOR' }),                                        // code-1: samotny minor -> note, bez weryfikacji
    finding({ file: 'src/b.ts', rule_id: 'LONE-MAJOR', severity: 'major' }),   // code-2: samotny major -> weryfikacja
    finding({ file: 'src/c.ts', rule_id: 'SHARED-MINOR' }),                    // code-3: minor zgodny z ops -> must_fix
    finding({ file: 'src/d.ts', rule_id: 'LONE-MINOR-VERIFIED' }),             // code-4: samotny minor z werdyktem
  ] }));
  fs.writeFileSync(path.join(dir, 'findings.ops.json'), JSON.stringify({ findings: [
    finding({ file: 'src/c.ts', rule_id: 'SHARED-MINOR' }),
    finding({ file: 'src/e.ts', rule_id: 'LONE-BLOCKER', severity: 'blocker' }), // ops-2: samotny blocker -> weryfikacja
  ] }));
  const r = aggregate(dir, null, { requiredRoles: ['code', 'ops'] });
  const by = (rule) => r.findings.find((g) => g.rule_id === rule);
  check('samotny minor -> note', by('LONE-MINOR').decision === 'note');
  check('samotny minor -> NIE w needs_verification', !r.needs_verification.includes('code-1'), r.needs_verification.join());
  check('samotny major -> needs_verification (bez zmian)', r.needs_verification.includes('code-2'));
  check('samotny blocker -> needs_verification (bez zmian)', r.needs_verification.includes('ops-2'));
  check('minor zgodny z 2 dzialow -> must_fix, bez weryfikacji (bez zmian)', by('SHARED-MINOR').decision === 'must_fix' && !by('SHARED-MINOR').needs_verification);
  const finalNoVerdicts = aggregate(dir, null, { requiredRoles: ['code', 'ops'], final: true });
  check('--final bez werdyktow: INCOMPLETE liczy tylko major/blocker (2), nie minory', finalNoVerdicts.verdict === 'INCOMPLETE' && finalNoVerdicts.incomplete.some((x) => x.startsWith('2 finding')), finalNoVerdicts.incomplete.join(' | '));

  fs.writeFileSync(path.join(dir, 'verdicts.json'), JSON.stringify({ verdicts: [
    { finding_id: 'code-2', verdict: 'not_reproduced', reason: 'fp' },
    { finding_id: 'ops-2', verdict: 'reproduced', reason: 'tak' },
    { finding_id: 'code-4', verdict: 'reproduced', reason: 'weryfikator sprawdzil z wlasnej woli' },
  ] }));
  const f = aggregate(dir, path.join(dir, 'verdicts.json'), { requiredRoles: ['code', 'ops'], final: true });
  check('--final z werdyktami major/blocker: kompletne mimo minora bez werdyktu', f.incomplete.length === 0 && f.verdict === 'REQUEST CHANGES', f.incomplete.join(' | '));
  check('samotny minor bez werdyktu dalej note po --final', f.findings.find((g) => g.rule_id === 'LONE-MINOR').decision === 'note');
  check('werdykt dla samotnego minora nadal przyjety (reproduced -> must_fix, zgodnie z regula 3)', f.findings.find((g) => g.rule_id === 'LONE-MINOR-VERIFIED').decision === 'must_fix');
  check('werdykt dla minora spoza needs_verification nie robi INCOMPLETE (id znane)', !f.incomplete.some((x) => x.includes('code-4')));
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} FAIL` : '\nwszystkie OK');
process.exit(failures ? 1 : 0);

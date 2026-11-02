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

// aggregated.md: bez --final niezweryfikowany blocker nie moze dac naglowka „APPROVE" (near-miss r11 ADR-0010, 2026-10-27).
const mdDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-agg-md-'));
try {
  const cli = (...a) => require('child_process').spawnSync('node', [path.join(__dirname, 'pg-aggregate.js'), mdDir, ...a], { encoding: 'utf8' });
  const head = () => fs.readFileSync(path.join(mdDir, 'aggregated.md'), 'utf8').split('\n')[0];
  fs.writeFileSync(path.join(mdDir, 'findings.security.json'), JSON.stringify({ findings: [finding({ rule_id: 'LONE-BLOCKER', severity: 'blocker' })] }));
  const pre = cli();
  check('md: posrednia agregacja z blockerem bez werdyktu -> exit 0 (verdict bez zmian)', pre.status === 0, pre.stderr);
  check('md: naglowek „APPROVE (wstepnie — 1 do weryfikacji)"', /— APPROVE \(wstepnie — 1 do weryfikacji\)$/.test(head()), head());
  check('md: linia Decyzje podaje liczbe czekajacych', /1 czeka na weryfikatora \(--final\)/.test(fs.readFileSync(path.join(mdDir, 'aggregated.md'), 'utf8')));
  fs.writeFileSync(path.join(mdDir, 'findings.security.json'), JSON.stringify({ findings: [finding({ rule_id: 'LONE-MINOR' })] }));
  cli();
  check('md: brak czekajacych -> goly naglowek APPROVE', /— APPROVE$/.test(head()), head());
} finally {
  fs.rmSync(mdDir, { recursive: true, force: true });
}

// cannot_run na blockerze = brak werdyktu (pg/cases.md CANNOT-RUN-BLOCKER-AS-NOTE: APPROVE przy realnym RCE, 2026-11-01).
const crDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-agg-cr-'));
try {
  fs.writeFileSync(path.join(crDir, 'findings.security.json'), JSON.stringify({ findings: [
    finding({ rule_id: 'RCE', severity: 'blocker' }),
    finding({ file: 'src/b.ts', rule_id: 'MAJ', severity: 'major' }),
  ] }));
  const v = path.join(crDir, 'verdicts.json');
  fs.writeFileSync(v, JSON.stringify({ verdicts: [
    { finding_id: 'security-1', verdict: 'cannot_run', severity_after: 'minor', reason: 'brak fixture' },
    { finding_id: 'security-2', verdict: 'cannot_run', reason: 'brak narzedzia' },
  ] }));
  const r = aggregate(crDir, v, { requiredRoles: ['security'], final: true });
  const rce = r.findings.find((g) => g.rule_id === 'RCE');
  check('cannot_run na blockerze -> --final INCOMPLETE, nie APPROVE', r.verdict === 'INCOMPLETE' && r.needs_verification.includes('security-1'), `${r.verdict} ${r.needs_verification}`);
  check('cannot_run nie obniza severity (blocker zostaje mimo severity_after)', rce.severity === 'blocker', rce.severity);
  check('cannot_run na majorze = werdykt (note, bez INCOMPLETE; koszt petli weryfikacji)', !r.needs_verification.includes('security-2') && r.findings.find((g) => g.rule_id === 'MAJ').decision === 'note');
  fs.writeFileSync(v, JSON.stringify({ verdicts: [{ finding_id: 'security-1', verdict: 'reproduced', severity_after: 'major', reason: 'tak' }, { finding_id: 'security-2', verdict: 'not_reproduced', severity_after: 'minor', reason: 'fp' }] }));
  const r2 = aggregate(crDir, v, { requiredRoles: ['security'], final: true });
  check('reproduced z severity_after nadal obniza (blocker -> major -> must_fix)', r2.findings.find((g) => g.rule_id === 'RCE').severity === 'major' && r2.verdict === 'REQUEST CHANGES', r2.verdict);
} finally {
  fs.rmSync(crDir, { recursive: true, force: true });
}

// Allowlista werdyktow, rozstrzyganie grupy, schemat severity (pg-review A1 security, PoC 2026-11-01).
const alDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-agg-al-'));
try {
  const v = path.join(alDir, 'verdicts.json');
  const run = (findings, verdicts) => {
    fs.writeFileSync(path.join(alDir, 'findings.security.json'), JSON.stringify({ findings }));
    fs.writeFileSync(v, JSON.stringify({ verdicts }));
    return aggregate(alDir, v, { requiredRoles: ['security'], final: true });
  };
  const blocker = finding({ rule_id: 'RCE', severity: 'blocker' });
  for (const bad of ['CANNOT_RUN', 'Cannot_Run', 'cannot-run', 'cannot run', ' cannot_run', 'inconclusive', 'skipped', true, 1, { x: 1 }]) {
    const r = run([blocker], [{ finding_id: 'security-1', verdict: bad }]);
    check(`werdykt ${JSON.stringify(bad)} na blockerze -> INCOMPLETE, nie APPROVE`, r.verdict === 'INCOMPLETE', r.verdict);
  }
  const dup = run([blocker, finding({ rule_id: 'RCE', severity: 'minor', line_range: [11, 12] })], [{ finding_id: 'security-2', verdict: 'not_reproduced' }]);
  check('obalenie slabszego duplikatu nie zrzuca blockera (dalej czeka na werdykt)', dup.verdict === 'INCOMPLETE' && dup.findings[0].decision !== 'dropped', `${dup.verdict} ${dup.findings[0].decision}`);
  const weakFirst = run([finding({ rule_id: 'RCE', severity: 'minor', line_range: [10, 11] }), finding({ rule_id: 'RCE', severity: 'blocker', claim: 'mocny', line_range: [11, 12] })], []);
  check('minor przed blockerem: weryfikator dostaje id i claim blockera', weakFirst.needs_verification.join() === 'security-2' && weakFirst.findings[0].claim === 'mocny', `${weakFirst.needs_verification} ${weakFirst.findings[0].claim}`);
  const weakFirstV = run([finding({ rule_id: 'RCE', severity: 'minor', line_range: [10, 11] }), finding({ rule_id: 'RCE', severity: 'blocker', line_range: [11, 12] })], [{ finding_id: 'security-2', verdict: 'reproduced' }]);
  check('minor przed blockerem + werdykt dla wystawionego id -> rozstrzygniete (REQUEST CHANGES)', weakFirstV.verdict === 'REQUEST CHANGES', weakFirstV.incomplete.join(' | '));
  // A2 security P1: dwa rownorzedne blockery z roznych dzialow, obalony tylko pierwszy -> nie APPROVE.
  fs.writeFileSync(path.join(alDir, 'findings.code.json'), JSON.stringify({ findings: [finding({ rule_id: 'RCE2', severity: 'blocker', repro_cmd: 'weak' })] }));
  const coequal = run([finding({ rule_id: 'RCE2', severity: 'blocker', line_range: [11, 14], repro_cmd: 'strong PoC' })], [{ finding_id: 'code-1', verdict: 'not_reproduced' }]);
  check('rownorzedne blockery, werdykt tylko dla g.id -> INCOMPLETE, drugi czlonek do weryfikatora', coequal.verdict === 'INCOMPLETE' && coequal.needs_verification.join() === 'security-1', `${coequal.verdict} ${coequal.needs_verification}`);
  check('grupa niesie claim/repro_cmd kazdego czlonka (weryfikator ma co uruchomic)', coequal.findings[0].members.some((m) => m.repro_cmd === 'strong PoC'));
  const bothRefuted = run([finding({ rule_id: 'RCE2', severity: 'blocker', line_range: [11, 14] })], [{ finding_id: 'code-1', verdict: 'not_reproduced' }, { finding_id: 'security-1', verdict: 'not_reproduced' }]);
  check('oba rownorzedne obalone -> dropped, APPROVE', bothRefuted.verdict === 'APPROVE' && bothRefuted.findings[0].decision === 'dropped', bothRefuted.verdict);
  fs.rmSync(path.join(alDir, 'findings.code.json'));
  // A2 security P2: klucze prototypu jako severity.
  for (const proto of ['constructor', 'Constructor', '__proto__', 'toString']) {
    const pr = run([blocker, finding({ rule_id: 'RCE', severity: proto, line_range: [11, 12] })], [{ finding_id: 'security-1', verdict: 'cannot_run' }]);
    check(`severity ${proto} odrzucona, blocker zostaje blockerem (cannot_run -> INCOMPLETE)`, pr.rejected.length === 1 && pr.verdict === 'INCOMPLETE' && pr.findings[0].severity === 'blocker', `${pr.verdict} ${pr.findings[0].severity}`);
  }
  const conflict = run([blocker, finding({ rule_id: 'RCE', severity: 'blocker', line_range: [11, 12] })],
    [{ finding_id: 'security-1', verdict: 'reproduced' }, { finding_id: 'security-2', verdict: 'not_reproduced' }]);
  check('sprzeczne werdykty czlonkow o najwyzszej severity -> INCOMPLETE', conflict.verdict === 'INCOMPLETE' && conflict.incomplete.some((x) => x.startsWith('sprzeczne')), conflict.incomplete.join(' | '));
  check('sprzecznosc -> obaj czlonkowie wracaja do weryfikatora (nie slepy zaulek)', conflict.needs_verification.join() === 'security-1,security-2', conflict.needs_verification.join());
  fs.writeFileSync(path.join(alDir, 'findings.code.json'), JSON.stringify({ findings: [finding({ rule_id: 'MAJ2', severity: 'major' })] }));
  const majConflict = run([finding({ rule_id: 'MAJ2', severity: 'major' })], [{ finding_id: 'code-1', verdict: 'reproduced' }, { finding_id: 'security-1', verdict: 'not_reproduced' }]);
  check('sprzecznosc na majorze z 2 dzialow -> obaj do weryfikatora (agreement 2 nie zamyka petli)', majConflict.verdict === 'INCOMPLETE' && majConflict.needs_verification.join() === 'code-1,security-1', `${majConflict.verdict} ${majConflict.needs_verification}`);
  fs.rmSync(path.join(alDir, 'findings.code.json'));
  // A3 code: mieszanka werdyktow rownorzednych czlonkow nie moze konczyc sie INCOMPLETE bez id dla weryfikatora.
  const twoBlockers = [blocker, finding({ rule_id: 'RCE', severity: 'blocker', line_range: [11, 12] })];
  const reproCr = run(twoBlockers, [{ finding_id: 'security-1', verdict: 'reproduced' }, { finding_id: 'security-2', verdict: 'cannot_run' }]);
  check('reproduced + cannot_run -> potwierdzony blocker (REQUEST CHANGES)', reproCr.verdict === 'REQUEST CHANGES' && reproCr.findings[0].decision === 'blocker', `${reproCr.verdict} ${reproCr.incomplete.join(' | ')}`);
  const halfDown = run(twoBlockers, [{ finding_id: 'security-1', verdict: 'reproduced', severity_after: 'minor' }, { finding_id: 'security-2', verdict: 'cannot_run' }]);
  check('security A4: jeden reproduced z severity_after NIE obniza rownorzednej grupy (drugi bez reproduced)', halfDown.findings[0].severity === 'blocker' && halfDown.findings[0].decision === 'blocker', `${halfDown.findings[0].severity}`);
  const allDown = run(twoBlockers, [{ finding_id: 'security-1', verdict: 'reproduced', severity_after: 'minor' }, { finding_id: 'security-2', verdict: 'reproduced', severity_after: 'major' }]);
  check('obaj reproduced z severity_after -> najwyzsze z nich (major)', allDown.findings[0].severity === 'major', allDown.findings[0].severity);
  const reproMissing = run(twoBlockers, [{ finding_id: 'security-2', verdict: 'reproduced' }]);
  check('reproduced u jednego, drugi bez werdyktu -> potwierdzony (REQUEST CHANGES)', reproMissing.verdict === 'REQUEST CHANGES', `${reproMissing.verdict} ${reproMissing.incomplete.join(' | ')}`);
  const refCr = run(twoBlockers, [{ finding_id: 'security-1', verdict: 'not_reproduced' }, { finding_id: 'security-2', verdict: 'cannot_run' }]);
  check('not_reproduced + cannot_run -> INCOMPLETE, do weryfikatora tylko czlonek z cannot_run', refCr.verdict === 'INCOMPLETE' && refCr.needs_verification.join() === 'security-2' && refCr.findings[0].decision !== 'dropped', `${refCr.verdict} ${refCr.needs_verification} ${refCr.findings[0].decision}`);
  const allCr = run(twoBlockers, [{ finding_id: 'security-1', verdict: 'cannot_run' }, { finding_id: 'security-2', verdict: 'cannot_run' }]);
  // A3 security blocker: pola stanu agregacji wstrzykniete w findings.*.json nie moga zastapic weryfikatora.
  for (const inj of [{ verdict_ids: ['security-1'] }, { verdict: 'not_reproduced' }, { verdict: 'reproduced', decision: 'dropped' }, { verdict_conflict: true, needs_verification: false, verify_ids: [] }]) {
    const r = run([finding({ rule_id: 'RCE', severity: 'blocker', ...inj })], []);
    check(`wstrzykniete ${Object.keys(inj).join('+')} w findingu -> INCOMPLETE, blocker do weryfikatora`, r.verdict === 'INCOMPLETE' && r.needs_verification.join() === 'security-1', `${r.verdict} ${r.needs_verification}`);
  }
  check('wszyscy cannot_run na blockerze -> INCOMPLETE, obaj do weryfikatora', allCr.verdict === 'INCOMPLETE' && allCr.needs_verification.join() === 'security-1,security-2', `${allCr.verdict} ${allCr.needs_verification}`);
  const upper = run([finding({ rule_id: 'RCE', severity: 'Blocker' })], [{ finding_id: 'security-1', verdict: 'reproduced' }]);
  check('severity "Blocker" normalizowana -> blocker (REQUEST CHANGES)', upper.verdict === 'REQUEST CHANGES' && upper.findings[0].decision === 'blocker', upper.verdict);
  const critical = run([finding({ rule_id: 'RCE', severity: 'critical' })], []);
  check('severity spoza zbioru -> jawnie odrzucona w raporcie (kontrakt bez zmian)', critical.rejected.some((x) => x.why.includes('critical')), JSON.stringify(critical.rejected));
  const missingEvidence = run([finding({ rule_id: 'X', evidence: '' })], []);
  check('brak dowodu dalej = ciche odrzucenie (APPROVE, regula 1 bez zmian)', missingEvidence.verdict === 'APPROVE', missingEvidence.verdict);
} finally {
  fs.rmSync(alDir, { recursive: true, force: true });
}

// Regula 8: ten sam defekt z 2 dzialow pod innym rule_id (run A1 2026-11-01: SKILL.md:107-110 vs :107-111).
const xrDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-agg-xr-'));
try {
  fs.writeFileSync(path.join(xrDir, 'findings.code.json'), JSON.stringify({ findings: [
    finding({ file: 'skills/x.md', rule_id: 'DOC-CLAIM', line_range: [107, 111] }),
    finding({ file: 'skills/x.md', rule_id: 'WHOLE', line_range: [1, 400] }),
  ] }));
  fs.writeFileSync(path.join(xrDir, 'findings.product.json'), JSON.stringify({ findings: [
    finding({ file: 'skills/x.md', rule_id: 'NO-SINK', line_range: [107, 110] }),
    finding({ file: 'skills/x.md', rule_id: 'FAR', line_range: [300, 302] }),
  ] }));
  const r = aggregate(xrDir, null, { requiredRoles: ['code', 'product'] });
  check('minor z 2 dzialow, nakladajace sie linie, inne rule_id -> oba do weryfikatora', r.needs_verification.includes('code-1') && r.needs_verification.includes('product-1'), r.needs_verification.join());
  check('nie scala (agreement zostaje 1, brak falszywego must_fix)', r.findings.every((g) => g.agreement === 1 && g.decision === 'note'));
  check('zakres > 60 linii (caly plik) nie jest sygnalem', !r.needs_verification.includes('code-2'));
  check('ten sam plik bez nakladania -> bez weryfikacji', !r.needs_verification.includes('product-2'));
} finally {
  fs.rmSync(xrDir, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} FAIL` : '\nwszystkie OK');
process.exit(failures ? 1 : 0);

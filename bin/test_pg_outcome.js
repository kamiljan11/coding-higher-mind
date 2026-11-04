// Testy pg-outcome.js (rejestr decyzji po pg-review, Fala 0 M-A). Uruchom: node test_pg_outcome.js
// Fixture RUN powstaje prawdziwym pg-aggregate.js (schemat aggregated.json z zrodla, nie z reki). HOME w tmpdir:
// rejestr laduje w HOME/.claude/logs tymczasowym, nic nie trafia do prawdziwego ~/.claude/logs.
'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

let failures = 0;
const check = (name, cond, detail) => { if (cond) console.log('ok  ', name); else { failures++; console.log('FAIL', name, detail || ''); } };

const BIN = __dirname;
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-outcome-test-'));
const home = path.join(root, 'home');
fs.mkdirSync(home, { recursive: true });
const LOG = path.join(home, '.claude', 'logs', 'review-outcomes.jsonl');

const finding = (over) => Object.assign({ file: 'src/a.ts', line_range: [10, 12], rule_id: 'R-SQL', severity: 'major', claim: 'SEKRETNA TRESC claim', evidence: 'SEKRETNY evidence', repro_cmd: 'rg -n x src/a.ts' }, over);
const writeJson = (p, o) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(o)); };

// RUN: A = code+ops (agreement 2 -> must_fix), B = security minor sam (note), C = code blocker obalony przez weryfikatora (dropped)
function makeRun(name, opts) {
  const run = path.join(root, name);
  writeJson(path.join(run, 'findings.code.json'), { findings: [finding({}), finding({ file: 'src/c.ts', rule_id: 'R-AUTH', severity: 'blocker', line_range: [1, 2] })] });
  writeJson(path.join(run, 'findings.ops.json'), { findings: [finding({ line_range: [11, 13] })] });
  writeJson(path.join(run, 'findings.security.json'), { findings: [finding({ file: 'src/b.ts', rule_id: (opts && opts.ruleB) || 'R-LOG', severity: 'minor', line_range: [5, 6] })] });
  writeJson(path.join(run, 'verdicts.json'), { verdicts: [{ finding_id: 'code-2', verdict: 'not_reproduced', reason: 'nie powtarza sie' }] });
  const r = spawnSync('node', [path.join(BIN, 'pg-aggregate.js'), run, '--repo', '/x/repo-fixture', '--final', '--verdicts', path.join(run, 'verdicts.json'), '--json'], {
    // PG_GATE_LOG w tmpdir: fixture'y bez files_read nie moga pisac would_block do produkcyjnego gates.jsonl (A18 ops).
    encoding: 'utf8', env: Object.assign({}, process.env, { HOME: home, PG_GATE_LOG: path.join(root, 'gates-aggregate.jsonl') }),
  });
  if (r.status === 2 || !fs.existsSync(path.join(run, 'aggregated.json'))) throw new Error('fixture: pg-aggregate nie zadzialal: ' + r.stderr);
  return run;
}

const run = (args, env) => spawnSync('node', [path.join(BIN, 'pg-outcome.js'), ...args], {
  encoding: 'utf8', env: Object.assign({}, process.env, { HOME: home }, env || {}),
});
const rows = (file) => { try { return fs.readFileSync(file || LOG, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch (e) { return []; } };

const RUN1 = makeRun('run1');
const agg = JSON.parse(fs.readFileSync(path.join(RUN1, 'aggregated.json'), 'utf8'));
const idOf = (rule) => agg.findings.find((g) => g.rule_id === rule).id;
const A = idOf('R-SQL');
const B = idOf('R-LOG');
check('fixture: A must_fix (2 role), B note, C dropped', agg.findings.find((g) => g.id === A).decision === 'must_fix' && agg.findings.find((g) => g.id === B).decision === 'note'
  && agg.findings.find((g) => g.rule_id === 'R-AUTH').decision === 'dropped', JSON.stringify(agg.findings.map((g) => [g.id, g.decision])));

// 1. brak decyzji -> exit 1, lista id, nic nie zapisane
let r = run(['--run', RUN1, '--repo', '/srv/u/src/my-repo']);
check('brak decyzji -> exit 1', r.status === 1, `status=${r.status} ${r.stderr}`);
check('brak decyzji: stderr wymienia oba wymagane id', r.stderr.includes(A) && r.stderr.includes(B), r.stderr);
check('brak decyzji: nic nie zapisane', !fs.existsSync(LOG));
r = run(['--run', RUN1, '--decide', `${A}=fixed`]);
check('czesc decyzji -> nadal exit 1 (brakuje B)', r.status === 1 && r.stderr.includes(B) && !r.stderr.includes(`${A},`) && !fs.existsSync(LOG), r.stderr);

// 2. komplet decyzji -> exit 0, wiersze
r = run(['--run', RUN1, '--repo', '/srv/u/src/my-repo/', '--tier', 't2', '--decide', `${A}=fixed`, `${B}=dropped:false_positive`]);
check('komplet -> exit 0', r.status === 0, `status=${r.status} ${r.stderr}`);
let got = rows();
check('3 wiersze (A, B, C)', got.length === 3, JSON.stringify(got));
const rowA = got.find((x) => x.group_id === A);
const rowB = got.find((x) => x.group_id === B);
const rowC = got.find((x) => x.rule_id === 'R-AUTH');
check('grupa wielorolowa: roles = pelna lista', JSON.stringify(rowA.roles.slice().sort()) === '["code","ops"]' && rowA.agreement === 2, JSON.stringify(rowA));
check('outcome wg --decide', rowA.outcome === 'fixed' && rowB.outcome === 'dropped:false_positive');
check('dropped przez weryfikatora -> verifier_dropped automatycznie', rowC.outcome === 'verifier_dropped' && rowC.verdict === 'not_reproduced' && rowC.decision === 'dropped', JSON.stringify(rowC));
check('repo = basename (bez ukosnika koncowego), tier z --tier (wielkie litery)', rowA.repo === 'my-repo' && rowA.tier === 'T2', JSON.stringify(rowA));
const FIELDS = ['ts', 'run_key', 'repo', 'tier', 'group_id', 'roles', 'rule_id', 'severity', 'agreement', 'decision', 'verdict', 'outcome'];
check('dokladnie uzgodnione pola wiersza', rows().every((x) => JSON.stringify(Object.keys(x)) === JSON.stringify(FIELDS)), JSON.stringify(Object.keys(rowA)));
const rawLog = fs.readFileSync(LOG, 'utf8');
check('brak claim/evidence/repro/sciezek plikow w rejestrze', !/SEKRETN|claim|evidence|repro_cmd|src\/|\.ts/.test(rawLog), rawLog);
check('wszystkie wiersze maja ten sam run_key (16 hex)', new Set(got.map((x) => x.run_key)).size === 1 && /^[0-9a-f]{16}$/.test(got[0].run_key));

// 3. idempotencja
r = run(['--run', RUN1, '--decide', `${A}=fixed`, `${B}=fixed`]);
check('ponowny zapis tego samego RUN -> exit 0 + komunikat, bez dopisywania', r.status === 0 && /juz zapisany/.test(r.stdout) && rows().length === 3, r.stdout + r.stderr);

// 4. blad narzedzia -> exit 2
r = run(['--run', path.join(root, 'nie-ma')]);
check('brak aggregated.json -> exit 2', r.status === 2, `status=${r.status}`);
const bad = path.join(root, 'bad'); fs.mkdirSync(bad); fs.writeFileSync(path.join(bad, 'aggregated.json'), '{nie json');
r = run(['--run', bad]);
check('uszkodzony JSON -> exit 2 z nazwa pliku', r.status === 2 && r.stderr.includes('aggregated.json'), r.stderr);
const RUN2 = makeRun('run2', { ruleB: 'R-INNY' });
const idA2 = JSON.parse(fs.readFileSync(path.join(RUN2, 'aggregated.json'), 'utf8')).findings.find((g) => g.rule_id === 'R-SQL').id;
r = run(['--run', RUN2, '--decide', `${idA2}=wymyslone`]);
check('nieznany outcome -> exit 2', r.status === 2 && /nieznany outcome/.test(r.stderr), r.stderr);
r = run(['--run', RUN2, '--decide', 'zzz-9=fixed']);
check('nieznane id -> exit 2', r.status === 2 && /nieznane id/.test(r.stderr), r.stderr);
r = run(['--run', RUN2, '--decide', `${idA2}=fixed`, `${idA2}=kept_note`]);
check('podwojna decyzja dla grupy -> exit 2', r.status === 2 && /podwojna/.test(r.stderr), r.stderr);
r = run(['--run', RUN2, '--bzdura']);
check('nieznana flaga -> exit 2', r.status === 2, `status=${r.status}`);
check('bledy nic nie dopisaly', rows().length === 3);

// 5. tier: tier.json > --tier > unknown; repo z aggregated.json, gdy brak --repo; --decide powtarzane; rule_id sanityzowane
writeJson(path.join(RUN2, 'tier.json'), { tier: 'T3' });
const idB2 = JSON.parse(fs.readFileSync(path.join(RUN2, 'aggregated.json'), 'utf8')).findings.find((g) => g.rule_id === 'R-INNY').id;
// kept_note dla must_fix/blocker = blad uzycia (recenzja p345c code-1: blocker bez akcji wypadal z ulamka nieprzydatnych)
r = run(['--run', RUN2, '--decide', `${idA2}=kept_note`, `${idB2}=kept_note`]);
check('kept_note dla must_fix -> exit 2, nic nie zapisane', r.status === 2 && /kept_note niedozwolone/.test(r.stderr) && rows().length === 3, r.stderr);
r = run(['--run', RUN2, '--tier', 'T1', '--decide', `${idA2}=dropped:accepted_risk`, '--decide', `${idB2}=kept_note`]);
got = rows().filter((x) => x.run_key !== rowA.run_key);
check('tier.json wygrywa z --tier; repo z aggregated.json; dwa --decide', r.status === 0 && got.length === 3 && got.every((x) => x.tier === 'T3' && x.repo === 'repo-fixture'), r.stderr + JSON.stringify(got));
const RUN3 = path.join(root, 'run3');
writeJson(path.join(RUN3, 'aggregated.json'), { verdict: 'REQUEST CHANGES', incomplete: [], findings: [
  { id: 'solo-1', rule_id: '/srv/x/secret.env:token', severity: 'major', decision: 'must_fix', agreement: 1, roles: ['code'], file: 'x.ts', member_ids: ['solo-1'] }] });
r = run(['--run', RUN3, '--decide', 'solo-1=fixed']);
const row3 = rows().find((x) => x.group_id === 'solo-1');
check('bez tier.json i --tier -> unknown; rule_id bez ukosnikow/spacji', r.status === 0 && row3.tier === 'unknown' && !/[\/ ]/.test(row3.rule_id), JSON.stringify(row3));
check('member id mapuje na grupe', (() => {
  const run4 = path.join(root, 'run4');
  writeJson(path.join(run4, 'aggregated.json'), { findings: [{ id: 'code-1', member_ids: ['code-1', 'ops-1'], rule_id: 'R', severity: 'major', decision: 'must_fix', agreement: 2, roles: ['code', 'ops'], file: 'y.ts' }] });
  return run(['--run', run4, '--decide', 'ops-1=fixed']).status === 0;
})());

// 6. zmienne srodowiskowe nie przekierowuja rejestru (recenzja p345 security-1: TMPDIR + PG_OUTCOME_LOG pisaly dowolny plik)
const tmpA = path.join(root, 'tmpA'); fs.mkdirSync(tmpA);
const outside = path.join(tmpA, 'outside.jsonl');
const RUN5 = path.join(root, 'run5');
writeJson(path.join(RUN5, 'aggregated.json'), { findings: [{ id: 'e-1', rule_id: 'R', severity: 'major', decision: 'must_fix', agreement: 1, roles: ['code'], file: 'z.ts' }] });
const before = rows().length;
r = run(['--run', RUN5, '--decide', 'e-1=fixed'], { TMPDIR: tmpA, PG_OUTCOME_LOG: outside });
check('PG_OUTCOME_LOG/TMPDIR ignorowane -> zapis tylko do HOME/.claude/logs', r.status === 0 && !fs.existsSync(outside) && rows().length === before + 1, r.stdout + r.stderr);

// 7. run_key: inny RUN z identycznymi grupami = osobny wpis; ten sam RUN po ponownej agregacji = pominiety
const RUN6 = path.join(root, 'run6');
fs.mkdirSync(RUN6); fs.copyFileSync(path.join(RUN5, 'aggregated.json'), path.join(RUN6, 'aggregated.json'));
r = run(['--run', RUN6, '--decide', 'e-1=fixed']);
const keys = rows().filter((x) => x.group_id === 'e-1').map((x) => x.run_key);
check('identyczne findings w innym RUN -> nowy run_key, zapis', r.status === 0 && keys.length === 2 && keys[0] !== keys[1], JSON.stringify(keys) + r.stderr);
const agg5 = JSON.parse(fs.readFileSync(path.join(RUN5, 'aggregated.json'), 'utf8'));
agg5.generated_at = '2030-01-01T00:00:00.000Z';
writeJson(path.join(RUN5, 'aggregated.json'), agg5);
r = run(['--run', RUN5, '--decide', 'e-1=fixed']);
check('ten sam RUN po ponownej agregacji -> juz zapisany', r.status === 0 && /juz zapisany/.test(r.stdout), r.stdout + r.stderr);
r = run(['--run', RUN6, '--repo', 'inne-repo', '--decide', 'e-1=fixed']);
check('ten sam RUN z innym --repo -> juz zapisany (klucz = RUN)', r.status === 0 && /juz zapisany/.test(r.stdout) && rows().filter((x) => x.group_id === 'e-1').length === 2, r.stdout + r.stderr);

// 8. pola od agentow: enumy i znaki identyfikatora (recenzja p345: REGISTRY-UNSANITIZED-FIELDS)
const RUN7 = path.join(root, 'run7');
writeJson(path.join(RUN7, 'aggregated.json'), { repo: '/srv/a b/../../etc', findings: [
  { id: '../evil id', member_ids: ['../evil id'], rule_id: 'R', severity: 'krytyczny /home/x', decision: 'must_fix', agreement: 1, roles: ['code/../x'], file: 'z.ts', verdict: 'moze /tmp' }] });
writeJson(path.join(RUN7, 'tier.json'), { tier: 'T9 /home/x' });
r = run(['--run', RUN7, '--decide', '../evil id=fixed']);
const row7 = rows().find((x) => x.run_key && x.group_id.includes('evil'));
check('severity/verdict spoza enumu -> other; tier spoza T0-T3 -> unknown', r.status === 0 && row7 && row7.severity === 'other' && row7.verdict === 'other' && row7.tier === 'unknown', JSON.stringify(row7) + r.stderr);
check('group_id/roles/repo bez ukosnikow i spacji', row7 && ![row7.group_id, row7.repo].concat(row7.roles).some((v) => /[\/ ]/.test(v)), JSON.stringify(row7));

// 9. urwany ogon rejestru nie skleja sie z nowym wierszem (recenzja p345b data-1); --decide na grupie dropped = ostrzezenie
const tornHome = path.join(root, 'torn-home');
const tornLog = path.join(tornHome, '.claude', 'logs', 'review-outcomes.jsonl');
fs.mkdirSync(path.dirname(tornLog), { recursive: true });
fs.writeFileSync(tornLog, '{"run_key":"abc","outcome":"fix');
const RUN8 = path.join(root, 'run8');
writeJson(path.join(RUN8, 'aggregated.json'), { findings: [{ id: 'g1', rule_id: 'R', severity: 'major', decision: 'must_fix', agreement: 1, roles: ['data'], file: 'a' }] });
r = run(['--run', RUN8, '--decide', 'g1=fixed'], { HOME: tornHome });
const tornLines = fs.readFileSync(tornLog, 'utf8').split('\n').filter(Boolean);
check('urwany ogon: nowy wiersz w osobnej linii i parsowalny', r.status === 0 && tornLines.length === 2 && JSON.parse(tornLines[1]).group_id === 'g1', JSON.stringify(tornLines));
const codeDropped = agg.findings.find((g) => g.decision === 'dropped').id;
const RUN9 = path.join(root, 'run9');
fs.mkdirSync(RUN9); fs.copyFileSync(path.join(RUN1, 'aggregated.json'), path.join(RUN9, 'aggregated.json'));
r = run(['--run', RUN9, '--decide', `${A}=fixed`, `${B}=fixed`, `${codeDropped}=fixed`]);
check('--decide na grupie dropped: ostrzezenie, zapis verifier_dropped', r.status === 0 && /pominiete/.test(r.stderr)
  && rows().filter((x) => x.group_id === codeDropped).pop().outcome === 'verifier_dropped', r.stderr);

// 10. nieznana decision wymaga decyzji (nie cichy kept_note); zly tier.json = ostrzezenie (recenzja p345d code)
const RUN10 = path.join(root, 'run10');
writeJson(path.join(RUN10, 'aggregated.json'), { findings: [{ id: 'u1', rule_id: 'R', severity: 'major', decision: 'cos_nowego', agreement: 1, roles: ['ops'], file: 'a' }] });
fs.writeFileSync(path.join(RUN10, 'tier.json'), '{zepsuty');
const before10 = rows().length;
r = run(['--run', RUN10]);
check('nieznana decision bez --decide -> exit 1, nic nie zapisane', r.status === 1 && /brak decyzji/.test(r.stderr) && rows().length === before10, r.stderr);
r = run(['--run', RUN10, '--tier', 'T2', '--decide', 'u1=fixed']);
const row10 = rows().find((x) => x.group_id === 'u1');
check('zly tier.json -> ostrzezenie, tier z --tier', r.status === 0 && /tier.json nieczytelny/.test(r.stderr) && row10 && row10.tier === 'T2', r.stderr + JSON.stringify(row10));

// 11. HOME nadpisany -> ostrzezenie na stderr, zapis i exit bez zmian (2026-11-02: wyniki A30/A31 w logu klonu)
const { homeOverride } = require(path.join(BIN, 'pg-outcome.js'));
check('homeOverride: ten sam katalog (takze z koncowym /) -> brak ostrzezenia', homeOverride('/home/user', '/home/user/') === null && homeOverride('/home/user', null) === null);
check('homeOverride: inny HOME -> ostrzezenie z obiema sciezkami', /HOME=\/tmp\/k != \/home\/user/.test(homeOverride('/tmp/k', '/home/user') || ''));
const RUN11 = path.join(root, 'run11');
writeJson(path.join(RUN11, 'aggregated.json'), { findings: [{ id: 'h1', rule_id: 'R', severity: 'minor', decision: 'note', agreement: 1, roles: ['code'], file: 'a' }] });
r = run(['--run', RUN11, '--tier', 'T1', '--decide', 'h1=kept_note']);
check('CLI z HOME tymczasowym: exit 0, wiersz zapisany, UWAGA HOME na stderr', r.status === 0 && rows().some((x) => x.group_id === 'h1') && /UWAGA: HOME=/.test(r.stderr), r.stderr);

fs.rmSync(root, { recursive: true, force: true });
console.log(failures ? `\n${failures} FAIL` : '\nwszystko ok');
process.exit(failures ? 1 : 0);

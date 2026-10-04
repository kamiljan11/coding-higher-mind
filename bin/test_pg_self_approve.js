#!/usr/bin/env node
'use strict';
// Testy poziomow wyjatkow (2026-10-02): A = agent sam, B = pg-self-approve po recenzji subagentow, C = tylko fraza uzytkownika.
// Kontrakt: kazdy poziom ma przypadek „przepuszcza" i „blokuje"; podrobiona recenzja (puste findings bez transkryptu) = odmowa.
// Uruchom: node ~/.claude/bin/test_pg_self_approve.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-self-approve-'));
process.env.PG_GATE_LOG = path.join(TMP, 'gates.jsonl');
process.env.PG_OVERRIDES_DIR = path.join(TMP, 'overrides');
const CLAUDE = path.join(os.homedir(), '.claude');
const overrides = require(path.join(CLAUDE, 'hooks', 'lib', 'overrides.js'));
const { evaluate, fingerprint, filesOfPatch } = require(path.join(CLAUDE, 'bin', 'pg-self-approve.js'));
const { evaluate: evaluateBash } = require(path.join(CLAUDE, 'hooks', 'lib', 'bash-rules.js'));

let fails = 0;
function check(name, ok, detail) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !detail ? '' : ' :: ' + String(detail).slice(0, 300)}`);
  if (!ok) fails += 1;
}
const SID = 'sid-' + process.pid;
const git = (cwd, args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const guard = (command, cwd, sid) => spawnSync('node', [path.join(CLAUDE, 'hooks', 'bash-guard.js')], {
  input: JSON.stringify({ tool_name: 'Bash', tool_input: { command }, session_id: sid || SID, cwd }), encoding: 'utf8',
});
const approve = (args) => spawnSync('node', [path.join(CLAUDE, 'bin', 'pg-self-approve.js'), ...args], { encoding: 'utf8' });

// Wlaczony wylacznik (pg/self-approval.off) = wszystko poziomu C z zalozenia; testy A/B nie maja sensu (ops-review 2026-10-02).
if (fs.existsSync(overrides.KILL_SWITCH)) {
  check('wylacznik aktywny: A i B => C', ['ALLOW_LARGE_DIFF', 'ALLOW_RM'].every((n) => overrides.tierOf(n) === 'C'));
  console.log(fails ? `TESTY: ${fails} FAIL` : 'TESTY: wszystkie OK (wylacznik aktywny — testy A/B pominiete)');
  process.exit(fails ? 1 : 0);
}

// Poziomy (decyzja uzytkownika 2026-10-02: SECRET/MAIN/CI_DOWNGRADE/CONFIG/MERGE -> C, UNKNOWN_DEP/PII -> B)
check('tier: LARGE_DIFF = A', overrides.tierOf('ALLOW_LARGE_DIFF') === 'A');
check('tier: RM = B', overrides.tierOf('ALLOW_RM') === 'B');
check('tier: UNKNOWN_DEP = B, PII = B', overrides.tierOf('ALLOW_UNKNOWN_DEP') === 'B' && overrides.tierOf('ALLOW_PII') === 'B');
for (const c of ['ALLOW_CONTROL_PLANE', 'ALLOW_SECRET', 'ALLOW_MAIN', 'ALLOW_CI_DOWNGRADE', 'ALLOW_CONFIG', 'ALLOW_FORCE', 'ALLOW_MERGE']) {
  check(`tier: ${c} = C`, overrides.tierOf(c) === 'C');
}
check('tier: A i B rozlaczne', [...overrides.SELF_SERVICE].every((n) => !overrides.SELF_APPROVABLE.has(n)));

// Repo testowe
const repo = path.join(TMP, 'repo');
fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
git(repo, ['init', '-q']);
git(repo, ['config', 'user.email', 't@t']);
git(repo, ['config', 'user.name', 't']);
fs.writeFileSync(path.join(repo, 'src', 'a.js'), 'module.exports = 1;\n');
git(repo, ['add', '-A']);
git(repo, ['-c', 'core.hooksPath=' + path.join(TMP, 'nohooks'), 'commit', '-q', '-m', 'init']);
const other = path.join(TMP, 'other');
fs.mkdirSync(other);
git(other, ['init', '-q']);

// bash-guard: A przechodzi sam, B bez grantu i C blokuja
const a = guard('ALLOW_LARGE_DIFF=1 git push origin feat', repo);
check('bash-guard A: ALLOW_LARGE_DIFF=1 bez zgody => 0', a.status === 0, a.stderr);
check('bash-guard A: slad bypass w logu', /poziom A/.test(fs.readFileSync(process.env.PG_GATE_LOG, 'utf8')));
const b0 = guard('ALLOW_RM=1 rm -rf src', repo);
check('bash-guard B: bez samozatwierdzenia => 2 + podpowiedz pg-self-approve', b0.status === 2 && /pg-self-approve/.test(b0.stderr || ''), b0.stderr);
const c0 = guard('ALLOW_FORCE=1 git push --force origin main', repo);
check('bash-guard C: ALLOW_FORCE=1 => 2 (fraza uzytkownika)', c0.status === 2 && /poziomu C/.test(c0.stderr || ''), c0.stderr);

// Grant B (jak po pg-self-approve): dziala tylko w swoim repo, w swojej sesji, bez wychodzenia poza repo
const KEY_X = 'a'.repeat(64);
overrides.mintSelf(SID, repo, ['ALLOW_RM'], { run: path.join(TMP, 'run-x'), run_key: KEY_X, reason: 'test' });
check('sourceOf: B w repo grantu = self-approved', overrides.sourceOf(SID, 'ALLOW_RM', path.join(repo, 'src')) === 'self-approved');
check('sourceOf: B w innym repo = null', overrides.sourceOf(SID, 'ALLOW_RM', other) === null);
check('sourceOf: B w innej sesji = null', overrides.sourceOf('inna-sesja', 'ALLOW_RM', repo) === null);
check('sourceOf: grant B nie otwiera C', overrides.sourceOf(SID, 'ALLOW_FORCE', repo) === null);
// Najpierw odmowy (nie zuzywaja jedynego uzycia), na koncu przepuszczenie w repo.
for (const cmd of ['ALLOW_RM=1 rm -rf ../other', `ALLOW_RM=1 rm -rf "${other}"`, 'cd .. && ALLOW_RM=1 rm -rf repo', 'ALLOW_RM=1 git -C ../other clean -fdx', 'ALLOW_RM=1 rm -rf ~/x',
  'ALLOW_RM=1 rm -rf ${HOME}/victim', 'ALLOW_RM=1 rm -rf $USERPROFILE/victim', 'ALLOW_RM=1 rm -rf $(dirname $PWD)/other',
  'GIT_DIR=../other/.git GIT_WORK_TREE=../other ALLOW_RM=1 git clean -fdx',
  'ALLOW_RM=1 env --chdir=.. rm -rf repo', 'ALLOW_RM=1 rm -rf src/{..,.}/{..,.}/victim', 'ALLOW_RM=1 rm -rf <backup-drive>:', 'ALLOW_RM=1 rm -rf src/*/../../x']) {
  const r = guard(cmd, repo);
  check(`bash-guard B: poza repo => 2 :: ${cmd}`, r.status === 2, 'exit=' + r.status);
}
const b1 = guard('ALLOW_RM=1 rm -rf src', repo);
check('bash-guard B: z grantem, w repo => 0', b1.status === 0, b1.stderr);
const b2 = guard('ALLOW_RM=1 rm -rf src', repo);
check('bash-guard B: drugie uzycie grantu => 2 (1 uzycie)', b2.status === 2, 'exit=' + b2.status);
check('mintSelf: ten sam przebieg (ta sama tresc, inna sciezka) drugi raz => blad', (() => {
  try { overrides.mintSelf(SID, repo, ['ALLOW_RM'], { run: path.join(TMP, 'kopia-run-x'), run_key: KEY_X, reason: 'test' }); return false; } catch (e) { return /zuzyty/.test(e.message); }
})());
check('mintSelf: poziom C => blad', (() => {
  try { overrides.mintSelf(SID, repo, ['ALLOW_CONTROL_PLANE'], { run_key: 'b'.repeat(64), reason: 'test' }); return false; } catch (e) { return /poziomu B/.test(e.message); }
})());
check('mintSelf: bez run_key => blad', (() => {
  try { overrides.mintSelf(SID, repo, ['ALLOW_CLEAN'], { run: 'x', reason: 'test' }); return false; } catch (e) { return /run_key/.test(e.message); }
})());
overrides.mint('fraza-sid', ['ALLOW_RM']);
check('mintSelf: przy zywej zgodzie z frazy => blad, przebieg nie spalony', (() => {
  try { overrides.mintSelf('fraza-sid', repo, ['ALLOW_RM'], { run_key: 'c'.repeat(64), reason: 'test' }); return false; } catch (e) { return /zgode uzytkownika/.test(e.message); }
})() && (() => { try { overrides.mintSelf(SID, repo, ['ALLOW_CLEAN'], { run_key: 'c'.repeat(64), reason: 'test' }); return true; } catch (e) { return false; } })());
check('mintSelf: nie nadpisuje zgody uzytkownika z frazy', overrides.sourceOf('fraza-sid', 'ALLOW_RM', other) === 'session');

// Regula override-mint: wydanie sobie wyjatku przez node -e
const om = evaluateBash(`node -e "require('C:/Users/x/.claude/hooks/lib/overrides.js').mintSelf('s','.',['ALLOW_RM'],{run:'r'})"`, { dialect: 'sh', cwd: repo });
check('override-mint: node -e mintSelf => blok', om.blocks.some((b) => b.id === 'override-mint'), JSON.stringify(om.blocks));
const omOk = evaluateBash('node ~/.claude/bin/pg-self-approve.js --run r --repo . --allow ALLOW_RM --reason "sprzatanie"', { dialect: 'sh', cwd: repo });
check('override-mint: pg-self-approve.js przechodzi', !omOk.blocks.some((b) => b.id === 'override-mint'), JSON.stringify(omOk.blocks));

// evaluate(): czysta decyzja
const okAgg = { verdict: 'APPROVE', incomplete: [] };
const tr = [{ role: 'security', sid: 'S1', reviewedAt: 2000 }, { role: 'code', sid: 'S1', reviewedAt: 2000 }];
const base = { names: ['ALLOW_RM'], reason: 'sprzatanie artefaktow builda', agg: okAgg, runAgeMs: 1000, reviewFp: 'x', currentFp: 'x',
  transcripts: tr, findingsMtime: { security: 1000, code: 1000 } };
check('evaluate: komplet => sid sesji recenzji', evaluate(base).sid === 'S1', JSON.stringify(evaluate(base)));
check('evaluate: poziom C => odmowa', /poziom C/.test(evaluate({ ...base, names: ['ALLOW_SECRET'] }).why || ''));
check('evaluate: poziom A => odmowa z podpowiedzia', /poziom A/.test(evaluate({ ...base, names: ['ALLOW_TODO'] }).why || ''));
check('evaluate: krotki powod => odmowa', !!evaluate({ ...base, reason: 'bo tak' }).why);
check('evaluate: brak transkryptu security => odmowa', /security-reviewer/.test(evaluate({ ...base, transcripts: tr.slice(1) }).why || ''));
check('evaluate: findings bez rule_id zapisanego przez recenzenta => odmowa', /podmiana/.test(evaluate({ ...base, transcripts: [{ ...tr[0], ruleIds: ['SEC-1'] }, tr[1]], findingsIds: { security: [], code: [] } }).why || ''));
check('evaluate: findings z rule_id recenzenta => sid', evaluate({ ...base, transcripts: [{ ...tr[0], ruleIds: ['SEC-1'] }, tr[1]], findingsIds: { security: ['SEC-1'], code: [] } }).sid === 'S1');
check('evaluate: verdicts.json bez transkryptu verifier => odmowa',/verifier/.test(evaluate({ ...base, findingsMtime: { security: 1000, code: 1000, verifier: 1000 } }).why || ''));
check('evaluate: verdicts.json z transkryptem verifier => sid', evaluate({ ...base, transcripts: [...tr, { role: 'verifier', sid: 'S1', reviewedAt: 3000 }], findingsMtime: { security: 1000, code: 1000, verifier: 1000 } }).sid === 'S1');
check('evaluate: diff.patch nowszy niz transkrypty => odmowa',!!evaluate({ ...base, patchMtime: 9000 }).why);
check('evaluate: brak pliku findings roli => odmowa', !!evaluate({ ...base, findingsMtime: { security: Infinity, code: 1000 } }).why);
check('evaluate: findings zapisany przez orkiestratora po recenzencie, z jego rule_id => sid',
  evaluate({ ...base, transcripts: [{ ...tr[0], ruleIds: ['SEC-1'] }, tr[1]], findingsIds: { security: ['SEC-1'], code: [] }, findingsMtime: { security: 9000, code: 9000 } }).sid === 'S1');
check('evaluate: recenzenci z dwoch sesji => odmowa', !!evaluate({ ...base, transcripts: [tr[0], { ...tr[1], sid: 'S2' }] }).why);
check('evaluate: REQUEST_CHANGES => odmowa', !!evaluate({ ...base, agg: { verdict: 'REQUEST_CHANGES', incomplete: [] } }).why);
check('evaluate: przebieg > 2 h => odmowa', !!evaluate({ ...base, runAgeMs: 3 * 3600000 }).why);
check('evaluate: brak diff.patch => odmowa', !!evaluate({ ...base, runAgeMs: -1 }).why);
check('evaluate: inna zmiana => odmowa', /innej zmiany/.test(evaluate({ ...base, currentFp: 'y' }).why || ''));
check('evaluate: pusty diff => odmowa', !!evaluate({ ...base, reviewFp: '', currentFp: '' }).why);
check('fingerprint: ignoruje naglowki i kontekst', fingerprint('--- a/x\n+++ b/x\n ctx\n-a\n+b\n') === fingerprint('+++ q\n-a\r\n+b\n'));
check('filesOfPatch: sledzone i nowe', JSON.stringify(filesOfPatch('diff --git a/src/a.js b/src/a.js\n+x\ndiff --git a/dev/null b/src/n.js\n+y\n')) === '["src/a.js","src/n.js"]');

// End-to-end: podrobiona recenzja (puste findings, bez transkryptow subagentow) => odmowa
fs.writeFileSync(path.join(repo, 'src', 'a.js'), 'module.exports = 2;\n');
const run = path.join(TMP, 'pg-review-fake');
fs.mkdirSync(run);
fs.writeFileSync(path.join(run, 'diff.patch'), git(repo, ['diff', 'HEAD']).stdout);
fs.writeFileSync(path.join(run, 'findings.security.json'), JSON.stringify({ findings: [] }));
fs.writeFileSync(path.join(run, 'findings.code.json'), JSON.stringify({ findings: [] }));
const forged = approve(['--run', run, '--repo', repo, '--allow', 'ALLOW_CLEAN', '--reason', 'sprzatanie artefaktow builda']);
check('e2e: podrobione findings bez recenzentow => 1', forged.status === 1 && /transkryptu/.test(forged.stderr), forged.stderr + forged.stdout);
const cTry = approve(['--run', run, '--repo', repo, '--allow', 'ALLOW_CONTROL_PLANE', '--reason', 'chce wylaczyc bramki']);
check('e2e: CONTROL_PLANE przez samozatwierdzenie => 1', cTry.status === 1 && /poziom C/.test(cTry.stderr), cTry.stderr);

// End-to-end SCIEZKA SUKCESU: prawdziwy uklad transkryptow (projects/<proj>/<sesja>/subagents) w %TEMP%.
process.env.PG_PROJECTS_DIR = path.join(TMP, 'projects');
const E2E_SID = 'sesja-recenzji-' + process.pid;
const run2 = path.join(TMP, 'pg-review-ok');
fs.mkdirSync(run2);
fs.writeFileSync(path.join(run2, 'diff.patch'), git(repo, ['diff', 'HEAD']).stdout);
fs.writeFileSync(path.join(run2, 'findings.security.json'), JSON.stringify({ role: 'security', findings: [] }));
fs.writeFileSync(path.join(run2, 'findings.code.json'), JSON.stringify({ role: 'code', findings: [] }));
const subDir = path.join(process.env.PG_PROJECTS_DIR, 'proj', E2E_SID, 'subagents');
fs.mkdirSync(subDir, { recursive: true });
const later = new Date(Date.now() + 5000).toISOString();
for (const [id, type] of [['s1', 'security-reviewer'], ['c1', 'code-reviewer']]) {
  fs.writeFileSync(path.join(subDir, `agent-${id}.meta.json`), JSON.stringify({ agentType: type }));
  fs.writeFileSync(path.join(subDir, `agent-${id}.jsonl`), [
    JSON.stringify({ type: 'user', timestamp: later, message: { content: `Diff: ${run2.replace(/\\/g, '/')}/diff.patch` } }),
    JSON.stringify({ type: 'assistant', timestamp: later, message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: run2 + '/diff.patch' } }] } }),
  ].join('\n') + '\n');
}
const okRun = approve(['--run', run2, '--repo', repo, '--allow', 'ALLOW_CLEAN', '--reason', 'sprzatanie artefaktow builda']);
check('e2e sukces: transkrypty security+code => 0', okRun.status === 0 && /wydano ALLOW_CLEAN/.test(okRun.stdout), okRun.stderr + okRun.stdout);
check('e2e sukces: wyjatek w sesji recenzji, w repo', overrides.sourceOf(E2E_SID, 'ALLOW_CLEAN', repo) === 'self-approved');
check('e2e sukces: starszy hook (has) nie widzi grantu B', overrides.has(E2E_SID, 'ALLOW_CLEAN') === false);
const again = approve(['--run', run2, '--repo', repo, '--allow', 'ALLOW_CLEAN', '--reason', 'sprzatanie artefaktow builda']);
check('e2e: ten sam przebieg drugi raz => 1 (zuzyty)', again.status === 1 && /zuzyty/.test(again.stderr), again.stderr);
fs.writeFileSync(path.join(run2, 'findings.x.json'), JSON.stringify({ findings: [] }));
const extra = approve(['--run', run2, '--repo', repo, '--allow', 'ALLOW_CLEAN', '--reason', 'sprzatanie artefaktow builda']);
check('e2e: dopisany findings.x.json nie daje nowego klucza => 1', extra.status === 1 && /zuzyty/.test(extra.stderr), extra.stderr);
const pii = approve(['--run', run2, '--repo', repo, '--allow', 'ALLOW_PII', '--reason', 'nowa kolumna email w profilu']);
check('e2e: PII bez recenzji data => 1', pii.status === 1 && /data/.test(pii.stderr), pii.stderr);
for (const cmd of ['ALLOW_CLEAN=1 sh -c "git clean -fdx .."', 'ALLOW_CLEAN=1 bash -c "cd .. && git clean -fdx"', 'ALLOW_CLEAN=1 git clean -fdx "a b/../.."',
  "ALLOW_CLEAN=1 sh -c 'cd .. && git clean -fdx'", 'ALLOW_CLEAN=1 xargs -a list.txt git clean -fdx', 'ALLOW_CLEAN=1; cd..; git clean -fdx']) {
  const r = guard(cmd, repo, E2E_SID);
  check(`bash-guard B: wrapper/cytat poza repo => 2 :: ${cmd}`, r.status === 2, 'exit=' + r.status);
}
const om2 = evaluateBash(`node -e "const {mintSelf}=require('./hooks/lib/overrides'); mintSelf()"`, { dialect: 'sh', cwd: repo });
check('override-mint: destrukturyzacja => blok', om2.blocks.some((b) => b.id === 'override-mint'));
for (const cmd of [`python -c "import os;os.remove(os.path.expanduser('~/.claude/pg/self-approval.off'))"`,
  `node -e "require('fs').unlinkSync(require('os').homedir()+'/.claude/pg/self-approval.off')"`]) {
  const r = evaluateBash(cmd, { dialect: 'sh', cwd: repo });
  check(`wylacznik: kasowanie interpreterem => control-plane :: ${cmd.slice(0, 40)}`, r.blocks.some((b) => b.id === 'control-plane'), JSON.stringify(r.blocks));
}
// Recenzent bez Write oddaje findings TEKSTEM — rule_id z tekstu asystenta tez wiaza plik.
const subDir2 = path.join(process.env.PG_PROJECTS_DIR, 'proj', E2E_SID + '-txt', 'subagents');
fs.mkdirSync(subDir2, { recursive: true });
const run3 = path.join(TMP, 'pg-review-txt');
fs.mkdirSync(run3);
fs.writeFileSync(path.join(run3, 'diff.patch'), git(repo, ['diff', 'HEAD']).stdout);
for (const [id, type, text] of [['s2', 'security-reviewer', 'Werdykt: {"findings":[{"rule_id":"SEC-TXT-1","severity":"minor"}]}'], ['c2', 'code-reviewer', 'brak findings']]) {
  fs.writeFileSync(path.join(subDir2, `agent-${id}.meta.json`), JSON.stringify({ agentType: type }));
  fs.writeFileSync(path.join(subDir2, `agent-${id}.jsonl`), [
    JSON.stringify({ type: 'user', timestamp: later, message: { content: `Diff: ${run3.replace(/\\/g, '/')}/diff.patch` } }),
    JSON.stringify({ type: 'assistant', timestamp: later, message: { content: [{ type: 'text', text }] } }),
  ].join('\n') + '\n');
}
fs.writeFileSync(path.join(run3, 'findings.security.json'), JSON.stringify({ role: 'security', findings: [] }));
fs.writeFileSync(path.join(run3, 'findings.code.json'), JSON.stringify({ role: 'code', findings: [] }));
const txtForged = approve(['--run', run3, '--repo', repo, '--allow', 'ALLOW_CLEAN', '--reason', 'sprzatanie artefaktow builda']);
check('e2e: findings z tekstu recenzenta usuniete przez orkiestratora => 1', txtForged.status === 1 && /SEC-TXT-1/.test(txtForged.stderr), txtForged.stderr);

// Ksiega przebiegow: przyciecie wpisow > 2 dni i oddanie przebiegu, gdy grant nie powstal (data-review 2026-10-02).
const ledger = path.join(process.env.PG_OVERRIDES_DIR, 'self-approval-runs.json');
const oldKey = 'd'.repeat(64);
const led = JSON.parse(fs.readFileSync(ledger, 'utf8'));
led.runs[oldKey] = Date.now() - 3 * 86400000;
fs.writeFileSync(ledger, JSON.stringify(led));
overrides.mintSelf(SID + '-p', repo, ['ALLOW_CLEAN'], { run_key: 'e'.repeat(64), reason: 'test' });
check('ksiega: wpis starszy niz 2 dni przyciety', !(oldKey in JSON.parse(fs.readFileSync(ledger, 'utf8')).runs));
const lockSid = SID + '-lock';
fs.writeFileSync(path.join(process.env.PG_OVERRIDES_DIR, lockSid + '.json.lock'), ''); // swiezy lock = timeout grantu
const lockFail = (() => { try { overrides.mintSelf(lockSid, repo, ['ALLOW_CLEAN'], { run_key: 'f'.repeat(64), reason: 'test' }); return false; } catch (e) { return /lock timeout/.test(e.message); } })();
check('ksiega: blad grantu (lock timeout) => przebieg oddany', lockFail && !('f'.repeat(64) in JSON.parse(fs.readFileSync(ledger, 'utf8')).runs));

// Sprzatanie po tresci, nie po mtime (incydent 2026-10-02: zegar 2022 -> mtime 2022 -> skasowany zywy wyjatek)
overrides.mint('zywy', ['ALLOW_RM']);
const live = path.join(process.env.PG_OVERRIDES_DIR, 'zywy.json');
fs.utimesSync(live, new Date('2022-09-09'), new Date('2022-09-09'));
overrides.mint('inny', ['ALLOW_TODO']); // wydanie = sweep
check('sweep: zywy wyjatek z mtime 2022 przetrwa', fs.existsSync(live) && overrides.has('zywy', 'ALLOW_RM'));
const dead = path.join(process.env.PG_OVERRIDES_DIR, 'martwy.json');
fs.writeFileSync(dead, JSON.stringify({ grants: { ALLOW_RM: { expires: Date.now() - 3 * 86400000, uses_left: 1 } } }));
overrides.mint('inny2', ['ALLOW_TODO']);
check('sweep: wyjatek wygasly > 2 dni temu skasowany', !fs.existsSync(dead));

// Wylacznik: pg/self-approval.off => A i B wracaja do frazy (sprawdzane tylko, gdy pliku nie ma — nie ruszamy produkcji)
if (!fs.existsSync(overrides.KILL_SWITCH)) check('wylacznik: sciezka w pg/', /[\\/]pg[\\/]self-approval\.off$/.test(overrides.KILL_SWITCH));

try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* Windows: plik trzymany przez proces */ }
console.log(fails ? `TESTY: ${fails} FAIL` : 'TESTY: wszystkie OK');
process.exit(fails ? 1 : 0);

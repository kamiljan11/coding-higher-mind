'use strict';
// Testy Fali 0 / M-B (pg/designs/2026-11-01-fala-0-pomiar.md §11.1-11.2): pola `origin`/`ep`/`gate` w gate-log.js
// i wpis `blocked` z nazwa bramki przy kazdym blokujacym wyjsciu git-hookow (commit-msg, pre-push, pre-commit).
// Hooki z TEGO drzewa (path.join(__dirname, '..')) przez sztuczny HOME z dowiazaniem .claude -> to drzewo;
// telemetria tylko do PG_GATE_LOG w tmpdir, produkcyjny gates.jsonl nietkniety.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-fala0-'));
const FAKE_HOME = path.join(TMP, 'home');
fs.mkdirSync(FAKE_HOME, { recursive: true });
fs.symlinkSync(ROOT, path.join(FAKE_HOME, '.claude'));
const GIT_CFG = path.join(TMP, 'gitconfig');
fs.writeFileSync(GIT_CFG, '[user]\n\tname = PG Test\n\temail = test@example.invalid\n[init]\n\tdefaultBranch = main\n');
const GATE_LOG = path.join(TMP, 'gates.jsonl');

let failed = 0;
function check(name, ok, detail) {
  console.log((ok ? 'OK   ' : 'FAIL ') + name + (ok ? '' : '  -> ' + (detail || '')));
  if (!ok) failed++;
}
const baseEnv = (extra) => {
  const env = Object.assign({}, process.env, { HOME: FAKE_HOME, GIT_CONFIG_GLOBAL: GIT_CFG, GIT_CONFIG_NOSYSTEM: '1', PG_GATE_LOG: GATE_LOG }, extra || {});
  for (const k of ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT']) if (!(extra && k in extra)) delete env[k];
  return env;
};
const readLog = () => (fs.existsSync(GATE_LOG) ? fs.readFileSync(GATE_LOG, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const resetLog = () => { try { fs.unlinkSync(GATE_LOG); } catch (e) { /* brak = czysto */ } };
const blockedOf = (hook) => readLog().filter((e) => e.hook === hook && e.event === 'blocked');
const git = (cwd, args) => spawnSync('git', args, { cwd, encoding: 'utf8', env: baseEnv() });
function makeRepo(name, files) {
  const dir = path.join(TMP, name);
  fs.mkdirSync(dir, { recursive: true });
  git(dir, ['init', '-q']);
  for (const [f, c] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), c); }
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'chore: init']);
  return dir;
}
const GATE_LOG_JS = path.join(ROOT, 'hooks', 'lib', 'gate-log.js');
const hook = (name) => path.join(ROOT, 'git-hooks', name);

// ---------- gate-log.js: kolejnosc pol, gate, origin ----------
resetLog();
let r = spawnSync(process.execPath, [GATE_LOG_JS, 'pre-commit', 'blocked', 'rc=1', '/srv/repo', 'SECRET'], { env: baseEnv(), encoding: 'utf8' });
let e = readLog()[0] || {};
check('gate-log CLI: exit 0', r.status === 0, 'exit=' + r.status);
check('gate-log CLI: pole gate', e.gate === 'SECRET', JSON.stringify(e));
check('gate-log: przekierowany log => origin=test', e.origin === 'test', JSON.stringify(e));
check('gate-log: nowe pola PO polach wpisu (sasiedztwo hook/event/reason/target)',
  JSON.stringify(Object.keys(e)) === JSON.stringify(['ts', 'pid', 'hook', 'event', 'reason', 'target', 'gate', 'origin']), JSON.stringify(Object.keys(e)));
check('gate-log: regex sasiedztwa z test_module_boundaries nadal pasuje', /"hook":"pre-commit","event":"blocked","reason":"rc=1"/.test(fs.readFileSync(GATE_LOG, 'utf8')), '');
resetLog();
r = spawnSync(process.execPath, [GATE_LOG_JS, 'pre-commit', 'skipped', 'x', '/srv/repo'], { env: baseEnv(), encoding: 'utf8' });
check('gate-log CLI: 4 argumenty jak dotad (bez pola gate)', r.status === 0 && !('gate' in (readLog()[0] || {})), JSON.stringify(readLog()[0]));
r = spawnSync(process.execPath, [GATE_LOG_JS, 'pre-commit', 'zle'], { env: baseEnv(), encoding: 'utf8' });
check('gate-log CLI: zly event => exit 2 (blad narzedzia)', r.status === 2, 'exit=' + r.status);

// originOf bez przekierowania: osobny HOME w tmp, wiec PROD_LOG = <tmp>/home2/.claude/logs (nie prawdziwy log).
const HOME2 = path.join(TMP, 'home2');
fs.mkdirSync(HOME2, { recursive: true });
const originProbe = (extra, target) => {
  const env = Object.assign({}, process.env, { HOME: HOME2 }, extra);
  delete env.PG_GATE_LOG;
  for (const k of ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT']) if (!(k in extra)) delete env[k];
  const code = `const g=require(${JSON.stringify(GATE_LOG_JS)});process.stdout.write(g.originOf(${JSON.stringify(target)}))`;
  return spawnSync(process.execPath, ['-e', code], { env, encoding: 'utf8' }).stdout;
};
check('origin: zwykly terminal => human', originProbe({}, '/srv/repo') === 'human', originProbe({}, '/srv/repo'));
check('origin: CLAUDECODE => agent', originProbe({ CLAUDECODE: '1' }, '/srv/repo') === 'agent', '');
check('origin: CLAUDE_CODE_ENTRYPOINT => agent', originProbe({ CLAUDE_CODE_ENTRYPOINT: 'cli' }, '/srv/repo') === 'agent', '');
check('origin: target w tmpdir => tmp (przed agent)', originProbe({ CLAUDECODE: '1' }, path.join(os.tmpdir(), 'fx') + ';/home/y') === 'tmp', '');
resetLog();
spawnSync(process.execPath, [GATE_LOG_JS, 'pre-push', 'skipped', 'x', '/srv/repo'], { env: baseEnv({ CLAUDE_CODE_ENTRYPOINT: 'claude-desktop' }), encoding: 'utf8' });
check('gate-log: ep = CLAUDE_CODE_ENTRYPOINT', (readLog()[0] || {}).ep === 'claude-desktop', JSON.stringify(readLog()[0]));

// ---------- commit-msg ----------
const msgFile = path.join(TMP, 'MSG');
const runMsg = (subject) => { fs.writeFileSync(msgFile, subject + '\n'); return spawnSync('sh', [hook('commit-msg'), msgFile], { cwd: TMP, env: baseEnv(), encoding: 'utf8' }); };
resetLog();
r = runMsg('zly opis bez typu');
let b = blockedOf('commit-msg');
check('commit-msg: zly subject => exit 1 (status bez zmian)', r.status === 1, 'exit=' + r.status);
check('commit-msg: wpis blocked gate=MSG reason=rc=1', b.length === 1 && b[0].gate === 'MSG' && b[0].reason === 'rc=1', JSON.stringify(b));
resetLog();
r = runMsg('fix(gates): log blocked exits');
check('commit-msg: dobry subject => exit 0 i zero wpisow blocked', r.status === 0 && blockedOf('commit-msg').length === 0, 'exit=' + r.status + ' ' + JSON.stringify(readLog()));
resetLog();
r = runMsg('fix: token ' + 'gh' + 'p_' + 'A'.repeat(36));
b = blockedOf('commit-msg');
check('commit-msg: sekret w tresci => exit 1, gate=SECRET', r.status === 1 && b.length === 1 && b[0].gate === 'SECRET', 'exit=' + r.status + ' ' + JSON.stringify(b));

// ---------- pre-push ----------
const ppRepo = makeRepo('prepush', { 'a.txt': 'a\n' });
const ppSha = git(ppRepo, ['rev-parse', 'HEAD']).stdout.trim();
const ZERO = '0'.repeat(40);
const runPush = (branch, extra) => spawnSync('sh', [hook('pre-push'), 'origin', 'file:///x'], {
  cwd: ppRepo, input: `refs/heads/${branch} ${ppSha} refs/heads/${branch} ${ZERO}\n`, encoding: 'utf8', timeout: 60000, env: baseEnv(Object.assign({ ALLOW_FOREIGN_BRANCH: '1' }, extra || {})),
});
resetLog();
r = runPush('main');
b = blockedOf('pre-push');
check('pre-push: push na main => exit 1, gate=MAIN', r.status === 1 && b.length === 1 && b[0].gate === 'MAIN', 'exit=' + r.status + ' ' + JSON.stringify(b) + ' ' + (r.stderr || '').slice(0, 200));
check('pre-push: target = katalog repo', b[0] && fs.realpathSync(b[0].target) === fs.realpathSync(ppRepo), JSON.stringify(b[0]));
resetLog();
r = runPush('feat/x');
check('pre-push: feature => exit 0 i zero wpisow blocked', r.status === 0 && blockedOf('pre-push').length === 0, 'exit=' + r.status + ' ' + JSON.stringify(readLog()));

// ---------- pre-commit ----------
const pcRepo = makeRepo('precommit', { 'README.md': 'x\n' });
fs.mkdirSync(path.join(pcRepo, 'src'), { recursive: true });
fs.writeFileSync(path.join(pcRepo, 'src', 'cfg.js'), "const t = '" + 'gh' + 'p_' + 'abcdefghijklmnopqrstuvwxyz1234567890' + "';\n");
git(pcRepo, ['add', '-A']);
resetLog();
r = spawnSync('sh', [hook('pre-commit')], { cwd: pcRepo, encoding: 'utf8', timeout: 120000, env: baseEnv() });
b = blockedOf('pre-commit');
check('pre-commit: sekret w diffie => exit 1, gate=SECRET', r.status === 1 && b.length === 1 && b[0].gate === 'SECRET', 'exit=' + r.status + ' ' + JSON.stringify(b) + ' ' + (r.stderr || '').slice(0, 200));

// HUSKY (pg-review 2026-11-01: `|| pg_gate=HUSKY; exit 1` bez klamer = exit 1 ZAWSZE, kazdy commit w repo z trustHusky
// blokowany; test SECRET tego nie widzial). Oba kierunki: zielony husky => 0 i zero `blocked`, czerwony => 1 i gate=HUSKY.
const hkRepo = makeRepo('husky', { 'README.md': 'x\n' });
git(hkRepo, ['config', '--local', 'mas.trustHusky', 'true']);
fs.mkdirSync(path.join(hkRepo, '.husky'), { recursive: true });
fs.writeFileSync(path.join(hkRepo, 'note.txt'), 'n\n');
git(hkRepo, ['add', 'note.txt']);
for (const [rc, want] of [[0, 0], [3, 1]]) {
  fs.writeFileSync(path.join(hkRepo, '.husky', 'pre-commit'), `exit ${rc}\n`);
  resetLog();
  r = spawnSync('sh', [hook('pre-commit')], { cwd: hkRepo, encoding: 'utf8', timeout: 120000, env: baseEnv() });
  b = blockedOf('pre-commit');
  check(`pre-commit: husky exit ${rc} => hook exit ${want}, blocked ${want ? 'gate=HUSKY' : 'brak'}`,
    r.status === want && (want ? b.length === 1 && b[0].gate === 'HUSKY' : b.length === 0), 'exit=' + r.status + ' ' + JSON.stringify(b) + ' ' + (r.stderr || '').slice(0, 200));
}

// Statycznie, cala klasa bledu: kazde `exit 1` w trzech hookach ma wlasna nazwe bramki tuz przed soba,
// a nazwa nie wisi na golym `||`/`&&` (wtedy `; exit 1` wykonuje sie bezwarunkowo).
for (const name of ['pre-commit', 'pre-push', 'commit-msg']) {
  const bad = fs.readFileSync(hook(name), 'utf8').split('\n')
    .map((l, i) => [i + 1, l]).filter(([, l]) => !/^\s*#/.test(l) && /\bexit 1\b/.test(l))
    .filter(([, l]) => !/pg_gate=[A-Z_]+; exit 1\b/.test(l) || /(\|\||&&)\s*pg_gate=/.test(l));
  check(`${name}: kazde exit 1 nazwane i nie pod golym ||/&&`, bad.length === 0, JSON.stringify(bad));
}

// ---------- trap: status bez zmian i UNKNOWN dla wyjscia bez nazwy (dash = /bin/sh) ----------
const trapSrc = fs.readFileSync(hook('commit-msg'), 'utf8').split('\n');
const start = trapSrc.findIndex((l) => l.startsWith('pg_on_exit() {'));
const end = trapSrc.indexOf('trap pg_on_exit EXIT');
const trapBlock = trapSrc.slice(start, end + 1).join('\n');
for (const rc of [0, 1, 2]) {
  resetLog();
  const s = spawnSync('sh', ['-c', trapBlock + `\nexit ${rc}`], { cwd: TMP, env: baseEnv(), encoding: 'utf8' });
  const n = blockedOf('commit-msg');
  check(`trap: exit ${rc} => status ${rc}, wpisow blocked ${rc ? 1 : 0}`, s.status === rc && n.length === (rc ? 1 : 0), 'exit=' + s.status + ' ' + JSON.stringify(n));
  if (rc === 2) check('trap: wyjscie bez nazwy => gate=UNKNOWN, reason=rc=2', n[0] && n[0].gate === 'UNKNOWN' && n[0].reason === 'rc=2', JSON.stringify(n));
}
resetLog();
let s = spawnSync('sh', ['-c', trapBlock + '\nexit 1'], { cwd: TMP, env: Object.assign(baseEnv(), { HOME: path.join(TMP, 'no-home') }), encoding: 'utf8' });
check('trap: brak gate-log.js => status 1, nic nie zapisane, bez bledu', s.status === 1 && readLog().length === 0 && !s.stderr, 'exit=' + s.status + ' ' + s.stderr);

fs.rmSync(TMP, { recursive: true, force: true });
console.log(failed ? `\n${failed} FAIL` : '\nALL OK');
process.exit(failed ? 1 : 0);

#!/usr/bin/env node
// Kopia PG na GitHubie (2026-09-26): ~/.claude na Zenbooku <-> prywatne repo <github-owner>/<your-private-pg-repo>.
// Laptop z Linuksem dostaje ~/.claude przez Syncthing (folder claude-config, bez .git i settings.json — DEVICES.md);
// git i commity sa tylko na Zenbooku. pull przydaje sie przy odtwarzaniu albo drugim klonie. Kierunki:
//   status  — fetch + ile commitow do wyslania/pobrania; stan do logs/pg-sync-state.json (czyta go session-context).
//   push    — wysyla lokalne commity PG (tylko fast-forward, nigdy force). Odmawia, gdy origin ma nowsze commity.
//   pull    — pobiera zmiany z drugiej maszyny. To ZMIANA BRAMEK na tej maszynie, wiec wymaga zgody uzytkownika:
//             `pozwol ALLOW_CONTROL_PLANE` w czacie, potem `ALLOW_CONTROL_PLANE=1 node ~/.claude/bin/pg-sync.js pull`
//             (podglad: log + pelny diff, nic nie scala), a po przejrzeniu `... pull --apply`.
//             Po pobraniu: golden suite bramek + nowa pieczec tej maszyny.
// Pieczec (hooks/.seal.json) jest per maszyna i nie jedzie przez gita — jej zgoda pochodzi z lokalnego logu bramek.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { CONTROL_PLANE } = require(path.join(__dirname, '..', 'hooks', 'lib', 'overrides.js'));

// PG_SYNC_DIR = repo testowe; honorowane tylko w %TEMP% (ten sam wzorzec co PG_GATE_LOG / PG_PRECOMPACT_DIR).
const real = (p) => { try { return fs.realpathSync.native(p).toLowerCase(); } catch (e) { return ''; } }; // 8.3 vs dluga nazwa
const envDir = process.env.PG_SYNC_DIR && real(process.env.PG_SYNC_DIR).startsWith(real(os.tmpdir()) + path.sep) ? path.resolve(process.env.PG_SYNC_DIR) : '';
if (process.env.PG_SYNC_DIR && !envDir) { process.stderr.write(`pg-sync: PG_SYNC_DIR poza %TEMP% albo nie istnieje: ${process.env.PG_SYNC_DIR}\n`); process.exit(2); }
const DIR = envDir || path.join(os.homedir(), '.claude');
const STATE = path.join(DIR, 'logs', 'pg-sync-state.json');
const BRANCH = 'main';

function git(args, timeout = 60000) {
  const r = spawnSync('git', ['-C', DIR, ...args], { encoding: 'utf8', timeout, windowsHide: true });
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() || (r.error ? String(r.error.message) : '') };
}

function log(event, reason) {
  try { require(path.join(DIR, 'hooks', 'lib', 'gate-log.js')).log({ hook: 'pg-sync', event, reason, target: DIR }); } catch (e) { /* telemetria nie blokuje synchronizacji */ }
}

function status(quiet) {
  // Laptop dostaje ~/.claude przez Syncthing BEZ .git (DEVICES.md) — tam nie ma czego sprawdzac.
  if (!fs.existsSync(path.join(DIR, '.git'))) { if (!quiet) process.stdout.write('pg-sync: ~/.claude bez gita (maszyna na Syncthingu) — git tylko na Zenbooku.\n'); return null; }
  const f = git(['fetch', '-q', 'origin', BRANCH], 30000);
  if (!f.ok) {
    if (!quiet) process.stdout.write(`pg-sync: fetch nieudany (${f.err.slice(0, 160)}) — brak sieci albo autoryzacji GitHuba\n`);
    return null;
  }
  const counts = git(['rev-list', '--left-right', '--count', `HEAD...origin/${BRANCH}`]).out.split(/\s+/).map(Number);
  const dirty = git(['status', '--porcelain', '--untracked-files=no']).out.split('\n').filter(Boolean).length;
  const st = { checked_at: new Date().toISOString(), host: os.hostname(), ahead: counts[0] || 0, behind: counts[1] || 0, dirty,
    remote_head: git(['rev-parse', '--short', `origin/${BRANCH}`]).out };
  try { fs.mkdirSync(path.dirname(STATE), { recursive: true }); fs.writeFileSync(STATE, JSON.stringify(st, null, 2) + '\n'); } catch (e) { /* stan tylko informacyjny */ }
  if (!quiet) process.stdout.write(`pg-sync: do wyslania ${st.ahead}, do pobrania ${st.behind}, zmienione niezacommitowane ${dirty} (origin ${st.remote_head})\n`);
  return st;
}

function push() {
  const st = status(false);
  if (!st) return 1;
  if (st.behind > 0) { process.stdout.write('pg-sync: origin ma nowsze commity z drugiej maszyny — najpierw pull (za zgoda uzytkownika), potem push.\n'); return 1; }
  if (st.ahead === 0) { process.stdout.write('pg-sync: nic do wyslania.\n'); return 0; }
  const p = git(['push', 'origin', `HEAD:refs/heads/${BRANCH}`], 120000);
  process.stdout.write(p.ok ? `pg-sync: wyslano ${st.ahead} commitow.\n` : `pg-sync: push nieudany: ${p.err.slice(0, 300)}\n`);
  log(p.ok ? 'ran' : 'skipped', `push ${st.ahead} commitow: ${p.ok ? 'ok' : 'blad'}`);
  status(true);
  return p.ok ? 0 : 1;
}

function pull() {
  if (process.env[CONTROL_PLANE] !== '1') {
    process.stdout.write('pg-sync: pull zmienia bramki tej maszyny — wymaga zgody uzytkownika: fraza „pozwol ALLOW_CONTROL_PLANE" w czacie, potem ALLOW_CONTROL_PLANE=1 node ~/.claude/bin/pg-sync.js pull\n');
    return 2;
  }
  const st = status(false);
  if (!st) return 1;
  if (st.behind === 0) { process.stdout.write('pg-sync: nic do pobrania.\n'); return 0; }
  process.stdout.write(git(['log', '--oneline', `HEAD..origin/${BRANCH}`]).out + '\n' + git(['diff', '--stat', `HEAD...origin/${BRANCH}`]).out + '\n');
  // Bez --apply: pelny diff do przejrzenia i NIC nie jest scalane (recenzja 2026-09-26: scalanie bez pokazania zmian).
  if (!process.argv.includes('--apply')) {
    process.stdout.write(git(['diff', `HEAD...origin/${BRANCH}`], 60000).out.slice(0, 200000) + '\n\npg-sync: to byl podglad. Po przejrzeniu: ALLOW_CONTROL_PLANE=1 node ~/.claude/bin/pg-sync.js pull --apply\n');
    return 0;
  }
  const before = git(['rev-parse', 'HEAD']).out;
  let m = git(['merge', '--ff-only', `origin/${BRANCH}`]);
  if (!m.ok && st.ahead > 0) m = git(['merge', '--no-edit', `origin/${BRANCH}`]); // obie maszyny zmienialy PG
  if (!m.ok) {
    git(['merge', '--abort']);
    process.stdout.write(`pg-sync: merge nieudany, nic nie zmieniono: ${m.err.slice(0, 300)}\n`);
    log('skipped', 'pull: merge nieudany');
    return 1;
  }
  const evalRun = spawnSync(process.execPath, [path.join(DIR, 'bin', 'pg-eval.js')], { encoding: 'utf8', timeout: 300000, windowsHide: true });
  const green = evalRun.status === 0;
  process.stdout.write(`pg-sync: golden suite bramek po pobraniu: ${green ? 'OK' : 'CZERWONA'}\n${green ? '' : (evalRun.stdout || '').slice(-1200)}`);
  if (!green) {
    // Czerwone bramki NIE dostaja pieczeci (ops/data-review): cofamy pobranie, lokalne zmiany zostaja (--keep).
    const back = git(['reset', '--keep', before]);
    process.stdout.write(back.ok ? `pg-sync: pobranie cofniete do ${before.slice(0, 7)}, pieczec bez zmian.\n` : `pg-sync: COFNIECIE NIEUDANE (${back.err.slice(0, 200)}) — przejrzyj git -C ~/.claude log\n`);
    log('skipped', `pull: eval CZERWONY, cofniete=${back.ok}`);
    return 1;
  }
  const seal = spawnSync(process.execPath, [path.join(DIR, 'bin', 'pg-seal.js')], { encoding: 'utf8', timeout: 60000, windowsHide: true });
  process.stdout.write((seal.stdout || seal.stderr || '').trim() + '\n');
  log('ran', `pull ${st.behind} commitow, eval ${green ? 'OK' : 'CZERWONY'}`);
  status(true);
  return green ? 0 : 1;
}

function main() {
  const cmd = process.argv[2] || 'status';
  if (cmd === 'status') { const st = status(process.argv.includes('--quiet')); process.exit(st ? 0 : 1); }
  if (cmd === 'push') process.exit(push());
  if (cmd === 'pull') process.exit(pull());
  process.stderr.write('uzycie: pg-sync.js status [--quiet] | push | pull [--apply]\n');
  process.exit(2);
}

module.exports = { STATE };

if (require.main === module) main();

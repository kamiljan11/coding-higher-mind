#!/usr/bin/env node
// Wpiecia PG w settings.json na kazdym komputerze (2026-09-26). Pliki PG jada Syncthingiem (notatki maszyn (prywatne)), ale settings.json
// jest per komputer (inne sciezki), wiec bez wpiec Claude Code na laptopie nie odpala zadnej bramki.
//   --export  (second-machine): hooks + permissions.deny z settings.json -> pg/settings-hooks.json (jedzie Syncthingiem)
//   --apply   (laptop):  wpina je do lokalnego settings.json ze sciezkami tego komputera, kopia .bak, core.hooksPath,
//                        chmod git-hooks, test na zywo (bash-guard MUSI zablokowac force-push). Zmienia bramki = wymaga
//                        frazy uzytkownika: `pozwol ALLOW_CONTROL_PLANE`, potem ALLOW_CONTROL_PLANE=1 node ~/.claude/bin/pg-wire.js --apply
//   --check   : czy lokalne wpiecia = migawka (exit 1 przy rozjezdzie); uzywa go session-context przy starcie sesji.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

// PG_WIRE_DIR = katalog testowy; honorowany tylko w %TEMP%. Porownanie po PRAWDZIWYCH sciezkach — os.tmpdir() bywa
// w formie 8.3 (USERNA~1), a sciezka testu w dlugiej; wtedy skrypt po cichu pisal do produkcji (code-review 2026-09-26).
const real = (p) => { try { return fs.realpathSync.native(p).toLowerCase(); } catch (e) { return ''; } };
const envDir = process.env.PG_WIRE_DIR && real(process.env.PG_WIRE_DIR).startsWith(real(os.tmpdir()) + path.sep) ? path.resolve(process.env.PG_WIRE_DIR) : '';
// Ustawiony, ale odrzucony PG_WIRE_DIR = blad, nie cichy skok na produkcyjny ~/.claude (weryfikator 2026-09-26).
if (process.env.PG_WIRE_DIR && !envDir) { process.stderr.write(`pg-wire: PG_WIRE_DIR poza %TEMP% albo nie istnieje: ${process.env.PG_WIRE_DIR}\n`); process.exit(2); }
const DIR = envDir || path.join(os.homedir(), '.claude');
const SETTINGS = path.join(DIR, 'settings.json');
const SNAP = path.join(DIR, 'pg', 'settings-hooks.json');
const CANON = '~/.claude/';
const LOCAL = DIR.replace(/\\/g, '/').replace(/\/+$/, '') + '/';

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
// Hash niezalezny od kolejnosci kluczy i grup (data-review: ta sama tresc w innej kolejnosci dawala falszywy rozjazd).
const stable = (o) => (Array.isArray(o) ? o.map(stable).sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1))
  : o && typeof o === 'object' ? Object.fromEntries(Object.keys(o).sort().map((k) => [k, stable(o[k])])) : o);
const hash = (o) => crypto.createHash('sha256').update(JSON.stringify(stable(o))).digest('hex').slice(0, 16);
const writeAtomic = (p, text) => { const tmp = `${p}.${process.pid}.tmp`; fs.writeFileSync(tmp, text); try { fs.renameSync(tmp, p); } catch (e) { try { fs.unlinkSync(tmp); } catch (e2) { /* juz nie ma */ } throw e; } };
// Hook PG = komenda wskazujaca na ~/.claude/hooks/. Pozostale hooki sa lokalne dla komputera i --apply ich nie rusza.
// Takze katalog hookow TEGO DIR (piaskownica testowa nie nazywa sie .claude — data-review: test porownywal puste zbiory).
// CALA komenda musi miec postac `node "<...>/.claude/hooks/<plik>.js"` — samo wystapienie tekstu dalo sie przemycic
// komentarzem (`echo X # /.claude/hooks/`, weryfikator 2026-09-27).
// Prefiks PRZYPIETY do dokladnej sciezki kanonicznej albo lokalnej ~/.claude/ — `[^"]*` przepuszczal `$(curl…|sh)` (bash
// wykonuje podstawienie w cudzyslowie) i dowolny `*/.claude/hooks/` (security-review 2026-09-27).
const escRx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const PG_HOOK_CMD_RX = new RegExp('^node "(?:' + escRx(CANON) + '|' + escRx(LOCAL) + ')hooks/[\\w.-]+\\.js"$'); // dokladnie jedna spacja, bez \s (LF)
const isPgHook = (h) => PG_HOOK_CMD_RX.test(String((h && h.command) || '').replace(/\\/g, '/'));

// Komenda ze sciezkami second-machinea -> sciezki tego komputera. Sciezka Windows spoza ~/.claude (np. <backup-drive>:\agent-os) na
// Linuksie nie istnieje -> null (hook pominiety, zgloszony). Litera dysku tylko na poczatku slowa/cudzyslowu (nie `https://`).
function localize(cmd) {
  const out = String(cmd).split(CANON).join(LOCAL);
  if (process.platform !== 'win32' && /(^|[\s"'])[A-Za-z]:[\\/]/.test(out)) return null;
  return out;
}

// Tylko hooki PG z danego zestawu (do porownania i do scalenia z lokalnymi).
function filterHooks(hooks, keep) {
  const res = {};
  for (const [event, groups] of Object.entries(hooks || {})) {
    const gs = groups.map((g) => Object.assign({}, g, { hooks: (g.hooks || []).filter(keep) })).filter((g) => g.hooks.length);
    if (gs.length) res[event] = gs;
  }
  return res;
}

function localHooks(hooks, skipped) {
  const res = {};
  for (const [event, groups] of Object.entries(hooks || {})) {
    const gs = groups.map((g) => Object.assign({}, g, {
      hooks: (g.hooks || []).map((h) => {
        const cmd = localize(h.command);
        if (cmd === null) { if (skipped) skipped.push(h.command); return null; }
        return Object.assign({}, h, { command: cmd });
      }).filter(Boolean),
    })).filter((g) => g.hooks.length);
    if (gs.length) res[event] = gs;
  }
  return res;
}

// Co z migawki trafi do settings.json (tylko hooki PG) i co zostanie odrzucone — wspolne dla --plan i --apply.
function planWiring(snap, skipped) {
  const all = localHooks(snap.hooks, skipped);
  return { pg: filterHooks(all, isPgHook), foreign: Object.values(all).flat().flatMap((g) => g.hooks).filter((h) => !isPgHook(h)) };
}
function describePlan(pg, foreign, wireLabel, rejectLabel) {
  const lines = Object.entries(pg).flatMap(([ev, gs]) => gs.flatMap((g) => g.hooks.map((h) => `  ${ev} [${g.matcher || '*'}] ${h.command}`)));
  return `pg-wire ${wireLabel}:\n${lines.join('\n')}\n` +
    (foreign.length ? `pg-wire ${rejectLabel} (spoza ~/.claude/hooks): ${foreign.map((h) => h.command).join(' | ')}\n` : 'pg-wire: nic do odrzucenia\n');
}

const localDeny = (deny) => (deny || []).map((d) => (process.platform === 'win32' ? d : d.replace('(//d/', '(~/D/')));

function exportSnap() {
  const s = readJson(SETTINGS);
  const snap = { $comment: 'Wpiecia PG z settings.json second-machinea (bin/pg-wire.js --export). Na innym komputerze: pg-wire.js --apply.',
    // TYLKO hooki PG (~/.claude/hooks/*): hook spoza PG w migawce = dowolna komenda wpieta na drugim komputerze bez sladu w --check (security-review 2026-09-27).
    exported_at: new Date().toISOString(), hooks: filterHooks(s.hooks, isPgHook), deny: (s.permissions && s.permissions.deny) || [] };
  writeAtomic(SNAP, JSON.stringify(snap, null, 2) + '\n');
  process.stdout.write(`pg-wire: zapisano ${path.relative(DIR, SNAP)} (${Object.keys(snap.hooks).length} zdarzen, ${snap.deny.length} deny, hash ${hash(snap.hooks)})\n`);
  return 0;
}

function check(quiet) {
  let snap; let s;
  try { snap = readJson(SNAP); } catch (e) { if (!quiet) process.stdout.write('pg-wire: brak pg/settings-hooks.json\n'); return { ok: false, reason: 'brak migawki' }; }
  try { s = readJson(SETTINGS); } catch (e) { s = {}; }
  const want = filterHooks(localHooks(snap.hooks), isPgHook);
  const have = filterHooks(s.hooks, isPgHook);
  const missingDeny = localDeny(snap.deny).filter((d) => !((s.permissions && s.permissions.deny) || []).includes(d));
  const ok = hash(want) === hash(have) && !missingDeny.length;
  const reason = ok ? 'zgodne' : `hooki ${hash(have)} != migawka ${hash(want)}${missingDeny.length ? `, brak ${missingDeny.length} deny` : ''}`;
  if (!quiet) process.stdout.write(`pg-wire: ${reason}\n`);
  return { ok, reason };
}

// Test tego, co jest WPIETE: komendy z settings.json dla PreToolUse/Bash, uruchomione jak robi to Claude Code (przez
// powloke). Samo odpalenie bash-guard.js dawalo zielony wynik przy settings.json bez zadnej bramki (security-review).
function selfTest() {
  const s = readJson(SETTINGS);
  const wired = ((s.hooks && s.hooks.PreToolUse) || []).filter((g) => new RegExp('^(' + (g.matcher || '.*') + ')$').test('Bash'))
    .flatMap((g) => (g.hooks || []).map((h) => h.command)).filter(Boolean);
  const run = (command) => {
    const input = JSON.stringify({ tool_name: 'Bash', cwd: os.tmpdir(), tool_input: { command } });
    const codes = wired.map((c) => spawnSync(c, { shell: true, input, encoding: 'utf8', timeout: 30000 }).status);
    return codes.includes(2) ? 2 : (codes.every((c) => c === 0) ? 0 : codes.find((c) => c !== 0));
  };
  const blocked = wired.length ? run('git push --force origin main') : 'brak wpietej bramki Bash';
  const allowed = wired.length ? run('ls') : 'brak wpietej bramki Bash';
  const missing = [];
  for (const groups of Object.values(s.hooks || {})) for (const g of groups) for (const h of g.hooks || []) {
    const m = /"([^"]+\.(?:js|py))"/.exec(h.command || '');
    if (m && !fs.existsSync(m[1])) missing.push(m[1]);
  }
  const ok = blocked === 2 && allowed === 0 && !missing.length;
  process.stdout.write(`pg-wire: test na zywo — force-push ${blocked === 2 ? 'ZABLOKOWANY' : `NIE zablokowany (exit ${blocked})`}, ls ${allowed === 0 ? 'przepuszczony' : `exit ${allowed}`}` +
    `${missing.length ? `, BRAK plikow hookow: ${missing.join(', ')}` : ''} -> ${ok ? 'PG DZIALA' : 'PG NIE DZIALA'}\n`);
  return ok;
}

function apply() {
  if (process.env.ALLOW_CONTROL_PLANE !== '1') {
    process.stdout.write('pg-wire: --apply zmienia bramki tego komputera — fraza „pozwol ALLOW_CONTROL_PLANE" w czacie, potem ALLOW_CONTROL_PLANE=1 node ~/.claude/bin/pg-wire.js --apply\n');
    return 2;
  }
  const snap = readJson(SNAP);
  let s = {};
  let bak = '';
  if (fs.existsSync(SETTINGS)) {
    s = readJson(SETTINGS);
    bak = `${SETTINGS}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    fs.copyFileSync(SETTINGS, bak);
    process.stdout.write(`pg-wire: kopia ${bak}\n`);
  }
  const skipped = [];
  // Migawka moze byc podmieniona (jedzie Syncthingiem) — wpinamy WYLACZNIE hooki PG i pokazujemy je przed zapisem.
  const { pg, foreign } = planWiring(snap, skipped);
  process.stdout.write(describePlan(pg, foreign, 'wpinam', 'ODRZUCONE (nie wpinam)'));
  // Hooki spoza PG (tylko na tym komputerze) zostaja — dopisane za hookami PG tego samego zdarzenia (data-review 2026-09-26).
  const own = filterHooks(s.hooks, (h) => !isPgHook(h));
  const before = JSON.stringify(filterHooks(s.hooks, isPgHook));
  for (const [event, groups] of Object.entries(own)) pg[event] = [...(pg[event] || []), ...groups];
  s.hooks = pg;
  process.stdout.write(`pg-wire: hooki PG ${before === JSON.stringify(filterHooks(pg, isPgHook)) ? 'bez zmian' : 'zaktualizowane'}; wlasne hooki tego komputera zachowane: ${Object.values(own).flat().reduce((n, g) => n + g.hooks.length, 0)}\n`);
  s.permissions = Object.assign({}, s.permissions);
  s.permissions.deny = [...new Set([...(s.permissions.deny || []), ...localDeny(snap.deny)])];
  writeAtomic(SETTINGS, JSON.stringify(s, null, 2) + '\n');
  if (skipped.length) process.stdout.write(`pg-wire: pominiete (sciezka Windows spoza ~/.claude): ${skipped.join(' | ')}\n`);
  // Bramki gita licza sie do sukcesu tak samo jak hooki Claude Code (ops-review: brak gita dawal „PG DZIALA").
  let gitOk = true;
  const gitHooksDir = path.join(DIR, 'git-hooks');
  if (!fs.existsSync(gitHooksDir)) {
    // Test na Linuksie 2026-09-27: readdirSync na brakujacym katalogu wywracal --apply PO zapisie settings.json (bez cofniecia).
    if (!envDir) { gitOk = false; process.stdout.write(`pg-wire: brak ${gitHooksDir} — bramki gita nie istnieja na tym komputerze\n`); }
  } else if (process.platform !== 'win32') {
    for (const f of fs.readdirSync(gitHooksDir)) { try { fs.chmodSync(path.join(gitHooksDir, f), 0o755); } catch (e) { gitOk = false; process.stdout.write(`pg-wire: chmod ${f} nieudany: ${e.message}\n`); } }
  }
  if (!envDir) {
    const gc = spawnSync('git', ['config', '--global', 'core.hooksPath', path.join(DIR, 'git-hooks')], { encoding: 'utf8' });
    if (gc.status !== 0) gitOk = false;
    process.stdout.write(`pg-wire: core.hooksPath -> ${path.join(DIR, 'git-hooks')} ${gc.status === 0 ? 'OK' : `BLAD ${(gc.stderr || (gc.error && gc.error.message) || '').trim()}`}\n`);
  }
  let hooksOk = false;
  try { hooksOk = selfTest(); } catch (e) { process.stdout.write(`pg-wire: test na zywo rzucil wyjatek: ${e.message}\n`); } // wyjatek = porazka = cofniecie
  if (!gitOk) process.stdout.write('pg-wire: bramki gita (pre-commit/pre-push) NIE sa wpiete — PG dziala tylko czesciowo\n');
  if (!hooksOk) {
    // Wpiecie nie dziala -> wracamy do stanu sprzed --apply; przy pierwszym wpieciu (brak .bak) = brak pliku (ops-review).
    if (bak) fs.copyFileSync(bak, SETTINGS); else fs.unlinkSync(SETTINGS);
    process.stdout.write(`pg-wire: test na zywo nieudany — przywrocono ${bak ? path.basename(bak) : 'stan bez settings.json'}` +
      ' (core.hooksPath zostaje ustawiony — cofnij recznie: git config --global --unset core.hooksPath)\n');
  }
  return hooksOk && gitOk ? 0 : 1;
}

function main() {
  const mode = process.argv[2];
  if (mode === '--export') process.exit(exportSnap());
  if (mode === '--apply') process.exit(apply());
  if (mode === '--check') process.exit(check(false).ok ? 0 : 1);
  if (mode === '--self-test') process.exit(selfTest() ? 0 : 1);
  if (mode === '--plan') {
    // Podglad BEZ zapisu i bez zgody: co --apply wpnie i co odrzuci — do obejrzenia ZANIM uzytkownik wyda fraze (security-review).
    const { pg, foreign } = planWiring(readJson(SNAP));
    process.stdout.write(describePlan(pg, foreign, '--plan: wpialbym', 'ODRZUCIlbym'));
    process.exit(0);
  }
  process.stderr.write('uzycie: pg-wire.js --export | --plan | --apply | --check | --self-test\n');
  process.exit(2);
}

module.exports = { check, localHooks, localize };

if (require.main === module) main();

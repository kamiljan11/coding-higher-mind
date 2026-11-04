'use strict';
// Telemetria bramek. Kazdy hook zapisuje ran / skipped / blocked do ~/.claude/logs/gates.jsonl.
// Powod istnienia: hook, ktory sie nie odpalil (brak narzedzia, timeout, nie-repo), wyglada
// z zewnatrz IDENTYCZNIE jak hook, ktory przeszedl. Bez tego logu skipy sa niewidoczne.
// guard_health.py czyta ten plik co tydzien i raportuje skipy per powod.
const fs = require('fs');
const os = require('os');
const path = require('path');

// PG_GATE_LOG = osobny plik dla testow/evalu. Bez tego test_hooks_v3 pisal fixture'y do produkcyjnego logu
// (1873/12968 wpisow w R1) i raporty guard_health / alarmy obejsc liczyly smieci testowe (landscape #9).
// Honorowane tylko w %TEMP% (design review 2026-09-26): zmienna srodowiskowa nie moze przekierowac PRODUKCYJNEGO audytu.
const envLog = process.env.PG_GATE_LOG ? path.resolve(process.env.PG_GATE_LOG) : '';
const LOG_FILE = envLog && envLog.toLowerCase().startsWith(path.resolve(os.tmpdir()).toLowerCase() + path.sep) ? envLog : path.join(os.homedir(), '.claude', 'logs', 'gates.jsonl');
const LOG_DIR = path.dirname(LOG_FILE);
const ROTATED_FILE = LOG_FILE.replace(/\.jsonl$/, '') + '.1.jsonl';
const MAX_LOG_BYTES = 5 * 1024 * 1024; // powyzej tego rotujemy — log nie moze rosnac bez konca

function rotateIfLarge() {
  try {
    if (fs.statSync(LOG_FILE).size > MAX_LOG_BYTES) fs.renameSync(LOG_FILE, ROTATED_FILE);
  } catch (e) { /* brak pliku = nic do rotacji */ }
}

const PROD_LOG = path.join(os.homedir(), '.claude', 'logs', 'gates.jsonl');
const TMP_PREFIX = path.resolve(os.tmpdir()).toLowerCase() + path.sep;

// Skad pochodzi wpis (Fala 0, design pg/designs/2026-11-01-fala-0-pomiar.md §11.2): bez tego 820/1959 `bypass` z fixture'ow
// w /tmp mieszalo sie z decyzjami agentow i udzialu falszywych alarmow nie dalo sie policzyc. Pierwsza pasujaca regula:
// test (log przekierowany, wiec honorowany tylko w tmpdir) > tmp (target w tmpdir) > agent (sesja Claude Code) > human.
function originOf(target) {
  if (LOG_FILE !== PROD_LOG) return 'test';
  const first = String(target || '').split(';')[0];
  if (first && (path.resolve(first) + path.sep).toLowerCase().startsWith(TMP_PREFIX)) return 'tmp';
  if (process.env.CLAUDECODE || process.env.CLAUDE_CODE_ENTRYPOINT) return 'agent';
  return 'human';
}

// entry: { hook, event, reason, target, gate? }. event: ran | skipped | blocked | bypass (swiadomy wyjatek, #5)
// | would_block (regula w trybie observe, #20). `origin`/`ep` dopisywane PO polach wpisu: testy dopasowuja regexem
// sasiedztwo `"hook":..,"event":..,"reason":..` (test_module_boundaries.js:206,305), wiec nic nie wchodzi miedzy nie.
function log(entry) {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    rotateIfLarge();
    const extra = { origin: originOf(entry && entry.target) };
    if (process.env.CLAUDE_CODE_ENTRYPOINT) extra.ep = process.env.CLAUDE_CODE_ENTRYPOINT;
    const line = JSON.stringify(Object.assign({ ts: new Date().toISOString(), pid: process.pid }, entry, extra));
    fs.appendFileSync(LOG_FILE, line + '\n');
    // Obejscie przy przekierowanym logu ZAWSZE zostawia tez slad w produkcyjnym (security-review 2026-09-26: PG_GATE_LOG
    // w %TEMP% chowal wpis `bypass` pre-commita). Oznaczone `redirected` — guard_health liczy je osobno (testy daja kilka).
    if (LOG_FILE !== PROD_LOG && entry.event === 'bypass') {
      fs.mkdirSync(path.dirname(PROD_LOG), { recursive: true });
      fs.appendFileSync(PROD_LOG, JSON.stringify(Object.assign({ ts: new Date().toISOString(), pid: process.pid, redirected: true }, entry, extra)) + '\n');
    }
    return true;
  } catch (e) { return false; /* telemetria nigdy nie moze zablokowac sesji; false = wolajacy moze to zglosic (pg-aggregate) */ }
}

// Jakie POLA (nie wartosci) Claude Code przysyla hookowi — np. czy jest `agent_type` (read-only recenzenci, #15).
// Bez tego regula zalezna od pola moze byc martwa i nikt sie nie dowie (design review 2026-09-26, klasa A).
const KEYS_FILE = path.join(LOG_DIR, 'hook-input-keys.json');
function noteInputKeys(hook, input) {
  try {
    const keys = Object.keys(input || {}).sort();
    let data = {};
    try { data = JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8')); } catch (e) { /* pierwszy zapis */ }
    const prev = data[hook] || { keys: [] };
    const merged = [...new Set([...prev.keys, ...keys])].sort();
    if (merged.length === prev.keys.length) return;
    data[hook] = { keys: merged, updated: new Date().toISOString() };
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const tmp = KEYS_FILE + '.' + process.pid + '.tmp'; // tmp + rename: rownolegle hooki nie zostawia polowy pliku
    fs.writeFileSync(tmp, JSON.stringify(data, null, 1));
    fs.renameSync(tmp, KEYS_FILE);
  } catch (e) { /* diagnostyka nigdy nie blokuje */ }
}

module.exports = { log, noteInputKeys, originOf, LOG_FILE, ROTATED_FILE, KEYS_FILE };

// CLI dla hookow shellowych (pre-commit): node gate-log.js <hook> <ran|skipped|blocked> <reason> [target] [gate]
// `gate` (Fala 0): nazwa bramki przy `blocked` z git-hookow (sufiks zmiennej ALLOW albo nazwa narzedzia).
// Powod: ALLOW_PHASE/ALLOW_TODO/ALLOW_PII=1 omijaly bramke bez sladu (ops-reviewer 2026-09-12) — skip niewidoczny = bramka, ktorej nie ma.
if (require.main === module) {
  const [hook, event, reason, target, gate] = process.argv.slice(2);
  if (!hook || !/^(ran|skipped|blocked|bypass|would_block)$/.test(String(event))) { process.stderr.write('gate-log: uzycie: node gate-log.js <hook> <ran|skipped|blocked|bypass|would_block> <reason> [target] [gate]\n'); process.exit(2); }
  const entry = { hook, event, reason: reason || '', target: target || process.cwd() };
  if (gate) entry.gate = gate;
  log(entry);
}

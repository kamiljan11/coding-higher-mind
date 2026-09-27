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
// entry: { hook, event, reason, target }. event: ran | skipped | blocked | bypass (swiadomy wyjatek, #5)
// | would_block (regula w trybie observe, #20)
function log(entry) {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    rotateIfLarge();
    const line = JSON.stringify(Object.assign({ ts: new Date().toISOString(), pid: process.pid }, entry));
    fs.appendFileSync(LOG_FILE, line + '\n');
    // Obejscie przy przekierowanym logu ZAWSZE zostawia tez slad w produkcyjnym (security-review 2026-09-26: PG_GATE_LOG
    // w %TEMP% chowal wpis `bypass` pre-commita). Oznaczone `redirected` — guard_health liczy je osobno (testy daja kilka).
    if (LOG_FILE !== PROD_LOG && entry.event === 'bypass') {
      fs.mkdirSync(path.dirname(PROD_LOG), { recursive: true });
      fs.appendFileSync(PROD_LOG, JSON.stringify(Object.assign({ ts: new Date().toISOString(), pid: process.pid, redirected: true }, entry)) + '\n');
    }
  } catch (e) { /* telemetria nigdy nie moze zablokowac sesji */ }
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

module.exports = { log, noteInputKeys, LOG_FILE, ROTATED_FILE, KEYS_FILE };

// CLI dla hookow shellowych (pre-commit): node gate-log.js <hook> <ran|skipped|blocked> <reason> [target]
// Powod: ALLOW_PHASE/ALLOW_TODO/ALLOW_PII=1 omijaly bramke bez sladu (ops-reviewer 2026-09-12) — skip niewidoczny = bramka, ktorej nie ma.
if (require.main === module) {
  const [hook, event, reason, target] = process.argv.slice(2);
  if (!hook || !/^(ran|skipped|blocked|bypass|would_block)$/.test(String(event))) { process.stderr.write('gate-log: uzycie: node gate-log.js <hook> <ran|skipped|blocked|bypass|would_block> <reason> [target]\n'); process.exit(2); }
  log({ hook, event, reason: reason || '', target: target || process.cwd() });
}

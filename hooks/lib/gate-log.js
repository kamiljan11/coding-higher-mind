'use strict';
// Telemetria bramek. Kazdy hook zapisuje ran / skipped / blocked do ~/.claude/logs/gates.jsonl.
// Powod istnienia: hook, ktory sie nie odpalil (brak narzedzia, timeout, nie-repo), wyglada
// z zewnatrz IDENTYCZNIE jak hook, ktory przeszedl. Bez tego logu skipy sa niewidoczne.
// guard_health.py czyta ten plik co tydzien i raportuje skipy per powod.
const fs = require('fs');
const os = require('os');
const path = require('path');

const LOG_DIR = path.join(os.homedir(), '.claude', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'gates.jsonl');
const ROTATED_FILE = path.join(LOG_DIR, 'gates.1.jsonl');
const MAX_LOG_BYTES = 5 * 1024 * 1024; // powyzej tego rotujemy — log nie moze rosnac bez konca

function rotateIfLarge() {
  try {
    if (fs.statSync(LOG_FILE).size > MAX_LOG_BYTES) fs.renameSync(LOG_FILE, ROTATED_FILE);
  } catch (e) { /* brak pliku = nic do rotacji */ }
}

// entry: { hook, event: 'ran'|'skipped'|'blocked', reason, target }
function log(entry) {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    rotateIfLarge();
    fs.appendFileSync(LOG_FILE, JSON.stringify(Object.assign({ ts: new Date().toISOString(), pid: process.pid }, entry)) + '\n');
  } catch (e) { /* telemetria nigdy nie moze zablokowac sesji */ }
}

module.exports = { log, LOG_FILE, ROTATED_FILE };

// CLI dla hookow shellowych (pre-commit): node gate-log.js <hook> <ran|skipped|blocked> <reason> [target]
// Powod: ALLOW_PHASE/ALLOW_TODO/ALLOW_PII=1 omijaly bramke bez sladu (ops-reviewer 2026-09-12) — skip niewidoczny = bramka, ktorej nie ma.
if (require.main === module) {
  const [hook, event, reason, target] = process.argv.slice(2);
  if (!hook || !/^(ran|skipped|blocked)$/.test(String(event))) { process.stderr.write('gate-log: uzycie: node gate-log.js <hook> <ran|skipped|blocked> <reason> [target]\n'); process.exit(2); }
  log({ hook, event, reason: reason || '', target: target || process.cwd() });
}

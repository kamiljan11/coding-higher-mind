#!/usr/bin/env node
// PostToolUse hook (wszystkie narzedzia) — landscape #17. Loop Guardrails z CLAUDE.md („ten sam tool + ten sam blad 2x ->
// zmien podejscie") istnialy tylko proza (prompt-guard r7L). Tu mechanicznie: ring buffer hash(tool + input) per sesja;
// 4. identyczne wywolanie w oknie 12 -> additionalContext dla modelu (raz na dany hash). Nie blokuje — to sygnal, nie bramka.
// Wzorzec: ECC ecc-context-monitor.js (ring buffer), FailproofAI (powtorzenia). Fail-open, stan w %TEMP%.
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { log } = require('./lib/gate-log');
const { cleanSid } = require('./lib/overrides');

const WINDOW = 12;
const REPEAT_LIMIT = 4;

function main() {
  let input = {};
  try { input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch (e) { return; }
  const sid = cleanSid(input.session_id);
  if (!sid || !input.tool_name) return;
  const statePath = path.join(os.tmpdir(), `claude-loop-${sid}.json`);
  let state = { recent: [], warned: [] };
  try { state = Object.assign(state, JSON.parse(fs.readFileSync(statePath, 'utf8'))); } catch (e) { /* pierwszy wpis */ }
  const hash = crypto.createHash('sha256').update(String(input.tool_name) + '\u0000' + JSON.stringify(input.tool_input || {})).digest('hex').slice(0, 16);
  state.recent = [...state.recent, hash].slice(-WINDOW);
  const repeats = state.recent.filter((h) => h === hash).length;
  let message = null;
  if (repeats >= REPEAT_LIMIT && !state.warned.includes(hash)) {
    state.warned = [...state.warned, hash].slice(-50);
    message = `[loop-monitor] STOP: to samo wywolanie ${input.tool_name} (identyczne wejscie) ${repeats}x w ostatnich ${WINDOW}. ` +
      'Powtarzanie tej samej proby nie da innego wyniku — zmien podejscie (Loop Guardrails), a po 3 porazkach zglos blocker uzytkownikowi.';
    log({ hook: 'loop-monitor', event: 'ran', reason: `warned: repeat x${repeats}: ${input.tool_name}`, target: input.cwd || '' });
  }
  try { fs.writeFileSync(statePath, JSON.stringify(state)); } catch (e) { /* bez stanu = bez detekcji, nie blad sesji */ }
  // Retencja (ops-review 2026-09-26: plik na sesje bez sprzatania). Raz na ~100 wywolan: kasuj stany starsze niz 2 dni.
  if (Math.random() < 0.01) {
    try {
      for (const f of fs.readdirSync(os.tmpdir())) {
        if (!/^claude-loop-[\w-]+\.json$/.test(f)) continue;
        const p = path.join(os.tmpdir(), f);
        if (Date.now() - fs.statSync(p).mtimeMs > 2 * 86400000) fs.unlinkSync(p);
      }
    } catch (e) { /* sprzatanie best-effort */ }
  }
  if (message) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: message } }) + '\n');
}

try { main(); } catch (e) { /* fail-open */ }
process.exit(0);

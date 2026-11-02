#!/usr/bin/env node
// PostToolUse hook (wszystkie narzedzia) — landscape #17. Loop Guardrails z CLAUDE.md („ten sam tool + ten sam blad 2x ->
// zmien podejscie") istnialy tylko proza (prompt-guard r7L). Tu mechanicznie: ring buffer hash(tool + input) per sesja;
// 4. identyczne wywolanie w oknie 12 -> additionalContext dla modelu (raz na dany hash). Nie blokuje — to sygnal, nie bramka.
// Wzorzec: ECC ecc-context-monitor.js (ring buffer), FailproofAI (powtorzenia). Fail-open, stan w %TEMP%.
// Nosnik drugiego sygnalu (2026-10-24): nowe nazwy po polsku — regula i lista slow w lib/name-lang.js (tu tylko wywolanie).
// Trzeci sygnal (2026-10-26, ADR-0010): edycja kodu w jezyku BEZ sprawdzacza (lib/lang-checkers.js) -> raz na rozszerzenie
// w sesji komunikat „najpierw petla weryfikacji" (pg/design.md › F.10). Bez tego luka byla widoczna tylko w guard_health.
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { log } = require('./lib/gate-log');
const { cleanSid } = require('./lib/overrides');

const WINDOW = 12;
const REPEAT_LIMIT = 4;

// Raz na rozszerzenie w sesji: edycja kodu w jezyku bez sprawdzacza (ADR-0010). Mutuje state.langGaps.
function langGapNotice(input, state) {
  try {
    const ti = input.tool_input || {};
    // Tylko narzedzia ZAPISU: Read/Grep po pliku .kt to nie „edycja bez sprawdzenia" (pg-review code r2).
    const file = /^(Edit|Write|MultiEdit|NotebookEdit)$/.test(String(input.tool_name)) ? String(ti.file_path || ti.notebook_path || '') : '';
    const fileExt = path.extname(file).toLowerCase();
    const seen = new Set(state.langGaps || []);
    if (!file || !require('./lib/lang-checkers').isUncheckedCode(file) || seen.has(fileExt)) return null;
    state.langGaps = [...seen, fileExt].slice(-50);
    log({ hook: 'lang-gap', event: 'would_block', reason: `no checker for ${fileExt}`, target: input.cwd || '' });
    return `[lang-gap] Pliki ${fileExt} nie maja w PG zadnego kompilatora/lintera — edycje nie sa sprawdzane. Zanim napiszesz wiecej kodu ` +
      'w tym jezyku: pg/design.md › F.10 (narzedzie po weryfikacji zrodla + wpis w hooks/lib/lang-checkers.js + test + krok CI) albo powiedz uzytkownikowi, ze to luka.';
  } catch (e) {
    log({ hook: 'lang-gap', event: 'skipped', reason: `lang-gap: blad narzedzia (${String(e && e.message || e).slice(0, 120)})`, target: input.cwd || '' });
    return null;
  }
}

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
  // Sygnal name-lang: require w try — zepsuta libka nie moze wylaczyc detekcji petli (ops-review 2026-10-25).
  let names = null;
  try {
    const nameLang = require('./lib/name-lang');
    const warned = new Set(state.names || []);
    const hits = nameLang.polishNames(input.tool_name, input.tool_input, input.tool_response, input.cwd)
      .filter((h) => !warned.has(h.kind + ':' + h.name)); // raz na nazwe w sesji (ponowiona komenda = cisza)
    if (hits.length) {
      state.names = [...warned, ...hits.map((h) => h.kind + ':' + h.name)].slice(-50);
      names = nameLang.message(hits);
      log({ hook: 'name-lang', event: 'would_block', reason: `rule:name-lang: ${hits.map((h) => `${h.kind}:${h.name}(${h.word})`).join(', ')}`.slice(0, 300), target: input.cwd || '' });
    }
  } catch (e) {
    log({ hook: 'name-lang', event: 'skipped', reason: `name-lang: blad narzedzia (${String(e && e.message || e).slice(0, 120)})`, target: input.cwd || '' });
  }
  const langGap = langGapNotice(input, state);
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
  const context = [message, names, langGap].filter(Boolean).join('\n');
  if (context) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: context } }) + '\n');
}

try { main(); } catch (e) { /* fail-open */ }
process.exit(0);

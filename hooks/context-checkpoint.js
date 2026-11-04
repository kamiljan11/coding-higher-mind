#!/usr/bin/env node
// Stop hook: przypomnienie o checkpoincie sesji przed koncem okna kontekstu (kompakcja L1, 2026-11-02; observe, nigdy nie blokuje).
// Design: pg/designs/2026-11-02-p7-l1-checkpoint-przed-kompakcja.md; slownik: pg/GLOSSARY.md › Kompakcja L0-L6.
// Zuzycie okna = ostatni `message.usage` glownego watku w transkrypcie (input + cache_read + cache_creation) — hooki nie dostaja
// licznika kontekstu, a status line nie dziala w aplikacji desktop. Progi 70 % / 85 % `autoCompactWindow`: raz na cykl,
// gdy checkpoint tej sesji nieswiezy -> `hookSpecificOutput.additionalContext` (Stop: model dostaje to jako feedback i dziala dalej).
// Spadek ponizej 50 % (po kompakcji) zeruje cykl. Exit 0 zawsze; kazdy wynik do gates.jsonl.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { log, noteInputKeys } = require('./lib/gate-log');
const { cleanSid } = require('./lib/overrides');

const HOME = os.homedir();
const LEVELS = [70, 85];
const RESET_BELOW = 50;
const FRESH_MS = 20 * 60 * 1000;
const TAIL_BYTES = 1024 * 1024;
const DEFAULT_WINDOW = 400000;
const CHECKPOINT_DIR = process.env.PG_CHECKPOINT_DIR || path.join(HOME, 'Obsidian', 'MAIN', 'Claude Memory', 'Checkpoints');
const STATE_DIR = process.env.PG_CHECKPOINT_STATE_DIR || path.join(HOME, '.claude', 'logs', 'context-checkpoint');
const SETTINGS = process.env.PG_SETTINGS_FILE || path.join(HOME, '.claude', 'settings.json');

function readStdin() {
  try { return JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch (e) { return {}; }
}

function compactWindow() {
  try {
    const w = Number(JSON.parse(fs.readFileSync(SETTINGS, 'utf8')).autoCompactWindow);
    return Number.isFinite(w) && w > 0 ? w : DEFAULT_WINDOW;
  } catch (e) { return DEFAULT_WINDOW; }
}

// Ostatni wpis assistant glownego watku z `usage` w ogonie transkryptu -> liczba tokenow kontekstu albo null.
function contextTokens(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, TAIL_BYTES);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    const lines = buf.toString('utf8').split('\n');
    if (size > len) lines.shift(); // pierwsza linia ucieta w polowie
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i].includes('"usage"')) continue;
      let e;
      try { e = JSON.parse(lines[i]); } catch (err) { continue; }
      const u = e && e.type === 'assistant' && !e.isSidechain && e.message && e.message.usage;
      if (!u || e.message.model === '<synthetic>') continue; // wpis syntetyczny (blad API, przerwanie) ma usage 0 — falszywy reset cyklu
      const total = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
      if (total > 0) return total;
    }
    return null;
  } catch (e) { return null; } finally { if (fd !== undefined) try { fs.closeSync(fd); } catch (e) { /* zamkniety */ } }
}

// Najnowszy checkpoint tej sesji (nazwa zawiera sid8) -> mtime w ms albo 0.
function checkpointMtime(sid8) {
  try {
    return fs.readdirSync(CHECKPOINT_DIR).filter((f) => f.endsWith('.md') && f.includes(sid8))
      .reduce((m, f) => Math.max(m, fs.statSync(path.join(CHECKPOINT_DIR, f)).mtimeMs), 0);
  } catch (e) { return 0; }
}

const stateFile = (sid) => path.join(STATE_DIR, sid + '.json');
// Stan o zlym ksztalcie (reczna edycja, ucieta zapis) -> domyslny zamiast wyjatku: hook ma dzialac dalej.
function readState(sid) {
  let raw = null;
  try { raw = JSON.parse(fs.readFileSync(stateFile(sid), 'utf8')); } catch (e) { /* brak albo zly JSON */ }
  const ok = raw && typeof raw === 'object';
  return {
    fired: ok && Array.isArray(raw.fired) ? raw.fired.filter((l) => LEVELS.includes(l)) : [],
    remindedAt: ok && Number.isFinite(raw.remindedAt) ? raw.remindedAt : 0,
    measured: ok && typeof raw.measured === 'boolean' ? raw.measured : true,
  };
}
// Zapis atomowy (tmp + rename): dwa rownolegle Stopy tej samej sesji nie zostawia polowy pliku.
function writeState(sid, st) {
  fs.mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
  const tmp = stateFile(sid) + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(st), { mode: 0o600 });
  fs.renameSync(tmp, stateFile(sid));
}

function message(level, tokens, win, sid8, project) {
  const day = new Date().toISOString().slice(0, 10);
  const file = path.join(CHECKPOINT_DIR, `${day} ${sid8} ${project}.md`);
  return `[PG kompakcja L1] Kontekst ~${Math.round(tokens / 1000)}k z ${Math.round(win / 1000)}k okna kompakcji (${level} %+). ` +
    `Zanim okno sie skonczy, zapisz checkpoint tej sesji (Write calego pliku — to plik tylko tej sesji): ${file}. ` +
    'Szablon: ## Cel i ograniczenia uzytkownika (cytaty doslowne, frazy pozwol z godzina wygasniecia) · ## Decyzje (z powodem) · ' +
    '## Wyniki (liczby + sciezka/commit/exit code jako dowod) · ## Artefakty (pliki, ID agentow, run ID, PR, katalogi pg-review, URL) · ' +
    '## Decyzje do podjecia przez uzytkownika · ## Nastepny krok. Potem dopisz 1 linie do RESUME.md (append). ' +
    'Nie opisuj tego uzytkownikowi — zapisz i wroc do zakonczenia tury.';
}

// -> { event, reason, output? } — main() loguje i wypisuje; wydzielone dla testow.
function decide(input, now = Date.now()) {
  const sid = cleanSid(input.session_id);
  if (input.stop_hook_active) return { event: 'skipped', reason: `sid=${sid} stop_hook_active` };
  if (!sid || !input.transcript_path) return { event: 'skipped', reason: 'brak session_id albo transcript_path' };
  const tokens = contextTokens(input.transcript_path);
  if (tokens === null) return { event: 'skipped', reason: `sid=${sid} brak usage w ogonie transkryptu` };
  const win = compactWindow();
  const pct = Math.round((tokens / win) * 100);
  const sid8 = sid.slice(0, 8);
  const st = readState(sid);
  const ckpt = checkpointMtime(sid8);
  const notes = [];
  // Miara observe: po przypomnieniu — czy checkpoint odswiezony (raz na przypomnienie).
  if (!st.measured && st.remindedAt) {
    notes.push(ckpt >= st.remindedAt ? 'checkpoint odswiezony po przypomnieniu' : 'checkpoint NIE odswiezony po przypomnieniu');
    st.measured = true;
  }
  if (pct < RESET_BELOW && st.fired.length) { st.fired = []; notes.push('nowy cykl (kontekst < 50 %)'); }
  const level = LEVELS.filter((l) => pct >= l && !st.fired.includes(l)).pop();
  let result;
  if (!level) result = { event: 'skipped', reason: `sid=${sid} ${pct} % okna — brak nowego progu` };
  else if (ckpt && now - ckpt < FRESH_MS) {
    st.fired.push(...LEVELS.filter((l) => l <= level && !st.fired.includes(l)));
    result = { event: 'skipped', reason: `sid=${sid} ${pct} % okna, prog ${level} % — checkpoint swiezy` };
  } else {
    st.fired.push(...LEVELS.filter((l) => l <= level && !st.fired.includes(l)));
    st.remindedAt = now;
    st.measured = false;
    const project = path.basename(input.cwd || process.cwd()).replace(/[^\w.-]/g, '_').slice(0, 40) || 'sesja';
    result = { event: 'ran', reason: `sid=${sid} przypomnienie ${level} % (${tokens} tok z ${win})`,
      output: { hookSpecificOutput: { hookEventName: 'Stop', additionalContext: message(level, tokens, win, sid8, project) } } };
  }
  writeState(sid, st);
  if (notes.length) result.reason += ' · ' + notes.join(' · ');
  return result;
}

module.exports = { decide, contextTokens, compactWindow, LEVELS, FRESH_MS };

if (require.main === module) {
  let out = null;
  try {
    const input = readStdin();
    noteInputKeys('context-checkpoint', input);
    const r = decide(input);
    log({ hook: 'context-checkpoint', event: r.event, reason: r.reason, target: input.cwd || process.cwd() });
    out = r.output || null;
  } catch (e) {
    try { log({ hook: 'context-checkpoint', event: 'skipped', reason: 'internal error: ' + String(e && e.message || e).slice(0, 120), target: process.cwd() }); } catch (e2) { /* telemetria nie moze zablokowac */ }
  }
  if (out) process.stdout.write(JSON.stringify(out));
  process.exit(0);
}

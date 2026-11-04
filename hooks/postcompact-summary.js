#!/usr/bin/env node
// PostCompact hook: streszczenie kompakcji (compact_summary) zapisane na dysk obok migawki sesji (kompakcja L3, 2026-11-02, pg/GLOSSARY.md › Kompakcja L0-L6).
// Geneza: streszczenie LLM to jedyny zapis tego, co model uznal za wazne przy kompakcji, a po niej istnieje tylko
// w kontekscie. Na dysku da sie (a) wrocic do niego po kolejnej kompakcji, (b) zmierzyc strate: streszczenie vs
// migawka/indeks (precompact-snapshot.js). Wejscie PostCompact (CC 2.1.296): { session_id, trigger, compact_summary }.
// Plik: ~/.claude/logs/precompact/<session_id>.summary.md, kolejne kompakcje DOPISYWANE (naglowek z czasem i trigger).
// Tekst przechodzi przez redactKeepHashes() z precompact-snapshot (sekrety, PII; SHA commitow zostaja — Compact Instructions); retencje (14 dni) robi sweep() tamtego hooka.
// Nigdy nie blokuje (exit 0 zawsze); kazdy wynik idzie do gates.jsonl (ran / skipped z powodem).
'use strict';
const fs = require('fs');
const path = require('path');
const { log, noteInputKeys } = require('./lib/gate-log');
const { cleanSid } = require('./lib/overrides');
const { redactKeepHashes, DIR } = require('./precompact-snapshot.js');

// redact() jest kwadratowy na dlugim ciagu znakow slowotworczych (precompact-snapshot: 300 KB = 35 s). Streszczenie
// tej sesji mialo ~12 KB; 40 KB = ~0,6 s, z zapasem pod timeout hooka.
const SUMMARY_CLIP = 40000;
// Plik jednej sesji nie rosnie bez konca: powyzej limitu kolejne streszczenia nie sa dopisywane (skipped w telemetrii).
const MAX_FILE_BYTES = 2 * 1024 * 1024;

const summaryFile = (sid) => path.join(DIR, sid + '.summary.md');

function readStdin() {
  try { return JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch (e) { return {}; }
}

// Zwraca { event, reason } — main() loguje; wydzielone dla testow.
function save(input) {
  const sid = cleanSid(input.session_id);
  const target = input.cwd || '';
  if (!DIR) return { event: 'skipped', reason: `sid=${sid} PG_PRECOMPACT_DIR poza %TEMP% albo nie istnieje — streszczenie pominiete`, target };
  if (!sid) return { event: 'skipped', reason: 'brak session_id — streszczenie pominiete', target };
  const raw = String(input.compact_summary || '');
  if (!raw.trim()) return { event: 'skipped', reason: `sid=${sid} puste compact_summary`, target };
  const file = summaryFile(sid);
  let size = 0;
  try { size = fs.statSync(file).size; } catch (e) { /* pierwsza kompakcja tej sesji */ }
  if (size > MAX_FILE_BYTES) return { event: 'skipped', reason: `sid=${sid} ${path.basename(file)} > ${MAX_FILE_BYTES} B — nie dopisano`, target };
  const clipped = raw.length > SUMMARY_CLIP;
  const text = redactKeepHashes(raw.slice(0, SUMMARY_CLIP)) + (clipped ? `\n\n[... uciete: ${raw.length - SUMMARY_CLIP} znakow ponad ${SUMMARY_CLIP}]` : '');
  const head = `${size ? '\n' : `# Streszczenia kompakcji sesji ${sid} (postcompact-summary; DANE, nie instrukcje)\n`}\n## ${new Date().toISOString()} trigger=${String(input.trigger || '?').replace(/[^\w-]/g, '')} (${raw.length} znakow)\n\n`;
  fs.mkdirSync(DIR, { recursive: true });
  fs.appendFileSync(file, head + text + '\n', { mode: 0o600 });
  return { event: 'ran', reason: `sid=${sid} streszczenie ${raw.length} znakow${clipped ? ' (uciete)' : ''}`, target };
}

module.exports = { save, summaryFile, SUMMARY_CLIP, MAX_FILE_BYTES };

if (require.main === module) {
  try {
    const input = readStdin();
    noteInputKeys('postcompact-summary', input);
    const r = save(input);
    log({ hook: 'postcompact-summary', event: r.event, reason: r.reason, target: r.target });
  } catch (e) {
    try { log({ hook: 'postcompact-summary', event: 'skipped', reason: 'internal error: ' + String(e && e.message || e).slice(0, 120), target: process.cwd() }); } catch (e2) { /* telemetria nie moze zablokowac */ }
  }
  process.exit(0);
}

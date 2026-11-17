#!/usr/bin/env node
'use strict';
// service-role-gate: klucz `service_role` (Supabase, omija RLS) nie moze trafic do kodu wysylanego do przegladarki.
// Blizna SERVICE-ROLE-IN-CLIENT (pg/cases.md): dotad precheck tylko podawal dowod recenzentowi przy pg-review;
// ta bramka widzi to przy commicie. Liczy tylko DODANE linie w plikach kodu klienta (src/, app/, components/, pages/),
// pomija sciezki serwerowe, testy i pliki przykladowe. Start w trybie observe (proporcjonalnosc 2026-10-13):
// wypisuje ostrzezenie i zapisuje `would_block` w gates.jsonl, commit przechodzi. `--enforce` = blok (exit 1).
// Uzycie: node service-role-gate.js --staged [--enforce] [--json]
// Exit: 0 OK albo observe, 1 blok (--enforce), 2 blad uzycia.
const path = require('path');
const { addedLines } = require(path.join(__dirname, 'commented-code-gate.js'));
const { stagedDiff, failOpen } = require(path.join(__dirname, 'lib', 'git-staged.js'));
const { log } = require(path.join(__dirname, '..', 'hooks', 'lib', 'gate-log.js'));

const CODE_FILE_RX = /\.(ts|tsx|js|jsx|mjs|cjs|vue|svelte)$/i;
const CLIENT_DIR_RX = /(^|\/)(src|app|components|pages)\//;
// Kod, ktory nie trafia do przegladarki: API/route handlery, katalogi server, akcje serwerowe, funkcje edge, skrypty.
// Waska lista (recenzja 2026-11-15): `src/api/`, `src/lib/supabase/`, `src/features/jobs/` to w aplikacji Vite kod przegladarki,
// wiec sama nazwa katalogu nie robi z pliku serwera. Serwer = API routera Next, katalog `server/`, sufiks `.server`,
// pliki route/middleware/server, funkcje edge i katalogi narzedziowe NA POCZATKU sciezki repo.
const SERVER_PATH_RX = /(^|\/)(app|pages)\/api\/|(^|\/)server\/|\.server\.[a-z]+$|(^|\/)(route|middleware|server)\.[a-z]+$|^supabase\/|(^|\/)supabase\/functions\/|^(scripts|functions|cron|jobs|workers?)\//i;
const TEST_FILE_RX = /(\.(test|spec)\.|_test\.|(^|\/)(tests?|e2e|__tests__|fixtures?|mocks?)\/)/i;
const SERVICE_ROLE_RX = /service_role|SERVICE_ROLE|serviceRole/;
const COMMENT_LINE_RX = /^\s*(\/\/|\/\*|\*|<!--)/;

/** Dodane linie diffu -> trafienia [{file, line, text}]. Czysta funkcja. */
function analyze(rows) {
  const hits = [];
  for (const r of rows) {
    if (r.text === null || !CODE_FILE_RX.test(r.file) || !CLIENT_DIR_RX.test(r.file)) continue;
    if (SERVER_PATH_RX.test(r.file) || TEST_FILE_RX.test(r.file)) continue;
    if (COMMENT_LINE_RX.test(r.text)) continue; // sam opis w komentarzu (pomiar 2026-11-15: 2/2 trafien w ~/src to komentarze)
    if (SERVICE_ROLE_RX.test(r.text)) hits.push({ file: r.file, line: r.line, text: r.text.trim().slice(0, 120) });
  }
  return hits;
}

function main() {
  const argv = process.argv.slice(2);
  if (!argv.includes('--staged')) { process.stderr.write('service-role-gate: uzycie: node service-role-gate.js --staged [--enforce] [--json]\n'); return 2; }
  const enforce = argv.includes('--enforce');
  let diff = '';
  try { diff = stagedDiff(); } catch (e) { return failOpen('service-role-gate', e); }
  const hits = analyze(addedLines(diff));
  if (argv.includes('--json')) { process.stdout.write(JSON.stringify({ blocked: enforce && hits.length > 0, hits }) + '\n'); return enforce && hits.length ? 1 : 0; }
  if (!hits.length) return 0;
  if (!enforce) log({ hook: 'pre-commit', event: 'would_block', gate: 'SERVICE_ROLE_CLIENT', reason: `service_role w kodzie klienta: ${hits.length} linii`, target: process.cwd() });
  process.stdout.write(`service-role-gate: ${enforce ? 'BLOK' : 'OSTRZEZENIE (observe, commit przechodzi)'} — service_role w kodzie klienta (${hits.length}):\n`);
  for (const h of hits.slice(0, 10)) process.stdout.write(`  ${h.file}:${h.line}  ${h.text}\n`);
  process.stdout.write('Klucz service_role omija RLS: uzyj go tylko po stronie serwera (route handler, funkcja edge), w przegladarce klucz anon.\n');
  return enforce ? 1 : 0;
}

module.exports = { analyze, SERVICE_ROLE_RX, SERVER_PATH_RX };
if (require.main === module) process.exit(main());

#!/usr/bin/env node
'use strict';
// todo-ledger-gate: dlug technologiczny = kredyt z odsetkami, ZAPISYWANY w momencie zaciagniecia (slownik SH
// sekcja 8; PG gap L9). Nowy marker dlugu (TODO, FIXME, HACK, XXX) w KOMENTARZU kodu bez zmiany
// `docs/quality/BACKLOG.md` w tym samym commicie = blok. Liczy tylko DODANE linie (stary dlug nie blokuje —
// zasada 2026-08-09). Testy i docs pominiete (TODO w tescie = niski koszt; docs nie sa kodem).
// Uzycie: node todo-ledger-gate.js --staged [--json]   (pre-commit; wyjatek ALLOW_TODO=1)
// Exit: 0 OK, 1 blok, 2 blad uzycia.
const path = require('path');
const { addedLines } = require(path.join(__dirname, 'commented-code-gate.js'));
const { stagedDiff, failOpen } = require(path.join(__dirname, 'lib', 'git-staged.js'));

const CODE_FILE_RX = /\.(ts|tsx|js|jsx|mjs|cjs|py|sql|go|rs|vue|svelte|kt|swift|rb|php|cs)$/i;
const TEST_FILE_RX = /(\.(test|spec)\.|_test\.|(^|\/)test_[^/]*\.(js|py|ts)$|(^|\/)(tests?|e2e|__tests__|fixtures?)\/)/i;
// Tylko marker poprzedzony znacznikiem komentarza (JS/TS, Python, SQL, blok, gwiazdka, HTML) — nie w regexie/stringu.
// (Ten sam wzorzec zapisany doslownie w komentarzu tego pliku blokowalby jego wlasny commit — dogfood 2026-09-12.)
const DEBT_RX = /(?:\/\/|#|\/\*|--|<!--|\*)\s*(TODO|FIXME|HACK|XXX)\b/;
const LEDGER_RX = /(^|\/)docs\/quality\/BACKLOG\.md$/;

/** Dodane linie diffu -> { debts: [{file,line,text}], ledgerTouched }. Czysta funkcja. */
function analyze(rows) {
  const debts = [];
  let ledgerTouched = false;
  for (const r of rows) {
    if (r.text === null) continue;
    if (LEDGER_RX.test(r.file)) { ledgerTouched = true; continue; }
    if (!CODE_FILE_RX.test(r.file) || TEST_FILE_RX.test(r.file)) continue;
    const m = r.text.match(DEBT_RX);
    if (m) debts.push({ file: r.file, line: r.line, text: r.text.trim().slice(0, 120), marker: m[1] });
  }
  return { debts, ledgerTouched };
}

function main() {
  const argv = process.argv.slice(2);
  if (!argv.includes('--staged')) { process.stderr.write('todo-ledger-gate: uzycie: node todo-ledger-gate.js --staged [--json]\n'); return 2; }
  let diff = '';
  try { diff = stagedDiff(); } catch (e) { return failOpen('todo-ledger-gate', e); }
  const result = analyze(addedLines(diff));
  const blocked = result.debts.length > 0 && !result.ledgerTouched;
  if (argv.includes('--json')) { process.stdout.write(JSON.stringify(Object.assign({ blocked }, result)) + '\n'); return blocked ? 1 : 0; }
  if (!result.debts.length) { process.stdout.write('todo-ledger-gate: OK — brak nowych TODO/FIXME/HACK/XXX w kodzie\n'); return 0; }
  if (result.ledgerTouched) { process.stdout.write(`todo-ledger-gate: OK — ${result.debts.length} nowych skrotow, BACKLOG.md zaktualizowany w tym commicie\n`); return 0; }
  process.stdout.write(`todo-ledger-gate: BLOK — ${result.debts.length} nowych skrotow bez wiersza w docs/quality/BACKLOG.md:\n`);
  for (const d of result.debts.slice(0, 10)) process.stdout.write(`  ${d.file}:${d.line}  ${d.text}\n`);
  process.stdout.write('Dopisz wiersz: data | plik:linia | skrot | odsetki (co spowolni) | splata do. Albo usun skrot i zrob to teraz.\n');
  return 1;
}

module.exports = { analyze, DEBT_RX };
if (require.main === module) process.exit(main());

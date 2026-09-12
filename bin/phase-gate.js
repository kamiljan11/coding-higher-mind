#!/usr/bin/env node
'use strict';
// phase-gate: faza projektu jest DECYZJA, nie dryfem (slownik SH sekcja 1-2: „prototyp nie jest produktem";
// PG gap L1). Pilnuje `pg.phase:` w CLAUDE.md (repo albo podkatalog):
//  - wartosc spoza listy = blok (literowka „prodcution" nie moze byc cicha),
//  - zmiana z innej fazy NA `production` bez wypelnionego PRR (`docs/prr/<RRRR-MM-DD>.md` w tym samym commicie,
//    obok tego CLAUDE.md) = blok. Pierwsza deklaracja `production` (bez starej wartosci) = informacja, nie blok
//    (opisujemy stan zastany, nie promujemy).
// Uzycie: node phase-gate.js --staged [--json]   (pre-commit; wyjatek ALLOW_PHASE=1)
// Exit: 0 OK, 1 blok, 2 blad narzedzia.
const fs = require('fs');
const path = require('path');
const { PHASES, PROTOTYPE_PHASES } = require(path.join(__dirname, '..', 'hooks', 'lib', 'risk-tier.js'));
const LIVE_PHASES = new Set(['production', 'maintenance', 'handoff']);
const { stagedDiff, stagedFiles, stagedContent, failOpen } = require(path.join(__dirname, 'lib', 'git-staged.js'));

// Tylko linia deklaracji (`- \`pg.phase: x\``), nie zdanie w prozie — ta sama kotwica co w risk-tier.js.
const PHASE_RX = /^\s*(?:-\s*)?`?pg\.phase:\s*([A-Za-z_-]+)`?\s*(?:<!--.*)?$/;
const OWNERSHIP_RX = /pg\.ownership:\s*(client-[a-z]+)/;
const PRR_DOC_RX = /(^|\/)docs\/prr\/[^/]+\.md$/;
const ACCEPTANCE_DOC = 'docs/ACCEPTANCE.md';
const ACCEPTANCE_ROW_RX = /^\|\s*E\d+\s*\|.*\|\s*\d{4}-\d{2}-\d{2}\s*\|/m; // wiersz etapu z DATA odbioru (nie szablon RRRR-MM-DD)
const PROMOTION_TARGET = 'production';

/** Diff (-U0) CLAUDE.md -> [{file, oldPhase, newPhase}]. Czysta funkcja. */
function phaseChanges(diffText) {
  const byFile = new Map();
  let file = null;
  for (const raw of diffText.split('\n')) {
    if (raw.startsWith('+++ ')) { file = raw.slice(4).replace(/^b\//, ''); if (file === '/dev/null') file = null; else byFile.set(file, { file, oldPhase: null, newPhase: null }); continue; }
    if (!file || raw.startsWith('---') || raw.startsWith('+++')) continue;
    const m = raw.slice(1).match(PHASE_RX);
    if (!m) continue;
    if (raw.startsWith('-')) byFile.get(file).oldPhase = m[1];
    else if (raw.startsWith('+')) byFile.get(file).newPhase = m[1];
  }
  return [...byFile.values()].filter((c) => c.newPhase !== null);
}

/** Zmiany + lista stagowanych plikow (+ opcjonalnie readFile(rel) dla ownership/ACCEPTANCE) -> { violations, info }. Czysta funkcja. */
function analyze(changes, stagedFiles, readFile = () => '') {
  const violations = [];
  const info = [];
  for (const c of changes) {
    const dir = path.posix.dirname(c.file);
    const prefix = dir === '.' ? '' : dir + '/';
    const prrDocs = stagedFiles.filter((f) => PRR_DOC_RX.test(f) && (dir === '.' ? !f.includes('/docs/prr/') || f.startsWith('docs/prr/') : f.startsWith(dir + '/')));
    if (!PHASES.includes(c.newPhase)) { violations.push(`${c.file}: nieznana faza \`${c.newPhase}\` — dozwolone: ${PHASES.join(' | ')}`); continue; }
    // Degradacja z produkcji do prototypu = zdjecie review z zywego systemu jednym commitem (security-reviewer 2026-09-12:
    // PHASE-DEMOTION-UNGATED). Swiadome wycofanie z produkcji = ALLOW_PHASE=1 (logowane) albo faza `handoff`/`maintenance`.
    if (LIVE_PHASES.has(c.oldPhase) && PROTOTYPE_PHASES.has(c.newPhase)) {
      violations.push(`${c.file}: degradacja ${c.oldPhase} -> ${c.newPhase} zdejmuje review dzialowy z systemu, ktory byl na produkcji; wycofanie = \`maintenance\`/\`handoff\`, albo swiadomie ALLOW_PHASE=1 (zostaje w logs/gates.jsonl)`);
      continue;
    }
    if (c.newPhase === PROMOTION_TARGET && c.oldPhase && c.oldPhase !== PROMOTION_TARGET) {
      if (!prrDocs.length) violations.push(`${c.file}: promocja ${c.oldPhase} -> ${PROMOTION_TARGET} bez ${prefix}docs/prr/<RRRR-MM-DD>.md w tym samym commicie (wypelnij ~/.claude/pg/prr.md: P1-P17)`);
      else info.push(`${c.file}: promocja ${c.oldPhase} -> ${PROMOTION_TARGET} z PRR ${prrDocs.join(', ')}`);
      // Repo klienckie: „bez protokolu odbioru nie ma dostawy" (slownik SH sekcja 10; recheck 2026-09-12: ACCEPTANCE.md nic nie gate'owal).
      const ownership = (readFile(c.file) || '').match(OWNERSHIP_RX);
      if (ownership && !ACCEPTANCE_ROW_RX.test(readFile(prefix + ACCEPTANCE_DOC) || '')) {
        violations.push(`${c.file}: pg.ownership ${ownership[1]} — promocja na production wymaga odebranego etapu w ${prefix}${ACCEPTANCE_DOC} (wiersz |E1|...|RRRR-MM-DD| z prawdziwa data odbioru przez klienta)`);
      }
    } else {
      info.push(`${c.file}: pg.phase ${c.oldPhase || '(brak)'} -> ${c.newPhase}`);
    }
  }
  return { violations, info };
}

function main() {
  const argv = process.argv.slice(2);
  if (!argv.includes('--staged')) { process.stderr.write('phase-gate: uzycie: node phase-gate.js --staged [--json]\n'); return 2; }
  let diff = '';
  let staged = [];
  try { diff = stagedDiff(['*CLAUDE.md', '**/CLAUDE.md']); staged = stagedFiles(); }
  catch (e) { return failOpen('phase-gate', e); }
  // Tresc z INDEKSU (to, co bedzie zacommitowane), z fallbackiem na drzewo robocze dla plikow nietkniętych w tym commicie.
  const readFile = (rel) => { try { return stagedContent(rel); } catch (e) { try { return fs.readFileSync(rel, 'utf8'); } catch (e2) { return ''; } } };
  const result = analyze(phaseChanges(diff), staged, readFile);
  if (argv.includes('--json')) process.stdout.write(JSON.stringify(result) + '\n');
  else {
    for (const line of result.info) process.stdout.write(`phase-gate: ${line}\n`);
    for (const line of result.violations) process.stdout.write(`phase-gate: BLOK — ${line}\n`);
  }
  return result.violations.length ? 1 : 0;
}

module.exports = { phaseChanges, analyze };
if (require.main === module) process.exit(main());

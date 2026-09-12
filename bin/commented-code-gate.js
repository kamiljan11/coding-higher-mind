#!/usr/bin/env node
// commented-code-gate: NOWO dodany zakomentowany kod = blok (0 tokenow). Research 2026-09-06
// (research-ai-slop.md, zrodlo 9 "comment traps"): zakomentowany kod jest zarazliwym kontekstem —
// nastepny agent "dokancza" bledny wzorzec z komentarza. Kod usuwamy, nie opisujemy; historia jest w gicie.
//
// Regula: >= 3 KOLEJNE dodane linie komentarza, ktore wygladaja jak kod (srednik na koncu, `=>`, `const|let|
// return|if (|for (|import |export |def |class |self.`, wywolanie `x(...)` z nawiasem) = blokada.
// Pojedyncza linia (np. "// return early" jako opis) nie liczy sie. Wyjatek swiadomy: ALLOW_COMMENTED_CODE=1.
//
// Uzycie: node commented-code-gate.js [--base origin/main] [--staged] [--min-run 3]
'use strict';
const { execFileSync } = require('node:child_process');

const CODE_EXT = /\.(c?m?[jt]sx?|py|go|rs|kt|java|cs|php|rb|vue|svelte|sql)$/;
const COMMENT_RX = /^\s*(\/\/|#|\*|\/\*|--)\s?(.*)$/;
// Sygnaly KODU, nie prozy: linia konczy sie `;`/`{`/`}` po tokenie kodu, zaczyna sie slowem kluczowym
// z identyfikatorem/nawiasem, jest golym wywolaniem `foo(bar);` albo samym `}`/`]`. Celowo BEZ `=>` i `= x` —
// polska proza w naglowkach hookow uzywa obu ("Exit 2 => komenda", "`.env` = sekrety") i dawala falszywe alarmy
// przy pierwszym commicie repo PG (2026-09-06).
const LOOKS_LIKE_CODE = /^[\w.$[\]'"`()<>!=+\-*/%&|?:, ]*[\w)\]'"`]\s*;\s*$|^\s*(const|let|var|return|if|for|while|import|export|def|class|await|async|function|elif|else|try|catch|finally)\b\s*[\w(:{]|^\s*self\.\w+\s*[=(]|^\s*[\w.]+\([^)]*\)\s*;?\s*$|^\s*[}\]]\)?;?\s*$|^\s*(from|import)\s+\w+/;

/** Diff -> [{file, line, text}] dodanych linii. Czysta funkcja. */
function addedLines(diffText) {
  const rows = [];
  let file = null, lineNo = 0;
  for (const raw of diffText.split('\n')) {
    if (raw.startsWith('+++ ')) { file = raw.slice(4).replace(/^b\//, ''); if (file === '/dev/null') file = null; continue; }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (hunk) { lineNo = Number(hunk[1]); continue; }
    if (!file || raw.startsWith('---')) continue;
    if (raw.startsWith('+')) { rows.push({ file, line: lineNo, text: raw.slice(1) }); lineNo++; }
    else if (!raw.startsWith('-') && !raw.startsWith('\\')) { rows.push({ file, line: lineNo, text: null }); lineNo++; }
  }
  return rows;
}

/** Ciagi >= minRun dodanych linii komentarza wygladajacych jak kod. Czysta funkcja. */
function findRuns(rows, minRun) {
  const runs = [];
  let cur = null;
  const flush = () => { if (cur && cur.count >= minRun) runs.push(cur); cur = null; };
  for (const r of rows) {
    if (r.text === null || !CODE_EXT.test(r.file)) { flush(); continue; }
    const m = COMMENT_RX.exec(r.text);
    const body = m ? m[2] : null;
    const isCode = body !== null && body.trim().length > 2 && LOOKS_LIKE_CODE.test(body) && !/^(TODO|FIXME|NOTE|eslint|prettier|gitleaks|nosemgrep|@ts-|noqa|type:|pragma)/i.test(body.trim());
    if (isCode) { if (cur && cur.file === r.file && r.line === cur.last + 1) { cur.count++; cur.last = r.line; } else { flush(); cur = { file: r.file, start: r.line, last: r.line, count: 1, sample: body.trim().slice(0, 70) }; } }
    else flush();
  }
  flush();
  return runs;
}

function main() {
  const argv = process.argv.slice(2);
  const staged = argv.includes('--staged');
  const base = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : 'origin/main';
  const minRun = argv.includes('--min-run') ? Number(argv[argv.indexOf('--min-run') + 1]) : 3;
  const diff = execFileSync('git', staged ? ['diff', '--cached', '-U0', '--no-color'] : ['diff', '-U0', '--no-color', `${base}...HEAD`], { encoding: 'utf8', maxBuffer: 64 << 20 });
  const runs = findRuns(addedLines(diff), minRun);
  if (!runs.length) { console.log('commented-code-gate: OK — brak nowo dodanego zakomentowanego kodu'); return 0; }
  console.log(`commented-code-gate: ${runs.length} blok(ow) zakomentowanego kodu w NOWYM diffie:`);
  for (const r of runs) console.log(`   ${r.file}:${r.start}-${r.last}  (${r.count} linii)  np. "${r.sample}"`);
  console.log('Usun — historia jest w gicie; komentarz z martwym kodem uczy nastepnego agenta blednego wzorca. Swiadomy wyjatek: ALLOW_COMMENTED_CODE=1.');
  return 1;
}

if (require.main === module) { try { process.exit(main()); } catch (err) { console.error('commented-code-gate: ' + err.message.split('\n')[0]); process.exit(2); } }
module.exports = { addedLines, findRuns };

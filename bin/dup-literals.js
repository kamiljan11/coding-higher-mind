#!/usr/bin/env node
// dup-literals: powtorzone literaly w NOWYM kodzie (dodane linie diffu), 0 tokenow.
//
// Blizna: tozsamosc firmy (marka, kennitala, adres, telefon) w 45 miejscach w 11 plikach
// (rental-site, 2026-09-06) — kazda z 45 kopii przeszla lint, typy, testy i review.
// LLM powtarza literal zamiast wskazac na jedno zrodlo (duplikacja +81 %, udokumentowana
// tendencja). Ten skaner patrzy TYLKO na linie dodane w diffie, wiec nie rusza dlugu
// historycznego (zasada 2026-08-09) i nie da falszywego alarmu na starym kodzie.
//
// Regula: ten sam literal tekstowy (>= MIN_LEN znakow, po odcieciu cudzyslowow) dodany
// >= MAX_COPIES razy w >= 2 PLIKACH = blokada. W jednym pliku to zwykle tablica danych
// (seed, i18n, testy) i nie jest slopem — dlatego prog na pliki, nie na wystapienia.
//
// Uzycie: node dup-literals.js [--base origin/main] [--staged] [--min-len 12] [--max-copies 3] [--json]
//   --staged  : diff indeksu (pre-commit); domyslnie diff base...HEAD + working tree
// Wyjscie: lista literal -> pliki:linie; exit 1 gdy jest blokada.
// Ignorowane: testy, pliki i18n/locale, seedy SQL, lockfile'y, snapshoty, markdown.

'use strict';

const { execFileSync } = require('node:child_process');

const DEFAULTS = { base: 'origin/main', minLen: 12, maxCopies: 3 };
// Testy takze w konwencji `test_*.js|py` i katalogach `tests/` (~/.claude, Python) — false positive 2026-09-12:
// bateria testow bramek powtarza nazwy narzedzi ("phase-gate.js" x5) i blokowala wlasny commit.
const IGNORE_PATH = /(\.(test|spec)\.[cm]?[jt]sx?$)|(__tests__\/)|((^|\/)test_[^/]*\.(py|[cm]?[jt]s)$)|((^|\/)tests?\/)|(\/(i18n|locales?|translations?)\/)|(\.snap$)|(seed\.sql$)|(lock(\.json|b|file)?$)|(\.md$)|(\.json$)|(\.svg$)|(\.css$)/;
const CODE_EXT = /\.(c?m?[jt]sx?|py|sql|go|rs|kt|java|cs|php|rb|vue|svelte)$/;
// Literal: "..." lub '...' lub `...` bez interpolacji. Odrzucamy sciezki importow i URL-e:
// import z tej samej sciezki w wielu plikach to norma, nie slop.
const LITERAL_RX = /(["'`])((?:\\.|(?!\1)[^\\\n$])+?)\1/g;
// Wyjatki: sciezki (./x, @/x, pakiet/sciezka), URL-e, dyrektywy modulu, klasy Tailwind/CSS
// (same tokeny z myslnikami i cyframi, bez wielkich liter i bez spacji poza separatorami klas),
// NAZWY PLIKOW (`phase-gate.js`, `RUNBOOK.md` — odwolanie do narzedzia/pliku, nie tozsamosc do wyciagniecia).
// (bez flagi `i`: z nia "Acme Rentals Ltd." wpadalo w alternatywe klas CSS — regresja zlapana przez test_dup_literals 2026-09-12)
// KLUCZE KONFIGURACJI (`core.hooksPath`, `user.email`) i ZNANE KATALOGI (`node_modules`, `dist`) — 2026-09-12: trzy samodzielne
// skrypty instalatora (install/uninstall/selftest) musza powtarzac klucz gita, bo nie moga sie nawzajem importowac przed instalacja.
const NOT_SLOP_RX = /^(\.{0,2}\/|@\/|https?:\/\/|[a-z0-9@][a-z0-9@._-]*\/[a-z0-9@._/-]*$|use (client|server|strict)$|(?:[a-z0-9:\-[\]/.%]+ )+[a-z0-9:\-[\]/.%]+$|[\w.-]+\.(m?[jt]sx?|py|md|json|ya?ml|sql|ps1|sh|toml|txt|css|html|png|svg)$|[a-z]+(?:\.[A-Za-z]+)+$|(?:node_modules|dist|build|coverage|__pycache__|\.ruff_cache)$)/;
// Linie importow/require: specyfikator modulu (`child_process`, `node:fs`) powtarza sie z definicji.
const IMPORT_LINE_RX = /\brequire\s*\(|^\s*import\b|\bfrom\s+["']/;

function parseArgs(argv) {
  const out = { ...DEFAULTS, staged: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--staged') out.staged = true;
    else if (a === '--json') out.json = true;
    else if (a === '--base') out.base = argv[++i];
    else if (a === '--min-len') out.minLen = Number(argv[++i]);
    else if (a === '--max-copies') out.maxCopies = Number(argv[++i]);
  }
  return out;
}

function gitDiff(opts) {
  const args = opts.staged
    ? ['diff', '--cached', '-U0', '--no-color', '--diff-filter=AM']
    : ['diff', '-U0', '--no-color', '--diff-filter=AM', `${opts.base}...HEAD`];
  try {
    const committed = execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (opts.staged) return committed;
    const working = execFileSync('git', ['diff', '-U0', '--no-color', '--diff-filter=AM'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    return committed + '\n' + working;
  } catch (err) {
    throw new Error(`git diff nie powiodl sie (${args.join(' ')}): ${err.message.split('\n')[0]}`);
  }
}

/** Dodane linie z diffu jako [{file, line, text}]. Czysta funkcja — testowalna bez gita. */
function addedLines(diffText) {
  const rows = [];
  let file = null;
  let lineNo = 0;
  for (const raw of diffText.split('\n')) {
    if (raw.startsWith('+++ ')) {
      file = raw.slice(4).replace(/^b\//, '');
      if (file === '/dev/null') file = null;
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (hunk) { lineNo = Number(hunk[1]); continue; }
    if (!file || raw.startsWith('---') || raw.startsWith('+++')) continue;
    if (raw.startsWith('+')) { rows.push({ file, line: lineNo, text: raw.slice(1) }); lineNo++; }
    else if (!raw.startsWith('-') && !raw.startsWith('\\')) lineNo++;
  }
  return rows;
}

/** Literal -> lista {file, line}. Czysta funkcja. */
function collectLiterals(rows, minLen) {
  const map = new Map();
  for (const { file, line, text } of rows) {
    if (!CODE_EXT.test(file) || IGNORE_PATH.test(file)) continue;
    if (/^\s*(\/\/|#|\*|\/\*)/.test(text)) continue; // komentarz
    if (IMPORT_LINE_RX.test(text)) continue; // import/require — specyfikator modulu to nie duplikat
    for (const m of text.matchAll(LITERAL_RX)) {
      const lit = m[2].trim();
      if (lit.length < minLen || NOT_SLOP_RX.test(lit)) continue;
      if (!map.has(lit)) map.set(lit, []);
      map.get(lit).push({ file, line });
    }
  }
  return map;
}

/** Zwraca tylko literaly przekraczajace prog: >= maxCopies wystapien W >= 2 plikach. */
function offenders(map, maxCopies) {
  const out = [];
  for (const [lit, hits] of map) {
    const files = new Set(hits.map((h) => h.file));
    if (hits.length >= maxCopies && files.size >= 2) out.push({ literal: lit, count: hits.length, files: files.size, hits });
  }
  return out.sort((a, b) => b.count - a.count);
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const found = offenders(collectLiterals(addedLines(gitDiff(opts)), opts.minLen), opts.maxCopies);
  if (opts.json) { process.stdout.write(JSON.stringify(found, null, 1) + '\n'); return found.length ? 1 : 0; }
  if (!found.length) { console.log('dup-literals: OK — brak literalu dodanego >= ' + opts.maxCopies + 'x w >= 2 plikach'); return 0; }
  console.log(`dup-literals: ${found.length} literal(ow) powtorzonych w NOWYM kodzie — jedno zrodlo prawdy zamiast kopii:`);
  for (const f of found) {
    console.log(`  "${f.literal.slice(0, 60)}"  x${f.count} w ${f.files} plikach`);
    for (const h of f.hits.slice(0, 8)) console.log(`      ${h.file}:${h.line}`);
    if (f.hits.length > 8) console.log(`      ... +${f.hits.length - 8}`);
  }
  console.log('Wyciagnij do stalej/modulu (np. src/lib/company.ts) i importuj. Swiadomy wyjatek: ALLOW_DUP_LITERALS=1.');
  return 1;
}

if (require.main === module) {
  try { process.exit(main()); } catch (err) { console.error('dup-literals: ' + err.message); process.exit(2); }
}

module.exports = { addedLines, collectLiterals, offenders };

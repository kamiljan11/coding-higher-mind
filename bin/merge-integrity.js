#!/usr/bin/env node
'use strict';
// merge-integrity: kontrola po scaleniu rownoleglych galezi (lekcja 2026-10-06: rozwiazanie konfliktu „ours+theirs"
// w plikach z nawiasami ucielo `}`; lint/tsc/build/qa-matrix tego nie zlapaly, bo CSS jest poblazliwy).
// Dla plikow zmienionych w scaleniu sprawdza:
//  (a) bilans nawiasow {} () [] w .css/.scss/.ts/.tsx/.js/.jsx/.json (wersja z --head),
//  (b) ze kazda niepusta linia dodana w kazdej galezi wzgledem base (diff base...galaz) istnieje w --head
//      (multizbior per plik, porownanie po trim) — lista zgubionych linii.
// Uzycie: node merge-integrity.js --repo <dir> --base <ref> --branches a,b[,c] [--head HEAD] [--json]
// Exit: 0 czysto, 1 problemy (niezbilansowane pliki / zgubione linie), 2 blad uzycia / gita.
const { execFileSync } = require('child_process');
const path = require('path');
const { checkFile, kindOf } = require(path.join(__dirname, '..', 'hooks', 'lib', 'css-balance.js'));

const EXIT = { OK: 0, PROBLEMS: 1, USAGE: 2 };
const MAX_LOST_SHOWN = 50;
// Repo moze byc obce: zero wykonania kodu przez jego .git/config (fsmonitor, hooki) — jak CHILD_ENV w lint-file.js.
const GIT_ENV = Object.assign({}, process.env, {
  GIT_CONFIG_PARAMETERS: "'core.fsmonitor=false' 'core.untrackedCache=false' 'core.hooksPath=/dev/null'",
  GIT_PAGER: 'cat', LC_ALL: 'C', GIT_LITERAL_PATHSPECS: '1',
});

function parseArgs(argv) {
  const o = { repo: '.', base: null, branches: [], head: 'HEAD', json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => { const v = argv[++i]; if (v === undefined) throw new Error(`${a}: brak wartosci`); return v; };
    if (a === '--repo') o.repo = next();
    else if (a === '--base') o.base = next();
    else if (a === '--branches') o.branches = next().split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--head') o.head = next();
    else if (a === '--json') o.json = true;
    else throw new Error(`nieznany argument: ${a}`);
  }
  if (!o.base) throw new Error('wymagane --base <ref>');
  if (!o.branches.length) throw new Error('wymagane --branches a,b,...');
  for (const ref of [o.base, o.head, ...o.branches]) if (/^-/.test(ref)) throw new Error(`niedozwolony ref: ${ref}`);
  o.repo = path.resolve(o.repo);
  return o;
}

const git = (repo, args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', env: GIT_ENV, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
function showFile(repo, ref, file) {
  try { return git(repo, ['show', `${ref}:${file}`]); } catch (e) { return null; }
}

/** Unified diff (-U0) -> Map(plik -> [dodane linie]). Czysta funkcja. Naglowek pliku konczy sie na pierwszym `@@`:
 *  linia tresci `++ x` (w diffie `+++ x`) nie jest naglowkiem. Nazwa z `diff --git`/`+++` tylko orientacyjnie —
 *  check() wola diff per plik, wiec nazwy ze spacja/ogonkami (cytowane, z tabem) nie psuja wyniku. */
function addedLinesByFile(diff) {
  const out = new Map();
  let file = null;
  let inHunk = false;
  for (const l of String(diff).split('\n')) {
    if (l.startsWith('diff --git ')) { inHunk = false; file = null; continue; }
    if (!inHunk) {
      if (l.startsWith('+++ ')) { file = l === '+++ /dev/null' ? null : l.slice(4).replace(/\t$/, '').replace(/^b\//, ''); if (file && !out.has(file)) out.set(file, []); }
      else if (l.startsWith('@@')) inHunk = true;
      continue;
    }
    if (l.startsWith('@@')) continue;
    if (file && l.startsWith('+')) out.get(file).push(l.slice(1));
  }
  return out;
}

/** Zgubione linie: dodane (niepuste, po trim) w galezi, ktorych w head jest mniej niz dodano. Czysta funkcja. */
function lostLines(added, headText) {
  if (headText === null) return added.filter((l) => l.trim()).map((l) => ({ line: l.trim(), reason: 'plik nie istnieje w head' }));
  const have = new Map();
  for (const l of headText.split('\n')) { const t = l.trim(); if (t) have.set(t, (have.get(t) || 0) + 1); }
  const need = new Map();
  for (const l of added) { const t = l.trim(); if (t) need.set(t, (need.get(t) || 0) + 1); }
  const lost = [];
  for (const [t, n] of need) { const h = have.get(t) || 0; if (h < n) lost.push({ line: t, reason: `dodana ${n}x w galezi, w head ${h}x` }); }
  return lost;
}

// -z: nazwy ze spacja / polskimi znakami bez cytowania (bez -z git zwraca "\\305\\202" i show/diff ich nie znajda).
const changedFiles = (repo, range) => git(repo, ['diff', '-z', '--name-only', '--diff-filter=AMR', ...range]).split('\0').filter(Boolean);

function check(opts) {
  git(opts.repo, ['rev-parse', '--verify', '--quiet', `${opts.head}^{commit}`]);
  const files = new Set(changedFiles(opts.repo, [opts.base, opts.head]));
  const lost = [];
  for (const br of opts.branches) {
    for (const file of changedFiles(opts.repo, [`${opts.base}...${br}`])) {
      files.add(file);
      const diff = git(opts.repo, ['diff', '--no-color', '--no-ext-diff', '--no-renames', '-U0', `${opts.base}...${br}`, '--', file]);
      const added = [].concat(...addedLinesByFile(diff).values());
      for (const l of lostLines(added, showFile(opts.repo, opts.head, file))) lost.push(Object.assign({ branch: br, file }, l));
    }
  }
  const unbalanced = [];
  for (const file of [...files].sort()) {
    if (!kindOf(file)) continue;
    const text = showFile(opts.repo, opts.head, file);
    if (text === null) continue;
    const err = checkFile(file, text);
    if (err) unbalanced.push(Object.assign({ file }, err));
  }
  return { repo: opts.repo, base: opts.base, head: opts.head, branches: opts.branches, filesChecked: files.size, unbalanced, lost };
}

function render(r) {
  const lines = [`merge-integrity: ${r.head} vs base ${r.base}, galezie: ${r.branches.join(', ')} · plikow: ${r.filesChecked}`];
  if (!r.unbalanced.length && !r.lost.length) { lines.push('OK — nawiasy zbilansowane, kazda dodana linia z galezi jest w head'); return lines.join('\n') + '\n'; }
  if (r.unbalanced.length) {
    lines.push('', `Niezbilansowane nawiasy (${r.unbalanced.length}):`);
    for (const u of r.unbalanced) lines.push(`  ${u.file}:${u.line}: ${u.message}`);
  }
  if (r.lost.length) {
    lines.push('', `Zgubione linie (${r.lost.length}) — dodane w galezi, brak w head:`);
    for (const l of r.lost.slice(0, MAX_LOST_SHOWN)) lines.push(`  [${l.branch}] ${l.file}: ${l.line}  (${l.reason})`);
    if (r.lost.length > MAX_LOST_SHOWN) lines.push(`  ... i ${r.lost.length - MAX_LOST_SHOWN} wiecej (--json)`);
  }
  return lines.join('\n') + '\n';
}

function main(argv) {
  let opts;
  try { opts = parseArgs(argv); } catch (e) { process.stderr.write(`merge-integrity: ${e.message}\n`); return EXIT.USAGE; }
  let report;
  try { report = check(opts); } catch (e) { process.stderr.write(`merge-integrity: blad gita: ${String(e.stderr || e.message).trim().split('\n')[0]}\n`); return EXIT.USAGE; }
  process.stdout.write(opts.json ? JSON.stringify(report, null, 2) + '\n' : render(report));
  return report.unbalanced.length || report.lost.length ? EXIT.PROBLEMS : EXIT.OK;
}

module.exports = { parseArgs, addedLinesByFile, lostLines, check, render, EXIT };
if (require.main === module) process.exit(main(process.argv.slice(2)));

// Liczba zmienionych linii, ktora decyduje o progu T2/T3 (risk-tier.js). Jedno zrodlo dla stop-gate (niezacommitowane
// zmiany sesji) i dla pg-review krok 0 (`risk-tier.js --lines auto`). Liczy tak, jak policzy `git show --numstat` po
// commicie: sledzone pliki z `git diff --numstat HEAD`, nieśledzone jako cale dodane. Przypadek 2026-10-27
// (demo-site#100): pg-review liczyl tylko `numstat HEAD`, nowy e2e spec (60 linii) wypadl -> T2, a stop-gate po
// commicie zmierzyl 650 linii -> T3 i zablokowal Stop bez dzialow security/data.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { CHILD_ENV } = require('./lint-file');
const { log } = require('./gate-log');

const GIT_TIMEOUT_MS = 15000;
const CHUNK = 1024 * 1024;

// realpath: Windows ma dwie formy tej samej sciezki (8.3 z %TEMP% vs pelna z gita).
const normPath = (p) => {
  let r = path.resolve(String(p));
  try { r = fs.realpathSync.native(r); } catch (e) { /* plik usuniety — zostaje forma rozwiazana */ }
  return r.replace(/\\/g, '/').toLowerCase();
};

function git(root, args) {
  const r = spawnSync('git', ['-c', 'core.quotePath=false', ...args], { cwd: root, timeout: GIT_TIMEOUT_MS, env: CHILD_ENV, maxBuffer: 32 * 1024 * 1024 });
  return { ok: r.status === 0, out: String(r.stdout || '') };
}

// Linie tak, jak liczy je git numstat: liczba `\n`, plus jedna, gdy plik nie konczy sie `\n`. Plik binarny (bajt 0
// w pierwszych 8000, heurystyka gita) = 0, jak `-` w numstat. Czytane kawalkami, wiec duzy plik nie laduje sie do pamieci.
// lstat: symlink do /dev/zero albo FIFO zawiesilby hook do timeoutu (security-review 2026-10-04).
function untrackedFileLines(abs) {
  const s = fs.lstatSync(abs);
  if (s.isSymbolicLink()) return 1; // git trzyma symlink jako jedna linie (sciezka celu bez `\n`); celu nie czytamy
  if (!s.isFile() || s.size === 0) return 0;
  const fd = fs.openSync(abs, 'r');
  try {
    const buf = Buffer.alloc(CHUNK);
    let n = 0, pos = 0, last = 10, got;
    while ((got = fs.readSync(fd, buf, 0, CHUNK, pos)) > 0) {
      if (pos === 0 && buf.subarray(0, Math.min(got, 8000)).includes(0)) return 0;
      for (let i = 0; i < got; i++) if (buf[i] === 10) n++;
      last = buf[got - 1];
      pos += got;
    }
    return last === 10 ? n : n + 1;
  } finally { fs.closeSync(fd); }
}

/**
 * Zmienione linie niezacommitowane: sledzone (`git diff --numstat HEAD`) + nieśledzone (cale dodane).
 * `files` (sciezki absolutne albo wzgledne do root) zaweza liczenie do tych plikow; bez niego liczy cale drzewo.
 * `opts.onError(what)`: wolane przy bledzie gita/odczytu (CLI risk-tier konczy wtedy exit 2; stop-gate tylko loguje).
 */
function uncommittedLines(root, files, opts = {}) {
  const want = files ? new Set(files.map((f) => normPath(path.isAbsolute(f) ? f : path.join(root, f)))) : null;
  const take = (abs) => !want || want.has(normPath(abs));
  // Blad gita = 0 linii (tier liczony dalej ze sciezek), ale z wpisem w gates.jsonl, nie po cichu (ADR-0008).
  const toolError = (what) => {
    log({ hook: 'changed-lines', event: 'skipped', reason: `changed-lines: ${what}`, target: root });
    if (opts.onError) opts.onError(what);
  };
  // Sciezki z numstat i `ls-files --full-name` sa wzgledem korzenia repo, nie root (root moze byc podkatalogiem).
  const topR = git(root, ['rev-parse', '--show-toplevel']);
  if (!topR.ok) { toolError('git rev-parse --show-toplevel nie powiodl sie (nie repo?)'); return 0; }
  const top = topR.out.trim();
  let total = 0;
  // -z: sciezki bez cytowania; rename to `A\tD\t` + stara + nowa sciezka jako osobne pola (bez -z: `src/{a => b}.ts`,
  // ktory nie trafial w `files` i zanizal licznik, code-review 2026-10-27). Liczymy pod NOWA sciezka, jak git po commicie.
  const numstat = git(root, ['diff', '--no-ext-diff', '--numstat', '-z', 'HEAD']);
  if (!numstat.ok) toolError('git diff --numstat HEAD nie powiodl sie');
  else {
    const fields = numstat.out.split('\0');
    for (let i = 0; i < fields.length; i++) {
      const m = fields[i].match(/^(\d+|-)\t(\d+|-)\t(.*)$/);
      if (!m) continue;
      const rel = m[3] === '' ? fields[(i += 2)] : m[3];
      if (rel && take(path.join(top, rel))) total += (Number(m[1]) || 0) + (Number(m[2]) || 0);
    }
  }
  const untracked = git(root, ['ls-files', '--others', '--exclude-standard', '--full-name', '-z']);
  if (!untracked.ok) toolError('git ls-files --others nie powiodl sie');
  else for (const rel of untracked.out.split('\0').filter(Boolean)) {
    const abs = path.join(top, rel);
    if (!take(abs)) continue;
    try { total += untrackedFileLines(abs); } catch (e) {
      if (e.code !== 'ENOENT') toolError(`${rel}: ${e.code || e.message}`); // ENOENT = zniknal miedzy ls-files a odczytem
    }
  }
  return total;
}

module.exports = { uncommittedLines, untrackedFileLines, normPath };

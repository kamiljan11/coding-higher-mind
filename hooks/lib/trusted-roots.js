'use strict';
// Granica zaufania dla narzedzi, ktore WYKONUJA kod z repo (eslint/config, tsc, node_modules/playwright, fsmonitor):
// zaufane = drzewo cwd sesji ALBO katalog pod jednym z korzeni w ~/.claude/pg/trusted-roots.txt (tylko wlasne repo uzytkownika).
// Jedno zrodlo prawdy dla post-bash-edit-check (lint) i qa-matrix (playwright z repo) — security-reviewer 2026-09-12:
// REPO-CONTROLLED-MODULE-RCE (require.resolve z repo obcego autora wykonal podstawiony pakiet w procesie uzytkownika).
const fs = require('fs');
const os = require('os');
const path = require('path');

const TRUSTED_ROOTS_FILE = process.env.PG_TRUSTED_ROOTS_FILE || path.join(os.homedir(), '.claude', 'pg', 'trusted-roots.txt');

const normalize = (p) => path.resolve(p).replace(/\\/g, '/').toLowerCase();

// Tylko wpisy ABSOLUTNE na tej platformie: `C:\dev` na Linuksie nie jest absolutne, a path.resolve() zrobilby z niego
// `<cwd>/c:/dev` — obcy klon z katalogiem `C:/dev/x` (cwd sesji) bylby „zaufany" do cargo build.rs / MSBuild
// (pg-review 2026-10-26 security r2, blocker z PoC). Wpisy drugiego systemu zostaja w pliku (laptop + Windows), ale sa pomijane.
function trustedRoots() {
  try {
    return fs.readFileSync(TRUSTED_ROOTS_FILE, 'utf8').split(/\r?\n/).map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#') && isPlatformAbsolute(l));
  } catch (e) { return []; }
}

// win32: `/home/x` tez jest „absolutne" (wzgledem dysku cwd) -> `E:\home\x` zaufane z sesji na E: (security r3) — wymagamy litery/UNC.
function isPlatformAbsolute(l) {
  return process.platform === 'win32' ? /^[A-Za-z]:[\\/]|^\\\\/.test(l) : path.isAbsolute(l);
}
// Porownanie ZAUFANIA: wielkosc liter tylko na win32 (Linux rozroznia `SRC` i `src`). `normalize` (lowercase) zostaje dla
// konsumentow ochrony sciezek — tam szersze dopasowanie jest bezpieczniejsze.
const trustKey = (p) => { const n = path.resolve(p).replace(/\\/g, '/'); return process.platform === 'win32' ? n.toLowerCase() : n; };

/** Czy `dir` lezy w tym samym drzewie co `cwd` (w gore lub w dol). */
function inSameTree(dir, cwd) {
  const a = normalize(dir) + '/';
  const b = normalize(cwd) + '/';
  return a.startsWith(b) || b.startsWith(a);
}

/** Czy katalog jest zaufany: drzewo cwd sesji (jesli podane) albo pod zaufanym korzeniem. */
function isTrustedDir(dir, cwd) {
  if (cwd && inSameTree(dir, cwd)) return true;
  const d = trustKey(dir) + '/';
  return trustedRoots().some((root) => d.startsWith(trustKey(root) + '/'));
}

module.exports = { trustedRoots, inSameTree, isTrustedDir, normalize, TRUSTED_ROOTS_FILE };

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

function trustedRoots() {
  try {
    return fs.readFileSync(TRUSTED_ROOTS_FILE, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  } catch (e) { return []; }
}

/** Czy `dir` lezy w tym samym drzewie co `cwd` (w gore lub w dol). */
function inSameTree(dir, cwd) {
  const a = normalize(dir) + '/';
  const b = normalize(cwd) + '/';
  return a.startsWith(b) || b.startsWith(a);
}

/** Czy katalog jest zaufany: drzewo cwd sesji (jesli podane) albo pod zaufanym korzeniem. */
function isTrustedDir(dir, cwd) {
  if (cwd && inSameTree(dir, cwd)) return true;
  const d = normalize(dir) + '/';
  return trustedRoots().some((root) => d.startsWith(normalize(root) + '/'));
}

module.exports = { trustedRoots, inSameTree, isTrustedDir, normalize, TRUSTED_ROOTS_FILE };

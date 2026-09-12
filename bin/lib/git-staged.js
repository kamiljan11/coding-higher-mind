'use strict';
// Wspolne wejscie bramek pre-commit (0 tokenow): diff indeksu, lista stagowanych plikow, tresc stagowanego
// pliku, komunikat fail-open. Jedno miejsce na `git diff --cached` — dup-literals 2026-09-12 zlapal, ze trzy
// nowe bramki (phase / todo-ledger / pii-inventory) powtarzaly te same argumenty i ten sam komunikat.
const { execFileSync } = require('child_process');
const path = require('path');
const { log } = require(path.join(__dirname, '..', '..', 'hooks', 'lib', 'gate-log.js'));

const MAX_BUFFER = 64 << 20;
const DIFF_FILTER = '--diff-filter=AM'; // dodane + zmodyfikowane; usuniete nie maja czego lintowac

/** Unified diff indeksu (-U0), opcjonalnie zawezony pathspecami. */
function stagedDiff(paths = []) {
  const args = ['diff', '--cached', '-U0', '--no-color', DIFF_FILTER];
  if (paths.length) args.push('--', ...paths);
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: MAX_BUFFER });
}

/** Sciezki stagowanych plikow (dodane/zmodyfikowane), wzgledem korzenia repo. */
function stagedFiles() {
  return execFileSync('git', ['diff', '--cached', '--name-only', DIFF_FILTER], { encoding: 'utf8' }).split('\n').map((s) => s.trim()).filter(Boolean);
}

/** Tresc pliku Z INDEKSU (nie z drzewa roboczego). MSYS_NO_PATHCONV: `:sciezka` nie moze byc zamieniona na sciezke Windows. */
function stagedContent(file) {
  return execFileSync('git', ['show', `:${file}`], { encoding: 'utf8', maxBuffer: MAX_BUFFER, env: Object.assign({}, process.env, { MSYS_NO_PATHCONV: '1' }) });
}

/** Bramka nie moze zablokowac commitu przez WLASNA awarie gita — komunikat na stderr, wpis w logs/gates.jsonl, exit 0. */
function failOpen(tool, err) {
  const why = String((err && err.message) || err).split('\n')[0];
  process.stderr.write(`${tool}: git nie odpowiada (${why}) — pomijam (fail-open).\n`);
  log({ hook: tool, event: 'skipped', reason: `fail-open: ${why}`.slice(0, 200), target: process.cwd() });
  return 0;
}

module.exports = { stagedDiff, stagedFiles, stagedContent, failOpen, DIFF_FILTER };

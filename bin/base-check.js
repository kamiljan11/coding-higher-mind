#!/usr/bin/env node
// base-check: czy pracuje na TYM kodzie, na ktorym pracuje CI? (0 tokenow)
//
// Blizny 2026-09-06: klon rental-site "16 commitow za main" byl w rzeczywistosci INNA HISTORIA
// (repo przeszlo przepisanie historii) — lokalne bramki swiecily zielono na kodzie, ktorego juz nie bylo.
// Regula z pamieci nie zadzialala; ma dzialac skrypt.
//
// Sprawdza (szybko, z timeoutem, offline = ostrzezenie, nie blok):
//   1. czy jest origin i galaz domyslna (main/master),
//   2. `git fetch` (timeout 15 s; brak sieci -> tylko ostrzezenie),
//   3. merge-base HEAD..origin/<default>: PUSTY = niepowiazana historia -> BLOK (exit 1),
//   4. licznik commitow za baza: >0 -> ostrzezenie (przy --strict: blok),
//   5. brudne drzewo (niezacommitowane zmiany) -> informacja.
// Uzycie: node base-check.js [--repo <sciezka>] [--strict] [--quiet]
// Wyjatek swiadomy: ALLOW_STALE_BASE=1 (ten sam, co w mas_merge_prs.py).
'use strict';
const { spawnSync } = require('node:child_process');

function git(args, cwd, timeout = 15000) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'pipe'] });
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim(), timedOut: r.error && r.error.code === 'ETIMEDOUT' };
}

/** Czysta interpretacja wynikow gita -> werdykt. Testowalna bez repo. */
function verdict({ hasOrigin, fetchOk, mergeBase, behind, dirty, strict }) {
  if (!hasOrigin) return { level: 'info', code: 0, msg: 'brak origin — repo lokalne, nic do porownania' };
  if (mergeBase === null) return { level: 'block', code: 1, msg: 'HEAD i origin nie maja wspolnego przodka — to INNA historia (przepisane repo?). Nie edytuj; `git checkout -B <galaz> origin/<galaz>` po zabezpieczeniu pracy (git stash).' };
  const parts = [];
  if (!fetchOk) parts.push('fetch nie powiodl sie (offline?) — porownanie z ostatnim znanym stanem origin');
  if (behind > 0) parts.push(`${behind} commit(ow) za baza — CI widzi inny kod niz Ty; wciagnij baze przed edycja`);
  if (dirty > 0) parts.push(`${dirty} niezacommitowanych plikow w drzewie`);
  if (behind > 0 && strict) return { level: 'block', code: 1, msg: parts.join('; ') };
  if (parts.length) return { level: 'warn', code: 0, msg: parts.join('; ') };
  return { level: 'ok', code: 0, msg: 'baza swieza, drzewo czyste' };
}

function main() {
  const argv = process.argv.slice(2);
  const cwd = argv.includes('--repo') ? argv[argv.indexOf('--repo') + 1] : process.cwd();
  const strict = argv.includes('--strict') && process.env.ALLOW_STALE_BASE !== '1';
  const quiet = argv.includes('--quiet');
  if (!git(['rev-parse', '--is-inside-work-tree'], cwd).ok) { if (!quiet) console.log('base-check: nie repo git'); return 0; }
  const hasOrigin = git(['remote', 'get-url', 'origin'], cwd).ok;
  let fetchOk = false, mergeBase = '', behind = 0;
  let base = 'main';
  if (hasOrigin) {
    const head = git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], cwd);
    if (head.ok) base = head.out.replace(/^origin\//, '');
    else if (!git(['rev-parse', '--verify', '-q', 'origin/main'], cwd).ok && git(['rev-parse', '--verify', '-q', 'origin/master'], cwd).ok) base = 'master';
    fetchOk = git(['fetch', '-q', 'origin', base], cwd, 15000).ok;
    const mb = git(['merge-base', 'HEAD', `origin/${base}`], cwd);
    mergeBase = mb.ok ? mb.out : null;
    if (mergeBase) { const c = git(['rev-list', '--count', `HEAD..origin/${base}`], cwd); behind = c.ok ? Number(c.out) : 0; }
  }
  const dirty = (git(['status', '--porcelain'], cwd).out || '').split('\n').filter(Boolean).length;
  const v = verdict({ hasOrigin, fetchOk, mergeBase, behind, dirty, strict });
  if (!quiet || v.level !== 'ok') console.log(`base-check [${v.level}] ${cwd} (origin/${base}): ${v.msg}`);
  return v.code;
}

if (require.main === module) process.exit(main());
module.exports = { verdict };

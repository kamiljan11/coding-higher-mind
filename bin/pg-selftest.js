#!/usr/bin/env node
// pg-selftest: szybki dowod, ze zainstalowany PG dziala NA TEJ maszynie (0 tokenow, ~20 s) — uruchamiany przez install.mjs
// i recznie po aktualizacji. Odpala testy bramek, ktore nie wymagaja niczego poza node+git, i sprawdza, ze hooki sa
// zarejestrowane w ~/.claude/settings.json. Zielone = dowod; czerwone = lista, co naprawic. Exit 1 przy jakimkolwiek FAIL.
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(os.homedir(), '.claude');
const TESTS = ['test_dup_literals.js', 'test_module_boundaries.js', 'test_prompt_guard.js', 'test_slop_gates.js'];
const REQUIRED_HOOKS = ['prompt-guard.js', 'post-edit-check.js', 'stop-gate.js', 'bash-guard.js'];

function run(file) {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'bin', file)], { encoding: 'utf8', timeout: 180000 });
  const tail = ((r.stdout || '') + (r.stderr || '')).trim().split('\n').slice(-1)[0] || '';
  return { file, ok: r.status === 0, tail: tail.slice(0, 120) };
}

function hooksRegistered() {
  const p = path.join(ROOT, 'settings.json');
  if (!fs.existsSync(p)) return { ok: false, detail: 'brak settings.json' };
  let text;
  try { text = fs.readFileSync(p, 'utf8'); } catch (e) { return { ok: false, detail: 'settings.json nieczytelny: ' + e.message }; }
  const missing = REQUIRED_HOOKS.filter((h) => !text.includes(h));
  return { ok: missing.length === 0, detail: missing.length ? 'brak w settings.json: ' + missing.join(', ') : 'wszystkie 4 hooki zarejestrowane' };
}

function gitHooksPath() {
  const r = spawnSync('git', ['config', '--global', 'core.hooksPath'], { encoding: 'utf8' });
  const v = (r.stdout || '').trim();
  const expected = path.join(ROOT, 'git-hooks');
  const ok = v && path.resolve(v.replace(/^~/, os.homedir())) === path.resolve(expected);
  return { ok, detail: ok ? v : `core.hooksPath = "${v || '(brak)'}" (oczekiwane: ${expected}; per-repo alternatywa: git config core.hooksPath ~/.claude/git-hooks)` };
}

function main() {
  const rows = [];
  for (const t of TESTS) {
    if (!fs.existsSync(path.join(ROOT, 'bin', t))) { rows.push({ name: t, ok: false, detail: 'brak pliku' }); continue; }
    const r = run(t); rows.push({ name: t, ok: r.ok, detail: r.tail });
  }
  const h = hooksRegistered(); rows.push({ name: 'settings.json hooks', ok: h.ok, detail: h.detail });
  const g = gitHooksPath(); rows.push({ name: 'git core.hooksPath', ok: g.ok, detail: g.detail });
  let fails = 0;
  for (const r of rows) { if (!r.ok) fails++; console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name.padEnd(28)} ${r.detail}`); }
  console.log(fails ? `pg-selftest: ${fails} FAIL — PG nie jest w pelni aktywny` : 'pg-selftest: OK — PG aktywny na tej maszynie');
  return fails ? 1 : 0;
}

if (require.main === module) process.exit(main());

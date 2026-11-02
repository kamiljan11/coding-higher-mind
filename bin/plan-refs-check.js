#!/usr/bin/env node
// plan-refs-check: czy sciezki i funkcje, ktore plan/design wymienia, istnieja w repo (0 tokenow, P1-lite 2026-11-01).
// Powod: eksperyment 2 (plan PG 2026-11-01, `pg/plan-rubric.md`): referencja do nieistniejacego pliku/funkcji albo
// numer linii poza plikiem = plan pisany z pamieci, nie z kodu. Recenzent LLM to przeoczal; `ls` + `git grep` nie.
// Co sprawdza (tylko tekst w `backtickach`):
//  - sciezka ze znanym rozszerzeniem (albo katalog z `/` na koncu) -> istnieje wzgledem --repo; `plik:N` / `plik:N-M` -> plik
//    ma >= N(M) linii; gola nazwa pliku (bez `/`) -> jakis plik sledzony przez git ma te nazwe,
//  - `nazwa()` -> `git grep -wF nazwa` znajduje ja w repo.
// Pomija: URL, glob (`*`), placeholdery (`<x>`, `YYYY`), sciezki absolutne i `~/` (inna maszyna), linie z markerem nowego
// pliku (`nowy`, `nowa`, `nowe`, `new`, `NEW`, `(+)`) — plan moze tworzyc pliki; alternatywy z `|`; sciezki ignorowane
// przez git (logi, artefakty runtime — `git check-ignore`). Dogfood 2026-11-01 na designie Fali 0: 28/48 falszywych bez tego.
// Granice (A4): linia z markerem nowego pliku jest pomijana CALA (literowka w innej sciezce tej linii nie wyjdzie) — liczba
// pominietych linii jest w wyniku; `git grep` widzi tylko pliki sledzone. Nazwy technologii (`Next.js`) i `./` pomijane.
// Tylko wlasne repo floty: git czyta .git/config repo (cases.md UNTRUSTED-GIT-CONFIG-WHACK-A-MOLE, design 12.6).
// Tryb: narzedzie recenzji planu (observe), nie bramka hooka.
// Uzycie: node plan-refs-check.js <plan.md> [--repo .] [--json]
// Exit: 0 = wszystkie referencje istnieja, 1 = sa brakujace (lista), 2 = blad narzedzia (brak pliku planu / repo).
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const EXT_RX = /\.(ts|tsx|js|jsx|mjs|cjs|py|sql|md|json|ya?ml|toml|sh|ps1|css|html|go|rs|java|kt|swift|rb|php|cs)$/;
const NEW_MARKER_RX = /\b(nowy|nowa|nowe|new)\b|\(\+\)/i;
const SKIP_RX = /^(https?:|mailto:)|[*<>{}$|]|YYYY|\s/;
const CALL_RX = /^([A-Za-z_$][\w$.]*)\(\)$/;
const LINE_SUFFIX_RX = /^(.+?):(\d+)(?:-(\d+))?$/;
// Nazwy technologii, nie pliki (code A4); jawna lista, bo `App.js` w repo React to prawdziwy plik (code A5).
// Wielkosc liter i bez nazw, ktore bywaja komponentami (Chart, Express, Solid): `chart.js` / `Chart.js` w repo = sprawdzany plik (code A6).
const TECH_NAME_RX = /^(Next|Node|Vue|Nuxt|Three|Deno|React|Angular|Svelte|Ember|Backbone|Moment|D3|P5|Alpine)\.js$/;
const DOT_DIR_RX = /^\.{1,2}\/?$/;

function extractRefs(text) {
  const refs = [];
  refs.skippedNewLines = 0;
  text.split('\n').forEach((line, i) => {
    if (NEW_MARKER_RX.test(line)) { if (/`[^`\n]+`/.test(line)) refs.skippedNewLines++; return; }
    for (const m of line.matchAll(/`([^`\n]+)`/g)) {
      const raw = m[1].trim().replace(/[.,;:]+$/, '');
      const call = CALL_RX.exec(raw);
      if (call) { refs.push({ kind: 'symbol', ref: raw, name: call[1].split('.').pop(), line: i + 1 }); continue; }
      if (SKIP_RX.test(raw) || raw.startsWith('/') || raw.startsWith('~') || raw.startsWith('-') || DOT_DIR_RX.test(raw) || TECH_NAME_RX.test(raw)) continue;
      const ls = LINE_SUFFIX_RX.exec(raw);
      const file = ls ? ls[1] : raw;
      if (!EXT_RX.test(file) && !file.endsWith('/')) continue;
      refs.push({ kind: 'path', ref: raw, file, upto: ls ? Number(ls[3] || ls[2]) : 0, line: i + 1 });
    }
  });
  return refs;
}

function countLines(p) {
  const t = fs.readFileSync(p, 'utf8');
  return t.length === 0 ? 0 : t.split('\n').length - (t.endsWith('\n') ? 1 : 0);
}

function symbolExists(repo, name) {
  try {
    execFileSync('git', ['-C', repo, 'grep', '-qwF', '--', name], { stdio: 'ignore', timeout: 30000 });
    return true;
  } catch (err) {
    if (err.status === 1) return false; // brak trafien
    throw new Error(`git grep ${name}: ${err.message}`);
  }
}

function git(repo, args) {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', timeout: 30000, maxBuffer: 64 * 1024 * 1024 });
}

function isIgnored(repo, rel) {
  try { git(repo, ['check-ignore', '-q', '--', rel]); return true; } catch (err) {
    if (err.status === 1) return false;
    throw new Error(`git check-ignore ${rel}: ${err.message}`);
  }
}

function check(planPath, repo) {
  const refs = extractRefs(fs.readFileSync(planPath, 'utf8'));
  const tracked = new Set(git(repo, ['ls-files']).split('\n').filter(Boolean).map((p) => path.basename(p)));
  const missing = [];
  for (const r of refs) {
    if (r.kind === 'symbol') {
      if (!symbolExists(repo, r.name)) missing.push({ ...r, why: 'brak symbolu w repo (git grep -w)' });
      continue;
    }
    if (!r.file.includes('/')) {
      if (!tracked.has(r.file)) missing.push({ ...r, why: 'brak pliku o tej nazwie w repo (git ls-files)' });
      continue; // gola nazwa: bez sprawdzania linii (nie wiadomo, ktory plik)
    }
    const abs = path.resolve(repo, r.file);
    if (!abs.startsWith(path.resolve(repo) + path.sep)) { missing.push({ ...r, why: 'sciezka wychodzi poza repo' }); continue; }
    if (!fs.existsSync(abs)) {
      if (!isIgnored(repo, r.file)) missing.push({ ...r, why: 'brak pliku' });
      continue;
    }
    if (r.upto && fs.statSync(abs).isFile()) {
      const n = countLines(abs);
      if (r.upto > n) missing.push({ ...r, why: `linia ${r.upto} poza plikiem (${n} linii)` });
    }
  }
  return { checked: refs.length, missing, skipped_new_lines: refs.skippedNewLines };
}

module.exports = { extractRefs, check };

if (require.main === module) {
  const args = process.argv.slice(2);
  const plan = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--repo');
  const ri = args.indexOf('--repo');
  const repo = ri >= 0 ? args[ri + 1] : '.';
  if (!plan || !fs.existsSync(plan) || !fs.existsSync(repo)) {
    console.error('uzycie: plan-refs-check.js <plan.md> [--repo .] [--json]  (brak pliku planu albo repo)');
    process.exit(2);
  }
  let result;
  try { result = check(plan, repo); } catch (err) {
    console.error(`plan-refs-check: blad narzedzia: ${err.message}`);
    process.exit(2);
  }
  if (args.includes('--json')) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  else {
    for (const m of result.missing) console.log(`${plan}:${m.line}: \`${m.ref}\` — ${m.why}`);
    console.log(`plan-refs-check: ${result.checked} referencji, brakujacych ${result.missing.length}${result.skipped_new_lines ? `, pominieto ${result.skipped_new_lines} linii z markerem nowego pliku (sprawdz je oczami)` : ''}`);
  }
  process.exit(result.missing.length ? 1 : 0);
}

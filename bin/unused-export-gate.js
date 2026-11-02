#!/usr/bin/env node
// Bramka observe w pre-push: nowy eksport / def bez zadnego uzycia w repo = kod na zapas (YAGNI), ostrzezenie + telemetria.
// Powod (2026-10-26, pytanie uzytkownika: „czy jest zabezpieczenie przed pisaniem niepotrzebnego kodu?"):
// NOWY eksport (TS/JS) albo NOWA funkcja/klasa najwyzszego poziomu (Python) w DODANYCH liniach diffu, ktorej nazwa
// nie wystepuje NIGDZIE indziej w repo (git grep -w) = kod napisany „na zapas" (YAGNI). 0 tokenow, 0 zaleznosci,
// nie wykonuje kodu repo (knip laduje configi repo i w CI jest tylko informacyjny). Patrzy tylko na dodane linie —
// dlugu historycznego nie dotyka (ZAKRES w CLAUDE.md).
// Tryb: OBSERVE (ADR-0008 — blokada dopiero po incydencie z pg/cases.md): pre-push ostrzega i loguje `would_block`.
// Znane granice (swiadomie): nazwa uzyta tylko dynamicznie (`obj[name]`, rejestr po stringu) albo publiczne API paczki
// (package.json main/exports) — to drugie pomijamy jawnie; konwencje frameworkow (loader, GET, Route...) z listy nizej.
//
// Uzycie: node unused-export-gate.js [--repo .] [--base origin/main] [--staged] [--json] [--from pre-push] [--help]
// Exit: 0 = brak nowych nieuzywanych, 1 = werdykt (lista na stdout), 2 = blad narzedzia (np. brak bazy / nie-repo).
'use strict';
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

let gateLog = () => {};
try { gateLog = require(path.join(__dirname, '..', 'hooks', 'lib', 'gate-log.js')).log; } catch (err) { /* bez telemetrii */ }

const JS_RX = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/;
const PY_RX = /\.py$/;
// Testy, typy, configi, stories, migracje i skrypty jednorazowe — eksport z nich nie jest „kodem na zapas".
const SKIP_FILE_RX = /(^|\/)(tests?|__tests__|spec|e2e|fixtures?|scripts|migrations|stories)\/|\.(test|spec|stories|config|d)\.[cm]?[jt]sx?$|(^|\/)(conftest|setup|manage|__init__|__main__)\.py$|(^|\/)test_[^/]*\.py$|_test\.py$/;
const JS_EXPORT_RX = /^\+\s*export\s+(?:declare\s+)?(?:async\s+)?(?:abstract\s+)?(?:function\*?|const|let|var|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/;
const PY_DEF_RX = /^\+(?:async\s+)?(?:def|class)\s+([A-Za-z][\w]*)\s*[(:]/;
// Nazwy, ktore wywoluje framework (Next.js, Remix/React Router, TanStack, SvelteKit, Astro, Hono, Supabase edge).
const FRAMEWORK_NAMES = new Set(['loader', 'action', 'meta', 'links', 'headers', 'handle', 'shouldRevalidate', 'ErrorBoundary', 'HydrateFallback',
  'Route', 'Layout', 'generateMetadata', 'generateStaticParams', 'generateViewport', 'metadata', 'viewport', 'config', 'runtime', 'revalidate',
  'dynamic', 'dynamicParams', 'preferredRegion', 'maxDuration', 'middleware', 'getServerSideProps', 'getStaticProps', 'getStaticPaths',
  'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'load', 'prerender', 'ssr', 'csr', 'handler', 'main', 'app', 'router']);
const MAX_NAMES = 200;
const GIT_TIMEOUT_MS = 30000;
const TOTAL_BUDGET_MS = 60000; // caly przebieg w pre-push: bramka observe nie moze trzymac pushu minutami (pg-review ops r3)

function parseArgs(argv) {
  const o = { repo: '.', base: 'origin/main', staged: false, json: false, from: '', help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--repo') o.repo = argv[++i];
    else if (a === '--base') o.base = argv[++i];
    else if (a === '--staged') o.staged = true;
    else if (a === '--json') o.json = true;
    else if (a === '--from') o.from = argv[++i] || '';
    else if (a === '--help' || a === '-h') o.help = true;
  }
  return o;
}

const git = (repo, args) => execFileSync('git', ['-C', repo, '-c', 'core.quotePath=false', '-c', 'core.fsmonitor=false', ...args],
  { encoding: 'utf8', timeout: GIT_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });

// Tylko zwykly plik do MAX_READ_BYTES: symlink do /dev/zero albo FIFO w obcym klonie nie moze zjesc RAM-u ani zawiesic pushu (security r9).
const MAX_READ_BYTES = 4 * 1024 * 1024;
function readRegular(file) {
  const st = fs.statSync(file);
  if (!st.isFile() || st.size > MAX_READ_BYTES) throw new Error(`pominiety (nie zwykly plik albo > ${MAX_READ_BYTES} B): ${file}`);
  return fs.readFileSync(file, 'utf8');
}

// Pliki publicznego API paczki (package.json main/module/exports/bin) — ich eksporty uzywa ktos spoza repo.
function publicEntryFiles(repo) {
  try {
    const pkg = JSON.parse(readRegular(path.join(repo, 'package.json')));
    const out = new Set();
    const add = (v) => {
      if (typeof v === 'string') out.add(v.replace(/^\.\//, '').replace(/\.(d\.ts|js|mjs|cjs)$/, ''));
      else if (v && typeof v === 'object') Object.values(v).forEach(add);
    };
    [pkg.main, pkg.module, pkg.exports, pkg.bin, pkg.types].forEach(add);
    return out;
  } catch (e) { return new Set(); }
}
const isPublicEntry = (file, entries) => [...entries].some((e) => file.replace(/\.[^.]+$/, '') === e || file.replace(/^src\//, 'dist/').replace(/\.[^.]+$/, '') === e);

// diff -U0 -> [{ file, line, name, lang }]
function addedDefinitions(diffText) {
  const out = [];
  let file = null;
  let line = 0;
  for (const raw of diffText.split('\n')) {
    if (raw.startsWith('+++ ')) { file = raw.startsWith('+++ b/') ? raw.slice(6) : null; continue; }
    const hunk = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) { line = Number(hunk[1]); continue; }
    if (!file || raw.startsWith('---')) continue;
    if (raw.startsWith('+')) {
      if (!SKIP_FILE_RX.test(file)) {
        const js = JS_RX.test(file) && raw.match(JS_EXPORT_RX);
        const py = PY_RX.test(file) && raw.match(PY_DEF_RX);
        const name = (js && js[1]) || (py && py[1]);
        if (name && !FRAMEWORK_NAMES.has(name)) out.push({ file, line, name, lang: js ? 'js' : 'py' });
      }
      line++;
    }
  }
  return out;
}

// Python: dekorator nad definicja = rejestracja we frameworku (route, fixture, task) — nie „na zapas".
function isDecorated(repo, def) {
  try {
    const lines = readRegular(path.join(repo, def.file)).split('\n');
    let i = def.line - 2;
    while (i >= 0 && /^\s*(#.*)?$/.test(lines[i])) i--;
    return i >= 0 && /^@/.test(lines[i]);
  } catch (e) { return false; }
}

// Liczba wystapien nazwy (slowo) per plik w drzewie roboczym (sledzone + nieignorowane nowe).
function occurrences(repo, name) {
  let out = '';
  try { out = git(repo, ['grep', '-c', '-w', '-I', '--untracked', '-F', '-e', name]); } catch (e) {
    if (e.status === 1) return new Map(); // brak trafien
    throw e;
  }
  const m = new Map();
  for (const l of out.split('\n').filter(Boolean)) {
    const idx = l.lastIndexOf(':');
    m.set(l.slice(0, idx), Number(l.slice(idx + 1)));
  }
  return m;
}

function analyze(opts) {
  const repo = path.resolve(opts.repo);
  git(repo, ['rev-parse', '--is-inside-work-tree']);
  const diffArgs = opts.staged ? ['diff', '--cached', '-U0', '--no-ext-diff'] : ['diff', '-U0', '--no-ext-diff', `${opts.base}...HEAD`];
  const defs = addedDefinitions(git(repo, diffArgs));
  const entries = publicEntryFiles(repo);
  const unused = [];
  let checked = 0;
  let outOfTime = false;
  const deadline = Date.now() + TOTAL_BUDGET_MS;
  for (const def of defs.slice(0, MAX_NAMES)) {
    if (Date.now() > deadline) { outOfTime = true; break; }
    if (isPublicEntry(def.file, entries)) continue;
    if (def.lang === 'py' && isDecorated(repo, def)) continue;
    checked++;
    const occ = occurrences(repo, def.name);
    const elsewhere = [...occ.keys()].some((f) => f !== def.file);
    if (!elsewhere && (occ.get(def.file) || 0) <= 1) unused.push(def);
  }
  let head = '';
  try { head = git(repo, ['rev-parse', '--short=12', 'HEAD']).trim(); } catch (e) { /* repo bez commita: head pusty */ }
  return { repo, head, defs: defs.length, checked, truncated: defs.length > MAX_NAMES || outOfTime, outOfTime, unused };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { console.log('node unused-export-gate.js [--repo .] [--base origin/main] [--staged] [--json] [--from pre-push]'); return 0; }
  const tlog = (e) => { if (opts.from) gateLog({ hook: 'unused-export-gate', target: path.resolve(opts.repo), source: opts.from, ...e }); };
  let r;
  try { r = analyze(opts); } catch (e) {
    const why = String(e.stderr || e.message || e).split('\n')[0].slice(0, 200);
    tlog({ event: 'skipped', reason: `unused-export-gate: blad narzedzia (${why})` });
    console.error(`unused-export-gate: blad narzedzia: ${why}`);
    return 2;
  }
  if (opts.json) console.log(JSON.stringify(r, null, 1));
  else for (const u of r.unused) console.log(`${u.file}:${u.line}: ${u.name} — nowy ${u.lang === 'js' ? 'eksport' : 'def/class'} bez zadnego uzycia w repo`);
  if (r.unused.length) {
    // Stala nazwa powodu (licznik w `count`): guard_health grupuje po reason — liczba w kluczu rozbijala sygnal (pg-review 2026-10-26 data).
    // `head` = klucz dedupu przy przegladzie: ten sam commit pushowany 2x to jedno ostrzezenie, nie dwa (pg-review data r2).
    tlog({ event: 'would_block', reason: 'unused-export: nowe definicje bez uzycia', count: r.unused.length, head: r.head, items: r.unused.slice(0, 20).map((u) => `${u.file}:${u.name}`) });
    return 1;
  }
  tlog({ event: 'ran', reason: `ok (${r.checked}/${r.defs} nowych definicji${r.outOfTime ? ', przerwane: budzet czasu' : ''})` });
  return 0;
}

// Nieprzewidziany wyjatek = exit 2 (blad narzedzia), nie domyslne 1 Node'a, ktore udawaloby werdykt (kontrakt 0/1/2).
if (require.main === module) {
  try { process.exitCode = main(); } catch (e) { console.error(`unused-export-gate: blad narzedzia: ${e && e.message}`); process.exitCode = 2; }
}
module.exports = { addedDefinitions, analyze, FRAMEWORK_NAMES, SKIP_FILE_RX };

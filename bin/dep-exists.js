#!/usr/bin/env node
// dep-exists: kazda NOWA zaleznosc w diffie musi istniec w rejestrze (anty-slopsquatting, 0 tokenow).
// Research 2026-09-06 (research-ai-slop.md, zrodla 7/8): LLM halucynuje nazwy pakietow, a typosquatterzy
// je rejestruja. PG mial regule "zero nowych zaleznosci bez uzasadnienia", ale NIC nie sprawdzalo, czy nazwa
// jest prawdziwa — regula na papierze (ta sama klasa co B006 bez bramki).
//
// Zakres: package.json (dependencies/devDependencies/peer/optional), pyproject.toml ([project] dependencies
// i [tool.poetry.dependencies]), requirements*.txt. Porownuje wersje z bazy (--base albo indeks vs HEAD) i
// dla KAZDEJ nowej nazwy pyta rejestr: npm registry / PyPI JSON. Brak = blok. Dodatkowo ostrzega, gdy
// pakiet ma < 30 dni albo nazwa jest w odleglosci 1 edycji od popularnego (lista TOP w PROSTYCH heurystykach).
// Wyjatek swiadomy (pakiet prywatny/scoped w rejestrze firmowym): ALLOW_UNKNOWN_DEP=1.
//
// Uzycie: node dep-exists.js [--base origin/main] [--staged] [--json]
'use strict';
const { execFileSync } = require('node:child_process');
const https = require('node:https');

const NPM_FILES = /(^|\/)package\.json$/;
const PY_FILES = /(^|\/)(pyproject\.toml|requirements[^/]*\.txt)$/;
const POPULAR = ['react', 'lodash', 'express', 'axios', 'requests', 'numpy', 'pandas', 'typescript', 'vite', 'zod', 'next', 'supabase', 'stripe', 'dotenv', 'chalk', 'commander', 'moment', 'dayjs', 'uuid', 'yargs'];

function git(args) { return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 << 20 }); }

function fileAt(ref, file) {
  // brak pliku/refa (nowy plik, swieze repo bez HEAD) = pusta zawartosc, bez halasu na stderr
  try { return execFileSync('git', ['show', `${ref}:${file}`], { encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return ''; }
}

/** Nazwy pakietow z package.json (wszystkie sekcje zaleznosci). Czysta funkcja. */
function npmDeps(text) {
  let j; try { j = JSON.parse(text); } catch { return new Set(); }
  const out = new Set();
  for (const k of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) for (const n of Object.keys(j[k] || {})) out.add(n);
  return out;
}

/** Nazwy pakietow z pyproject/requirements — tylko nazwa, bez specyfikatora wersji. Czysta funkcja. */
function pyDeps(text) {
  const out = new Set();
  for (const raw of text.split('\n')) {
    const line = raw.trim().replace(/^["'\s-]+|["',\s]+$/g, '');
    if (!line || line.startsWith('#') || line.startsWith('[') || /^(python|name|version)\s*=/.test(line)) continue;
    const m = /^([A-Za-z0-9][A-Za-z0-9._-]*)\s*(?:\[.*?\])?\s*(?:[<>=!~;@ ]|$)/.exec(line);
    if (m && !/^(dependencies|requires|optional)$/i.test(m[1])) out.add(m[1].toLowerCase());
  }
  return out;
}

// Dependencies of pyproject.toml, read with a real TOML parser (python3 stdlib tomllib, no new dependency).
// Loop pass 10 (2026-11-15): pyDeps read every `key = value` line, so `[tool.ruff] line-length = 120` was looked up on
// PyPI and the commit was blocked as a hallucinated dependency. A regex section list (first fix) then missed uv, pdm,
// hatch, dotted keys, poetry sub-tables and `[[array.of.tables]]` (pg-review pass10 code-1, security-1). Rule now: any key
// named *dependencies / *requires / dependency-groups anywhere in the tree holds dependencies, either as PEP 508 strings
// (array) or as a table of name -> spec (poetry) or of group -> array (optional-dependencies, pdm). Invalid TOML = an
// error (the commit is blocked with the parser message: a broken file must not pass unchecked); no python3 = the old
// line parser.
const PY_DEP_KEY = /^(.*[-_])?(dependencies|requires)$|^dependency-groups$/i;
const PEP508_NAME = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)/;

function parseToml(text) {
  // parse_float=str: inf/nan would otherwise become Infinity/NaN, which JSON.parse rejects (pass10b security-2).
  const code = 'import sys, json, tomllib; print(json.dumps(tomllib.loads(sys.stdin.read(), parse_float=str)))';
  let raw;
  try {
    raw = execFileSync('python3', ['-I', '-c', code], { input: text, encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (e) {
    const err = String(e.stderr || e.message);
    // No python3, or python3 < 3.11 without tomllib: not a verdict on the file, so the caller uses the line parser.
    if (e.code === 'ENOENT' || /No module named 'tomllib'/.test(err)) {
      console.error('dep-exists: python3 with tomllib (>= 3.11) not found; pyproject.toml read line by line, tool settings may be flagged');
      return null;
    }
    if (e.code === 'ETIMEDOUT' || e.signal) throw new Error(`pyproject.toml parse timed out or was killed (${e.code || e.signal})`);
    throw new Error(`pyproject.toml is not valid TOML (${err.trim().split('\n').pop()})`);
  }
  return JSON.parse(raw);
}

// [tool.setuptools.dynamic] dependencies = {file = [...]} names files, not packages; a bare URL has no package name.
const NOT_A_SPEC = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//;

/** Package names from pyproject.toml dependency keys. Throws on invalid TOML; line parser only without python3. */
function pyprojectDeps(text) {
  const tree = parseToml(text);
  if (!tree) return pyDeps(text);
  const out = new Set();
  const addSpec = (s) => {
    if (NOT_A_SPEC.test(String(s).trim())) return;
    const m = PEP508_NAME.exec(String(s));
    if (m) out.add(m[1].toLowerCase());
  };
  const collect = (v) => {
    if (Array.isArray(v)) { for (const x of v) if (typeof x === 'string') addSpec(x); return; }
    if (v && typeof v === 'object') {
      for (const [k, sub] of Object.entries(v)) {
        if (k.toLowerCase() === 'python') continue;
        // group -> ["spec", ...] (optional-dependencies, pdm); poetry multiple constraints name -> [{version}, ...] (pass10b code-2)
        // PEP 735 groups mix specs with {include-group = ...} tables (pass10c code-1): any string = a group.
        if (Array.isArray(sub) && (sub.length === 0 || sub.some((x) => typeof x === 'string'))) collect(sub);
        else addSpec(k); // name -> version / {version, git, path} / [{...}, ...]
      }
    }
  };
  const walk = (node, parentKey) => {
    if (Array.isArray(node)) { for (const x of node) walk(x, parentKey); return; }
    if (!node || typeof node !== 'object') return;
    for (const [k, v] of Object.entries(node)) {
      if (parentKey === 'setuptools' && k === 'dynamic') continue;
      if (PY_DEP_KEY.test(k) && k.toLowerCase() !== 'requires-python') collect(v);
      else walk(v, k);
    }
  };
  walk(tree, '');
  return out;
}

function fetchJson(url) {
  return new Promise((resolve) => {
    const req = https.get(url, { headers: { 'user-agent': 'mas-dep-exists/1.0', accept: 'application/json' }, timeout: 8000 }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', () => resolve({ status: 0, body: '' }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: '' }); });
  });
}

async function checkNpm(name) {
  const r = await fetchJson(`https://registry.npmjs.org/${encodeURIComponent(name).replace('%40', '@')}`);
  if (r.status === 404) return { ok: false, why: 'brak w rejestrze npm' };
  if (r.status !== 200) return { ok: null, why: `rejestr npm niedostepny (HTTP ${r.status})` };
  let j; try { j = JSON.parse(r.body); } catch { return { ok: null, why: 'npm: nieczytelna odpowiedz' }; }
  const created = j.time && j.time.created ? Date.parse(j.time.created) : 0;
  const ageDays = created ? (Date.now() - created) / 86400000 : null;
  return { ok: true, why: ageDays !== null && ageDays < 30 ? `UWAGA: pakiet ma ${Math.round(ageDays)} dni` : '' };
}

async function checkPypi(name) {
  const r = await fetchJson(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`);
  if (r.status === 404) return { ok: false, why: 'brak na PyPI' };
  if (r.status !== 200) return { ok: null, why: `PyPI niedostepne (HTTP ${r.status})` };
  return { ok: true, why: '' };
}

/** Odleglosc Damerau-Levenshteina <= 1: jedna literka wiecej/mniej/inna ALBO zamiana sasiadow ("lodahs" vs "lodash"). */
function editDistance1(a, b) {
  if (a === b) return false;
  if (Math.abs(a.length - b.length) > 1) return false;
  if (a.length === b.length) {
    const diffs = [];
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diffs.push(i);
    if (diffs.length === 1) return true;
    return diffs.length === 2 && diffs[1] === diffs[0] + 1 && a[diffs[0]] === b[diffs[1]] && a[diffs[1]] === b[diffs[0]];
  }
  const [s, l] = a.length < b.length ? [a, b] : [b, a];
  let i = 0, j = 0, skipped = 0;
  while (i < s.length && j < l.length) {
    if (s[i] === l[j]) { i++; j++; } else if (++skipped > 1) return false; else j++;
  }
  return true;
}

async function main() {
  const argv = process.argv.slice(2);
  const staged = argv.includes('--staged');
  const json = argv.includes('--json');
  const base = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : 'origin/main';
  const changed = git(staged ? ['diff', '--cached', '--name-only', '--diff-filter=AM'] : ['diff', '--name-only', '--diff-filter=AM', `${base}...HEAD`]).split('\n').filter(Boolean);
  const newDeps = []; // {name, eco, file}
  for (const file of changed) {
    const eco = NPM_FILES.test(file) ? 'npm' : PY_FILES.test(file) ? 'pypi' : null;
    if (!eco) continue;
    const before = fileAt(staged ? 'HEAD' : base, file);
    const after = staged ? git(['show', `:${file}`]) : fileAt('HEAD', file);
    const parse = eco === 'npm' ? npmDeps : /(^|\/)pyproject\.toml$/.test(file) ? pyprojectDeps : pyDeps;
    let was;
    try { was = parse(before); } catch (e) { was = new Set(); /* broken base version: every current name counts as new and is checked */ }
    for (const name of parse(after)) if (!was.has(name)) newDeps.push({ name, eco, file });
  }
  const results = [];
  for (const d of newDeps) {
    const r = d.eco === 'npm' ? await checkNpm(d.name) : await checkPypi(d.name);
    const near = POPULAR.find((p) => p !== d.name && editDistance1(d.name.toLowerCase(), p));
    results.push({ ...d, ...r, typosquat_of: near || null });
  }
  // Pakiet, ktory ISTNIEJE i jest 1 literke od popularnego, to podrecznikowy slopsquat (np. "lodahs" jest w npm).
  // Istnienie w rejestrze niczego tu nie dowodzi — blokujemy tak samo jak brak pakietu.
  const blocked = results.filter((r) => r.ok === false || (r.ok === true && r.typosquat_of));
  const unknown = results.filter((r) => r.ok === null);
  if (json) { process.stdout.write(JSON.stringify(results, null, 1) + '\n'); return blocked.length ? 1 : 0; }
  if (!newDeps.length) { console.log('dep-exists: OK — brak nowych zaleznosci w diffie'); return 0; }
  for (const r of results) {
    const mark = r.ok === false ? 'BRAK ' : r.ok === null ? '?    ' : 'ok   ';
    console.log(`${mark}${r.eco}:${r.name}  (${r.file})${r.why ? '  ' + r.why : ''}${r.typosquat_of ? `  UWAGA: 1 literka od "${r.typosquat_of}"` : ''}`);
  }
  if (blocked.length) { console.log('dep-exists: zaleznosc, ktorej nie ma w rejestrze = halucynacja albo typosquat. Popraw nazwe. Prywatny rejestr: ALLOW_UNKNOWN_DEP=1.'); return 1; }
  if (unknown.length) console.log('dep-exists: rejestr niedostepny dla czesci pakietow — NIE potwierdzone, ale nie blokuje (offline).');
  return 0;
}

if (require.main === module) main().then((c) => process.exit(c), (err) => { console.error('dep-exists: ' + err.message.split('\n')[0]); process.exit(2); });
module.exports = { npmDeps, pyDeps, pyprojectDeps, editDistance1 };

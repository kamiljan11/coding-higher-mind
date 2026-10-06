#!/usr/bin/env node
'use strict';
// pg-slice (0 tokenow): tnie RUN/diff.patch na RUN/diff.<rola>.patch wg regul SCIEZEK, zeby finder czytal
// CALY swoj wycinek zamiast ~10-30 % pelnego diffu (audyt 2026-10-06 #2: r27 = 9 799 linii / 120 plikow,
// `src/lib/radar` 35 plikow = 0 findings ze wszystkich rol; prompt „czytaj CALY" przy 25 tool calls = pomijanie).
// Zasady:
//  - wycinek = kompletne bloki plikow z pelnego diffu (naglowek `diff --git` + hunki, bajt w bajt), kolejnosc zachowana,
//  - plik moze nalezec do wielu rol; plik, ktory nie pasuje do zadnej roli -> `code` (nic nie znika z recenzji),
//  - dowod dla pg-merge-dowod dalej = sha256 PELNEGO diff.patch (slice.json zapisuje go obok sha wycinkow).
// Uzycie: node pg-slice.js --run <RUN> [--repo <dir>] [--json]
// Wyjscie: RUN/diff.<rola>.patch (takze pusty, gdy rola nie ma plikow) + RUN/slice.json; stdout = tabela rozmiarow.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROLES = ['code', 'security', 'data', 'ops', 'ux', 'product', 'qa'];

const DOC_RX = /\.(md|mdx|txt|rst|adoc)$|(^|\/)docs?\//i;
const CODE_EXT_RX = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|rb|php|java|kt|swift|sh|ps1|sql|vue|svelte|css|scss)$/i;
// lib/* z zapytaniami do bazy = data (tresc bloku diffu albo plik w repo).
const QUERY_CONTENT_RX = /\.from\(\s*['"`]|\.rpc\(|\bsupabase\b|\bsql`|\bprisma\.|\bknex\b|\bdrizzle\b|\bselect\s+[\w*,\s]+\s+from\b/i;
const LIB_RX = /(^|\/)lib\//i;

// Reguly per rola (sciezka wzgledna repo, separator `/`). Kolejnosc bez znaczenia — plik trafia do KAZDEJ pasujacej roli.
const ROLE_RULES = {
  ux: [/\.(tsx|jsx|css|scss|sass|less|vue|svelte)$/i, /(^|\/)components?\//i, /(^|\/)app\//i, /(^|\/)pages\//i],
  data: [/\.sql$/i, /(^|\/)supabase\//i, /(^|\/)server\//i, /(^|\/)(db|database|migrations?|schema|models?|queries)\//i, /(^|\/)[\w.-]*(queries|repository|repo|schema)\.(ts|js)$/i],
  ops: [/(^|\/)scripts?\//i, /(^|\/)\.github\//i, /(^|\/)deploy/i, /RUNBOOK/i, /(^|\/)\.env[\w.-]*$/i, /(^|\/)server\//i,
    /(^|\/)(Dockerfile|docker-compose[\w.-]*\.ya?ml|vercel\.json|netlify\.toml|fly\.toml|Procfile)$/i, /(^|\/)package(-lock)?\.json$/i,
    /(^|\/)pnpm-lock\.yaml$/i, /(^|\/)(next|vite)\.config\./i, /\.(sh|ps1)$/i, /(^|\/)(cron|scheduled|workers?)\//i, /(^|\/)supabase\/functions\//i],
  product: [/(^|\/)docs?\//i, /(^|\/)README[\w.-]*$/i, /(^|\/)CHANGELOG[\w.-]*$/i, /(^|\/)\.env[\w.-]*\.(example|sample|template|dist)$/i,
    /(^|\/)route\.(ts|js)$/i, /(^|\/)api\//i, /(^|\/)supabase\/functions\//i, /(^|\/)openapi[\w.-]*\.(ya?ml|json)$/i, /(^|\/)index\.(ts|js)$/i],
  security: [/(^|\/)(auth|login|session|rls|polic(y|ies)|permissions?|access)[\/.\-_]/i, /(^|\/)server\//i, /(^|\/)actions?\.(ts|js)$/i, /(^|\/)actions\//i,
    /(^|\/)migrations?\//i, /\.sql$/i, /(^|\/)middleware\.(ts|js)$/i, /(^|\/)middleware\//i, /(^|\/)\.env[\w.-]*$/i, /(^|\/)route\.(ts|js)$/i,
    /(^|\/)api\//i, /(^|\/)supabase\/functions\//i, /(^|\/)webhooks?\//i, /(^|\/)(billing|payments?|checkout|stripe|payment-gateway|secrets?)\//i],
  qa: [/(^|\/)app\//i, /(^|\/)components?\//i, /(^|\/)pages\//i, /(^|\/)(e2e|playwright)\//i, /CRITICAL-PATHS/i, /\.(spec|e2e)\.(ts|js)$/i],
};

// Plik -> role. blockText (blok diffu) i repoFile (tresc z repo, opcjonalnie) sluza tylko do „lib z zapytaniami".
function rolesForFile(file, blockText, repoFile) {
  const f = String(file).replace(/\\/g, '/');
  const roles = new Set();
  for (const [role, rules] of Object.entries(ROLE_RULES)) if (rules.some((rx) => rx.test(f))) roles.add(role);
  if (!roles.has('data') && LIB_RX.test(f) && /\.(ts|js|mjs|cjs)$/i.test(f) && (QUERY_CONTENT_RX.test(blockText || '') || QUERY_CONTENT_RX.test(repoFile || ''))) roles.add('data');
  // code = kod bez docs; plik bez zadnej roli (np. tsconfig, .gitignore) tez -> code, zeby nic nie wypadlo z recenzji.
  if (!DOC_RX.test(f) && (CODE_EXT_RX.test(f) || !roles.size)) roles.add('code');
  if (!roles.size) roles.add('code');
  return ROLES.filter((r) => roles.has(r));
}

// Sciezka w cudzyslowach gita (core.quotePath: nie-ASCII jako \ooo, np. "b/docs/\305\274a.md") -> UTF-8.
function unquoteGit(s) {
  if (!s.includes('\\')) return s;
  const bytes = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== '\\') { bytes.push(...Buffer.from(s[i], 'utf8')); continue; }
    const oct = /^[0-7]{3}/.exec(s.slice(i + 1));
    if (oct) { bytes.push(parseInt(oct[0], 8)); i += 3; continue; }
    const esc = { n: 10, t: 9, '"': 34, '\\': 92, a: 7, b: 8, f: 12, r: 13, v: 11 }[s[i + 1]];
    bytes.push(esc === undefined ? s.charCodeAt(i + 1) : esc);
    i += 1;
  }
  return Buffer.from(bytes).toString('utf8');
}

// `diff --git a/x b/x` -> x. Nie-ASCII = forma gitowa "b/..." z \ooo (unquoteGit); spacja w nazwie = TAB na koncu ---/+++.
function pathOfHeader(header, block) {
  const pick = (rx) => { const m = rx.exec(block); return m && m[2] !== '/dev/null' ? (m[1] ? unquoteGit(m[2]) : m[2]) : null; };
  const plus = pick(/^\+\+\+ (")?(?:b\/)?(.+?)"?\t?\r?$/m);
  if (plus) return plus;
  const minus = pick(/^--- (")?(?:a\/)?(.+?)"?\t?\r?$/m);
  if (minus) return minus;
  const q = /^diff --git (")?a\/(.+?)"? "?b\/(.+?)"?\r?$/.exec(header);
  return q ? (q[1] ? unquoteGit(q[3]) : q[3]) : header.replace(/^diff --git /, '');
}

// Pelny diff -> [{ file, text }] (text = blok od `diff --git` do nastepnego, bajt w bajt). Preambula przed 1. blokiem pomijana.
function splitDiff(text) {
  const blocks = [];
  const rx = /^diff --git .*$/gm;
  const starts = [];
  let m;
  while ((m = rx.exec(text))) starts.push(m.index);
  starts.forEach((start, i) => {
    const chunk = text.slice(start, i + 1 < starts.length ? starts[i + 1] : text.length);
    const header = chunk.slice(0, chunk.indexOf('\n') >= 0 ? chunk.indexOf('\n') : chunk.length);
    blocks.push({ file: pathOfHeader(header, chunk), text: chunk });
  });
  return blocks;
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const countLines = (s) => (s ? s.split('\n').length - (s.endsWith('\n') ? 1 : 0) : 0);

function readRepoFile(repo, file) {
  if (!repo) return '';
  try { return fs.readFileSync(path.join(repo, file), 'utf8'); } catch (e) { return ''; }
}

// text: pelny diff. Zwraca { blocks: [{file, roles}], slices: { rola: { files, text } } }.
function sliceDiff(text, opts) {
  const repo = (opts && opts.repo) || '';
  const blocks = splitDiff(text).map((b) => Object.assign(b, { roles: rolesForFile(b.file, b.text, readRepoFile(repo, b.file)) }));
  const slices = Object.fromEntries(ROLES.map((r) => [r, { files: [], text: '' }]));
  for (const b of blocks) for (const r of b.roles) { slices[r].files.push(b.file); slices[r].text += b.text; }
  return { blocks, slices };
}

function run(runDir, repo) {
  const diffPath = path.join(runDir, 'diff.patch');
  const full = fs.readFileSync(diffPath, 'utf8');
  const { blocks, slices } = sliceDiff(full, { repo });
  const summary = { diff_sha256: sha256(fs.readFileSync(diffPath)), full: { files: blocks.length, lines: countLines(full), bytes: Buffer.byteLength(full) }, repo: repo ? path.resolve(repo) : null, roles: {} };
  for (const r of ROLES) {
    const out = path.join(runDir, `diff.${r}.patch`);
    fs.writeFileSync(out, slices[r].text);
    summary.roles[r] = { patch: out, files: slices[r].files, file_count: slices[r].files.length, lines: countLines(slices[r].text), bytes: Buffer.byteLength(slices[r].text), sha256: sha256(slices[r].text) };
  }
  summary.files = blocks.map((b) => ({ file: b.file, roles: b.roles }));
  fs.writeFileSync(path.join(runDir, 'slice.json'), JSON.stringify(summary, null, 2));
  return summary;
}

function render(summary) {
  const pct = (n) => (summary.full.lines ? `${Math.round((100 * n) / summary.full.lines)}%` : '-');
  const rows = [`pelny diff.patch: ${summary.full.files} plikow, ${summary.full.lines} linii, sha256=${summary.diff_sha256}`, 'rola      pliki  linii  %pelnego  bajty'];
  for (const r of ROLES) {
    const s = summary.roles[r];
    rows.push(`${r.padEnd(9)} ${String(s.file_count).padStart(5)} ${String(s.lines).padStart(6)} ${pct(s.lines).padStart(9)} ${String(s.bytes).padStart(7)}`);
  }
  return rows.join('\n') + '\n';
}

module.exports = { ROLES, ROLE_RULES, rolesForFile, splitDiff, sliceDiff, run, countLines, unquoteGit };

if (require.main === module) {
  const args = process.argv.slice(2);
  const val = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  const runDir = val('--run');
  if (!runDir || !fs.existsSync(path.join(runDir, 'diff.patch'))) { console.error('uzycie: pg-slice.js --run <RUN z diff.patch> [--repo <dir>] [--json]'); process.exit(2); }
  const summary = run(runDir, val('--repo'));
  process.stdout.write(args.includes('--json') ? JSON.stringify(summary, null, 2) + '\n' : render(summary));
}

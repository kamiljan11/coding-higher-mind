#!/usr/bin/env node
'use strict';
// pg-prechecks (0 tokenow): czysto mechaniczne komendy `rg` z rubryk recenzentow wykonane SKRYPTEM na plikach z diffu,
// zanim ruszy jakikolwiek finder (audyt 2026-10-06 #3/#10: checklista otwarta 0/7, code wykonal 9/30 komend rubryki,
// ta sama klasa `.limit(` bez `.order(` / log bez kontekstu wracala r24 -> r25 -> r27). Finder dostaje trafienia
// i OCENIA je (finding albo FP), zamiast palic budzet tool calls na grepy.
// Zakres: tylko linie DODANE w diffie (dlug historyczny poza zakresem — zasada „jakosc na biezaco", CLAUDE.md PG #5).
// Uzycie: node pg-prechecks.js --run <RUN> --repo <dir> [--json]
// Wyjscie: RUN/prechecks.json = { <rola>: [{ rule, file, line, text, source }] } (kazda rola z pg-slice, takze pusta lista).
// Reguly ponizej: `source` = punkt rubryki (agents/<rola>-reviewer.md#N albo checklista sd), z ktorego regula pochodzi.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { ROLES, splitDiff, rolesForFile } = require(path.join(__dirname, 'pg-slice.js'));

const CODE_FILES = /\.(ts|tsx|js|jsx|mjs|cjs|vue|svelte)$/i;
const UI_FILES = /\.(tsx|jsx|vue|svelte)$/i;
const SQL_FILES = /\.sql$/i;
const TEST_FILES = /(\.(test|spec)\.|(^|\/)(tests?|__tests__|e2e)\/|(^|\/)test_[^/]+\.(js|mjs|cjs|py)$)/i;
const SCRIPT_FILES = /(^|\/)scripts?\/|\.(sh|ps1)$/i;
const CI_FILES = /(^|\/)\.github\/workflows\/|(^|\/)package\.json$/i;
const ANY_TEXT = /./;

// rx/near: skladnia wspolna dla rg (Rust regex) i JS — bez lookaround/backreferencji.
// near = { rx, before, after }: trafienie liczy sie TYLKO, gdy w oknie linii [line-before, line+after] NIE ma `near.rx`.
const RULES = [
  { id: 'SUPPRESSION', rx: 'eslint-disable|@ts-ignore|@ts-expect-error|# *noqa|\\bnoqa\\b', files: /./, skip: null, roles: ['code'], source: 'agents/code-reviewer.md#7 SUPPRESSION-AS-FIX' },
  { id: 'ANY-TYPE', rx: ':\\s*any\\b|\\bas any\\b|<any>', files: CODE_FILES, skip: TEST_FILES, roles: ['code', 'ux'], source: 'agents/code-reviewer.md#7, agents/ux-reviewer.md#8' },
  { id: 'CONSOLE-LOG', rx: 'console\\.log\\(', files: CODE_FILES, skip: /(^|\/)scripts?\/|(^|\/)bin\/|\.(test|spec)\./i, roles: ['code', 'ops'], source: 'agents/code-reviewer.md#6' },
  { id: 'EMPTY-CATCH', rx: 'catch\\s*(\\(\\s*\\w*\\s*\\))?\\s*\\{\\s*\\}', files: CODE_FILES, skip: null, roles: ['code', 'ops'], source: 'agents/code-reviewer.md#6' },
  { id: 'LOG-NO-CONTEXT', rx: '(logger|log|console)\\.(warn|error)\\(\\s*[\'"`][^\'"`]*[\'"`]\\s*\\)', files: CODE_FILES, skip: TEST_FILES, roles: ['ops', 'code'], source: 'agents/ops-reviewer.md#4 (audyt #10: LOG-WITHOUT-CONTEXT)' },
  { id: 'PII-IN-LOG', rx: 'console\\.(log|error|warn)\\(.*(email|phone|token|kennitala|password)', i: true, files: CODE_FILES, skip: TEST_FILES, roles: ['ops', 'security'], source: 'agents/ops-reviewer.md#4' },
  { id: 'SERVICE-ROLE', rx: 'service_role|SERVICE_ROLE', files: ANY_TEXT, skip: /\.env[\w.-]*\.(example|sample|template|dist)$/i, roles: ['security', 'data'], source: 'agents/security-reviewer.md#1, review-checklists.md (security)' },
  { id: 'SECRET-LITERAL', rx: 'sk_(live|test)_[A-Za-z0-9]{8,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sbp_[A-Za-z0-9]{20,}|Bearer [A-Za-z0-9._-]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY', files: ANY_TEXT, skip: null, roles: ['ops', 'security'], source: 'agents/ops-reviewer.md#6' },
  { id: 'DANGEROUS-SINK', rx: 'dangerouslySetInnerHTML|execSync\\(|\\beval\\(|new Function\\(|child_process', files: CODE_FILES, skip: TEST_FILES, roles: ['security', 'code'], source: 'agents/security-reviewer.md#6' },
  { id: 'REQ-JSON-NO-PARSE', rx: '(req|request)\\.json\\(\\)', near: { rx: 'safeParse|\\.parse\\(', before: 2, after: 6 }, files: CODE_FILES, skip: TEST_FILES, roles: ['security'], source: 'agents/security-reviewer.md#3' },
  { id: 'FETCH-NO-TIMEOUT', rx: '\\bfetch\\(', near: { rx: 'signal|timeout|AbortSignal', before: 2, after: 6 }, files: CODE_FILES, skip: TEST_FILES, roles: ['ops', 'security'], source: 'agents/ops-reviewer.md#3, agents/security-reviewer.md#8, review-checklists.md (niezawodnosc)' },
  { id: 'LIMIT-WITHOUT-ORDER', rx: '\\.limit\\(', near: { rx: '\\.order\\(|order by', before: 12, after: 4, statement: true, start: '\\.from\\(|\\bselect\\b' }, files: CODE_FILES, skip: TEST_FILES, roles: ['data', 'code'], source: 'agents/data-reviewer.md#5, audyt #10 (keyset/stronicowanie)' },
  { id: 'SINGLE-ROW', rx: '\\.single\\(\\)', files: CODE_FILES, skip: TEST_FILES, roles: ['data'], source: 'agents/data-reviewer.md#5, agents/code-reviewer.md#2' },
  { id: 'SELECT-STAR', rx: '\\.select\\(\\s*[\'"`]\\*[\'"`]', files: CODE_FILES, skip: TEST_FILES, roles: ['data'], source: 'agents/data-reviewer.md#5' },
  { id: 'FLOAT-MONEY', rx: 'toFixed\\(|parseFloat\\(', files: CODE_FILES, skip: TEST_FILES, roles: ['data', 'ux'], source: 'agents/data-reviewer.md#8, agents/ux-reviewer.md#2' },
  { id: 'SILENT-FALLBACK', rx: '(\\?\\?|\\|\\|)\\s*[A-Z_]*(DEFAULT|COMPANIES\\[0\\]|COMPANY)|\\.find\\(.*\\)\\s*\\?\\?', files: CODE_FILES, skip: TEST_FILES, roles: ['code'], source: 'agents/code-reviewer.md#9 SILENT-FALLBACK' },
  { id: 'INLINE-STYLE-HEX', rx: '#[0-9a-fA-F]{3,8}\\b|style=\\{\\{', files: UI_FILES, skip: TEST_FILES, roles: ['ux'], source: 'agents/ux-reviewer.md#7' },
  { id: 'SQL-DESTRUCTIVE', rx: 'drop\\s+(table|column|schema|policy)|rename\\s+(to|column)|set\\s+not\\s+null|add\\s+column.*not\\s+null', i: true, files: SQL_FILES, skip: null, roles: ['data', 'security'], source: 'agents/data-reviewer.md#2, review-checklists.md (dane)' },
  { id: 'DEFINER-NO-SEARCH-PATH', rx: 'security\\s+definer', i: true, near: { rx: 'search_path', before: 10, after: 10 }, files: SQL_FILES, skip: null, roles: ['security', 'data'], source: 'agents/security-reviewer.md#2' },
  { id: 'CI-SILENT-SKIP', rx: 'if-present|continue-on-error|\\|\\| true', files: CI_FILES, skip: null, roles: ['ops'], source: 'agents/ops-reviewer.md#8, review-checklists.md (CI)' },
  { id: 'TODO', rx: '\\b(TODO|FIXME|XXX|HACK)\\b', files: ANY_TEXT, skip: null, roles: ['product', 'code'], source: 'agents/product-reviewer.md#6 (skrot/TODO)' },
];
const MAX_HITS_PER_RULE_FILE = 20;

// Diff -> { file: { added: Set(numery linii DODANYCH po stronie b/), text: Map(linia -> tekst dodany),
//                    post: Map(linia -> tekst; kontekst + dodane = fragment pliku PO zmianie), roles } }.
function addedLines(diffText, repo) {
  const out = {};
  for (const b of splitDiff(diffText)) {
    const set = new Set();
    const text = new Map();
    const post = new Map();
    let n = 0;
    let inHunk = false;
    for (const raw of b.text.split('\n')) {
      const line = raw.replace(/\r$/, '');
      const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      if (h) { n = Number(h[1]); inHunk = true; continue; }
      if (!inHunk) continue;
      if (line.startsWith('+')) { set.add(n); text.set(n, line.slice(1)); post.set(n, line.slice(1)); n++; }
      else if (line.startsWith('-') || line.startsWith('\\')) continue;
      else { post.set(n, line.slice(1)); n++; }
    }
    out[b.file] = { added: set, text, post, roles: rolesForFile(b.file, b.text, repo ? readLines(repo, b.file).join('\n') : '') };
  }
  return out;
}

// Repo NIE jest na stanie diffu, gdy ktorakolwiek linia dodana w diffie ma w pliku repo inny tekst (r27: repo 2 commity
// dalej -> radar.css 114 linii przesunietych). Wtedy numery/tekst z repo klamia — plik sprawdzamy na tekscie z diffu.
function isStale(repo, file, meta) {
  const lines = readLines(repo, file);
  for (const [n, t] of meta.text) if ((lines[n - 1] || '').replace(/\r$/, '') !== t) return true;
  return false;
}

// Kandydaci z samego diffu (plik stale): linie dodane + okno `near` z fragmentu pliku po zmianie (kontekst hunka).
function candidatesFromDiff(rule, file, meta) {
  const rx = new RegExp(rule.rx, rule.i ? 'i' : '');
  const hits = [];
  for (const [line, text] of meta.text) if (rx.test(text)) hits.push({ file, line, text });
  return hits;
}

let rgAvailable = null;
function hasRg() {
  if (rgAvailable === null) rgAvailable = spawnSync('rg', ['--version'], { encoding: 'utf8' }).status === 0;
  return rgAvailable;
}

// Kandydaci (plik, linia, tekst) dla jednej reguly: rg --json (gdy jest), inaczej ten sam regex w JS (wynik identyczny).
function candidates(rule, repo, files) {
  if (!files.length) return [];
  if (hasRg()) {
    const args = ['--json', '-n', ...(rule.i ? ['-i'] : []), '-e', rule.rx, '--', ...files];
    const res = spawnSync('rg', args, { cwd: repo, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (res.status === 0 || res.status === 1) {
      const hits = [];
      for (const line of String(res.stdout || '').split('\n')) {
        if (!line.startsWith('{')) continue;
        let ev;
        try { ev = JSON.parse(line); } catch (e) { continue; }
        if (ev.type !== 'match') continue;
        const file = (ev.data.path.text || '').replace(/\\/g, '/').replace(/^\.\//, '');
        hits.push({ file, line: ev.data.line_number, text: String((ev.data.lines && ev.data.lines.text) || '').replace(/\r?\n$/, '') });
      }
      return hits;
    }
  }
  const rx = new RegExp(rule.rx, rule.i ? 'i' : '');
  const hits = [];
  for (const file of files) {
    readLines(repo, file).forEach((text, idx) => { if (rx.test(text)) hits.push({ file, line: idx + 1, text }); });
  }
  return hits;
}

const fileCache = new Map();
function readLines(repo, file) {
  const key = path.join(repo, file);
  if (!fileCache.has(key)) {
    let lines = [];
    try { lines = fs.readFileSync(key, 'utf8').split(/\r?\n/); } catch (e) { lines = []; }
    fileCache.set(key, lines);
  }
  return fileCache.get(key);
}

const ENDS_STATEMENT = /[;{}]\s*(\/\/.*)?$/;
const ENDS_ITEM = /[;,{}]\s*(\/\/.*)?$/;
// near.statement: okno = TYLKO instrukcja z trafieniem (wstecz do `start` wlacznie albo do konca poprzedniej instrukcji,
// naprzod do `;`/`,`) — sasiednie zapytanie z `.order(` nie maskuje `.limit(` bez `.order(` (2 zapytania w Promise.all).
function nearMatches(rule, lines, hit) {
  if (!rule.near) return false;
  const rx = new RegExp(rule.near.rx, 'i');
  const at = hit.line - 1;
  if (!rule.near.statement) {
    const from = Math.max(0, at - rule.near.before);
    const to = Math.min(lines.length - 1, at + rule.near.after);
    for (let i = from; i <= to; i++) if (rx.test(lines[i])) return true;
    return false;
  }
  if (rx.test(lines[at] || '')) return true;
  const start = rule.near.start ? new RegExp(rule.near.start) : null;
  for (let i = at - 1; i >= Math.max(0, at - rule.near.before) && !(start && start.test(lines[i + 1] || '')); i--) {
    if (ENDS_STATEMENT.test(lines[i])) break;
    if (rx.test(lines[i])) return true;
  }
  for (let i = at; i < Math.min(lines.length - 1, at + rule.near.after) && !ENDS_ITEM.test(lines[i]); i++) {
    if (rx.test(lines[i + 1])) return true;
  }
  return false;
}

// diffText: pelny diff; repo: katalog z plikami PO zmianie (working tree / checkout PR).
function prechecks(diffText, repo) {
  const byFile = addedLines(diffText, repo);
  const result = Object.fromEntries(ROLES.map((r) => [r, []]));
  const withAdded = Object.keys(byFile).filter((f) => byFile[f].added.size);
  const present = withAdded.filter((f) => fs.existsSync(path.join(repo, f)) && !isStale(repo, f, byFile[f]));
  const stale = withAdded.filter((f) => !present.includes(f));
  const postLines = (f) => { const p = byFile[f].post; const arr = []; for (const [n, t] of p) arr[n - 1] = t; return Array.from(arr, (t) => t || ''); };
  for (const rule of RULES) {
    const applies = (f) => rule.files.test(f) && !(rule.skip && rule.skip.test(f));
    const files = present.filter(applies);
    const perFile = {};
    const fromDiff = stale.filter(applies).flatMap((f) => candidatesFromDiff(rule, f, byFile[f]).map((h) => Object.assign(h, { origin: 'diff' })));
    for (const hit of candidates(rule, repo, files).concat(fromDiff)) {
      const meta = byFile[hit.file];
      if (!meta || !meta.added.has(hit.line)) continue;
      if (nearMatches(rule, hit.origin === 'diff' ? postLines(hit.file) : readLines(repo, hit.file), hit)) continue;
      perFile[hit.file] = (perFile[hit.file] || 0) + 1;
      if (perFile[hit.file] > MAX_HITS_PER_RULE_FILE) continue;
      // Rola dostaje trafienie, gdy plik jest w jej wycinku; gdy w zadnym z wycinkow rol reguly -> pierwsza rola reguly.
      const inSlice = rule.roles.filter((r) => meta.roles.includes(r));
      const targets = inSlice.length ? inSlice : [rule.roles[0]];
      // security dostaje swoje reguly zawsze: XSS/injection w lib/components nie jest w wycinku sciezek security (2026-10-06).
      if (rule.roles.includes('security') && !targets.includes('security')) targets.push('security');
      for (const role of targets) {
        const row = { rule: rule.id, file: hit.file, line: hit.line, text: hit.text.trim().slice(0, 200), source: rule.source };
        if (hit.origin) row.origin = hit.origin;
        result[role].push(row);
      }
    }
  }
  // Nie-wyliczalna wlasciwosc: JSON.stringify jej nie zapisuje (prechecks.json = tylko role), CLI ja raportuje.
  Object.defineProperty(result, 'stale', { value: stale, enumerable: false });
  return result;
}

module.exports = { RULES, prechecks, addedLines };

if (require.main === module) {
  const args = process.argv.slice(2);
  const val = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  const runDir = val('--run');
  const repo = val('--repo');
  if (!runDir || !repo || !fs.existsSync(path.join(runDir, 'diff.patch')) || !fs.existsSync(repo)) {
    console.error('uzycie: pg-prechecks.js --run <RUN z diff.patch> --repo <dir> [--json]'); process.exit(2);
  }
  const result = prechecks(fs.readFileSync(path.join(runDir, 'diff.patch'), 'utf8'), path.resolve(repo));
  fs.writeFileSync(path.join(runDir, 'prechecks.json'), JSON.stringify(result, null, 2));
  if (args.includes('--json')) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  else {
    const rows = [`prechecks.json (linie dodane w diffie, ${hasRg() ? 'rg' : 'fallback JS'}):`];
    if (result.stale.length) {
      rows.push(`UWAGA: ${result.stale.length} plik(ow) w repo != stan diffu (repo nie na commicie recenzji albo plik usuniety) -> sprawdzone na tekscie`
        + ` z diffu, okno near = tylko kontekst hunka (origin: "diff"): ${result.stale.slice(0, 5).join(', ')}${result.stale.length > 5 ? ', ...' : ''}`);
    }
    for (const r of ROLES) {
      const counts = {};
      for (const h of result[r]) counts[h.rule] = (counts[h.rule] || 0) + 1;
      rows.push(`${r.padEnd(9)} ${String(result[r].length).padStart(4)}  ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(' ')}`);
    }
    process.stdout.write(rows.join('\n') + '\n');
  }
}

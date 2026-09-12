#!/usr/bin/env node
// Stop hook (globalny) v3 (2026-09-05). Claude Code nie moze zakonczyc odpowiedzi, gdy w repo,
// ktorego DOTYKAL w tej sesji, sa:
//  (1) bledy lintu/typow w zmienionych plikach (lapie edycje przez Bash/MCP, ktore ominely post-edit),
//  (2) czerwone testy (npm test / vitest / pytest),
//  (3) zmiana RYZYKOWNA (sciezki T3: auth/RLS/billing/migracje/edge fn, albo > RISKY_LINES linii)
//      bez recenzji subagenta *reviewer* po ostatniej serii edycji.
// Repo wykrywane z: transcriptu sesji (edytowane pliki), cwd, podkatalogow cwd z .git —
// bo cwd sesji czesto NIE jest repo (np. <workspace>) i v2 wtedy nigdy nie gatowal.
// Ochrona przed petla: max MAX_BLOCKS_PER_CYCLE blokad na cykl, kazda z INNYM powodem; stan w %TEMP%.
// Fail-open na wlasne bledy; kazdy skip do ~/.claude/logs/gates.jsonl.
'use strict';
const { execSync, spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { lintFiles, isCodeFile, WRITE_COMMAND_RX, CHILD_ENV } = require('./lib/lint-file');
const { log } = require('./lib/gate-log');
const { classify, modelFor } = require('./lib/risk-tier');

const HOOK = 'stop-gate';
const MAX_REPOS = 4;
const BLOCK_REASONS = 3; // lint, testy, review
// Kazda blokada = inna para (powod, repo); sufit = wszystkie mozliwe pary, wiec bramka review nie gasnie
// po wyczerpaniu limitu przez lint+testy (finding security-reviewer 2026-09-05 na v3.0: max 2).
const MAX_BLOCKS_PER_CYCLE = BLOCK_REASONS * MAX_REPOS;
const MAX_LINT_FILES = 20;
const POST_REVIEW_EDIT_BUDGET = 8; // poprawki po review nie wymagaja kolejnego review; nowy feature — tak
const TEST_TIMEOUT_MS = 55000;
const GIT_TIMEOUT_MS = 15000;
const REVIEWER_RX = /reviewer|verifier/i;
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'mcp__desktop-commander__write_file', 'mcp__desktop-commander__edit_block']);
const TEST_FILE_RX = /(\.(test|spec)\.|_test\.|test_[^/\\]*\.py|[\/\\]tests?[\/\\]|[\/\\]e2e[\/\\])/;
const SQL_FILE_RX = /\.sql$/i;
const TEMPLATE_TEST = path.join('src', 'test', 'example.test.ts');
const ENV_MISSING_RX = /ETIMEDOUT|ENOENT|not recognized|No module named|command not found/i;

let input = {};
try { input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch (e) { process.exit(0); }
const cwd = input.cwd || process.cwd();

// --- stan cyklu (max N blokad, kazda z innym powodem) ---
// Klucz stanu = cwd + session_id: dwie rownolegle sesje w tym samym katalogu nie dziela stanu anty-petli.
const statePath = path.join(os.tmpdir(), 'claude-stop-gate-' + crypto.createHash('md5').update(cwd + '|' + String(input.session_id || '')).digest('hex'));
function readState() { try { return JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch (e) { return { reasons: [] }; } }
function clearState() { try { fs.unlinkSync(statePath); } catch (e) { /* brak = ok */ } }
const state = readState();
if (!Array.isArray(state.reasons)) state.reasons = [];

// Klucz blokady = powod@repo. Sam powod (v3.0) gasil sprawdzenie dla WSZYSTKICH repo w cyklu — po jednym
// bloku lintu w repo A, repo B z realnym bledem przechodzilo (finding dogfood code-reviewer 2026-09-05).
const blockKey = (reason, repo) => `${reason}@${repo}`;
const alreadyBlocked = (reason, repo) => state.reasons.includes(blockKey(reason, repo));

function block(reason, repo, message) {
  state.reasons.push(blockKey(reason, repo));
  try { fs.writeFileSync(statePath, JSON.stringify(state)); } catch (e) { /* bez stanu i tak konczymy exit 2 */ }
  log({ hook: HOOK, event: 'blocked', reason, target: repo });
  process.stderr.write(`STOP ZABLOKOWANY [${reason}] w ${repo}:\n${message}\n`);
  process.exit(2);
}

// --- git helpers ---
function sh(cmd, dir, timeout) {
  try {
    return { ok: true, out: execSync(cmd, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'], timeout, env: CHILD_ENV }).toString() };
  } catch (e) {
    return { ok: false, status: e.status, out: (String(e.stdout || '') + '\n' + String(e.stderr || '')).trim(), msg: String(e.message || '') };
  }
}
// `npm test --silent` przy czerwonych testach potrafi nie wypisac NIC — pusty output nie moze znaczyc "zielone".
const failureReport = (t) => (t.out || `(brak outputu, exit code ${t.status})`).split('\n').slice(-50).join('\n');
function gitRoot(dir) {
  const r = sh('git rev-parse --show-toplevel', dir, GIT_TIMEOUT_MS);
  return r.ok ? path.resolve(r.out.trim()) : null;
}
// Zmienione pliki (staged + unstaged + untracked), bez usunietych. Zwraca sciezki absolutne.
function changedFiles(root) {
  const r = sh('git status --porcelain --untracked-files=all', root, GIT_TIMEOUT_MS);
  if (!r.ok) return [];
  const files = [];
  for (const line of r.out.split('\n')) {
    if (!line.trim() || /^(.D|D)/.test(line)) continue;
    let rel = line.slice(3).trim();
    if (rel.includes(' -> ')) rel = rel.split(' -> ').pop();
    files.push(path.join(root, rel.replace(/^"|"$/g, '')));
  }
  return files;
}
function changedLineCount(root, files) {
  let total = 0;
  const numstat = sh('git diff --numstat HEAD', root, GIT_TIMEOUT_MS);
  if (numstat.ok) for (const line of numstat.out.split('\n')) {
    const m = line.match(/^(\d+)\s+(\d+)\s/);
    if (m) total += Number(m[1]) + Number(m[2]);
  }
  const untracked = sh('git ls-files --others --exclude-standard', root, GIT_TIMEOUT_MS);
  if (untracked.ok) for (const rel of untracked.out.split('\n').filter(Boolean)) {
    const abs = path.join(root, rel);
    if (!isCodeFile(abs)) continue;
    try { total += fs.readFileSync(abs, 'utf8').split('\n').length; } catch (e) { /* zniknal */ }
  }
  return total;
}

// --- transcript sesji: co edytowano, czy byl reviewer po ostatnich edycjach ---
// Rola recenzenta z wywolania Agent: `subagent_type` (takze z prefiksem pluginu) albo — fallback pg-review dla rol
// niezaladowanych w sesji — sciezka `agents/<rola>.md` w prompcie. Narada 2026-09-12 (code-reviewer): stop-gate
// sprawdzal tylko, czy JAKIKOLWIEK recenzent sie odpalil — T3 z 4 wymaganymi dzialami przechodzil po samym code-reviewerze.
function reviewerRoleOf(toolInput) {
  const type = String(toolInput.subagent_type || '').split(':').pop();
  if (REVIEWER_RX.test(type)) return type;
  const m = String(toolInput.prompt || '').match(/agents[\/\\]([\w-]*(?:reviewer|verifier))\.md/i);
  return m ? m[1] : null;
}

async function parseTranscript(transcriptPath) {
  const result = { available: false, editedFiles: [], editsAfterReview: 0, reviewerRan: false, reviewersRan: new Set() };
  if (!transcriptPath || !fs.existsSync(transcriptPath)) return result;
  result.available = true;
  const rl = readline.createInterface({ input: fs.createReadStream(transcriptPath, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.includes('"tool_use"')) continue;
    let entry;
    try { entry = JSON.parse(line); } catch (e) { continue; }
    for (const block of (entry.message && entry.message.content) || []) {
      if (!block || block.type !== 'tool_use') continue;
      const toolInput = block.input || {};
      if (EDIT_TOOLS.has(block.name)) {
        const file = toolInput.file_path || toolInput.path || toolInput.notebook_path;
        if (file) result.editedFiles.push(file);
        result.editsAfterReview++;
      } else if (/^(Bash|PowerShell)$/.test(block.name) && WRITE_COMMAND_RX.test(String(toolInput.command || ''))) {
        result.editsAfterReview++;
      } else if (block.name === 'Agent') {
        const role = reviewerRoleOf(toolInput);
        if (role) { result.reviewerRan = true; result.reviewersRan.add(role); result.editsAfterReview = 0; }
      }
    }
  }
  return result;
}

// Granica zaufania: uruchamiamy testy/lint (= kod repo) TYLKO w repo, ktorych sesja dotykala
// (cwd albo pliki edytowane wg transcriptu). v3.0 skanowalo podkatalogi cwd i odpalalo `npm test`
// nietknietych repo-sasiadow (finding security-reviewer 2026-09-05). Brudne repo-sasiady tylko logujemy.
function discoverRepos(editedFiles) {
  const roots = new Set();
  const cwdRoot = gitRoot(cwd);
  if (cwdRoot) roots.add(cwdRoot);
  for (const file of editedFiles) {
    const dir = path.dirname(file);
    if (fs.existsSync(dir)) { const root = gitRoot(dir); if (root) roots.add(root); }
  }
  if (!cwdRoot) {
    try {
      const untouched = fs.readdirSync(cwd)
        .map((name) => path.resolve(cwd, name))
        .filter((sub) => fs.existsSync(path.join(sub, '.git')) && !roots.has(sub));
      if (untouched.length) log({ hook: HOOK, event: 'skipped', reason: `${untouched.length} untouched repo(s) under cwd not scanned (trust boundary)`, target: cwd });
    } catch (e) { /* cwd nieczytelny */ }
  }
  return [...roots].slice(0, MAX_REPOS);
}

// --- testy (jak v2) ---
function hasBin(root, name) {
  return fs.existsSync(path.join(root, 'node_modules', '.bin', name)) || fs.existsSync(path.join(root, 'node_modules', '.bin', name + '.cmd'));
}
function readPkg(root) { try { return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')); } catch (e) { return null; } }
function hasPytestConfig(root, changed) {
  if (fs.existsSync(path.join(root, 'pytest.ini')) || fs.existsSync(path.join(root, 'tests'))) return true;
  try { if (/\[tool\.pytest/.test(fs.readFileSync(path.join(root, 'pyproject.toml'), 'utf8'))) return true; } catch (e) { /* brak pyproject */ }
  return changed.some((f) => /(^|[\/\\])test_[^\/\\]*\.py$/.test(f));
}
// Zwraca output czerwonych testow albo null (zielone / brak testow / srodowisko).
function runTests(root, changed) {
  const changedJs = changed.some((f) => /\.(ts|tsx|js|jsx|mts|cts|mjs|cjs)$/.test(f));
  const changedPy = changed.some((f) => /\.py$/.test(f));
  const pkg = readPkg(root);
  if (changedJs && !pkg) log({ hook: HOOK, event: 'skipped', reason: 'no package.json (tests)', target: root });
  if (changedPy && !hasPytestConfig(root, changed)) log({ hook: HOOK, event: 'skipped', reason: 'no pytest config', target: root });
  if (changedJs && pkg) {
    let t = null;
    if (pkg.scripts && pkg.scripts.test) t = sh('npm test --silent', root, TEST_TIMEOUT_MS);
    else if (hasBin(root, 'vitest')) t = sh('npx --no-install vitest run --passWithNoTests', root, TEST_TIMEOUT_MS);
    else log({ hook: HOOK, event: 'skipped', reason: 'no test script / vitest', target: root });
    if (t && !t.ok) {
      if (ENV_MISSING_RX.test((t.msg || '') + ' ' + t.out.slice(-300))) log({ hook: HOOK, event: 'skipped', reason: 'tests env/timeout', target: root });
      else return failureReport(t);
    }
  }
  if (changedPy && hasPytestConfig(root, changed)) {
    const t = sh('python -m pytest -q -x -p no:cacheprovider', root, TEST_TIMEOUT_MS);
    if (!t.ok) {
      if (ENV_MISSING_RX.test((t.msg || '') + ' ' + t.out.slice(-300))) log({ hook: HOOK, event: 'skipped', reason: 'pytest env/timeout', target: root });
      else return failureReport(t);
    }
  }
  return null;
}

// Ostrzezenia (nie blokady) z gap-analizy 2026-09-12 (slownik SH): dev na produkcyjnej bazie; UI zmienione, a QA na zadanie.
const ENV_REF_GATE = path.join(__dirname, '..', 'bin', 'env-ref-gate.js');
const QA_PATHS_DOC = path.join('docs', 'CRITICAL-PATHS.md');
const UI_CHANGE_RX = /\.(tsx|jsx|vue|svelte)$|[\/\\](routes?|pages|app)[\/\\]|supabase[\/\\]functions/i;

function nudges(root, changed) {
  if (!changed.some((f) => TEST_FILE_RX.test(f))) {
    process.stderr.write('[stop-gate] Uwaga: zmieniono kod bez zmiany testow. Nowa logika => dopisz test (DoD). Refaktor/config => zignoruj.\n');
  }
  if (fs.existsSync(ENV_REF_GATE)) {
    // execFileSync (tablica argumentow), nie string powloki: sciezka repo z metaznakami nie moze stac sie komenda
    // (security-reviewer 2026-09-12: SHELL-STRING-INTERPOLATION).
    const env = spawnSync(process.execPath, [ENV_REF_GATE, '--repo', root], { cwd: root, encoding: 'utf8', timeout: GIT_TIMEOUT_MS, env: CHILD_ENV });
    if (env.status === 1) process.stderr.write('[stop-gate] DEV NA PRODZIE: lokalny .env wskazuje na produkcyjny ref Supabase (PRR P15). Przelacz na staging/branch albo zadeklaruj `pg.single_env: true` z powodem w CLAUDE.md.\n' + String(env.stdout || '').split('\n').slice(0, 4).join('\n') + '\n');
  }
  if (changed.some((f) => UI_CHANGE_RX.test(f)) && fs.existsSync(path.join(root, QA_PATHS_DOC))) {
    process.stderr.write('[stop-gate] UI/route/edge fn zmienione i docs/CRITICAL-PATHS.md istnieje -> sciezki krytyczne na instancjach: `node ~/.claude/bin/qa-matrix.js --repo . --base-url <url>` albo dzial qa-reviewer (pg-review 1b). Na T3 z linia `pg.qa_url: <url>` w CLAUDE.md qa-reviewer staje sie WYMAGANY (narada D-2026-09-12, opcja C); bez niej = ostrzezenie.\n');
  }
  if (fs.existsSync(path.join(root, TEMPLATE_TEST))) {
    const list = sh('git ls-files -- "*.test.ts" "*.test.tsx" "*.spec.ts" "*.spec.tsx"', root, GIT_TIMEOUT_MS);
    const real = (list.out || '').split('\n').map((s) => s.trim()).filter((s) => s && !/src\/test\/example\.test\.ts$/.test(s) && !/^e2e\//.test(s));
    if (!real.length) process.stderr.write('[stop-gate] Uwaga: jedyny test jednostkowy to szablonowy src/test/example.test.ts — bramka testow pilnuje niczego.\n');
  }
}

// Tier T0..T3 z lib/risk-tier.js (sciezki + rozmiar diffu). T0/T1 nie wymagaja recenzji przy Stop
// (T1 = code-reviewer zalecany, ale blokujemy dopiero od T2 — proporcjonalnosc, nie paraliz).
function reviewRequirement(root, changedCode) {
  const lines = changedLineCount(root, changedCode);
  const verdict = classify(changedCode, lines, root);
  // Sufit z pg.phase zostawia slad w telemetrii — obnizenie wymagan przez tresc repo ma byc widoczne, nie ciche.
  if (verdict.phaseCapped) log({ hook: HOOK, event: 'skipped', reason: `review cap: pg.phase ${verdict.phase} -> ${verdict.tier}`, target: root });
  if (verdict.tier === 'T0' || verdict.tier === 'T1') return null;
  const list = verdict.reviewers.map((r) => `${r} (${modelFor(r, verdict.tier)})`).join(', ');
  return { tier: verdict.tier, why: verdict.reasons.join('; '), reviewers: list, required: verdict.reviewers };
}

async function main() {
  if (state.reasons.length >= MAX_BLOCKS_PER_CYCLE) {
    clearState();
    log({ hook: HOOK, event: 'skipped', reason: `max ${MAX_BLOCKS_PER_CYCLE} blocks reached: ${state.reasons.join(',')}`, target: cwd });
    return;
  }
  const transcript = await parseTranscript(input.transcript_path);
  if (!transcript.available) log({ hook: HOOK, event: 'skipped', reason: 'no transcript_path (review gate off)', target: cwd });

  const repos = discoverRepos(transcript.editedFiles);
  if (!repos.length) { log({ hook: HOOK, event: 'skipped', reason: 'no git repo in cwd/subdirs/edited files', target: cwd }); return; }

  let touched = 0;
  for (const root of repos) {
    const changed = changedFiles(root);
    // SQL (migracje/RLS) nie ma lintera w hooku, ale to najbardziej ryzykowna klasa zmian — liczy sie do review.
    const changedCode = changed.filter((f) => isCodeFile(f) || SQL_FILE_RX.test(f));
    if (!changedCode.length) continue;
    touched++;

    if (!alreadyBlocked('lint', root)) {
      const lint = lintFiles(changedCode.filter(isCodeFile).slice(0, MAX_LINT_FILES), { hook: HOOK });
      if (lint) block('lint', root, lint.header + '\n' + lint.out);
    }
    if (!alreadyBlocked('testy', root)) {
      const failed = runTests(root, changed);
      if (failed) block('testy', root, 'Testy nie przechodza. Napraw je, dopiero potem koncz:\n' + failed);
    }
    if (!alreadyBlocked('review', root) && transcript.available) {
      const need = reviewRequirement(root, changedCode);
      // Kazdy WYMAGANY dzial musial sie odpalic (nie: jakikolwiek recenzent) — narada 2026-09-12, fakt code-reviewera.
      const missing = need ? need.required.filter((r) => !transcript.reviewersRan.has(r)) : [];
      const reviewed = transcript.reviewerRan && transcript.editsAfterReview <= POST_REVIEW_EDIT_BUDGET && missing.length === 0;
      if (need && !reviewed) block('review', root,
        `Zmiana ${need.tier} (${need.why}) bez pelnej recenzji dzialowej. Wymagani recenzenci: ${need.reviewers}. ` +
        (missing.length && transcript.reviewerRan ? `BRAKUJE: ${missing.join(', ')} (odpalono: ${[...transcript.reviewersRan].join(', ') || 'nikogo'}). ` : '') +
        'Odpal skill pg-review (finderzy rownolegle, swiezy kontekst, read-only -> agregacja -> weryfikator), ' +
        'napraw findings w tej samej turze, potem zakoncz. Procedura: ~/.claude/pg/dod.md. Bramka, nie proza (7L).');
    }
    nudges(root, changed);
  }
  clearState();
  log({ hook: HOOK, event: 'ran', reason: `${touched}/${repos.length} repos with code changes`, target: repos.join(';') });
}

main().then(() => process.exit(0)).catch(() => process.exit(0));

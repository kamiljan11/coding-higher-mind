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
// Werdykty z jednego zrodla (pg-aggregate; plik pod pieczecia). Nieudany require NIE moze po cichu wylaczyc bramki
// (ops-review 2026-09-27: exit 1 hooka Stop nie blokuje) — blad trafia do logu, a recenzja T2+ blokuje z powodem.
let VERDICT = null;
let aggLoadError = '';
try { ({ VERDICT } = require(path.join(__dirname, '..', 'bin', 'pg-aggregate.js'))); } catch (e) {
  aggLoadError = String(e && e.message || e).slice(0, 160);
  log({ hook: 'stop-gate', event: 'skipped', reason: `pg-aggregate.js nie laduje sie: ${aggLoadError}`, target: __dirname });
}
const { classify, modelFor, T3_PATH_RX, contentEscalation } = require('./lib/risk-tier');
const { isTempPath } = require('./lib/protected-paths');

const HOOK = 'stop-gate';
const MAX_REPOS = 4;
const BLOCK_REASONS = 3; // lint, testy, review
// Kazda blokada = inna para (powod, repo); sufit = wszystkie mozliwe pary, wiec bramka review nie gasnie
// po wyczerpaniu limitu przez lint+testy (finding security-reviewer 2026-09-05 na v3.0: max 2).
const MAX_BLOCKS_PER_CYCLE = BLOCK_REASONS * MAX_REPOS;
const MAX_LINT_FILES = 20;
const POST_REVIEW_EDIT_BUDGET = 8; // poprawki po review nie wymagaja kolejnego review; nowy feature — tak
const TEST_TIMEOUT_MS = 55000;
const PY_PROBE_MS = 8000;
// Prawdziwa sciezka do porownan (nazwy 8.3, junction); male litery tylko na Windowsie.
const realLower = (p) => {
  let x;
  try { x = fs.realpathSync.native(p); } catch (e) { x = path.resolve(p); }
  x = x.replace(/\\/g, '/').replace(/\/+$/, '');
  return process.platform === 'win32' ? x.toLowerCase() : x;
}; // proba `python -c "import pytest"` — brak binarki konczy sie od razu (ENOENT)
const GIT_TIMEOUT_MS = 15000;
// Budzet CALEGO hooka (settings.json: timeout 170 s). 4 repo x (tsc 90 s + testy 55 s) przekraczalo go i Claude Code
// zabijal hook = niedeterministyczny fail-open (design review 2026-09-26). Po budzecie — jawny skip w logu.
const STOP_BUDGET_MS = 140000;
const STARTED_AT = Date.now();
const budgetLeft = () => STOP_BUDGET_MS - (Date.now() - STARTED_AT);
const TEST_CMD_RX = /\b(npm (run )?test|pnpm (run )?test|yarn test|npx (--no-install )?(vitest|jest|playwright test)|vitest( run)?|jest|pytest|python -m pytest|node [^\s]*test[\w_-]*\.js)\b/;
const nudgesOut = []; // #6: komunikaty dla uzytkownika (stdout JSON systemMessage), nie stderr, ktory przy exit 0 ginie w debug logu
const REVIEWER_RX = /reviewer|verifier/i;
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'mcp__desktop-commander__write_file', 'mcp__desktop-commander__edit_block']);
const TEST_FILE_RX = /(\.(test|spec)\.|_test\.|test_[^/\\]*\.py|[\/\\]tests?[\/\\]|[\/\\]e2e[\/\\])/;
const SQL_FILE_RX = /\.sql$/i;
const TEMPLATE_TEST = path.join('src', 'test', 'example.test.ts');

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
  // Pierwsza linia = kontrakt dla testow/telemetrii (`STOP ZABLOKOWANY [reason] w repo:`); angielska linia osobno na koncu.
  process.stderr.write(`STOP ZABLOKOWANY [${reason}] w ${repo}:\n${message}\n(EN: STOP BLOCKED — the session cannot close until this is fixed; reason ${reason}; procedure: ~/.claude/pg/dod.md)\n`);
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

// Katalog przebiegu pg-review z komendy `node .../pg-aggregate.js "<dir>"` (tylko sciezka literalna — `$RUN` nie przetrwa
// miedzy wywolaniami Bash). stop-gate czyta z niego aggregated.json (#1: INCOMPLETE nie moze przejsc jako „review zrobione").
// Przekierowanie do %TEMP%//tmp//dev/null (log skryptu, `2>&1`) to nie edycja kodu. Bez tego `> $TEMP/ship.log`
// unieważniało reczny przebieg testow i stop-gate zadal go w kolko (sesja 2026-09-26).
const REDIRECT_RX = /(\d?>{1,2}&?\s*)(["']?)([^\s"'|&;<>]+)\2/g;
function withoutTempRedirects(command) {
  return String(command).replace(REDIRECT_RX, (m, op, q, target) => {
    if (/&$/.test(op.trim()) || /^\d+$/.test(target)) return ' '; // 2>&1
    const t = target.replace(/^\$\{?(TEMP|TMP|TMPDIR)\}?|^%(TEMP|TMP)%|^\$env:(TEMP|TMP)/i, os.tmpdir());
    return isTempPath(t) ? ' ' : m;
  });
}
const AGGREGATE_DIR_RX =/pg-aggregate\.js["']?\s+(?:"([^"$]+)"|'([^'$]+)'|([^\s"'$;&|]+))/;

async function parseTranscript(transcriptPath) {
  const result = { available: false, editedFiles: [], editsAfterReview: 0, reviewerRan: false, reviewersRan: new Set(),
    startedAt: null, t3EditAfterReview: false, aggregateRuns: [], testRunAfterEdit: false, lastAssistantText: '' };
  if (!transcriptPath || !fs.existsSync(transcriptPath)) return result;
  result.available = true;
  const onEdit = (file) => {
    result.editsAfterReview++;
    result.testRunAfterEdit = false;
    for (const run of result.aggregateRuns) run.editsAfter++;
    if (file && T3_PATH_RX.test(String(file).replace(/\\/g, '/'))) result.t3EditAfterReview = true;
  };
  const rl = readline.createInterface({ input: fs.createReadStream(transcriptPath, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of rl) {
    const hasTool = line.includes('"tool_use"');
    if (!hasTool && !(line.includes('"assistant"') && line.includes('"text"')) && result.startedAt) continue;
    let entry;
    try { entry = JSON.parse(line); } catch (e) { continue; }
    if (!result.startedAt && entry.timestamp) result.startedAt = Date.parse(entry.timestamp) || null;
    if (entry.isSidechain) continue;
    const content = (entry.message && entry.message.content) || [];
    if (entry.type === 'assistant' && Array.isArray(content)) {
      const text = content.filter((b) => b && b.type === 'text').map((b) => b.text).join('\n');
      if (text.trim()) result.lastAssistantText = text;
    }
    if (!hasTool) continue;
    for (const block of content) {
      if (!block || block.type !== 'tool_use') continue;
      const toolInput = block.input || {};
      if (EDIT_TOOLS.has(block.name)) {
        const file = toolInput.file_path || toolInput.path || toolInput.notebook_path;
        if (file) result.editedFiles.push(file);
        onEdit(file);
      } else if (/^(Bash|PowerShell)$/.test(block.name)) {
        const command = String(toolInput.command || '');
        if (WRITE_COMMAND_RX.test(withoutTempRedirects(command))) onEdit(null);
        if (TEST_CMD_RX.test(command)) result.testRunAfterEdit = true;
        const agg = AGGREGATE_DIR_RX.exec(command);
        if (agg) result.aggregateRuns.push({ dir: agg[1] || agg[2] || agg[3], editsAfter: 0 });
      } else if (block.name === 'Agent') {
        const role = reviewerRoleOf(toolInput);
        if (role) { result.reviewerRan = true; result.reviewersRan.add(role); result.editsAfterReview = 0; result.t3EditAfterReview = false; }
      }
    }
  }
  return result;
}

// Commity zrobione W TEJ SESJI (reflog HEAD: wpisy `commit*` od startu transkryptu). #14: „commit przed Stop" zdejmowal
// T3, bo stop-gate widzial tylko brudne drzewo. Reflog, nie `git log --since` — pull/merge z origin to nie praca sesji.
function sessionCommitFiles(root, startedAt) {
  if (!startedAt) return { files: [], lines: 0, shas: [] };
  // ops-review 2026-09-26: do 30 x `git show` bez sprawdzenia budzetu mogl przekroczyc timeout hooka.
  if (budgetLeft() < 30000) { log({ hook: HOOK, event: 'skipped', reason: 'stop budget (commity sesji)', target: root }); return { files: [], lines: 0, shas: [] }; }
  const r = sh('git log -g --date=unix --format=%gd%x09%H%x09%gs -n 200 HEAD', root, GIT_TIMEOUT_MS);
  if (!r.ok) return { files: [], lines: 0, shas: [] };
  const shas = [];
  for (const line of r.out.split('\n')) {
    const m = /^HEAD@\{(\d+)\}\t([0-9a-f]{7,40})\t(.*)$/.exec(line.trim());
    if (m && Number(m[1]) * 1000 >= startedAt && /^commit( \((amend|initial)\))?:/.test(m[3])) shas.push(m[2]);
  }
  const files = new Set();
  let lines = 0;
  for (const sha of shas.slice(0, 30)) {
    if (budgetLeft() < 25000) { log({ hook: HOOK, event: 'skipped', reason: 'stop budget (git show)', target: root }); break; }
    const show = sh(`git show --numstat --format= ${sha}`, root, GIT_TIMEOUT_MS);
    if (!show.ok) continue;
    for (const l of show.out.split('\n')) {
      const m = /^(\d+|-)\s+(\d+|-)\s+(.+)$/.exec(l.trim());
      if (!m) continue;
      lines += (Number(m[1]) || 0) + (Number(m[2]) || 0);
      files.add(path.join(root, m[3]));
    }
  }
  return { files: [...files], lines, shas: shas.slice(0, 30) };
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
// Werdykt z KODU WYJSCIA (landscape #2): wczesniej ETIMEDOUT i `No module named` (ImportError w tescie!) dawaly „skipped",
// a `--passWithNoTests` zamienial zero wykonanych testow w zielone. Teraz:
//  - brak samego narzedzia = skip w logu (fail-open na srodowisko) — rozpoznany SYGNALEM, nie trescia wyjscia:
//    pytest = proba `import pytest` nie powiodla sie dla python i python3; JS = kod 127 (sh: komenda nie istnieje)
//    albo 9009 (cmd.exe). Tresc (`ENOENT`, `command not found`) wypisana przez CZERWONY test dawala wczesniej skip
//    (security + data review 2026-09-28),
//  - timeout = blok, CHYBA ze agent sam uruchomil testy po ostatniej edycji (wtedy would_block: suita > 55 s nie moze
//    blokowac kazdego Stop do konca zycia repo — design review 2026-09-26),
//  - kazdy inny exit != 0 (takze import error, 0 testow) = czerwone.
const isTimeout = (t) => /ETIMEDOUT|SIGTERM/.test(String(t.msg || '')) || t.status === null;
function testVerdict(t, root, label, transcript) {
  if (!t || t.ok) return null;
  if (isTimeout(t) && t.probe) {
    // Zawiesila sie sama proba `python -c "import pytest"` (limit PY_PROBE_MS), nie testy — osobny komunikat (code-review 2026-09-28).
    return `Proba narzedzia testow (${label}: \`npm --version\` / \`python -c "import pytest"\`) nie skonczyla sie w ${PY_PROBE_MS / 1000} s — srodowisko wisi. Uruchom testy sam (pelny wynik, exit code) PO ostatniej edycji.`;
  }
  if (isTimeout(t)) {
    if (transcript.testRunAfterEdit) { log({ hook: HOOK, event: 'would_block', reason: `${label} timeout ${TEST_TIMEOUT_MS / 1000}s (testy uruchomione recznie po edycji)`, target: root }); return null; }
    return `Testy (${label}) nie skonczyly sie w ${TEST_TIMEOUT_MS / 1000} s. Uruchom je sam (pelny wynik, exit code) PO ostatniej edycji — wtedy bramka przyjmie Twoj przebieg.`;
  }
  if (t.toolAbsent) {
    // Pominiecie widoczne dla uzytkownika, nie tylko w logu (security-review 2026-09-28).
    log({ hook: HOOK, event: 'skipped', reason: `${label}: narzedzie niedostepne`, target: root });
    nudgesOut.push(`[stop-gate] Testy ${label} NIE zostaly uruchomione w ${path.basename(root)}: brak narzedzia (${String(t.out || '').slice(0, 80)}).`);
    return null;
  }
  return failureReport(t);
}
// Zwraca opis czerwonych testow albo null (zielone / brak testow / srodowisko).
function runTests(root, changed, transcript) {
  const changedJs = changed.some((f) => /\.(ts|tsx|js|jsx|mts|cts|mjs|cjs)$/.test(f));
  const changedPy = changed.some((f) => /\.py$/.test(f));
  const pkg = readPkg(root);
  if (changedJs && !pkg) log({ hook: HOOK, event: 'skipped', reason: 'no package.json (tests)', target: root });
  if (changedPy && !hasPytestConfig(root, changed)) log({ hook: HOOK, event: 'skipped', reason: 'no pytest config', target: root });
  if (changedJs && pkg) {
    let t = null;
    if (budgetLeft() < TEST_TIMEOUT_MS + PY_PROBE_MS) log({ hook: HOOK, event: 'skipped', reason: 'stop budget (testy JS)', target: root });
    // Obecnosc npm sprawdzona PROBA przed testami — kod wyjscia testu (tez 127) jest zawsze werdyktem (review 2026-09-28).
    else if (pkg.scripts && pkg.scripts.test) {
      const npmProbe = sh('npm --version', root, PY_PROBE_MS);
      // Zawieszona proba = sciezka timeoutu (blok), jak przy Pythonie — nie cichy skip (security-review 2026-09-28).
      t = npmProbe.ok ? sh('npm test --silent', root, TEST_TIMEOUT_MS)
        : isTimeout(npmProbe) ? Object.assign({}, npmProbe, { probe: true }) : { ok: false, status: 127, toolAbsent: true, out: 'npm niedostepny' };
    }
    else if (hasBin(root, 'vitest')) t = sh('npx --no-install vitest run', root, TEST_TIMEOUT_MS);
    else log({ hook: HOOK, event: 'skipped', reason: 'no test script / vitest', target: root });
    const bad = testVerdict(t, root, 'JS', transcript);
    if (bad) return bad;
  }
  if (changedPy && hasPytestConfig(root, changed)) {
    // Rezerwa = testy + dwie proby na interpreter (`--version` i find_spec) dla python i python3.
    if (budgetLeft() < TEST_TIMEOUT_MS + 4 * PY_PROBE_MS) { log({ hook: HOOK, event: 'skipped', reason: 'stop budget (pytest)', target: root }); return null; }
    // Jedna proba na interpreter, PRZED testami (tresc testow nie wybiera interpretera — data-review 2026-09-27):
    // importlib.util.find_spec z tym samym sys.path co `python -m pytest` (cwd repo na poczatku) mowi, SKAD bylby ladowany
    // pytest i _pytest, NIE wykonujac kodu z repo — podrobiony `__file__` i sys.exit(0) przy imporcie nic nie daja
    // (security + data + code + ops review 2026-09-28).
    //  - modul z repo poza site-packages/dist-packages = podmiana -> blokada, takze gdy prawdziwego pytesta brak,
    //  - .venv wewnatrz repo (site-packages) to legalny pytest,
    //  - oba znalezione = ten interpreter uruchamia testy; brak w obu = skip widoczny dla uzytkownika; timeout = blok.
    // Kolejnosc ma znaczenie (data-review 2026-09-28): najpierw WYJMUJEMY katalog repo z sys.path, potem importujemy
    // importlib.util (plik importlib.py w repo nie wykona sie), dopiero potem wracamy z '' dla find_spec — ten sam
    // wynik co `python -m pytest`. `sys` jest wbudowany, nie da sie go podmienic. stdout w UTF-8 (sciezki z „ł").
    const specPy = 'import sys;sys.path.pop(0);sys.stdout.reconfigure(encoding=\'utf-8\');import importlib.util as u;sys.path.insert(0,\'\');[print(\'ORIGIN\', m, getattr(u.find_spec(m), \'origin\', None) or \'\') for m in (\'pytest\', \'_pytest\')]';
    const realRoot = realLower(root);
    // Sciezke modulu porownujemy BEZ rozwijania linkow (junction `pytest/` w repo wskazujacy na site-packages to nadal
    // kod z repo — security-review 2026-09-28); realpath tylko dla roota, zeby nazwy 8.3 roota sie zgadzaly.
    const plainRoot = path.resolve(root).replace(/\\/g, '/').replace(/\/+$/, '');
    const norm = (x) => (process.platform === 'win32' ? x.toLowerCase() : x);
    const inRepoCode = (f) => {
      const r = norm(path.resolve(root, f).replace(/\\/g, '/'));
      return (r.startsWith(realRoot + '/') || r.startsWith(norm(plainRoot) + '/')) && !/\/(site|dist)-packages\//.test(r);
    };
    let py = null;
    let probeTimeout = null;
    let shadow = '';
    for (const p of ['python', 'python3']) {
      // Istnienie interpretera: `--version` nie wykonuje zadnego kodu. Na Windows brak komendy daje exit 1 (nie 127),
      // wiec rozrozniamy „nie ma pythona" od „proba padla" wlasnie ta druga proba (data-review 2026-09-28).
      const ver = sh(`${p} --version`, root, PY_PROBE_MS);
      if (isTimeout(ver)) { probeTimeout = probeTimeout || Object.assign({}, ver, { probe: true }); continue; }
      if (!ver.ok) continue; // brak tego interpretera
      const r = sh(`${p} -c "${specPy}"`, root, PY_PROBE_MS);
      if (isTimeout(r)) { probeTimeout = probeTimeout || Object.assign({}, r, { probe: true }); continue; }
      // Interpreter jest, a proba padla albo nie wypisala obu linii = nie wiemy, skad bylby pytest -> blokada, nie skip.
      if (!r.ok || !/^ORIGIN pytest/m.test(r.out || '') || !/^ORIGIN _pytest/m.test(r.out || '')) {
        return `Proba pochodzenia pytesta (${p}) nie dala wyniku (exit ${r.status}): ${String(r.out || r.msg || '').trim().split(/\r?\n/).pop().slice(0, 120)} — nie da sie potwierdzic, ze testy uruchomia prawdziwego pytesta.`;
      }
      const origins = {};
      for (const line of String(r.out || '').split(/\r?\n/)) { const m = /^ORIGIN (\S+) ?(.*)$/.exec(line.trim()); if (m) origins[m[1]] = m[2].trim(); }
      const local = ['pytest', '_pytest'].map((m) => origins[m]).filter((o) => o && inRepoCode(o));
      if (local.length) { shadow = local[0]; break; }
      if (origins.pytest && origins._pytest) { py = p; break; }
    }
    if (shadow) return `pytest ladowany z repo (${shadow.slice(-100)}) — plik w repo zaslania prawdziwego pytesta, wynik testow nie jest wiarygodny. Zmien nazwe tego pliku.`;
    // Testy przez wrapper, nie `-m pytest`: runpy/importlib i sam pytest z zaleznosciami laduja sie z repo WYJETYM z sys.path,
    // dopiero potem wraca '' (importy projektu w testach dzialaja jak przy -m). Plik importlib.py w repo z exit(0)
    // zamienial czerwone testy w zielone (test 2026-09-28).
    const runPy = 'import sys;sys.path.pop(0);import pytest;sys.path.insert(0,\'\');sys.exit(pytest.main([\'-q\',\'-x\',\'-p\',\'no:cacheprovider\']))';
    const t = py ? sh(`${py} -c "${runPy}"`, root, TEST_TIMEOUT_MS)
      : probeTimeout || { ok: false, status: 127, toolAbsent: true, out: 'No module named pytest (ani python, ani python3)' };
    const bad = testVerdict(t, root, 'pytest', transcript);
    if (bad) return bad;
  }
  return null;
}

// Ostrzezenia (nie blokady) z gap-analizy 2026-09-12 (slownik SH): dev na produkcyjnej bazie; UI zmienione, a QA na zadanie.
const ENV_REF_GATE = path.join(__dirname, '..', 'bin', 'env-ref-gate.js');
const QA_PATHS_DOC = path.join('docs', 'CRITICAL-PATHS.md');
const UI_CHANGE_RX = /\.(tsx|jsx|vue|svelte)$|[\/\\](routes?|pages|app)[\/\\]|supabase[\/\\]functions/i;

function nudges(root, changed) {
  if (!changed.some((f) => TEST_FILE_RX.test(f))) {
    nudgesOut.push('[stop-gate] Uwaga: zmieniono kod bez zmiany testow. Nowa logika => dopisz test (DoD). Refaktor/config => zignoruj.');
  }
  if (fs.existsSync(ENV_REF_GATE)) {
    // execFileSync (tablica argumentow), nie string powloki: sciezka repo z metaznakami nie moze stac sie komenda
    // (security-reviewer 2026-09-12: SHELL-STRING-INTERPOLATION).
    const env = spawnSync(process.execPath, [ENV_REF_GATE, '--repo', root], { cwd: root, encoding: 'utf8', timeout: GIT_TIMEOUT_MS, env: CHILD_ENV });
    if (env.status === 1) nudgesOut.push('[stop-gate] DEV NA PRODZIE: lokalny .env wskazuje na produkcyjny ref Supabase (PRR P15). Przelacz na staging/branch albo zadeklaruj `pg.single_env: true` z powodem w CLAUDE.md.\n' + String(env.stdout || '').split('\n').slice(0, 4).join('\n'));
  }
  if (changed.some((f) => UI_CHANGE_RX.test(f)) && fs.existsSync(path.join(root, QA_PATHS_DOC))) {
    nudgesOut.push('[stop-gate] UI/route/edge fn zmienione i docs/CRITICAL-PATHS.md istnieje -> sciezki krytyczne na instancjach: `node ~/.claude/bin/qa-matrix.js --repo . --base-url <url>` albo dzial qa-reviewer (pg-review 1b). Na T3 z linia `pg.qa_url: <url>` w CLAUDE.md qa-reviewer staje sie WYMAGANY (narada D-2026-09-12, opcja C); bez niej = ostrzezenie.');
  }
  if (fs.existsSync(path.join(root, TEMPLATE_TEST))) {
    const list = sh('git ls-files -- "*.test.ts" "*.test.tsx" "*.spec.ts" "*.spec.tsx"', root, GIT_TIMEOUT_MS);
    const real = (list.out || '').split('\n').map((s) => s.trim()).filter((s) => s && !/src\/test\/example\.test\.ts$/.test(s) && !/^e2e\//.test(s));
    if (!real.length) nudgesOut.push('[stop-gate] Uwaga: jedyny test jednostkowy to szablonowy src/test/example.test.ts — bramka testow pilnuje niczego.');
  }
}

// Tier T0..T3 z lib/risk-tier.js (sciezki + rozmiar diffu). T0/T1 nie wymagaja recenzji przy Stop
// (T1 = code-reviewer zalecany, ale blokujemy dopiero od T2 — proporcjonalnosc, nie paraliz).
function reviewRequirement(root, changedCode, extraLines, sessionShas) {
  const lines = changedLineCount(root, changedCode) + (extraLines || 0);
  const verdict = classify(changedCode, lines, root);
  // N1 (OBSERVE): tier z TRESCI dodanych linii (platnosci/service_role/DDL) — najpierw zbieramy FP, bez blokady.
  // Takze tresc commitow z tej sesji (code-review 2026-09-26: bez nich N1 byl slepy na to samo, co #14 zamknal dla sciezek).
  if (verdict.tier !== 'T3' && budgetLeft() > 20000) {
    const diffs = [sh('git diff HEAD -U0', root, GIT_TIMEOUT_MS), ...(sessionShas || []).slice(0, 10).map((sha) => sh(`git show -U0 --format= ${sha}`, root, GIT_TIMEOUT_MS))];
    const added = diffs.filter((d) => d.ok).map((d) => d.out).join('\n').split('\n').filter((l) => /^\+(?!\+\+)/.test(l)).join('\n').slice(0, 400000);
    const hit = contentEscalation(added);
    if (hit) log({ hook: HOOK, event: 'would_block', reason: `tier-content: ${verdict.tier} -> T3 (${hit})`, target: root });
  }
  // Sufit z pg.phase zostawia slad w telemetrii — obnizenie wymagan przez tresc repo ma byc widoczne, nie ciche.
  if (verdict.phaseCapped) log({ hook: HOOK, event: 'skipped', reason: `review cap: pg.phase ${verdict.phase} -> ${verdict.tier}`, target: root });
  if (verdict.tier === 'T0' || verdict.tier === 'T1') return null;
  const list = verdict.reviewers.map((r) => `${r} (${modelFor(r, verdict.tier)})`).join(', ');
  return { tier: verdict.tier, why: verdict.reasons.join('; '), reviewers: list, required: verdict.reviewers };
}

// #1: ostatni przebieg pg-review z transkryptu. INCOMPLETE = recenzja NIE zrobiona; REQUEST CHANGES bez zadnej edycji
// po agregacji = findings nienaprawione. Brak przebiegu w transkrypcie = dawna regula (role recenzentow).
const sameRepo = (a, b) => path.resolve(a).replace(/\\/g, '/').toLowerCase() === path.resolve(b).replace(/\\/g, '/').toLowerCase();
function readAgg(dir) { try { return JSON.parse(fs.readFileSync(path.join(dir, 'aggregated.json'), 'utf8')); } catch (e) { return null; } }
function aggregateProblem(transcript, requiredAgents, root) {
  if (!VERDICT) {
    log({ hook: HOOK, event: 'skipped', reason: `pg-aggregate.js nie laduje sie: ${aggLoadError}`, target: root });
    return `bin/pg-aggregate.js nie laduje sie (${aggLoadError}) — PG jest uszkodzony; przywroc plik (git -C ~/.claude checkout bin/pg-aggregate.js za fraza uzytkownika) i sprawdz pieczec`;
  }
  // Najnowsza agregacja TEGO repo (pole `repo` z --repo). Agregacje bez pola `repo` licza sie dla kazdego repo (dawne
  // przebiegi); z innym `repo` — pomijane (sesja 2026-09-26: ping-pong blokad miedzy ~/.claude a demo-site).
  const runs = [...transcript.aggregateRuns].reverse().filter((r) => fs.existsSync(path.join(r.dir, 'aggregated.json')));
  const run = runs.find((r) => { const a = readAgg(r.dir); return a && a.repo && sameRepo(a.repo, root); }) ||
    runs.find((r) => { const a = readAgg(r.dir); return a && !a.repo; });
  if (!run) return null;
  const agg = readAgg(run.dir);
  if (!agg) return `aggregated.json w ${run.dir} nieczytelny`;
  if (agg.verdict === VERDICT.INCOMPLETE) return `ostatnia agregacja (${run.dir}) = INCOMPLETE: ${(agg.incomplete || []).join('; ')}`;
  // Agregacja bez --tier nie sprawdza rol (data-review 2026-09-26: sam findings.code.json = APPROVE przy T3). Role wymagane
  // przez tier z DIFFU musza byc w agregacji niezaleznie od flag, z jakimi ja uruchomiono.
  const roles = new Set(agg.roles || []);
  const missingRoles = (requiredAgents || []).map((a) => String(a).replace(/-reviewer$/, '')).filter((r) => !roles.has(r));
  if (missingRoles.length) return `ostatnia agregacja (${run.dir}) nie zawiera rol wymaganych przez tier: ${missingRoles.join(', ')}`;
  if (agg.verdict === VERDICT.REQUEST_CHANGES && run.editsAfter === 0) return `ostatnia agregacja (${run.dir}) = REQUEST CHANGES, a po niej nie bylo zadnej poprawki (blocker ${agg.stats && agg.stats.blocker}, must_fix ${agg.stats && agg.stats.must_fix})`;
  return null;
}

// #18 (OBSERVE): twierdzenia z ostatniej wiadomosci vs stan. Tylko would_block — enforce po tygodniu danych (#20).
function observeClaims(transcript, repos) {
  const text = transcript.lastAssistantText || '';
  if (/\b(testy (przechodza|przeszly|zielone|OK)|tests? (pass|passed|green)|wszystkie (testy )?OK|all tests pass)/i.test(text) && !transcript.testRunAfterEdit && transcript.editsAfterReview > 0) {
    log({ hook: HOOK, event: 'would_block', reason: 'claim: "testy przechodza" bez uruchomienia testow po ostatniej edycji', target: repos.join(';') });
  }
  if (/\b(wypchni\w*|spushowa\w*|pushed|pushniet\w*)\b/i.test(text)) {
    for (const root of repos) {
      const st = sh('git status -sb', root, GIT_TIMEOUT_MS);
      if (st.ok && /\[ahead \d+/.test(st.out.split('\n')[0])) log({ hook: HOOK, event: 'would_block', reason: 'claim: "wypchniete" przy ahead > 0', target: root });
    }
  }
}

function emitNudges() {
  if (!nudgesOut.length) return;
  process.stdout.write(JSON.stringify({ systemMessage: nudgesOut.join('\n') }) + '\n');
}

async function main() {
  if (state.reasons.length >= MAX_BLOCKS_PER_CYCLE) {
    clearState();
    // #17: po limicie NIE zwalniamy po cichu — uzytkownik dostaje komunikat, co zostalo niezalatwione.
    log({ hook: HOOK, event: 'skipped', reason: `max ${MAX_BLOCKS_PER_CYCLE} blocks reached: ${state.reasons.join(',')}`, target: cwd });
    nudgesOut.push(`[stop-gate] LIMIT ${MAX_BLOCKS_PER_CYCLE} blokad w tym cyklu — sesja konczy sie mimo niezalatwionych bramek: ${state.reasons.join(', ')}. Sprawdz recznie albo popros o dokonczenie.`);
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
    // #14: pliki commitow z tej sesji licza sie do TIERU (nie do lintu — ten zrobil pre-commit).
    const committed = transcript.available ? sessionCommitFiles(root, transcript.startedAt) : { files: [], lines: 0 };
    const committedCode = committed.files.filter((f) => (isCodeFile(f) || SQL_FILE_RX.test(f)) && !changedCode.includes(f));
    if (!changedCode.length && !committedCode.length) continue;
    touched++;

    if (changedCode.length && !alreadyBlocked('lint', root)) {
      if (budgetLeft() < 20000) log({ hook: HOOK, event: 'skipped', reason: 'stop budget (lint)', target: root });
      else {
        const lint = lintFiles(changedCode.filter(isCodeFile).slice(0, MAX_LINT_FILES), { hook: HOOK });
        if (lint) block('lint', root, lint.header + '\n' + lint.out);
      }
    }
    if (changedCode.length && !alreadyBlocked('testy', root)) {
      const failed = runTests(root, changed, transcript);
      if (failed) block('testy', root, 'Testy nie przechodza. Napraw je, dopiero potem koncz:\n' + failed);
    }
    if (!alreadyBlocked('review', root) && transcript.available) {
      const need = reviewRequirement(root, [...changedCode, ...committedCode], committed.lines, committed.shas);
      // Kazdy WYMAGANY dzial musial sie odpalic (nie: jakikolwiek recenzent) — narada 2026-09-12, fakt code-reviewera.
      const missing = need ? need.required.filter((r) => !transcript.reviewersRan.has(r)) : [];
      // #14: edycja sciezki T3 PO ostatnim review = review ponownie (budzet 8 edycji dotyczy reszty).
      const t3Stale = need && need.tier === 'T3' && transcript.t3EditAfterReview;
      const reviewed = transcript.reviewerRan && transcript.editsAfterReview <= POST_REVIEW_EDIT_BUDGET && missing.length === 0 && !t3Stale;
      if (need && !reviewed) block('review', root,
        `Zmiana ${need.tier} (${need.why}) bez pelnej recenzji dzialowej. Wymagani recenzenci: ${need.reviewers}. ` +
        (missing.length && transcript.reviewerRan ? `BRAKUJE: ${missing.join(', ')} (odpalono: ${[...transcript.reviewersRan].join(', ') || 'nikogo'}). ` : '') +
        (t3Stale ? 'Plik ze sciezki T3 zmieniony PO ostatnim review — review musi objac aktualny stan. ' : '') +
        'Odpal skill pg-review (finderzy rownolegle, swiezy kontekst, read-only -> agregacja -> weryfikator), ' +
        'napraw findings w tej samej turze, potem zakoncz. Procedura: ~/.claude/pg/dod.md. Bramka, nie proza (7L).');
      const aggProblem = need ? aggregateProblem(transcript, need.required.filter((r) => /reviewer$/.test(r)), root) : null;
      if (aggProblem) block('review', root, `Recenzja dzialowa niedomknieta: ${aggProblem}. Dopusc brakujace dzialy / napraw findings i zagreguj ponownie (--tier ${need.tier} --final).`);
    }
    nudges(root, changed);
  }
  observeClaims(transcript, repos);
  clearState();
  log({ hook: HOOK, event: 'ran', reason: `${touched}/${repos.length} repos with code changes`, target: repos.join(';') });
}

main().then(() => { emitNudges(); process.exit(0); }).catch((e) => {
  log({ hook: HOOK, event: 'skipped', reason: 'internal error: ' + String(e && e.message || e).slice(0, 120), target: cwd });
  process.exit(0);
});

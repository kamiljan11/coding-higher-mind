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
const { parseUnifiedDiff, archSignals, hasAdr } = require('./lib/arch-signals');

const HOOK = 'stop-gate';
const MAX_REPOS = 4;
const BLOCK_REASONS = 4; // lint, testy, review, arch
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

// --- znacznik „juz zgloszone" per sesja x repo (fix petli 2026-10-01) ---
// Sesja wielodniowa/wielorepo: repo z dawnych edycji + commity od STARTU sesji + cudze niezacommitowane zmiany
// blokowaly kazdy Stop od nowa (limit blokad czyscil stan, nastepna tura zaczynala od zera — petla bez konca).
// Gdy zgloszone repo przechodzi (anty-petla) albo limit sie wyczerpie, zapisujemy per repo: czas + odcisk drzewa. Nastepny Stop
// liczy tylko commity PO znaczniku, a niezacommitowane zmiany tylko gdy drzewo zmienilo sie od znacznika.
// Nowa praca = nowy commit albo zmiana drzewa => bramka dziala jak dotad; to samo znalezisko nie wraca w kolko.
// v2 (pg-review 2026-10-01): znacznik w ~/.claude/logs (warstwa kontrolna — agent nie podrobi go bez frazy; %TEMP% mogl),
// odcisk z TRESCI (diff + zawartosc nieśledzonych plikow), powody zapisane i przepuszczenie zglaszane uzytkownikowi.
const WM_DIR = process.env.PG_STOP_WM_DIR || path.join(os.homedir(), '.claude', 'logs', 'stop-gate-wm');
const watermarkPath = path.join(WM_DIR, crypto.createHash('sha256').update(String(input.session_id || cwd)).digest('hex').slice(0, 32) + '.json');
function readWatermarks() {
  try {
    const w = JSON.parse(fs.readFileSync(watermarkPath, 'utf8'));
    if (!w || typeof w !== 'object') return {};
    // Znacznik z przyszlosci (podrobiony) wycinalby commity sesji z tieru — taki wpis odrzucamy (security-review v2).
    for (const k of Object.keys(w)) if (!w[k] || typeof w[k].ts !== 'number' || w[k].ts > Date.now() + 60000) delete w[k];
    return w;
  } catch (e) { return {}; }
}
const watermarks = readWatermarks();
const UNTRACKED_HASH_MAX = 500; // plikow; wiecej = odcisk zawsze nowy (wolimy ponowne sprawdzenie niz slepy znacznik)
// Do 20 MB tresc; wieksze = rozmiar+mtime (znana granica: `touch -r` po podmianie — pg/known-limits.md).
const UNTRACKED_FULL_BYTES = 20 * 1024 * 1024;
// 2026-10-04: odcisk TYLKO z plikow tej sesji (`owned`). Wczesniej cudzy nieśledzony plik zmienial odcisk, znacznik gasl
// i blokada wracala za stare commity sesji — ta sama petla, ktora ownedBy mial zamknac (finding laptop 2026-10-02).
// Tresc kazdego wlasnego zmienionego pliku (sledzonego i nie) idzie do hasha — podmiana o tej samej dlugosci dalej widoczna.
function treeFingerprint(root, owned) {
  const h = crypto.createHash('sha256');
  const keep = owned || (() => true);
  // Czytanie tresci plikow kosztuje: przy malym budzecie odcisk jednorazowy (= ponowne sprawdzenie, bezpieczny kierunek).
  if (budgetLeft() < 20000) return 'niepewny-' + crypto.randomBytes(8).toString('hex');
  const st = sh('git -c core.quotePath=false status --porcelain --untracked-files=all', root, GIT_TIMEOUT_MS);
  const head = sh('git rev-parse HEAD', root, GIT_TIMEOUT_MS);
  // Kazdy blad gita = odcisk jednorazowy: wolimy ponowne sprawdzenie niz znacznik na niepelnych danych.
  if (![st, head].every((r) => r.ok)) return 'niepewny-' + crypto.randomBytes(8).toString('hex');
  const entries = [];
  for (const line of st.out.split('\n')) {
    if (!line.trim()) continue;
    let rel = line.slice(3).trim();
    if (rel.includes(' -> ')) rel = rel.split(' -> ').pop();
    rel = rel.replace(/^"|"$/g, '');
    if (keep(path.join(root, rel))) entries.push({ line, rel, deleted: /^(.D|D)/.test(line) });
  }
  if (entries.length > UNTRACKED_HASH_MAX) return 'niepewny-' + crypto.randomBytes(8).toString('hex');
  h.update(head.out + '\n');
  for (const e of entries.sort((a, b) => a.rel.localeCompare(b.rel))) {
    h.update(e.line + '\0');
    if (e.deleted) continue;
    try {
      const p = path.join(root, e.rel);
      const s = fs.statSync(p);
      // Duzy plik: rozmiar + mtime zamiast tresci (hook Stop nie moze czytac GB); podmiana tresci zmienia mtime.
      h.update(s.size > UNTRACKED_FULL_BYTES ? `${s.size}:${s.mtimeMs}` : s.isFile() ? fs.readFileSync(p) : 'katalog');
    } catch (err) { h.update(e.rel + ':nieczytelny'); }
  }
  return h.digest('hex');
}
function saveWatermarks(roots, reasons, ownedFor) {
  if (!roots.length) return;
  const now = Date.now();
  for (const root of roots) watermarks[root] = { ts: now, tree: treeFingerprint(root, ownedFor && ownedFor(root)), reasons: reasons.filter((r) => String(r).endsWith('@' + root)) };
  try { fs.mkdirSync(WM_DIR, { recursive: true }); fs.writeFileSync(watermarkPath, JSON.stringify(watermarks)); } catch (e) {
    log({ hook: HOOK, event: 'error', reason: `watermark write failed: ${e.message}`, target: watermarkPath });
  }
}
const reposFromReasons = (reasons) => [...new Set(reasons.map((r) => String(r).split('@').slice(1).join('@')).filter(Boolean))];

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
// realpath: Windows ma dwie formy tej samej sciezki (8.3 `USERNA~1` z %TEMP% vs `<owner>` z gita).
const normPath = (p) => {
  let r = path.resolve(String(p));
  try { r = fs.realpathSync.native(r); } catch (e) { /* plik usuniety — zostaje forma rozwiazana */ }
  return r.replace(/\\/g, '/').toLowerCase();
};
// Plik „nalezy do tej sesji", gdy sesja go edytowala (Edit/Write) albo jego sciezka padla w jej komendzie Bash/PowerShell
// (sed, python write, git add). Niezacommitowane pliki, ktorych sesja nigdy nie dotknela, to praca innej sesji w tym samym
// repo — logujemy je (`foreign`), ale nie lintujemy/testujemy/recenzujemy za nie tej sesji (petla 2026-10-01/02).
// Nadmiar (komenda tylko czytajaca plik) liczy plik jako wlasny — bezpieczny kierunek bledu.
function ownedBy(transcript, root) {
  const edited = new Set(transcript.editedFiles.map(normPath));
  const blob = transcript.commandText;
  return (abs) => {
    const n = normPath(abs);
    if (edited.has(n)) return true;
    const rel = path.relative(root, abs).replace(/\\/g, '/').toLowerCase();
    return blob.includes(n) || (rel.length > 3 && blob.includes(rel));
  };
}
function changedFiles(root) {
  const r = sh('git -c core.quotePath=false status --porcelain --untracked-files=all', root, GIT_TIMEOUT_MS);
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
// Linie liczone TYLKO dla podanych plikow (2026-10-02): wczesniej argument byl ignorowany i do progu T3 wchodzily
// niezacommitowane zmiany innych sesji w tym samym repo (~/.claude: 2753 linii cudzej pracy = petla blokad).
function changedLineCount(root, files) {
  let total = 0;
  const want = new Set((files || []).map(normPath));
  const numstat = sh('git -c core.quotePath=false diff --no-ext-diff --numstat HEAD', root, GIT_TIMEOUT_MS);
  if (numstat.ok) for (const line of numstat.out.split('\n')) {
    const m = line.match(/^(\d+)\s+(\d+)\s+(.+)$/);
    if (m && want.has(normPath(path.join(root, m[3].trim())))) total += Number(m[1]) + Number(m[2]);
  }
  const untracked = sh('git ls-files --others --exclude-standard', root, GIT_TIMEOUT_MS);
  if (untracked.ok) for (const rel of untracked.out.split('\n').filter(Boolean)) {
    const abs = path.join(root, rel);
    if (!isCodeFile(abs) || !want.has(normPath(abs))) continue;
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

// Narzedzia, ktore koncza prace przed zwroceniem wyniku (okno zamkniete). Wszystko inne (Agent, MCP, nowe) = do konca sesji.
const SYNC_TOOLS = new Set(['Read', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Grep', 'Glob', 'LS', 'WebFetch', 'WebSearch', 'TodoWrite', 'ToolSearch', 'Skill']);

async function parseTranscript(transcriptPath) {
  const result = { available: false, editedFiles: [], editsAfterReview: 0, reviewerRan: false, reviewersRan: new Set(),
    startedAt: null, t3EditAfterReview: false, aggregateRuns: [], testRunAfterEdit: false, lastAssistantText: '', commandText: '',
    skillsRan: new Set(), toolWindows: [] };
  const commands = [];
  const toolStart = new Map();
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
    const hasResult = line.includes('"tool_result"');
    const hasNotice = line.includes('<task-notification>');
    if (!hasTool && !hasResult && !hasNotice && !(line.includes('"assistant"') && line.includes('"text"')) && result.startedAt) continue;
    let entry;
    try { entry = JSON.parse(line); } catch (e) { continue; }
    if (!result.startedAt && entry.timestamp) result.startedAt = Date.parse(entry.timestamp) || null;
    if (entry.isSidechain) continue;
    const content = (entry.message && entry.message.content) || [];
    if (entry.type === 'assistant' && Array.isArray(content)) {
      const text = content.filter((b) => b && b.type === 'text').map((b) => b.text).join('\n');
      if (text.trim()) result.lastAssistantText = text;
    }
    const ts = Date.parse(entry.timestamp || '') || 0;
    // Okna wykonania narzedzi sesji: commit z reflogu liczy sie sesji tylko, gdy powstal w czasie jej narzedzia
    // (2026-10-04: commity rownoleglej sesji w ~/.claude dawaly [review] T3 w sesjach projektowych; atrybucja po slowie
    // „commit" cofnieta, bo agent kontroluje tekst komendy — okno czasu nie zalezy od tresci komendy).
    for (const block of Array.isArray(content) ? content : []) {
      if (block && block.type === 'tool_result' && toolStart.has(block.tool_use_id)) {
        const st = toolStart.get(block.tool_use_id);
        if (st.background) continue;  // tlo: zostaje w toolStart -> okno do konca sesji (dodawane nizej)
        toolStart.delete(block.tool_use_id);
        result.toolWindows.push([st.ts, ts || Infinity]);
      }
    }
    // Zakonczenie narzedzia w tle / asynchronicznego agenta: powiadomienie z jego tool-use-id zamyka okno (ops-review:
    // okna do konca sesji wylaczaly filtr commitow rownoleglej sesji po pierwszej komendzie w tle).
    if (hasNotice && ts) {
      for (const m of line.matchAll(/<tool-use-id>(\w+)<\/tool-use-id>[\s\S]*?<status>(completed|failed|killed|stopped)<\/status>/g)) {
        const st = toolStart.get(m[1]);
        if (st && st.background) { result.toolWindows.push([st.ts, ts]); toolStart.delete(m[1]); }
      }
    }
    if (!hasTool) continue;
    for (const block of content) {
      if (!block || block.type !== 'tool_use') continue;
      const toolInput = block.input || {};
      // Odlaczony proces (`&`, nohup, setsid, disown, at, systemd-run, tmux/screen) moze zrobic commit PO wyniku narzedzia
      // (code-review 2026-10-04) — okno do konca sesji jak dla komend w tle (nadmiar, nie dziura).
      const detached = /(^|[^&])&\s*($|[;)\n])|\b(nohup|setsid|disown|batch|systemd-run|tmux|screen|crontab)\b|(^|[;&|]\s*)at\s/.test(String(toolInput.command || ''));
      // data-review: Agent bywa asynchroniczny bez flagi, terminal MCP oddaje wynik po starcie — okno zamyka tylko allowlista.
      const sync = SYNC_TOOLS.has(block.name) || (/^(Bash|PowerShell)$/.test(block.name) && !toolInput.run_in_background && !detached);
      if (block.id && ts) toolStart.set(block.id, { ts, background: !sync });
      if (EDIT_TOOLS.has(block.name)) {
        const file = toolInput.file_path || toolInput.path || toolInput.notebook_path;
        if (file) result.editedFiles.push(file);
        onEdit(file);
      } else if (/^(Bash|PowerShell)$/.test(block.name)) {
        const command = String(toolInput.command || '');
        commands.push(command.replace(/\\\\?/g, '/').toLowerCase());
        if (WRITE_COMMAND_RX.test(withoutTempRedirects(command))) onEdit(null);
        if (TEST_CMD_RX.test(command)) result.testRunAfterEdit = true;
        const agg = AGGREGATE_DIR_RX.exec(command);
        if (agg) result.aggregateRuns.push({ dir: agg[1] || agg[2] || agg[3], editsAfter: 0 });
      } else if (block.name === 'Agent') {
        const role = reviewerRoleOf(toolInput);
        if (role) { result.reviewerRan = true; result.reviewersRan.add(role); result.editsAfterReview = 0; result.t3EditAfterReview = false; }
      } else if (block.name === 'Skill') {
        result.skillsRan.add(String(toolInput.skill || '').split(':').pop());
      }
    }
  }
  // Narzedzia bez wyniku (trwajace, w tle, przerwane): okno do konca sesji — fail-closed (commit liczy sie sesji).
  for (const st of toolStart.values()) result.toolWindows.push([st.ts, Infinity]);
  result.commandText = commands.join('\n');
  return result;
}

// Commity zrobione W TEJ SESJI (reflog HEAD: wpisy `commit*` od startu transkryptu). #14: „commit przed Stop" zdejmowal
// T3, bo stop-gate widzial tylko brudne drzewo. Reflog, nie `git log --since` — pull/merge z origin to nie praca sesji.
// Okna narzedzi INNYCH sesji (glowne transkrypty w katalogu projektow, zmodyfikowane od `since`) — dowod obcosci commitu.
// Narzedzie bez wyniku w obcej sesji: okno do ostatniej modyfikacji jej pliku (nie Infinity — porzucona sesja nie moze
// „pokrywac" wszystkich pozniejszych commitow).
function foreignWindows(ownPath, since) {
  const out = [];
  const projects = ownPath ? path.dirname(path.dirname(path.resolve(ownPath))) : '';
  if (!projects) return out;
  let files = [];
  for (const dir of safeReaddir(projects)) {
    for (const f of safeReaddir(path.join(projects, dir))) {
      if (!f.endsWith('.jsonl')) continue;
      const full = path.join(projects, dir, f);
      if (path.resolve(full) === path.resolve(ownPath)) continue;
      try { const st = fs.statSync(full); if (st.isFile() && st.mtimeMs >= since) files.push({ full, mtime: st.mtimeMs }); } catch (e) { /* zniknal */ }
    }
  }
  files = files.sort((a, b) => b.mtime - a.mtime).slice(0, 12);
  for (const { full, mtime } of files) {
    if (budgetLeft() < 30000) break;
    const starts = new Map();
    let raw = '';
    try { raw = fs.readFileSync(full, 'utf8'); } catch (e) { continue; }
    for (const line of raw.split('\n')) {
      if (!line.includes('"tool_use"') && !line.includes('"tool_result"')) continue;
      let e;
      try { e = JSON.parse(line); } catch (err) { continue; }
      const ts = Date.parse(e.timestamp || '') || 0;
      for (const b of (e.message && Array.isArray(e.message.content)) ? e.message.content : []) {
        if (b && b.type === 'tool_use' && b.id && ts) starts.set(b.id, ts);
        else if (b && b.type === 'tool_result' && starts.has(b.tool_use_id)) { out.push([starts.get(b.tool_use_id), ts || mtime]); starts.delete(b.tool_use_id); }
      }
    }
    for (const st of starts.values()) out.push([st, mtime]);
  }
  return out;
}

function safeReaddir(dir) { try { return fs.readdirSync(dir); } catch (e) { return []; } }

// Commity zrobione W TEJ SESJI (reflog HEAD od startu transkryptu). Domyslnie KAZDY commit sie liczy (fail-closed).
// Wyklucza sie tylko commit z POZYTYWNYM dowodem obcosci (security-review 2026-10-04): okno narzedzia innej sesji go
// obejmuje, zadne okno tej sesji (async = do konca sesji) nie, a jego czas w reflogu jest monotoniczny wzgledem sasiadow
// (GIT_COMMITTER_DATE podrobiony = niemonotoniczny = liczy sie).
function sessionCommitFiles(root, startedAt, windows, ownPath) {
  if (!startedAt) return { files: [], lines: 0, shas: [] };
  // ops-review 2026-09-26: do 30 x `git show` bez sprawdzenia budzetu mogl przekroczyc timeout hooka.
  if (budgetLeft() < 30000) { log({ hook: HOOK, event: 'skipped', reason: 'stop budget (commity sesji)', target: root }); return { files: [], lines: 0, shas: [] }; }
  const r = sh('git log -g --date=unix --format=%gd%x09%H%x09%gs -n 200 HEAD', root, GIT_TIMEOUT_MS);
  if (!r.ok) return { files: [], lines: 0, shas: [] };
  const entries = [];
  for (const line of r.out.split('\n')) {
    const m = /^HEAD@\{(\d+)\}\t([0-9a-f]{7,40})\t(.*)$/.exec(line.trim());
    if (m) entries.push({ at: Number(m[1]) * 1000, sha: m[2], subject: m[3] });
  }
  // Wpis nalezy do okresu sesji, gdy on albo KTORYKOLWIEK starszy wpis jest od startu (podrobiona stara data w srodku = w sesji).
  let olderInSession = false;
  const inSession = new Array(entries.length).fill(false);
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].at >= startedAt) olderInSession = true;
    inSession[i] = olderInSession;
  }
  const own = Array.isArray(windows) ? windows : null;
  const foreign = own ? foreignWindows(ownPath, startedAt) : [];
  const covers = (ws, at) => ws.some(([a, b]) => at >= a - 2000 && at <= b + 2000);
  const shas = [];
  const foreignShas = [];
  entries.forEach((e, i) => {
    if (!inSession[i] || !/^commit( \((amend|initial)\))?:/.test(e.subject)) return;
    const monotonic = (i === 0 || entries[i - 1].at >= e.at) && (i === entries.length - 1 || entries[i + 1].at <= e.at);
    if (own && monotonic && !covers(own, e.at) && covers(foreign, e.at)) { foreignShas.push(e.sha.slice(0, 7)); return; }
    shas.push(e.sha);
  });
  // Jeden wpis na Stop zamiast jednego na commit (ops-review 2026-10-04: zalew gates.jsonl przy dlugich sesjach).
  if (foreignShas.length) {
    log({ hook: HOOK, event: 'skipped', reason: `commity innej sesji (jej okna narzedzi, poza oknami tej): ${foreignShas.length} — ${foreignShas.slice(0, 5).join(',')}${foreignShas.length > 5 ? ',...' : ''}`, target: root });
  }
  const files = new Set();
  let lines = 0;
  for (const sha of shas.slice(0, 30)) {
    if (budgetLeft() < 25000) { log({ hook: HOOK, event: 'skipped', reason: 'stop budget (git show)', target: root }); break; }
    const show = sh(`git -c core.quotePath=false show --no-ext-diff --numstat --format= ${sha}`, root, GIT_TIMEOUT_MS);
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
    if (!fs.existsSync(dir)) continue;
    const root = gitRoot(dir);
    if (!root || roots.has(root)) continue;
    // Plik ignorowany przez git repo (np. pamiec sesji w ~/.claude/projects/*/memory) nie jest praca w tym repo: bez tego
    // kazda sesja projektowa recenzowala caly PG (2026-10-04, falszywe [review] T3 w sesjach klienckich).
    const ign = spawnSync('git', ['-C', root, 'check-ignore', '-q', '--', path.resolve(file)], { timeout: GIT_TIMEOUT_MS, env: CHILD_ENV });
    if (ign.status === 0) { log({ hook: HOOK, event: 'skipped', reason: `edytowany plik ignorowany przez repo (${path.basename(file)}) — repo nie wchodzi do kontroli`, target: root }); continue; }
    roots.add(root);
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
    // Wyjmujemy wpis katalogu repo tylko, gdy nim jest (PYTHONSAFEPATH go nie dodaje); wracamy z os.getcwd(), nie '' —
    // tak jak `python -m pytest` (data-review 2026-09-28: '' psulo importy po monkeypatch.chdir).
    const dropRepo = 'import sys,os;p=sys.path;cwd=os.getcwd();(p and p[0] in (\'\',cwd)) and p.pop(0)';
    const specPy = dropRepo + ';sys.stdout.reconfigure(encoding=\'utf-8\');import importlib.util as u;p.insert(0,cwd);[print(\'ORIGIN\', m, getattr(u.find_spec(m), \'origin\', None) or \'\') for m in (\'pytest\', \'_pytest\')]';
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
    let probeError = '';
    for (const p of ['python', 'python3']) {
      // Istnienie interpretera: `--version` nie wykonuje zadnego kodu. Na Windows brak komendy daje exit 1 (nie 127),
      // wiec rozrozniamy „nie ma pythona" od „proba padla" wlasnie ta druga proba (data-review 2026-09-28).
      const ver = sh(`${p} --version`, root, PY_PROBE_MS);
      if (isTimeout(ver)) { probeTimeout = probeTimeout || Object.assign({}, ver, { probe: true }); continue; }
      if (!ver.ok) continue; // brak tego interpretera
      const r = sh(`${p} -c "${specPy}"`, root, PY_PROBE_MS);
      if (isTimeout(r)) { probeTimeout = probeTimeout || Object.assign({}, r, { probe: true }); continue; }
      // Interpreter jest, a proba padla albo nie wypisala obu linii: zapamietujemy i probujemy nastepnego (ops-review
      // 2026-09-28: python z bledem nie moze blokowac, gdy python3 dziala). Blokada dopiero, gdy nikt nie dal wyniku.
      if (!r.ok || !/^ORIGIN pytest/m.test(r.out || '') || !/^ORIGIN _pytest/m.test(r.out || '')) {
        // Bledy WSZYSTKICH interpreterow w komunikacie (code + ops review 2026-09-28: pierwszy maskowal powod drugiego).
        probeError = (probeError ? probeError + '; ' : '') + `${p} (exit ${r.status}): ${String(r.out || r.msg || '').trim().split(/\r?\n/).pop().slice(0, 120)}`;
        continue;
      }
      const origins = {};
      for (const line of String(r.out || '').split(/\r?\n/)) { const m = /^ORIGIN (\S+) ?(.*)$/.exec(line.trim()); if (m) origins[m[1]] = m[2].trim(); }
      const local = ['pytest', '_pytest'].map((m) => origins[m]).filter((o) => o && inRepoCode(o));
      if (local.length) { shadow = local[0]; break; }
      if (origins.pytest && origins._pytest) { py = p; break; }
    }
    if (shadow) return `pytest ladowany z repo (${shadow.slice(-100)}) — plik w repo zaslania prawdziwego pytesta, wynik testow nie jest wiarygodny. Zmien nazwe tego pliku.`;
    if (!py && probeError) return `Proba pochodzenia pytesta nie dala wyniku: ${probeError} — nie da sie potwierdzic, ze testy uruchomia prawdziwego pytesta.`;
    // Testy przez wrapper, nie `-m pytest`: runpy/importlib i sam pytest z zaleznosciami laduja sie z repo WYJETYM z sys.path,
    // dopiero potem wraca '' (importy projektu w testach dzialaja jak przy -m). Plik importlib.py w repo z exit(0)
    // zamienial czerwone testy w zielone (test 2026-09-28).
    const runPy = dropRepo + ';import pytest;p.insert(0,cwd);sys.exit(pytest.main([\'-q\',\'-x\',\'-p\',\'no:cacheprovider\']))';
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
    const diffs = [sh('git diff --no-ext-diff --no-textconv HEAD -U0', root, GIT_TIMEOUT_MS), ...(sessionShas || []).slice(0, 10).map((sha) => sh(`git -c core.quotePath=false show --no-ext-diff --no-textconv -U0 --format= ${sha}`, root, GIT_TIMEOUT_MS))];
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

// Architektura przy T2+ (2026-10-04): sygnaly z diffu TEJ sesji (wlasne niezacommitowane + commity sesji). Zwraca liste
// powodow, gdy wymog NIE jest spelniony; null = brak sygnalow albo jest ADR z trescia. Nieśledzony plik = caly dodany.
// security-review 2026-10-04: samo wywolanie pg-council / string „pg-council.js" NIE zwalnia (zero dowodu narady) —
// narada konczy sie adr-draft.md, ktory trafia do docs/adr; bramka sprawdza ADR, nie rytual.
const ARCH_MAX_FILES = 200;
const ARCH_MAX_FILE_BYTES = 1024 * 1024;
// Instalatory zmieniaja manifest bez sciezki w komendzie (ownedBy go nie widzi) — wtedy manifest/infra z calego drzewa.
const INSTALL_CMD_RX = /\b((npm|pnpm|yarn|bun)\s+(i|install|add)\b|pip3?\s+install|uv\s+(add|pip\s+install)|poetry\s+add|cargo\s+add|go\s+get)\b/;
const ARCH_FILE_RX = /(^|\/)(package\.json|pyproject\.toml|requirements[\w.-]*\.txt|Cargo\.toml|go\.mod|Dockerfile[\w.-]*|(docker-)?compose[\w.-]*\.ya?ml|vercel\.json|netlify\.toml|fly\.toml|supabase\/config\.toml|\.github\/workflows\/[^/]+\.ya?ml)$/i;
function archRequirement(root, changedOwned, changedAll, shas, transcript) {
  if (budgetLeft() < 20000) { log({ hook: HOOK, event: 'skipped', reason: 'stop budget (arch)', target: root }); return null; }
  const ls = sh('git -c core.quotePath=false ls-files --others --exclude-standard', root, GIT_TIMEOUT_MS);
  if (!ls.ok) log({ hook: HOOK, event: 'skipped', reason: 'arch: git ls-files nieudany (nieśledzone traktowane jak sledzone)', target: root });
  const untracked = new Set(ls.ok ? ls.out.split('\n').filter(Boolean).map((r) => normPath(path.join(root, r))) : []);
  const extra = INSTALL_CMD_RX.test(transcript.commandText) ? changedAll.filter((f) => ARCH_FILE_RX.test(f.replace(/\\/g, '/'))) : [];
  const all = [...new Set([...changedOwned, ...extra])];
  if (all.length > ARCH_MAX_FILES) log({ hook: HOOK, event: 'skipped', reason: `arch: ${all.length - ARCH_MAX_FILES} plikow poza limitem ${ARCH_MAX_FILES}`, target: root });
  const rels = all.slice(0, ARCH_MAX_FILES).map((f) => ({ abs: f, rel: path.relative(root, f).replace(/\\/g, '/') }));
  const parts = [];
  // Sciezki jako argumenty (spawnSync, bez powloki) + literal pathspecs + bez ext-diff/textconv: nazwa pliku z `$(...)`
  // albo magia pathspec w obcym repo nie wykona komendy ani nie zmieni zakresu diffu w hooku.
  const tracked = rels.filter((r) => !untracked.has(normPath(r.abs))).map((r) => r.rel);
  if (tracked.length) {
    const d = spawnSync('git', ['-c', 'core.quotePath=false', '--literal-pathspecs', 'diff', '--no-ext-diff', '--no-textconv', 'HEAD', '-U0', '--', ...tracked],
      { cwd: root, timeout: GIT_TIMEOUT_MS, env: CHILD_ENV, maxBuffer: 16 * 1024 * 1024 });
    if (d.status === 0) parts.push(String(d.stdout));
    else log({ hook: HOOK, event: 'skipped', reason: `arch: git diff exit ${d.status}`, target: root });
  }
  for (const r of rels.filter((x) => untracked.has(normPath(x.abs)))) {
    if (budgetLeft() < 15000) { log({ hook: HOOK, event: 'skipped', reason: 'stop budget (arch untracked)', target: root }); break; }
    try {
      // lstat + isFile: symlink do /dev/zero albo FIFO zawiesilby hook do timeoutu (security-review 2026-10-04).
      const s = fs.lstatSync(r.abs);
      if (!s.isFile() || s.size > ARCH_MAX_FILE_BYTES) { log({ hook: HOOK, event: 'skipped', reason: `arch: pominiety ${r.rel} (nie plik albo > 1 MB)`, target: root }); continue; }
      const body = fs.readFileSync(r.abs, 'utf8').split('\n').map((l) => '+' + l).join('\n');
      parts.push(`diff --git a/${r.rel} b/${r.rel}\nnew file mode 100644\n+++ b/${r.rel}\n@@ -0,0 +1 @@\n${body}`);
    } catch (e) { /* zniknal */ }
  }
  if ((shas || []).length > 10) log({ hook: HOOK, event: 'skipped', reason: `arch: ${shas.length - 10} commitow sesji poza limitem 10`, target: root });
  for (const sha of (shas || []).slice(0, 10)) {
    if (budgetLeft() < 15000) { log({ hook: HOOK, event: 'skipped', reason: 'stop budget (arch git show)', target: root }); break; }
    // spawnSync + maxBuffer: commit z nowa zaleznoscia zwykle niesie lockfile > 1 MB (ENOBUFS w sh() = fail-open, code-review).
    const s = spawnSync('git', ['-c', 'core.quotePath=false', 'show', '--no-ext-diff', '--no-textconv', '-U0', '--format=', sha],
      { cwd: root, timeout: GIT_TIMEOUT_MS, env: CHILD_ENV, maxBuffer: 64 * 1024 * 1024 });
    if (s.status === 0) parts.push(String(s.stdout)); else log({ hook: HOOK, event: 'skipped', reason: `arch: git show ${sha.slice(0, 8)} nieudany (${s.error ? s.error.code : 'exit ' + s.status})`, target: root });
  }
  const files = parseUnifiedDiff(parts.join('\n'));
  const reasons = archSignals(files);
  if (!reasons.length) return null;
  if (hasAdr(files)) { log({ hook: HOOK, event: 'ran', reason: `arch: ADR w diffie (${reasons.length} sygnalow)`, target: root }); return null; }
  return reasons;
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
  // Transkrypt przed limitem: znacznik liczony z plikow TEJ sesji musi miec ten sam zbior plikow co porownanie nizej.
  const transcript = await parseTranscript(input.transcript_path);
  const ownedFor = (root) => (transcript.available ? ownedBy(transcript, root) : null);
  if (state.reasons.length >= MAX_BLOCKS_PER_CYCLE) {
    // Zgloszone repo dostaja znacznik: w nastepnej turze te same znaleziska nie zablokuja od nowa.
    saveWatermarks(reposFromReasons(state.reasons), state.reasons, ownedFor);
    clearState();
    // #17: po limicie NIE zwalniamy po cichu — uzytkownik dostaje komunikat, co zostalo niezalatwione.
    log({ hook: HOOK, event: 'skipped', reason: `max ${MAX_BLOCKS_PER_CYCLE} blocks reached: ${state.reasons.join(',')}`, target: cwd });
    nudgesOut.push(`[stop-gate] LIMIT ${MAX_BLOCKS_PER_CYCLE} blokad w tym cyklu — sesja konczy sie mimo niezalatwionych bramek: ${state.reasons.join(', ')}. Sprawdz recznie albo popros o dokonczenie.`);
    return;
  }
  if (!transcript.available) log({ hook: HOOK, event: 'skipped', reason: 'no transcript_path (review gate off)', target: cwd });

  const repos = discoverRepos(transcript.editedFiles);
  if (!repos.length) { log({ hook: HOOK, event: 'skipped', reason: 'no git repo in cwd/subdirs/edited files', target: cwd }); return; }

  let touched = 0;
  for (const root of repos) {
    const wm = watermarks[root];
    // Drzewo identyczne jak przy znaczniku = te zmiany juz byly ocenione/zgloszone w tej sesji (fix petli 2026-10-01).
    const owned = ownedFor(root) || (() => true);
    const treeUnchanged = Boolean(wm) && treeFingerprint(root, owned) === wm.tree;
    if (treeUnchanged) log({ hook: HOOK, event: 'suppressed', reason: `watermark (drzewo bez zmian): ${(wm.reasons || []).join(', ') || 'brak powodow'}`, target: root });
    const changedAll = treeUnchanged ? [] : changedFiles(root);
    const changed = changedAll.filter(owned);
    if (changedAll.length > changed.length) log({ hook: HOOK, event: 'skipped', reason: `foreign: ${changedAll.length - changed.length} niezacommitowanych plikow innej sesji (nietkniete przez te sesje)`, target: root });
    // SQL (migracje/RLS) nie ma lintera w hooku, ale to najbardziej ryzykowna klasa zmian — liczy sie do review.
    const changedCode = changed.filter((f) => isCodeFile(f) || SQL_FILE_RX.test(f));
    // #14: pliki commitow z tej sesji licza sie do TIERU (nie do lintu — ten zrobil pre-commit) — od znacznika, nie od startu sesji.
    // Reflog ma rozdzielczosc 1 s: znacznik w dol do pelnej sekundy, by commit z tej samej sekundy nie umknal (wolimy nadmiar).
    const since = wm ? Math.max(transcript.startedAt || 0, Math.floor(wm.ts / 1000) * 1000) : transcript.startedAt;
    const committed = transcript.available ? sessionCommitFiles(root, since, transcript.toolWindows, input.transcript_path) : { files: [], lines: 0 };
    const committedCode = committed.files.filter((f) => (isCodeFile(f) || SQL_FILE_RX.test(f)) && !changedCode.includes(f));
    // Manifest/infra bez kodu tez wchodzi (ops-review 2026-10-04: inaczej bramka arch nie widziala swoich glownych sygnalow).
    const archTouched = changed.some((f) => ARCH_FILE_RX.test(f.replace(/\\/g, '/'))) || committed.files.some((f) => ARCH_FILE_RX.test(f.replace(/\\/g, '/')));
    if (!changedCode.length && !committedCode.length && !archTouched) continue;
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
    // need liczony RAZ, poza galezia review: bramka arch nie moze znikac po pierwszej blokadzie review (security-review 2026-10-04).
    const need = transcript.available && (!alreadyBlocked('review', root) || !alreadyBlocked('arch', root))
      ? reviewRequirement(root, [...changedCode, ...committedCode], committed.lines, committed.shas) : null;
    if (!alreadyBlocked('review', root) && transcript.available) {
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
    // Tier dla arch liczony takze z manifestu/infra (risk-tier: zaleznosci/CI/build = T2) — sam package.json z nowa
    // zaleznoscia tez wymaga ADR (code-review 2026-10-04). Wymog REVIEW zostaje liczony jak dotad (bez nowego tarcia).
    const archFiles = [...changed, ...committed.files].filter((f) => ARCH_FILE_RX.test(f.replace(/\\/g, '/')));
    const archNeed = need || (archFiles.length && transcript.available && !alreadyBlocked('arch', root)
      ? reviewRequirement(root, [...changedCode, ...committedCode, ...archFiles], committed.lines, committed.shas) : null);
    if (archNeed && !alreadyBlocked('arch', root)) {
      const arch = archRequirement(root, changed, changedAll, committed.shas, transcript);
      if (arch) block('arch', root,
        `Zmiana ${archNeed.tier} jest ARCHITEKTONICZNA (${arch.join('; ')}), a w diffie tej sesji nie ma ADR z trescia (>= 5 linii). ` +
        'Dodaj ADR w docs/adr/NNNN-tytul.md (repo ~/.claude: pg/adr/; szablon ~/.claude/templates/repo/docs/adr/: decyzja, odrzucona alternatywa, konsekwencje). ' +
        'Przed decyzja: skill architecture-advisor (trade-offy); przy sporze/T3: skill pg-council (narada -> adr-draft.md -> docs/adr). Decyzja uzytkownika 2026-10-04: twardo przy T2+.');
    }
    nudges(root, changed);
  }
  observeClaims(transcript, repos);
  // Znacznik tylko dla repo ZGLOSZONYCH w tym cyklu (blok -> powtorny Stop przepuszczony przez anty-petle).
  // Czyste przejscie niczego nie wygasza: pozniejszy nowy dowod (np. agregacja INCOMPLETE) dalej blokuje.
  const suppressed = reposFromReasons(state.reasons);
  saveWatermarks(suppressed, state.reasons, ownedFor);
  // Przepuszczenie przez anty-petle NIE jest ciche (ops-review 2026-10-01): uzytkownik widzi, co zostalo niezalatwione.
  if (suppressed.length) nudgesOut.push(`[stop-gate] Przepuszczone bez naprawy (anty-petla) — wroci przy zmianie drzewa/nowym commicie: ${state.reasons.join(', ')}.`);
  clearState();
  log({ hook: HOOK, event: 'ran', reason: `${touched}/${repos.length} repos with code changes`, target: repos.join(';') });
}

main().then(() => { emitNudges(); process.exit(0); }).catch((e) => {
  log({ hook: HOOK, event: 'skipped', reason: 'internal error: ' + String(e && e.message || e).slice(0, 120), target: cwd });
  process.exit(0);
});

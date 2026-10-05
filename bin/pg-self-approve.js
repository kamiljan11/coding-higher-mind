#!/usr/bin/env node
'use strict';
// pg-self-approve (uzytkownik 2026-10-02: „self approval — agent sam sprawdza bezpieczenstwo i poprawia"): wydaje wyjatek
// poziomu B (overrides.SELF_APPROVABLE) TYLKO z dowodem recenzji tej samej zmiany. Po pg-review 2026-10-02 (findings
// dalo sie podrobic dwoma pustymi plikami) dowod = transkrypty prawdziwych subagentow, nie same pliki w %TEMP%:
//  1. recenzja jest przypieta do TRESCI diffu: prompt subagenta `<rola>-reviewer` zawiera `diff_sha256=<sha diff.patch>`
//     i sciezke diff.patch tego przebiegu; dla kazdej wymaganej roli (security, code) jest swiezy (< 2 h) taki transkrypt;
//  2. KAZDY transkrypt recenzenta z tym sha (dowolny przebieg, dowolny wiek) oddal JSON {"findings": [...]}, a findings
//     tego przebiegu zawieraja jego rule_id — ponowne losowanie recenzji w nowym katalogu albo usuniecie findings = odmowa
//     (security-review r4 2026-10-04: AUTOMERGE-TRANSCRIPT-DISCARD-RESAMPLING, OPTIONAL-ROLE-FINDINGS-DELETABLE,
//     REVIEWER-UNSTRUCTURED-OUTPUT-FAIL-OPEN);
//  3. agregacje liczymy od nowa (pg-aggregate --final): APPROVE, kazdy finding zweryfikowany;
//  4. diff.patch == bajt w bajt obecny diff roboczy repo (`--diff`: git diff HEAD + nieśledzone) — r4 SELFAPPROVE-NO-DIFF-SHA-BINDING;
//  5. przebieg jednorazowy; wyjatek trafia do sesji, w ktorej dzialali recenzenci (15 min / 1 uzycie, tylko w tym repo).
//  verdicts.json (zmienia werdykt) wymaga transkryptu subagenta `verifier`; czas recenzji = timestamp z JSONL, nie mtime.
// Granica (pg/known-limits.md): agent, ktory celowo podrabia transkrypty JSONL, obejdzie to — model zagrozen = agent na skrotach.
// Uzycie: node pg-self-approve.js --run <katalog pg-review> --repo <sciezka> --allow ALLOW_X[,ALLOW_Y] --reason "<po co>"
//         node pg-self-approve.js --diff <repo>   (kanoniczny diff.patch dla pg-review krok 0)
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const HOOKS_LIB = path.join(CLAUDE_DIR, 'hooks', 'lib');
const overrides = require(path.join(HOOKS_LIB, 'overrides.js'));
const gateLog = require(path.join(HOOKS_LIB, 'gate-log.js'));
const { aggregate, validateRoleFile } = require(path.join(__dirname, 'pg-aggregate.js'));

const REQUIRED_ROLES = ['security', 'code'];
// Dodatkowe dzialy per wyjatek (data-review 2026-10-02: PII bez recenzji danych).
const EXTRA_ROLES = { ALLOW_PII: ['data'] };
const rolesFor = (names) => [...new Set([...REQUIRED_ROLES, ...names.flatMap((n) => EXTRA_ROLES[n] || [])])];
const MAX_RUN_AGE_MS = 2 * 3600000;
const CLOCK_SKEW_MS = 60000;
const GIT_TIMEOUT_MS = 30000;
// Transkrypt JSONL ma `\\` w sciezkach Windows — sprowadzamy oba boki do jednego `/` i malych liter.
const norm = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+/g, '/').toLowerCase();
const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');

/** git -C repo ... -> Buffer (bajty diffu bez dekodowania). */
function git(repo, args, allowExit1) {
  try {
    return execFileSync('git', ['-C', repo, ...args], { maxBuffer: 64 * 1024 * 1024, timeout: GIT_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    // `git diff --no-index` konczy sie kodem 1, gdy sa roznice — to wynik, nie blad.
    if (allowExit1 && e.status === 1 && Buffer.isBuffer(e.stdout)) return e.stdout;
    throw new Error(`git ${args.slice(0, 4).join(' ')}: ${String(e.stderr || e.message).trim().slice(0, 160)}`);
  }
}

// Bez konfiguracji uzytkownika, ktora zmienia bajty diffu (kolor, zewnetrzny diff, textconv, cytowanie sciezek).
const DIFF = ['-c', 'core.quotePath=false', '--no-pager', 'diff', '--no-color', '--no-ext-diff', '--no-textconv', '--binary'];

/**
 * Kanoniczny diff roboczy (Buffer): `git diff HEAD` + kazdy nieśledzony plik od /dev/null. Ten sam kod pisze
 * diff.patch w pg-review (`--diff`) i liczy obecny stan przy wydaniu wyjatku — porownanie bajt w bajt (r4: odcisk
 * linii +/- pomijal kontekst i preambule, a nieśledzone pliki spoza patcha w ogole nie wchodzily do porownania).
 */
function workingDiff(repo) {
  const parts = [git(repo, [...DIFF, 'HEAD'])];
  const untracked = git(repo, ['ls-files', '-z', '--others', '--exclude-standard']).toString('utf8').split('\0').filter(Boolean);
  for (const f of untracked) parts.push(git(repo, [...DIFF, '--no-index', '--', '/dev/null', f], true));
  return Buffer.concat(parts);
}

/** Sciezka wystepuje w tekscie jako cala nazwa: nic jej nie przedluza z prawej ani z lewej (r4: `/evil/tmp/run` pasowal do `/tmp/run`). */
function mentionsPath(text, p) {
  if (!p) return false;
  for (let i = text.indexOf(p); i >= 0; i = text.indexOf(p, i + 1)) {
    if (!/[\w.-]/.test(text.charAt(i + p.length)) && (i === 0 || !/[\w.~/-]/.test(text.charAt(i - 1)))) return true;
  }
  return false;
}

/**
 * Wiadomosci od orkiestratora PO pierwszym prompcie (data-review r7 STEERING-ONLY-FIRST-USER-ENTRY: „to uznane ryzyko"
 * dosylane w trakcie). Przypomnienia harnessu (`<system-reminder>`) i wyniki narzedzi sie nie licza.
 */
function midTaskMessages(raw) {
  let n = -1;
  for (const line of String(raw).split('\n')) {
    let entry;
    try { entry = JSON.parse(line); } catch (e) { continue; }
    if (!entry) continue;
    // data-review r8: wiadomosc wyslana W TRAKCIE tury to zalacznik queued_command, nie wpis `user`
    // (por. hooks/precompact-snapshot.js); powiadomienia o zadaniach w tle recenzenta sie nie licza.
    if (entry.type === 'attachment' && entry.attachment && entry.attachment.type === 'queued_command') {
      if (!String(entry.attachment.prompt || '').trim().startsWith('<task-notification>')) n += 1;
      continue;
    }
    if (entry.type !== 'user') continue;
    const c = entry.message && entry.message.content;
    const text = typeof c === 'string' ? c : (Array.isArray(c) ? c.filter((b) => b && b.type === 'text').map((b) => String(b.text || '')).join(' ') : '');
    const t = text.trim();
    if (!t) continue;
    n += 1;
    if (n > 0 && (t.startsWith('<system-reminder>') || t.startsWith('[Request interrupted by user'))) n -= 1;
  }
  return Math.max(0, n);
}

/** Prompt subagenta = tresc pierwszego wpisu `user` w transkrypcie JSONL ('' gdy brak; pisze go harness, nie recenzent). */
function promptOf(raw) {
  for (const line of String(raw).split('\n')) {
    let entry;
    try { entry = JSON.parse(line); } catch (e) { continue; }
    if (!entry || entry.type !== 'user') continue;
    const content = entry.message && entry.message.content;
    if (typeof content === 'string') return content;
    return (Array.isArray(content) ? content : []).filter((b) => b && b.type === 'text').map((b) => String(b.text || '')).join('\n');
  }
  return '';
}

/** Indeks nawiasu zamykajacego obiekt/tablice od `start` (z pominieciem napisow JSON); -1 = ucięte. */
function balancedEnd(t, start) {
  let depth = 0;
  let inStr = false;
  for (let i = start; i < t.length; i++) {
    const c = t[i];
    if (inStr) {
      if (c === '\\') i++;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Tablica findings z WYNIKU KONCOWEGO recenzenta; null = wynik nie zaczyna sie od obiektu JSON `{"findings": [...]}`
 * (dozwolony plot ```json i proza PO obiekcie). security-review r4 REVIEWER-UNSTRUCTURED-OUTPUT-FAIL-OPEN + r5: JSON
 * wspomniany w srodku prozy ("Schemat: {"findings": []}. BLOCKER: ...") nie jest wynikiem; jedno parsowanie = koszt liniowy.
 */
function leadingFindings(text) {
  const t = String(text || '').replace(/^\s*(?:```(?:json)?\s*)?/, '');
  if (t[0] !== '{') return null;
  const end = balancedEnd(t, 0);
  if (end < 0) return null;
  try {
    const obj = JSON.parse(t.slice(0, end + 1));
    return obj && Array.isArray(obj.findings) ? obj.findings : null;
  } catch (e) { return null; }
}
const hasFindingsJson = (text) => leadingFindings(text) !== null;

/** Wynik koncowy subagenta: ostatni SubagentHandback.message (tak oddaje harness), inaczej ostatni blok tekstu asystenta. */
function finalOutput(raw) {
  let handback = null;
  let lastText = '';
  for (const line of String(raw).split('\n')) {
    if (!line.includes('"assistant"')) continue;
    let entry;
    try { entry = JSON.parse(line); } catch (e) { continue; }
    if (entry.type !== 'assistant') continue;
    for (const block of (entry.message && Array.isArray(entry.message.content)) ? entry.message.content : []) {
      if (block && block.type === 'tool_use' && block.name === 'SubagentHandback' && block.input && typeof block.input.message === 'string') handback = block.input.message;
      else if (block && block.type === 'text' && String(block.text || '').trim()) lastText = String(block.text);
    }
  }
  return handback !== null ? handback : lastText;
}

/** Katalog agentow definiuje typ: plik `<typ>.md` albo dowolny .md z frontmatter `name: <typ>` (nazwa pliku != typ). */
function projectDefines(dir, agentType, depth = 0) {
  if (depth > 3) return false;
  if (fs.existsSync(path.join(dir, `${agentType}.md`))) return true;
  // podkatalogi agents/** (security-review r7)
  if (safeList(dir).some((f) => { try { return fs.statSync(path.join(dir, f)).isDirectory() && projectDefines(path.join(dir, f), agentType, depth + 1); } catch (e) { return false; } })) return true;
  const nameRx = new RegExp(`^name:\\s*['"]?${agentType.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]?\\s*$`, 'm');
  return safeList(dir).filter((f) => f.endsWith('.md')).some((f) => {
    try { return nameRx.test(readHead(path.join(dir, f), 4096)); } catch (e) { return false; }
  });
}

/**
 * Definicja recenzenta podmieniona w projekcie: `<cwd lub przodek>/.claude/agents/<agentType>.md` poza ~/.claude
 * (security-review r4/r5 REVIEWER-AGENT-DEFINITION-OVERRIDABLE: projektowy agent `security-reviewer`, ktory zawsze
 * oddaje {"findings":[]}, = jeden Write, bez falszowania JSONL). cwd z wpisow transkryptu.
 */
function agentOverridden(raw, agentType) {
  const m = /"cwd":"((?:[^"\\]|\\.)*)"/.exec(String(raw));
  if (!m) return false;
  let dir;
  try { dir = path.resolve(JSON.parse(`"${m[1]}"`)); } catch (e) { return true; }
  const home = path.resolve(os.homedir());
  for (;;) {
    if (dir !== home && projectDefines(path.join(dir, '.claude', 'agents'), agentType)) return true;
    const up = path.dirname(dir);
    if (up === dir) return false;
    dir = up;
  }
}

/**
 * Klucz findingu do porownania recenzent <-> findings.<rola>.json: `rule_id|nazwa pliku`. Multizbior, nie zbior rule_id
 * (data-review r5 FINDINGS-BINDING-RULEID-NOT-UNIQUE: dwa findingi z jednym rule_id, orkiestrator zostawial jeden).
 * Nazwa pliku bez katalogu — recenzent pisze sciezke absolutna, orkiestrator czesto wzgledna.
 */
// + severity i skrot claim/evidence (data-review r6 FINDINGS-BINDING-CONTENT-NOT-BOUND: obnizenie severity albo
// przepisanie tresci blockera po recenzji przy tym samym rule_id|plik).
const findingKey = (f) => [String((f && f.rule_id) || ''), String((f && f.severity) || ''), path.basename(String((f && f.file) || '')),
  sha256(`${String((f && f.claim) || '')}\0${String((f && f.evidence) || '')}`).slice(0, 12)].join('|');
const ruleOfKey = (k) => String(k).split('|')[0];

/** Liczba wystapien kazdego klucza. */
function countKeys(keys) {
  const m = new Map();
  for (const k of keys || []) m.set(k, (m.get(k) || 0) + 1);
  return m;
}

/** Pierwsze `bytes` bajtow pliku (prompt subagenta jest na poczatku transkryptu) — tani filtr przed pelnym odczytem. */
function readHead(file, bytes) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    return buf.toString('utf8', 0, fs.readSync(fd, buf, 0, bytes, 0));
  } finally { fs.closeSync(fd); }
}
const HEAD_BYTES = 64 * 1024;

/**
 * Transkrypty subagentow (recenzenci i weryfikator), ktore wymieniaja przebieg ALBO maja w prompcie `diff_sha256=<sha>`:
 * [{ role, sid, reviewedAt, ruleIds, prompt, findingsJson, file }]. Bez filtra mtime pliku — swiezosc liczy wolajacy
 * z `timestamp` wpisow, a stare recenzje tego samego diffu MUSZA byc widoczne (r4: `touch diff.patch` + nowy recenzent).
 */
function reviewerTranscripts(run, sha) {
  const runNorm = norm(path.resolve(run));
  const runBase = path.basename(run).toLowerCase();
  const shaTag = sha ? `diff_sha256=${sha}` : '';
  const out = [];
  const projects = projectsDir();
  for (const proj of safeList(projects)) {
    for (const sess of safeList(path.join(projects, proj))) {
      const dir = path.join(projects, proj, sess, 'subagents');
      for (const f of safeList(dir).filter((x) => x.endsWith('.meta.json'))) {
        const jsonl = path.join(dir, f.replace(/\.meta\.json$/, '.jsonl'));
        let meta;
        try { meta = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (e) { continue; }
        const m = /^(?:(\w+)-reviewer|(verifier))$/.exec(String(meta.agentType || ''));
        if (!m) continue;
        // Prefiltr na poczatku pliku (prompt): pelny odczyt tylko kandydatow (ops/data-review r5: skan rosnie z historia).
        let head;
        try { head = readHead(jsonl, HEAD_BYTES); } catch (e) { continue; }
        const headNorm = norm(head);
        // Granica nazwy (code-review 2026-10-04): `pg-review-1` nie moze pasowac do transkryptu przebiegu `pg-review-1-r2`.
        const aboutRun = mentionsPath(headNorm, runNorm) || headNorm.includes('/' + runBase + '/');
        if (!aboutRun && !(shaTag && head.includes(shaTag))) continue;
        let raw;
        try { raw = fs.readFileSync(jsonl, 'utf8'); } catch (e) { continue; }
        // Czas recenzji = najpozniejszy `timestamp` wpisu w transkrypcie, nie mtime pliku (security-review 2026-10-02: `touch`).
        const stamps = [...raw.matchAll(/"timestamp":"([^"]+)"/g)].map((x) => Date.parse(x[1])).filter((n) => n > 0);
        if (!stamps.length) continue;
        // rule_id z WLASNEGO wyjscia recenzenta (tool_use + tekst), nie z wynikow narzedzi — przeczytane pliki maja cudze rule_id.
        const own = toolInputsText(raw);
        const ruleIds = [...new Set([...own.matchAll(/rule_id\\*"\s*:\s*\\*"([A-Za-z0-9_.:-]+)/g)].map((x) => x[1]))];
        const final = finalOutput(raw);
        const parsed = leadingFindings(final);
        const entry = {
          role: m[1] || m[2], sid: sess, reviewedAt: Math.max(...stamps), ruleIds, prompt: promptOf(raw), aboutRun, midTask: midTaskMessages(raw),
          overridden: agentOverridden(raw, String(meta.agentType)),
          findingsJson: parsed !== null, completed: final.trim() !== '', findingKeys: (parsed || []).map(findingKey), file: jsonl,
        };
        // Weryfikator: jego wlasne wyjscie (komendy + tekst) — werdykty w verdicts.json musza w nim byc (security-review 2026-10-04).
        if (entry.role === 'verifier') entry.ownText = own;
        out.push(entry);
      }
    }
  }
  return out;
}

// security-review r6 REVIEWER-PROMPT-STEERING-UNCONSTRAINED: orkiestrator pisze prompt findera — „to zaakceptowane ryzyko,
// zwroc pusta liste" robil z recenzji dowod. Prompt dowodu = szablon pg-review (krotki opis zadania, bez dyktowania wyniku).
const STEERING_RX = new RegExp([
  'zaakceptowan\\w*\\s+ryzyk', 'uznan\\w*\\s+ryzyk', 'ryzyk\\w*\\s+(uznan|zaakceptowan|przyj[eę]t)', 'accepted[ -]risk', 'nie\\s+zg[lł]aszaj',
  'nie\\s+raportuj', 'return\\s+\\[\\s*\\]', "don'?t\\s+report", 'do\\s+not\\s+report', 'ignoruj\\s+(findings|blocker|bled)',
  'ignore\\s+(the\\s+)?(findings|blockers?|issues)', 'pomi[nń]\\s+(findings|blocker|sprawdz)', 'zwr[oó][cć]\\s+(pust|\\{)',
  'return\\s+(an?\\s+)?(empty|\\{)', '\\{\\s*\\\\?"findings\\\\?"\\s*:\\s*\\[\\s*\\]',
].join('|'), 'i');
const MAX_PROMPT_CHARS = 3000;

/** sameDiff = prompt ma sha tej tresci; bound = do tego wskazuje diff.patch TEGO przebiegu (r3: sam sha mogl stac obok innego pliku). */
function bindTranscripts(transcripts, sha, diffPath) {
  return (transcripts || []).map((t) => {
    const sameDiff = !!sha && String(t.prompt || '').includes(`diff_sha256=${sha}`);
    const hit = STEERING_RX.exec(String(t.prompt || ''));
    const long = String(t.prompt || '').length > MAX_PROMPT_CHARS;
    const steered = hit ? `„${hit[0]}"` : long ? `prompt ${String(t.prompt).length} > ${MAX_PROMPT_CHARS} znakow`
      : t.midTask ? `${t.midTask} wiadomosc(i) orkiestratora w trakcie recenzji` : '';
    return { ...t, sameDiff, steered, bound: sameDiff && !steered && mentionsPath(norm(t.prompt), norm(path.resolve(diffPath))) };
  });
}

/**
 * Zgodnosc recenzji z findings przebiegu (Python: lustro w pg-merge-bezpieczny.ocena_dowodu — zmieniaj oba). Kazdy transkrypt recenzenta tego
 * samego diffu: JSON findings, jego rule_id i multizbior kluczy `rule_id|plik` w findings.<rola>.json; kazda wymagana rola:
 * >= 1 swiezy transkrypt `bound`. `findingsIds[rola]` = klucze z findingsIdsOf. Zwraca { why } albo { sids }.
 */
function transcriptProblem(transcripts, roles, findingsIds, now) {
  for (const t of (transcripts || []).filter((x) => x.sameDiff || x.aboutRun)) {
    if (t.overridden) {
      return { why: `${t.role} (sesja ${t.sid}) uruchomiony z definicji agenta w projekcie (.claude/agents poza ~/.claude) — recenzent musi byc z ~/.claude/agents` };
    }
    if (t.role !== 'verifier' && !t.sameDiff) {
      return { why: `${t.role}-reviewer (sesja ${t.sid}) recenzowal ten przebieg bez diff_sha256 obecnego diff.patch (inny diff albo brak sha) — `
        + 'nowy diff = nowy katalog RUN; recenzja bez sha nie znika z dowodu' };
    }
  }
  const reviewers = (transcripts || []).filter((t) => t.role !== 'verifier' && t.sameDiff);
  for (const t of reviewers) {
    if (!t.findingsJson) {
      // Tylko NAPRAWDE przerwany recenzent (brak wyniku koncowego i rule_id), starszy niz 2 h, nie blokuje diffu na zawsze
      // (data-review r5); wynik proza (np. „BLOCKER: ...") blokuje ten sha na stale (data-review r6 PROSE-BLOCKER-EXPIRES).
      if (!t.completed && !(t.ruleIds || []).length && now - t.reviewedAt > MAX_RUN_AGE_MS) continue;
      return { why: `${t.role}-reviewer (sesja ${t.sid}) nie oddal JSON {"findings": [...]} dla tego diffu — wyjscie nieczytelne nie jest dowodem czystej recenzji; `
        + 'zmien diff (nowy sha) albo, gdy recenzent zostal przerwany bez wynikow, poczekaj az jego transkrypt bedzie starszy niz 2 h' };
    }
    if (!Object.prototype.hasOwnProperty.call(findingsIds, t.role)) {
      return { why: `transkrypt ${t.role}-reviewer dla tego diffu bez findings.${t.role}.json w przebiegu — usuniete findings` };
    }
    const have = countKeys(findingsIds[t.role]);
    const rules = new Set(findingsIds[t.role].map(ruleOfKey));
    const lost = [...new Set(t.ruleIds || [])].filter((id) => !rules.has(id));
    for (const [k, n] of countKeys(t.findingKeys)) if ((have.get(k) || 0) < n) lost.push(k);
    if (lost.length) {
      return { why: `findings.${t.role}.json nie zawiera findings recenzenta (${lost.slice(0, 5).join(', ')}) — podmiana albo ponowne losowanie recenzji tego samego diffu` };
    }
  }
  const sids = new Set();
  for (const role of roles) {
    const fresh = reviewers.filter((t) => t.role === role && t.bound && now - t.reviewedAt <= MAX_RUN_AGE_MS && t.reviewedAt - now <= CLOCK_SKEW_MS);
    if (!fresh.length) {
      const other = (transcripts || []).some((t) => t.role === role && !t.sameDiff);
      const steered = reviewers.find((t) => t.role === role && t.steered);
      if (steered) return { why: `prompt ${role}-reviewer steruje wynikiem (${steered.steered}) — prompt dowodu = szablon pg-review, opis zadania bez dyktowania wyniku` };
      return { why: other
        ? `prompt ${role}-reviewer nie zawiera diff_sha256=<sha diff.patch> i sciezki diff.patch tego przebiegu — recenzent dostal inny diff`
        : `brak swiezego (< 2 h) transkryptu subagenta ${role}-reviewer dla tego diffu — odpal recenzenta, nie pisz findings sam` };
    }
    fresh.forEach((t) => sids.add(t.sid));
  }
  return { sids: [...sids] };
}

/**
 * Wlasny wynik recenzenta z transkryptu JSONL: wejscia jego narzedzi (tool_use) i jego tekst (assistant text) —
 * recenzent bez Write oddaje findings tekstem, a zapisuje je orkiestrator (security-review 2026-10-02). Bez wynikow
 * narzedzi: przeczytane pliki maja cudze rule_id.
 */
function toolInputsText(raw) {
  const parts = [];
  for (const line of raw.split('\n')) {
    if (!line.includes('"assistant"')) continue;
    let entry;
    try { entry = JSON.parse(line); } catch (e) { continue; }
    if (entry.type !== 'assistant') continue;
    const content = (entry.message && entry.message.content) || [];
    for (const block of Array.isArray(content) ? content : []) {
      if (block && block.type === 'tool_use') parts.push(JSON.stringify(block.input || {}));
      else if (block && block.type === 'text') parts.push(String(block.text || ''));
    }
  }
  return parts.join('\n');
}

// Katalog transkryptow; nadpisanie tylko w %TEMP% (testy) — jak PG_OVERRIDES_DIR w overrides.js.
function projectsDir() {
  const env = process.env.PG_PROJECTS_DIR;
  if (env && path.resolve(env).toLowerCase().startsWith(path.resolve(os.tmpdir()).toLowerCase() + path.sep)) return path.resolve(env);
  return path.join(CLAUDE_DIR, 'projects');
}

function safeList(dir) {
  try { return fs.readdirSync(dir); } catch (e) { return []; }
}

/** Obiekty `{...}` (bez zagniezdzen) z wyjscia weryfikatora -> klucze "finding_id|verdict|severity_after". */
function verifierVerdictKeys(text) {
  const keys = new Set();
  const flat = String(text || '').replace(/\\[nrt]/g, ' ').replace(/\\/g, '');
  for (const obj of flat.match(/\{[^{}]*\}/g) || []) {
    const kv = {};
    for (const m of obj.matchAll(/"(finding_id|verdict|severity_after)"\s*:\s*"([^"]*)"/g)) kv[m[1]] = m[2];
    if (kv.finding_id && kv.verdict) keys.add(`${kv.finding_id}|${kv.verdict}|${kv.severity_after || ''}`);
  }
  return keys;
}

/**
 * Werdykty z verdicts.json, ktorych (finding_id, verdict, severity_after) NIE ma w zadnym obiekcie JSON z wyjscia weryfikatora.
 * security-review 2026-10-04 (r3 pg-merge): sam transkrypt weryfikatora + przepisany verdicts.json (`touch -d`) zmienialy
 * werdykt; code-review d5ff01b: takze severity_after (pg-aggregate obniza nim severity). Nie-tablica = wszystko obce.
 */
function unboundVerdicts(verdicts, verifierTexts) {
  if (!Array.isArray(verdicts)) return ['(verdicts nie jest tablica)'];
  const known = new Set(verifierTexts.flatMap((t) => [...verifierVerdictKeys(t)]));
  return verdicts.filter((v) => !known.has(`${v && v.finding_id}|${v && v.verdict}|${(v && v.severity_after) || ''}`))
    .map((v) => String(v && v.finding_id));
}

/**
 * Czysta decyzja. Wejscie: nazwy, powod, agregacja, wiek przebiegu, sha diff.patch i obecnego diffu, transkrypty
 * (po bindTranscripts), findings przebiegu. Zwraca { why } (odmowa) albo { sid } (sesja, ktorej wydac wyjatek).
 */
function evaluate({ names, reason, agg, runAgeMs, reviewSha, currentSha, transcripts, findingsMtime = {}, findingsIds = {}, verdicts = [], now = Date.now() }) {
  const roles = rolesFor(names);
  if (!names.length) return { why: 'brak --allow ALLOW_X' };
  const notB = names.filter((n) => overrides.tierOf(n) !== 'B');
  if (notB.length) {
    return { why: `${notB.join(', ')} nie jest poziomu B — ` + notB.map((n) => (overrides.tierOf(n) === 'A'
      ? `${n}: poziom A, agent dodaje ${n}=1 sam` : `${n}: poziom C, tylko fraza uzytkownika`)).join('; ') };
  }
  if (String(reason || '').trim().length < 10) return { why: '--reason musi opisac po co (min. 10 znakow) — trafia do logu bramek' };
  if (runAgeMs < 0) return { why: 'brak <RUN>/diff.patch — puść pg-review (krok 0)' };
  if (runAgeMs > MAX_RUN_AGE_MS) return { why: 'przebieg recenzji starszy niz 2 h — puść pg-review ponownie' };
  if (!reviewSha) return { why: 'diff.patch recenzji pusty — nie ma czego zatwierdzac' };
  const bound = transcriptProblem(transcripts, roles, findingsIds, now);
  if (bound.why) return bound;
  const sids = new Set(bound.sids);
  // verdicts.json zmienia werdykt agregacji — piszacy go musi byc prawdziwym weryfikatorem (security-review 2026-10-02).
  if (Number.isFinite(findingsMtime.verifier)) {
    const ver = (transcripts || []).filter((t) => t.role === 'verifier' && t.sameDiff && t.reviewedAt >= findingsMtime.verifier - 2000
      && now - t.reviewedAt <= MAX_RUN_AGE_MS && t.reviewedAt - now <= CLOCK_SKEW_MS);
    if (!ver.length) return { why: 'verdicts.json bez swiezego transkryptu subagenta verifier z diff_sha256 tego diff.patch (albo zmieniony po nim) — werdykty wydaje weryfikator, nie orkiestrator' };
    const obce = unboundVerdicts(verdicts, ver.map((t) => t.ownText));
    if (obce.length) return { why: `verdicts.json ma werdykty, ktorych weryfikator nie wydal (${obce.slice(0, 5).join(', ')}) — podmiana po weryfikacji` };
    ver.forEach((t) => sids.add(t.sid));
  }
  if (sids.size !== 1) return { why: `recenzenci z roznych sesji (${[...sids].join(', ')}) — wyjatek nalezy do jednej sesji` };
  if (!agg || agg.verdict !== 'APPROVE') {
    return { why: `recenzja nie jest APPROVE (verdict=${agg ? agg.verdict : 'brak'}${agg && agg.incomplete.length ? '; ' + agg.incomplete.join('; ') : ''}) — napraw findings i powtorz pg-review` };
  }
  if (reviewSha !== currentSha) {
    return { why: 'recenzja dotyczyla innej zmiany niz obecny stan repo (diff.patch != `pg-self-approve.js --diff`) — puść pg-review na aktualnym diffie' };
  }
  return { sid: [...sids][0] };
}

/**
 * Klucz jednorazowosci: jedna recenzja (sesja) jednego diffu (sha bajtow diff.patch) = jeden grant. Niezalezny od
 * formatowania findings/verdicts i od kopii katalogu (data-review r5 RUNKEY-NOT-CANONICAL-REPLAY: przeformatowany
 * findings.json albo dopisany pusty verdicts.json dawal nowy klucz = drugi grant z tej samej recenzji).
 */
const runKey = (diffSha, sid) => sha256(`${diffSha}\0${sid}`);

/** Klucze `rule_id|plik` WAZNYCH findings kazdego findings.<rola>.json w przebiegu (finding bez evidence odpada — r2 EVIDENCE-STRIP). */
function findingsIdsOf(run) {
  const ids = {};
  for (const f of safeList(run)) {
    const m = /^findings\.([\w-]+)\.json$/.exec(f);
    if (m) ids[m[1]] = validateRoleFile(path.join(run, f)).valid.map(findingKey);
  }
  return ids;
}

/** Caly Buffer na stdout synchronicznie — process.stdout.write na potoku + exit ucinal do 64 KiB (ops/data-review r5). */
function writeAllStdout(buf) {
  const pause = new Int32Array(new SharedArrayBuffer(4));
  for (let off = 0; off < buf.length;) {
    try { off += fs.writeSync(1, buf, off, buf.length - off); } catch (e) {
      // stdout odziedziczony jako nieblokujacy (ops-review r6): EAGAIN = poczekaj chwile i pisz dalej, inaczej blad.
      if (e.code !== 'EAGAIN') throw e;
      Atomics.wait(pause, 0, 0, 5);
    }
  }
}

function arg(args, name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function main(argv) {
  const diffRepo = arg(argv, '--diff');
  if (diffRepo !== undefined) {
    const root = overrides.repoRoot(diffRepo);
    if (!root) { console.error(`pg-self-approve --diff: ${diffRepo || '(brak sciezki)'} nie jest repozytorium git`); return 2; }
    let diff;
    try { diff = workingDiff(root); } catch (e) {
      // Repo bez commita, timeout, za duzy diff: pusty diff.patch nie moze trafic do recenzji (ops-review r5).
      console.error(`pg-self-approve --diff: ${String(e.message || e).slice(0, 300)} — napraw repo i powtorz krok 0 pg-review`);
      return 1;
    }
    if (!diff.length) { console.error('pg-self-approve --diff: brak zmian wzgledem HEAD — nie ma czego recenzowac'); return 1; }
    writeAllStdout(diff);
    return 0;
  }
  const run = arg(argv, '--run');
  const repo = arg(argv, '--repo');
  const names = String(arg(argv, '--allow') || '').toUpperCase().split(/[\s,]+/).filter(Boolean);
  const reason = arg(argv, '--reason');
  if (!run || !repo || !fs.existsSync(run) || !overrides.repoRoot(repo)) {
    console.error('uzycie: pg-self-approve.js --run <katalog pg-review> --repo <repo git> --allow ALLOW_X[,ALLOW_Y] --reason "<po co>"');
    return 2;
  }
  const refuse = (why) => {
    gateLog.log({ hook: 'pg-self-approve', event: 'blocked', reason: `${names.join(',')}: ${why}`.slice(0, 300), target: repo });
    console.error(`pg-self-approve: ODMOWA — ${why}`);
    return 1;
  };
  const now = Date.now();
  const patchFile = path.join(run, 'diff.patch');
  const patch = fs.existsSync(patchFile) ? fs.readFileSync(patchFile) : null;
  const runAgeMs = patch === null ? -1 : Math.max(0, now - fs.statSync(patchFile).mtimeMs);
  const reviewSha = patch && patch.length ? sha256(patch) : '';
  let agg = null;
  let currentSha = '';
  let findingsIds = {};
  try {
    agg = aggregate(run, path.join(run, 'verdicts.json'), { requiredRoles: rolesFor(names), final: true });
    currentSha = sha256(workingDiff(overrides.repoRoot(repo)));
    findingsIds = findingsIdsOf(run);
  } catch (e) { return refuse(`nie da sie policzyc dowodu: ${String(e.message || e).slice(0, 200)}`); }
  const findingsMtime = {};
  try { findingsMtime.verifier = fs.statSync(path.join(run, 'verdicts.json')).mtimeMs; } catch (e) { /* brak = agregacja bez werdyktow */ }
  let verdicts = [];
  try { verdicts = (JSON.parse(fs.readFileSync(path.join(run, 'verdicts.json'), 'utf8')).verdicts) || []; } catch (e) { /* brak = bez weryfikatora */ }
  const transcripts = bindTranscripts(reviewerTranscripts(run, reviewSha), reviewSha, patchFile);
  const verdict = evaluate({ names, reason, agg, runAgeMs, reviewSha, currentSha, transcripts, findingsMtime, findingsIds, verdicts, now });
  if (verdict.why) return refuse(verdict.why);
  let grants;
  try {
    grants = overrides.mintSelf(verdict.sid, repo, names, { run: path.resolve(run), run_key: runKey(reviewSha, verdict.sid), reason: String(reason).slice(0, 200) });
  } catch (e) { return refuse(String(e.message || e)); }
  gateLog.log({ hook: 'pg-self-approve', event: 'self_approved', reason: `${names.join(',')}: ${String(reason).slice(0, 200)} (run ${path.basename(run)})`, target: repo });
  console.log(`pg-self-approve: wydano ${grants.map((g) => `${g.name} (${g.uses_left} uzycia, do ${new Date(g.expires).toISOString().slice(11, 16)} UTC)`).join(', ')} ` +
    `dla repo ${overrides.repoRoot(repo)} (sesja recenzji ${verdict.sid}). Teraz komenda z ${names[0]}=1 z katalogu repo.`);
  return 0;
}

// reviewerTranscripts/bindTranscripts/findingsIdsOf: tez dla pg-merge-dowod.js (dowod recenzji T1/T2 pod auto-merge).
module.exports = {
  evaluate, runKey, rolesFor, reviewerTranscripts, bindTranscripts, transcriptProblem, findingsIdsOf,
  mentionsPath, promptOf, midTaskMessages, hasFindingsJson, leadingFindings, finalOutput, agentOverridden, findingKey, unboundVerdicts, workingDiff, sha256, norm, REQUIRED_ROLES, MAX_RUN_AGE_MS, main,
};

// exitCode, nie process.exit: stdout zdazy sie oproznic.
if (require.main === module) process.exitCode = main(process.argv.slice(2));

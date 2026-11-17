'use strict';
// overrides: wyjatki od bramek poziomow A/B/C — TTL i limity uzyc (POLICY; wlasciciel liczb cytowanych w CLAUDE.md).
// Od 2026-10-02 trzy poziomy (SELF_SERVICE / SELF_APPROVABLE / reszta) — patrz nizej; ponizszy opis dotyczy poziomu C.
// Wyjatki od bramek wydaje CZLOWIEK, nie agent (landscape #12). Do 2026-09-26 wystarczalo `ALLOW_X=1` w tresci komendy —
// tekst pisany przez agenta, wiec „swiadoma decyzja uzytkownika" byla deklaracja (probe: `git push --force origin main # ALLOW_FORCE=1`
// -> exit 0; blizna GATE-FALSE-POSITIVE-TEACHES-BYPASS). Teraz:
//  - prompt-guard (UserPromptSubmit) wybija wyjatek TYLKO, gdy CALY prompt to fraza `pozwol ALLOW_X [ALLOW_Y]`
//    (koperty <task-notification>, wklejone logi i prompty zadan nigdy nie pasuja w calosci — design review 2026-09-26),
//  - bash-guard / edit-guard zuzywaja go (TTL + limit uzyc), kazde uzycie = wpis `bypass` w gates.jsonl.
// Model zagrozen: agent idacy na skroty, nie zlosliwy proces z pelnym FS (ten obejdzie kazda bramke tekstowa).
const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_DIR = path.join(os.homedir(), '.claude', 'logs', 'overrides');
// Katalog testowy honorowany tylko w %TEMP% — zmienna srodowiskowa nie moze przekierowac produkcyjnych wyjatkow.
function overridesDir() {
  const env = process.env.PG_OVERRIDES_DIR;
  if (env) {
    const resolved = path.resolve(env);
    // Z separatorem (security-review 2026-09-26: `...\Temp2\x` przechodzilo jako „w %TEMP%").
    if (resolved.toLowerCase().startsWith(path.resolve(os.tmpdir()).toLowerCase() + path.sep)) return resolved;
  }
  return DEFAULT_DIR;
}

const POLICY = {
  ALLOW_CONTROL_PLANE: { ttlMin: 60, uses: 200 }, // praca nad samymi bramkami = wiele edycji w jednym oknie
  default: { ttlMin: 30, uses: 3 },
};
const policyFor = (name) => POLICY[name] || POLICY.default;

// Poziomy wyjatkow (uzytkownik 2026-10-02: „self approval — agentyczne petle zamiast czekania na fraze"; podzial po pg-review):
//  A SELF_SERVICE    — bramki jakosci. Agent wydaje sobie wyjatek sam (`ALLOW_X=1`), kazde uzycie = `bypass` w gates.jsonl.
//  B SELF_APPROVABLE — wyjatek po recenzji: bin/pg-self-approve.js sprawdza transkrypty subagentow-recenzentow (security+code)
//    dla TEGO diffu i wydaje wyjatek sesji recenzji, przypiety do repo (15 min / 1 uzycie, przebieg recenzji jednorazowy).
//  C reszta (CONTROL_PLANE, MERGE, SECRET, MAIN, CI_DOWNGRADE, CONFIG, FORCE, DELETE, NOVERIFY, ...) — tylko fraza uzytkownika:
//    nieodwracalne albo wylaczaja inne bramki (wtedy A i B przestaja cokolwiek gwarantowac).
// Wylacznik: plik ~/.claude/pg/self-approval.off => A i B nieaktywne, wszystko wraca do frazy uzytkownika.
const SELF_SERVICE = new Set(['ALLOW_LARGE_DIFF', 'ALLOW_PHASE', 'ALLOW_TODO', 'ALLOW_COMMENTED_CODE', 'ALLOW_DUP_LITERALS',
  'ALLOW_BOUNDARIES', 'ALLOW_STALE_BASE', 'ALLOW_MSG', 'ALLOW_FOREIGN_BRANCH', 'ALLOW_REWRITE', 'ALLOW_MERGE_INTEGRITY']);
// MERGE poza B (code-review 2026-10-02): recenzja diffu roboczego != diff PR, a CLAUDE.md wymaga frazy dla T3/kodu wrazliwego.
// Rutynowe scalenia ida przez bin/pg-merge-bezpieczny.py (wlasne dowody: CI, tier, recenzja diffu PR).
const SELF_APPROVABLE = new Set(['ALLOW_RM', 'ALLOW_RESET', 'ALLOW_CLEAN', 'ALLOW_UNKNOWN_DEP', 'ALLOW_PII']);
// Jedna recenzja = jedna akcja (security-review 2026-10-02: grant nie jest przypiety do obiektu akcji, wiec go nie mnozymy).
const SELF_APPROVAL_POLICY = { ttlMin: 15, uses: 1 };
const KILL_SWITCH = path.join(os.homedir(), '.claude', 'pg', 'self-approval.off');
const selfApprovalOff = () => fs.existsSync(KILL_SWITCH);
function tierOf(name) {
  if (selfApprovalOff()) return 'C';
  return SELF_SERVICE.has(name) ? 'A' : SELF_APPROVABLE.has(name) ? 'B' : 'C';
}

/** Korzen repo (katalog z .git) dla sciezki, bez wywolania gita — hook musi byc szybki. */
function repoRoot(dir) {
  let cur = path.resolve(String(dir || '.'));
  for (;;) {
    if (fs.existsSync(path.join(cur, '.git'))) return cur;
    const up = path.dirname(cur);
    if (up === cur) return null;
    cur = up;
  }
}

/** Kanoniczna postac korzenia repo: realpath (Windows: `USERNA~1` == `<owner>`), `/`, male litery. '' = poza repo. */
function repoKey(dir) {
  const root = repoRoot(dir);
  if (!root) return '';
  let real = root;
  try { real = fs.realpathSync.native(root); } catch (e) { /* zostaje forma rozwiazana */ }
  return real.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

// Caly prompt = fraza. Diakrytyki opcjonalne (pozwol/pozwól), wiele nazw po spacji/przecinku.
const PHRASE_RX = /^\s*(?:pozw[oó]l|zezwalam|allow)\s+((?:ALLOW_[A-Z][A-Z_]*)(?:[\s,]+ALLOW_[A-Z][A-Z_]*)*)\s*[.!]?\s*$/i;

// Aplikacja desktop dokleja PRZED prompt czlowieka bloki <system-reminder> ("Linked sessions now", "You are operating in
// a git worktree") — bez ich zdjecia fraza nie dziala w sesjach polaczonych (incydent 2026-11-14, client-app PR #5).
// Zdejmujemy TYLKO pelne bloki z POCZATKU; reszta nadal musi byc w CALOSCI fraza (PHRASE_RX ^...$). Wewnatrz bloku bywa
// tekst agenta (raport sesji pobocznej, nazwa sesji): wybicie `</system-reminder>` zostawia po frazie dalszy tekst szablonu
// i prawdziwy znacznik zamykajacy, wiec dopasowanie pada. Inne koperty (<task-notification>) dalej blokuja.
// ALLOWLISTA naglowkow (security-review 2026-11-14): zdejmujemy tylko notki statusu aplikacji. Blok spoza listy (np.
// "## You are a session started from another session" = 1. wiadomosc sesji potomnej, tresc pisze agent-rodzic, albo
// raport sesji pobocznej "The session \"…\" finished a turn") zostaje i blokuje dopasowanie — domyslnie odmowa.
// Nowy format notki aplikacji = fraza nie dziala (bezpieczny kierunek); wtedy dopisz naglowek tutaj + przypadek w testach.
// PIERWSZA wiadomosc sesji nigdy nie wydaje wyjatku po zdjeciu notek (security-review r2 2026-11-14): sesje potomne
// (start_session) dostaja jako 1. prompt notke worktree/Linked + tresc pisana przez agenta-rodzica. Dlatego notki
// wystepujace tylko na starcie sesji (worktree, scratch) nie sa na liscie, a wolajacy podaje `hasPriorTurn`.
const LEADING_REMINDER_RX = /^\s*<system-reminder>([\s\S]*?)<\/system-reminder>/;
const APP_NOTICE_HEADERS = [
  'Linked sessions now',
  "The session's working directory has changed",
  'When this session moved',
  'Before this session moved',
];

function stripLeadingReminders(prompt) {
  let s = String(prompt || '');
  for (let m = LEADING_REMINDER_RX.exec(s); m; m = LEADING_REMINDER_RX.exec(s)) {
    const body = m[1].trimStart();
    if (!APP_NOTICE_HEADERS.some((h) => body.startsWith(h))) break;
    s = s.slice(m[0].length);
  }
  return s;
}

// Tura asystenta stoi na poczatku transkryptu — czytamy tylko glowe pliku (ops-review r3: pelny odczyt 430 MB = ~1 s
// na prompt, > ~512 MB readFileSync rzuca i fraza cicho przestaje dzialac).
const TRANSCRIPT_HEAD_BYTES = 1024 * 1024;

/** Czy transkrypt sesji ma juz ture asystenta (= biezacy prompt nie jest 1. wiadomoscia sesji). Blad/brak = false. */
function transcriptHasAssistantTurn(transcriptPath) {
  let fd;
  try {
    fd = fs.openSync(String(transcriptPath || ''), 'r');
    const buf = Buffer.alloc(TRANSCRIPT_HEAD_BYTES);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    return /"type"\s*:\s*"assistant"/.test(buf.toString('utf8', 0, n));
  } catch (e) { return false; /* brak/nieczytelny transkrypt = traktuj jak 1. wiadomosc (odmowa) */ } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch (e) { /* zamkniecie nie zmienia wyniku */ }
  }
}

/**
 * Nazwy wyjatkow z promptu czlowieka albo [].
 * `hasPriorTurn` (funkcja): wolana TYLKO gdy po zdjeciu notek reszta jest fraza; false/brak = notki zostaja (odmowa).
 */
// Fraza z notkami aplikacji to ~2 KB. Dluzszy prompt = nie fraza: dopelnienie spacjami > ogona transkryptu wylaczalo
// sprawdzenie pochodzenia (turn-origin.js czyta ogon 512 KB; pg-review security 2026-11-14 F2, PoC 600 000 spacji).
const MAX_PHRASE_PROMPT = 16 * 1024;

function namesFromPrompt(prompt, { hasPriorTurn } = {}) {
  const raw = String(prompt || '');
  if (raw.length > MAX_PHRASE_PROMPT) return [];
  const stripped = stripLeadingReminders(raw);
  let text = raw;
  if (stripped !== raw && PHRASE_RX.test(stripped) && typeof hasPriorTurn === 'function' && hasPriorTurn()) text = stripped;
  const m = PHRASE_RX.exec(text);
  if (!m) return [];
  return [...new Set(m[1].toUpperCase().split(/[\s,]+/).filter(Boolean))];
}

// Jedno zrodlo prawdy dla hookow: identyfikator sesji jako bezpieczna nazwa pliku (dup-literals 2026-09-27).
const cleanSid = (sid) => String(sid || '').replace(/[^\w-]/g, '').slice(0, 80);
const safeSid = (sid) => cleanSid(sid) || 'nosession';
const CONTROL_PLANE = 'ALLOW_CONTROL_PLANE';
const fileFor = (sid) => path.join(overridesDir(), safeSid(sid) + '.json');

function read(sid) {
  try {
    const data = JSON.parse(fs.readFileSync(fileFor(sid), 'utf8'));
    return data && typeof data.grants === 'object' && data.grants ? data : { grants: {} };
  } catch (e) { return { grants: {} }; }
}

function write(sid, data) {
  const file = fileFor(sid);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.' + process.pid + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, file);
  } finally { try { fs.unlinkSync(tmp); } catch (e) { /* po rename juz nie istnieje */ } }
}

// Blokada pliku sesji (data-review 2026-09-26: has()+consume() bez blokady = rownolegle komendy przekraczaly limit uzyc).
function withLock(sid, fn) {
  const lock = fileFor(sid) + '.lock';
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  const deadline = Date.now() + 500;
  for (;;) {
    try { fs.closeSync(fs.openSync(lock, 'wx')); break; } catch (e) {
      // Porzucony lock (proces zabity) starszy niz 5 s = zdejmujemy; abs: mtime z przyszlosci po skoku zegara wstecz (ops 2026-10-02).
      try { if (Math.abs(Date.now() - fs.statSync(lock).mtimeMs) > 5000) fs.unlinkSync(lock); } catch (e2) { /* juz zniknal */ }
      if (Date.now() > deadline) throw new Error('overrides: lock timeout');
      const until = Date.now() + 10;
      while (Date.now() < until) { /* krotkie czekanie bez async w hooku */ }
    }
  }
  try { return fn(); } finally { try { fs.unlinkSync(lock); } catch (e) { /* ok */ } }
}

// Retencja: plik wyjatkow kasujemy, gdy WSZYSTKIE jego wyjatki wygasly ponad 2 dni temu — po tresci (`expires`), nie po
// mtime: 2026-10-02 zegar przeskoczyl na 2022, zapis dostal mtime 2022 i nastepne wydanie skasowalo zywy wyjatek uzytkownika.
const RETENTION_MS = 2 * 86400000;
function sweep(now) {
  let files = [];
  try { files = fs.readdirSync(overridesDir()); } catch (e) { return; /* katalog nie istnieje = nic do sprzatania */ }
  for (const f of files) {
    const p = path.join(overridesDir(), f);
    try {
      if (f.endsWith('.json')) {
        const data = JSON.parse(fs.readFileSync(p, 'utf8'));
        const ends = Object.values((data && data.grants) || {}).map((g) => Number(g && g.expires) || 0);
        const runs = Object.values((data && data.runs) || {}).map(Number);
        const last = Math.max(0, ...ends, ...runs);
        if (now - last > RETENTION_MS) fs.unlinkSync(p);
      } else if (now - fs.statSync(p).mtimeMs > RETENTION_MS) fs.unlinkSync(p); // .lock/.tmp porzucone przez zabity proces
    } catch (e) { /* plik zniknal albo nieparsowalny w trakcie zapisu — nastepne sprzatanie */ }
  }
}

/**
 * Wyjatek z frazy. `originCheck` = { prompt_id, transcript_path } promptu, ktory go wydal: pochodzenie sprawdza
 * pierwsze consume() (wpis promptu powstaje po hooku UserPromptSubmit, przed 1. narzedziem — lib/turn-origin.js).
 */
function mint(sid, names, now = Date.now(), originCheck = null) {
  // Bez session_id nie ma komu wydac wyjatku (wspolny `nosession.json` dzielilby go miedzy sesjami).
  if (!String(sid || '').trim()) throw new Error('overrides: brak session_id');
  sweep(now);
  const meta = originCheck && originCheck.prompt_id && originCheck.transcript_path
    ? { origin_check: { prompt_id: String(originCheck.prompt_id), transcript_path: String(originCheck.transcript_path) } }
    : undefined;
  return withLock(sid, () => mintLocked(sid, names, now, undefined, meta));
}

const RUNS_SID = 'self-approval-runs';
/**
 * Samozatwierdzenie poziomu B: wyjatek dla sesji recenzji, przypiety do repo (`repo` = repoKey). Wola je tylko
 * bin/pg-self-approve.js po sprawdzeniu transkryptow recenzentow; przebieg recenzji (`run`) da sie zuzyc raz.
 */
function mintSelf(sid, dir, names, meta, now = Date.now()) {
  const bad = names.filter((n) => tierOf(n) !== 'B');
  if (bad.length) throw new Error(`overrides: ${bad.join(',')} nie jest poziomu B (samozatwierdzalny)`);
  const repo = repoKey(dir);
  if (!repo) throw new Error('overrides: brak repo git dla ' + dir);
  if (!String(sid || '').trim()) throw new Error('overrides: brak session_id recenzji');
  // Klucz przebiegu = skrot TRESCI (diff + findings + werdykty), nie sciezka: kopia katalogu (`cp -a`) albo alias 8.3
  // to ten sam przebieg (data-review 2026-10-02). Liczy go pg-self-approve.js.
  const run = String((meta && meta.run_key) || '');
  if (!/^[0-9a-f]{64}$/.test(run)) throw new Error('overrides: brak run_key (skrot tresci przebiegu recenzji)');
  // Zywa zgoda uzytkownika na to samo = nic do wydania; nie palimy przebiegu na no-op (ops-review 2026-10-02).
  const fromPhrase = names.filter((n) => { const g = read(sid).grants[n]; return valid(g, now) && !g.self_approved; });
  if (fromPhrase.length) throw new Error(`overrides: sesja ma juz zgode uzytkownika na ${fromPhrase.join(',')} — samozatwierdzenie zbedne`);
  sweep(now);
  withLock(RUNS_SID, () => {
    const used = read(RUNS_SID);
    used.runs = used.runs || {};
    if (used.runs[run]) throw new Error('overrides: przebieg recenzji juz zuzyty — ten diff w tej sesji dal juz wyjatek; nowy wymaga zmiany diffu albo frazy uzytkownika');
    for (const [k, t] of Object.entries(used.runs)) if (now - Number(t) > RETENTION_MS) delete used.runs[k]; // przyciecie ksiegi
    used.runs[run] = now;
    write(RUNS_SID, used);
  });
  try {
    return withLock(sid, () => mintLocked(sid, names, now, SELF_APPROVAL_POLICY, { ...meta, repo, self_approved: true }));
  } catch (e) {
    // Grant nie powstal (np. lock timeout) — oddajemy przebieg, inaczej recenzja przepada bez wyjatku (ops-review 2026-10-02).
    withLock(RUNS_SID, () => { const used = read(RUNS_SID); if (used.runs) delete used.runs[run]; write(RUNS_SID, used); });
    throw e;
  }
}

/** Zrodlo wyjatku dla komendy w `dir`: 'session' (fraza uzytkownika), 'self-service' (A), 'self-approved' (B w tym repo) albo null. */
function sourceOf(sid, name, dir, now = Date.now()) {
  const tier = tierOf(name);
  const grant = read(sid).grants[name];
  if (valid(grant, now) && !grant.self_approved) return 'session';
  if (tier === 'A') return 'self-service';
  if (tier === 'B' && valid(grant, now) && grant.self_approved && grant.repo && grant.repo === repoKey(dir)) return 'self-approved';
  return null;
}

function mintLocked(sid, names, now, policy, meta) {
  const data = read(sid);
  for (const name of names) {
    // Samozatwierdzenie nie nadpisuje zywej zgody uzytkownika z frazy (data-review 2026-10-02).
    const cur = data.grants[name];
    if (meta && meta.self_approved && valid(cur, now) && !cur.self_approved) continue;
    const p = policy || policyFor(name);
    const next = { expires: now + p.ttlMin * 60000, uses_left: p.uses, minted_at: new Date(now).toISOString(), ...(meta || {}) };
    // Grant czekajacy na sprawdzenie pochodzenia nie niszczy zywego, juz pewnego grantu (data-review r8): poprzedni
    // (origin_verified / bez origin_check / B) wraca, gdy consume() anuluje nowy. Jeden poziom wstecz, bez lancucha:
    // nadpisywany grant sam czekajacy na sprawdzenie przekazuje dalej SWOJ pewny prev (data-review r9, dwa minty przed 1. uzyciem).
    if (meta && meta.origin_check && valid(cur, now)) {
      if (!needsOriginCheck(cur)) { const { prev, ...keep } = cur; next.prev = keep; } else if (valid(cur.prev, now)) next.prev = cur.prev;
    }
    data.grants[name] = next;
  }
  write(sid, data);
  return names.map((n) => ({ name: n, ...data.grants[n] }));
}

function valid(grant, now) {
  return !!grant && Number(grant.expires) > now && Number(grant.uses_left) > 0;
}

/** Czy jest wazny wyjatek z FRAZY (bez zuzycia). Granty B widzi tylko sourceOf (z repo) — starszy hook wolajacy has()
 *  nie moze uznac B w dowolnym repo (data-review 2026-10-02, rozjazd wersji przez Syncthing). */
function has(sid, name, now = Date.now()) {
  const grant = read(sid).grants[name];
  return valid(grant, now) && !grant.self_approved;
}

// Grant z frazy czekajacy na sprawdzenie pochodzenia promptu (luka 2026-11-14: 1. prompt sesji potomnej i inne prompty
// pisane przez agenta). Granty bez origin_check (B, starsze, prompt bez prompt_id) — jak dotad.
const needsOriginCheck = (g) => !!(g && g.origin_check && !g.origin_verified && !g.self_approved);

/**
 * Pochodzenie promptu, ktory wydal grant: 'human' albo powod odmowy. Brak wpisu = odmowa TEGO uzycia bez anulowania
 * (`pending`): wpis moze jeszcze nie lezec na dysku, gdy consume() wola rownolegly proces (subagent w tle) miedzy mintem
 * a zapisem wpisu (data-review r7) — „jeszcze nie wiem" != „nie od uzytkownika". Nastepne uzycie sprawdza ponownie.
 */
function originVerdict(grant, name) {
  const turnOrigin = require('./turn-origin');
  const check = grant.origin_check;
  // Werdykt z wpisu SAMEJ frazy (tez wpisanej w trakcie tury — kolejka CC), nie z dowolnego wpisu tury (2026-11-14 14:40).
  const isPhrase = (text) => namesFromPrompt(text, { hasPriorTurn: () => true }).includes(name);
  const o = turnOrigin.originAt(check.transcript_path, check.prompt_id, undefined, undefined, { isPhrase, mintedAt: grant.minted_at });
  if (!o) return { ok: false, pending: true, why: 'brak wpisu promptu frazy w transkrypcie' };
  if (turnOrigin.isNonHuman(o)) return { ok: false, why: `turnOrigin=${o.turnOrigin}${o.isMeta ? ', isMeta' : ''} (prompt nie od uzytkownika)` };
  return { ok: true };
}

function noteOrigin(sid, name, verdict) {
  try {
    require('./gate-log').log({ hook: 'overrides', event: verdict.ok ? 'bypass' : 'blocked',
      reason: verdict.ok ? `${name}: pochodzenie frazy potwierdzone (human)`
        : `${name} ${verdict.pending ? 'odmowa uzycia (bez anulowania)' : 'anulowany przy uzyciu'}: ${verdict.why}`, target: cleanSid(sid) });
  } catch (e) { /* log nie zmienia decyzji */ }
  if (verdict.pending) {
    process.stderr.write(`[PG] Wyjatek ${name}: ${verdict.why} — tego uzycia nie przepuszczam, sprobuj ponownie za chwile. ` +
      `Trwa to dluzej = transkrypt przyciety/zmieniony format CC: niech uzytkownik wpisze fraze ponownie.\n`);
  } else if (!verdict.ok) {
    process.stderr.write(`[PG] Wyjatek ${name} ANULOWANY: ${verdict.why}. Wyjatek wydaje tylko wiadomosc wpisana przez uzytkownika — ` +
      `jesli to byl uzytkownik, niech wpisze fraze ponownie.\n`);
  }
}

/** Werdykt pochodzenia na grancie (pod blokada, `data` = swiezy odczyt). true = grant potwierdzony (human). */
function applyVerdict(sid, data, name, verdict, now) {
  const grant = data.grants[name];
  noteOrigin(sid, name, verdict);
  if (verdict.pending) return false; // bez zapisu: grant czeka na wpis promptu
  if (!verdict.ok) {
    // Poprzedni pewny grant wraca (data-review r8); TO uzycie i tak odmowione — przyszlo z nadpisania nie od uzytkownika.
    if (grant.prev && valid(grant.prev, now)) data.grants[name] = { ...grant.prev, restored_after: verdict.why };
    else { grant.uses_left = 0; grant.revoked = verdict.why; }
    write(sid, data);
    return false;
  }
  grant.origin_verified = true;
  write(sid, data);
  return true;
}

/**
 * Rozstrzyga pochodzenie WSZYSTKICH grantow czekajacych na sprawdzenie, bez zuzycia (security-review r8-r10).
 * bash-guard/edit-guard wolaja to PRZED ocena kazdego narzedzia zapisujacego: wpis promptu lezy w transkrypcie juz
 * przed 1. narzedziem tury, wiec werdykt zapada, zanim agent mogl go przepisac — ochrona sciezek transkryptu
 * (lista komend w bash-rules) zostaje tylko druga warstwa. Ten sam werdykt co consume(); blad = nic nie zmienia.
 */
function settlePending(sid, now = Date.now()) {
  if (!String(sid || '').trim()) return;
  try {
    const grants = read(sid).grants || {};
    const todo = Object.keys(grants).filter((n) => needsOriginCheck(grants[n]) && valid(grants[n], now))
      .map((n) => ({ name: n, pid: grants[n].origin_check.prompt_id, verdict: originVerdict(grants[n], n) }))
      // „Jeszcze nie wiem" nie loguje sie przy kazdym narzedziu (code-review r11) — zglasza je dopiero consume().
      .filter((t) => !t.verdict.pending);
    if (!todo.length) return;
    withLock(sid, () => {
      const data = read(sid);
      for (const t of todo) {
        const g = data.grants[t.name];
        if (needsOriginCheck(g) && valid(g, now) && g.origin_check.prompt_id === t.pid) applyVerdict(sid, data, t.name, t.verdict, now);
      }
    });
  } catch (e) { /* fail-closed: grant dalej czeka, consume() sprawdzi sam */ }
}

/** Zuzywa jedno uzycie. true = wyjatek byl wazny (i, dla grantu z frazy, prompt frazy napisal czlowiek). */
function consume(sid, name, now = Date.now()) {
  if (!String(sid || '').trim()) return false;
  try {
    // Skan transkryptu (do 16 MB) POZA blokada — rownolegle hooki nie czekaja na odczyt pliku.
    const pending = read(sid).grants[name];
    const verdict = needsOriginCheck(pending) && valid(pending, now) ? originVerdict(pending, name) : null;
    return withLock(sid, () => {
      const data = read(sid);
      const grant = data.grants[name];
      if (!valid(grant, now)) return false;
      if (needsOriginCheck(grant)) {
        // Werdykt dotyczy TEGO promptu; grant nadpisany w miedzyczasie nowa fraza = sprawdzimy przy nastepnym uzyciu.
        const same = verdict && pending.origin_check.prompt_id === grant.origin_check.prompt_id;
        if (!same) return false;
        if (!applyVerdict(sid, data, name, verdict, now)) return false;
      }
      grant.uses_left = Number(grant.uses_left) - 1;
      write(sid, data);
      return true;
    });
  } catch (e) { return false; }
}

module.exports = { namesFromPrompt, stripLeadingReminders, transcriptHasAssistantTurn, mint, mintSelf, has, consume, settlePending, read, overridesDir, POLICY, PHRASE_RX, cleanSid, CONTROL_PLANE,
  SELF_SERVICE, SELF_APPROVABLE, tierOf, sourceOf, repoKey, repoRoot, KILL_SWITCH, MAX_PHRASE_PROMPT };

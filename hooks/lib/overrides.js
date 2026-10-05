'use strict';
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
  'ALLOW_BOUNDARIES', 'ALLOW_STALE_BASE', 'ALLOW_MSG', 'ALLOW_FOREIGN_BRANCH', 'ALLOW_REWRITE']);
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

/** Nazwy wyjatkow z promptu czlowieka albo []. */
function namesFromPrompt(prompt) {
  const m = PHRASE_RX.exec(String(prompt || ''));
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

function mint(sid, names, now = Date.now()) {
  // Bez session_id nie ma komu wydac wyjatku (wspolny `nosession.json` dzielilby go miedzy sesjami).
  if (!String(sid || '').trim()) throw new Error('overrides: brak session_id');
  sweep(now);
  return withLock(sid, () => mintLocked(sid, names, now));
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
    data.grants[name] = { expires: now + p.ttlMin * 60000, uses_left: p.uses, minted_at: new Date(now).toISOString(), ...(meta || {}) };
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

/** Zuzywa jedno uzycie. true = wyjatek byl wazny. */
function consume(sid, name, now = Date.now()) {
  if (!String(sid || '').trim()) return false;
  try {
    return withLock(sid, () => {
      const data = read(sid);
      const grant = data.grants[name];
      if (!valid(grant, now)) return false;
      grant.uses_left = Number(grant.uses_left) - 1;
      write(sid, data);
      return true;
    });
  } catch (e) { return false; }
}

module.exports = { namesFromPrompt, mint, mintSelf, has, consume, read, overridesDir, POLICY, PHRASE_RX, cleanSid, CONTROL_PLANE,
  SELF_SERVICE, SELF_APPROVABLE, tierOf, sourceOf, repoKey, repoRoot, KILL_SWITCH };

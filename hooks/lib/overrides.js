'use strict';
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
      // Porzucony lock (proces zabity) starszy niz 5 s = zdejmujemy.
      try { if (Date.now() - fs.statSync(lock).mtimeMs > 5000) fs.unlinkSync(lock); } catch (e2) { /* juz zniknal */ }
      if (Date.now() > deadline) throw new Error('overrides: lock timeout');
      const until = Date.now() + 10;
      while (Date.now() < until) { /* krotkie czekanie bez async w hooku */ }
    }
  }
  try { return fn(); } finally { try { fs.unlinkSync(lock); } catch (e) { /* ok */ } }
}

// Retencja: pliki wyjatkow starsze niz 2 dni = sesje zakonczone; sprzatamy przy kazdym wydaniu.
function sweep(now) {
  try {
    for (const f of fs.readdirSync(overridesDir())) {
      const p = path.join(overridesDir(), f);
      if (now - fs.statSync(p).mtimeMs > 2 * 86400000) fs.unlinkSync(p);
    }
  } catch (e) { /* katalog nie istnieje = nic do sprzatania */ }
}

function mint(sid, names, now = Date.now()) {
  // Bez session_id nie ma komu wydac wyjatku (wspolny `nosession.json` dzielilby go miedzy sesjami).
  if (!String(sid || '').trim()) throw new Error('overrides: brak session_id');
  sweep(now);
  return withLock(sid, () => mintLocked(sid, names, now));
}

function mintLocked(sid, names, now) {
  const data = read(sid);
  for (const name of names) {
    const p = policyFor(name);
    data.grants[name] = { expires: now + p.ttlMin * 60000, uses_left: p.uses, minted_at: new Date(now).toISOString() };
  }
  write(sid, data);
  return names.map((n) => ({ name: n, ...data.grants[n] }));
}

function valid(grant, now) {
  return !!grant && Number(grant.expires) > now && Number(grant.uses_left) > 0;
}

/** Czy jest wazny wyjatek (bez zuzycia). */
function has(sid, name, now = Date.now()) {
  return valid(read(sid).grants[name], now);
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

module.exports = { namesFromPrompt, mint, has, consume, read, overridesDir, POLICY, PHRASE_RX, cleanSid, CONTROL_PLANE };

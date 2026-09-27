#!/usr/bin/env node
'use strict';
// pg-seal (landscape #11): pieczec warstwy kontrolnej PG — sha256 hookow, git-hookow i narzedzi, ktore wola pre-commit.
// Zmiana bajtu poza swiadomym oknem (bez `node pg-seal.js` po review) = RED w guard_health + ostrzezenie przy SessionStart.
// Chroni przed sciezkami zapisu, ktorych nie widza bash-guard/edit-guard (np. skrypt Pythona z zaciemniona sciezka).
// Zapis pieczeci (hooks/.seal.json) to zmiana warstwy kontrolnej -> tylko za zgoda uzytkownika (`pozwol ALLOW_CONTROL_PLANE`).
// Uzycie: node pg-seal.js            -> zapisuje pieczec
//         node pg-seal.js --check    -> exit 0 zgodna / 1 rozjazd (lista plikow) / 3 brak pieczeci
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const { CONTROL_PLANE } = require(path.join(CLAUDE_DIR, 'hooks', 'lib', 'overrides.js'));
const SEAL = path.join(CLAUDE_DIR, 'hooks', '.seal.json');
// Narzedzia bin/ wolane przez git-hooki i stop-gate: skasowanie/podmiana = cicho wylaczona bramka (design review 2026-09-26).
const GATE_TOOLS = ['base-check.js', 'dup-literals.js', 'commented-code-gate.js', 'phase-gate.js', 'todo-ledger-gate.js', 'pii-inventory-gate.js',
  'dep-exists.js', 'sql-migration-lint.js', 'diff-size-gate.js', 'module-boundaries.js', 'env-ref-gate.js', 'pg-aggregate.js', 'pg-eval.js', 'pg-mutate.js', 'pg-seal.js',
  // Wpiecia na drugim komputerze (security-review 2026-09-27): skrypty + migawka, ktora trafia do settings.json laptopa.
  'pg-wire.js', 'pg-sync.js'];

function sealedFiles() {
  const list = (dir, rx) => { try { return fs.readdirSync(dir).filter((f) => rx.test(f)).map((f) => path.join(dir, f)); } catch (e) { return []; } };
  return [
    ...list(path.join(CLAUDE_DIR, 'hooks'), /\.(js|py)$/),
    ...list(path.join(CLAUDE_DIR, 'hooks', 'lib'), /\.js$/),
    ...list(path.join(CLAUDE_DIR, 'git-hooks'), /^[\w-]+$/),
    ...GATE_TOOLS.map((f) => path.join(CLAUDE_DIR, 'bin', f)),
    path.join(CLAUDE_DIR, 'pg', 'settings-hooks.json'),
  ];
}

const rel = (p) => path.relative(CLAUDE_DIR, p).replace(/\\/g, '/');
function digest(file) {
  try { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); } catch (e) { return 'MISSING'; }
}

function current() {
  return Object.fromEntries(sealedFiles().map((f) => [rel(f), digest(f)]));
}

// Pieczec jest wazna tylko, gdy powstala w oknie zgody uzytkownika: w logu bramek jest `minted ...ALLOW_CONTROL_PLANE`
// (prompt-guard) w ciagu 60 min przed `sealed_at`. Weryfikator 2026-09-26: kopia pg-seal.js w %TEMP% przepieczetowywala
// hooki bez zadnej bramki — zapisu nie zablokujemy (dowolny proces moze pisac plik), ale WYKRYJEMY pieczec bez zgody.
const GRANT_WINDOW_MS = 60 * 60000;
function sealAuthorized(sealedAt) {
  const t = Date.parse(sealedAt);
  if (!t) return false;
  const logs = ['gates.1.jsonl', 'gates.jsonl'].map((f) => { try { return fs.readFileSync(path.join(CLAUDE_DIR, 'logs', f), 'utf8'); } catch (e) { return ''; } }).join('\n');
  return logs.split('\n').some((line) => {
    if (!line.includes(CONTROL_PLANE) || !line.includes('minted')) return false;
    try { const e = JSON.parse(line); const m = Date.parse(e.ts); return e.hook === 'prompt-guard' && !e.redirected && m <= t && t - m <= GRANT_WINDOW_MS; } catch (e) { return false; }
  });
}

function check() {
  let seal;
  try { seal = JSON.parse(fs.readFileSync(SEAL, 'utf8')); } catch (e) { process.stdout.write('pg-seal: brak pieczeci (hooks/.seal.json)\n'); return 3; }
  if (!sealAuthorized(seal.sealed_at)) {
    process.stdout.write(`pg-seal: PIECZEC BEZ ZGODY — ${seal.sealed_at} nie miesci sie w oknie „pozwol ALLOW_CONTROL_PLANE" z logu bramek. Ktos przepieczetowal hooki poza oknem uzytkownika; przejrzyj git -C ~/.claude diff.\n`);
    return 1;
  }
  const now = current();
  const changed = [];
  for (const [file, hash] of Object.entries(seal.files || {})) if (now[file] !== hash) changed.push(now[file] === 'MISSING' ? `${file} (USUNIETY)` : file);
  for (const file of Object.keys(now)) if (!(file in (seal.files || {}))) changed.push(`${file} (nowy, poza pieczecia)`);
  if (!changed.length) { process.stdout.write(`pg-seal: zgodna (${Object.keys(now).length} plikow, pieczec ${seal.sealed_at})\n`); return 0; }
  process.stdout.write(`pg-seal: ROZJAZD od ${seal.sealed_at}: ${changed.slice(0, 8).join(', ')}${changed.length > 8 ? ` (+${changed.length - 8})` : ''} — przejrzyj git diff; swiadoma zmiana = node ~/.claude/bin/pg-seal.js\n`);
  return 1;
}

function write() {
  const files = current();
  const tmp = SEAL + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ sealed_at: new Date().toISOString(), files }, null, 1) + '\n');
  fs.renameSync(tmp, SEAL);
  process.stdout.write(`pg-seal: zapieczetowano ${Object.keys(files).length} plikow -> ${SEAL}\n`);
  return 0;
}

module.exports = { current, sealedFiles, SEAL };
if (require.main === module) process.exit(process.argv.includes('--check') ? check() : write());

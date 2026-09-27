#!/usr/bin/env node
// PreCompact hook (2026-09-26, pytanie uzytkownika: „compact gubi sens i kontekst"). Tuz PRZED kompakcja zapisuje
// deterministyczna migawke sesji (0 tokenow, bez modelu): ostatnie polecenia uzytkownika, edytowane pliki, ostatnia odpowiedz.
// Po kompakcji session-context.js (SessionStart, source=compact) wstrzykuje ja z powrotem — docs Claude Code: wyjscie
// SessionStart(compact) trafia do skompaktowanego kontekstu, a kontekst dodany wczesniej przez hooki ginie w streszczeniu.
// Nigdy nie blokuje kompakcji (exit 0 zawsze). Migawka: ~/.claude/logs/precompact/<session_id>.md (nadpisywana).
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { log, noteInputKeys } = require('./lib/gate-log');
const { cleanSid } = require('./lib/overrides');

// PG_PRECOMPACT_DIR = katalog testow; honorowany tylko w %TEMP% (ten sam wzorzec co PG_GATE_LOG — code-review runda 3:
// test pisal i sprzatal PRODUKCYJNY katalog migawek).
const real = (p) => { try { return fs.realpathSync.native(p).toLowerCase(); } catch (e) { return ''; } }; // 8.3 vs dluga nazwa
const envDir = process.env.PG_PRECOMPACT_DIR && real(process.env.PG_PRECOMPACT_DIR).startsWith(real(os.tmpdir()) + path.sep) ? path.resolve(process.env.PG_PRECOMPACT_DIR) : '';
// Ustawiony, ale odrzucony PG_PRECOMPACT_DIR = migawka NIE powstaje (pusty DIR), zamiast cicho pisac i sprzatac
// produkcyjny katalog (code/data-review 2026-09-27). Hook nie moze blokowac kompakcji, wiec bez exit 2.
const DIR = process.env.PG_PRECOMPACT_DIR ? envDir : path.join(os.homedir(), '.claude', 'logs', 'precompact');
const MAX_PROMPTS = 4;
const MAX_FILES = 15;
const CLIP = 600;
// Transkrypty maja setki MB (data-review: 275 MB = 3-4,6 s; >512 MB = limit stringa V8). Czytamy tylko ogon.
const TAIL_BYTES = 16 * 1024 * 1024;
const RETENTION_MS = 14 * 24 * 3600 * 1000;

// Tekst uzytkownika bez kopert (task-notification, system-reminder, wklejki) — te same koperty co w prompt-guard.
const stripEnvelopes = (t) => String(t || '')
  .replace(/<(task-notification|system-reminder|pasted_content|command-\w+|local-command-stdout|local-command-caveat|agent-message|bash-stdout|bash-stderr|bash-input)\b[\s\S]*?<\/\1[^>]*>/gi, '')
  .replace(/\[Image[^\]]*\]/g, '').trim();
const clip = (t, n) => (t.length > n ? t.slice(0, n) + ' […]' : t);
// Migawka lezy na dysku jawnym tekstem (ops-review): tokeny wklejone w prompt maskujemy przed zapisem.
const SECRET_RX = /\b(ghp_|gho_|github_pat_|sk-ant-|sk-|sbp_|xox[abp]-|AKIA)[A-Za-z0-9_-]{8,}|\bBearer\s+[A-Za-z0-9._-]{20,}|\b[A-Fa-f0-9]{40,}\b|\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
// PII (ops-review runda 3): e-mail, kennitala (DDMMYY-NNNN), telefon z kierunkowym, IBAN, numer karty.
const PII_RX = /[\w.+-]+@[\w-]+\.[\w.-]+|\b\d{6}-?\d{4}\b|\+\d{2,3}[\s-]?\d{3}[\s-]?\d{3,4}(?:[\s-]?\d{2,3})?\b|\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){3,7}\b|\b(?:\d[ -]?){13,19}\b/g;
const redact = (t) => String(t || '').replace(SECRET_RX, '[REDACTED]').replace(PII_RX, '[PII]');
// Wpisy „user", ktore nie sa poleceniami uzytkownika: streszczenie kompakcji, meta, echo hookow i skilli.
const NOT_A_PROMPT_RX = /^(Stop hook feedback|Base directory for this skill|This session is being continued|Caveat: The messages below)/;

function readTail(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - TAIL_BYTES);
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    const lines = buf.toString('utf8').split('\n');
    return start > 0 ? lines.slice(1) : lines; // pierwsza linia ogona jest urwana
  } finally { fs.closeSync(fd); }
}

function readTranscript(file) {
  const prompts = [];
  const edited = [];
  let lastAnswer = '';
  let lines = [];
  try { lines = readTail(file); } catch (e) { return { prompts, edited, lastAnswer }; }
  for (const line of lines) {
    if (!line.trim()) continue;
    let e;
    try { e = JSON.parse(line); } catch (err) { continue; }
    if (e.isSidechain || e.isCompactSummary || e.isMeta) continue;
    const content = e.message && e.message.content;
    // Wiadomosc wyslana W TRAKCIE tury nie jest wpisem „user", tylko zalacznikiem queued_command (sprawdzone na transkrypcie).
    const queued = e.attachment && e.attachment.type === 'queued_command' && typeof e.attachment.prompt === 'string' ? stripEnvelopes(e.attachment.prompt) : '';
    if (queued && !NOT_A_PROMPT_RX.test(queued)) { prompts.push(queued); continue; }
    if (e.type === 'user') {
      const text = typeof content === 'string' ? content : Array.isArray(content) ? content.filter((b) => b && b.type === 'text').map((b) => b.text).join('\n') : '';
      const clean = stripEnvelopes(text);
      // Resztka zamykajacego tagu = koperta zamknieta za wczesnie literalem w srodku (weryfikator runda 3) — cale wejscie odpada.
      if (clean && !NOT_A_PROMPT_RX.test(clean) && !/<\/(task-notification|system-reminder|agent-message|pasted_content|bash-stdout)/i.test(clean)) prompts.push(clean);
    } else if (e.type === 'assistant' && Array.isArray(content)) {
      const text = content.filter((b) => b && b.type === 'text').map((b) => b.text).join('\n').trim();
      if (text) lastAnswer = text;
      for (const b of content) {
        const fp = b && b.type === 'tool_use' && b.input && (b.input.file_path || b.input.path || b.input.notebook_path);
        if (fp && /^(Edit|Write|MultiEdit|NotebookEdit|mcp__desktop-commander__(write_file|edit_block))$/.test(b.name)) edited.push(fp);
      }
    }
  }
  return { prompts: prompts.slice(-MAX_PROMPTS), edited: [...new Set(edited.reverse())].slice(0, MAX_FILES), lastAnswer };
}

function main() {
  let input = {};
  try { input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch (e) { return; }
  noteInputKeys('precompact-snapshot', input); // format wejscia PreCompact nie byl potwierdzony w docs — zbieramy go na zywo
  const sid = cleanSid(input.session_id);
  if (!sid || !input.transcript_path) return;
  if (!DIR) { log({ hook: 'precompact-snapshot', event: 'skipped', reason: `sid=${sid} PG_PRECOMPACT_DIR poza %TEMP% albo nie istnieje — migawka pominieta`, target: input.cwd || '' }); return; }
  const t = readTranscript(input.transcript_path);
  // Pusta migawka nie nadpisuje dobrej z poprzedniej kompakcji (data-review).
  if (!t.prompts.length && !t.edited.length && !t.lastAnswer) {
    log({ hook: 'precompact-snapshot', event: 'skipped', reason: `sid=${sid} transkrypt bez polecen/edycji — migawka nie nadpisana`, target: input.cwd || '' });
    return;
  }
  const body = redact([
    `# Migawka sprzed kompakcji — ${new Date().toISOString()} (trigger: ${input.trigger || 'nieznany'})`,
    '',
    '## Ostatnie polecenia uzytkownika (najnowsze na dole)',
    ...t.prompts.map((p, i) => `${i + 1}. ${clip(p.replace(/\s+/g, ' '), CLIP)}`),
    '',
    '## Pliki edytowane w sesji (najnowsze pierwsze)',
    // Sciezka z \n mogla by podrobic naglowek sekcji (security-review) — jedna linia, bez znakow kontrolnych.
    ...(t.edited.length ? t.edited.map((f) => `- ${String(f).replace(/[\u0000-\u001f]+/g, ' ').slice(0, 300)}`) : ['- (brak)']),
    '',
    '## Ostatnia odpowiedz asystenta (fragment)',
    clip(t.lastAnswer, 1500),
  ].join('\n'));
  fs.mkdirSync(DIR, { recursive: true });
  const file = path.join(DIR, sid + '.md');
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, body + '\n');
  try { fs.renameSync(tmp, file); } catch (e) { try { fs.unlinkSync(tmp); } catch (e2) { /* juz nie ma */ } throw e; }
  sweep(sid);
  log({ hook: 'precompact-snapshot', event: 'ran', reason: `sid=${sid} snapshot ${t.prompts.length} promptow, ${t.edited.length} plikow`, target: input.cwd || '' });
}

// Retencja: migawki starsze niz 14 dni i osierocone .tmp znikaja (data-review: katalog rosl bez limitu).
function sweep(keepSid) {
  const now = Date.now();
  for (const name of fs.readdirSync(DIR)) {
    if (name.startsWith(keepSid + '.md') && !name.endsWith('.tmp')) continue;
    const full = path.join(DIR, name);
    try {
      const age = now - fs.statSync(full).mtimeMs;
      if (age > RETENTION_MS || (name.endsWith('.tmp') && age > 3600 * 1000)) fs.unlinkSync(full);
    } catch (e) { /* rownolegla sesja mogla juz usunac */ }
  }
}

module.exports = { readTranscript, stripEnvelopes, redact, DIR };

if (require.main === module) {
  try { main(); } catch (e) {
    try { log({ hook: 'precompact-snapshot', event: 'skipped', reason: 'internal error: ' + String(e && e.message || e).slice(0, 120), target: process.cwd() }); } catch (e2) { /* telemetria nie moze zablokowac kompakcji */ }
  }
  process.exit(0);
}

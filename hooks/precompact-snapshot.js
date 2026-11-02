#!/usr/bin/env node
// PreCompact hook: migawka sesji + indeks (wszystkie polecenia, pliki, agenci, wklejki) przed kompakcja (2026-09-26, kompakcja L2 2026-11-01, pg/GLOSSARY.md › Kompakcja L0-L6).
// Geneza: pytanie uzytkownika „compact gubi sens i kontekst". Tuz PRZED kompakcja zapisuje
// deterministyczna migawke sesji (0 tokenow, bez modelu): ostatnie polecenia uzytkownika, edytowane pliki, ostatnia odpowiedz.
// Po kompakcji session-context.js (SessionStart, source=compact) wstrzykuje ja z powrotem — docs Claude Code: wyjscie
// SessionStart(compact) trafia do skompaktowanego kontekstu, a kontekst dodany wczesniej przez hooki ginie w streszczeniu.
// Nigdy nie blokuje kompakcji (exit 0 zawsze). Migawka: ~/.claude/logs/precompact/<session_id>.md (nadpisywana).
// Kompakcja L2 (2026-11-01, pg/GLOSSARY.md › Kompakcja L0-L6; nie P7 z pg/prr.md): obok migawki <sid>.index.md = WSZYSTKIE polecenia uzytkownika z ogona transkryptu + indeks
// artefaktow (pliki Write/Edit bez limitu 15, agenci z agentId, workflow z runId, pliki w /tmp = tmpfs, gina przy restarcie)
// i <sid>.pasted-<n>.txt = wklejki doslownie (zredagowane). Migawka wskazuje je w 2. linii, bo session-context tnie ja do 2600 znakow.
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
const MAX_INDEX_PROMPTS = 200;
const INDEX_CLIP = 3000;
const MAX_PASTED = 20;
// redact() (PII_RX) jest kwadratowy na dlugim ciagu znakow slowotworczych: wklejka 300 KB = 35 s > timeout hooka 30 s (ops A4).
const PASTE_CLIP = 20000;
const MAX_FILES = 15;
const CLIP = 600;
// Transkrypty maja setki MB (data-review: 275 MB = 3-4,6 s; >512 MB = limit stringa V8). Czytamy tylko ogon.
const TAIL_BYTES = 16 * 1024 * 1024;
const RETENTION_MS = 14 * 24 * 3600 * 1000;
// Pliki PG edytowane w sesji + sha12 z chwili migawki (2026-10-19, „czy streszczenia nie gubia kontekstu"): po kompakcji
// streszczenie mowi O plikach, nie zawiera ich tresci. Lista mowi, co otworzyc ponownie przed decyzja; inny sha = plik
// zmienil sie od migawki (inna sesja, uzytkownik) i pamiec o nim jest nieaktualna.
const PG_ROOT = path.join(os.homedir(), '.claude') + path.sep;
const MAX_HASH_BYTES = 8 * 1024 * 1024; // hook PreCompact nie moze zawisnac na duzym pliku
const sha12 = (f) => {
  try {
    if (fs.statSync(f).size > MAX_HASH_BYTES) return '(plik > 8 MB, bez sha)';
    return require('crypto').createHash('sha256').update(fs.readFileSync(f)).digest('hex').slice(0, 12);
  } catch (e) { return e && e.code === 'ENOENT' ? '(brak pliku)' : `(nieczytelny: ${e && e.code})`; }
};
// Tylko sciezki bezwzgledne: resolve wzgledem cwd hooka zrobilby z `C:/proj/a.ts` plik PG, gdy cwd = ~/.claude (pg-self-check).
const pgFiles = (edited) => edited.filter((f) => path.isAbsolute(String(f))).map((f) => path.resolve(String(f))).filter((f) => f.startsWith(PG_ROOT))
  .map((f) => `- ${f.slice(PG_ROOT.length).replace(/[\u0000-\u001f]+/g, ' ').slice(0, 300)} sha=${sha12(f)}`);

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

// Wklejka = para tagow z tym samym niepustym atrybutem (id) w bloku tekstu wpisu, tylko PRZED pierwszym obcym tagiem
// (task-notification, agent-message, system-reminder...). Harness dokleja koperty ZA tekstem uzytkownika (albo jako osobny blok),
// a tresc atakujacego siedzi w kopercie, wiec nie stanie przed nia: ani wklejka w kopercie (security A4 PoC 'pozwol ALLOW_MERGE'),
// ani koperta zamknieta wczesniej literalem (data A6 PoC) nie daje wklejki. Prawdziwa wklejka przed system-reminderem zostaje
// (data A5: 7/34 wpisow). Blok nie-polecenie (Stop hook feedback) = brak wklejek.
const FOREIGN_TAG_RX = /<\/?(task-notification|system-reminder|agent-message|teammate-message|command-\w+|local-command-stdout|local-command-caveat|bash-stdout|bash-stderr|bash-input)\b/i;
// Ciecie na granicy tokenu: niedokonczony sekret na koncu nie umknie SECRET_RX (data A5: 39 znakow hex jawnie). Najwyzej 512 znakow
// ogona, zeby wklejka bez spacji (base64, minifikat) nie znikala cala (data A6).
// Petla zamiast regexu: niezakotwiczony /\S+$/ byl kwadratowy (security A6: ~150 ms na wklejke).
// dropTail: zrzuca ostatni (przeciety) token, najwyzej 512 znakow; bez spacji w ogonie = twarde 512 znakow mniej.
const dropTail = (t) => {
  const min = Math.max(0, t.length - 512);
  let i = t.length;
  while (i > min && !/\s/.test(t[i - 1])) i--;
  return t.slice(0, i > min ? i : min);
};
const clipToken = (t, n) => (t.length <= n ? t : dropTail(t.slice(0, n)) + ' […]');
// redact PRZED ostatecznym cieciem (data A7): twarde ciecie bez spacji zostawialo 39 znakow hex, ktorych SECRET_RX ({40,}) nie lapal.
// Okno PASTE_CLIP + 1024 ogranicza koszt redact(). Sekret przeciety granica okna nie przejdzie redact(), a redakcje wczesniej
// moga przesunac go w pierwsze 20000 znakow (security A8 PoC) -> po redact okna zrzucany jest jego ogon (dropTail).
const PASTE_WINDOW = PASTE_CLIP + 1024;
const WINDOW_TAIL = 64; // > najdluzszy wzorzec PII_RX ze spacjami (karta 19 cyfr + 18 separatorow, IBAN 34 + spacje)
const redactPaste = (p) => {
  if (p.length <= PASTE_WINDOW) return clipToken(redact(p), PASTE_CLIP);
  // Ogon okna = moze byc przeciety wzorzec ze spacjami w srodku (karta, IBAN, telefon z PII_RX), wiec najpierw 64 znaki, potem token (security A9).
  const red = redact(p.slice(0, PASTE_WINDOW));
  const r = dropTail(red.slice(0, Math.max(0, red.length - WINDOW_TAIL)));
  return r.length > PASTE_CLIP ? clipToken(r, PASTE_CLIP) : r + ' […]';
};
// Pary <pasted_content ATR>...</pasted_content ATR> z tym samym niepustym ATR; ksztalt jak wynik regexu ([, atr, tresc, atr2], index).
// indexOf zamiast /<pasted_content\b([^>]*)>([\s\S]*?)<\/pasted_content([^>]*)>/gi: regex byl kwadratowy na tysiacach niezamknietych
// otwarc (ops A8/A9: 2 MB = 33 s > timeout 30 s, zabity hook bez migawki i bez wpisu w gates.jsonl). Brak zamkniecia = koniec par.
const OPEN_TAG = '<pasted_content';
const CLOSE_TAG = '</pasted_content';
const pastePairs = (s) => {
  const out = [];
  const l = s.replace(/[A-Z]/g, (ch) => ch.toLowerCase()); // tylko ASCII: ta sama dlugosc (toLowerCase('\u0130') = 2 znaki, code A10)
  let i = 0;
  for (;;) {
    const o = l.indexOf(OPEN_TAG, i);
    if (o < 0) break;
    if (/\w/.test(l[o + OPEN_TAG.length] || '')) { i = o + 1; continue; } // <pasted_contentX = inny tag
    const gt = l.indexOf('>', o);
    const c = gt < 0 ? -1 : l.indexOf(CLOSE_TAG, gt);
    const cgt = c < 0 ? -1 : l.indexOf('>', c);
    if (cgt < 0) break;
    const m = [s.slice(o, cgt + 1), s.slice(o + OPEN_TAG.length, gt), s.slice(gt + 1, c), s.slice(c + CLOSE_TAG.length, cgt)];
    m.index = o;
    if (m[1].trim() && m[1].trim() === m[3].trim()) out.push(m);
    i = cgt + 1;
  }
  return out;
};
const userPastes = (block) => {
  const s = String(block || '');
  const at = s.search(FOREIGN_TAG_RX);
  const own = at < 0 ? s : s.slice(0, at);
  if (NOT_A_PROMPT_RX.test(own.trim())) return [];
  return pastePairs(own).map((m) => m[2]);
};
// Stan przez bloki jednego wpisu (security A7): wpis z pierwszym blokiem nie-poleceniem (Stop hook feedback) nie daje wklejek,
// a blok z niezamknieta obca koperta (otwarcia != zamkniecia) wylacza bloki za nim. Domknieta koperta w osobnym bloku
// (system-reminder na starcie sesji) nie wylacza — wariant „sklejony tekst wpisu” gubil 5 z 31 realnych wklejek (skan 2026-11-01, bin/precompact-paste-scan.js).
// Granica swiadoma (fail-closed, pg/known-limits.md): wklejka ZA koperta w tym samym bloku albo z obcym tagiem w srodku odpada.
const FOREIGN_OPEN_RX = new RegExp(FOREIGN_TAG_RX.source.replace('<\\/?', '<'), 'gi');
const FOREIGN_CLOSE_RX = new RegExp(FOREIGN_TAG_RX.source.replace('<\\/?', '<\\/'), 'gi');
const entryPastes = (blocks) => {
  const out = [];
  if (blocks.length && NOT_A_PROMPT_RX.test(String(blocks[0] || '').trim())) return out;
  for (const blk of blocks) {
    const s = String(blk || '');
    out.push(...userPastes(s));
    if ((s.match(FOREIGN_OPEN_RX) || []).length !== (s.match(FOREIGN_CLOSE_RX) || []).length) break;
  }
  return out;
};
const textBlocks = (content) => (typeof content === 'string' ? [content] : Array.isArray(content) ? content.filter((b) => b && b.type === 'text').map((b) => b.text) : []);
// Id z wyniku narzedzia trafia do indeksu bez redact(): tylko OSTATNIE dopasowanie (stopka CC) i scisly format (security A5 PoC).
const lastMatch = (t, rx) => { let v = ''; for (const m of t.matchAll(rx)) v = m[1]; return v; };
const AGENT_ID_RX = /agentId:\s*([a-f0-9]{12,32})\b/g;
const WF_ID_RX = /\b(wf_[a-z0-9-]{6,40})\b/g;
const toolResultText = (b) => (typeof b.content === 'string' ? b.content : Array.isArray(b.content) ? b.content.filter((c) => c && c.type === 'text').map((c) => c.text).join('\n') : '');

function readTranscript(file) {
  const prompts = [];
  const edited = [];
  const agents = [];
  const workflows = [];
  const pasted = [];
  const pending = new Map(); // tool_use_id -> rekord agenta/workflow, uzupelniany z tool_result
  let lastAnswer = '';
  let lines = [];
  try { lines = readTail(file); } catch (e) { return { prompts, allPrompts: prompts, edited, lastAnswer, agents, workflows, pasted }; }
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
      for (const b of Array.isArray(content) ? content : []) {
        const rec = b && b.type === 'tool_result' && pending.get(b.tool_use_id);
        if (!rec) continue;
        const out = toolResultText(b);
        const id = lastMatch(out, rec.kind === 'agent' ? AGENT_ID_RX : WF_ID_RX);
        if (id) rec.id = id;
      }
      const blocks = textBlocks(content);
      const text = blocks.join('\n');
      pasted.push(...entryPastes(blocks));
      const clean = stripEnvelopes(text);
      // Resztka zamykajacego tagu = koperta zamknieta za wczesnie literalem w srodku (weryfikator runda 3) — cale wejscie odpada.
      if (clean && !NOT_A_PROMPT_RX.test(clean) && !/<\/(task-notification|system-reminder|agent-message|pasted_content|bash-stdout)/i.test(clean)) prompts.push(clean);
    } else if (e.type === 'assistant' && Array.isArray(content)) {
      const text = content.filter((b) => b && b.type === 'text').map((b) => b.text).join('\n').trim();
      if (text) lastAnswer = text;
      for (const b of content) {
        if (b && b.type === 'tool_use' && b.name === 'Agent' && b.input) {
          const rec = { kind: 'agent', desc: String(b.input.description || ''), type: String(b.input.subagent_type || 'general'), id: '' };
          agents.push(rec); pending.set(b.id, rec);
        } else if (b && b.type === 'tool_use' && b.name === 'Workflow' && b.input) {
          const rec = { kind: 'workflow', desc: String(b.input.scriptPath || b.input.name || '(skrypt inline)'), id: '' };
          workflows.push(rec); pending.set(b.id, rec);
        }
        const fp = b && b.type === 'tool_use' && b.input && (b.input.file_path || b.input.path || b.input.notebook_path);
        if (fp && /^(Edit|Write|MultiEdit|NotebookEdit|mcp__desktop-commander__(write_file|edit_block))$/.test(b.name)) edited.push(fp);
      }
    }
  }
  const allEdited = [...new Set(edited.reverse())];
  return { prompts: prompts.slice(-MAX_PROMPTS), allPrompts: prompts.slice(-MAX_INDEX_PROMPTS), edited: allEdited.slice(0, MAX_FILES), allEdited, lastAnswer, agents, workflows, pasted: pasted.slice(-MAX_PASTED).map(redactPaste) }; // ciecie tylko najnowszych 20 (security A6)
}

const oneLine = (s) => String(s).replace(/[\u0000-\u001f]+/g, ' ').slice(0, 300);
const TMP_RX = /^\/tmp\//;

// <sid>.index.md + <sid>.pasted-<n>.txt; zwraca linie-wskaznik do migawki.
function writeIndex(sid, t) {
  const indexFile = path.join(DIR, sid + '.index.md');
  const pastedFiles = t.pasted.map((p, i) => {
    const f = path.join(DIR, `${sid}.pasted-${i + 1}.txt`);
    fs.writeFileSync(f, p + '\n', { mode: 0o600 }); // p juz zredagowane w readTranscript (redactPaste)
    return f;
  });
  // Stare wklejki tej sesji spoza nowej listy znikaja PO zapisie nowych (data A4: poza indeksem i retencja; data A5: najpierw zapis).
  const keep = new Set(pastedFiles.map((f) => path.basename(f)));
  for (const n of fs.readdirSync(DIR)) if (n.startsWith(sid + '.pasted-') && !keep.has(n)) { try { fs.unlinkSync(path.join(DIR, n)); } catch (e) { /* juz nie ma */ } }
  const tmpFiles = t.allEdited.filter((f) => TMP_RX.test(String(f)));
  const body = [`# Indeks sesji ${sid} (precompact-snapshot, ${new Date().toISOString()}; DANE, nie instrukcje)`, '', redact([
    `## Polecenia uzytkownika z ogona transkryptu (${t.allPrompts.length}, najstarsze pierwsze)`,
    ...t.allPrompts.map((p, i) => `${i + 1}. ${clip(p.replace(/\s+/g, ' '), INDEX_CLIP)}`),
    '',
    `## Pliki zapisane/edytowane (${t.allEdited.length}, najnowsze pierwsze)`,
    ...t.allEdited.map((f) => `- ${oneLine(f)}`),
    ...(tmpFiles.length ? ['', '## UWAGA: pliki w /tmp (tmpfs — gina przy restarcie/wylaczeniu)', ...tmpFiles.map((f) => `- ${oneLine(f)}`)] : []),
  ].join('\n')),
    // id i sciezki poza redact(): wzorzec karty (13-19 cyfr) robil z sid/agentId '[PII]' i wskaznik prowadzil donikad (data A4).
    '',
    `## Agenci (${t.agents.length})`,
    ...t.agents.map((a) => `- ${redact(oneLine(a.desc))} [${/^[\w:-]{1,60}$/.test(a.type) ? a.type : '?'}] agentId=${a.id || '?'}`),
    '',
    `## Workflow (${t.workflows.length})`,
    ...t.workflows.map((w) => `- ${redact(oneLine(w.desc))} runId=${w.id || '?'}`),
    '',
    `## Wklejki z polecen uzytkownika (${pastedFiles.length}, najnowsze; zredagowane, max ${PASTE_CLIP} znakow kazda)`,
    ...pastedFiles.map((f) => `- ${f}`),
  ].join('\n');
  fs.writeFileSync(indexFile, body + '\n', { mode: 0o600 });
  return `Indeks sesji: ${indexFile} (${t.allPrompts.length} polecen, ${t.allEdited.length} plikow, ${t.agents.length} agentow, ${t.workflows.length} workflow, ${pastedFiles.length} wklejek${tmpFiles.length ? `, ${tmpFiles.length} plikow w /tmp = tmpfs!` : ''})`;
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
  const pg = pgFiles(t.edited);
  fs.mkdirSync(DIR, { recursive: true });
  // Najpierw migawka (to ja wstrzykuje session-context), potem wolniejszy indeks, na koniec migawka ze wskaznikiem (ops A4).
  writeSnapshot(sid, t, pg, input, 'Indeks sesji: w toku (hook przerwany przed zapisem indeksu)');
  let pointer = '';
  try { pointer = writeIndex(sid, t); } catch (e) {
    pointer = `Indeks sesji: blad zapisu (${String(e && e.code || e).slice(0, 60)})`;
    log({ hook: 'precompact-snapshot', event: 'skipped', reason: `sid=${sid} ${pointer}`, target: input.cwd || '' }); // telemetria, nie tylko plik (ops A6)
  }
  // Drugi zapis tylko dopisuje wskaznik; jego blad zostawia pierwsza migawke (z 'w toku'), nie przerywa sweep/logu (ops A5).
  try { writeSnapshot(sid, t, pg, input, pointer); } catch (e) { log({ hook: 'precompact-snapshot', event: 'skipped', reason: `sid=${sid} wskaznik indeksu nie zapisany (${String(e && e.code || e).slice(0, 60)})`, target: input.cwd || '' }); }
  sweep(sid);
  log({ hook: 'precompact-snapshot', event: 'ran', reason: `sid=${sid} snapshot ${t.prompts.length} promptow, ${t.edited.length} plikow`, target: input.cwd || '' });
}

function writeSnapshot(sid, t, pg, input, pointer) {
  const body = [
    `# Migawka sprzed kompakcji — ${new Date().toISOString()} (trigger: ${input.trigger || 'nieznany'})`,
    pointer, // sciezka z cleanSid, poza redact() (data A4)
    redact([
    '',
    '## Ostatnie polecenia uzytkownika (najnowsze na dole)',
    ...t.prompts.map((p, i) => `${i + 1}. ${clip(p.replace(/\s+/g, ' '), CLIP)}`),
    '',
    '## Pliki edytowane w sesji (najnowsze pierwsze)',
    // Sciezka z \n mogla by podrobic naglowek sekcji (security-review) — jedna linia, bez znakow kontrolnych.
    ...(t.edited.length ? t.edited.map((f) => `- ${String(f).replace(/[\u0000-\u001f]+/g, ' ').slice(0, 300)}`) : ['- (brak)']),
    '',
    ...(pg.length ? ['## Pliki PG z tej sesji — przed decyzja przeczytaj ponownie (sha256[:12] z chwili migawki)', ...pg, ''] : []),
    '## Ostatnia odpowiedz asystenta (fragment)',
    clip(t.lastAnswer, 1500),
  ].join('\n'))].join('\n');
  const file = path.join(DIR, sid + '.md');
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, body + '\n', { mode: 0o600 }); // jak indeks i wklejki (security A5)
  try { fs.renameSync(tmp, file); } catch (e) { try { fs.unlinkSync(tmp); } catch (e2) { /* juz nie ma */ } throw e; }
}

// Retencja: migawki starsze niz 14 dni i osierocone .tmp znikaja (data-review: katalog rosl bez limitu).
function sweep(keepSid) {
  const now = Date.now();
  for (const name of fs.readdirSync(DIR)) {
    if (name.startsWith(keepSid + '.') && !name.endsWith('.tmp')) continue; // migawka, indeks i wklejki tej sesji
    const full = path.join(DIR, name);
    try {
      const age = now - fs.statSync(full).mtimeMs;
      if (age > RETENTION_MS || (name.endsWith('.tmp') && age > 3600 * 1000)) fs.unlinkSync(full);
    } catch (e) { /* rownolegla sesja mogla juz usunac */ }
  }
}

module.exports = { readTranscript, stripEnvelopes, redact, entryPastes, pastePairs, FOREIGN_TAG_RX, NOT_A_PROMPT_RX, DIR };

if (require.main === module) {
  try { main(); } catch (e) {
    try { log({ hook: 'precompact-snapshot', event: 'skipped', reason: 'internal error: ' + String(e && e.message || e).slice(0, 120), target: process.cwd() }); } catch (e2) { /* telemetria nie moze zablokowac kompakcji */ }
  }
  process.exit(0);
}

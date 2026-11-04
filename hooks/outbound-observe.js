#!/usr/bin/env node
// PreToolUse hook (matcher: MATCHER nizej) — OBSERVE, nigdy nie blokuje (2026-11-03).
// Wysylka przez MCP (mail, odpowiedz, przekazanie, zaproszenie, merge PR, push, kosz) nie przechodzila przez ZADEN hook:
// matchery PreToolUse obejmowaly tylko Bash/desktop-commander/Edit/Write, wiec chronila ja wylacznie proza w prompcie.
// Ryzyko (kurs AI_DEVS 4 S02E02/S03E02, pg/cases.md:296 — „ograniczenie proza nie dziala"): sesja, ktora czytala tresc
// z zewnatrz (mail, strona), a potem wysyla, moze wykonac polecenie wstrzykniete w te tresc.
// Ten hook tylko MIERZY (ADR-0008: deklaracja -> pomiar -> observe -> blokada dopiero po incydencie):
//   would_block = wysylka po czytaniu tresci zewnetrznej w tej sesji, ran = bez, skipped = nie da sie ocenic.
// Kalendarz (calendar_list_events) = tresc zewnetrzna: zaproszenie od obcego niesie tekst opisu. Przegladarka jako kanal
// wycieku (fill_form/type, navigate z danymi w URL, javascript_tool/browser_evaluate/run_code, file_upload) — poza lista
// wysylki: kazde wywolanie przegladarki liczy sie jako odczyt, a wysylke przez nia mierzy dopiero incydent (security-review
// 2026-11-03, minor).
// Granica pomiaru (swiadomie): odczyty GitHuba (get_pull_request/get_issue/...) NIE sa tresc zewnetrzna — przeplyw
// „przeczytaj wlasny PR -> merge" dawal would_block prawie zawsze (code-review 2026-11-03: 104 get_pull_request vs 116 merge),
// wiec sygnal bylby bezuzyteczny. Wysylka powloka (gh/curl w Bash) jest poza zakresem — pilnuje jej bash-guard; ale
// mcp__terminal__run_in_terminal mierzy bash-guard (kanal obserwowany, 2026-11-03); create/update_scheduled_task sa tu
// (trwalosc), run_scheduled_task i spawn_task nie: uruchamiaja nowa sesje z pelnymi hookami (spawn_task wymaga klikniecia).
// Subagent ma wlasny transkrypt: jego wysylka nie widzi odczytow rodzica (zanizenie would_block, znane ograniczenie).
// Log = nazwa narzedzia; NIGDY odbiorcy, tematy ani tresc (PII). Reason staly — guard_health grupuje po nim.
'use strict';
const fs = require('fs');
const gateLog = require('./lib/gate-log');

// Koncowka nazwy narzedzia MCP (po ostatnim `__`). Wlasciciel listy = ten plik; matcher w settings.json to tylko prefiltr.
// Slowo kluczowe w dowolnym miejscu (gmail_send_email, send_message, ZohoMail_forwardEmail, ZohoMail_addVacationReplySelf,
// delete_draft), chyba ze nazwa zaczyna sie od czasownika odczytu (list_drafts, get_draft) — takze po prefiksie dostawcy
// pisanym wielka litera (ZohoMail_getSendMailDetails). Czasownik odczytu w srodku nazwy nie wylacza (send_read_receipt = wysylka).
// Slowo `delete` lapie tez etykiety/foldery (szum swiadomy: w observe lepszy nadmiar niz luka).
// Zoho ma ~80 narzedzi (inwentarz transkryptow 2026-11-03): auto-odpowiedz i zmiana Reply-To to tez wysylka do obcych.
// Nazwy Zoho istnieja w dwoch pisowniach (stare camelCase w transkryptach, biezace snake_case: empty_folder, get_mail):
// kazde slowo kluczowe lapie obie. Podpis i adres/nazwa nadawcy (updateUser*) = tekst doklejany do kazdej wysylki (audyt 2026-11-03).
const MAIL_KEYWORDS = '[sS]end|[rR]eply|[fF]orward|[dD]raft|[tT]rash|[dD]elete|[vV]acation|[eE]mpty_?[fF]older|[sS]ignature|[uU]pdateUser|update_display_name';
const OUTBOUND_SUFFIX = `(?!(?:[A-Z][A-Za-z0-9]*_)?(?:[gG]et|[lL]ist|[sS]earch|[rR]ead)(?:_|[A-Z]))\\w*(?:${MAIL_KEYWORDS})\\w*`
  + '|calendar_create_event|merge_pull_request|push_files|create_or_update_file|create_pull_request(?:_review)?'
  + '|create_issue|update_issue|add_issue_comment|create_repository|fork_repository|reserve_booking'
  // Zmiana stanu repo bez wysylki tresci, ale z trwalym skutkiem (audyt 2026-11-03): galaz, aktualizacja PR, auto-merge.
  + '|create_branch|update_pull_request(?:_branch)?|set_auto_merge'
  // Zadanie zaplanowane = prompt wykonany pozniej bez czlowieka: trwalosc wstrzykniecia (sama sesja zadania ma hooki).
  + '|create_scheduled_task|update_scheduled_task';
const MATCHER = `mcp__.*__(${OUTBOUND_SUFFIX})`;
const OUTBOUND_RX = new RegExp(`^(?:${OUTBOUND_SUFFIX})$`);
// Odczyt tresci, ktorej autorem nie jest uzytkownik ani PG: siec, skrzynka (gmail, zoho — tylko narzedzia zwracajace tresc maili),
// przegladarka (kazde wywolanie: strona jest w kontekscie). Klasa (`via` w logu) rozdziela sygnal: replay 30 dni (audyt
// 2026-11-03) dal 25/29 would_block, wszystkie po przegladarce/sieci, 0 po mailu — bez klasy tego nie widac w gates.jsonl.
// Zoho: stare nazwy camelCase (transkrypty) i biezace snake_case (get_mail*, list_mails, search_mail_advanced).
const READ_CLASSES = [
  ['web', /^(WebFetch|WebSearch)$/],
  ['browser', /^mcp__(claude-in-chrome|Claude_Browser|playwright)__/],
  ['mail', new RegExp('^mcp__.+__(gmail_get_email|gmail_list_emails|gmail_search_emails|get_message|get_thread|search_threads|list_drafts'
    + '|get_draft|calendar_list_events|ZohoMail_(?:SearchEmails|listEmails|getMessage\\w*|getOriginalMessage|get_mail\\w*|list_mails'
    + '|search_mail_advanced|list_mail_attachments))$')],
];
const CHUNK = 1 << 20;

const suffix = (name) => String(name || '').split('__').pop();
const isOutbound = (name) => /^mcp__/.test(String(name || '')) && OUTBOUND_RX.test(suffix(name));
/** Klasa odczytu tresci zewnetrznej ('web' | 'browser' | 'mail') albo null. */
function readClass(name) {
  const n = String(name || '');
  if (isOutbound(n)) return null;
  const hit = READ_CLASSES.find(([, rx]) => rx.test(n));
  return hit ? hit[0] : null;
}
const isExternalRead = (name) => readClass(name) !== null;

/** Klasa pierwszego wywolania czytajacego tresc zewnetrzna ('web' | 'browser' | 'mail'), false = brak, null = transkrypt nieczytelny.
 *  Czyta porcjami i konczy na pierwszym trafieniu: transkrypty maja do ~300 MB (pomiar 2026-11-03), calosc w pamieci = sekundy. */
function readExternal(transcriptPath) {
  if (typeof transcriptPath !== 'string' || !transcriptPath) return null;
  let fd;
  try { fd = fs.openSync(transcriptPath, 'r'); } catch (e) { return null; }
  try {
    const buf = Buffer.alloc(CHUNK);
    let rest = '';
    for (;;) {
      const n = fs.readSync(fd, buf, 0, CHUNK, null);
      const lines = (rest + buf.toString('utf8', 0, n)).split('\n');
      rest = n ? lines.pop() : '';
      for (const line of lines) {
        if (!line.includes('"tool_use"')) continue;
        let entry;
        try { entry = JSON.parse(line); } catch (e) { continue; } // linia urwana albo nie-JSON: nie jest wywolaniem narzedzia
        const content = (entry && entry.message && entry.message.content) || [];
        const hit = Array.isArray(content) && content.find((b) => b && b.type === 'tool_use' && isExternalRead(b.name));
        if (hit) return readClass(hit.name);
      }
      if (!n) return false;
    }
  } catch (e) {
    return null;
  } finally {
    fs.closeSync(fd);
  }
}

function main() {
  let input = {};
  try {
    input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
  } catch (e) {
    // matcher w settings.json przepuszcza tu tylko wysylki: zmiana formatu wejscia nie moze wyciszyc pomiaru
    gateLog.log({ hook: 'outbound-observe', event: 'skipped', reason: 'wejscie hooka nieczytelne', target: '', gate: 'OUTBOUND' });
    return;
  }
  const tool = typeof input.tool_name === 'string' ? input.tool_name : '';
  if (!tool) {
    gateLog.noteInputKeys('outbound-observe', input); // jakie pola przyszly zamiast tool_name — diagnoza dryfu
    // jw.: JSON poprawny, ale bez nazwy narzedzia = dryf formatu wejscia, nie „nie-wysylka"
    gateLog.log({ hook: 'outbound-observe', event: 'skipped', reason: 'wejscie hooka bez tool_name', target: '', gate: 'OUTBOUND' });
    return;
  }
  if (!isOutbound(tool)) return;
  gateLog.noteInputKeys('outbound-observe', input);
  const ext = readExternal(input.transcript_path);
  const entry = ext === null
    ? { event: 'skipped', reason: 'transkrypt nieczytelny — nie wiadomo, czy sesja czytala tresc zewnetrzna' }
    : ext ? { event: 'would_block', reason: 'wysylka MCP po czytaniu tresci zewnetrznej w sesji', via: ext }
      : { event: 'ran', reason: 'wysylka MCP bez czytania tresci zewnetrznej w sesji' };
  gateLog.log(Object.assign({ hook: 'outbound-observe' }, entry, { target: tool, gate: 'OUTBOUND' }));
}

if (require.main === module) {
  try {
    main();
  } catch (e) {
    // observe: blad hooka nigdy nie blokuje wysylki, ale nie moze wygladac jak „brak wysylek" (gate-log.js, naglowek)
    gateLog.log({ hook: 'outbound-observe', event: 'skipped', reason: 'blad hooka', target: String(e && e.message).slice(0, 120), gate: 'OUTBOUND' });
  }
  process.exit(0);
}
module.exports = { OUTBOUND_SUFFIX, MATCHER, isOutbound, isExternalRead, readClass, readExternal };

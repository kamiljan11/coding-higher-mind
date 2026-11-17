'use strict';
// turn-origin: kto napisal biezacy prompt — czlowiek czy agent (budzik, sesja potomna, wiadomosc innej sesji).
// Hook UserPromptSubmit NIE dostaje tego na stdin (CC 2.1.321: baza + prompt, session_title, source). Claude Code
// zapisuje wpis promptu do transkryptu z `turnOrigin` (human | scheduled | peer | task_notification | host_synthetic |
// sdk | system | auto_continuation) i `isMeta`. Klucz: `promptId` == hookowe `prompt_id`.
// KOLEJNOSC NA ZYWO (2026-11-14, frazy 13:07/13:11): wpis biezacego promptu powstaje PO hooku UserPromptSubmit, ale PRZED
// pierwszym narzedziem tej tury. Dlatego decyzja zapada przy ZUZYCIU wyjatku (overrides.consume -> originAt), a odczyt
// w prompt-guard (promptOrigin) to tylko wczesny, zwykle pusty sygnal. Skan od 2026-10-01: 205/205 fraz uzytkownika = human;
// 1. prompt sesji potomnej = `host_synthetic`, wiadomosc innej sesji = `peer` + isMeta, budzik = `scheduled` + isMeta.
// Wlasciciel decyzji „ktore pochodzenie moze wydac wyjatek C": prompt-guard.js. Tu tylko odczyt.
const fs = require('fs');

// Wpis promptu stoi na koncu pliku (po nim tylko zalaczniki tej tury) — czytamy ogon, nie caly transkrypt (bywa 430 MB).
const TAIL_BYTES = 512 * 1024;
// Wyscig zapisu transkryptu vs start hooka: kilka krotkich ponowien, tylko gdy prompt jest fraza (rzadko).
const RETRIES = [0, 40, 80, 160];

function sleepMs(ms) {
  if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function readTail(transcriptPath) {
  let fd;
  try {
    fd = fs.openSync(String(transcriptPath || ''), 'r');
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, TAIL_BYTES);
    const buf = Buffer.alloc(len);
    const n = fs.readSync(fd, buf, 0, len, size - len);
    return buf.toString('utf8', 0, n);
  } catch (e) { return ''; } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch (e) { /* zamkniecie nie zmienia wyniku */ }
  }
}

/**
 * Werdykt z wpisow promptu o danym promptId — WYLACZNIE po id, bez dopasowania po tresci (code r4 2026-11-14: na zywo
 * wpis o tej samej tresci to zawsze POPRZEDNI prompt). promptId NIE jest unikalny (data-review r6: kilka promptow human
 * + streszczenie kompakcji o jednym id), a transkrypt da sie dopisac (security-review r6: podrobiony wpis human) —
 * dlatego dowolny wpis nie-human/isMeta o tym id = ten wpis (odmowa), inaczej human; brak wpisow = null.
 */
function verdictOf(entries) {
  if (!entries.length) return null;
  return entries.find(isNonHuman) || entries[0];
}

/** Pochodzenie biezacego promptu: { turnOrigin, isMeta } albo null (nieznane — na zywo dzis zawsze). Nigdy nie rzuca.
 * `isPhrase` (opcjonalne): licza sie tylko wpisy, ktorych tresc jest fraza. Fraza wpisana W TRAKCIE tury ma `promptId`
 * tury; wpis tury zaczetej przez `peer` dawal falszywa odmowe (NA ZYWO 2026-11-14 15:55:17Z) — taki wpis nie jest wpisem
 * frazy, wiec werdykt zostaje dla (C) (wpis kolejki zapisuje CC po hooku). */
function promptOrigin({ transcript_path: tp, prompt_id: pid } = {}, retries = RETRIES, isPhrase = null) {
  if (!tp || !pid) return null;
  for (const wait of retries) {
    sleepMs(wait);
    const found = verdictOf(entriesFor(readTail(tp), String(pid), isPhrase));
    if (found) return found;
  }
  return null;
}

// Przy zuzyciu wyjatku wpis promptu moze stac daleko od konca (dluga tura narzedzi): czytamy wstecz kawalkami do limitu.
const SCAN_BYTES = 16 * 1024 * 1024;
const CHUNK_BYTES = 1024 * 1024;

/** Wszystkie wpisy promptu o tym promptId w tekscie, bez streszczen kompakcji (`isCompactSummary` dziedziczy id). */
function entriesFor(text, promptId, isPhrase = null) {
  const out = [];
  for (const l of text.split('\n')) {
    if (!l.includes(promptId)) continue;
    let d;
    try { d = JSON.parse(l); } catch (e) { continue; /* ucieta linia */ }
    if (d && d.type === 'user' && typeof d.turnOrigin === 'string' && d.promptId === promptId && d.isCompactSummary !== true
      && (!isPhrase || isPhrase(messageText(d)))) {
      out.push({ turnOrigin: d.turnOrigin, isMeta: d.isMeta === true });
    }
  }
  return out;
}

/**
 * Pochodzenie promptu `promptId` z ogona transkryptu (do `maxBytes` od konca), czytane wstecz kawalkami; werdykt
 * z KAZDEGO wpisu o tym id w oknie (verdictOf); z `match` ({ isPhrase, mintedAt }) — tylko z wpisu samej frazy
 * (phraseOriginAt). Przepisanie pliku chroni hooks/lib/protected-paths.js.
 * Granice kawalkow w BAJTACH (nie w napisie) — ucieta linia przechodzi do nastepnego kawalka w calosci, wiec UTF-8 sie
 * nie psuje. Zwraca { turnOrigin, isMeta } albo null (brak wpisu / pliku). Nigdy nie rzuca. Pelny skan 16 MB ~40 ms.
 */
function originAt(transcriptPath, promptId, maxBytes = SCAN_BYTES, chunkBytes = CHUNK_BYTES, match = null) {
  if (!promptId) return null;
  if (match && typeof match.isPhrase === 'function') return phraseOriginAt(transcriptPath, String(promptId), match, maxBytes, chunkBytes);
  const all = [];
  scanBackwards(transcriptPath, maxBytes, chunkBytes, (text) => { all.push(...entriesFor(text, String(promptId))); });
  return verdictOf(all);
}

/** Tekst wiadomosci wpisu user: string albo bloki {type:'text'} (tool_result sie nie liczy). */
function messageText(d) {
  const c = d && d.message && d.message.content;
  if (typeof c === 'string') return c;
  return Array.isArray(c) ? c.filter((b) => b && b.type === 'text').map((b) => String(b.text || '')).join('\n') : '';
}

// Okno wiazace wpis kolejki z mintem: `remove` pisze CC ~40 ms PO hooku (na zywo 14:40:31.043 mint -> .081 remove).
const QUEUE_BEFORE_MS = 10 * 1000;
const QUEUE_AFTER_MS = 120 * 1000;

/**
 * Werdykt z WPISU SAMEJ FRAZY (security/product 2026-11-14 14:40: fraza uzytkownika wpisana W TRAKCIE tury dostaje
 * `promptId` tury — tura zaczeta wiadomoscia subagenta (`peer`) => falszywa odmowa; odwrotnie wiadomosc peera w turze
 * uzytkownika przeszlaby jako human). Wpis frazy to: (a) wpis user o tym promptId, ktorego tresc jest fraza (prompt zaczal
 * ture), albo (b) wiadomosc wchlonieta w trakcie tury: `queue-operation remove` (reason `absorbed_mid_turn`, tresc =
 * fraza, czas ~ mint) -> zalacznik `queued_command` o tym `delivery_id` z `origin.kind` (human | peer | task-notification).
 * Kazdy znaleziony nie-human/isMeta = odmowa (podrobiony dopisek nic nie daje); brak wpisu frazy = null (czeka).
 */
function phraseOriginAt(transcriptPath, promptId, match, maxBytes, chunkBytes) {
  const minted = Date.parse(match.mintedAt || '') || null;
  const starts = [];
  const removed = new Set();
  const queued = new Map();
  scanBackwards(transcriptPath, maxBytes, chunkBytes, (text) => {
    for (const l of text.split('\n')) {
      const pidLine = l.includes(promptId);
      if (!pidLine && !l.includes('queue-operation') && !l.includes('queued_command')) continue;
      let d;
      try { d = JSON.parse(l); } catch (e) { continue; /* ucieta linia */ }
      if (!d) continue;
      if (pidLine && d.type === 'user' && d.promptId === promptId && typeof d.turnOrigin === 'string' && d.isCompactSummary !== true
        && match.isPhrase(messageText(d))) starts.push({ turnOrigin: d.turnOrigin, isMeta: d.isMeta === true });
      if (d.type === 'queue-operation' && d.operation === 'remove' && d.reason === 'absorbed_mid_turn' && d.deliveryId
        && match.isPhrase(String(d.content || ''))) {
        const t = Date.parse(d.timestamp || '');
        if (minted && t >= minted - QUEUE_BEFORE_MS && t <= minted + QUEUE_AFTER_MS) removed.add(d.deliveryId);
      }
      const a = d.type === 'attachment' && d.attachment;
      if (a && a.type === 'queued_command' && a.delivery_id) {
        // KAZDY zalacznik o tym delivery_id (data-review r12: Map.set nadpisywal — dopisany `human` przykrywal `peer`).
        const list = queued.get(a.delivery_id) || [];
        list.push({ turnOrigin: a.origin && typeof a.origin.kind === 'string' ? a.origin.kind : 'unknown', isMeta: a.isMeta === true });
        queued.set(a.delivery_id, list);
      }
    }
  });
  // Wchlonieta wiadomosc bez zalacznika z pochodzeniem = nieznane pochodzenie = nie-human (fail-closed).
  const fromQueue = [...removed].flatMap((id) => queued.get(id) || [{ turnOrigin: 'unknown', isMeta: false }]);
  return verdictOf([...starts, ...fromQueue]);
}

/** Odczyt pliku od konca kawalkami pelnych linii; `onText` dostaje tekst kazdego kawalka. Bledy = koniec odczytu. */
function scanBackwards(transcriptPath, maxBytes, chunkBytes, onText) {
  if (!transcriptPath) return;
  let fd;
  try {
    fd = fs.openSync(String(transcriptPath), 'r');
    const size = fs.fstatSync(fd).size;
    let end = size;
    let carry = Buffer.alloc(0); // poczatek linii, ktorej reszta jest w kawalku blizej konca pliku
    while (end > 0 && size - end < maxBytes) {
      const start = Math.max(0, end - chunkBytes);
      const buf = Buffer.alloc(end - start);
      const n = fs.readSync(fd, buf, 0, end - start, start);
      let block = Buffer.concat([buf.subarray(0, n), carry]);
      if (start > 0) {
        const nl = block.indexOf(0x0a);
        if (nl < 0) { carry = block; end = start; continue; } // linia dluzsza niz kawalek — doczytujemy dalej
        carry = block.subarray(0, nl);
        block = block.subarray(nl + 1);
      }
      onText(block.toString('utf8'));
      end = start;
    }
  } catch (e) { return; /* plik nieczytelny = brak wpisu -> wolajacy odmawia (fail-closed) */ } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch (e) { /* zamkniecie nie zmienia wyniku */ }
  }
}

/** Czy pochodzenie jawnie wskazuje autora innego niz czlowiek. null (nieznane) => false — decyzje podejmuje wolajacy. */
const isNonHuman = (o) => !!o && (o.turnOrigin !== 'human' || o.isMeta);

module.exports = { promptOrigin, entriesFor, originAt, messageText, isNonHuman, TAIL_BYTES, SCAN_BYTES };

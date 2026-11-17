#!/usr/bin/env node
// PreToolUse hook (matcher: MATCHER nizej) — ENFORCE (2026-11-14). Prompt budzika/zadania zaplanowanego nie moze
// zawierac frazy wyjatku `pozwol ALLOW_X`.
// Powod (pg-review r4 security 2026-11-14, ~/.cache/pg-review-20261114-125922-ovr4): prompt ScheduleWakeup/CronCreate
// pisze AGENT, a wraca on do WLASNEJ sesji bez koperty (turnOrigin: scheduled, isMeta: true) i przechodzi przez
// UserPromptSubmit — prompt = sama fraza => prompt-guard wydawal wyjatek C bez uzytkownika (potwierdzone w transkrypcie
// 04f88e98…jsonl). Zadania zaplanowane / RemoteTrigger: prompt pisany przez agenta staje sie 1. wiadomoscia nowej sesji.
// Warstwy: (B) prompt-guard odmawia mintu, gdy wpis transkryptu ma turnOrigin != human (lib/turn-origin.js);
// (A) ten hook — odmowa juz przy tworzeniu budzika, deterministycznie, bez zaleznosci od formatu transkryptu.
// Enforce od razu, nie observe (ADR-0008): luka realna i potwierdzona, a falszywy alarm kosztuje tylko przeformulowanie
// promptu (bez frazy) — uzasadnienie: pg/cases.md „SELF-MINT-VIA-SCHEDULED-PROMPT".
'use strict';
const fs = require('fs');
const gateLog = require('./lib/gate-log');

const HOOK = 'schedule-guard';
// Narzedzia, ktorych prompt agent pisze sam, a ktory potem trafia do sesji jako wiadomosc „uzytkownika".
// + kanaly miedzy sesjami (security-review r11 2026-11-14): 1. prompt sesji potomnej (start_session / hand_off) i
// wiadomosc do innej sesji (SendMessage / send_message). Warstwa (A) — deterministyczna, PRZED wyslaniem: tekst, ktory
// dotrze jako prompt, jest dokladnie tym tool_input. Domyka tez wyscig „rodzic przepisuje transkrypt dziecka" z (C).
const TOOLS = ['ScheduleWakeup', 'CronCreate', 'RemoteTrigger', 'mcp__scheduled-tasks__create_scheduled_task', 'mcp__scheduled-tasks__update_scheduled_task',
  'mcp__ccd_session__start_session', 'mcp__ccd_session__hand_off_to_session', 'SendMessage', 'mcp__ccd_session_mgmt__send_message',
  'mcp__ccd_session__spawn_task']; // r12: chip nowej sesji z `prompt` pisanym przez agenta
const MATCHER = TOOLS.join('|');
const TOOL_RX = new RegExp('^(?:' + MATCHER + ')$');

/**
 * Caly tool_input zawiera fraze wyjatku? (wzorzec wspolny z bash-guard: lib/bash-rules.js MINT_PHRASE_RX).
 * Wszystkie napisy (wartosci i klucze), iteracyjnie, BEZ limitu glebokosci/ilosci: prompt bywa gleboko zagniezdzony
 * (RemoteTrigger body.job_config…content[]), a obciecie = przepuszczenie (pg-review security 2026-11-14 F1).
 * Nie JSON.stringify: escape `\n` przed slowem („\npozwol") lamie `\b` we wzorcu.
 */
function hasMintPhrase(toolInput) {
  const { MINT_PHRASE_RX } = require('./lib/bash-rules');
  const parts = [];
  const stack = [toolInput];
  while (stack.length) {
    const v = stack.pop();
    if (typeof v === 'string') parts.push(v);
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { parts.push(k); stack.push(x); }
  }
  return MINT_PHRASE_RX.test(parts.join('\n'));
}

function main() {
  let input = {};
  try { input = JSON.parse(fs.readFileSync(0, 'utf8').replace(/^﻿/, '') || '{}'); } catch (e) { return 0; }
  const tool = String(input.tool_name || '');
  if (!TOOL_RX.test(tool)) return 0;
  gateLog.noteInputKeys(HOOK, input);
  if (!hasMintPhrase(input.tool_input || {})) return 0;
  gateLog.log({ hook: HOOK, event: 'blocked', reason: `fraza wyjatku w prompcie ${tool}`, target: input.cwd || '' });
  process.stderr.write(`[${HOOK}] ZABLOKOWANE / BLOCKED. Prompt ${tool} zawiera fraze wyjatku („pozwol/allow … ALLOW_…"). ` +
    'Ten prompt wroci jako wiadomosc w sesji, a wyjatek od bramki wydaje TYLKO uzytkownik, piszac fraze sam. ' +
    'Przeformuluj prompt bez frazy, np. „czekam na decyzje uzytkownika o merge" zamiast cytatu frazy.\n');
  return 2;
}

if (require.main === module) {
  // Blad samego hooka nie blokuje narzedzia (fail-open jak outbound-observe), ale zostawia slad w logu bramek.
  try { process.exitCode = main(); } catch (e) {
    gateLog.log({ hook: HOOK, event: 'skipped', reason: `blad hooka: ${String(e && e.message || e).slice(0, 120)}`, target: '' });
    process.exitCode = 0;
  }
}

module.exports = { MATCHER, TOOLS, hasMintPhrase };

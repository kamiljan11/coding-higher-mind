#!/usr/bin/env node
// Testy prompt-guard.js: realne prompty do PRAWDZIWEGO hooka, w OBU jezykach (PG_LANG=pl/en), z ASERCJAMI.
// 2026-09-13: poprzednia wersja tylko drukowala werdykty i zawsze konczyla "TESTY DONE" — test na papierze (blizna
// RULE-ON-PAPER-NO-GATE w wydaniu testowym); w publicznym CI sciezka hooka byla literalem "~/.claude/..." i kazdy
// prompt dawal SKIP, a test byl zielony. Teraz: sciezka z os.homedir(), oczekiwany werdykt musi sie zgadzac, exit 1 przy FAIL.
// Uzycie: node ~/.claude/bin/test_prompt_guard.js
'use strict';
const { spawnSync } = require('child_process');
const os = require('os');
const path = require('path');
const HOOK = path.join(os.homedir(), '.claude', 'hooks', 'prompt-guard.js');

// [prompt, oczekiwany werdykt, opis]
const cases = [
  ['zbuduj mi strone dla klienta z rezerwacjami i platnosciami', 'TRIGGER+KOD', 'budowa strony = kod'],
  ['napraw bug w komponencie logowania w repo rental-site', 'TRIGGER+KOD', 'bug + repo'],
  ['ile kosztuje teraz subskrypcja Claude Max i jaka jest najnowsza wersja?', 'TRIGGER+FAKTY', 'ceny/wersje -> search'],
  ['zrob research rynku fryzjerow w Reykjaviku i przygotuj oferte', 'TRIGGER', 'research bez kodu'],
  ['wyslij ten mail do klienta i usun stare pliki z serwera', 'TRIGGER', 'nieodwracalne -> pytania'],
  ['popraw literowke w naglowku strony', 'TRIGGER+KOD', 'male -> zalozenie w 1. linii'],
  ['Fix the login bug in the checkout component and add a test', 'TRIGGER+KOD', 'angielski prompt kodowy'],
  ['What is the current price of Claude Max and the latest version?', 'TRIGGER+FAKTY', 'angielski prompt faktowy'],
  ['ok dalej', 'SKIP', 'potwierdzenie'],
  ['tak', 'SKIP', 'krotkie'],
  ['dzieki super robota', 'SKIP', 'podziekowanie'],
  ['/memory', 'SKIP', 'slash command'],
  ['git', 'SKIP', 'za krotkie'],
];

let failures = 0;
for (const lang of ['pl', 'en']) {
  for (const [p, expected, why] of cases) {
    const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ prompt: p }), encoding: 'utf8', env: Object.assign({}, process.env, { PG_LANG: lang }) });
    const out = (r.stdout || '').trim();
    const fired = out.includes('[PROMPT-GUARD]');
    const variant = /7\. (KOD|CODE):/.test(out) ? '+KOD' : (out.includes('7F.') ? '+FAKTY' : '');
    const verdict = fired ? ('TRIGGER' + variant) : 'SKIP';
    const langOk = !fired || (lang === 'en' ? out.includes('anti-hallucination') : out.includes('anty-halucynacyjny'));
    const ok = verdict === expected && langOk && r.status === 0;
    if (!ok) failures++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} [${lang}] ${verdict.padEnd(13)} oczekiwane ${expected.padEnd(13)} ${why} :: "${p}"${langOk ? '' : ' (zly jezyk protokolu)'}`);
  }
}
// Skip-owe promptu tez musza dostac CAVEMAN w wybranym jezyku (kompresja leci ZAWSZE)
for (const lang of ['pl', 'en']) {
  const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ prompt: 'ok dalej' }), encoding: 'utf8', env: Object.assign({}, process.env, { PG_LANG: lang }) });
  const ok = (r.stdout || '').includes(lang === 'en' ? '[CAVEMAN — ALWAYS]' : '[CAVEMAN — ZAWSZE]');
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} [${lang}] CAVEMAN przy krotkim prompcie`);
}
console.log(failures ? `TESTY: ${failures} FAIL` : 'TESTY DONE');
process.exit(failures ? 1 : 0);

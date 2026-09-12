// Bateria testow prompt-guard: podaje realne prompty do PRAWDZIWEGO hooka
// i pokazuje co triggeruje. Uzycie: node test_prompt_guard.js
'use strict';
const { spawnSync } = require('child_process');
const HOOK = '~/.claude/hooks/prompt-guard.js';

const cases = [
  ['zbuduj mi strone dla klienta z rezerwacjami i platnosciami', 'TRIGGER'],
  ['napraw bug w komponencie logowania w repo rental-site', 'TRIGGER+KOD'],
  ['ile kosztuje teraz subskrypcja Claude Max i jaka jest najnowsza wersja?', 'TRIGGER+FAKTY'],
  ['zrob research rynku fryzjerow w Reykjaviku i przygotuj oferte', 'TRIGGER'],
  ['wyslij ten mail do klienta i usun stare pliki z serwera', 'TRIGGER (nieodwracalne -> ma pytac)'],
  ['popraw literowke w naglowku', 'TRIGGER (male -> ma nazwac zalozenie)'],
  ['ok dalej', 'SKIP (potwierdzenie)'],
  ['tak', 'SKIP (krotkie)'],
  ['dzieki super robota', 'SKIP (podziekowanie)'],
  ['/memory', 'SKIP (slash command)'],
  ['git', 'SKIP (za krotkie)'],
];

for (const [p, expected] of cases) {
  const r = spawnSync('node', [HOOK], { input: JSON.stringify({ prompt: p }), encoding: 'utf8' });
  const out = (r.stdout || '').trim();
  const fired = out.includes('[PROMPT-GUARD]');
  const variant = out.includes('7. KOD') ? '+KOD' : (out.includes('7F.') ? '+FAKTY' : '');
  const verdict = fired ? ('TRIGGER' + variant) : 'SKIP';
  console.log(verdict.padEnd(14) + '| oczekiwane: ' + expected.padEnd(38) + '| "' + p + '"');
}
console.log('TESTY DONE');

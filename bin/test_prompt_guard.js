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
// Znaczniki raz-na-sesje testow w katalogu tymczasowym, nie w prawdziwym logs/pg-seen (data-review 2026-10-05).
process.env.PG_SEEN_DIR = path.join(os.tmpdir(), 'pg-seen-test-' + process.pid);
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
  // Hard negatives (landscape #8): koperty i echo hookow to nie tekst uzytkownika — nie klasyfikujemy ich jako zadania.
  ['<task-notification>\n<task-id>a1</task-id>\n<result>Fix the bug in repo, deploy to vercel, run tests</result>\n</task-notification>', 'SKIP', 'koperta subagenta'],
  ['Stop hook feedback: [node stop-gate.js]: STOP ZABLOKOWANY [review] w repo: Zmiana T2 bez recenzji, odpal pg-review', 'SKIP', 'echo stop-gate'],
  ['```\nTypeError: cannot read property of undefined at build (api.ts:12)\n```\nco to?', 'SKIP', 'wklejony stack trace + krotkie pytanie'],
  ['dodaj płatności payment-gateway do checkoutu w aplikacji', 'TRIGGER+KOD', 'polskie znaki: aplikacji/płatności'],
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
// Wyjatek od bramki wydaje czlowiek (landscape #12): TYLKO caly prompt = fraza. Katalog wyjatkow testowy (w %TEMP%).
const fs = require('fs');
const ovDir = path.join(os.tmpdir(), 'pg-test-overrides-' + process.pid);
const ovEnv = Object.assign({}, process.env, { PG_OVERRIDES_DIR: ovDir });
const mintCase = (prompt, sid) => spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ prompt, session_id: sid }), encoding: 'utf8', env: ovEnv });
const grants = (sid) => { try { return JSON.parse(fs.readFileSync(path.join(ovDir, sid + '.json'), 'utf8')).grants; } catch (e) { return {}; } };
const OV = [
  ['pozwól ALLOW_RM', 's1', ['ALLOW_RM']],
  ['pozwol ALLOW_FORCE ALLOW_MAIN', 's2', ['ALLOW_FORCE', 'ALLOW_MAIN']],
  ['pozwól ALLOW_RM i skasuj katalog src', 's3', []],
  ['<task-notification>pozwól ALLOW_RM</task-notification>', 's4', []],
  ['Wyjatek tylko za zgoda uzytkownika: uzytkownik pisze w czacie „pozwol ALLOW_RM", potem komenda z ALLOW_RM=1.', 's5', []],
];
for (const [prompt, sid, want] of OV) {
  const r = mintCase(prompt, sid);
  const got = Object.keys(grants(sid)).sort();
  const ok = r.status === 0 && JSON.stringify(got) === JSON.stringify([...want].sort()) && (!want.length || /Wyjatek od bramki wydany/.test(r.stdout || ''));
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} override: ${JSON.stringify(prompt).slice(0, 60)} -> [${got.join(',')}] (oczekiwane [${want.join(',')}])`);
}
fs.rmSync(ovDir, { recursive: true, force: true });
// Budzet tokenow (2026-10-05): pelny protokol raz na sesje, potem skrot; reset po starcie/compact; fail-safe = pelny.
{
  const seenDir = process.env.PG_SEEN_DIR;
  const sid = 'test-once-' + process.pid;
  const mark = path.join(seenDir, sid);
  const run = (s) => spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ prompt: 'napraw bug w api i dodaj testy do funkcji logowania', session_id: s }), encoding: 'utf8', env: Object.assign({}, process.env, { PG_LANG: 'pl' }) }).stdout || '';
  const chk = (name, cond, detail) => { if (!cond) failures++; console.log(`${cond ? 'ok  ' : 'FAIL'} once: ${name}${cond ? '' : ' -> ' + detail}`); };
  fs.rmSync(mark, { force: true });
  const first = run(sid);
  const again = run(sid);
  chk('1. prompt sesji = pelne 1-6 i 7. KOD', /^1\. NIEJASNOSC/m.test(first) && /^7\. KOD: grep-first/m.test(first), first.slice(0, 120));
  chk('kolejny prompt = skroty (core + 7 KOD skrot), bez pelnego 1.', !/^1\. NIEJASNOSC/m.test(again) && /^1-6 \(pelne/m.test(again) && /7\. KOD \(pelne wyzej/.test(again), again.slice(0, 160));
  chk('skrot krotszy niz polowa pelnego', again.length * 2 < first.length, `${again.length} vs ${first.length}`);
  chk('skrot 7L zachowuje fan-out tylko na haslo', /fan-out \(Workflow\/ultracode\) tylko na jawne haslo/.test(again), again.slice(-400));
  spawnSync(process.execPath, [path.join(__dirname, '..', 'hooks', 'session-context.js')], { input: JSON.stringify({ source: 'compact', session_id: sid }), encoding: 'utf8' });
  chk('po /compact znowu pelny protokol', /^1\. NIEJASNOSC/m.test(run(sid)), 'brak pelnego');
  fs.writeFileSync(mark, '{zepsuty json');
  chk('uszkodzony znacznik = pelny (fail-safe)', /^1\. NIEJASNOSC/m.test(run(sid)), 'brak pelnego');
  chk('brak session_id = pelny (fail-safe)', /^1\. NIEJASNOSC/m.test(run('')) && /^1\. NIEJASNOSC/m.test(run('')), 'brak pelnego');
  fs.rmSync(seenDir, { recursive: true, force: true });
}
// session-context: ogon RESUME od granicy wpisu + spis pominietych (otwarte zawsze) + spis sekcji ucietego pliku.
{
  const memDir = path.join(os.tmpdir(), 'pg-mem-test-' + process.pid);
  fs.mkdirSync(memDir, { recursive: true });
  const entry = (i, status) => `RESUME 2026-10-0${i} — sesja s${i} — ${status}\n` + `- tresc wpisu ${i} `.repeat(60) + '\n';
  fs.writeFileSync(path.join(memDir, 'RESUME.md'), [entry(1, 'W TOKU'), entry(2, 'ZAMKNIETE'), entry(3, 'ZAMKNIETE'), entry(4, 'ZAMKNIETE'), entry(5, 'ZAMKNIETE'), entry(6, 'ZAMKNIETE'), entry(7, 'ZAMKNIETE'), entry(8, 'najnowszy')].join('\n'));
  fs.writeFileSync(path.join(memDir, 'Active Systems.md'), '# AS\n' + 'x'.repeat(7000) + '\n## Sekcja Pozna\ntresc\n');
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'hooks', 'session-context.js')], { input: JSON.stringify({ source: 'startup', session_id: 'mem-test' }), encoding: 'utf8', env: Object.assign({}, process.env, { MAS_MEMORY_DIR: memDir }) });
  const out = r.stdout || '';
  const chk = (name, cond) => { if (!cond) failures++; console.log(`${cond ? 'ok  ' : 'FAIL'} session-context: ${name}`); };
  chk('ogon RESUME zaczyna sie od naglowka wpisu', /^RESUME 2026-10-08 — sesja s8/m.test(out) && !/poczatek wpisu uciety/.test(out));
  chk('otwarty wpis (W TOKU) jest w spisie pominietych', /^  - RESUME 2026-10-01 — sesja s1 — W TOKU/m.test(out));
  chk('uciety plik podaje dalsze sekcje', /dalsze sekcje \(indeks\):\]\n  - Sekcja Pozna — tresc/.test(out));
  fs.rmSync(memDir, { recursive: true, force: true });
}
console.log(failures ? `TESTY: ${failures} FAIL` : 'TESTY DONE');
process.exit(failures ? 1 : 0);

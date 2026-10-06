#!/usr/bin/env node
// Testy sd-card-lint.js — czyste funkcje + karty pakietu A (02/03/05). Uruchom: node ~/.claude/bin/test_sd_card_lint.js
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const os = require('node:os');
const { splitCards, checkFormat, checkAudit, checkSignals, checkCommands, lintText, SD_DIR } = require('./sd-card-lint.js');

let n = 0;
const it = (name, fn) => { fn(); n++; console.log('ok   ' + name); };

const card = (o = {}) => [
  '### Karta testowa',
  '',
  o.noProblem ? '' : '**Problem.** Cos boli.',
  '',
  '**Domyślnie u nas.** Postgres.',
  '',
  '| Wariant | Koszt operacyjny | Finansowy | Poznawczy |',
  '|---|---|---|---|',
  '| a | b | c | d |',
  '',
  o.code || '',
  '**Awarie i detekcja.**',
  '- *x* — `rg -n x src`',
  '',
  '**Audyt „czy się trzymamy".**',
  o.badAudit ? '1. Czy cos jest?' : '1. Czy cos jest? → `rg -n x`.',
  '',
  o.npj || '**Nie potrzebujesz jeszcze** (wariant → sygnał powrotu):\n- Redis → ~>100 odczytow/s tego samego klucza po pomiarze.',
  '',
].join('\n');

it('poprawna karta przechodzi format, audyt i sygnaly', () => {
  assert.deepEqual(lintText(card(), { signals: true }), []);
});

it('brak sekcji Problem = blad formatu', () => {
  const [c] = splitCards(card({ noProblem: true }));
  assert.ok(checkFormat(c).some((e) => e.includes('problem')));
});

it('zla kolejnosc sekcji wykryta', () => {
  const md = card().replace('**Awarie i detekcja.**', '**Awarie-tmp**').replace('**Problem.** Cos boli.', '**Awarie i detekcja.**\n\n**Problem.** Cos boli.');
  const [c] = splitCards(md);
  assert.ok(checkFormat(c).some((e) => e.startsWith('zla kolejnosc')));
});

it('pytanie audytu bez komendy (→) = blad', () => {
  const [c] = splitCards(card({ badAudit: true }));
  assert.equal(checkAudit(c).length, 1);
});

it('"Nie potrzebujesz jeszcze" jako akapit bez sygnalow = blad tylko z --signals', () => {
  const md = card({ npj: '**Nie potrzebujesz jeszcze.** Redisa, Kafki, K8s.' });
  assert.deepEqual(lintText(md), []);
  assert.ok(lintText(md, { signals: true }).some((r) => r.error.includes('bez listy')));
});

it('wariant bez sygnalu (brak → albo pusty) = blad', () => {
  const [c] = splitCards(card({ npj: '**Nie potrzebujesz jeszcze** (wariant → sygnał powrotu):\n- Redis\n- Kafka → ' }));
  assert.equal(checkSignals(c).length, 2);
});

it('### i "| Wariant" wewnatrz bloku ``` nie mylą parsera', () => {
  const code = '```sql\n### nie-karta\n| Wariant | x |\nselect 1;\n```\n';
  const cards = splitCards(card({ code }));
  assert.equal(cards.length, 1);
  assert.deepEqual(lintText(card({ code }), { signals: true }), []);
});

it('niedomkniety blok ``` wykryty (blizna: niedomkniety @media w fali 1 SAGITUM)', () => {
  const out = lintText(card({ code: '```sql\nselect 1;\n' }));
  assert.ok(out.some((r) => r.error.startsWith('niedomkniety')));
});

it('komenda `rg -n ... | rg -v "[0-9]"` wykryta (numer linii psuje filtr); bez -n i inne potoki OK', () => {
  assert.equal(checkCommands('- *x* — `rg -n -i "RPO|RTO" docs/RUNBOOK.md | rg -v "[0-9]"`').length, 1);
  assert.equal(checkCommands('- *x* — `grep -in rto f | grep -v "\\d"`').length, 1);
  assert.deepEqual(checkCommands('- *x* — `rg -i "RPO|RTO" docs/RUNBOOK.md | rg -v "[0-9]"`'), []);
  assert.deepEqual(checkCommands('- *x* — `rg -n "429" src | rg -v -i "retry-after"`'), []);
});

// --- karty pakietu A: format + sygnaly + wymagane pojecia z raportu pokrycia kursu ---
const read = (f) => fs.readFileSync(path.join(SD_DIR, f), 'utf8');
const REQUIRED = {
  '02-dane.md': ['cache-aside', 'read-through', 'write-through', 'write-around', 'write-back (write-behind)', 'TUS', 'multipart', 'Retencja i lifecycle', 'Kopie plików', 'Database backups do not include objects you store via the Storage API'],
  '03-skala.md': ['fixed window', '2× limitu na granicy okna', 'sliding window log', 'sliding window counter', 'token bucket', 'leaky bucket', 'per IP + login', 'X-RateLimit-Remaining', 'Retry-After', 'Gdzie limitować', '### Backpressure i zrzucanie obciążenia (load shedding)', 'w tempie dostawcy', 'priority', '503 + `Retry-After`'],
  '05-niezawodnosc.md': ['PKCE', 'OIDC', 'exchangeCodeForSession', 'wspólny sekret', 'podpisany JWT', 'HMAC', 'Unieważnianie tokenów', 'Klucze API partnerów', 'SLO „lite"', 'Próg alertu', 'tracesSampleRate', 'tail sampling', 'kardynalnością', 'RPO** (Recovery Point Objective)', 'RTO** (Recovery Time Objective)', 'region dostawcy pada', 'replikacja single-leader', 'replikacja multi-leader', 'replikacja bezliderowa'],
};

for (const [f, terms] of Object.entries(REQUIRED)) {
  it(`${f}: format + audyt + sygnaly powrotu bez bledow`, () => {
    assert.deepEqual(lintText(read(f), { signals: true }), []);
  });
  it(`${f}: zawiera wymagane warianty z raportu kursu`, () => {
    const md = read(f);
    const missing = terms.filter((t) => !md.includes(t));
    assert.deepEqual(missing, []);
  });
}

it('03: SQL sliding window i token bucket sa w domknietych blokach ```sql', () => {
  const md = read('03-skala.md');
  const blocks = md.match(/^```sql\n[\s\S]*?^```/gm) || [];
  assert.ok(blocks.some((b) => b.includes('prev.window_start')));
  assert.ok(blocks.some((b) => b.includes('token_buckets')));
});

// komendy wykrywania z kart uruchomione na fiksturze (blizna 2026-10-06: detektor fixed window zglaszal
// tez domyslny sliding window counter z tej samej karty, bo oba uzywaja date_trunc)
const cardCmd = (md, label) => {
  const l = md.split('\n').find((x) => x.includes(label));
  return l.slice(l.indexOf('— `') + 3, l.indexOf('`', l.indexOf('— `') + 3));
};
let hasRg = true;
try { execFileSync('rg', ['--version'], { stdio: 'pipe' }); } catch { hasRg = false; }
const runIn = (dir, cmd) => {
  try { return execFileSync('bash', ['-c', cmd], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { return e.stdout || ''; }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
};

if (hasRg) {
  it('03: detektor fixed window lapie fixed window, a NIE domyslny sliding window counter z karty', () => {
    const md = read('03-skala.md');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdcard-'));
    fs.mkdirSync(path.join(dir, 'supabase', 'migrations'), { recursive: true });
    const sliding = md.match(/^```sql\n([\s\S]*?prev\.window_start[\s\S]*?)^```/m)[1];
    fs.writeFileSync(path.join(dir, 'supabase/migrations/1_sliding.sql'), '-- rate limit\n' + sliding);
    fs.writeFileSync(path.join(dir, 'supabase/migrations/2_fixed.sql'), "-- rate limit\ninsert into rate_limits values ($1, date_trunc('minute', now()), 1);\n");
    const out = runIn(dir, cardCmd(md, '*fixed window na logowaniu/LLM'));
    assert.match(out, /2_fixed\.sql/);
    assert.doesNotMatch(out, /1_sliding\.sql/);
  });
  it('05: komenda "RPO/RTO bez liczb" zglasza linie bez liczby', () => {
    const md = read('05-niezawodnosc.md');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdcard-'));
    fs.mkdirSync(path.join(dir, 'docs'));
    fs.writeFileSync(path.join(dir, 'docs/RUNBOOK.md'), 'RPO: 24 h\nRTO do ustalenia\n');
    const out = runIn(dir, cardCmd(md, '*RPO/RTO bez liczb*'));
    assert.match(out, /RTO do ustalenia/);
    assert.doesNotMatch(out, /RPO: 24/);
  });
  it('05: detektor porownania sekretu przez === lapie obie strony porownania', () => {
    const md = read('05-niezawodnosc.md');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdcard-'));
    fs.mkdirSync(path.join(dir, 'supabase', 'functions'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(path.join(dir, 'supabase/functions/a.ts'), "if (sig === expected) {}\nif (h === Deno.env.get('CRON_SECRET')) {}\nconst design = x === y;\n");
    const out = runIn(dir, cardCmd(md, '*porównanie sekretu przez'));
    assert.match(out, /:1:/);
    assert.match(out, /:2:/);
    assert.doesNotMatch(out, /:3:/);
  });
} else console.log('skip testy komend: brak rg');

console.log(`\n${n} testow OK`);

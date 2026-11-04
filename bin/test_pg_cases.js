// Testy bin/pg-cases.js (P10, 2026-11-02): dzial wiersza = sekcja + tag `dept:`, lint (duplikat, kolumny, status),
// stats, CLI exit 0/1/2, a na koniec prawdziwy pg/cases.md (0 bledow lint, 0 wierszy bez dzialu).
// Uruchom: node test_pg_cases.js (0 sieci; fixture w os.tmpdir(), kasowany).
'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

let failures = 0;
const check = (name, cond, detail) => { if (cond) console.log('ok  ', name); else { failures++; console.log('FAIL', name, detail || ''); } };

const TOOL = path.join(__dirname, 'pg-cases.js');
const { parse, lint, stats, cells, sectionDepts } = require(TOOL);

const FIXTURE = [
  '# Blizny',
  '',
  '## DATA / RLS (data-reviewer)',
  '| rule_id | Wzorzec | Zrodlo | Detekcja | Status |',
  '|---|---|---|---|---|',
  '| RLS-A | polityka bez check | 1 | lint | G |',
  '| RLS-B | regex `a\\|b` w kodzie | 1 | rubryka | — |',
  '',
  '## Sesja 2026-09-05 — rdzen sklepu',
  '| rule_id | Wzorzec | Zrodlo | Detekcja | Status |',
  '|---|---|---|---|---|',
  '| GRANT-X | grant hurtem cofa revoke | 1 | test | G · dept:security,data |',
  '| MISC-Y | bez tagu | 1 | — | P |',
  '| RLS-A | duplikat | 1 | — | G |',
  '| SHIFT-Z | niezescapowany a|b | 1 | — | G |',
  '| SHORT-W | krotki | 1 |',
  '| ODD-V | dziwny status | 1 | — | BRAMKA · dept:nope |',
  '',
  '## OPS / DEPLOY (ops-reviewer)',
  '| rule_id | Wzorzec | Typ |',
  '|---|---|---|',
  '| OPS-1 | brak timeoutu | observe |',
].join('\n');

const rows = parse(FIXTURE).rows;
const by = (id) => rows.find((r) => r.rule_id === id && r.section);

check('cells: \\| zostaje w komorce, nie dzieli', cells('| A | x\\|y | z |').length === 3);
check('sectionDepts: DATA -> data, sesyjna -> misc', sectionDepts('DATA / RLS') [0] === 'data' && sectionDepts('Sesja 2026-09-05')[0] === 'misc');
check('parse: 9 wierszy (naglowki i separatory pominiete)', rows.length === 9, rows.map((r) => r.rule_id).join(','));
check('dzial z sekcji: DATA / RLS -> data + security (A24 security)', by('RLS-A').depts.join() === 'data,security', by('RLS-A').depts.join());
check('sectionDepts: PROCESS -> product + code; tytul jednej blizny (CSS: ...) -> misc (A24 code)',
  sectionDepts('PROCESS / DOCS (product-reviewer, code-reviewer)').join() === 'product,code' && sectionDepts('PROCESS / PRODUCT — z memo').join() === 'product'
  && sectionDepts('CSS: regula lagodzaca')[0] === 'misc');
check('tag dept: dodaje dzialy do sekcji sesyjnej', ['misc', 'security', 'data'].every((d) => by('GRANT-X').depts.includes(d)), by('GRANT-X').depts.join());
check('status bez tagu i separatora', by('GRANT-X').status === 'G', by('GRANT-X').status);
check('status z kolumny Typ', rows.find((r) => r.rule_id === 'OPS-1').status === 'observe');
check('escaped \\| nie przesuwa kolumn', by('RLS-B').status === '—' && by('RLS-B').ncells === 5);

const { errors, warnings } = lint(rows);
check('lint: duplikat rule_id = blad', errors.some((e) => /duplikat rule_id RLS-A/.test(e)), errors.join('\n'));
check('lint: wiecej komorek niz naglowek = blad', errors.some((e) => /SHIFT-Z: 6 komorek/.test(e)), errors.join('\n'));
check('lint: mniej komorek = uwaga, nie blad', warnings.some((w) => /SHORT-W: 3 komorek z 5/.test(w)) && !errors.some((e) => /SHORT-W/.test(e)));
check('lint: status spoza listy = uwaga', warnings.some((w) => /ODD-V: status „BRAMKA”/.test(w)));
check('lint: nieznany dzial w tagu = uwaga', warnings.some((w) => /dept:nope/.test(w)));

const s = stats(rows, new Set(['RLS-A']));
// SHIFT-Z: niezescapowany | przesuwa kolumny, Status czyta `—` z kolumny Detekcja -> dlug 2 (dlatego lint robi z tego blad)
check('stats: dlug = status — (wlacznie z przesunietym SHIFT-Z)', s.debt_rows === 2, JSON.stringify(s));
check('stats: golden liczony po rule_id (duplikat liczy sie dwa razy)', s.golden_rows === 2, JSON.stringify(s));
check('stats: tag spoza sekcji i wiersze bez dzialu', s.tagged_outside_section === 2 && s.untagged_misc === 4, JSON.stringify(s));
check('stats: golden null bez pliku', stats(rows, null).golden_pct === null);

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-cases-'));
try {
  const f = path.join(root, 'cases.md');
  fs.writeFileSync(f, FIXTURE);
  const cli = (...a) => spawnSync('node', [TOOL, '--file', f, ...a], { encoding: 'utf8', timeout: 30000 });
  const d = cli('--dept', 'data', '--count');
  check('CLI --dept data --count = 3 (sekcja + tag)', d.status === 0 && d.stdout.trim() === '3', `${d.status} ${d.stdout}`);
  const sec = cli('--dept', 'security,data', '--json');
  check('CLI --dept security,data --json', sec.status === 0 && JSON.parse(sec.stdout).map((r) => r.rule_id).includes('GRANT-X'), sec.stdout.slice(0, 200));
  check('CLI --lint z bledami -> exit 1', cli('--lint').status === 1);
  check('CLI nieznany dzial -> exit 2', cli('--dept', 'qa').status === 2);
  check('CLI bez argumentu -> exit 2', cli().status === 2);
  check('CLI brak pliku -> exit 2', spawnSync('node', [TOOL, '--file', path.join(root, 'nie.md'), '--lint'], { encoding: 'utf8' }).status === 2);
  check('CLI --dept: status bez tagu + dzialy w wydruku (A24 code: nie surowa kolumna)',
    /- GRANT-X \(pg\/cases\.md:12, [^)]*\) \[G; misc,security,data\]/.test(cli('--dept', 'security').stdout), cli('--dept', 'security').stdout);
  // Tabela bez |---| (A24, cases.md:200): pierwszy wiersz danych czytany jako naglowek -> lint blad, exit 1
  const hl = path.join(root, 'headerless.md');
  fs.writeFileSync(hl, '## OPS\n| rule_id | Wzorzec | Status |\n|---|---|---|\n| OK-1 | a | G |\n\n| LOST-1 | zniknal | G |\n| NEXT-1 | b | G |\n');
  const hlr = spawnSync('node', [TOOL, '--file', hl, '--lint'], { encoding: 'utf8' });
  check('lint: tabela bez separatora = blad (blizna czytana jako naglowek)', hlr.status === 1 && /tabela bez wiersza \|---\| — „LOST-1”/.test(hlr.stdout), hlr.stdout);
  // Uszkodzony pg/eval/cases.json = blad narzedzia (exit 2), nie „brak pliku” (A24 code)
  fs.mkdirSync(path.join(root, 'pg', 'eval'), { recursive: true });
  fs.writeFileSync(path.join(root, 'pg', 'cases.md'), FIXTURE);
  fs.writeFileSync(path.join(root, 'pg', 'eval', 'cases.json'), '{zepsuty');
  const bad = spawnSync('node', [TOOL, '--file', path.join(root, 'pg', 'cases.md'), '--stats'], { encoding: 'utf8' });
  check('stats: nieczytelny cases.json -> exit 2 z nazwa pliku', bad.status === 2 && /nieczytelny .*cases\.json/.test(bad.stderr), `${bad.status} ${bad.stderr}`);
  fs.writeFileSync(path.join(root, 'empty.md'), '# nic\n');
  check('CLI plik bez tabel -> exit 2', spawnSync('node', [TOOL, '--file', path.join(root, 'empty.md'), '--stats'], { encoding: 'utf8' }).status === 2);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

// Prawdziwy rejestr blizn: lint bez bledow, kazdy wiersz ma dzial (sekcja albo tag).
const realParsed = parse(fs.readFileSync(path.join(__dirname, '..', 'pg', 'cases.md'), 'utf8'));
const real = realParsed.rows;
const realLint = lint(real, realParsed.headerless);
const realDept = (id) => (real.find((r) => r.rule_id === id) || { depts: [] }).depts;
check('pg/cases.md: blizny RLS/DEFINER widzi security (A24 security)', ['RLS-DEFINER-NO-AUTH', 'TENANT-FK-NO-ORG', 'RLS-ANON-WRITE'].every((id) => realDept(id).includes('security')));
check('pg/cases.md: blizna CSS ma wiersz dla ux (A25 code)', realDept('REDUCED-MOTION-CASCADE-DEAD-CODE').includes('ux'));
check('pg/cases.md: wiersze spod „CSS:” nie ida do ux, LOVABLE-PUBLISH jest blizna (A24 code)',
  !realDept('SHALLOW-CLONE-FAKE-CLEAN-SCAN').includes('ux') && realDept('PIPEFAIL-GREP-V-EMPTY-EQUALS-FAIL').includes('ops') && realDept('LOVABLE-PUBLISH-IS-NOT-GITHUB-DEPLOY').includes('ops'));
check('pg/cases.md: lint 0 bledow', realLint.errors.length === 0, realLint.errors.join('\n'));
check('pg/cases.md: 0 wierszy bez dzialu', stats(real, null).untagged_misc === 0, String(stats(real, null).untagged_misc));

// Konsumenci (A26 ops): kazdy agents/*-reviewer.md z pg-cases.js podaje znany dzial i ma fallback na exit != 0 / pusty wynik.
const { DEPTS } = require(TOOL);
const agentsDir = path.join(__dirname, '..', 'agents');
const consumers = fs.readdirSync(agentsDir).filter((f) => f.endsWith('-reviewer.md'))
  .map((f) => [f, fs.readFileSync(path.join(agentsDir, f), 'utf8')]).filter(([, t]) => t.includes('pg-cases.js'));
check('agents: 4 recenzentow czyta pg-cases.js', ['code', 'data', 'ops', 'security'].every((r) => consumers.some(([f]) => f === `${r}-reviewer.md`)), consumers.map(([f]) => f).join());
for (const [f, t] of consumers) {
  const depts = [...t.matchAll(/pg-cases\.js --dept ([a-z,]+)/g)].flatMap((m) => m[1].split(','));
  check(`agents/${f}: --dept ze znanej listy`, depts.length > 0 && depts.every((d) => DEPTS.includes(d)), depts.join());
  check(`agents/${f}: fallback przy exit != 0 / pustym wyniku`, /Exit != 0 albo pusty wynik|exit != 0 albo pusty wynik/.test(t) && t.includes('pg/cases.md'));
}

console.log(failures ? `\n${failures} FAIL` : '\nwszystkie OK');
process.exit(failures ? 1 : 0);

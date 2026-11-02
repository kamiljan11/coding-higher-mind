// Testy plan-refs-check (P1-lite 2026-11-01). Uruchom: node test_plan_refs_check.js (0 sieci; fixture w os.tmpdir(), kasowany).
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { extractRefs, check } = require(path.join(__dirname, 'plan-refs-check.js'));

let failures = 0;
const ok = (name, cond, detail) => { if (cond) console.log('ok  ', name); else { failures++; console.log('FAIL', name, detail || ''); } };

const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-refs-'));
try {
  execFileSync('git', ['init', '-q', repo]);
  fs.mkdirSync(path.join(repo, 'src', 'lib'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'src', 'lib', 'price.ts'), 'export function computeVat() {\n  return 1;\n}\n');
  execFileSync('git', ['-C', repo, 'add', '.']);
  const plan = path.join(repo, 'plan.md');
  fs.writeFileSync(plan, [
    '1. Zmien `src/lib/price.ts:2` i wywolaj `computeVat()`.',               // istnieje
    '2. Popraw `src/lib/tax.ts` oraz `src/lib/price.ts:40`.',                 // brak pliku + linia poza plikiem
    '3. Uzyj `formatMoney()` z utils.',                                       // brak symbolu
    '4. Nowy plik `src/lib/new-thing.ts`.',                                   // marker nowego -> pomijany
    '5. Zobacz `https://x.dev/a.ts`, `~/.claude/pg/design.md`, `src/*.ts`, `<sciezka>/x.ts`, `npm test`.', // pomijane
    '6. Wyjscie poza repo `../../etc/passwd.md`.',
    '7. Gola nazwa `price.ts`, brak `ghost.ts`, ref gita `origin/HEAD`, alternatywa `refs/heads|remotes`, log `logs/run.jsonl`.',
  ].join('\n'));
  fs.writeFileSync(path.join(repo, '.gitignore'), 'logs/\n');
  const refs = extractRefs(fs.readFileSync(plan, 'utf8'));
  ok('extract: pomija URL, ~/, glob, placeholder, komendy, linie z markerem nowego', refs.every((r) => r.line !== 4 && r.line !== 5), JSON.stringify(refs));
  const r = check(plan, repo);
  const why = (ref) => (r.missing.find((m) => m.ref === ref) || {}).why;
  ok('istniejacy plik:linia i symbol -> brak zgloszenia', !why('src/lib/price.ts:2') && !why('computeVat()'), JSON.stringify(r.missing));
  ok('brak pliku -> zgloszony', why('src/lib/tax.ts') === 'brak pliku');
  ok('linia poza plikiem -> zgloszona', /linia 40 poza plikiem \(3 linii\)/.test(why('src/lib/price.ts:40') || ''), why('src/lib/price.ts:40'));
  ok('brak symbolu -> zgloszony', /brak symbolu/.test(why('formatMoney()') || ''));
  ok('sciezka poza repo -> zgloszona', why('../../etc/passwd.md') === 'sciezka wychodzi poza repo');
  ok('gola nazwa sledzonego pliku -> OK; nieznana -> zgloszona', !why('price.ts') && /git ls-files/.test(why('ghost.ts') || ''), JSON.stringify(r.missing));
  ok('ref gita / alternatywa z | / plik ignorowany (logi) -> pomijane', !why('origin/HEAD') && !why('refs/heads|remotes') && !why('logs/run.jsonl'), JSON.stringify(r.missing));
  ok('A4: liczba pominietych linii z markerem nowego pliku w wyniku', r.skipped_new_lines === 1, String(r.skipped_new_lines));
  const tech = extractRefs('Uzyj `Next.js`, `Node.js`, `./` i `../`.');
  ok('A4: nazwy technologii i ./ ../ nie sa sciezkami', tech.length === 0, JSON.stringify(tech));
  const app = extractRefs('Edytuj `App.js` i `Button.js`.\nNowy plik `x/y.ts`.');
  ok('A5: App.js / Button.js to pliki (sprawdzane); "Nowy" wielka litera = marker', app.map((x) => x.ref).join() === 'App.js,Button.js' && app.skippedNewLines === 1, JSON.stringify(app));
  const lower = extractRefs('Zmien `express.js`, `chart.js` i `Chart.js`.');
  ok('A6: express.js / chart.js / Chart.js sa sprawdzane (lista technologii z wielkoscia liter)', lower.length === 3, JSON.stringify(lower));
  const cli = (...a) => spawnSync('node', [path.join(__dirname, 'plan-refs-check.js'), ...a], { encoding: 'utf8' });
  ok('CLI: brakujace -> exit 1', cli(plan, '--repo', repo).status === 1);
  fs.writeFileSync(plan, 'Tylko `src/lib/price.ts` i `computeVat()`.\n');
  ok('CLI: komplet -> exit 0', cli(plan, '--repo', repo).status === 0);
  ok('CLI: brak pliku planu -> exit 2 (blad narzedzia, nie werdykt)', cli(path.join(repo, 'nie-ma.md'), '--repo', repo).status === 2);
} finally {
  fs.rmSync(repo, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} FAIL` : '\nwszystkie OK');
process.exit(failures ? 1 : 0);

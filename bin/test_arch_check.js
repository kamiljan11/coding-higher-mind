#!/usr/bin/env node
'use strict';
// test_arch_check.js — testy arch-check.js (zgodnosc repo z macierza obszarow). Zero zaleznosci; odpalaj: node test_arch_check.js
// Fixture = tymczasowe repo git w %TEMP% (usuwane na koncu).
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CHECK = path.join(__dirname, 'arch-check.js');
const A = require(CHECK);
const L = require(path.join(__dirname, 'sd-matrix-lint.js'));
const { areas } = L.loadAreas(path.join(ROOT, 'pg', 'sd-areas.json'));
const FIX = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-archcheck-'));

let failures = 0;
function ok(desc, cond, detail) {
  if (cond) console.log(`PASS: ${desc}`);
  else { console.log(`FAIL: ${desc}${detail ? ' — ' + detail : ''}`); failures++; }
}
const write = (rel, content) => { const f = path.join(FIX, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, content); };
const git = (...args) => spawnSync('git', ['-C', FIX, '-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { encoding: 'utf8' });
const run = (...args) => spawnSync(process.execPath, [CHECK, '--repo', FIX, ...args], { encoding: 'utf8' });

const HEAD = '| Obszar (id) | Status | Decyzja / uzasadnienie | Dowod | Sygnal powrotu |\n|---|---|---|---|---|\n';
const SPECIAL = {
  caching: '| Caching (caching) | DECYZJA | brak cache wspoldzielonego, odczyt z Postgresa | `src/lib/db.ts:2` | — |',
  'docker-containers': '| Docker (docker-containers) | NIE DOTYCZY | serverless, brak obrazow | | |',
  'real-time': '| Real-time (real-time) | NIE TERAZ | brak live | — | > 50 jednoczesnych edycji |',
};
const matrix = () => HEAD + areas.map((a) => SPECIAL[a.id] || `| ${a.name} (${a.id}) | DECYZJA | Postgres/Supabase | \`src/app/(app)/radar/actions.ts\`, profil/actions.ts | — |`).join('\n') + '\n';

try {
  // --- stan bazowy: kompletna macierz, kod zgodny ---
  git('init', '-q');
  write('docs/architecture/obszary.md', matrix());
  write('package.json', JSON.stringify({ dependencies: { next: '16.0.0' } }));
  write('src/lib/db.ts', 'line1\nline2\nline3\n');
  write('src/app/(app)/radar/actions.ts', 'export {}\n');
  write('src/app/(app)/profil/actions.ts', 'export {}\n');
  git('add', '-A'); git('commit', '-qm', 'base');
  let r = run('--json');
  let j = JSON.parse(r.stdout);
  ok('zgodne repo -> 0 problemow, exit 0 (skrot sciezki profil/actions.ts rozwiazany sufiksem, nawiasy (app) w sciezce)', r.status === 0 && j.issues.length === 0, r.stdout.slice(0, 400));
  ok('brief zgodnego repo = pusto', run('--brief').stdout === '');

  // --- drift w sesji ---
  const base = git('rev-parse', 'HEAD').stdout.trim();
  write('package.json', JSON.stringify({ dependencies: { next: '16.0.0', ioredis: '5.0.0', ws: '8.0.0' } }));
  write('Dockerfile', 'FROM node:22\n');
  write('src/lib/db.ts', 'only1\n');
  r = run('--json');
  j = JSON.parse(r.stdout);
  const kinds = (k) => j.issues.filter((i) => i.kind === k).map((i) => i.area);
  ok('ioredis przy DECYZJI caching bez wzmianki -> undeclared', kinds('undeclared').includes('caching'), JSON.stringify(j.issues));
  ok('Dockerfile przy NIE DOTYCZY -> drift docker-containers', kinds('drift').includes('docker-containers'));
  ok('ws przy NIE TERAZ real-time -> drift', kinds('drift').includes('real-time'));
  ok('dowod src/lib/db.ts:2 po skroceniu pliku -> stale-evidence', kinds('stale-evidence').includes('caching'));
  ok('exit 1 przy problemach', r.status === 1);

  // --- --since: nowe vs stare ---
  git('add', '-A'); git('commit', '-qm', 'drift');
  r = run('--json', '--since', base, '--new-only');
  j = JSON.parse(r.stdout);
  ok('--since base --new-only: 4 nowe problemy', j.issues.length === 4 && r.status === 1, JSON.stringify(j.issues.map((i) => i.key)));
  const sha = git('rev-parse', 'HEAD').stdout.trim();
  r = run('--json', '--since-shas', sha, '--new-only');
  j = JSON.parse(r.stdout);
  ok('--since-shas <commit sesji> -> baza = rodzic, te same 4 nowe', j.issues.length === 4 && j.base === base, `${j.base} vs ${base}`);
  r = run('--json', '--since', 'HEAD', '--new-only');
  ok('--since HEAD (nic nowego od commitu) -> exit 0', r.status === 0, r.stdout.slice(0, 300));

  // --- naprawa przez aktualizacje macierzy ---
  write('docs/architecture/obszary.md', matrix()
    .replace(SPECIAL.caching, '| Caching (caching) | DECYZJA | Redis (ioredis) na sesje | `package.json` | — |')
    .replace(SPECIAL['docker-containers'], '| Docker (docker-containers) | DECYZJA | obraz do workera | `Dockerfile` | — |')
    .replace(SPECIAL['real-time'], '| Real-time (real-time) | DECYZJA | ws do podgladu | `package.json` | — |'));
  r = run('--json');
  j = JSON.parse(r.stdout);
  ok('macierz zaktualizowana (DECYZJA z wzmianka) -> 0 problemow', r.status === 0 && j.issues.length === 0, JSON.stringify(j.issues));

  // --- brief i brak macierzy ---
  const brief = A.brief('x', { issues: [{ kind: 'gap', area: 'stack-pay', msg: 'stack-pay: brak wiersza', oneWay: false }, { kind: 'drift', area: 'caching', msg: 'redis/kv: zaleznosc ioredis' }] }, false);
  ok('brief: 1-3 linie, drift + warstwy stack', brief.split('\n').length <= 3 && /drift 1/.test(brief) && /warstwy stack bez wiersza 1/.test(brief), brief);
  fs.renameSync(path.join(FIX, 'docs/architecture/obszary.md'), path.join(FIX, 'obszary.bak'));
  r = run('--brief');
  ok('brak macierzy przy package.json -> podpowiedz bez blokady', /brak macierzy obszarow/.test(r.stdout) && /Bez blokady/.test(r.stdout), r.stdout);
  write('CLAUDE.md', '- `pg.sd_matrix: required`\n');
  r = run('--brief');
  ok('brak macierzy + pg.sd_matrix: required -> BRAK (twardy komunikat)', /BRAK macierzy/.test(r.stdout), r.stdout);

  // --- parser dowodow ---
  const ev = A.evidencePaths('`src/app/(app)/x.ts:12`, F2.3/F3.6, https://a.b/c.ts, ~/x/y.md, (docs/FEATURE-MAP.md:22-23)');
  ok('evidencePaths: nawiasy tras, zakres linii; bez F2.3/F3.6, URL i ~', JSON.stringify(ev) === JSON.stringify([{ path: 'src/app/(app)/x.ts', line: 12 }, { path: 'docs/FEATURE-MAP.md', line: 22 }]), JSON.stringify(ev));

  // --- sygnaly NIE TERAZ ---
  fs.renameSync(path.join(FIX, 'obszary.bak'), path.join(FIX, 'docs/architecture/obszary.md'));
  write('docs/architecture/obszary.md', matrix());
  r = run('--signals');
  ok('--signals wypisuje NIE TERAZ z progiem', /real-time: > 50 jednoczesnych edycji/.test(r.stdout) && r.status === 0, r.stdout);

  // --- zly ref w --since = blad (exit 2), nie pusta baza (code-review 1011) ---
  r = run('--since', 'nosuchref', '--new-only');
  ok('--since nieznany ref -> exit 2 + komunikat', r.status === 2 && /nieznany ref/.test(r.stderr), `exit=${r.status} ${r.stderr}`);

  // --- SessionStart z podkatalogu repo -> korzen repo (monorepo), linia [ARCH] ---
  r = spawnSync(process.execPath, [path.join(ROOT, 'hooks', 'session-context.js')], { input: JSON.stringify({ source: 'startup', cwd: path.join(FIX, 'src', 'lib') }), encoding: 'utf8', timeout: 30000 });
  ok('session-context z podkatalogu -> [ARCH] dla korzenia repo', new RegExp(`\\[ARCH\\] ${path.basename(FIX)}: drift`).test(r.stdout), (r.stdout || '').split('\n').filter((l) => /ARCH/.test(l)).join(' | ') || `exit=${r.status}`);

  // --- sygnal z kodu (git grep) na working tree i na refie; Dockerfile zagniezdzony; baza = pierwszy commit ---
  const R2 = path.join(FIX, 'code-repo');
  const g2 = (...args) => spawnSync('git', ['-C', R2, '-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { encoding: 'utf8' });
  const w2 = (rel, c) => { const f = path.join(R2, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, c); };
  fs.mkdirSync(R2);
  g2('init', '-q');
  w2('docs/architecture/obszary.md', matrix());
  w2('package.json', JSON.stringify({ dependencies: { next: '16.0.0' } }));
  w2('src/lib/db.ts', 'line1\nline2\nline3\n');
  w2('src/app/(app)/radar/actions.ts', 'export {}\n');
  w2('src/app/(app)/profil/actions.ts', 'export {}\n');
  w2('src/live.ts', "supabase.channel('orders').subscribe()\n");
  w2('apps/worker/Dockerfile', 'FROM node:22\n');
  g2('add', '-A'); g2('commit', '-qm', 'first');
  const first = g2('rev-parse', 'HEAD').stdout.trim();
  j = JSON.parse(spawnSync(process.execPath, [CHECK, '--repo', R2, '--json'], { encoding: 'utf8' }).stdout);
  ok('kod `.channel(` przy NIE TERAZ real-time -> drift z plikiem src/live.ts', j.issues.some((i) => i.kind === 'drift' && i.area === 'real-time' && /kod src\/live\.ts/.test(i.msg)), JSON.stringify(j.issues.map((i) => i.msg)));
  ok('apps/worker/Dockerfile (zagniezdzony) -> drift docker-containers', j.issues.some((i) => i.kind === 'drift' && i.area === 'docker-containers'), JSON.stringify(j.issues.map((i) => i.msg)));
  const atRef = A.check(R2, A.makeTree(R2, 'HEAD', true), L.loadAreas(path.join(ROOT, 'pg', 'sd-areas.json')));
  ok('git grep na refie: sciezka bez prefiksu `HEAD:`', atRef.issues.some((i) => /kod src\/live\.ts/.test(i.msg)), JSON.stringify(atRef.issues.map((i) => i.msg)));
  j = JSON.parse(spawnSync(process.execPath, [CHECK, '--repo', R2, '--json', '--new-only', '--since-shas', first], { encoding: 'utf8' }).stdout);
  ok('--since-shas <pierwszy commit> -> baza null, wszystko NOWE', j.base === null && j.issues.length >= 2, `base=${j.base} n=${j.issues.length}`);

  // --- korzen repo z podkatalogu + wylaczniki (ops-review 1011) ---
  r = spawnSync(process.execPath, [CHECK, '--repo', path.join(R2, 'apps', 'worker'), '--json'], { encoding: 'utf8' });
  ok('--repo podkatalog -> sprawdza korzen (macierz znaleziona, drift widoczny)', JSON.parse(r.stdout).repo === fs.realpathSync(R2) && r.status === 1, r.stdout.slice(0, 200));
  r = spawnSync(process.execPath, [CHECK, '--repo', R2, '--brief'], { encoding: 'utf8', env: Object.assign({}, process.env, { PG_ARCH_CHECK: '0' }) });
  ok('PG_ARCH_CHECK=0 -> cisza, exit 0', r.status === 0 && r.stdout === '', `exit=${r.status} ${r.stdout}`);
  w2('CLAUDE.md', '# repo\n- `pg.arch_check: off` <!-- stary Lovable -->\n');
  r = spawnSync(process.execPath, [CHECK, '--repo', R2, '--brief'], { encoding: 'utf8' });
  ok('`pg.arch_check: off` w CLAUDE.md -> cisza, exit 0', r.status === 0 && r.stdout === '', `exit=${r.status} ${r.stdout}`);
  w2('CLAUDE.md', '# repo\nKiedys mozna ustawic `pg.arch_check: off` w zdaniu.\n');
  r = spawnSync(process.execPath, [CHECK, '--repo', R2, '--brief'], { encoding: 'utf8' });
  ok('wzmianka w prozie != wylacznik', r.status === 1, `exit=${r.status}`);
} finally {
  fs.rmSync(FIX, { recursive: true, force: true });
}
console.log(failures ? `TESTY: ${failures} FAIL` : 'TESTY: wszystkie OK');
process.exit(failures ? 1 : 0);

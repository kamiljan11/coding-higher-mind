#!/usr/bin/env node
// Testy module-boundaries.js: czyste funkcje (parser, Tarjan, warstwy) + pelny przebieg na fikstorze git (nowy vs stary cykl).
// Uruchom: node ~/.claude/bin/test_module_boundaries.js
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
// telemetria testow do %TEMP%, nie do produkcyjnego gates.jsonl (gate-log honoruje PG_GATE_LOG tylko w tmpdir)
process.env.PG_GATE_LOG = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mb-gates-')), 'gates.jsonl');
const mb = require('./module-boundaries.js');

let n = 0;
const it = (name, fn) => { fn(); n++; console.log('ok   ' + name); };

it('parseImports: import/export-from/require/dynamic, komentarze pominiete', () => {
  const src = [
    "import a from './a';", "import { b } from \"../b\";", "export * from './c';", "const d = require('./d');",
    "const e = await import('./e');", "// import x from './nope';", "import type { T } from '@/types';", "import 'side-effect';",
  ].join('\n');
  const specs = mb.parseImports(src).map((x) => x.spec);
  assert.deepEqual(specs, ['./a', '../b', './c', './d', './e', '@/types', 'side-effect']);
  assert.equal(mb.parseImports(src)[3].line, 4);
});

it('resolveSpecifier: relatywne, index, alias @/ -> src/, pakiet = null', () => {
  const files = new Set(['src/lib/a.ts', 'src/features/x/index.tsx', 'src/routes/r.tsx']);
  const al = [['@/', 'src/']];
  assert.equal(mb.resolveSpecifier('../lib/a', 'src/routes/r.tsx', files, al), 'src/lib/a.ts');
  assert.equal(mb.resolveSpecifier('@/features/x', 'src/routes/r.tsx', files, al), 'src/features/x/index.tsx');
  assert.equal(mb.resolveSpecifier('react', 'src/routes/r.tsx', files, al), null);
  assert.equal(mb.resolveSpecifier('./a.js', 'src/lib/b.ts', files, al), 'src/lib/a.ts');
});

it('findCycles: Tarjan znajduje SCC > 1, ignoruje DAG', () => {
  const g = new Map([['a', new Set(['b'])], ['b', new Set(['c'])], ['c', new Set(['a'])], ['d', new Set(['a'])], ['e', new Set()]]);
  const cycles = mb.findCycles(g);
  assert.equal(cycles.length, 1);
  assert.deepEqual(cycles[0], ['a', 'b', 'c']);
  assert.deepEqual(mb.findCycles(new Map([['x', new Set(['y'])], ['y', new Set()]])), []);
});

it('findCycles: iteracyjny Tarjan wytrzymuje lancuch 20 000 plikow (brak stack overflow)', () => {
  const g = new Map();
  for (let i = 0; i < 20000; i++) g.set('f' + i, new Set(['f' + (i + 1)]));
  g.set('f20000', new Set(['f0']));
  assert.equal(mb.findCycles(g)[0].length, 20001);
});

it('layerViolations: import w gore = naruszenie, w dol = OK, forbid jawne', () => {
  const rules = { layers: ['src/routes', 'src/features', 'src/lib'], forbid: [{ from: 'src/lib', to: 'src/integrations', why: 'lib bez I/O' }] };
  const edges = [
    { from: 'src/lib/price.ts', to: 'src/features/billing/x.ts', line: 3, spec: '@/features/billing/x' },
    { from: 'src/routes/r.tsx', to: 'src/lib/price.ts', line: 1, spec: '@/lib/price' },
    { from: 'src/lib/db.ts', to: 'src/integrations/supabase/client.ts', line: 2, spec: '@/integrations/supabase/client' },
  ];
  const v = mb.layerViolations(edges, rules);
  assert.equal(v.length, 2);
  assert.match(v[0].rule, /src\/lib nie importuje z src\/features/);
  assert.match(v[1].rule, /forbid src\/lib -> src\/integrations \(lib bez I\/O\)/);
});

it('moduleOf: slice features, edge fn, katalog src, katalog najwyzszego poziomu', () => {
  assert.equal(mb.moduleOf('src/features/jobs/api.ts'), 'src/features/jobs');
  assert.equal(mb.moduleOf('supabase/functions/send-sms/index.ts'), 'supabase/functions/send-sms');
  assert.equal(mb.moduleOf('src/routes/_app/jobs.tsx'), 'src/routes');
  assert.equal(mb.moduleOf('supabase/migrations/1_init.sql'), 'supabase');
  assert.equal(mb.moduleOf('README.md'), '.');
  assert.equal(mb.moduleOf('src/server/radar/calendar.ts'), 'src/server/radar');
  assert.equal(mb.moduleOf('src/server/env.ts'), 'src/server');
});

it('parseTableRefs: .from tabeli tak; storage/Array/Buffer.from i komentarze nie', () => {
  const src = [
    "const { data } = await supabase.from('jobs').select();", 'await supabase.storage.from("avatars").upload(p, f);',
    "const a = Array.from('abc'); const b = Buffer.from('x');", "// supabase.from('ghost')", 'db.schema("x").from(`vehicles`)',
  ].join('\n');
  assert.deepEqual(mb.parseTableRefs(src), [{ table: 'jobs', line: 1 }, { table: 'vehicles', line: 5 }]);
});

it('secretLeaks: owner poza wlascicielem, stopien bez owners, SDK poza adapterem', () => {
  const usage = mb.tableUsage(['src/features/jobs/api.ts', 'src/features/board/a.ts', 'src/features/mechanic/b.ts', 'src/routes/x.tsx'],
    () => "supabase.from('jobs'); supabase.from('notes')");
  assert.equal(usage.get('jobs').size, 4);
  const refs = [
    { file: 'src/features/board/a.ts', line: 1, table: 'jobs' }, { file: 'src/features/jobs/api.ts', line: 2, table: 'jobs' },
    { file: 'src/routes/x.tsx', line: 3, table: 'notes' },
  ];
  const imports = [{ file: 'src/features/billing/pay.ts', line: 1, spec: 'stripe' }, { file: 'src/integrations/stripe/index.ts', line: 1, spec: 'stripe' }, { file: 'src/x.ts', line: 1, spec: 'react' }];
  const withOwner = mb.secretLeaks(refs, imports, usage, { owners: { jobs: 'src/features/jobs' } });
  assert.deepEqual(withOwner.map((l) => `${l.kind}:${l.file}`), ['table:src/features/board/a.ts', 'table:src/routes/x.tsx', 'vendor:src/features/billing/pay.ts']);
  assert.match(withOwner[0].why, /sekretem src\/features\/jobs/);
  assert.match(withOwner[1].why, /notes znana w 4 modulach \(> 2\)/);
  const noOwners = mb.secretLeaks(refs.slice(0, 2), [], usage, { maxTableModules: 5 });
  assert.equal(noOwners.length, 0, 'ponizej progu = cisza');
});

it('secretLeaks: shared = tabela przekrojowa poza liczeniem; edge fn dostaje wskazowke RPC/shared zamiast index.ts', () => {
  const files = ['src/features/a/x.ts', 'src/features/b/y.ts', 'src/features/c/z.ts', 'supabase/functions/notify/index.ts'];
  const usage = mb.tableUsage(files, () => "db.from('organizations'); db.from('vehicles')");
  const refs = [{ file: 'supabase/functions/notify/index.ts', line: 1, table: 'organizations' }, { file: 'supabase/functions/notify/index.ts', line: 2, table: 'vehicles' }];
  const plain = mb.secretLeaks(refs, [], usage, {});
  assert.equal(plain.length, 2);
  assert.match(plain[0].why, /edge fn zna tabele organizations .*wpisz do shared/);
  assert.doesNotMatch(plain[0].why, /index\.ts/, 'edge fn nie zaimportuje index.ts slice\'a');
  const withShared = mb.secretLeaks(refs, [], usage, { shared: ['organizations'] });
  assert.deepEqual(withShared.map((l) => l.table), ['vehicles'], 'shared poza liczeniem, domenowa dalej sygnal');
  const owned = mb.secretLeaks(refs.slice(1), [], usage, { owners: { vehicles: 'src/features/a' } });
  assert.match(owned[0].why, /RPC\/widok wlasciciela/);
  const slice = mb.secretLeaks([{ file: 'src/features/b/y.ts', line: 1, table: 'vehicles' }], [], usage, { owners: { vehicles: 'src/features/a' } });
  assert.match(slice[0].why, /wolaj funkcje z jego index\.ts/, 'slice w procesie: wskazowka bez zmian');
  assert.equal(mb.leakRules({ shared: 'profiles' }).problems.length, 1, 'zly typ shared = problem, nie wyjatek');
  assert.equal(mb.leakRules({ shared: ['profiles'] }).shared.has('profiles'), true);
  assert.match(mb.leakRules({ shared: ['vehicles'], owners: { vehicles: 'src/features/a' } }).problems[0], /owners i shared naraz.*vehicles/);
  const direct = mb.secretLeaks([{ file: 'supabase/functions/helper.ts', line: 1, table: 'vehicles' }], [], usage, { owners: { vehicles: 'src/features/a' } });
  assert.match(direct[0].why, /edge fn zna tabele vehicles/, 'plik wprost w supabase/functions = tez edge fn');
});

it('parseTableRefs: .from lamane przez Prettiera, myStorage/Observable/Promise.from to nie tabele', () => {
  const src = "const a = db\n  .from(\n    'users')\n  .select();\nx.myStorage.from('t2'); Observable.from('abc'); Promise.from('p');";
  assert.deepEqual(mb.parseTableRefs(src), [{ table: 'users', line: 2 }]);
  const comments = "foo.from('y') // .from('z')\n/* x */ db.from('d')\n/* otwarty .from('e')\n * .from('f')\nfetch('https://x').then(); db.from('g')";
  assert.deepEqual(mb.parseTableRefs(comments).map((r) => r.table), ['y', 'd', 'g']);
});

it('leakRules + secretLeaks: zly typ pol z ARCHITECTURE.md = problem na liscie, nigdy wyjatek', () => {
  const refs = [{ file: 'src/a/x.ts', line: 1, table: 'p' }];
  const imps = [{ file: 'src/a/x.ts', line: 2, spec: 'stripe' }];
  for (const bad of [{ adapters: 'src/integrations' }, { vendors: 5 }, { owners: { p: ['x'] } }, { owners: ['x'] }, { owners: { p: ' ' } }, { maxTableModules: 'dwa' }]) {
    assert.doesNotThrow(() => mb.secretLeaks(refs, imps, new Map(), bad), JSON.stringify(bad));
    assert.equal(mb.leakRules(bad).problems.length, 1, JSON.stringify(bad));
  }
  assert.deepEqual(mb.leakRules({}).problems, []);
});

it('secretLeaks: modul, ktory znal tabele przed zmiana = cisza (dlug, nie nowy wyciek); nowy modul = ostrzezenie', () => {
  const usage = new Map([['jobs', new Map([['src/features/a', 1], ['src/features/b', 1], ['src/features/c', 1]])]]);
  const base = new Map([['jobs', new Map([['src/features/a', 1], ['src/features/b', 1]])]]);
  const refs = [{ file: 'src/features/a/x.ts', line: 1, table: 'jobs' }, { file: 'src/features/c/y.ts', line: 1, table: 'jobs' }];
  assert.deepEqual(mb.secretLeaks(refs, [], usage, {}, base).map((l) => l.file), ['src/features/c/y.ts']);
});

it('amplification: moduly na commit, szerokie > 3', () => {
  const a = mb.amplification([['src/features/a/x.ts', 'src/features/a/y.ts'], ['src/features/a/x.ts', 'src/features/b/x.ts', 'src/lib/p.ts', 'src/routes/r.tsx'], []]);
  assert.deepEqual(a.histogram, { 1: 1, 4: 1 });
  assert.equal(a.commits, 2); assert.equal(a.wide, 1);
});

/* ── fikstura git: nowy cykl blokuje, stary nie ── */
function sh(cwd, args) { return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
function write(root, rel, text) { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); }

it('analyze: cykl istniejacy w bazie = stary (nie blokuje); cykl dodany w diffie = NOWY (blokuje); warstwy z ARCHITECTURE.md', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mb-'));
  const hooksOff = fs.mkdtempSync(path.join(os.tmpdir(), 'mb-hooks-'));
  sh(root, ['init', '-q', '-b', 'main']);
  sh(root, ['config', 'user.email', 't@t']); sh(root, ['config', 'user.name', 't']); sh(root, ['config', 'core.hooksPath', hooksOff]); sh(root, ['config', 'commit.gpgsign', 'false']);
  write(root, 'src/lib/a.ts', "import { b } from './b';\nexport const a = 1;\n");
  write(root, 'src/lib/b.ts', "import { a } from './a';\nexport const b = 2;\n"); // stary cykl a<->b
  write(root, 'src/features/f.ts', "import { a } from '@/lib/a';\nexport const f = a;\n");
  write(root, 'src/routes/r.tsx', "import { f } from '@/features/f';\nexport default f;\n");
  write(root, 'docs/ARCHITECTURE.md', '# A\n\n```json\n{ "pg.boundaries": true, "layers": ["src/routes", "src/features", "src/lib"], "maxFanIn": 1 }\n```\n');
  sh(root, ['add', '-A']); sh(root, ['commit', '-q', '-m', 'base']);
  sh(root, ['branch', 'origin/main']); // udajemy remote: ref o nazwie origin/main
  const clean = mb.analyze(root, { base: 'origin/main', staged: false });
  assert.equal(clean.newCycles.length, 0); assert.equal(clean.oldCycles.length, 1); assert.equal(clean.violations.length, 0);

  // zmiana: features <-> routes cykl (nowy) + lib importuje features (warstwy) + fan-in a.ts
  write(root, 'src/features/f.ts', "import { a } from '@/lib/a';\nimport r from '@/routes/r';\nexport const f = a;\n");
  write(root, 'src/lib/a.ts', "import { b } from './b';\nimport { f } from '@/features/f';\nexport const a = 1;\n");
  sh(root, ['add', '-A']); sh(root, ['commit', '-q', '-m', 'change']);
  const r = mb.analyze(root, { base: 'origin/main', staged: false });
  assert.equal(r.newCycles.length, 1, 'jeden nowy cykl');
  assert.ok(r.newCycles[0].includes('src/routes/r.tsx') && r.newCycles[0].includes('src/features/f.ts'));
  assert.ok(r.oldCycles.some((c) => c.includes('src/lib/b.ts')) || r.newCycles.some((c) => c.includes('src/lib/b.ts')), 'a<->b nadal raportowany');
  // dwa importy W GORE w dodanych liniach: lib -> features (a.ts:2) i features -> routes (f.ts:2)
  assert.equal(r.violations.length, 2);
  assert.deepEqual(r.violations.map((v) => `${v.from}:${v.line}`).sort(), ['src/features/f.ts:2', 'src/lib/a.ts:2']);
  assert.ok(r.hotspots.some((h) => h.file === 'src/lib/a.ts' && h.fanIn >= 2), 'fan-in a.ts > maxFanIn=1');
  assert.deepEqual(r.leaks, [], 'brak .from/SDK w diffie = brak ostrzezen o sekrecie');

  // CLI: exit 1 na nowym cyklu, 0 gdy ALLOW nie jest sprawa narzedzia (to robi pre-push)
  let code = 0;
  try { execFileSync(process.execPath, [path.join(__dirname, 'module-boundaries.js'), '--repo', root, '--base', 'origin/main'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { code = e.status; }
  assert.equal(code, 1);
  // z --from: wpis blocked niesie items (cykl + naruszenia warstw), zeby ocenic blokade po fakcie
  try { execFileSync(process.execPath, [path.join(__dirname, 'module-boundaries.js'), '--repo', root, '--base', 'origin/main', '--from', 'pre-push'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { code = e.status; }
  assert.equal(code, 1);
  const blockedLine = fs.readFileSync(process.env.PG_GATE_LOG, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((e) => e.event === 'blocked').pop();
  assert.ok(blockedLine.items.some((i) => i.startsWith('cykl: ')), JSON.stringify(blockedLine));
  assert.ok(blockedLine.items.some((i) => /^src\/lib\/a\.ts:2 -> /.test(i)), JSON.stringify(blockedLine));
  fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(hooksOff, { recursive: true, force: true });
});

it('analyze: repo bez bloku pg.boundaries = tylko cykle, brak naruszen; --staged widzi indeks', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mb2-'));
  const hooksOff = fs.mkdtempSync(path.join(os.tmpdir(), 'mb2-hooks-'));
  sh(root, ['init', '-q', '-b', 'main']);
  sh(root, ['config', 'user.email', 't@t']); sh(root, ['config', 'user.name', 't']); sh(root, ['config', 'core.hooksPath', hooksOff]); sh(root, ['config', 'commit.gpgsign', 'false']);
  write(root, 'src/x.ts', "export const x = 1;\n"); write(root, 'src/y.ts', "import { x } from './x';\nexport const y = x;\n");
  sh(root, ['add', '-A']); sh(root, ['commit', '-q', '-m', 'base']);
  write(root, 'src/x.ts', "import { y } from './y';\nexport const x = 1;\n");
  sh(root, ['add', '-A']);
  const r = mb.analyze(root, { base: 'HEAD', staged: true });
  assert.equal(r.rules, null); assert.equal(r.newCycles.length, 1); assert.equal(r.violations.length, 0);
  fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(hooksOff, { recursive: true, force: true });
});

it('analyze + report: dodany .from cudzej tabeli i SDK = ostrzezenie, exit 0; --report liczy tabele i amplification', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mb3-'));
  const hooksOff = fs.mkdtempSync(path.join(os.tmpdir(), 'mb3-hooks-'));
  sh(root, ['init', '-q', '-b', 'main']);
  sh(root, ['config', 'user.email', 't@t']); sh(root, ['config', 'user.name', 't']); sh(root, ['config', 'core.hooksPath', hooksOff]); sh(root, ['config', 'commit.gpgsign', 'false']);
  write(root, 'src/features/jobs/api.ts', "export const list = () => supabase.from('jobs').select();\n");
  write(root, 'docs/ARCHITECTURE.md', '# A\n\n```json\n{ "pg.boundaries": true, "owners": { "jobs": "src/features/jobs" } }\n```\n');
  sh(root, ['add', '-A']); sh(root, ['commit', '-q', '-m', 'base']);
  sh(root, ['branch', 'origin/main']);
  write(root, 'src/features/board/notes.ts', "import Stripe from 'stripe';\nexport const n = () => supabase.from('jobs').select('id');\n");
  sh(root, ['add', '-A']); sh(root, ['commit', '-q', '-m', 'leak']);
  const r = mb.analyze(root, { base: 'origin/main', staged: false });
  assert.deepEqual(r.leaks.map((l) => `${l.kind}:${l.line}`).sort(), ['table:2', 'vendor:1']);
  const out = execFileSync(process.execPath, [path.join(__dirname, 'module-boundaries.js'), '--repo', root, '--base', 'origin/main', '--from', 'pre-push'], { encoding: 'utf8' });
  assert.match(out, /SEKRET \(ostrzezenie\) src\/features\/board\/notes\.ts:2/);
  const rep = mb.report(root);
  assert.equal(rep.tables[0].table, 'jobs'); assert.equal(rep.tables[0].modules, 2); assert.equal(rep.tables[0].owner, 'src/features/jobs');
  assert.equal(rep.vendorLeaks.length, 1); assert.deepEqual(rep.internalImports, []);
  assert.deepEqual(rep.amplification.histogram, { 1: 2 });
  assert.deepEqual(rep.tables[0].outsiders, ['src/features/board'], 'tabela z ownerem uzyta poza nim = naruszenie w --report');
  assert.equal(rep.tables[0].flagged, true);
  const logged = fs.readFileSync(process.env.PG_GATE_LOG, 'utf8');
  assert.match(logged, /"event":"would_block","reason":"SEKRET table".*"items":\["src\/features\/board\/notes\.ts:jobs"\]/);
  assert.match(logged, /"reason":"SEKRET vendor"/);
  assert.match(logged, /"source":"pre-push","event":"ran","reason":"ok"/);
  // reczne uruchomienie (bez --from) nie pisze telemetrii; --help nie analizuje i nie pisze
  const before = fs.readFileSync(process.env.PG_GATE_LOG, 'utf8').length;
  execFileSync(process.execPath, [path.join(__dirname, 'module-boundaries.js'), '--repo', root, '--base', 'origin/main'], { encoding: 'utf8' });
  const help = execFileSync(process.execPath, [path.join(__dirname, 'module-boundaries.js'), '--help', '--repo', root], { encoding: 'utf8' });
  assert.match(help, /Uzycie: node module-boundaries\.js/);
  assert.equal(fs.readFileSync(process.env.PG_GATE_LOG, 'utf8').length, before, 'bez --from = zero wpisow');
  // blad narzedzia (zly --base) = exit 2 + skipped z --from
  let code2 = 0;
  try { execFileSync(process.execPath, [path.join(__dirname, 'module-boundaries.js'), '--repo', root, '--base', 'nie-ma-takiej-bazy', '--from', 'pre-push'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { code2 = e.status; }
  assert.equal(code2, 2);

  // zly typ pola w ARCHITECTURE.md: push nie moze sie zablokowac (exit 0), problem wypisany
  write(root, 'docs/ARCHITECTURE.md', '# A\n\n```json\n{ "pg.boundaries": true, "adapters": "src/integrations", "owners": ["x"] }\n```\n');
  sh(root, ['add', '-A']); sh(root, ['commit', '-q', '-m', 'bad config']);
  const out2 = execFileSync(process.execPath, [path.join(__dirname, 'module-boundaries.js'), '--repo', root, '--base', 'origin/main', '--from', 'pre-push'], { encoding: 'utf8' });
  assert.match(out2, /adapters ma byc lista napisow/);
  assert.match(fs.readFileSync(process.env.PG_GATE_LOG, 'utf8'), /"event":"skipped","reason":"SEKRET config\/analiza".*adapters ma byc lista napisow/);
  assert.match(out2, /SEKRET \(ostrzezenie\) src\/features\/board\/notes\.ts:1 — SDK stripe/);
  assert.ok(mb.report(root).problems.some((p) => /adapters/.test(p)), '--report pokazuje problemy configu zamiast cichego fallbacku');
  // plik test_*.js nie jest analizowany (fikstury w stringach nie daja ostrzezen)
  write(root, 'bin/test_x.js', "const s = \"import Stripe from 'stripe'\";\nrequire('stripe');\n");
  sh(root, ['add', '-A']); sh(root, ['commit', '-q', '-m', 'test file']);
  assert.ok(!mb.analyze(root, { base: 'origin/main', staged: false }).leaks.some((l) => l.file === 'bin/test_x.js'));
  fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(hooksOff, { recursive: true, force: true });
});

it('analyze bez owners: modul, ktory dopiero poznaje tabele znana w > 2 modulach = ostrzezenie; modul, ktory ja znal = cisza', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mb4-'));
  const hooksOff = fs.mkdtempSync(path.join(os.tmpdir(), 'mb4-hooks-'));
  sh(root, ['init', '-q', '-b', 'main']);
  sh(root, ['config', 'user.email', 't@t']); sh(root, ['config', 'user.name', 't']); sh(root, ['config', 'core.hooksPath', hooksOff]); sh(root, ['config', 'commit.gpgsign', 'false']);
  for (const m of ['jobs', 'board', 'billing']) write(root, `src/features/${m}/api.ts`, "export const q = () => supabase.from('jobs').select();\n");
  write(root, 'docs/ARCHITECTURE.md', '# A\n\n```json\n{ "pg.boundaries": true }\n```\n');
  sh(root, ['add', '-A']); sh(root, ['commit', '-q', '-m', 'base']);
  sh(root, ['branch', 'origin/main']);
  write(root, 'src/features/board/api.ts', "export const q = () => supabase.from('jobs').select();\nexport const r = () => supabase.from('jobs').select('id');\n");
  write(root, 'src/features/reports/api.ts', "export const q = () => supabase.from('jobs').select();\n");
  sh(root, ['add', '-A']); sh(root, ['commit', '-q', '-m', 'fourth module']);
  const r = mb.analyze(root, { base: 'origin/main', staged: false });
  assert.deepEqual(r.leaks.map((l) => `${l.file}:${l.line}`), ['src/features/reports/api.ts:1'], 'board znal jobs w bazie = dlug, nie nowy wyciek');
  assert.match(r.leaks[0].why, /znana w 4 modulach/);
  fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(hooksOff, { recursive: true, force: true });
});

it('domainSplit: modul nazwany typem technicznym (hooks/services/lib) i znajacy tabele = podzial wg warstw', () => {
  const usage = mb.tableUsage(['src/hooks/useJobs.ts', 'src/services/invoice.ts', 'src/features/jobs/api.ts', 'src/integrations/supabase/client.ts'], (f) => ({
    'src/hooks/useJobs.ts': "supabase.from('jobs'); supabase.from('customers');",
    'src/services/invoice.ts': "supabase.from('invoices');",
    'src/features/jobs/api.ts': "supabase.from('jobs');",
    'src/integrations/supabase/client.ts': '',
  })[f]);
  const d = mb.domainSplit(usage);
  assert.deepEqual(d.technical, [{ module: 'src/hooks', tables: ['customers', 'jobs'] }, { module: 'src/services', tables: ['invoices'] }]);
  assert.equal(d.domainModules, 1); assert.equal(d.technicalModules, 2); assert.equal(d.entryModules, 0);
  assert.ok(mb.domainSplit(mb.tableUsage(['app/page.tsx', 'supabase/functions/send-sms/index.ts'], () => "x.from('jobs')")).technical.some((t) => t.module === 'app'), 'Next.js app/ na najwyzszym poziomie = warstwa');
});

it('sliceInternal: import wnetrza cudzego slice\'a = content coupling; index.ts, wlasny slice i inne katalogi = OK', () => {
  assert.deepEqual(mb.sliceInternal('src/features/board/x.ts', '@/features/jobs/api'), { slice: 'src/features/jobs', rest: 'api' });
  assert.deepEqual(mb.sliceInternal('src/routes/r.tsx', '../features/jobs/lib/calc'), { slice: 'src/features/jobs', rest: 'lib/calc' });
  assert.equal(mb.sliceInternal('src/features/board/x.ts', '@/features/jobs'), null);
  assert.equal(mb.sliceInternal('src/features/board/x.ts', '@/features/jobs/index'), null);
  assert.equal(mb.sliceInternal('src/features/jobs/ui/a.tsx', '../api'), null, 'wewnatrz wlasnego slice\'a');
  assert.equal(mb.sliceInternal('src/features/board/x.ts', '@/lib/money'), null);
  assert.equal(mb.sliceInternal('src/features/board/x.ts', 'react'), null);
  const imp = [{ file: 'src/features/board/x.ts', line: 3, spec: '@/features/jobs/internal/state' }];
  assert.deepEqual(mb.secretLeaks([], imp, new Map(), {}, null, new Set(['src/features/jobs'])).map((l) => l.kind), ['internal'], 'slice z kontraktem');
  assert.deepEqual(mb.secretLeaks([], imp, new Map(), {}), [], 'slice bez index.ts = nie ma czego obchodzic, cisza w diffie');
  const sc = mb.sliceContracts(['src/features/jobs/index.ts', 'src/features/jobs/api.ts', 'src/features/board/x.ts', 'src/lib/a.ts']);
  assert.deepEqual([...sc.slices].sort(), ['src/features/board', 'src/features/jobs']); assert.deepEqual([...sc.contracts], ['src/features/jobs']);
});

it('pre-push: rc 1 z module-boundaries = blok; rc 2 (blad narzedzia) = ostrzezenie, push przechodzi; rc 0 = OK', () => {
  // stub narzedzia w podstawionym HOME: test mapowania kodow w hooku, niezalezny od analizy
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mb-home-'));
  fs.mkdirSync(path.join(home, '.claude', 'bin'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'bin', 'module-boundaries.js'), 'process.exit(Number(process.env.MB_STUB_RC || 0));\n');
  fs.mkdirSync(path.join(home, '.claude', 'hooks', 'lib'), { recursive: true });
  fs.copyFileSync(path.join(__dirname, '..', 'hooks', 'lib', 'gate-log.js'), path.join(home, '.claude', 'hooks', 'lib', 'gate-log.js'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mb-pp-'));
  sh(root, ['init', '-q', '-b', 'feat']);
  sh(root, ['config', 'user.email', 't@t']); sh(root, ['config', 'user.name', 't']); sh(root, ['config', 'commit.gpgsign', 'false']);
  write(root, 'a.txt', 'a\n');
  sh(root, ['config', 'core.hooksPath', path.join(home, 'no-hooks')]); // jak w fiksturach wyzej: commit fikstury bez globalnych hookow
  sh(root, ['add', '-A']); sh(root, ['commit', '-q', '-m', 'base']);
  sh(root, ['branch', 'origin/main']);
  const hook = path.join(__dirname, '..', 'git-hooks', 'pre-push');
  const run = (rc) => {
    try {
      const out = execFileSync('sh', [hook, 'origin', 'x'], { cwd: root, input: '', encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, HOME: home, MB_STUB_RC: String(rc) } });
      return { code: 0, out };
    } catch (e) { return { code: e.status, out: String(e.stderr) }; }
  };
  assert.equal(run(0).code, 0);
  const blocked = run(1); assert.equal(blocked.code, 1); assert.match(blocked.out, /nowy cykl importow albo naruszenie warstw/);
  for (const rc of [2, 137]) { const r = run(rc); assert.equal(r.code, 0, `rc ${rc} nie blokuje`); }
  // slad pisze hook — takze gdy proces zginal (137 = SIGKILL), zanim cokolwiek zalogowal
  const log = fs.readFileSync(process.env.PG_GATE_LOG, 'utf8');
  assert.match(log, /"hook":"pre-push","event":"skipped","reason":"module-boundaries: blad narzedzia \(exit 2\)"/);
  assert.match(log, /"reason":"module-boundaries: blad narzedzia \(exit 137\)"/);
  fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(home, { recursive: true, force: true });
});

console.log(`TESTY: ${n} OK`);

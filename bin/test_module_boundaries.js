#!/usr/bin/env node
// Testy module-boundaries.js: czyste funkcje (parser, Tarjan, warstwy) + pelny przebieg na fikstorze git (nowy vs stary cykl).
// Uruchom: node ~/.claude/bin/test_module_boundaries.js
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
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

  // CLI: exit 1 na nowym cyklu, 0 gdy ALLOW nie jest sprawa narzedzia (to robi pre-push)
  let code = 0;
  try { execFileSync(process.execPath, [path.join(__dirname, 'module-boundaries.js'), '--repo', root, '--base', 'origin/main'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { code = e.status; }
  assert.equal(code, 1);
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

console.log(`TESTY: ${n} OK`);

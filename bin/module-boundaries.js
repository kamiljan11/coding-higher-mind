#!/usr/bin/env node
// module-boundaries: cykle importow, kierunek warstw i fan-in — 0 tokenow, zero zaleznosci.
//
// Pytanie uzytkownika (2026-09-12): „jedna funkcja — swietnie; system na 200 tys. linii z zaleznosciami miedzy plikami
// i niepisanymi zalozeniami architektonicznymi — spojnosc sie rozjezdza". PG mial regule „cykliczne importy = 1 ->
// granice zle ustawione (`madge --circular`)" w paradigm.md, ale zadna bramka jej nie sprawdzala (regula na papierze,
// ta sama klasa co B006). Ten skrypt zamienia ja w bramke i daje miejsce na ZAPISANIE zalozen: blok ```json
// w docs/ARCHITECTURE.md (`"pg.boundaries": true`) z warstwami — dokument dla czlowieka i regula dla maszyny to TEN SAM plik.
//
// Sprawdza (TS/JS: import/export-from/require/dynamic import; relatywne i alias `@/` z tsconfig `paths`):
//  1. NOWY cykl: silnie spojna skladowa (Tarjan) zawierajaca zmieniony plik, ktora NIE byla cyklem w bazie -> blok.
//     Stary cykl (istnial w bazie) = ostrzezenie (zasada 2026-08-09: dlugu historycznego nie sprzatamy z automatu).
//  2. Import wbrew warstwom w DODANYCH liniach: `layers` = kolejnosc od gory (routes) do dolu (lib); plik z warstwy i
//     moze importowac tylko warstwe j >= i (w dol). `forbid` = jawne pary {from,to}. Bez bloku w ARCHITECTURE.md = tylko cykle.
//  3. Fan-in: zmieniony plik importowany przez > maxFanIn plikow = ostrzezenie (zmiana w nim ma duzy blast radius).
//
// Uzycie: node module-boundaries.js [--repo .] [--base origin/main] [--staged] [--json]
// Wyjscie: exit 1 = nowy cykl albo naruszenie warstw; 0 = OK (ostrzezenia na stdout). Wyjatek w pre-push: ALLOW_BOUNDARIES=1.
// Python/Deno nie sa analizowane (jawnie: 0 wynikow != „czysto").

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const SRC_EXT = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
const SRC_RX = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const IGNORE_RX = /(^|\/)(node_modules|dist|build|\.next|coverage|\.output|\.vercel|\.git)(\/|$)|\.d\.ts$|\.(test|spec)\.[cm]?[jt]sx?$|__tests__\//;
const IMPORT_RX = /(?:^|[^\w$])(?:import|export)\s*(?:[\w*{}\s,$]*?\s*from\s*)?["']([^"'\n]+)["']|(?:^|[^\w$])(?:require|import)\s*\(\s*["']([^"'\n]+)["']\s*\)/g;
const DEFAULT_MAX_FAN_IN = 40;

function parseArgs(argv) {
  const out = { repo: '.', base: 'origin/main', staged: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--repo') out.repo = argv[++i];
    else if (a === '--base') out.base = argv[++i];
    else if (a === '--staged') out.staged = true;
    else if (a === '--json') out.json = true;
  }
  return out;
}

/** Specyfikatory importow z tekstu pliku wraz z numerem linii. Czysta funkcja. */
function parseImports(text) {
  const out = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
    for (const m of line.matchAll(IMPORT_RX)) out.push({ spec: m[1] || m[2], line: i + 1 });
  }
  return out;
}

/** Alias `@/x` -> `src/x` (albo wg tsconfig `compilerOptions.paths`). Zwraca sciezke wzgledem repo albo null (pakiet). */
function resolveSpecifier(spec, fromFile, files, aliases) {
  let target = null;
  if (spec.startsWith('./') || spec.startsWith('../')) target = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), spec));
  else {
    for (const [prefix, dir] of aliases) {
      if (spec === prefix.replace(/\/$/, '') || spec.startsWith(prefix)) { target = path.posix.normalize(dir + spec.slice(prefix.length)); break; }
    }
  }
  if (!target) return null;
  target = target.replace(/\?.*$/, '');
  const candidates = [target, ...SRC_EXT.map((e) => target + e), ...SRC_EXT.map((e) => target + '/index' + e), target.replace(/\.js$/, '.ts'), target.replace(/\.js$/, '.tsx')];
  for (const c of candidates) if (files.has(c)) return c;
  return null;
}

/** Graf importow: plik -> Set(plikow), plus lista krawedzi z numerem linii. Czysta funkcja (readFn = plik -> tekst|null). */
function buildGraph(files, readFn, aliases) {
  const graph = new Map();
  const edges = [];
  for (const f of files) {
    const text = readFn(f);
    graph.set(f, new Set());
    if (text == null) continue;
    for (const { spec, line } of parseImports(text)) {
      const to = resolveSpecifier(spec, f, files, aliases);
      if (!to || to === f) continue;
      graph.get(f).add(to);
      edges.push({ from: f, to, line, spec });
    }
  }
  return { graph, edges };
}

/** Silnie spojne skladowe o rozmiarze > 1 (Tarjan, iteracyjnie — bez limitu stosu na duzych repo). Czysta funkcja. */
function findCycles(graph) {
  let index = 0;
  const idx = new Map(); const low = new Map(); const onStack = new Set(); const stack = [];
  const cycles = [];
  for (const root of graph.keys()) {
    if (idx.has(root)) continue;
    const work = [[root, 0]];
    idx.set(root, index); low.set(root, index); index++; stack.push(root); onStack.add(root);
    while (work.length) {
      const [v, i] = work[work.length - 1];
      const succ = [...(graph.get(v) || [])];
      if (i < succ.length) {
        work[work.length - 1][1] = i + 1;
        const w = succ[i];
        if (!graph.has(w)) continue;
        if (!idx.has(w)) { idx.set(w, index); low.set(w, index); index++; stack.push(w); onStack.add(w); work.push([w, 0]); }
        else if (onStack.has(w)) low.set(v, Math.min(low.get(v), idx.get(w)));
      } else {
        work.pop();
        if (work.length) { const u = work[work.length - 1][0]; low.set(u, Math.min(low.get(u), low.get(v))); }
        if (low.get(v) === idx.get(v)) {
          const comp = [];
          let w;
          do { w = stack.pop(); onStack.delete(w); comp.push(w); } while (w !== v);
          if (comp.length > 1) cycles.push(comp.sort());
        }
      }
    }
  }
  return cycles;
}

/** Czy zbior plikow tworzy cykl w danym grafie (kazdy osiaga kazdego w podgrafie). Czysta funkcja. */
function isCycleIn(graph, members) {
  const set = new Set(members);
  const sub = new Map(members.map((m) => [m, new Set([...(graph.get(m) || [])].filter((x) => set.has(x)))]));
  return findCycles(sub).some((c) => c.length === members.length);
}

function layerOf(file, layers) {
  for (let i = 0; i < layers.length; i++) {
    const l = layers[i].replace(/\/$/, '');
    if (file === l || file.startsWith(l + '/')) return i;
  }
  return -1;
}

/** Naruszenia kierunku warstw i par `forbid` dla podanych krawedzi. Czysta funkcja. */
function layerViolations(edges, rules) {
  const out = [];
  const layers = rules.layers || [];
  const forbid = rules.forbid || [];
  for (const e of edges) {
    const a = layerOf(e.from, layers); const b = layerOf(e.to, layers);
    if (a >= 0 && b >= 0 && b < a) out.push({ ...e, rule: `warstwa ${layers[a]} nie importuje z ${layers[b]} (import tylko w dol)` });
    for (const f of forbid) {
      if (layerOf(e.from, [f.from]) === 0 && layerOf(e.to, [f.to]) === 0) out.push({ ...e, rule: `forbid ${f.from} -> ${f.to}${f.why ? ' (' + f.why + ')' : ''}` });
    }
  }
  return out;
}

/** Blok ```json z `"pg.boundaries": true` w docs/ARCHITECTURE.md. Brak pliku/bloku = {} (tylko cykle). */
function readRules(repo) {
  const p = path.join(repo, 'docs', 'ARCHITECTURE.md');
  if (!fs.existsSync(p)) return {};
  const text = fs.readFileSync(p, 'utf8');
  for (const m of text.matchAll(/```json\s*\n([\s\S]*?)\n```/g)) {
    try { const obj = JSON.parse(m[1]); if (obj['pg.boundaries']) return obj; } catch (err) { throw new Error(`docs/ARCHITECTURE.md: blok json niepoprawny: ${err.message}`); }
  }
  return {};
}

function readAliases(repo) {
  const aliases = [['@/', 'src/']];
  for (const name of ['tsconfig.json', 'tsconfig.app.json', 'jsconfig.json']) {
    const p = path.join(repo, name);
    if (!fs.existsSync(p)) continue;
    try {
      const raw = fs.readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, '').replace(/,\s*([}\]])/g, '$1');
      const cfg = JSON.parse(raw);
      const paths = (cfg.compilerOptions && cfg.compilerOptions.paths) || {};
      const baseUrl = (cfg.compilerOptions && cfg.compilerOptions.baseUrl) || '.';
      for (const [k, v] of Object.entries(paths)) {
        if (!k.endsWith('/*') || !Array.isArray(v) || !v[0]) continue;
        const dir = path.posix.normalize(path.posix.join(baseUrl, String(v[0]).replace(/\/?\*$/, ''))).replace(/^\.\//, '') + '/';
        aliases.unshift([k.slice(0, -1), dir]);
      }
    } catch (err) { process.stderr.write(`module-boundaries: ${name} nieczytelny (${err.message.split('\n')[0]}) — alias @/ = src/\n`); }
  }
  return aliases;
}

function git(repo, args, opts = {}) {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', opts.quiet ? 'ignore' : 'pipe'] });
}

function listFiles(repo) {
  return new Set(git(repo, ['ls-files', '--cached', '--others', '--exclude-standard']).split('\n').map((s) => s.trim()).filter((f) => f && SRC_RX.test(f) && !IGNORE_RX.test(f)));
}

/** Zmienione pliki + dodane linie (numer -> tekst) per plik. */
function changedFiles(repo, opts) {
  const args = opts.staged ? ['diff', '--cached', '-U0', '--no-color', '--diff-filter=AM'] : ['diff', '-U0', '--no-color', '--diff-filter=AM', `${opts.base}...HEAD`];
  let diff = git(repo, args);
  if (!opts.staged) diff += '\n' + git(repo, ['diff', '-U0', '--no-color', '--diff-filter=AM']);
  const added = new Map();
  let file = null; let lineNo = 0;
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('+++ ')) { file = raw.slice(4).replace(/^b\//, ''); if (file === '/dev/null') file = null; if (file && !added.has(file)) added.set(file, new Set()); continue; }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (hunk) { lineNo = Number(hunk[1]); continue; }
    if (!file || raw.startsWith('---') || raw.startsWith('+++')) continue;
    if (raw.startsWith('+')) { added.get(file).add(lineNo); lineNo++; } else if (!raw.startsWith('-') && !raw.startsWith('\\')) lineNo++;
  }
  return added;
}

function baseRead(repo, base, staged) {
  const ref = staged ? 'HEAD' : base;
  return (f) => { try { return git(repo, ['show', `${ref}:${f}`], { quiet: true }); } catch (e) { return null; } };
}

function analyze(repo, opts) {
  const files = listFiles(repo);
  const aliases = readAliases(repo);
  const rules = readRules(repo);
  const readNow = (f) => { try { return fs.readFileSync(path.join(repo, f), 'utf8'); } catch (e) { return null; } };
  const { graph, edges } = buildGraph(files, readNow, aliases);
  const changed = changedFiles(repo, opts);
  const changedSet = new Set([...changed.keys()].filter((f) => files.has(f)));

  const cycles = findCycles(graph);
  const readBase = baseRead(repo, opts.base, opts.staged);
  const newCycles = []; const oldCycles = [];
  for (const comp of cycles) {
    if (!comp.some((f) => changedSet.has(f))) { oldCycles.push(comp); continue; }
    const baseGraph = buildGraph(new Set(comp), readBase, aliases).graph;
    (isCycleIn(baseGraph, comp) ? oldCycles : newCycles).push(comp);
  }

  const addedEdges = edges.filter((e) => changed.has(e.from) && changed.get(e.from).has(e.line));
  const violations = layerViolations(addedEdges, rules);

  const fanIn = new Map();
  for (const e of edges) fanIn.set(e.to, (fanIn.get(e.to) || 0) + 1);
  const maxFanIn = rules.maxFanIn || DEFAULT_MAX_FAN_IN;
  const hotspots = [...changedSet].map((f) => ({ file: f, fanIn: fanIn.get(f) || 0 })).filter((x) => x.fanIn > maxFanIn).sort((a, b) => b.fanIn - a.fanIn);

  return { files: files.size, changed: changedSet.size, rules: Object.keys(rules).length ? rules : null, newCycles, oldCycles, violations, hotspots, maxFanIn };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const repo = path.resolve(opts.repo);
  const r = analyze(repo, opts);
  const blocking = r.newCycles.length + r.violations.length;
  if (opts.json) { process.stdout.write(JSON.stringify(r, null, 1) + '\n'); return blocking ? 1 : 0; }
  console.log(`module-boundaries: ${r.files} plikow TS/JS, ${r.changed} zmienionych, reguly warstw: ${r.rules ? 'docs/ARCHITECTURE.md' : 'brak (tylko cykle)'}`);
  for (const c of r.newCycles) console.log(`  NOWY CYKL (${c.length} plikow): ${c.join(' -> ')} -> ${c[0]}`);
  for (const v of r.violations) console.log(`  WARSTWY: ${v.from}:${v.line} importuje ${v.to} — ${v.rule}`);
  for (const c of r.oldCycles.slice(0, 5)) console.log(`  (stary cykl, nie blokuje) ${c.slice(0, 4).join(' -> ')}${c.length > 4 ? ' -> ...' : ''}`);
  if (r.oldCycles.length > 5) console.log(`  (... +${r.oldCycles.length - 5} starych cykli)`);
  for (const h of r.hotspots) console.log(`  FAN-IN ${h.fanIn} > ${r.maxFanIn}: ${h.file} — zmiana tutaj dotyka ${h.fanIn} plikow; sprawdz blast radius (design.md B3)`);
  if (!blocking) console.log('module-boundaries: OK — zero nowych cykli i naruszen warstw');
  else console.log('Napraw: wydziel wspolny modul (cykl) albo przenies kod do wlasciwej warstwy. Swiadomy wyjatek: ALLOW_BOUNDARIES=1 (zapisz powod w ADR).');
  return blocking ? 1 : 0;
}

if (require.main === module) {
  try { process.exit(main()); } catch (err) { console.error('module-boundaries: ' + err.message); process.exit(2); }
}

module.exports = { parseImports, resolveSpecifier, buildGraph, findCycles, isCycleIn, layerOf, layerViolations, analyze };

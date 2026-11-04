#!/usr/bin/env node
// module-boundaries: granice modulow — cykle importow, kierunek warstw, fan-in, wycieki sekretu (tabela/SDK/wnetrze slice'a), --report.
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
//  4. Wyciek sekretu modulu (Parnas; connascence wysokiego stopnia) w DODANYCH liniach = ostrzezenie (observe, 2026-10-18):
//     `.from('tabela')` poza wlascicielem z `owners` (bez owners: tabela znana w > maxTableModules modulach) albo import SDK
//     dostawcy poza `adapters`, albo import wnetrza cudzego slice'a z pominieciem index.ts (content coupling). Karta: skills/architecture-advisor/references/sd/01-fundamenty.md › Dekompozycja wewnatrz monolitu.
//     `shared` = tabele przekrojowe (tenant, profil: konwencja + RLS, nie modul) — poza liczeniem wyciekow. Edge fn (osobny deploy,
//     nie zaimportuje index.ts slice'a) dostaje wlasna wskazowke: RPC/widok wlasciciela albo wpis w `shared`/`owners`.
// --report: audyt calego repo (nie bramka) — tabele -> moduly (z naruszeniami `owners`), moduly techniczne znajace tabele
//     (podzial wg warstw zamiast pojec biznesowych), SDK poza adapterem, change amplification ostatnich 30 commitow.
// Ostrzezenia SEKRET i pominiecia analizy ida do ~/.claude/logs/gates.jsonl (would_block / skipped) — metryka trybu observe.
//
// Uzycie: node module-boundaries.js [--repo .] [--base origin/main] [--staged] [--json] [--report] [--from pre-push] [--help]
// --from <zrodlo>: telemetria do gates.jsonl (ran / would_block / skipped) TYLKO z tym znacznikiem — reczne uruchomienia nie zasmiecaja metryki.
// Exit 2 = blad narzedzia (nie werdykt): pre-push ostrzega i sam loguje `skipped` (kazde rc != 0/1), nie blokuje.
// Exit 1 z bledu ladowania skryptu (SyntaxError, brak pliku) nadal blokuje — fail-closed, swiadomie.
// Wyjscie: exit 1 = nowy cykl albo naruszenie warstw; 0 = OK (ostrzezenia na stdout). Wyjatek w pre-push: ALLOW_BOUNDARIES=1.
// Python/Deno nie sa analizowane (jawnie: 0 wynikow != „czysto").

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
// Telemetria opcjonalna: brak/zepsuty gate-log.js (np. rozjazd po pg-sync) nie moze zmienic exit code (pre-push blokuje na != 0).
let gateLog = () => {};
try { gateLog = require(path.join(__dirname, '..', 'hooks', 'lib', 'gate-log.js')).log; } catch (err) { /* bez telemetrii */ }

const SRC_EXT = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
const SRC_RX = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const IGNORE_RX = /(^|\/)(node_modules|dist|build|\.next|coverage|\.output|\.vercel|\.git)(\/|$)|\.d\.ts$|\.(test|spec)\.[cm]?[jt]sx?$|__tests__\/|(^|\/)test_[^/]*\.[cm]?[jt]sx?$/;
const IMPORT_RX = /(?:^|[^\w$])(?:import|export)\s*(?:[\w*{}\s,$]*?\s*from\s*)?["']([^"'\n]+)["']|(?:^|[^\w$])(?:require|import)\s*\(\s*["']([^"'\n]+)["']\s*\)/g;
const DEFAULT_MAX_FAN_IN = 40;
// Sekret modulu (Parnas) wycieka, gdy obcy modul zna schemat tabeli albo SDK dostawcy (connascence wysokiego stopnia).
// `storage.from('bucket')` (tez `myStorage`), `Array/Buffer/Observable/Promise.from('x')` to nie tabele. `\s*` obejmuje nowa
// linie: Prettier lamie `.from(\n  'users')`.
const TABLE_RX = /(?<![Ss]torage|Array|Buffer|Observable|Promise)\.from\(\s*['"`]([A-Za-z_]\w*)['"`]/g;
// Tylko pakiety, ktorych nazwy sa pewne; repo rozszerza liste polem `vendors` w bloku json ARCHITECTURE.md.
const DEFAULT_VENDORS = ['stripe', '@stripe/stripe-js', 'twilio', 'resend', 'openai', '@anthropic-ai/sdk', '@sendgrid/mail', 'nodemailer'];
const DEFAULT_ADAPTERS = ['src/integrations', 'supabase/functions'];
// Tabela znana w wiecej niz tylu modulach (gdy repo nie podalo `owners`) = ostrzezenie. 2 = wlasciciel + jeden czytelnik
// (np. raport); trzeci modul to juz wspolny schemat. Prog obserwacyjny (ostrzezenie, nie blok) — kalibracja po danych z gates.jsonl.
const DEFAULT_MAX_TABLE_MODULES = 2;
const AMPLIFICATION_COMMITS = 30;
// > 3 moduly na commit: slice (UI + api + typy) zwykle miesci sie w 1-2, plus migracja i trasa = 3.
const AMPLIFICATION_MAX_MODULES = 3;
// Modul nazwany TYPEM TECHNICZNYM (warstwa), nie pojeciem biznesowym. Taki modul znajacy tabele = wiedza domenowa
// rozsypana po warstwach (uzytkownik 2026-10-18: „myslmy domena biznesowa"): `src/hooks/useJobs.ts` zamiast `src/features/jobs`.
// `src/x` (Vite/Lovable) i `x` na najwyzszym poziomie (Next.js: app/, lib/, components/).
const TECH_MODULE_RX = /^(src\/)?(hooks|services|service|lib|utils|helpers|api|repositories|repository|controllers|store|stores|queries|data|models|components|pages|views|screens|actions|routes|app)$/;
// Moduly-pojecia: slice'y. Edge functions nazwane akcja (send-sms) to punkty wejscia (warstwa aplikacji), liczone osobno.
const DOMAIN_MODULE_RX = /^src\/(features|modules|server)\//;
const ENTRY_MODULE_RX = /^supabase\/functions\//;

function parseArgs(argv) {
  const out = { repo: '.', base: 'origin/main', staged: false, json: false, report: false, from: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--repo') out.repo = argv[++i];
    else if (a === '--base') out.base = argv[++i];
    else if (a === '--staged') out.staged = true;
    else if (a === '--json') out.json = true;
    else if (a === '--report') out.report = true;
    else if (a === '--from') out.from = argv[++i];
    else if (a === '--help' || a === '-h') out.help = true;
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

/**
 * Modul, do ktorego nalezy plik: `src/features/<x>`, `supabase/functions/<fn>`, inaczej `src/<katalog>` albo katalog najwyzszego
 * poziomu. Ta sama definicja dla wyciekow sekretu i dla change amplification. Czysta funkcja.
 */
function moduleOf(file) {
  const p = file.split('/');
  // `src/server/<pojecie>` (Next.js server-only, np. Radar: server/radar, server/tasks) = slice jak features
  if (p[0] === 'src' && (p[1] === 'features' || p[1] === 'modules' || p[1] === 'server') && p.length > 3) return p.slice(0, 3).join('/');
  if (p[0] === 'supabase' && p[1] === 'functions' && p.length > 3) return p.slice(0, 3).join('/');
  if (p[0] === 'src' && p.length > 2) return p.slice(0, 2).join('/');
  return p.length > 1 ? p[0] : '.';
}

/** Odwolania do tabel (`.from('t')`, takze lamane na linie) z numerem linii `.from`; linie-komentarze pominiete. Czysta funkcja. */
function parseTableRefs(text) {
  const out = [];
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') lineStarts.push(i + 1);
  let li = 0;
  for (const m of text.matchAll(TABLE_RX)) {
    while (li + 1 < lineStarts.length && lineStarts[li + 1] <= m.index) li++;
    const before = text.slice(lineStarts[li], m.index);
    // komentarz: linia `//`, wnetrze bloku `* ...`, `/* ...` bez zamkniecia przed trafieniem, ogon `kod // .from('x')`
    // (`//` po bialym znaku albo na poczatku — `https://` w stringu nie jest komentarzem)
    if (/^\s*(\/\/|\*(?!\/))/.test(before) || (/^\s*\/\*/.test(before) && !before.includes('*/')) || /(^|\s)\/\//.test(before)) continue;
    out.push({ table: m[1], line: li + 1 });
  }
  return out;
}

/** tabela -> Map(modul -> liczba plikow). Czysta funkcja (readFn = plik -> tekst|null). */
function tableUsage(files, readFn) {
  const usage = new Map();
  for (const f of files) {
    const text = readFn(f);
    if (text == null) continue;
    const mod = moduleOf(f);
    for (const table of new Set(parseTableRefs(text).map((r) => r.table))) {
      if (!usage.has(table)) usage.set(table, new Map());
      usage.get(table).set(mod, (usage.get(table).get(mod) || 0) + 1);
    }
  }
  return usage;
}

/**
 * Pola `owners`/`vendors`/`adapters`/`maxTableModules` z niezaufanego bloku json: zly typ = pominiety (z ostrzezeniem),
 * nigdy wyjatek — ostrzezenia o sekrecie nie moga zablokowac pushu (pre-push traktuje exit != 0 jak blok). Czysta funkcja.
 */
function leakRules(rules) {
  const problems = [];
  const strList = (v, name) => {
    if (v === undefined) return null;
    if (Array.isArray(v) && v.every((x) => typeof x === 'string')) return v;
    problems.push(`${name} ma byc lista napisow`); return null;
  };
  let owners = {};
  if (rules.owners !== undefined) {
    if (rules.owners && typeof rules.owners === 'object' && !Array.isArray(rules.owners)) owners = Object.fromEntries(Object.entries(rules.owners).filter(([, v]) => typeof v === 'string' && v.trim() !== ''));
    if (Object.keys(owners).length !== Object.keys(rules.owners || {}).length || Array.isArray(rules.owners)) problems.push('owners ma byc obiektem tabela -> "sciezka modulu"');
  }
  let maxTableModules = DEFAULT_MAX_TABLE_MODULES;
  if (rules.maxTableModules !== undefined) {
    if (Number.isInteger(rules.maxTableModules) && rules.maxTableModules > 0) maxTableModules = rules.maxTableModules;
    else problems.push('maxTableModules ma byc liczba calkowita > 0');
  }
  const shared = new Set(strList(rules.shared, 'shared') || []);
  // shared wygrywa z owners (wycisza tabele) — konflikt = literowka/kopia, ktora po cichu zdejmuje ochrone wlasciciela
  const both = Object.keys(owners).filter((t) => shared.has(t));
  if (both.length) problems.push(`tabela w owners i shared naraz (shared wycisza owners): ${both.join(', ')}`);
  return {
    owners, maxTableModules, shared,
    vendors: [...DEFAULT_VENDORS, ...(strList(rules.vendors, 'vendors') || [])],
    adapters: strList(rules.adapters, 'adapters') || DEFAULT_ADAPTERS,
    problems,
  };
}

function underAny(file, prefixes) {
  return prefixes.some((p) => file === p.replace(/\/$/, '') || file.startsWith(p.replace(/\/$/, '') + '/'));
}

function isVendor(spec, vendors) {
  return vendors.some((v) => spec === v || spec.startsWith(v + '/'));
}

/**
 * Wycieki sekretu w DODANYCH liniach (ostrzezenia, nie blok — tryb observe):
 *  - tabela z `owners` uzyta poza wlascicielem;
 *  - bez `owners`: modul, ktory NIE znal tabeli w bazie (baseUsage), poznaje ja, a tabela jest znana w > maxTableModules
 *    modulach (stara wiedza modulu = dlug historyczny, nie nowy wyciek; baseUsage == null -> bez tego filtra, np. --report);
 *  - import SDK dostawcy poza adapterem.
 * refs = [{file, line, table}], imports = [{file, line, spec}], usage/baseUsage = tableUsage(...), contracts = sliceContracts(...).
 * Czysta funkcja, nie rzuca.
 */
function secretLeaks(refs, imports, usage, rules, baseUsage = null, contracts = new Set()) {
  const out = [];
  const { owners, maxTableModules: maxMods, vendors, adapters, shared } = leakRules(rules);
  for (const r of refs) {
    if (shared.has(r.table)) continue;
    // edge fn = osobny deploy (Deno): import index.ts slice'a jest niewykonalny, wiec inna wskazowka (gates.jsonl 2026-10-22..25: 7/7 sygnalow)
    const edge = r.file.startsWith('supabase/functions/');
    const owner = owners[r.table];
    if (owner) {
      if (!underAny(r.file, [owner])) out.push({ ...r, kind: 'table', why: edge ? `edge fn zna tabele ${r.table} (sekret ${owner}) — czytaj przez RPC/widok wlasciciela` : `tabela ${r.table} jest sekretem ${owner} — wolaj funkcje z jego index.ts` });
      continue;
    }
    const mods = usage.get(r.table);
    const knewBefore = baseUsage && baseUsage.get(r.table) && baseUsage.get(r.table).has(moduleOf(r.file));
    if (mods && mods.size > maxMods && !knewBefore) out.push({ ...r, kind: 'table', why: edge ? `edge fn zna tabele ${r.table} znana w ${mods.size} modulach (> ${maxMods}) — przekrojowa (tenant/profil) = wpisz do shared; domenowa = owners + RPC/widok wlasciciela` : `tabela ${r.table} znana w ${mods.size} modulach (> ${maxMods}) — wskaz wlasciciela w ARCHITECTURE.md (owners); przekrojowa (tenant/profil) = shared` });
  }
  for (const im of imports) {
    if (isVendor(im.spec, vendors) && !underAny(im.file, adapters)) out.push({ ...im, kind: 'vendor', why: `SDK ${im.spec} poza adapterem (${adapters.join(', ')})` });
    // tylko slice z kontraktem (index.ts): bez niego nie ma czego obchodzic — to sygnal w --report, nie ostrzezenie w diffie
    const target = sliceInternal(im.file, im.spec);
    if (target && contracts.has(target.slice)) out.push({ ...im, kind: 'internal', why: `import wnetrza ${target.slice} (${target.rest}) z pominieciem index.ts — content coupling: zmiana wnetrza psuje ten modul` });
  }
  return out;
}

/**
 * Content coupling (Myers: najsilniejsze sprzezenie): import pliku WEWNATRZ cudzego slice'a zamiast jego `index.ts`.
 * spec: `@/features/x/...`, `src/features/x/...` albo relatywny. Zwraca {slice, rest} albo null. Czysta funkcja.
 */
function sliceInternal(file, spec) {
  let p = null;
  if (spec.startsWith('@/')) p = 'src/' + spec.slice(2);
  else if (spec.startsWith('src/')) p = spec;
  else if (spec.startsWith('.')) p = path.posix.normalize(path.posix.join(path.posix.dirname(file), spec));
  if (!p) return null;
  const m = p.match(/^(src\/(?:features|modules)\/[^/]+)(?:\/(.+))?$/);
  if (!m || !m[2] || /^index(\.[cm]?[jt]sx?)?$/.test(m[2])) return null;
  if (moduleOf(file) === m[1]) return null;
  return { slice: m[1], rest: m[2] };
}

/** Slice'y (src/features|modules/<x>) i te z kontraktem (`index.*` w korzeniu slice'a). files = sciezki repo. Czysta funkcja. */
function sliceContracts(files) {
  const slices = new Set(); const contracts = new Set();
  for (const f of files) {
    const m = f.match(/^(src\/(?:features|modules)\/[^/]+)\/(.+)$/);
    if (!m) continue;
    slices.add(m[1]);
    if (/^index\.[cm]?[jt]sx?$/.test(m[2])) contracts.add(m[1]);
  }
  return { slices, contracts };
}

/** Histogram: ilu modulow dotyka kazdy commit. commits = [[plik, ...], ...]. Czysta funkcja. */
function amplification(commits) {
  const perCommit = commits.map((files) => new Set(files.map(moduleOf)).size).filter((n) => n > 0);
  const hist = {};
  for (const n of perCommit) hist[n] = (hist[n] || 0) + 1;
  const wide = perCommit.filter((n) => n > AMPLIFICATION_MAX_MODULES).length;
  return { commits: perCommit.length, histogram: hist, wide, maxModules: AMPLIFICATION_MAX_MODULES };
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
  const cache = new Map();
  const readNow = (f) => {
    if (!cache.has(f)) { let t = null; try { t = fs.readFileSync(path.join(repo, f), 'utf8'); } catch (e) { t = null; } cache.set(f, t); }
    return cache.get(f);
  };
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

  // Ostrzezenia o sekrecie (observe): blad w tej sekcji nigdy nie zmienia exit code — pre-push traktuje exit != 0 jak blok.
  let leaks = []; const leakProblems = [];
  try {
    const addedRefs = []; const addedImports = [];
    for (const f of changedSet) {
      const text = readNow(f);
      if (text == null) continue;
      const lines = changed.get(f);
      for (const r of parseTableRefs(text)) if (lines.has(r.line)) addedRefs.push({ file: f, ...r });
      for (const im of parseImports(text)) if (lines.has(im.line)) addedImports.push({ file: f, ...im });
    }
    const lr = leakRules(rules);
    leakProblems.push(...lr.problems);
    // Pelny skan repo tylko gdy diff dodaje odwolanie do tabeli bez wlasciciela (pre-push bez .from = zero dodatkowego kosztu).
    const needUsage = addedRefs.some((r) => !lr.owners[r.table]);
    const usage = needUsage ? tableUsage(files, readNow) : new Map();
    const baseUsage = needUsage ? tableUsage([...files].filter((f) => !changedSet.has(f)), readNow) : null;
    if (needUsage) {
      for (const [table, mods] of tableUsage(changedSet, readBase)) {
        if (!baseUsage.has(table)) baseUsage.set(table, new Map());
        for (const [m, c] of mods) baseUsage.get(table).set(m, (baseUsage.get(table).get(m) || 0) + c);
      }
    }
    leaks = secretLeaks(addedRefs, addedImports, usage, rules, baseUsage, sliceContracts(files).contracts);
  } catch (err) { leakProblems.push(`analiza sekretow pominieta: ${err.message}`); }

  return { files: files.size, changed: changedSet.size, rules: Object.keys(rules).length ? rules : null, newCycles, oldCycles, violations, hotspots, maxFanIn, leaks, leakProblems };
}

/** Pliki zmienione w ostatnich N commitach bez merge'y (tylko kod i SQL, bez testow). */
function recentCommits(repo, n) {
  let log;
  try { log = git(repo, ['log', `-${n}`, '--no-merges', '--name-only', '--format=%x00'], { quiet: true }); } catch (e) { return []; }
  return log.split('\0').map((chunk) => chunk.split('\n').map((s) => s.trim()).filter((f) => f && (SRC_RX.test(f) || f.endsWith('.sql')) && !IGNORE_RX.test(f))).filter((c) => c.length);
}

/** Raport zdrowia granic calego repo (audyt, nie bramka): tabele -> moduly, SDK poza adapterem, change amplification. */
function report(repo) {
  const files = listFiles(repo);
  const rules = readRules(repo);
  const readNow = (f) => { try { return fs.readFileSync(path.join(repo, f), 'utf8'); } catch (e) { return null; } };
  const usage = tableUsage(files, readNow);
  const { owners, maxTableModules, problems, shared } = leakRules(rules);
  const tables = [...usage].map(([table, mods]) => {
    if (shared.has(table)) return { table, modules: mods.size, files: [...mods.values()].reduce((a, b) => a + b, 0), owner: null, outsiders: [], flagged: false, shared: true, byModule: Object.fromEntries(mods) };
    const owner = owners[table] || null;
    const outsiders = owner ? [...mods.keys()].filter((m) => !underAny(m, [owner]) && !underAny(owner, [m])) : [];
    return { table, modules: mods.size, files: [...mods.values()].reduce((a, b) => a + b, 0), owner, outsiders, flagged: owner ? outsiders.length > 0 : mods.size > maxTableModules, byModule: Object.fromEntries(mods) };
  }).sort((a, b) => b.modules - a.modules || b.files - a.files);
  const imports = [];
  for (const f of files) { const t = readNow(f); if (t != null) for (const im of parseImports(t)) imports.push({ file: f, ...im }); }
  const sc = sliceContracts(files);
  // --report liczy importy wnetrza wszystkich slice'ow (stan repo), w diffie tylko slice'y z kontraktem
  const importLeaks = secretLeaks([], imports, usage, rules, null, sc.slices);
  const vendorLeaks = importLeaks.filter((l) => l.kind === 'vendor');
  const internalImports = importLeaks.filter((l) => l.kind === 'internal');
  return { files: files.size, tables, maxTableModules, problems, vendorLeaks, internalImports, slices: sc.slices.size, contracts: sc.contracts.size, domain: domainSplit(usage), amplification: amplification(recentCommits(repo, AMPLIFICATION_COMMITS)) };
}

/**
 * Podzial wg domeny vs wg typu technicznego: moduly znajace tabele, nazwane typem (hooks/services/lib...) vs reszta.
 * usage = tableUsage(...). Czysta funkcja. Wynik: {technical: [{module, tables[]}], domainModules, technicalModules, entryModules, otherModules}.
 */
function domainSplit(usage) {
  const byMod = new Map();
  for (const [table, mods] of usage) for (const m of mods.keys()) { if (!byMod.has(m)) byMod.set(m, new Set()); byMod.get(m).add(table); }
  const mods = [...byMod.keys()];
  const technical = [...byMod].filter(([m]) => TECH_MODULE_RX.test(m)).map(([module, t]) => ({ module, tables: [...t].sort() })).sort((a, b) => b.tables.length - a.tables.length);
  const domainModules = mods.filter((m) => DOMAIN_MODULE_RX.test(m)).length;
  const entryModules = mods.filter((m) => ENTRY_MODULE_RX.test(m)).length;
  return { technical, technicalModules: technical.length, domainModules, entryModules, otherModules: mods.length - technical.length - domainModules - entryModules };
}

function printReport(r) {
  console.log(`module-boundaries --report: ${r.files} plikow TS/JS`);
  console.log(`Tabele -> liczba modulow (connascence: schemat znany w wielu miejscach; prog ${r.maxTableModules} bez owners):`);
  for (const t of r.tables.slice(0, 15)) {
    const own = t.shared ? ' (shared: przekrojowa)' : t.owner ? ` (owner ${t.owner}${t.outsiders.length ? '; poza nim: ' + t.outsiders.slice(0, 5).join(', ') + (t.outsiders.length > 5 ? ' ...' : '') : ''})` : '';
    console.log(`  ${t.flagged ? '!' : ' '} ${t.table}: ${t.modules} modulow, ${t.files} plikow${own}`);
  }
  if (!r.tables.length) console.log('  (brak .from("tabela") — repo bez klienta Supabase albo inny wzorzec dostepu)');
  const d = r.domain;
  console.log(`Moduly znajace tabele: ${d.domainModules} domenowych (src/features|server/<pojecie>), ${d.technicalModules} technicznych (warstwa), ${d.entryModules} punktow wejscia (edge fn), ${d.otherModules} innych`);
  for (const t of d.technical.slice(0, 8)) console.log(`  ! ${t.module} zna ${t.tables.length} tabel (${t.tables.slice(0, 6).join(', ')}${t.tables.length > 6 ? ', ...' : ''}) — wiedza domenowa w folderze warstwy; docelowo src/features/<pojecie>`);
  for (const p of r.problems) console.log(`  (docs/ARCHITECTURE.md: ${p} — uzyto wartosci domyslnej)`);
  console.log(`SDK dostawcy poza adapterem: ${r.vendorLeaks.length}`);
  for (const v of r.vendorLeaks.slice(0, 10)) console.log(`  ${v.file}:${v.line} ${v.spec}`);
  console.log(`Importy wnetrza cudzego slice'a (brak kontraktu -> ryzyko content coupling): ${r.internalImports.length}; slice'y z index.ts: ${r.contracts}/${r.slices}`);
  for (const v of r.internalImports.slice(0, 10)) console.log(`  ${v.file}:${v.line} ${v.spec}`);
  const a = r.amplification;
  console.log(`Change amplification (ostatnie ${a.commits} commitow z kodem): moduly na commit ${JSON.stringify(a.histogram)}; > ${a.maxModules} modulow: ${a.wide}`);
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { const src = fs.readFileSync(__filename, 'utf8'); console.log(src.slice(0, src.indexOf("'use strict'")).trim()); return 0; }
  const repo = path.resolve(opts.repo);
  if (opts.report) {
    const rep = report(repo);
    if (opts.json) process.stdout.write(JSON.stringify(rep, null, 1) + '\n'); else printReport(rep);
    return 0;
  }
  const r = analyze(repo, opts);
  const blocking = r.newCycles.length + r.violations.length;
  if (opts.json) { process.stdout.write(JSON.stringify(r, null, 1) + '\n'); return blocking ? 1 : 0; }
  console.log(`module-boundaries: ${r.files} plikow TS/JS, ${r.changed} zmienionych, reguly warstw: ${r.rules ? 'docs/ARCHITECTURE.md' : 'brak (tylko cykle)'}`);
  for (const c of r.newCycles) console.log(`  NOWY CYKL (${c.length} plikow): ${c.join(' -> ')} -> ${c[0]}`);
  for (const v of r.violations) console.log(`  WARSTWY: ${v.from}:${v.line} importuje ${v.to} — ${v.rule}`);
  for (const c of r.oldCycles.slice(0, 5)) console.log(`  (stary cykl, nie blokuje) ${c.slice(0, 4).join(' -> ')}${c.length > 4 ? ' -> ...' : ''}`);
  if (r.oldCycles.length > 5) console.log(`  (... +${r.oldCycles.length - 5} starych cykli)`);
  for (const h of r.hotspots) console.log(`  FAN-IN ${h.fanIn} > ${r.maxFanIn}: ${h.file} — zmiana tutaj dotyka ${h.fanIn} plikow; sprawdz blast radius (design.md B3)`);
  for (const l of r.leaks.slice(0, 10)) console.log(`  SEKRET (ostrzezenie) ${l.file}:${l.line} — ${l.why}`);
  // observe: licznik ostrzezen i pominiec w gates.jsonl (guard_health) — bez tego nie da sie skalibrowac progu ani awansowac do bloku
  const tlog = (e) => { if (opts.from) gateLog({ hook: 'module-boundaries', target: repo, source: opts.from, ...e }); };
  // items przy blokadzie: bez nich nie da sie po fakcie ocenic, czy blokada byla sluszna (przeglad telemetrii 2026-11-02)
  const blockItems = [...r.newCycles.map((c) => `cykl: ${c.slice(0, 4).join(' -> ')}${c.length > 4 ? ' -> ...' : ''}`), ...r.violations.map((v) => `${v.from}:${v.line} -> ${v.to}`)].slice(0, 20);
  tlog(blocking ? { event: 'blocked', reason: `cykl/warstwy ${blocking}`, items: blockItems } : { event: 'ran', reason: 'ok' });
  for (const kind of new Set(r.leaks.map((l) => l.kind))) {
    const items = [...new Set(r.leaks.filter((l) => l.kind === kind).map((l) => `${l.file}:${l.table || l.spec}`))].sort().slice(0, 20);
    tlog({ event: 'would_block', reason: `SEKRET ${kind}`, count: items.length, items });
  }
  if (r.leakProblems.length) tlog({ event: 'skipped', reason: 'SEKRET config/analiza', items: r.leakProblems.map((p) => p.slice(0, 200)) });
  if (r.leaks.length > 10) console.log(`  (... +${r.leaks.length - 10} ostrzezen SEKRET; pelna lista: --json, stan repo: --report)`);
  for (const p of r.leakProblems) console.log(`  (docs/ARCHITECTURE.md: ${p})`);
  if (!blocking) console.log('module-boundaries: OK — zero nowych cykli i naruszen warstw');
  else console.log('Napraw: wydziel wspolny modul (cykl) albo przenies kod do wlasciwej warstwy. Swiadomy wyjatek: ALLOW_BOUNDARIES=1 (zapisz powod w ADR).');
  return blocking ? 1 : 0;
}

if (require.main === module) {
  try { process.exit(main()); } catch (err) {
    // `skipped` zapisuje pre-push (kazde rc != 0/1, takze smierc procesu), tu tylko diagnoza
    console.error('module-boundaries: blad narzedzia (nie werdykt): ' + err.message);
    process.exit(2);
  }
}

module.exports = { parseImports, resolveSpecifier, buildGraph, findCycles, isCycleIn, layerOf, layerViolations, moduleOf, parseTableRefs, tableUsage, leakRules, secretLeaks, sliceInternal, sliceContracts, domainSplit, amplification, analyze, report };

#!/usr/bin/env node
'use strict';
// test_sd_matrix_lint.js — testy sd-matrix-lint.js (+ bramka [obszary] w stop-gate). Zero zaleznosci; odpalaj: node test_sd_matrix_lint.js
// Fixture'y w %TEMP% (fs.rmSync na koncu); telemetria i znaczniki stop-gate poza produkcyjnym ~/.claude/logs.
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const LINT = path.join(__dirname, 'sd-matrix-lint.js');
const STOP_GATE = path.join(ROOT, 'hooks', 'stop-gate.js');
const L = require(LINT);
const { areas } = L.loadAreas(path.join(ROOT, 'pg', 'sd-areas.json'));
const FIX = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-sdmatrix-'));
process.env.PG_GATE_LOG = path.join(FIX, 'gates.jsonl');
process.env.PG_STOP_WM_DIR = path.join(FIX, 'wm');

let failures = 0;
function ok(desc, cond, detail) {
  if (cond) console.log(`PASS: ${desc}`);
  else { console.log(`FAIL: ${desc}${detail ? ' — ' + detail : ''}`); failures++; }
}
const write = (file, content) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); };
const HEAD = '| Obszar (id) | Status | Decyzja / uzasadnienie | Dowod | Sygnal powrotu |\n|---|---|---|---|---|\n';
const row = (a) => {
  if (a.one_way || a.group === 'odpornosc') return `| ${a.name} (${a.id}) | DECYZJA | Postgres/Supabase, domyslne karty | \`supabase/migrations/001_init.sql\` | — |`;
  if (a.group === 'dane-magazyny') return `| ${a.name} (${a.id}) | NIE TERAZ | skala 1-10 tys. uzytkownikow | — | > 1 mln wierszy w tabeli zlecen |`;
  return `| ${a.name} (${a.id}) | NIE DOTYCZY | brak takiej funkcji w produkcie | | |`;
};
const full = (list = areas) => HEAD + list.map(row).join('\n') + '\n';
const lint = (text, opts) => L.lintMatrix(L.parseMatrix(text), areas, opts);
const kinds = (res) => res.issues.map((i) => i.kind);

// ---------- sd-areas.json ----------
ok('sd-areas: 62 obszary (37 kursu + 25 stack), 13 grup, unikalne id', areas.length === 62 && new Set(areas.map((a) => a.group)).size === 13 && new Set(areas.map((a) => a.id)).size === 62);
// Grupa stack = kategorie artefaktu Stack Picker 1:1 (zrodlo: architecture-advisor/references/stack-data.json) — dryf = czerwone.
const STACK_DATA = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'skills', 'architecture-advisor', 'references', 'stack-data.json'), 'utf8'));
const stackCats = STACK_DATA.groups.flatMap((g) => g.cats);
const stackAreas = areas.filter((a) => a.group === 'stack');
ok('sd-areas: grupa stack = kategorie stack-data.json (id i warianty 1:1)', stackAreas.length === stackCats.length &&
  stackCats.every((c) => { const a = stackAreas.find((x) => x.id === 'stack-' + c.id); return a && a.name === c.name && JSON.stringify(a.variants) === JSON.stringify(c.options.map((o) => o.name)); }));
// Swiadomie one_way:false — twarde drzwi jednokierunkowe (baza, tozsamosc, pliki, region) pilnuja obszary SD; inaczej kazda
// mala zmiana z --groups wymagalaby 6 dodatkowych wierszy stack (code-review 2026-10-10).
ok('sd-areas: wiersze stack nie sa one_way (drzwi pilnuja obszary SD)', stackAreas.every((a) => a.one_way === false));
{
  // Ogniwo HTML -> stack-data.json: generator na zrodle artefaktu daje dokladnie zacommitowane pliki.
  const SKILL = path.join(__dirname, '..', 'skills', 'architecture-advisor');
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'stack-gen-'));
  const g = spawnSync(process.execPath, [path.join(SKILL, 'scripts', 'stack-catalog-from-artifact.js'), path.join(SKILL, 'assets', 'stack-picker.html'), tmp], { encoding: 'utf8' });
  const same = (f) => fs.readFileSync(path.join(tmp, f), 'utf8') === fs.readFileSync(path.join(SKILL, 'references', f), 'utf8');
  ok('stack: artefakt -> stack-data.json + stack-catalog.md bez dryfu (uruchom generator po edycji artefaktu)', g.status === 0 && same('stack-data.json') && same('stack-catalog.md'), g.stderr);
  fs.rmSync(tmp, { recursive: true, force: true });
}
ok('sd-areas: kazdy obszar ma karte i >= 3 warianty', areas.every((a) => a.card && Array.isArray(a.variants) && a.variants.length >= 3));
ok('sd-areas: drzwi jednokierunkowe obejmuja ID, pliki, tozsamosc, region, DR, model danych',
  ['id-generation', 'object-storage', 'auth', 'cloud-building-blocks', 'multi-region-dr', 'databases'].every((id) => areas.find((a) => a.id === id).one_way));

{
  const SD = path.join(ROOT, 'skills', 'architecture-advisor', 'references', 'sd');
  const dangling = [];
  for (const a of areas) {
    for (const part of a.card.split(';')) {
      const m = part.trim().match(/^([\w.-]+\.md) › (.+)$/);
      let text = '';
      // karty sd/NN w references/sd; grupa stack -> references/stack-catalog.md (katalog obok)
      const dir = m && fs.existsSync(path.join(SD, m[1])) ? SD : path.dirname(SD);
      try { text = m ? fs.readFileSync(path.join(dir, m[1]), 'utf8') : ''; } catch (e) { /* brak pliku = dangling */ }
      if (!m || !text.includes(m[2])) dangling.push(`${a.id}: ${part.trim()}`);
    }
  }
  ok('sd-areas: kazdy odsylacz karty (plik › sekcja) istnieje w references/sd', dangling.length === 0, dangling.join(' | '));
}

// ---------- lintMatrix ----------
const good = lint(full());
ok('komplet => ok, 0 problemow', good.ok && good.issues.length === 0 && good.present === areas.length, JSON.stringify(good.issues.slice(0, 3)));

const noRate = lint(full(areas.filter((a) => a.id !== 'rate-limiting')));
ok('brak wiersza rate-limiting => brak-wiersza', !noRate.ok && noRate.missing.includes('rate-limiting') && kinds(noRate).includes('brak-wiersza'));

const decNoEv = lint(full().replace(/\| (ID Generation at Scale \(id-generation\)) \| DECYZJA \| ([^|]+)\| [^|]+\|/, '| $1 | DECYZJA | $2|  |'));
ok('DECYZJA bez dowodu => puste-pole', !decNoEv.ok && decNoEv.issues.some((i) => i.id === 'id-generation' && /bez dowodu/.test(i.msg)), JSON.stringify(decNoEv.issues));

const ntNoSig = lint(full().replace('| > 1 mln wierszy w tabeli zlecen |', '|  |'));
ok('NIE TERAZ bez sygnalu => puste-pole', !ntNoSig.ok && ntNoSig.issues.some((i) => /NIE TERAZ bez sygnalu/.test(i.msg)));
const ntVague = lint(full().replace('| > 1 mln wierszy w tabeli zlecen |', '| gdy bedzie duzo danych |'));
ok('NIE TERAZ z sygnalem bez liczby => niemierzalny-sygnal', kinds(ntVague).includes('niemierzalny-sygnal'));

const badStatus = lint(full().replace('| Caching (caching) | NIE DOTYCZY |', '| Caching (caching) | MOZE |'));
ok('nieznany status => zly-status', badStatus.issues.some((i) => i.id === 'caching' && i.kind === 'zly-status'), JSON.stringify(badStatus.issues));

const dup = lint(full() + row(areas.find((a) => a.id === 'queues')) + '\n');
ok('duplikat wiersza => duplikat', dup.issues.some((i) => i.id === 'queues' && i.kind === 'duplikat'));

const unknown = lint(full() + '| Kolejki (kolejkii) | DECYZJA | x | y | |\n');
ok('literowka w id => nieznany-obszar', kinds(unknown).includes('nieznany-obszar'));

const ndEmpty = lint(full().replace('| Caching (caching) | NIE DOTYCZY | brak takiej funkcji w produkcie |', '| Caching (caching) | NIE DOTYCZY | TODO |'));
ok('NIE DOTYCZY bez uzasadnienia (TODO) => puste-pole', ndEmpty.issues.some((i) => i.id === 'caching' && i.kind === 'puste-pole'));

const fenced = lint('```\n' + full() + '```\n');
ok('tabela w bloku kodu nie liczy sie (wszystkie braki)', fenced.missing.length === areas.length);

const lower = lint(full().replace('| Caching (caching) | NIE DOTYCZY |', '| `caching` | **nie dotyczy** |'));
ok('id w backtickach i status malymi literami/pogrubiony => akceptowane', lower.ok, JSON.stringify(lower.issues));

// --groups: tylko grupy dotkniete + zawsze one_way
const part = areas.filter((a) => a.group === 'odpornosc' || a.one_way);
const partRes = lint(full(part), { groups: ['odpornosc'] });
ok('--groups odpornosc: dotkniete + one_way wystarcza', partRes.ok && partRes.required === part.length, JSON.stringify(partRes.issues.slice(0, 3)));
const partNoOneWay = lint(full(areas.filter((a) => a.group === 'odpornosc')), { groups: ['odpornosc'] });
ok('--groups bez wierszy one_way => brakuje (np. id-generation)', partNoOneWay.missing.includes('id-generation'));

// ---------- CLI ----------
const cli = (args) => spawnSync(process.execPath, [LINT, ...args], { encoding: 'utf8' });
const repoOk = path.join(FIX, 'cli-ok');
write(path.join(repoOk, L.MATRIX_REL), full());
const repoBad = path.join(FIX, 'cli-bad');
write(path.join(repoBad, L.MATRIX_REL), full(areas.filter((a) => a.id !== 'real-time')));
const c0 = cli(['--repo', repoOk]);
ok('CLI: komplet => exit 0', c0.status === 0, c0.stdout + c0.stderr);
const c1 = cli(['--repo', repoBad, '--json']);
let j1 = {};
try { j1 = JSON.parse(c1.stdout); } catch (e) { /* zostaje {} */ }
ok('CLI: brak real-time => exit 1 + JSON missing', c1.status === 1 && (j1.missing || []).includes('real-time'), c1.stdout.slice(0, 200));
const c2 = cli(['--repo', path.join(FIX, 'nie-ma')]);
ok('CLI: brak pliku => exit 2', c2.status === 2);
const c3 = cli(['--bogus']);
ok('CLI: nieznany argument => exit 2', c3.status === 2);
const c4 = cli(['--repo', repoOk, '--groups', 'nie-ma-grupy']);
ok('CLI: nieznana grupa => exit 2', c4.status === 2);
const tpl = cli(['--template']);
ok('CLI: --template daje wszystkie wiersze + naglowek', tpl.status === 0 && tpl.stdout.trim().split('\n').length === areas.length + 2);
const repoTpl = path.join(FIX, 'cli-tpl');
write(path.join(repoTpl, L.MATRIX_REL), tpl.stdout);
ok('CLI: pusty szablon => exit 1 (statusy puste)', cli(['--repo', repoTpl]).status === 1);
const badAreas = path.join(FIX, 'bad-areas.json');
write(badAreas, '{"areas": [{"id": "A B"}]}');
ok('CLI: zly sd-areas.json => exit 2', cli(['--repo', repoOk, '--areas', badAreas]).status === 2);

// ---------- stop-gate: opt-in pg.sd_matrix: required ----------
const git = (dir, args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
function makeRepo(name, files) {
  const dir = path.join(FIX, name);
  fs.mkdirSync(dir, { recursive: true });
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 't@t']);
  git(dir, ['config', 'user.name', 't']);
  git(dir, ['config', 'core.hooksPath', path.join(dir, '.nohooks')]);
  for (const [rel, content] of Object.entries(files)) write(path.join(dir, rel), content);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'init']);
  return dir;
}
function transcriptWith(events) {
  const file = path.join(FIX, 'transcript-' + Math.random().toString(36).slice(2) + '.jsonl');
  write(file, events.map((e) => JSON.stringify({ type: 'assistant', message: { content: [Object.assign({ type: 'tool_use', id: 'x' }, e)] } })).join('\n') + '\n');
  return file;
}
const stateFile = (cwd) => path.join(os.tmpdir(), 'claude-stop-gate-' + require('crypto').createHash('md5').update(cwd + '|').digest('hex'));
const runGate = (cwd, tr) => {
  try { fs.unlinkSync(stateFile(cwd)); } catch (e) { /* brak = ok */ }
  return spawnSync(process.execPath, [STOP_GATE], { input: JSON.stringify({ cwd, transcript_path: tr }), encoding: 'utf8', timeout: 120000 });
};
const T3_ALL = ['code-reviewer', 'security-reviewer', 'data-reviewer', 'ops-reviewer'].map((t) => ({ name: 'Agent', input: { subagent_type: t, prompt: 'x' } }));
const ADR = '# 0001 Tabela orders\n\n## Decyzja\nOsobna tabela orders z RLS.\n## Alternatywy\nJSON w profiles (odrzucone).\n## Konsekwencje\nMigracja + polityki.\n';
function t3Scenario(name, claudeMd, matrix) {
  const files = { 'package.json': JSON.stringify({ name }), 'supabase/migrations/001_init.sql': 'select 1;\n' };
  if (claudeMd) files['CLAUDE.md'] = claudeMd;
  const repo = makeRepo(name, files);
  const mig = path.join(repo, 'supabase/migrations/002_orders.sql');
  write(mig, 'create table orders (id uuid primary key);\nalter table orders enable row level security;\n');
  const adr = path.join(repo, 'docs/adr/0001-orders.md');
  write(adr, ADR);
  const events = [{ name: 'Write', input: { file_path: mig } }, { name: 'Write', input: { file_path: adr } }];
  if (matrix !== undefined) {
    const m = path.join(repo, L.MATRIX_REL);
    write(m, matrix);
    events.push({ name: 'Write', input: { file_path: m } });
  }
  return runGate(repo, transcriptWith(events.concat(T3_ALL)));
}
const OPT_IN = '# repo\n- `pg.sd_matrix: required`\n';
const g1 = t3Scenario('sg-optin-missing', OPT_IN);
ok('stop-gate: opt-in + T3 + brak obszary.md => 2 [obszary]', g1.status === 2 && /\[obszary\]/.test(g1.stderr || ''), 'exit=' + g1.status + ' ' + (g1.stderr || '').slice(0, 300));
const g2 = t3Scenario('sg-optin-partial', OPT_IN, full(areas.filter((a) => a.id !== 'rate-limiting')));
ok('stop-gate: opt-in + niekompletna macierz => 2 [obszary] z lista brakow', g2.status === 2 && /\[obszary\]/.test(g2.stderr || '') && /rate-limiting/.test(g2.stderr || ''), 'exit=' + g2.status + ' ' + (g2.stderr || '').slice(0, 300));
const g3 = t3Scenario('sg-optin-full', OPT_IN, full());
ok('stop-gate: opt-in + komplet => 0', g3.status === 0, 'exit=' + g3.status + ' ' + (g3.stderr || '').slice(0, 300));
const g4 = t3Scenario('sg-no-optin', '# repo\n');
ok('stop-gate: bez opt-in + T3 + brak pliku => 0 + podpowiedz', g4.status === 0 && /macierzy obszarow/.test(g4.stdout || ''), 'exit=' + g4.status + ' ' + (g4.stdout || '').slice(0, 300));
const g5 = t3Scenario('sg-optin-in-fence', '# repo\n```\npg.sd_matrix: required\n```\n');
ok('stop-gate: linia opt-in w bloku kodu nie wlacza bramki => 0', g5.status === 0, 'exit=' + g5.status + ' ' + (g5.stderr || '').slice(0, 300));
// Bez opt-in (uzytkownik 2026-10-10: bezpiecznie, ale lekkie ryzyko dozwolone): podpowiedz tylko o otwartych drzwiach jednokierunkowych.
const g6 = t3Scenario('sg-hint-door-open', '# repo\n', full(areas.filter((a) => a.id !== 'auth' && a.id !== 'rate-limiting')));
ok('stop-gate: bez opt-in + otwarte drzwi (auth) => 0 + podpowiedz z lista drzwi', g6.status === 0 && /Podpowiedz PG \(bez blokady\)/.test(g6.stdout || '') && /drzwi jednokierunkowe: auth/.test(g6.stdout || ''), 'exit=' + g6.status + ' ' + (g6.stdout || '').slice(0, 300));
const g7 = t3Scenario('sg-hint-doors-closed', '# repo\n', full(areas.filter((a) => a.id !== 'rate-limiting')));
ok('stop-gate: bez opt-in + otwarte tylko zwykle wiersze => 0 i cisza (lekkie ryzyko dozwolone)', g7.status === 0 && !/Podpowiedz PG/.test(g7.stdout || ''), 'exit=' + g7.status + ' ' + (g7.stdout || '').slice(0, 300));

// Stop #3 w cyklu: review i arch juz zablokowaly (need=null) — bramka obszarow nie moze zniknac.
{
  const repo = makeRepo('sg-third-stop', { 'package.json': JSON.stringify({ name: 'x' }), 'supabase/migrations/001_init.sql': 'select 1;\n', 'CLAUDE.md': OPT_IN });
  const mig = path.join(repo, 'supabase/migrations/002_orders.sql');
  write(mig, 'create table orders (id uuid primary key);\n');
  const root = git(repo, ['rev-parse', '--show-toplevel']).stdout.trim();
  write(stateFile(repo), JSON.stringify({ reasons: [`review@${root}`, `arch@${root}`] }));
  const r = spawnSync(process.execPath, [STOP_GATE], { input: JSON.stringify({ cwd: repo, transcript_path: transcriptWith([{ name: 'Write', input: { file_path: mig } }]) }), encoding: 'utf8', timeout: 120000 });
  ok('stop-gate: po blokadach [review]+[arch] w cyklu => nadal [obszary]', r.status === 2 && /\[obszary\]/.test(r.stderr || ''), 'exit=' + r.status + ' ' + (r.stderr || '').slice(0, 300));
  try { fs.unlinkSync(stateFile(repo)); } catch (e) { /* brak = ok */ }
}

// ---------- krytyk 2026-10-06: zaslepki, slaby dowod, komentarze HTML, numery linii, warianty z raportu ----------
const ndTodoText = lint(full().replace('| Caching (caching) | NIE DOTYCZY | brak takiej funkcji w produkcie |', '| Caching (caching) | NIE DOTYCZY | TODO uzupelnic po spotkaniu |'));
ok('zaslepka z trescia („TODO uzupelnic...") => puste-pole', ndTodoText.issues.some((i) => i.id === 'caching' && i.kind === 'puste-pole'), JSON.stringify(ndTodoText.issues));
const ntAngle = lint(full().replace('| > 1 mln wierszy w tabeli zlecen |', '| <prog> |'));
ok('sygnal „<prog>" => puste-pole', ntAngle.issues.some((i) => i.kind === 'puste-pole' && /NIE TERAZ bez sygnalu/.test(i.msg)));
const weakEv = lint(full().replace(/\| (Authentication & Authorization \(auth\)|[^|]*\(auth\)) \| DECYZJA \| ([^|]+)\| [^|]+\|/, '| $1 | DECYZJA | $2| jest |'));
ok('DECYZJA z dowodem „jest" => slaby-dowod', weakEv.issues.some((i) => i.id === 'auth' && i.kind === 'slaby-dowod'), JSON.stringify(weakEv.issues));
const evKinds = ['`rg -n rateLimit src`', 'ADR-0003', 'docs/adr/0003-auth.md', 'https://x.example/y', '~3 QPS szczyt', 'package.json'];
ok('dowod: komenda/plik/liczba/link => akceptowany', evKinds.every((ev) => {
  const t = full().replace(/\| ([^|]*\(auth\)) \| DECYZJA \| ([^|]+)\| [^|]+\|/, `| $1 | DECYZJA | $2| ${ev} |`);
  return lint(t).ok;
}));
const commented = lint(full(areas.filter((a) => a.id !== 'search')) + '<!--\n' + row(areas.find((a) => a.id === 'search')) + '\n-->\n');
ok('wiersz w komentarzu HTML nie liczy sie', commented.missing.includes('search'));
const tilde = lint('~~~\n' + full() + '~~~\n');
ok('tabela w bloku ~~~ nie liczy sie', tilde.missing.length === areas.length);
const lineNo = L.parseMatrix('intro\n```\nx\n```\n\n' + HEAD + '| Kolejki (queues) | MOZE | a | b | c |\n');
ok('numery linii po bloku kodu = linie pliku', lineNo.rows[0] && lineNo.rows[0].line === 8, JSON.stringify(lineNo.rows));
{
  const v = (id) => areas.find((a) => a.id === id).variants.join(' | ');
  const want = { 'rate-limiting': /X-RateLimit/, 'search': /chunking[\s\S]*ANN/, 'object-storage': /trwalosc != dostepnosc/, 'real-time': /limity polaczen/, 'cloud-building-blocks': /MFA i role na kontach/, 'auth': /OAuth2\/OIDC \+ PKCE/, 'multi-region-dr': /RPO\/RTO/ };
  const miss = Object.entries(want).filter(([id, rx]) => !rx.test(v(id))).map(([id]) => id);
  ok('sd-areas: warianty z top-10 raportu obecne (rate limit, RAG, pliki, real-time, konta, OAuth, DR)', miss.length === 0, miss.join(', '));
}

// stop-gate: zly sd-areas.json (blad PG) => fail-open, nie blokuje sesji
{
  const copy = path.join(FIX, 'pgcopy');
  for (const d of ['hooks', 'bin', 'pg']) fs.cpSync(path.join(ROOT, d), path.join(copy, d), { recursive: true, filter: (src) => !/node_modules/.test(src) });
  fs.writeFileSync(path.join(copy, 'pg', 'sd-areas.json'), '{ zly json');
  const repo = makeRepo('sg-bad-areas', { 'package.json': JSON.stringify({ name: 'x' }), 'supabase/migrations/001_init.sql': 'select 1;\n', 'CLAUDE.md': OPT_IN });
  const mig = path.join(repo, 'supabase/migrations/002_orders.sql');
  write(mig, 'create table orders (id uuid primary key);\nalter table orders enable row level security;\n');
  const adr = path.join(repo, 'docs/adr/0001-orders.md');
  write(adr, ADR);
  const tr = transcriptWith([{ name: 'Write', input: { file_path: mig } }, { name: 'Write', input: { file_path: adr } }].concat(T3_ALL));
  try { fs.unlinkSync(stateFile(repo)); } catch (e) { /* brak = ok */ }
  const r = spawnSync(process.execPath, [path.join(copy, 'hooks', 'stop-gate.js')], { input: JSON.stringify({ cwd: repo, transcript_path: tr }), encoding: 'utf8', timeout: 120000 });
  ok('stop-gate: zly sd-areas.json (blad PG) => fail-open, bez [obszary]', r.status === 0 && !/\[obszary\]/.test(r.stderr || ''), 'exit=' + r.status + ' ' + (r.stderr || '').slice(0, 300));
}

try { fs.rmSync(FIX, { recursive: true, force: true }); } catch (e) { /* sprzatanie best-effort */ }
// pg-review 2026-10-06: wyciecie blokow liniowo (regex z \\1 byl O(n^2) -> timeout bramki = fail-open), linie zachowane.
{
  const stripped = L.stripNonContent('a\n```js\nb\n```\nc\n<!-- d\ne -->\nf\n<!-- otwarty');
  ok('stripNonContent: bloki i komentarze wyciete, liczba linii zachowana', stripped === 'a\n\n\n\nc\n\n\nf\n', JSON.stringify(stripped));
  const big = '```\n' + 'x\n'.repeat(200000) + '<!--'.repeat(50000);
  const t0 = Date.now();
  L.stripNonContent(big);
  ok('stripNonContent: 200 tys. linii niedomknietego bloku + 50 tys. otwarc komentarza < 1 s', Date.now() - t0 < 1000, `${Date.now() - t0} ms`);
}
console.log(failures ? `\n${failures} FAIL` : '\nwszystkie PASS');
process.exit(failures ? 1 : 0);

// Testy pg-prechecks (audyt PG 2026-10-06 #3/#10): mechaniczne rg z rubryk na liniach DODANYCH w diffie.
// Uruchom: node test_pg_prechecks.js  (0 sieci, 0 modeli; fixture w os.tmpdir(), kasowany)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { RULES, prechecks, addedLines } = require(path.join(__dirname, 'pg-prechecks.js'));
const { ROLES } = require(path.join(__dirname, 'pg-slice.js'));

let failures = 0;
const check = (name, cond, detail) => { if (cond) console.log('ok  ', name); else { failures++; console.log('FAIL', name, detail || ''); } };

// Plik po zmianie + diff, w ktorym `addedIdx` (1-based) to linie dodane; reszta = kontekst (istniejacy kod).
function fileDiff(file, lines, addedIdx) {
  const body = lines.map((l, i) => (addedIdx.includes(i + 1) ? '+' : ' ') + l).join('\n');
  const oldCount = lines.length - addedIdx.length;
  return `diff --git a/${file} b/${file}\nindex 1..2 100644\n--- a/${file}\n+++ b/${file}\n@@ -1,${oldCount} +1,${lines.length} @@\n${body}\n`;
}

const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-prechecks-repo-'));
const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-prechecks-run-'));
const write = (rel, lines) => { fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true }); fs.writeFileSync(path.join(repo, rel), lines.join('\n') + '\n'); };
try {
  const server = [
    'import { supabase } from "@/lib/db";',                                     // 1 kontekst
    'export async function list() {',                                         // 2 kontekst
    '  const a = await supabase.from("t").select("*").limit(10);',            // 3 + SELECT-STAR, LIMIT-WITHOUT-ORDER
    '  const b = await supabase.from("t").select("id").order("id").limit(5);',// 4 + order obok => brak trafienia
    '  console.log("debug", a);',                                             // 5 + CONSOLE-LOG
    '  // eslint-disable-next-line no-explicit-any',                          // 6 + SUPPRESSION
    '  const c = b as any;',                                                  // 7 + ANY-TYPE
    '  try { await fetch("https://x.test"); } catch (e) {}',                  // 8 + FETCH-NO-TIMEOUT, EMPTY-CATCH
    '  logger.warn("cos poszlo nie tak");',                                   // 9 + LOG-NO-CONTEXT
    '  return c; // TODO: paginacja',                                         // 10 + TODO
    '}',                                                                      // 11 kontekst
    'const old = await supabase.from("x").select("*").limit(1); // istniejacy dlug', // 12 kontekst (nie dodany)
  ];
  write('src/server/radar/list.ts', server);
  write('src/server/radar/timed.ts', ['export const r = await fetch(url, { signal: AbortSignal.timeout(5000) });']);
  write('src/components/Card.tsx', ['export const Card = () => <div style={{ color: "#ff0000" }} dangerouslySetInnerHTML={{ __html: x }} />;']);
  write('supabase/migrations/20261006_x.sql', ['alter table t drop column legacy;', 'create function f() returns void language sql security definer as $$ select 1 $$;']);
  write('docs/adr/0003.md', ['# ADR', 'Klucz: sk_live_abcdefghijklmnop']);
  write('.github/workflows/ci.yml', ['      - run: npm run lint --if-present']);
  const diff = 'preambula\n'
    + fileDiff('src/server/radar/list.ts', server, [3, 4, 5, 6, 7, 8, 9, 10])
    + fileDiff('src/server/radar/timed.ts', ['export const r = await fetch(url, { signal: AbortSignal.timeout(5000) });'], [1])
    + fileDiff('src/components/Card.tsx', ['export const Card = () => <div style={{ color: "#ff0000" }} dangerouslySetInnerHTML={{ __html: x }} />;'], [1])
    + fileDiff('supabase/migrations/20261006_x.sql', ['alter table t drop column legacy;', 'create function f() returns void language sql security definer as $$ select 1 $$;'], [1, 2])
    + fileDiff('docs/adr/0003.md', ['# ADR', 'Klucz: sk_live_abcdefghijklmnop'], [2])
    + fileDiff('.github/workflows/ci.yml', ['      - run: npm run lint --if-present'], [1])
    + 'diff --git a/src/gone.ts b/src/gone.ts\ndeleted file mode 100644\n--- a/src/gone.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-console.log(1)\n';
  const chain = [
    'const ok = await supabase',        // 1
    '  .from("a")',                     // 2
    '  .select("id")',                  // 3
    '  .order("id")',                   // 4
    '  .limit(5);',                     // 5 + order w tej samej instrukcji => brak trafienia
    'const bad = await supabase',       // 6
    '  .from("b")',                     // 7
    '  .select("id")',                  // 8
    '  .limit(5);',                     // 9 + brak order (order z instrukcji wyzej sie nie liczy) => trafienie
  ];
  write('src/server/radar/chain.ts', chain);
  fs.writeFileSync(path.join(runDir, 'diff.patch'), diff + fileDiff('src/server/radar/chain.ts', chain, [5, 9]));

  // ---------- addedLines ----------
  const al = addedLines(diff, repo);
  check('addedLines: numery linii dodanych po stronie b/', [...al['src/server/radar/list.ts'].added].join() === '3,4,5,6,7,8,9,10', [...al['src/server/radar/list.ts'].added].join());
  check('addedLines: plik usuniety = 0 dodanych', al['src/gone.ts'].added.size === 0);

  // ---------- prechecks (rg albo fallback, w zaleznosci od PATH) ----------
  const res = prechecks(diff, repo);
  const hit = (role, rule, file, line) => res[role].some((h) => h.rule === rule && h.file === file && (line === undefined || h.line === line));
  const L = 'src/server/radar/list.ts';
  check('wynik ma klucz kazdej roli', ROLES.every((r) => Array.isArray(res[r])), Object.keys(res).join());
  check('SELECT-STAR -> data', hit('data', 'SELECT-STAR', L, 3));
  check('LIMIT-WITHOUT-ORDER -> data i code', hit('data', 'LIMIT-WITHOUT-ORDER', L, 3) && hit('code', 'LIMIT-WITHOUT-ORDER', L, 3));
  check('.limit z .order w oknie => brak trafienia', !hit('data', 'LIMIT-WITHOUT-ORDER', L, 4));
  const resChain = prechecks(fs.readFileSync(path.join(runDir, 'diff.patch'), 'utf8'), repo);
  const chainHits = resChain.data.filter((h) => h.file === 'src/server/radar/chain.ts' && h.rule === 'LIMIT-WITHOUT-ORDER').map((h) => h.line);
  check('lancuch wieloliniowy: .order w tej samej instrukcji => brak; w poprzedniej => trafienie', chainHits.join() === '9', chainHits.join());
  check('linia NIEdodana (dlug historyczny) => brak trafienia', !res.data.some((h) => h.file === L && h.line === 12));
  check('CONSOLE-LOG -> code', hit('code', 'CONSOLE-LOG', L, 5));
  check('SUPPRESSION -> code', hit('code', 'SUPPRESSION', L, 6));
  check('ANY-TYPE -> code', hit('code', 'ANY-TYPE', L, 7));
  check('FETCH-NO-TIMEOUT -> ops/security', hit('ops', 'FETCH-NO-TIMEOUT', L, 8) && hit('security', 'FETCH-NO-TIMEOUT', L, 8));
  check('fetch z AbortSignal.timeout => brak trafienia', !res.ops.some((h) => h.file === 'src/server/radar/timed.ts'));
  check('EMPTY-CATCH -> code', hit('code', 'EMPTY-CATCH', L, 8));
  check('LOG-NO-CONTEXT -> ops', hit('ops', 'LOG-NO-CONTEXT', L, 9));
  check('TODO -> code (plik kodu nie jest w wycinku product => pierwsza rola z wycinka)', hit('code', 'TODO', L, 10));
  check('INLINE-STYLE-HEX -> ux', hit('ux', 'INLINE-STYLE-HEX', 'src/components/Card.tsx', 1));
  check('DANGEROUS-SINK -> code (komponent poza wycinkiem security)', hit('code', 'DANGEROUS-SINK', 'src/components/Card.tsx', 1));
  check('SQL-DESTRUCTIVE -> data + security', hit('data', 'SQL-DESTRUCTIVE', 'supabase/migrations/20261006_x.sql', 1) && hit('security', 'SQL-DESTRUCTIVE', 'supabase/migrations/20261006_x.sql', 1));
  check('DEFINER-NO-SEARCH-PATH -> security', hit('security', 'DEFINER-NO-SEARCH-PATH', 'supabase/migrations/20261006_x.sql', 2));
  check('SECRET-LITERAL w docs -> ops (fallback: pierwsza rola reguly)', hit('ops', 'SECRET-LITERAL', 'docs/adr/0003.md', 2));
  check('CI-SILENT-SKIP -> ops', hit('ops', 'CI-SILENT-SKIP', '.github/workflows/ci.yml', 1));
  check('kazde trafienie ma rule/file/line/text/source', Object.values(res).flat().every((h) => h.rule && h.file && h.line > 0 && typeof h.text === 'string' && h.source));
  check('kazda regula ma odnosnik do rubryki', RULES.every((r) => /agents\/|checklist|audyt/.test(r.source)), RULES.filter((r) => !/agents\//.test(r.source)).map((r) => r.id).join());

  // ---------- repo nie na stanie diffu (r27: repo 2 commity dalej, radar.css przesuniety o 114 linii) ----------
  check('repo zgodne z diffem => stale puste', Array.isArray(res.stale) && res.stale.length === 0, String(res.stale));
  const staleRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-prechecks-stale-'));
  try {
    fs.mkdirSync(path.join(staleRepo, 'src/server/radar'), { recursive: true });
    // repo ma 2 nowe linie na gorze (commit po recenzji) -> numery z repo przesuniete o 2
    fs.writeFileSync(path.join(staleRepo, L), ['// nowy naglowek', '// po recenzji', ...server].join('\n') + '\n');
    const resStale = prechecks(diff, staleRepo);
    const s = resStale.data.find((h) => h.rule === 'LIMIT-WITHOUT-ORDER' && h.file === L);
    check('stale: plik wykryty jako niezgodny z diffem', resStale.stale.includes(L), String(resStale.stale));
    check('stale: trafienie z tekstu diffu, numer linii z diffu (3, nie 5), origin=diff', s && s.line === 3 && s.origin === 'diff', JSON.stringify(s));
    check('stale: okno near z kontekstu hunka dalej filtruje (.order obok)', !resStale.data.some((h) => h.file === L && h.line === 4 && h.rule === 'LIMIT-WITHOUT-ORDER'));
    check('stale: brak trafien z przesunietych linii repo', !Object.values(resStale).flat().some((h) => h.file === L && !h.origin));
    check('stale: prechecks.json bez dodatkowych kluczy', Object.keys(JSON.parse(JSON.stringify(resStale))).join() === ROLES.join());
    const runStale = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-prechecks-runst-'));
    fs.writeFileSync(path.join(runStale, 'diff.patch'), diff);
    const outStale = execFileSync(process.execPath, [path.join(__dirname, 'pg-prechecks.js'), '--run', runStale, '--repo', staleRepo], { encoding: 'utf8' });
    fs.rmSync(runStale, { recursive: true, force: true });
    check('stale: CLI ostrzega UWAGA z nazwa pliku', /UWAGA: \d+ plik/.test(outStale) && outStale.includes(L), outStale);
  } finally {
    fs.rmSync(staleRepo, { recursive: true, force: true });
  }

  // ---------- CLI: rg vs fallback JS daja ten sam wynik ----------
  const cli = path.join(__dirname, 'pg-prechecks.js');
  execFileSync(process.execPath, [cli, '--run', runDir, '--repo', repo], { encoding: 'utf8' });
  const viaPath = JSON.parse(fs.readFileSync(path.join(runDir, 'prechecks.json'), 'utf8'));
  const outNoRg = execFileSync(process.execPath, [cli, '--run', runDir, '--repo', repo], { encoding: 'utf8', env: { PATH: '/nonexistent' } });
  const viaJs = JSON.parse(fs.readFileSync(path.join(runDir, 'prechecks.json'), 'utf8'));
  const norm = (r) => JSON.stringify(ROLES.map((k) => r[k].map((h) => `${h.rule}|${h.file}|${h.line}`).sort()));
  check('CLI: fallback JS uzyty bez rg', /fallback JS/.test(outNoRg), outNoRg);
  check('CLI: rg i fallback JS = identyczne trafienia', norm(viaPath) === norm(viaJs), `${norm(viaPath)}\n vs \n${norm(viaJs)}`);
  check('CLI: prechecks.json = wynik funkcji', norm(viaJs) === norm(resChain));
  let usage = 0;
  try { execFileSync(process.execPath, [cli, '--run', runDir], { stdio: 'pipe' }); } catch (e) { usage = e.status; }
  check('CLI: brak --repo => exit 2', usage === 2, String(usage));
} finally {
  fs.rmSync(repo, { recursive: true, force: true });
  fs.rmSync(runDir, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} FAIL` : '\nwszystkie OK');
process.exit(failures ? 1 : 0);

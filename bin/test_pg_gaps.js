// Testy bramek i narzedzi z gap-analizy vs slownik software house (2026-09-12, L1-L15).
// POZYTYWNE (bramka MUSI zablokowac) + negatywne (czysty przypadek przechodzi). Uruchom: node test_pg_gaps.js
// Fixture'y w %TEMP% (fs.mkdtempSync), kasowane przez fs.rmSync. qa-matrix: realna przegladarka na lokalnym
// serwerze http (child process) — pomijane z komunikatem, gdy brak Playwrighta/Chromium.
'use strict';
const { spawnSync, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOME = os.homedir();
const BIN = path.join(HOME, '.claude', 'bin');
const HOOKS = path.join(HOME, '.claude', 'hooks');
const { classify } = require(path.join(HOOKS, 'lib', 'risk-tier.js'));
const { phaseChanges, analyze: analyzePhase } = require(path.join(BIN, 'phase-gate.js'));
const { findProdRef, findHits } = require(path.join(BIN, 'env-ref-gate.js'));
const { analyze: analyzeTodo } = require(path.join(BIN, 'todo-ledger-gate.js'));
const { piiColumnsFromSql, documentedColumns, missingRows } = require(path.join(BIN, 'pii-inventory-gate.js'));
const { expandMatrix, renderMarkdown, summarize } = require(path.join(BIN, 'qa-matrix.js'));

let failures = 0;
const check = (name, cond, detail) => { if (cond) console.log('ok  ', name); else { failures++; console.log('FAIL', name, detail || ''); } };
const tmp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const write = (file, content) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); };
const git = (dir, args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
const run = (tool, args, cwd) => spawnSync('node', [path.join(BIN, tool), ...args], { cwd, encoding: 'utf8', timeout: 120000 });
function makeRepo(files) {
  const dir = tmp('pg-gaps-');
  git(dir, ['init', '-q']); git(dir, ['config', 'user.email', 't@t']); git(dir, ['config', 'user.name', 't']);
  git(dir, ['config', 'core.hooksPath', path.join(dir, '.nohooks')]);
  for (const [rel, content] of Object.entries(files)) write(path.join(dir, rel), content);
  git(dir, ['add', '-A']); git(dir, ['commit', '-q', '-m', 'init']);
  return dir;
}
const stage = (dir, files) => { for (const [rel, content] of Object.entries(files)) write(path.join(dir, rel), content); git(dir, ['add', '-A']); };

// ---------- L1 risk-tier: faza prototypu = sufit T1; qa-reviewer opcjonalny przy UI na T2+ ----------
{
  const proto = tmp('pg-phase-');
  fs.writeFileSync(path.join(proto, 'CLAUDE.md'), '- `pg.phase: prototype`\n');
  const r = classify([path.join(proto, 'supabase/migrations/001.sql')], 700, proto);
  // Pierwotne oczekiwanie (T1 dla prototypu z migracja) bylo NIEBEZPIECZNE: security-reviewer 2026-09-12 pokazal, ze jedno zdanie
  // w CLAUDE.md zdejmowalo security/data z RLS. Sciezki T3 nie podlegaja sufitowi — test zmieniony razem z kodem, z tego powodu.
  check('risk-tier: prototype + migracja + 700 linii => T3 (sufit nie dotyka sciezek T3), phase=prototype', r.tier === 'T3' && r.phase === 'prototype' && r.reviewers.includes('security-reviewer') && !r.phaseCapped, JSON.stringify(r));
  fs.writeFileSync(path.join(proto, 'CLAUDE.md'), '- `pg.phase: production`\n');
  const p = classify([path.join(proto, 'src/lib/price.ts'), path.join(proto, 'src/components/A.tsx')], 40, proto);
  check('risk-tier: production + lib + tsx => T2, optional qa-reviewer', p.tier === 'T2' && p.optional_reviewers.includes('qa-reviewer'), JSON.stringify(p));
  const t1 = classify([path.join(proto, 'src/components/A.tsx')], 10, proto);
  check('risk-tier: T1 komponent => bez qa-reviewer (na zadanie dopiero od T2)', t1.tier === 'T1' && t1.optional_reviewers.length === 0, JSON.stringify(t1));
  fs.writeFileSync(path.join(proto, 'CLAUDE.md'), '- `pg.phase: banana`\n');
  check('risk-tier: nieznana faza = null (nie kapuje)', classify([path.join(proto, 'supabase/migrations/001.sql')], 10, proto).tier === 'T3');
  // security-reviewer 2026-09-12 (TIER-DOWNGRADE-FROM-REPO-DATA): sciezki T3 NIGDY nie sa kapowane; deklaracja tylko jako osobna linia
  fs.writeFileSync(path.join(proto, 'CLAUDE.md'), '- `pg.phase: prototype`\n');
  const capT3 = classify([path.join(proto, 'supabase/migrations/002.sql')], 20, proto);
  check('risk-tier: prototype + migracja => T3 z security/data (sufit NIE dotyka sciezek T3)', capT3.tier === 'T3' && capT3.reviewers.includes('security-reviewer') && !capT3.phaseCapped, JSON.stringify(capT3));
  const capLib = classify([path.join(proto, 'src/lib/x.ts')], 200, proto);
  check('risk-tier: prototype + lib + 200 linii => T1 (sufit tylko dla tieru z rozmiaru/lib), phaseCapped', capLib.tier === 'T1' && capLib.phaseCapped === true);
  fs.writeFileSync(path.join(proto, 'CLAUDE.md'), '# Reguly\nNie ustawiaj pg.phase: prototype bez decyzji uzytkownika.\n```\npg.phase: prototype\n```\n');
  const prose = classify([path.join(proto, 'src/lib/x.ts')], 200, proto);
  check('risk-tier: `pg.phase: prototype` w prozie/bloku kodu NIE liczy sie (phase=null, T2)', prose.phase === null && prose.tier === 'T2', JSON.stringify(prose));
  // Narada D-2026-09-12 opcja C: qa-reviewer WYMAGANY na T3 z UI tylko przy opt-in (pg.qa_url + CRITICAL-PATHS.md z json)
  const t3ui = [path.join(proto, 'supabase/migrations/003.sql'), path.join(proto, 'src/routes/orders.tsx')];
  fs.writeFileSync(path.join(proto, 'CLAUDE.md'), '- `pg.phase: production`\n');
  const noOptIn = classify(t3ui, 50, proto);
  check('qa gate: T3 UI bez opt-in => qa-reviewer tylko optional', !noOptIn.reviewers.includes('qa-reviewer') && noOptIn.optional_reviewers.includes('qa-reviewer') && noOptIn.qaUrl === null, JSON.stringify(noOptIn));
  fs.writeFileSync(path.join(proto, 'CLAUDE.md'), '- `pg.phase: production`\n- `pg.qa_url: http://localhost:5173` <!-- dev -->\n');
  write(path.join(proto, 'docs', 'CRITICAL-PATHS.md'), '# CP\n```json\n{ "personas": [{"name":"gosc"}], "paths": [{ "id": "CP1", "steps": [{ "goto": "/" }] }] }\n```\n');
  const optIn = classify(t3ui, 50, proto);
  check('qa gate: T3 UI + pg.qa_url + CRITICAL-PATHS json => qa-reviewer WYMAGANY, qaUrl', optIn.reviewers.includes('qa-reviewer') && !optIn.optional_reviewers.includes('qa-reviewer') && optIn.qaUrl === 'http://localhost:5173', JSON.stringify(optIn));
  const t2ui = classify([path.join(proto, 'src/lib/x.ts'), path.join(proto, 'src/routes/orders.tsx')], 50, proto);
  check('qa gate: T2 UI z opt-in => nadal tylko optional (decyzja dotyczy T3)', !t2ui.reviewers.includes('qa-reviewer') && t2ui.optional_reviewers.includes('qa-reviewer'));
  fs.writeFileSync(path.join(proto, 'CLAUDE.md'), '- `pg.phase: production`\nUstaw `pg.qa_url: http://x` gdy gotowe.\n');
  check('qa gate: pg.qa_url w prozie nie liczy sie', !classify(t3ui, 50, proto).reviewers.includes('qa-reviewer'));
  fs.rmSync(proto, { recursive: true, force: true });
}

// ---------- L1 phase-gate ----------
{
  const diff = (oldP, newP) => `diff --git a/CLAUDE.md b/CLAUDE.md\n--- a/CLAUDE.md\n+++ b/CLAUDE.md\n@@ -1 +1 @@\n${oldP ? `-- \`pg.phase: ${oldP}\`\n` : ''}+- \`pg.phase: ${newP}\`\n`;
  check('phase-gate: parse old/new', JSON.stringify(phaseChanges(diff('mvp', 'production'))) === JSON.stringify([{ file: 'CLAUDE.md', oldPhase: 'mvp', newPhase: 'production' }]));
  check('phase-gate: mvp -> production bez PRR = violation', analyzePhase(phaseChanges(diff('mvp', 'production')), ['CLAUDE.md']).violations.length === 1);
  check('phase-gate: mvp -> production z docs/prr/x.md = OK', analyzePhase(phaseChanges(diff('mvp', 'production')), ['CLAUDE.md', 'docs/prr/2026-09-12.md']).violations.length === 0);
  check('phase-gate: pierwsza deklaracja production = info', analyzePhase(phaseChanges(diff(null, 'production')), ['CLAUDE.md']).violations.length === 0);
  check('phase-gate: nieznana faza = violation', /nieznana faza/.test(analyzePhase(phaseChanges(diff('mvp', 'prodcution')), ['CLAUDE.md']).violations[0] || ''));
  check('phase-gate: production -> maintenance = OK', analyzePhase(phaseChanges(diff('production', 'maintenance')), ['CLAUDE.md']).violations.length === 0);
  check('phase-gate: production -> prototype = degradacja = violation (security PHASE-DEMOTION-UNGATED)', /degradacja/.test(analyzePhase(phaseChanges(diff('production', 'prototype')), ['CLAUDE.md']).violations[0] || ''));
  check('phase-gate: pg.phase w prozie diffu nie jest zmiana fazy', phaseChanges('diff --git a/CLAUDE.md b/CLAUDE.md\n--- a/CLAUDE.md\n+++ b/CLAUDE.md\n@@ -1 +1 @@\n+Nie ustawiaj pg.phase: prototype bez zgody.\n').length === 0);
  // podkatalog: apps/web/CLAUDE.md wymaga apps/web/docs/prr/
  check('phase-gate: podkatalog wymaga PRR obok', analyzePhase([{ file: 'apps/web/CLAUDE.md', oldPhase: 'mvp', newPhase: 'production' }], ['docs/prr/x.md']).violations.length === 1
    && analyzePhase([{ file: 'apps/web/CLAUDE.md', oldPhase: 'mvp', newPhase: 'production' }], ['apps/web/docs/prr/x.md']).violations.length === 0);
  // repo klienckie: promocja wymaga odebranego etapu w docs/ACCEPTANCE.md (protokol odbioru)
  const clientChange = [{ file: 'CLAUDE.md', oldPhase: 'mvp', newPhase: 'production' }];
  const files = { 'CLAUDE.md': '- `pg.phase: production`\n- `pg.ownership: client-transferred`\n', 'docs/ACCEPTANCE.md': '| Etap | Zakres | URL | Data | Odebral | Uwagi |\n|---|---|---|---|---|---|\n| E1 | S1-S3 | https://x | RRRR-MM-DD | [klient] | |\n' };
  check('phase-gate: client-* + ACCEPTANCE.md tylko z szablonem = violation', analyzePhase(clientChange, ['CLAUDE.md', 'docs/prr/x.md'], (f) => files[f] || '').violations.some((v) => /ACCEPTANCE/.test(v)));
  files['docs/ACCEPTANCE.md'] += '| E1 | S1-S3 | https://x | 2026-09-10 | Jan Klient, mail | brak |\n';
  check('phase-gate: client-* + odebrany etap z data = OK', analyzePhase(clientChange, ['CLAUDE.md', 'docs/prr/x.md'], (f) => files[f] || '').violations.length === 0);
  check('phase-gate: mas-saas nie wymaga ACCEPTANCE', analyzePhase(clientChange, ['CLAUDE.md', 'docs/prr/x.md'], (f) => ({ 'CLAUDE.md': '- `pg.ownership: mas-saas`\n' })[f] || '').violations.length === 0);
  // CLI na realnym repo
  const repo = makeRepo({ 'CLAUDE.md': '- `pg.phase: prototype`\n' });
  stage(repo, { 'CLAUDE.md': '- `pg.phase: production`\n' });
  const g1 = run('phase-gate.js', ['--staged'], repo);
  check('phase-gate CLI: promocja bez PRR => 1', g1.status === 1 && /BLOK/.test(g1.stdout), g1.stdout + g1.stderr);
  stage(repo, { 'docs/prr/2026-09-12.md': '# PRR\nP1 ok\n' });
  check('phase-gate CLI: z PRR => 0', run('phase-gate.js', ['--staged'], repo).status === 0);
  fs.rmSync(repo, { recursive: true, force: true });
}

// ---------- L2 env-ref-gate ----------
{
  const REF = 'abcdefghijklmnopqrst';
  check('env-ref: deklaracja z .env.example', (findProdRef({ envExample: `SUPABASE_PROJECT_REF_PROD=${REF}\n` }) || {}).ref === REF);
  check('env-ref: deklaracja z config.toml', (findProdRef({ configToml: `[x]\nproject_id = "${REF}"\n` }) || {}).source === 'supabase/config.toml');
  check('env-ref: config.toml z NAZWA (nie ref) = brak deklaracji', findProdRef({ configToml: '[x]\nproject_id = "workshop-app"\n' }) === null);
  check('env-ref: supabase/.temp/project-ref (supabase link) ma pierwszenstwo przed config.toml', (findProdRef({ linkedRef: `${REF}\n`, configToml: '[x]\nproject_id = "zzzzzzzzzzzzzzzzzzzz"\n' }) || {}).ref === REF);
  check('env-ref: brak deklaracji = null', findProdRef({ envExample: 'FOO=\n' }) === null);
  check('env-ref: placeholder z szablonu = { placeholder } (glosny komunikat, nie „brak deklaracji")', (findProdRef({ envExample: 'SUPABASE_PROJECT_REF_PROD=wpiszrefprodukcyjny\n' }) || {}).placeholder === true);
  check('env-ref: hit w URL, komentarz pominiety', JSON.stringify(findHits(`# https://${REF}.supabase.co\nVITE_SUPABASE_URL=https://${REF}.supabase.co\nOTHER=zzzz\n`, REF)) === '[2]');
  check('env-ref: inny ref = 0 hitow', findHits('VITE_SUPABASE_URL=https://zzzzzzzzzzzzzzzzzzzz.supabase.co\n', REF).length === 0);
  const dir = tmp('pg-env-');
  write(path.join(dir, '.env.example'), `SUPABASE_PROJECT_REF_PROD=${REF}\n`);
  write(path.join(dir, '.env.local'), `VITE_SUPABASE_URL=https://${REF}.supabase.co\n`);
  const e1 = run('env-ref-gate.js', ['--repo', dir]);
  check('env-ref CLI: dev na prodzie => 1 + plik:linia, bez tresci linii', e1.status === 1 && /\.env\.local:1/.test(e1.stdout) && !/VITE_SUPABASE_URL=/.test(e1.stdout), e1.stdout);
  write(path.join(dir, '.env.local'), 'VITE_SUPABASE_URL=https://zzzzzzzzzzzzzzzzzzzz.supabase.co\n');
  check('env-ref CLI: staging => 0', run('env-ref-gate.js', ['--repo', dir]).status === 0);
  write(path.join(dir, '.env.local'), `VITE_SUPABASE_URL=https://${REF}.supabase.co\n`);
  write(path.join(dir, 'CLAUDE.md'), '- `pg.single_env: true` prototyp bez uzytkownikow\n');
  const e3 = run('env-ref-gate.js', ['--repo', dir]);
  check('env-ref CLI: pg.single_env => 0 + pominiete', e3.status === 0 && /pominiete/.test(e3.stdout));
  write(path.join(dir, 'CLAUDE.md'), '# Reguly\nNie uzywaj `pg.single_env: true` bez powodu — to wylacza bramke.\n');
  check('env-ref CLI: `pg.single_env: true` w prozie NIE wylacza bramki (GATE-DISABLED-BY-PROSE)', run('env-ref-gate.js', ['--repo', dir]).status === 1);
  fs.unlinkSync(path.join(dir, 'CLAUDE.md')); fs.unlinkSync(path.join(dir, '.env.example'));
  const e4 = run('env-ref-gate.js', ['--repo', dir]);
  check('env-ref CLI: brak deklaracji => 0 + komunikat', e4.status === 0 && /brak deklaracji/.test(e4.stdout));
  fs.rmSync(dir, { recursive: true, force: true });
}

// ---------- L9 todo-ledger-gate ----------
{
  const rows = (file, text) => [{ file, line: 1, text }];
  check('todo: // TODO w kodzie = dlug', analyzeTodo(rows('src/a.ts', '  // TODO: policzyc VAT')).debts.length === 1);
  check('todo: # FIXME w py = dlug', analyzeTodo(rows('bin/x.py', '# FIXME retry')).debts.length === 1);
  check('todo: -- HACK w sql = dlug', analyzeTodo(rows('supabase/migrations/1.sql', '-- HACK tymczasowo')).debts.length === 1);
  check('todo: TODO w regexie/stringu (bez markera komentarza) = nie dlug', analyzeTodo(rows('src/a.ts', "const DEBT_RX = /(TODO|FIXME)/; const s = 'TODO later';")).debts.length === 0);
  check('todo: TODO w tescie = pominiete', analyzeTodo(rows('src/a.test.ts', '// TODO')).debts.length === 0 && analyzeTodo(rows('bin/test_x.js', '// TODO')).debts.length === 0);
  check('todo: TODO w .md = pominiete', analyzeTodo(rows('docs/x.md', '// TODO')).debts.length === 0);
  check('todo: BACKLOG.md w diffie = ledgerTouched', analyzeTodo([...rows('src/a.ts', '// TODO x'), { file: 'docs/quality/BACKLOG.md', line: 9, text: '| 2026-09-12 | src/a.ts:1 | x | y | z | open |' }]).ledgerTouched === true);
  const repo = makeRepo({ 'src/a.ts': 'export const a = 1;\n' });
  stage(repo, { 'src/a.ts': 'export const a = 1;\n// TODO: obsluzyc PLN\n' });
  const t1 = run('todo-ledger-gate.js', ['--staged'], repo);
  check('todo CLI: nowy TODO bez BACKLOG => 1', t1.status === 1 && /src\/a\.ts:2/.test(t1.stdout), t1.stdout);
  stage(repo, { 'docs/quality/BACKLOG.md': '| 2026-09-12 | src/a.ts:2 | PLN | kazda zmiana VAT | v1.1 | open |\n' });
  check('todo CLI: z BACKLOG => 0', run('todo-ledger-gate.js', ['--staged'], repo).status === 0);
  fs.rmSync(repo, { recursive: true, force: true });
}

// ---------- L5 pii-inventory-gate ----------
{
  const sql = 'create table if not exists public.customers (\n  id uuid primary key,\n  email text not null,\n  note text,\n  constraint x unique (email)\n);\nalter table customers add column if not exists phone text;\nalter table jobs add column mileage int;\n';
  const cols = piiColumnsFromSql(sql);
  check('pii: email z CREATE + phone z ALTER, bez mileage/constraint', cols.map((c) => `${c.table}.${c.column}`).join(',') === 'customers.email,customers.phone', JSON.stringify(cols));
  const oneLine = piiColumnsFromSql('create table leads (id uuid, email text, phone text);\ncreate table x (note text);\nalter table x add column iban text;\n');
  check('pii: jednoliniowy CREATE TABLE (recheck bug) + tabela zamknieta w tej samej linii', oneLine.map((c) => `${c.table}.${c.column}`).join(',') === 'leads.email,leads.phone,x.iban', JSON.stringify(oneLine));
  const doc = documentedColumns('| e-mail | `customers.email` | kontakt |\n| tel | customers.phone | sms |\n| x | `orders.*` | y |\ntekst poza tabela customers.zip\n');
  check('pii: PRIVACY.md parse (backticki, bez, wildcard; poza tabela nie)', doc.has('customers.email') && doc.has('customers.phone') && doc.has('orders.*') && !doc.has('customers.zip'));
  check('pii: wildcard tabela.* pokrywa kolumne', missingRows([{ table: 'orders', column: 'iban' }], doc).length === 0);
  check('pii: brakujacy wiersz wykryty', missingRows([{ table: 'customers', column: 'iban' }], doc).length === 1);
  const repo = makeRepo({ 'README.md': 'x\n' });
  stage(repo, { 'supabase/migrations/001_customers.sql': sql });
  const p1 = run('pii-inventory-gate.js', ['--staged'], repo);
  check('pii CLI: migracja z PII bez PRIVACY.md => 1', p1.status === 1 && /NIE ISTNIEJE/.test(p1.stdout), p1.stdout);
  stage(repo, { 'docs/PRIVACY.md': '| e-mail | `customers.email` | c | p | r | Supabase | rpc |\n' });
  const p2 = run('pii-inventory-gate.js', ['--staged'], repo);
  check('pii CLI: brakuje phone => 1 z nazwa', p2.status === 1 && /customers\.phone/.test(p2.stdout) && !/customers\.email/.test(p2.stdout), p2.stdout);
  stage(repo, { 'docs/PRIVACY.md': '| e-mail | `customers.email` | c | p | r | Supabase | rpc |\n| tel | `customers.phone` | c | p | r | Twilio | rpc |\n' });
  check('pii CLI: komplet => 0', run('pii-inventory-gate.js', ['--staged'], repo).status === 0);
  git(repo, ['commit', '-q', '-m', 'feat: pii']);
  stage(repo, { 'supabase/migrations/002_more.sql': 'alter table customers add column kennitala text;\n' });
  const p4 = run('pii-inventory-gate.js', ['--staged'], repo);
  check('pii CLI: tylko NOWA kolumna liczona (staged), stare udokumentowane', p4.status === 1 && /customers\.kennitala/.test(p4.stdout) && !/customers\.email/.test(p4.stdout), p4.stdout);
  check('pii CLI: --repo liczy caly inwentarz', run('pii-inventory-gate.js', ['--repo', repo]).status === 1);
  fs.rmSync(repo, { recursive: true, force: true });
}

// ---------- bash-guard rm-rf: cele tylko do `;` `&` `|`, kazde rm osobno ----------
{
  const bg = (c) => spawnSync('node', [path.join(HOOKS, 'bash-guard.js')], { input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: c } }), encoding: 'utf8' }).status;
  check('bash-guard: rm -rf /tmp/x; dalsze komendy => 0', bg('rm -rf /tmp/tmp.abc; set -u; T=$(mktemp -d); cd "$T"') === 0);
  check('bash-guard: rm -rf /tmp/a && rm -rf /tmp/b => 0', bg('rm -rf /tmp/a && rm -rf /tmp/b') === 0);
  check('bash-guard: rm -rf node_modules && rm -rf src => 2', bg('rm -rf node_modules && rm -rf src') === 2);
  check('bash-guard: rm -rf src => 2 (regresja)', bg('rm -rf src') === 2);
}

// ---------- L3 / L14: skrypty Python — self-testy funkcji czystych ----------
for (const script of ['backup-drill.py', 'usage-by-repo.py']) {
  const r = spawnSync('python', [path.join(BIN, script), '--self-test'], { encoding: 'utf8', timeout: 60000 });
  check(`${script} --self-test => 0`, r.status === 0, (r.stdout + r.stderr).split('\n').filter((l) => /FAIL|Error/.test(l)).join(' | '));
}

// ---------- L4 qa-matrix: granice zaufania (security-reviewer 2026-09-12) ----------
{
  const { safeName, isAllowedUrl, allowedOrigins, envValueFor, resolvePlaywright } = require(path.join(BIN, 'qa-matrix.js'));
  const { isTrustedDir } = require(path.join(HOOKS, 'lib', 'trusted-roots.js'));
  const allowed = allowedOrigins({ baseURL: 'http://localhost:5173', allowOrigins: ['https://preview.example.is'] });
  check('qa-matrix: goto na obcy origin = zabroniony; --allow-origin i localhost = OK', !isAllowedUrl('https://evil.example/steal', allowed) && isAllowedUrl('https://preview.example.is/x', allowed) && isAllowedUrl('http://127.0.0.1:9999/', allowed));
  check('qa-matrix: valueEnv tylko QA_* (FAKE_SECRET odrzucony)', (() => { try { envValueFor('FAKE_SECRET'); return false; } catch (e) { return /QA_/.test(e.message); } })());
  process.env.QA_TEST_PASSWORD = 'x';
  check('qa-matrix: valueEnv QA_* czytany', envValueFor('QA_TEST_PASSWORD') === 'x');
  delete process.env.QA_TEST_PASSWORD;
  check('qa-matrix: safeName usuwa ../ i separatory', !/[\/\\]|\.\./.test(safeName('CP1-../../../../Users/x/.claude/hooks/PWNED')) && safeName('gosc') === 'gosc');
  const cfg = { baseURL: 'http://localhost:5173', personas: [{ name: 'evil', baseURL: 'https://evil.example' }, { name: 'ss', storageState: '../../other-repo/state.json' }], viewports: [{ name: 'd', width: 800, height: 600 }], locales: ['pl-PL'], paths: [{ id: 'CP1', name: 'x', steps: [{ goto: '/' }] }] };
  const inst = expandMatrix(cfg, { repo: os.tmpdir(), baseURL: 'http://localhost:5173', only: null, persona: null, viewport: null, locale: null, allowOrigins: [] });
  check('qa-matrix: persona.baseURL na obcy host = skipped; storageState poza repo = skipped', inst.every((i) => i.status === 'skipped') && /allowlisty/.test(inst[0].reason) && /poza repo/.test(inst[1].reason), JSON.stringify(inst.map((i) => i.reason)));
  // REPO-CONTROLLED-MODULE-RCE: podstawiony node_modules/playwright w NIEZAUFANYM repo nie moze sie wykonac
  const evil = tmp('pg-evil-');
  write(path.join(evil, 'node_modules', 'playwright', 'package.json'), JSON.stringify({ name: 'playwright', main: 'index.js' }));
  write(path.join(evil, 'node_modules', 'playwright', 'index.js'), "require('fs').writeFileSync(process.env.PG_RCE_MARKER, 'pwned'); module.exports = { chromium: null };");
  process.env.PG_RCE_MARKER = path.join(evil, 'MARK');
  const pw = resolvePlaywright(evil, {});
  check('qa-matrix: playwright z runtime, node_modules obcego repo NIE wykonany (brak markera)', !fs.existsSync(path.join(evil, 'MARK')) && (!pw || typeof pw.chromium === 'object'), fs.existsSync(path.join(evil, 'MARK')) ? 'MARKER ZAPISANY = RCE' : '');
  check('trusted-roots: tmp nie jest zaufany, Desktop tak', !isTrustedDir(evil, null) && isTrustedDir(path.join(HOME, 'Desktop', 'x'), null));
  delete process.env.PG_RCE_MARKER;
  fs.rmSync(evil, { recursive: true, force: true });
}

// ---------- L4 qa-matrix: matryca (czysta) + realny przebieg na lokalnym serwerze ----------
{
  const config = { baseURL: 'http://localhost:1', personas: [{ name: 'gosc' }, { name: 'biuro', storageState: 'qa/state/brak.json' }], viewports: [{ name: 'mobile', width: 375, height: 812 }, { name: 'desktop', width: 1280, height: 800 }], locales: ['pl-PL'],
    paths: [{ id: 'CP1', name: 'home', personas: ['gosc', 'biuro'], steps: [{ goto: '/' }] }, { id: 'CP2', name: 'panel', personas: ['biuro'], steps: [{ goto: '/p' }] }] };
  const inst = expandMatrix(config, { repo: os.tmpdir(), baseURL: null, only: null, persona: null, viewport: null, locale: null, allowOrigins: [] });
  check('qa-matrix: 2 persony x 2 viewporty x 1 locale = 4 instancje', inst.length === 4, inst.map((i) => i.id).join(','));
  check('qa-matrix: biuro bez storageState = skipped z powodem', inst.filter((i) => i.persona === 'biuro').every((i) => i.status === 'skipped' && /storageState/.test(i.reason)));
  check('qa-matrix: gosc dostaje tylko CP1', inst.find((i) => i.id === 'gosc__mobile__pl-PL').paths.map((p) => p.id).join() === 'CP1');
  check('qa-matrix: --only/--persona filtruja', expandMatrix(config, { repo: os.tmpdir(), only: ['CP2'], persona: 'biuro', viewport: 'desktop', locale: null, allowOrigins: [] }).length === 1);
  const md = renderMarkdown({ startedAt: 't', out: 'o', summary: summarize([{ status: 'ran', paths: [{ status: 'failed' }, { status: 'passed' }] }]),
    instances: [{ id: 'gosc__mobile__pl-PL', persona: 'gosc', viewport: 'mobile', locale: 'pl-PL', baseURL: 'http://x', status: 'ran', paths: [{ id: 'CP1', name: 'home', status: 'failed', steps: 3, stepsDone: 1, durationMs: 5, consoleErrors: [], failedStep: { index: 2, step: 'expectText: "Witaj"', error: 'timeout', screenshot: 'o/CP1-step2-FAIL.png' } }] }] });
  check('qa-matrix: report.md ma 3-info + repro', /Co zrobilem/.test(md) && /Co sie stalo/.test(md) && /Czego oczekiwalem/.test(md) && /--only CP1 --persona gosc/.test(md));

  // realny przebieg: serwer http w procesie potomnym, 2 persony x 2 viewporty, 1 sciezka zielona + 1 czerwona
  const fixture = tmp('pg-qa-');
  const html = '<!doctype html><html><head><title>Fixture QA</title></head><body><h1>Witaj</h1><button id="b" onclick="document.getElementById(\'o\').textContent=\'Zapisano\'">Zapisz</button><p id="o"></p></body></html>';
  // Serwer w procesie potomnym (spawnSync qa-matrix blokuje petle zdarzen tego procesu); port przez plik, bo
  // spawnSync nie przyjmuje strumienia jako stdio. Czekanie synchroniczne: Atomics.wait (bez busy-loop).
  const portFile = path.join(fixture, 'port.txt');
  const serverSrc = 'const http=require("http"),fs=require("fs");const s=http.createServer((q,r)=>{r.setHeader("content-type","text/html");r.end(process.env.QA_HTML)});s.listen(0,"127.0.0.1",()=>{fs.writeFileSync(process.env.QA_PORT_FILE,String(s.address().port))});';
  const server = spawn('node', ['-e', serverSrc], { env: Object.assign({}, process.env, { QA_HTML: html, QA_PORT_FILE: portFile }), stdio: ['ignore', 'inherit', 'inherit'] });
  let port = '';
  for (let i = 0; i < 100 && !port; i++) {
    if (fs.existsSync(portFile)) port = fs.readFileSync(portFile, 'utf8').trim();
    else Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
  }
  if (!port) { console.log('skip qa-matrix real run (serwer fixture nie wystartowal w 10 s)'); server.kill(); }
  else {
    const pathsFile = path.join(fixture, 'paths.json');
    write(pathsFile, JSON.stringify({ personas: [{ name: 'gosc' }, { name: 'klient', extraHTTPHeaders: { 'x-qa': '1' } }], viewports: [{ name: 'mobile', width: 375, height: 812 }, { name: 'desktop', width: 1280, height: 800 }], locales: ['pl-PL'],
      paths: [{ id: 'CP1', name: 'klik zapisz', steps: [{ goto: '/' }, { expectTitle: 'Fixture' }, { click: { role: 'button', name: 'Zapisz' } }, { expectText: 'Zapisano' }, { expectNoConsoleErrors: true }, { screenshot: 'po' }] },
        { id: 'CP9', name: 'celowo czerwona', personas: ['gosc'], steps: [{ goto: '/' }, { expectText: 'NieMaTegoTekstu' }] }] }));
    const out = path.join(fixture, 'out');
    const r = run('qa-matrix.js', ['--repo', fixture, '--base-url', `http://127.0.0.1:${port}`, '--paths-file', pathsFile, '--out', out, '--timeout', '4000', '--json']);
    server.kill();
    if (r.status === 3) console.log('skip qa-matrix real run (brak Playwrighta): ' + (r.stderr || '').trim());
    else {
      let rep = null; try { rep = JSON.parse(r.stdout); } catch (e) { /* raport nizej */ }
      check('qa-matrix run: exit 1 (jest celowa porazka) + report.json', r.status === 1 && rep && fs.existsSync(path.join(out, 'report.json')), (r.stderr || '').slice(0, 300));
      if (rep) {
        check('qa-matrix run: 4 instancje, CP1 passed x4, CP9 failed x2 (tylko gosc)', rep.summary.instances === 4 && rep.summary.passed === 4 && rep.summary.failed === 2, JSON.stringify(rep.summary));
        const shot = rep.instances.find((i) => i.id === 'gosc__mobile__pl-PL').paths.find((p) => p.id === 'CP1').screenshots[0];
        check('qa-matrix run: screenshot po kliknieciu istnieje', shot && fs.existsSync(shot), shot);
        const fail = rep.instances.find((i) => i.id === 'gosc__desktop__pl-PL').paths.find((p) => p.id === 'CP9');
        check('qa-matrix run: porazka ma krok, blad i screenshot FAIL', fail && fail.failedStep.index === 2 && fs.existsSync(fail.failedStep.screenshot), JSON.stringify(fail && fail.failedStep));
        check('qa-matrix run: report.md z sekcja porazek', /## Porazki/.test(fs.readFileSync(path.join(out, 'report.md'), 'utf8')));
      }
    }
  }
  fs.rmSync(fixture, { recursive: true, force: true });
}

console.log(failures ? `TESTY: ${failures} FAIL` : 'TESTY: wszystkie OK');
process.exit(failures ? 1 : 0);

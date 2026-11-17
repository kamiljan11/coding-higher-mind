#!/usr/bin/env node
// Test service-role-gate: lapie przypadek blizny SERVICE-ROLE-IN-CLIENT, nie lapie poprawnego kodu serwerowego.
// Uruchom: node bin/test_service_role_gate.js   (czysta funkcja analyze + CLI w tymczasowym repo git; log bramek w tmp)
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { analyze } = require(path.join(__dirname, 'service-role-gate.js'));

const row = (file, text) => ({ file, line: 1, text });
const KEY_LINE = 'const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY);';
const hit = (file, text = KEY_LINE) => analyze([row(file, text)]).length === 1;

// Przypadek blizny: klucz w komponencie / hooku / stronie.
assert.ok(hit('src/components/AdminPanel.tsx'), 'komponent klienta');
assert.ok(hit('app/dashboard/page.tsx'), 'strona app routera');
assert.ok(hit('src/lib/supabase.ts', "const role = 'service_role';"), 'literal service_role w lib klienta');
assert.ok(hit('apps/web/src/hooks/useAdmin.ts'), 'monorepo: src/ glebiej w sciezce');
// Katalog klienta o „serwerowej" nazwie nadal jest kodem przegladarki (recenzja 2026-11-15: bramka byla tu slepa).
assert.ok(hit('src/api/client.ts'), 'src/api w aplikacji Vite');
assert.ok(hit('src/lib/supabase/admin.ts'), 'src/lib/supabase');
assert.ok(hit('src/features/jobs/Admin.tsx'), 'src/features/jobs');
assert.ok(hit('src/lib/actions/admin.ts'), 'src/lib/actions');
assert.ok(!hit('src/pages/api/admin.ts'), 'API routera pages w src/');
assert.ok(!hit('apps/web/supabase/functions/sync/index.ts'), 'funkcja edge w monorepo');
// Poprawny kod: serwer, funkcje edge, testy, pliki poza katalogami klienta, linia bez klucza.
assert.ok(!hit('app/api/admin/route.ts'), 'route handler');
assert.ok(!hit('src/server/admin.ts'), 'katalog server');
assert.ok(!hit('src/lib/admin.server.ts'), 'sufiks .server');
assert.ok(!hit('supabase/functions/sync/index.ts'), 'funkcja edge');
assert.ok(!hit('src/components/AdminPanel.test.tsx'), 'test');
assert.ok(!hit('scripts/seed.ts'), 'skrypt poza kodem klienta');
assert.ok(!hit('src/components/Login.tsx', 'const supabase = createClient(url, anonKey);'), 'klucz anon');
assert.ok(!hit('docs/SECURITY.md'), 'dokumentacja');
assert.ok(!hit('src/features/billing/api.ts', '// Zasada: admin/service_role decyduje o dostepie'), 'komentarz opisujacy regule');
assert.equal(analyze([{ file: 'src/a.ts', line: 1, text: null }]).length, 0, 'wiersz bez tresci');

// CLI: observe przepuszcza i zapisuje would_block, --enforce blokuje, czysty diff = cisza i exit 0.
const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-srg-'));
const gateLog = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pg-srg-log-')), 'gates.jsonl');
const env = Object.assign({}, process.env, { PG_GATE_LOG: gateLog });
const git = (...a) => { const r = spawnSync('git', a, { cwd: repo, encoding: 'utf8' }); if (r.status !== 0) throw new Error(`git ${a.join(' ')}: ${r.stderr}`); };
const gate = (...a) => spawnSync(process.execPath, [path.join(__dirname, 'service-role-gate.js'), ...a], { cwd: repo, encoding: 'utf8', env });
git('init', '-q', '.');
fs.mkdirSync(path.join(repo, 'src'));
fs.writeFileSync(path.join(repo, 'src', 'ok.ts'), 'export const a = 1;\n');
git('add', 'src/ok.ts');
let r = gate('--staged');
assert.equal(r.status, 0); assert.equal(r.stdout, '', 'czysty diff: bez wyjscia');
fs.writeFileSync(path.join(repo, 'src', 'client.ts'), KEY_LINE + '\n');
git('add', 'src/client.ts');
r = gate('--staged');
assert.equal(r.status, 0, 'observe: commit przechodzi'); assert.match(r.stdout, /OSTRZEZENIE.*\n {2}src\/client\.ts:1/);
const logged = fs.readFileSync(gateLog, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
assert.ok(logged.some((e) => e.event === 'would_block' && e.gate === 'SERVICE_ROLE_CLIENT'), 'would_block w logu bramek');
r = gate('--staged', '--enforce');
assert.equal(r.status, 1, '--enforce: blok'); assert.match(r.stdout, /BLOK/);
assert.equal(gate().status, 2, 'brak --staged: blad uzycia');

console.log('test_service_role_gate: OK');

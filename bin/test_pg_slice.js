// Testy pg-slice (audyt PG 2026-10-06 #2): wycinki diffu per rola po sciezkach.
// Uruchom: node test_pg_slice.js  (0 sieci, 0 modeli; fixture w os.tmpdir(), kasowany)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { rolesForFile, splitDiff, sliceDiff, run, ROLES } = require(path.join(__dirname, 'pg-slice.js'));

let failures = 0;
const check = (name, cond, detail) => { if (cond) console.log('ok  ', name); else { failures++; console.log('FAIL', name, detail || ''); } };

const block = (file, body) => `diff --git a/${file} b/${file}\nindex 1111111..2222222 100644\n--- a/${file}\n+++ b/${file}\n@@ -1,1 +1,2 @@\n ${body}\n+${body} 2\n`;
const newFile = (file, body) => `diff --git a/${file} b/${file}\nnew file mode 100644\nindex 0000000..3333333\n--- /dev/null\n+++ b/${file}\n@@ -0,0 +1,1 @@\n+${body}\n`;
const deleted = (file) => `diff --git a/${file} b/${file}\ndeleted file mode 100644\nindex 4444444..0000000\n--- a/${file}\n+++ /dev/null\n@@ -1,1 +0,0 @@\n-gone\n`;

// ---------- rolesForFile ----------
const has = (f, role, text) => rolesForFile(f, text || '').includes(role);
check('ux: .tsx', has('src/components/radar/List.tsx', 'ux'));
check('ux: .css w app', has('src/app/(app)/radar/radar.css', 'ux'));
check('qa: app/ i components/', has('src/app/(app)/radar/page.tsx', 'qa') && has('src/components/x/Y.tsx', 'qa'));
check('qa: lib NIE', !has('src/lib/radar/score.ts', 'qa'));
check('data: .sql + supabase', has('supabase/migrations/001_x.sql', 'data') && has('supabase/seed.sql', 'data'));
check('data: server/', has('src/server/radar/archive.ts', 'data'));
check('data: lib z zapytaniami (tresc)', has('src/lib/tasks/rows.ts', 'data', '+ const r = await supabase.from("tasks").select("id")'));
check('data: lib bez zapytan NIE', !has('src/lib/dates/deadline.ts', 'data', '+ export const x = 1'));
check('security: actions.ts, route.ts, middleware, migracje, .env', ['src/app/x/actions.ts', 'src/app/api/y/route.ts', 'src/middleware.ts', 'supabase/migrations/2_rls.sql', '.env.local'].every((f) => has(f, 'security')));
check('security: zwykly komponent NIE', !has('src/components/Badge.tsx', 'security'));
check('ops: scripts, .github, RUNBOOK, Dockerfile, package.json', ['scripts/seed.sh', '.github/workflows/ci.yml', 'docs/RUNBOOK.md', 'Dockerfile', 'package.json'].every((f) => has(f, 'ops')));
check('product: docs, README, CHANGELOG, .env.example, route', ['docs/adr/0001.md', 'README.md', 'CHANGELOG.md', '.env.example', 'src/app/api/y/route.ts'].every((f) => has(f, 'product')));
check('code: kod tak, docs NIE', has('src/lib/dates/deadline.ts', 'code') && !has('docs/adr/0001.md', 'code') && !has('README.md', 'code'));
check('plik bez roli -> code (tsconfig, .gitignore)', rolesForFile('tsconfig.json').join() === 'code' && rolesForFile('.gitignore').join() === 'code', rolesForFile('tsconfig.json').join());
check('sciezka Windows normalizowana', has('src\\components\\X.tsx', 'ux'));

// ---------- splitDiff / sliceDiff ----------
const full = 'preambula (np. naglowek gh pr diff)\n'
  + block('src/app/(app)/radar/page.tsx', 'export default function Page() {}')
  + newFile('supabase/migrations/20261006_x.sql', 'create table t (id int);')
  + block('docs/adr/0002.md', '# ADR')
  + deleted('src/lib/old.ts')
  + block('src/lib/dates/deadline.ts', 'export const d = 1;')
  + newFile('weird.lock', 'x');
const blocks = splitDiff(full);
check('splitDiff: 6 blokow, preambula pominieta', blocks.length === 6 && blocks.every((b) => b.text.startsWith('diff --git ')), blocks.map((b) => b.file).join());
check('splitDiff: plik usuniety ma sciezke a/', blocks[3].file === 'src/lib/old.ts', blocks[3].file);
check('splitDiff: bloki skladaja sie z powrotem w diff (bez preambuly), bajt w bajt', blocks.map((b) => b.text).join('') === full.slice(full.indexOf('diff --git')));
const { slices } = sliceDiff(full);
const covered = new Set(Object.values(slices).flatMap((s) => s.files));
check('kazdy plik w >= 1 wycinku (nic nie wypada)', blocks.every((b) => covered.has(b.file)), [...covered].join());
check('wycinek ux = tylko page.tsx', slices.ux.files.join() === 'src/app/(app)/radar/page.tsx', slices.ux.files.join());
check('wycinek data = migracja', slices.data.files.includes('supabase/migrations/20261006_x.sql') && !slices.data.files.includes('src/lib/dates/deadline.ts'));
check('wycinek product = ADR (docs)', slices.product.files.includes('docs/adr/0002.md'));
check('wycinek code bez docs, z nieznanym plikiem', !slices.code.files.includes('docs/adr/0002.md') && slices.code.files.includes('weird.lock') && slices.code.files.includes('src/lib/old.ts'));
check('wycinek zachowuje naglowki diff --git i hunki', slices.data.text.startsWith('diff --git a/supabase/migrations/20261006_x.sql') && slices.data.text.includes('+create table t'));

// Forma z `git diff` (core.quotePath): nie-ASCII w cudzyslowach jako \ooo, spacja = TAB po nazwie w ---/+++.
const quoted = 'diff --git "a/docs/\\305\\274a/plik z spacj\\304\\205.md" "b/docs/\\305\\274a/plik z spacj\\304\\205.md"\nnew file mode 100644\n'
  + 'index 0000000..7898192\n--- /dev/null\n+++ "b/docs/\\305\\274a/plik z spacj\\304\\205.md"\t\n@@ -0,0 +1 @@\n+a\n'
  + 'diff --git a/src x.ts b/src x.ts\nnew file mode 100644\nindex 0000000..6178079\n--- /dev/null\n+++ b/src x.ts\t\n@@ -0,0 +1 @@\n+b\n';
const qFiles = splitDiff(quoted).map((b) => b.file);
check('splitDiff: sciezka w cudzyslowach gita (\\ooo) -> UTF-8, TAB po nazwie ze spacja odciety', qFiles.join('|') === 'docs/ża/plik z spacją.md|src x.ts', JSON.stringify(qFiles));
check('sciezka w cudzyslowach trafia do wlasciwej roli (docs -> product, nie code)', rolesForFile(qFiles[0], '').join() === 'product', rolesForFile(qFiles[0], '').join());

// ---------- CLI run(): pliki, slice.json, sha pelnego diffu ----------
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-slice-'));
try {
  fs.writeFileSync(path.join(dir, 'diff.patch'), full);
  const out = execFileSync(process.execPath, [path.join(__dirname, 'pg-slice.js'), '--run', dir], { encoding: 'utf8' });
  check('CLI: tabela rozmiarow na stdout', /pelny diff\.patch: 6 plikow/.test(out) && /^ux\s+1\s/m.test(out), out);
  check('CLI: diff.<rola>.patch dla kazdej roli (takze pusty)', ROLES.every((r) => fs.existsSync(path.join(dir, `diff.${r}.patch`))));
  const summary = JSON.parse(fs.readFileSync(path.join(dir, 'slice.json'), 'utf8'));
  const sha = crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, 'diff.patch'))).digest('hex');
  check('slice.json: diff_sha256 = sha PELNEGO diff.patch (dowod pg-merge-dowod bez zmian)', summary.diff_sha256 === sha);
  check('slice.json: diff.patch nietkniety', fs.readFileSync(path.join(dir, 'diff.patch'), 'utf8') === full);
  check('slice.json: sha wycinka = sha pliku wycinka', summary.roles.ux.sha256 === crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, 'diff.ux.patch'))).digest('hex'));
  check('run(): zwraca to samo co slice.json', run(dir).roles.data.file_count === summary.roles.data.file_count);
  let usage = 0;
  try { execFileSync(process.execPath, [path.join(__dirname, 'pg-slice.js'), '--run', path.join(dir, 'brak')], { stdio: 'pipe' }); } catch (e) { usage = e.status; }
  check('CLI: brak diff.patch => exit 2', usage === 2, String(usage));
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} FAIL` : '\nwszystkie OK');
process.exit(failures ? 1 : 0);

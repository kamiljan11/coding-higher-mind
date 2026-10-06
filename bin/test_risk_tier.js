// Testy risk-tier: model data-reviewera warunkowo (audyt PG 2026-10-06 #9) + CLI bez --lines.
// Uruchom: node test_risk_tier.js  (0 sieci, 0 modeli)
'use strict';
const path = require('path');
const { execFileSync } = require('child_process');
const RT = path.join(__dirname, '..', 'hooks', 'lib', 'risk-tier.js');
const { modelFor, isDataHeavy, classify } = require(RT);

let failures = 0;
const check = (name, cond, detail) => { if (cond) console.log('ok  ', name); else { failures++; console.log('FAIL', name, detail || ''); } };

const root = '/repo';
const abs = (...fs) => fs.map((f) => `${root}/${f}`);

// ---------- modelFor ----------
check('T3 security = opus zawsze (z plikami i bez)', modelFor('security-reviewer', 'T3') === 'opus' && modelFor('security-reviewer', 'T3', abs('src/a.ts'), root) === 'opus');
check('T3 code/ops/ux/qa = sonnet', ['code-reviewer', 'ops-reviewer', 'ux-reviewer', 'qa-reviewer'].every((r) => modelFor(r, 'T3', abs('supabase/migrations/1.sql'), root) === 'sonnet'));
check('T3 data BEZ listy plikow = opus (zgodnosc wstecz: stop-gate)', modelFor('data-reviewer', 'T3') === 'opus');
check('T3 data, diff bez SQL (r27: src/server/*.ts) = sonnet', modelFor('data-reviewer', 'T3', abs('src/server/radar/archive.ts', 'src/app/x/page.tsx'), root) === 'sonnet');
check('T3 data, diff z .sql = opus', modelFor('data-reviewer', 'T3', abs('src/server/a.ts', 'supabase/seed.sql'), root) === 'opus');
check('T3 data, supabase/migrations = opus', modelFor('data-reviewer', 'T3', abs('supabase/migrations/20261006_x.sql'), root) === 'opus');
check('T3 data, db/migrations/*.ts = opus', modelFor('data-reviewer', 'T3', abs('db/migrations/0001_init.ts'), root) === 'opus');
check('T3 data, polityki RLS (policies/, rls.ts) = opus', modelFor('data-reviewer', 'T3', abs('src/server/policies/notes.ts'), root) === 'opus' && modelFor('data-reviewer', 'T3', abs('src/lib/rls.ts'), root) === 'opus');
check('T3 data, pusta lista plikow = sonnet (nic bazodanowego)', modelFor('data-reviewer', 'T3', [], root) === 'sonnet');
check('T2 data = sonnet nawet z .sql (tier < T3)', modelFor('data-reviewer', 'T2', abs('x.sql'), root) === 'sonnet');
check('isDataHeavy: sciezka Windows', isDataHeavy(['C:\\repo\\supabase\\migrations\\1.sql'], 'C:\\repo'));
check('isDataHeavy: "policy" w nazwie komponentu nie myli sie z polityka? (PrivacyPolicy.tsx = nie)', !isDataHeavy(abs('src/components/PrivacyPolicyLink.tsx'), root));

// ---------- CLI: models w tier.json ----------
const cli = (args) => JSON.parse(execFileSync(process.execPath, [RT, ...args], { encoding: 'utf8' }));
const noSql = cli([root, ...abs('src/server/radar/archive.ts', 'src/lib/db/x.ts'), '--lines', '900']);
check('CLI: T3 bez SQL -> data sonnet, security opus', noSql.tier === 'T3' && noSql.models['data-reviewer'] === 'sonnet' && noSql.models['security-reviewer'] === 'opus', JSON.stringify(noSql.models));
const withSql = cli([root, ...abs('supabase/migrations/1.sql'), '--lines', '10']);
check('CLI: migracja -> data opus', withSql.models['data-reviewer'] === 'opus', JSON.stringify(withSql.models));
const noLines = cli([root, ...abs('supabase/migrations/1.sql')]);
check('CLI bez --lines: root nie wypada z argumentow (T3 z migracji)', noLines.tier === 'T3' && noLines.models['data-reviewer'] === 'opus', JSON.stringify(noLines));
check('classify bez zmian: migracja => T3 + data', classify(abs('supabase/migrations/1.sql'), 5, root).reviewers.includes('data-reviewer'));

console.log(failures ? `\n${failures} FAIL` : '\nwszystkie OK');
process.exit(failures ? 1 : 0);

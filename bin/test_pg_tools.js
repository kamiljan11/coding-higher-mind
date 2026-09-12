// Testy narzedzi PG v3 (2026-09-05): risk-tier (router), pg-aggregate (k-of-n, odrzucanie bez dowodu, verdicts),
// repo-readiness R8 (.env.example: puste wartosci LF/CRLF = czyste, realny sekret w tej samej linii = wyciek).
// Uruchom: node test_pg_tools.js  (0 sieci, 0 modeli; fixture'y w %TEMP%, kasowane przez fs.rmSync)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOME = os.homedir();
const { classify, modelFor } = require(path.join(HOME, '.claude', 'hooks', 'lib', 'risk-tier.js'));
const { aggregate } = require(path.join(HOME, '.claude', 'bin', 'pg-aggregate.js'));

let failures = 0;
const check = (name, cond, detail) => { if (cond) console.log('ok  ', name); else { failures++; console.log('FAIL', name, detail || ''); } };

// ---------- risk-tier ----------
const root = 'C:/repo';
const t0 = classify([root + '/README.md', root + '/src/styles.css'], 5, root);
check('tier: docs+css => T0, brak recenzentow', t0.tier === 'T0' && t0.reviewers.length === 0, JSON.stringify(t0));
const t1 = classify([root + '/src/components/Badge.tsx'], 20, root);
check('tier: komponent => T1 + code-reviewer + ux', t1.tier === 'T1' && t1.reviewers.includes('code-reviewer') && t1.reviewers.includes('ux-reviewer'), JSON.stringify(t1));
const t2 = classify([root + '/src/lib/price.ts'], 40, root);
check('tier: lib => T2 + ops', t2.tier === 'T2' && t2.reviewers.includes('ops-reviewer'), JSON.stringify(t2));
const t2lines = classify([root + '/src/components/Big.tsx'], 200, root);
check('tier: >150 linii => T2', t2lines.tier === 'T2', JSON.stringify(t2lines));
const t3 = classify([root + '/supabase/migrations/001.sql'], 10, root);
check('tier: migracja => T3 + security + data', t3.tier === 'T3' && t3.reviewers.includes('security-reviewer') && t3.reviewers.includes('data-reviewer'), JSON.stringify(t3));
check('tier: T3 security = opus, code = sonnet', modelFor('security-reviewer', 'T3') === 'opus' && modelFor('code-reviewer', 'T3') === 'sonnet');
const t3pay = classify([root + '/src/features/billing/charge.ts'], 10, root);
check('tier: billing => T3', t3pay.tier === 'T3', JSON.stringify(t3pay));
// .env: szablon bez wartosci (basename konczy sie na .example/.sample/.template/.dist, takze .env.local.example) = NIE T3;
// prawdziwy plik sekretow = T3; nieznana kolejnosc sufiksow (.env.example.local) = strona bezpieczna (T3).
const envTier = (name) => classify([root + '/' + name], 3, root).tier;
for (const name of ['.env.example', '.env.sample', '.env.template', '.env.dist', '.env.local.example', 'apps/web/.env.example']) {
  check(`tier: ${name} to szablon, NIE T3`, envTier(name) !== 'T3', envTier(name));
}
for (const name of ['.env', '.env.local', '.env.production', '.env.development.local', '.env.find-part.local', '.env.example.local', 'example/.env']) {
  check(`tier: ${name} => T3`, envTier(name) === 'T3', envTier(name));
}
check('tier: .env.local.example ze sciezka Windows, NIE T3', classify(['C:\\repo\\.env.local.example'], 3, 'C:\\repo').tier !== 'T3');
check('tier: .env.production ze sciezka Windows => T3', classify(['C:\\repo\\.env.production'], 3, 'C:\\repo').tier === 'T3');
// tier_floor z CLAUDE.md
const floorRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-floor-'));
fs.writeFileSync(path.join(floorRepo, 'CLAUDE.md'), '# x\n- `pg.tier_floor: T2`\n');
const tf = classify([path.join(floorRepo, 'src/components/A.tsx')], 5, floorRepo);
check('tier_floor: CLAUDE.md T2 podnosi komponent do T2', tf.tier === 'T2', JSON.stringify(tf));
fs.rmSync(floorRepo, { recursive: true, force: true });

// ---------- pg-aggregate ----------
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-agg-'));
const finding = (over) => Object.assign({ file: 'src/a.ts', line_range: [10, 12], rule_id: 'SILENT-CATCH', severity: 'major', claim: 'catch polyka', evidence: 'rg -> 11: catch (e) {}', repro_cmd: 'rg -n "catch" src/a.ts', confidence: 0.8 }, over);
fs.writeFileSync(path.join(dir, 'findings.code.json'), JSON.stringify({ role: 'code', findings: [
  finding(),                                                     // zgodne z security (dedupe +-3)
  finding({ file: 'src/b.ts', rule_id: 'GOD-FUNCTION', line_range: [1, 90], severity: 'minor' }), // samotne -> note
  finding({ file: 'src/c.ts', rule_id: 'NO-EVIDENCE', evidence: '' }),                            // bez dowodu -> odrzucone
  finding({ file: 'src/d.ts', rule_id: 'BAD-SEV', severity: 'critical' }),                        // zla severity -> odrzucone
], questions: ['q1'] }));
fs.writeFileSync(path.join(dir, 'findings.security.json'), JSON.stringify({ role: 'security', findings: [
  finding({ line_range: [12, 14], severity: 'blocker' }),        // ten sam SILENT-CATCH, wyzsza severity
  finding({ file: 'src/e.ts', rule_id: 'TOCTOU', severity: 'blocker' }), // samotny blocker -> needs_verification
] }));
const r1 = aggregate(dir, null);
const silent = r1.findings.find((g) => g.rule_id === 'SILENT-CATCH');
check('aggregate: dedupe code+security => agreement 2', silent && silent.agreement === 2, JSON.stringify(silent && silent.roles));
check('aggregate: severity = MAX (blocker)', silent && silent.severity === 'blocker');
check('aggregate: agreement 2 + blocker => decision blocker', silent && silent.decision === 'blocker');
check('aggregate: samotny minor => note', r1.findings.find((g) => g.rule_id === 'GOD-FUNCTION').decision === 'note');
check('aggregate: bez evidence => odrzucone', r1.rejected.some((x) => x.why.includes('evidence')));
check('aggregate: zla severity => odrzucone', r1.rejected.some((x) => x.why.includes('critical')));
check('aggregate: samotny blocker => needs_verification', r1.needs_verification.includes('security-2'));
check('aggregate: pytania zebrane z rola', r1.questions[0] === '[code] q1');
check('aggregate: werdykt REQUEST CHANGES', r1.verdict === 'REQUEST CHANGES');
// verdicts: weryfikator obala TOCTOU, potwierdza nic nowego
fs.writeFileSync(path.join(dir, 'verdicts.json'), JSON.stringify({ role: 'verifier', verdicts: [
  { finding_id: 'security-2', verdict: 'not_reproduced', severity_after: 'minor', reason: 'jest FOR UPDATE' },
  { finding_id: 'code-2', verdict: 'reproduced', severity_after: 'minor', reason: '91 linii' },
] }));
const r2 = aggregate(dir, path.join(dir, 'verdicts.json'));
check('verdicts: not_reproduced => dropped', r2.findings.find((g) => g.rule_id === 'TOCTOU').decision === 'dropped');
check('verdicts: reproduced samotny => must_fix', r2.findings.find((g) => g.rule_id === 'GOD-FUNCTION').decision === 'must_fix');
check('verdicts: weryfikator nie podnosi severity', r2.findings.find((g) => g.rule_id === 'GOD-FUNCTION').severity === 'minor');
// pusty katalog / brak plikow
const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-agg-empty-'));
const r3 = aggregate(empty, null);
check('aggregate: brak findings => APPROVE', r3.verdict === 'APPROVE' && r3.findings.length === 0);
fs.rmSync(dir, { recursive: true, force: true });
fs.rmSync(empty, { recursive: true, force: true });


// ---------- repo-readiness R8 (.env.example) ----------
// Regresja 2026-09-05: stary regex `/=\s*[A-Za-z0-9_-]{16,}/` przechodzil przez koniec linii i bral NAZWE nastepnej
// zmiennej za wyciek (calculator-app: "=\nSUPABASE_PUBLISHABLE_KEY" -> R8 2/5 na czystym szablonie; to samo z CRLF).
// Scorer to CLI (nie modul), wiec kazdy przypadek = fixture w %TEMP% + `node repo-readiness.js --repo <dir> --json`.
const { execFileSync } = require('child_process');
const READINESS = path.join(HOME, '.claude', 'bin', 'repo-readiness.js');
const r8 = (envExample) => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-r8-'));
  try {
    fs.writeFileSync(path.join(fixture, '.env.example'), envExample);
    const report = JSON.parse(execFileSync('node', [READINESS, '--repo', fixture, '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 60000 }));
    return report.results.find((r) => r.id === 'R8');
  } finally { fs.rmSync(fixture, { recursive: true, force: true }); }
};
const r8Clean = (name, envExample) => { const r = r8(envExample); check(`R8 czyste: ${name}`, r && r.points === 5, JSON.stringify(r)); };
const r8Leak = (name, envExample) => { const r = r8(envExample); check(`R8 wyciek: ${name}`, r && r.points === 2 && /realna wartosc/.test(r.why), JSON.stringify(r)); };
r8Clean('puste wartosci LF, dlugie nazwy obok siebie (calculator-app)', 'SUPABASE_PROJECT_ID=\nSUPABASE_PUBLISHABLE_KEY=\nSUPABASE_URL=\n\nVITE_SUPABASE_PROJECT_ID=\nVITE_SUPABASE_PUBLISHABLE_KEY=\nVITE_SUPABASE_URL=\n');
r8Clean('puste wartosci CRLF (rental-site)', 'FOO=\r\nBAR_BAZ_QUX_LONG_NAME=\r\nNEXT_PUBLIC_SUPABASE_ANON_KEY=\r\n');
r8Clean('komentarze + placeholdery', '# klucz z dashboardu\nAPI_KEY=your_api_key_here_replace_me_now\nTOKEN=<your-token-goes-here-xxxxxxxx>\nPASSWORD=changeme_changeme_changeme_changeme\n');
r8Leak('JWT w tej samej linii', 'SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSJ9.abc\n');  // gitleaks:allow (fikstura testu skanera, nie sekret)
r8Leak('sk_live_ w tej samej linii', 'STRIPE_KEY=sk_live_4eC39HqLyjWDarjtT1zdp7dc\n');
r8Leak('hex 40 w tej samej linii', 'SECRET=3f786850e387550fdab836ed7e6dc881de23001b\n');
r8Leak('CRLF nie ukrywa JWT miedzy pustymi', 'FOO=\r\nSUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSJ9.abc\r\nBAR=\r\n');  // gitleaks:allow (fikstura testu skanera, nie sekret)
// Luki z weryfikacji peer-sesji 2026-09-06 (false negatives w tym samym bloku R8):
r8Leak('export KEY=sekret (dotenv-style)', 'export STRIPE_KEY=sk_live_4eC39HqLyjWDarjtT1zdp7dc\n');
r8Leak('mala litera w nazwie zmiennej', 'api_key=sk_live_4eC39HqLyjWDarjtT1zdp7dc\n');
r8Leak('sk- (OpenAI/Anthropic) z cyframi — przyklad akceptacyjny z taska', 'API_KEY=sk-abc123def456ghi789\n');
r8Clean('sk- placeholder bez cyfr', 'OPENAI_API_KEY=sk-proj-xxxxxxxxxxxxxxxxxxxx\n');
r8Clean('export + pusta wartosc', 'export API_KEY=\nexport DB_URL=\n');

// ---------- repo-readiness R7 (LICENSE + pg.ownership) — 2026-09-12 ----------
const r7 = (files) => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-r7-'));
  try {
    for (const [rel, content] of Object.entries(files)) fs.writeFileSync(path.join(fixture, rel), content);
    const report = JSON.parse(execFileSync('node', [READINESS, '--repo', fixture, '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 60000 }));
    return report.results.find((r) => r.id === 'R7');
  } finally { fs.rmSync(fixture, { recursive: true, force: true }); }
};
check('R7: LICENSE PG + pg.ownership mas-saas = 5/5', r7({ LICENSE: 'Copyright (c) 2026 the company. All rights reserved.', 'CLAUDE.md': '- `pg.ownership: mas-saas`' }).points === 5);
check('R7: LICENSE PG + client-transferred = niespojne (3/5)', (() => { const r = r7({ LICENSE: 'Copyright the company. All rights reserved.', 'CLAUDE.md': '- `pg.ownership: client-transferred`' }); return r.points === 3 && /niespojne/.test(r.why); })());
check('R7: LICENSE klienta + client-transferred = 5/5', r7({ LICENSE: 'Copyright (c) 2026 Example Client Ltd. All rights reserved.', 'CLAUDE.md': '- `pg.ownership: client-transferred`' }).points === 5);
check('R7: MIT + oss = 5/5; MIT + mas-saas = niespojne', r7({ LICENSE: 'MIT License\nCopyright (c) 2026 <owner>', 'CLAUDE.md': '- `pg.ownership: oss`' }).points === 5 && r7({ LICENSE: 'MIT License', 'CLAUDE.md': '- `pg.ownership: mas-saas`' }).points === 3);
check('R7: brak pg.ownership = 3/5 z powodem', (() => { const r = r7({ LICENSE: 'All rights reserved the company' }); return r.points === 3 && /pg\.ownership/.test(r.why); })());
check('R7: brak LICENSE = 0', r7({ 'CLAUDE.md': '- `pg.ownership: mas-saas`' }).points === 0);

console.log(failures ? `TESTY: ${failures} FAIL` : 'TESTY: wszystkie OK');
process.exit(failures ? 1 : 0);

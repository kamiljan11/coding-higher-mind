#!/usr/bin/env node
'use strict';
// test_deploy_probe.js — testy templates/repo/.github/scripts/deploy-probe.mjs (bramki deploy-gate.yml). Zero zaleznosci.
// Pokrywa: allowliste hostow (sekret obejscia nie moze wyciec), konfiguracje (placeholdery blokuja), plan zdarzen (walidacja
// payloadu), progi PREVIEW/BAKE vs WATCH (seria ostatnich rund), decyzje rollbacku, 401/403/429/3xx = bramka niesprawna, hit() na lokalnym serwerze HTTP
// (ponowienie, contains, maxMs, timeout, naglowek bypass), CLI fail-closed i exit-kody.
const { spawnSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');

const SCRIPT = path.join(__dirname, '..', 'templates', 'repo', '.github', 'scripts', 'deploy-probe.mjs');
const CONFIG = path.join(__dirname, '..', 'templates', 'repo', '.github', 'deploy', 'probes.json');
let failures = 0;
function ok(desc, cond, detail) {
  if (cond) console.log(`PASS: ${desc}`);
  else { console.log(`FAIL: ${desc}${detail ? ' — ' + detail : ''}`); failures++; }
}
const throws = (fn) => { try { fn(); return null; } catch (e) { return e.message; } };
const SHA = 'a'.repeat(40);
const CFG_TEXT = JSON.stringify({
  allowedHosts: ['radar-*-acme-team.vercel.app', 'radar.example.pl'],
  probes: [{ name: 'home', path: '/' }, { name: 'health', path: '/api/health', contains: '"ok"' }],
});

(async () => {
  const P = await import(SCRIPT);
  const ALLOW = ['radar-*-acme-team.vercel.app', 'radar.example.pl'];

  // --- allowlista ---
  ok('host projektu z hashem -> origin https', P.allowedBase('radar-6vd6bhoqt-acme-team.vercel.app', ALLOW) === 'https://radar-6vd6bhoqt-acme-team.vercel.app');
  ok('domena produkcji dokladnie', P.allowedBase('https://radar.example.pl/', ALLOW) === 'https://radar.example.pl');
  ok('obcy zespol o slugu x-acme-team -> odmowa', /spoza allowedHosts/.test(throws(() => P.allowedBase('radar-abc-x-acme-team.vercel.app', ALLOW)) || ''));
  ok('obcy projekt na vercel.app -> odmowa', /spoza allowedHosts/.test(throws(() => P.allowedBase('evil-abc-hacker.vercel.app', ALLOW)) || ''));
  ok('subdomena podszywajaca sie (radar.example.pl.evil.com) -> odmowa', /spoza/.test(throws(() => P.allowedBase('radar.example.pl.evil.com', ALLOW)) || ''));
  ok('samo *.vercel.app w konfiguracji -> nic nie przechodzi', /spoza/.test(throws(() => P.allowedBase('a-b-c.vercel.app', ['*.vercel.app'])) || ''));
  ok('http:// -> odmowa (sekret tylko po https)', /tylko https/.test(throws(() => P.allowedBase('http://radar.example.pl', ALLOW)) || ''));

  // --- konfiguracja ---
  ok('szablon probes.json z placeholderami -> blad (wymusza setup)', /placeholdery/.test(throws(() => P.loadConfig(fs.readFileSync(CONFIG, 'utf8'))) || ''));
  const cfg = P.loadConfig(CFG_TEXT);
  ok('uzupelniona konfiguracja: progi domyslne + watch', cfg.thresholds.maxFailureRate === 0 && cfg.thresholds.retries === 1 && cfg.watch.failingStreak === 3);
  ok('sonda bez / na poczatku sciezki -> blad', /zla sonda/.test(throws(() => P.loadConfig('{"probes":[{"name":"x","path":"api"}]}')) || ''));
  ok('pusta lista sond -> blad', /pusta/.test(throws(() => P.loadConfig('{"probes":[]}')) || ''));
  ok('literowka typu (expect: 200, maxMs: "x", dependency: "tak") -> blad konfiguracji, nie awaria produkcji (code r5)',
    ['{"probes":[{"name":"x","path":"/"}],"thresholds":{"failingStreak":1}}', '{"probes":[{"name":"x","path":"/"}],"watch":{"timeoutMs":5}}', '{"probes":[{"name":"x","path":"/"}],"thresholds":{"timeoutMs":0}}', '{"probes":[{"name":"x","path":"/"}],"watch":{"failingStreak":0}}', '{"probes":[{"name":"x","path":"/"}],"thresholds":{"maxFailureRate":2}}', '{"probes":[{"name":"x","path":"/"}],"watch":{"failingStrek":3}}', '{"probes":[{"name":"x","path":"/","expect":200}]}', '{"probes":[{"name":"x","path":"/","maxMs":"x"}]}', '{"probes":[{"name":"x","path":"/","dependency":"tak"}]}', '{"probes":[{"name":"x","path":"/"}],"watch":{"failingStreak":"3"}}'].every((t) => /zly (typ|prog)/.test(throws(() => P.loadConfig(t)) || '')));

  ok('jsonMatches: rowne pola, zagniezdzenie, typy', P.jsonMatches('{"ok":true,"db":{"x":1},"extra":2}', { ok: true, db: { x: 1 } }) && !P.jsonMatches('{"ok":"true"}', { ok: true }) && !P.jsonMatches('nie-json', { ok: true }) && !P.jsonMatches('{"ok":false}', { ok: true }));

  // --- plan zdarzen ---
  const base = { EVENT: 'repository_dispatch', P_SHA: SHA, PROD_URL: 'radar.example.pl', HEAD_SHA: SHA };
  const plan = (e) => P.planFromEvent(Object.assign({}, base, e), cfg);
  ok('success + preview -> preview, url z allowlisty', plan({ ACTION: 'vercel.deployment.success', P_ENV: 'preview', P_URL: 'radar-abc123-acme-team.vercel.app' }).stage === 'preview');
  ok('ready + production -> bake', plan({ ACTION: 'vercel.deployment.ready', P_ENV: 'Production', P_URL: 'radar-abc123-acme-team.vercel.app' }).stage === 'bake');
  const w = plan({ ACTION: 'vercel.deployment.promoted', P_ENV: 'production', P_URL: 'evil.example.com' });
  ok('promoted -> watch ZAWSZE na PROD_URL (url z payloadu ignorowany)', w.stage === 'watch' && w.url === 'https://radar.example.pl', JSON.stringify(w));
  ok('success + production -> skip (to nie podglad)', plan({ ACTION: 'vercel.deployment.success', P_ENV: 'production', P_URL: 'x' }).stage === 'skip');
  ok('ignored podgladu -> preview-none', plan({ ACTION: 'vercel.deployment.ignored', P_ENV: 'preview' }).stage === 'preview-none');
  ok('canceled podgladu -> skip (NIE zielony status bez sond)', plan({ ACTION: 'vercel.deployment.canceled', P_ENV: 'preview' }).stage === 'skip');
  let loaded = 0;
  const lazy = () => { loaded++; throw new Error('allowedHosts ma placeholdery'); };
  ok('zdarzenia bez sond nie laduja konfiguracji (placeholdery nie daja issue na kazde zdarzenie)', P.planFromEvent(Object.assign({}, base, { ACTION: 'vercel.deployment.success', P_ENV: 'production' }), lazy).stage === 'skip' && P.planFromEvent(Object.assign({}, base, { ACTION: 'vercel.deployment.ignored', P_ENV: 'preview' }), lazy).stage === 'preview-none' && loaded === 0);
  ok('zdarzenie z sondami przy placeholderach -> blad setupu', /placeholdery/.test(throws(() => P.planFromEvent(Object.assign({}, base, { ACTION: 'vercel.deployment.ready', P_ENV: 'production', P_URL: 'x.pl' }), lazy)) || ''));
  ok('failed podgladu -> preview-failed', plan({ ACTION: 'vercel.deployment.failed', P_ENV: 'preview' }).stage === 'preview-failed');
  ok('podrobiony url spoza allowlisty -> blad planu', /spoza allowedHosts/.test(throws(() => plan({ ACTION: 'vercel.deployment.ready', P_ENV: 'production', P_URL: 'attacker.example.com' })) || ''));
  ok('zly sha -> blad planu', /zly sha/.test(throws(() => plan({ ACTION: 'vercel.deployment.ready', P_ENV: 'production', P_URL: 'radar.example.pl', P_SHA: 'main; rm -rf /' })) || ''));
  ok('watch bez PROD_URL -> blad setupu', /PROD_URL/.test(throws(() => plan({ ACTION: 'vercel.deployment.promoted', P_ENV: 'production', PROD_URL: '' })) || ''));
  ok('workflow_dispatch watch ignoruje url z wejscia', P.planFromEvent({ EVENT: 'workflow_dispatch', I_STAGE: 'watch', I_URL: 'radar-zly1-acme-team.vercel.app', HEAD_SHA: SHA, PROD_URL: 'radar.example.pl' }, cfg).url === 'https://radar.example.pl');
  ok('ref z payloadu oczyszczony', plan({ ACTION: 'vercel.deployment.success', P_ENV: 'preview', P_URL: 'radar-abc123-acme-team.vercel.app', P_REF: 'feat/x$(id)' }).ref === 'feat/xid');
  ok('BAKE/PREVIEW z domena produkcji jako celem -> odmowa (tylko hosty wdrozen; security r5)', /spoza allowedHosts/.test(throws(() => plan({ ACTION: 'vercel.deployment.ready', P_ENV: 'production', P_URL: 'radar.example.pl' })) || ''));
  ok('P_ENV/ACTION z \\n i :: oczyszczone (bez komend workflow w logu)', !/::|\n/.test(plan({ ACTION: 'vercel.deployment.ready', P_ENV: 'staging\n::warning::x' }).note));

  // --- progi ---
  const R = (n, f) => Array.from({ length: n }, () => [f()]);
  const good = () => ({ name: 'a', status: 200, ms: 100, ok: true });
  const bad = () => ({ name: 'b', status: 502, ms: 50, ok: false, blocked: false, why: 'status 502' });
  const blk = () => ({ name: 'c', status: 403, ms: 50, ok: false, blocked: true, why: 'status 403' });
  ok('BAKE: wszystko OK -> 0', P.summarize(R(20, good), cfg, 'bake').verdict === 0);
  ok('BAKE: jeden 5xx -> 1 (zero tolerancji)', P.summarize(R(20, good).concat([[bad()]]), cfg, 'bake').verdict === 1);
  const blip = P.summarize(R(5, good).concat([[bad()]]), cfg, 'watch');
  ok('WATCH: 1 czerwona runda na koncu (< seria 3) -> 0, bez rollbacku', blip.verdict === 0 && /przejsciowe/.test(blip.notes.join()), JSON.stringify(blip));
  const outage = P.summarize(R(10, good).concat(R(3, bad)), cfg, 'watch');
  ok('WATCH: ostatnie 3 rundy z rzedu czerwone -> 1 (rollback)', outage.verdict === 1 && outage.failingTail === 3, JSON.stringify(outage.reasons));
  const recovered = P.summarize(R(6, bad).concat(R(24, good)), cfg, 'watch');
  ok('WATCH: awaria na poczatku okna, potem zdrowo -> 0 (nie cofa zdrowego buildu)', recovered.verdict === 0 && recovered.failedRounds === 6, JSON.stringify(recovered));
  const flapping = P.summarize([[bad()], [good()], [bad()], [good()], [bad()], [bad()]], cfg, 'watch');
  ok('WATCH: przeplot bledow, seria 2 < 3 -> 0', flapping.verdict === 0 && flapping.failingTail === 2);
  const slow = P.summarize(R(28, good).concat(R(3, () => ({ name: 'a', status: 200, ms: 2500, ok: true }))), cfg, 'watch');
  ok('WATCH: samo p95 (wolne 200) -> 0 + notatka, bez rollbacku', slow.verdict === 0 && /p95/.test(slow.notes.join()), JSON.stringify(slow));
  ok('failingTail: liczy tylko koncowa serie, pomija nie-regresje', P.failingTail([[bad()], [good()], [bad()], [bad()]]) === 2 && P.failingTail([[bad()], [blk()]]) === 0);

  // --- weryfikacja wdrozenia (API Vercela) i polityka bypassu ---
  const fakeFetch = (body, status = 200) => async () => ({ ok: status === 200, status, json: async () => body });
  const VC = { token: 't', projectId: 'prj_1', teamId: 'team_1' };
  const BU = 'https://radar-abc1-acme-team.vercel.app';
  ok('verifyDeployment: projekt i zespol zgodne -> ok', (await P.verifyDeployment(BU, VC, fakeFetch({ projectId: 'prj_1', ownerId: 'team_1' }))).ok === true);
  const VB = Object.assign({ sha: SHA, stage: 'bake' }, VC);
  const prodDep = { projectId: 'prj_1', ownerId: 'team_1', target: 'production', meta: { githubCommitSha: SHA } };
  ok('verifyDeployment BAKE: produkcja z tym commitem -> ok', (await P.verifyDeployment(BU, VB, fakeFetch(prodDep))).ok === true);
  const pvAsBake = await P.verifyDeployment(BU, VB, fakeFetch(Object.assign({}, prodDep, { target: null })));
  ok('verifyDeployment BAKE: URL podgladu podany jako produkcja -> mismatch (security r3 F1)', pvAsBake.mismatch === true && /nie jest buildem produkcji/.test(pvAsBake.why));
  const otherSha = await P.verifyDeployment(BU, VB, fakeFetch(Object.assign({}, prodDep, { meta: { githubCommitSha: 'c'.repeat(40) } })));
  ok('verifyDeployment BAKE: inny commit niz w planie -> mismatch', otherSha.mismatch === true && /z commita/.test(otherSha.why));
  ok('verifyDeployment: sha z CLI (meta.gitCommitSha) tez rozpoznany', (await P.verifyDeployment(BU, VB, fakeFetch(Object.assign({}, prodDep, { meta: { gitCommitSha: SHA } })))).ok === true);
  ok('verifyDeployment PREVIEW: produkcja podana jako podglad -> mismatch', (await P.verifyDeployment(BU, Object.assign({}, VB, { stage: 'preview' }), fakeFetch(prodDep))).mismatch === true);
  const squat = await P.verifyDeployment(BU, VC, fakeFetch({ projectId: 'prj_OBCY', ownerId: 'team_OBCY' }));
  ok('verifyDeployment: obcy projekt o pasujacej nazwie -> mismatch (bez bypassu, exit 2)', !squat.ok && squat.mismatch === true, JSON.stringify(squat));
  let calls = 0;
  const flakyApi = async () => { calls++; return calls < 3 ? { ok: false, status: 503, json: async () => ({}) } : { ok: true, status: 200, json: async () => prodDep }; };
  ok('verifyDeployment: 503, 503, 200 -> ok po ponowieniu (ops r6)', (await P.verifyDeployment(BU, Object.assign({ retryDelayMs: 1 }, VB), flakyApi)).ok === true && calls === 3);
  let c2 = 0; const always503 = async () => { c2++; return { ok: false, status: 503, json: async () => ({}) }; };
  ok('verifyDeployment: 3x503 -> nie ok po 3 probach', (await P.verifyDeployment(BU, Object.assign({ retryDelayMs: 1 }, VB), always503)).ok === false && c2 === 3);
  let c3 = 0; const nf = async () => { c3++; return { ok: false, status: 404, json: async () => ({}) }; };
  ok('verifyDeployment: 4xx bez ponawiania (1 proba)', (await P.verifyDeployment(BU, Object.assign({ retryDelayMs: 1 }, VB), nf)).ok === false && c3 === 1);
  let c4 = 0; const rl = async () => { c4++; return c4 < 2 ? { ok: false, status: 429, json: async () => ({}) } : { ok: true, status: 200, json: async () => prodDep }; };
  ok('verifyDeployment: 429 ponawiany', (await P.verifyDeployment(BU, Object.assign({ retryDelayMs: 1 }, VB), rl)).ok === true && c4 === 2);
  ok('verifyDeployment: 404 z API -> nie ok (bez bypassu)', (await P.verifyDeployment(BU, VC, fakeFetch({}, 404))).ok === false);
  ok('verifyDeployment: brak tokenu/vars -> nie ok, bez zapytania', (await P.verifyDeployment(BU, { token: '' }, () => { throw new Error('nie powinno wolac'); })).ok === false);
  const E = (o) => Object.assign({ VERCEL_AUTOMATION_BYPASS_SECRET: 's' }, o);
  ok('bypassAllowed: preview NIGDY (kod galezi PR nie widzi sekretu, takze z tego repo — security r4 F1)', P.bypassAllowed('preview', E({ PREVIEW_TRUSTED: 'true' })) === false);
  ok('bypassAllowed: bake -> tak; watch -> tak', P.bypassAllowed('bake', E({})) && P.bypassAllowed('watch', E({})));
  const prot = P.summarize([[{ name: 'a', status: 401, ms: 50, ok: false, blocked: true, why: 'status 401' }]], cfg, 'preview');
  ok('PREVIEW chroniony (401 bez sekretu) -> 0 z notatka „BAKE sprawdzi", nie blokuje merge', prot.verdict === 0 && /BAKE sprawdzi/.test(prot.notes.join()), JSON.stringify(prot));
  const T = (l) => P.pickRollbackTarget(l, SHA);
  ok('pickRollbackTarget: pomija build wycofany wczesniej przez WATCH (pg/watch=failure; ops r5)', JSON.stringify(T(`d_cur ${SHA} success brak\nd_B ${'b'.repeat(40)} success failure\nd_A ${'d'.repeat(40)} success success`)) === JSON.stringify({ uid: 'd_A', sha: 'd'.repeat(40) }));
  ok('pickRollbackTarget: pierwszy z zielonym pg/bake i innym commitem; pomija biezacy, failure, brak', JSON.stringify(T(`d_cur ${SHA} success\nd_bad ${'b'.repeat(40)} failure\nd_none ${'c'.repeat(40)} brak\nd_ok ${'d'.repeat(40)} success\nd_old ${'e'.repeat(40)} success`)) === JSON.stringify({ uid: 'd_ok', sha: 'd'.repeat(40) }) && T('d_cur ' + SHA + ' success') === null && T('') === null);
  ok('bypassAllowed: brak sekretu -> nie', P.bypassAllowed('bake', {}) === false);

  // --- zaleznosci, wylacznik, harmonogram (ops-review r3) ---
  const depBad = () => ({ name: 'db', status: 200, ms: 50, ok: false, blocked: false, dependency: true, why: 'JSON != {"ok":true}' });
  const dep = P.summarize(R(10, good).concat(R(3, depBad)), cfg, 'watch');
  ok('WATCH: seria bledow sondy zaleznosci (baza) -> 2 (alarm), NIE rollback', dep.verdict === 2 && /zaleznosc/.test(dep.reasons.join()), JSON.stringify(dep));
  const both = P.summarize(R(2, good).concat(Array.from({ length: 3 }, () => [bad(), depBad()])), cfg, 'watch');
  ok('WATCH: baza padla i strona tez 5xx -> 2 (zaleznosc ma pierwszenstwo), NIE rollback (data-review r4)', both.verdict === 2, JSON.stringify(both.reasons));
  ok('failingTail app pomija sondy zaleznosci', P.failingTail([[depBad()], [depBad()]]) === 0 && P.failingTail([[depBad()], [depBad()]], 'dep') === 2);
  loaded = 0;
  const off = (e) => P.planFromEvent(Object.assign({}, base, { GATE_MODE: 'off' }, e), lazy);
  ok('PG_DEPLOY_GATE=off: bake -> off-bake bez ladowania konfiguracji; watch -> skip', off({ ACTION: 'vercel.deployment.ready', P_ENV: 'production', P_URL: 'x' }).stage === 'off-bake' && off({ ACTION: 'vercel.deployment.promoted', P_ENV: 'production' }).stage === 'skip' && loaded === 0);
  ok('schedule -> skip (deadman ma osobny job)', P.planFromEvent({ EVENT: 'schedule' }, lazy).stage === 'skip');

  // --- petla rund (runRounds) z wstrzyknietym zegarem (code r5) ---
  const clock = () => { let t = 0; return { now: () => t, sleep: async (ms) => { t += ms; } }; };
  const seq = (arr) => { let i = 0; return async () => arr[Math.min(i++, arr.length - 1)]; };
  const RG = [good()]; const RB = [bad()]; const RD = [depBad()];
  let c1 = clock();
  let rr = await P.runRounds({ stage: 'watch', cfg, duration: 900, interval: 30, probeRound: seq([RG, RG, RB, RB, RB, RG]), ...c1 });
  ok('runRounds WATCH: wczesne wyjscie po serii 3 (nie czeka 15 min)', rr.length === 5 && c1.now() === 4 * 30000, `${rr.length} ${c1.now()}`);
  c1 = clock();
  rr = await P.runRounds({ stage: 'watch', cfg, duration: 60, interval: 30, probeRound: seq([RG, RG, RB, RB, RG]), ...c1 });
  ok('runRounds WATCH: koniec okna w srodku serii -> przedluza do wyniku', rr.length === 5, `${rr.length}`);
  c1 = clock();
  rr = await P.runRounds({ stage: 'watch', cfg, duration: 900, interval: 30, probeRound: seq([RG, RD, RD, RD]), ...c1 });
  ok('runRounds WATCH: seria zaleznosci tez konczy wczesnie', rr.length === 4);
  c1 = clock();
  rr = await P.runRounds({ stage: 'bake', cfg, duration: 600, interval: 30, probeRound: seq([RG, RB, RG]), ...c1 });
  ok('runRounds BAKE: pierwsza czerwona runda konczy (zero tolerancji)', rr.length === 2);
  c1 = clock();
  rr = await P.runRounds({ stage: 'bake', cfg, duration: 90, interval: 30, probeRound: seq([RG]), ...c1 });
  ok('runRounds BAKE zielony: pelne okno 90 s co 30 s = 4 rundy (t=0,30,60,90)', rr.length === 4, `${rr.length}`);
  rr = await P.runRounds({ stage: 'preview', cfg, duration: 0, interval: 30, probeRound: seq([RB]), ...clock() });
  ok('runRounds PREVIEW: 1 runda', rr.length === 1);

  // --- decyzja o rollbacku ---
  const D = (o) => P.rollbackDecision(Object.assign({ openRollbackIssues: 0, hasSecrets: true, prevSha: SHA, changedFiles: 'src/app/page.tsx', liveSha: SHA, sha: SHA }, o));
  ok('docsOnly: md/txt/docs -> tak; .mdx, kod, pusta lista -> nie (code-review r4)', P.docsOnly('README.md\ndocs/x.md\ndocs/img/a.png') && !P.docsOnly('docs/x.mdx') && !P.docsOnly('README.md\nsrc/a.ts') && !P.docsOnly(''));
  const NOW = Date.parse('2026-10-11T12:00:00Z');
  const stuck = P.stuckDeployments(`${'a'.repeat(40)} 2026-10-11T11:00:00Z pending success\n${'b'.repeat(40)} 2026-10-11T11:00:00Z success success\n${'c'.repeat(40)} 2026-10-11T11:50:00Z brak success\n${'d'.repeat(40)} 2026-10-11T02:00:00Z brak success\n${'f'.repeat(40)} 2026-10-11T11:00:00Z brak failure\nsmieci`, NOW);
  ok('stuckDeployments: tylko 30 min - 6 h bez koncowego statusu; nieudany build (deployment failure) to nie deadman', stuck.length === 1 && stuck[0].startsWith('a'.repeat(40)), JSON.stringify(stuck));
  ok('rollbackDecision: zwykla zmiana -> rollback', D({}) === 'rollback');
  ok('rollbackDecision: null/false/"0x0"/"-0" -> guard (tylko doslowne "0")', [null, false, '0x0', '-0', ' '].every((v) => D({ openRollbackIssues: v }) === 'guard') && D({ openRollbackIssues: 0 }) === 'rollback');
  ok('rollbackDecision: otwarte issue deploy-rollback -> guard (bez lancucha)', D({ openRollbackIssues: 1 }) === 'guard');
  ok('rollbackDecision: brak sekretow -> nosetup', D({ hasSecrets: false }) === 'nosetup');
  ok('rollbackDecision: brak poprzedniego wdrozenia -> norange', D({ prevSha: '' }) === 'norange' && D({ changedFiles: null }) === 'norange');
  ok('rollbackDecision: migracje w zakresie -> migrations (stary kod na nowym schemacie)', D({ changedFiles: 'src/a.ts\nsupabase/migrations/20261011_x.sql' }) === 'migrations' && D({ changedFiles: 'prisma/migrations/1/migration.sql' }) === 'migrations');
  ok('rollbackDecision: PG_AUTO_ROLLBACK=off -> disabled (przed wszystkim)', D({ disabled: true, openRollbackIssues: 0 }) === 'disabled');
  ok('rollbackDecision: na produkcji inny (nowszy) build -> stale; nieznany (blad API) -> norange, bez rollbacku', D({ liveSha: 'b'.repeat(40), sha: SHA }) === 'stale' && D({ liveSha: SHA, sha: SHA }) === 'rollback' && D({ liveSha: '', sha: SHA }) === 'norange');
  ok('rollbackDecision: zmiany edge functions w zakresie -> backend', D({ changedFiles: 'supabase/functions/notify/index.ts' }) === 'backend');
  ok('rollbackDecision: plik z "migrations" w nazwie poza katalogiem -> rollback', D({ changedFiles: 'docs/migrations-guide.md' }) === 'rollback');
  ok('rollbackDecision: monorepo / src / dowolny .sql / sciezka cytowana przez gita -> migrations (data-review r3)',
    ['prisma/schema.prisma', 'src/migration/1-init.ts', 'db/migrate/20261011_add.rb', 'apps/web/supabase/migrations/1.sql', 'src/db/migrations/0001_init.ts', 'db/seed.sql', '"supabase/migrations/2026_za\\305\\274.sql"', 'packages/db/drizzle/0001.sql'].every((f) => D({ changedFiles: f }) === 'migrations'));
  ok('wiekszosc 401/403/429 -> 2 (bramka niesprawna, nie regresja)', P.summarize(R(2, good).concat(R(3, blk)), cfg, 'watch').verdict === 2);
  const cOk = () => ({ name: 'c', status: 200, ms: 100, ok: true });
  ok('pojedynczy 429 w calym oknie -> 0 z notatka (ops r5)', P.summarize(Array.from({ length: 20 }, () => [good(), cOk()]).concat([[good(), blk()]]), cfg, 'bake').verdict === 0);
  const dead = P.summarize(Array.from({ length: 20 }, () => [good(), blk()]), cfg, 'bake');
  ok('sonda zablokowana w KAZDEJ rundzie (health zawsze 401) -> 2, nie zielone (ops r6)', dead.verdict === 2 && /nigdy nie sprawdzily/.test(dead.reasons.join()), JSON.stringify(dead.reasons));
  ok('zero pomiarow -> 2 (nie zielone z braku danych)', P.summarize([], cfg, 'bake').verdict === 2);
  ok('p95 ponad prog -> 1', P.summarize(R(20, () => ({ name: 'a', status: 200, ms: 5000, ok: true })), cfg, 'bake').verdict === 1);
  const pv = P.summarize([[{ name: 'a', status: 200, ms: 2300, ok: true }, { name: 'b', status: 200, ms: 120, ok: true }]], cfg, 'preview');
  ok('PREVIEW: 1 runda, wolny zimny start pod maxMs sondy -> 0 (p95 z 2 probek tylko notatka)', pv.verdict === 0 && /tylko 2 probek/.test(pv.notes.join()), JSON.stringify(pv));

  // --- hit() na lokalnym serwerze ---
  let flaky = 0; let seenBypass = null;
  const srv = http.createServer((req, res) => {
    if (req.url === '/flaky') { flaky++; res.writeHead(flaky === 1 ? 503 : 200); return res.end('ok'); }
    if (req.url === '/health') { seenBypass = req.headers['x-vercel-protection-bypass'] || null; res.writeHead(200); return res.end('{"ok":true}'); }
    if (req.url === '/nocontent') { res.writeHead(200); return res.end('{"status":"degraded"}'); }
    if (req.url === '/dbdown') { res.writeHead(200); return res.end('{"ok":false,"db":"down"}'); }
    if (req.url === '/waf') { res.writeHead(403); return res.end('blocked'); }
    if (req.url === '/slow') { return setTimeout(() => { res.writeHead(200); res.end('x'); }, 400); }
    if (req.url === '/redirect') { res.writeHead(301, { location: 'https://evil.example.com/' }); return res.end(); }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const B = `http://127.0.0.1:${srv.address().port}`;
  const opts = { timeoutMs: 200, retries: 1, retryDelayMs: 10 };
  const pr = (p, extra) => Object.assign({ name: p, path: p, expect: [200], contains: null, maxMs: null }, extra || {});
  try {
    let h = await P.hit(B, pr('/flaky'), opts, {});
    ok('hit: 503 a potem 200 -> OK po ponowieniu (zimny start)', h.ok && h.attempts === 2, JSON.stringify(h));
    h = await P.hit(B, pr('/health', { contains: '"ok"' }), opts, { 'x-vercel-protection-bypass': 'S3CR3T' });
    ok('hit: contains spelnione + naglowek bypass doszedl', h.ok && seenBypass === 'S3CR3T', JSON.stringify(h));
    h = await P.hit(B, pr('/health', { json: { ok: true } }), opts, {});
    ok('hit: json {ok:true} spelnione', h.ok, JSON.stringify(h));
    h = await P.hit(B, pr('/dbdown', { json: { ok: true, db: 'ok' } }), opts, {});
    ok('hit: 200 z {"ok":false,"db":"down"} przy asercji json -> blad (podciag by przepuscil)', !h.ok && /JSON !=/.test(h.why), JSON.stringify(h));
    h = await P.hit(B, pr('/nocontent', { contains: '"ok"' }), opts, {});
    ok('hit: 200 bez wymaganego tekstu -> blad', !h.ok && /brak tekstu/.test(h.why));
    h = await P.hit(B, pr('/waf'), opts, {});
    ok('hit: 403 -> blocked (bez ponowienia)', !h.ok && h.blocked && h.attempts === 1, JSON.stringify(h));
    h = await P.hit(B, pr('/slow'), opts, {});
    ok('hit: timeout po ponowieniu -> blad timeout', !h.ok && /timeout/.test(h.why) && h.attempts === 2, JSON.stringify(h));
    h = await P.hit(B, pr('/redirect'), opts, {});
    ok('hit: przekierowanie NIE jest sledzone (sekret nie leci dalej) i jest nie-regresja (blocked)', !h.ok && h.status === 301 && h.blocked && /kanoniczna/.test(h.why), JSON.stringify(h));
  } finally { srv.close(); }

  // --- CLI ---
  const tmpCfg = path.join(require('os').tmpdir(), `pg-probe-cfg-${process.pid}.json`);
  fs.writeFileSync(tmpCfg, CFG_TEXT);
  try {
    let r = spawnSync(process.execPath, [SCRIPT, '--base', 'evil-abc-hacker.vercel.app', '--config', tmpCfg], { encoding: 'utf8', env: Object.assign({}, process.env, { VERCEL_AUTOMATION_BYPASS_SECRET: 'x' }) });
    ok('CLI: host spoza allowlisty -> exit 2 bez zadan', r.status === 2 && /spoza allowedHosts/.test(r.stderr), `exit=${r.status} ${r.stderr}`);
    r = spawnSync(process.execPath, [SCRIPT, '--config', tmpCfg], { encoding: 'utf8' });
    ok('CLI: brak --base -> exit 2', r.status === 2);
    r = spawnSync(process.execPath, [SCRIPT, '--base', 'radar.example.pl', '--config', CONFIG], { encoding: 'utf8' });
    ok('CLI: szablon z placeholderami -> exit 2 (bramka niesprawna, nie rollback)', r.status === 2 && /placeholdery/.test(r.stderr), r.stderr);
    r = spawnSync(process.execPath, [SCRIPT, '--plan', '--config', tmpCfg], { encoding: 'utf8', env: Object.assign({}, process.env, { GITHUB_OUTPUT: '', EVENT: 'repository_dispatch', ACTION: 'vercel.deployment.ready', P_ENV: 'production', P_URL: 'radar-abc1-acme-team.vercel.app', P_SHA: SHA }) });
    const dec = (e) => spawnSync(process.execPath, [SCRIPT, '--decide-rollback'], { encoding: 'utf8', env: Object.assign({}, process.env, { GITHUB_OUTPUT: '', LIVE_SHA: SHA, SHA }, e) }).stdout;
    ok('CLI --decide-rollback: brak / pusty / nienumeryczny OPEN_ROLLBACK -> guard (fail-closed; code r7)',
      [{}, { OPEN_ROLLBACK: '' }, { OPEN_ROLLBACK: 'HTTP 502: Bad Gateway' }].every((o) => {
        const env = Object.assign({ HAS_SECRETS: 'true', PREV_SHA: SHA, CHANGED_OK: 'true', CHANGED: 'src/a.ts' }, o);
        const e2 = Object.assign({}, process.env, { GITHUB_OUTPUT: '', LIVE_SHA: SHA, SHA }, env);
        if (!('OPEN_ROLLBACK' in o)) delete e2.OPEN_ROLLBACK;
        return /rollback-decision: guard/.test(spawnSync(process.execPath, [SCRIPT, '--decide-rollback'], { encoding: 'utf8', env: e2 }).stdout);
      }));
    ok('rollbackDecision: OPEN_ROLLBACK dokladnie 0 -> dalej (rollback), cokolwiek innego -> guard', D({ openRollbackIssues: '0' }) === 'rollback' && D({ openRollbackIssues: 'abc' }) === 'guard' && D({ openRollbackIssues: undefined }) === 'guard');
    ok('CLI --decide-rollback: nieznany sha na produkcji (blad API) -> norange', /rollback-decision: norange/.test(dec({ LIVE_SHA: '', OPEN_ROLLBACK: '0', HAS_SECRETS: 'true', PREV_SHA: SHA, CHANGED_OK: 'true', CHANGED: 'src/a.ts' })));
    const dm = spawnSync(process.execPath, [SCRIPT, '--deadman'], { encoding: 'utf8', input: `${'e'.repeat(40)} ${new Date(Date.now() - 3600e3).toISOString()} pending success\n` });
    const pk = spawnSync(process.execPath, [SCRIPT, '--pick-target'], { encoding: 'utf8', input: `u1 ${SHA} success\nu2 ${'d'.repeat(40)} success\n`, env: Object.assign({}, process.env, { SHA }) });
    ok('CLI --pick-target: wypisuje „uid sha" celu', pk.status === 0 && pk.stdout.trim() === `u2 ${'d'.repeat(40)}`, pk.stdout);
    const docs = (files) => spawnSync(process.execPath, [SCRIPT, '--docs-only'], { encoding: 'utf8', input: files }).status;
    ok('CLI --deadman i --docs-only: okablowanie stdin/exit', dm.status === 0 && dm.stdout.includes('e'.repeat(40)) && docs('README.md\n') === 0 && docs('src/a.ts\n') === 1);
    ok('CLI --decide-rollback: migracje w zakresie -> migrations; czysto -> rollback; blad diffu -> norange',
      /rollback-decision: migrations/.test(dec({ OPEN_ROLLBACK: '0', HAS_SECRETS: 'true', PREV_SHA: SHA, CHANGED_OK: 'true', CHANGED: 'src/a.ts\nsupabase/migrations/1.sql' }))
      && /rollback-decision: rollback/.test(dec({ OPEN_ROLLBACK: '0', HAS_SECRETS: 'true', PREV_SHA: SHA, CHANGED_OK: 'true', CHANGED: 'src/a.ts' }))
      && /rollback-decision: norange/.test(dec({ OPEN_ROLLBACK: '0', HAS_SECRETS: 'true', PREV_SHA: SHA, CHANGED_OK: 'false' }))
      && /rollback-decision: guard/.test(dec({ OPEN_ROLLBACK: '2', HAS_SECRETS: 'true', PREV_SHA: SHA, CHANGED_OK: 'true', CHANGED: '' })));
    ok('CLI --plan: wypisuje stage=bake i url', r.status === 0 && /stage=bake/.test(r.stdout) && /url=https:\/\/radar-abc1/.test(r.stdout), r.stdout + r.stderr);
  } finally { fs.rmSync(tmpCfg, { force: true }); }

  console.log(failures ? `TESTY: ${failures} FAIL` : 'TESTY: wszystkie OK');
  process.exit(failures ? 1 : 0);
})();

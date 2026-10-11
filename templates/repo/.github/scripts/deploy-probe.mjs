#!/usr/bin/env node
// deploy-probe — plan i sondy bramek deploy-gate.yml (podglad, bake przed promocja, obserwacja po). Zero zaleznosci (Node 20+).
// ZAWSZE uruchamiany z checkoutu GALEZI DOMYSLNEJ (nie z commita z payloadu): allowlista hostow i progi pochodza z zaufanego
// drzewa (security-review 2026-10-11: z drzewa atakujacego allowlista nic nie chronila). Konfiguracja = DANE w .github/deploy/probes.json.
//
//   --plan                 zdarzenie (env z workflow) -> etap; walidacja sha/url/hosta; zapis do GITHUB_OUTPUT. Exit 0 / 2 (setup).
//   --base <url> [--stage preview|bake|watch] [--duration s] [--interval s] [--json plik]
//                          sondy. Exit 0 progi trzymane · 1 PRZEKROCZONE (regresja: blokada / rollback) ·
//                          2 bramka niesprawna (konfiguracja, host spoza allowlisty, siec/WAF 401/403/429) — NIGDY powod rollbacku.
import { readFileSync, writeFileSync, appendFileSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const EXIT = { OK: 0, BREACH: 1, BROKEN: 2 };
const BLOCKED_STATUS = new Set([401, 403, 407, 429]);
const P95_MIN_SAMPLES = 20;

function args(argv) {
  const o = { config: '.github/deploy/probes.json', duration: 0, interval: 30, json: null, base: null, stage: 'bake', plan: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = () => { const x = argv[++i]; if (x === undefined) throw new Error(`${a} wymaga wartosci`); return x; };
    if (a === '--base') o.base = v();
    else if (a === '--config') o.config = v();
    else if (a === '--duration') o.duration = Number(v());
    else if (a === '--interval') o.interval = Number(v());
    else if (a === '--json') o.json = v();
    else if (a === '--stage') o.stage = v();
    else if (a === '--plan') o.plan = true;
    else if (a === '--decide-rollback') o.decide = true;
    else if (a === '--docs-only') o.docsOnly = true;
    else if (a === '--deadman') o.deadman = true;
    else if (a === '--pick-target') o.pick = true;
    else throw new Error(`nieznana opcja ${a}`);
  }
  if (!o.plan && !o.decide && !o.docsOnly && !o.deadman && !o.pick && !o.base) throw new Error('brak --base');
  if (!['preview', 'bake', 'watch'].includes(o.stage)) throw new Error(`zly --stage ${o.stage}`);
  if (!Number.isFinite(o.duration) || o.duration < 0 || !Number.isFinite(o.interval) || o.interval <= 0) throw new Error('zle --duration/--interval');
  return o;
}

// Host spoza allowlisty = odmowa ZANIM poleci naglowek z sekretem obejscia ochrony. Wzorzec: dokladny host albo `*` = [a-z0-9]+
// (hash wdrozenia Vercela; z myslnikami przeszedlby obcy zespol o slugu `x-moj-zespol`); samo `*.vercel.app` odrzucane.
export function allowedBase(raw, patterns) {
  const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  if (url.protocol !== 'https:') throw new Error(`tylko https: ${url.origin}`);
  const host = url.hostname.toLowerCase();
  const ok = (patterns || []).some((p) => {
    const q = String(p).toLowerCase();
    if (/^\*\./.test(q)) return false;
    const rx = new RegExp('^' + q.split('*').map((x) => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[a-z0-9]+') + '$');
    return rx.test(host);
  });
  if (!ok) throw new Error(`host ${host} spoza allowedHosts w konfiguracji`);
  return url.origin;
}

export function loadConfig(text) {
  const c = JSON.parse(text);
  if (!Array.isArray(c.probes) || !c.probes.length) throw new Error('probes: pusta lista');
  for (const p of c.probes) {
    if (!p.name || typeof p.path !== 'string' || !p.path.startsWith('/')) throw new Error(`zla sonda: ${JSON.stringify(p).slice(0, 120)}`);
  }
  // Typy pol sprawdzane TU: literowka (np. expect: 200) dawala wyjatek w hit() liczony jako awaria produkcji -> rollback (code-review r5).
  for (const p of c.probes) {
    const bad = (p.expect !== undefined && (!Array.isArray(p.expect) || !p.expect.length || !p.expect.every((n) => Number.isInteger(n))))
      || (p.contains !== undefined && p.contains !== null && typeof p.contains !== 'string')
      || (p.json !== undefined && p.json !== null && (typeof p.json !== 'object' || Array.isArray(p.json)))
      || (p.maxMs !== undefined && p.maxMs !== null && !(Number(p.maxMs) > 0))
      || (p.dependency !== undefined && typeof p.dependency !== 'boolean');
    if (bad) throw new Error(`zly typ pola w sondzie ${JSON.stringify(p).slice(0, 120)} (expect: [liczby], contains: tekst, json: obiekt, maxMs: liczba, dependency: true/false)`);
  }
  // Zakresy progow (code r6: timeoutMs 0 = kazda sonda timeout -> rollback zdrowej produkcji; failingStreak 0 = alarm przy kazdym WATCH)
  const RANGES = { thresholds: { maxFailureRate: [0, 1, false], maxP95Ms: [1, Infinity, false], timeoutMs: [1, 120000, false], retries: [0, 5, true] }, watch: { failingStreak: [1, 20, true] } };
  // Klucz sprawdzany w SWOJEJ sekcji: failingStreak w thresholds bylby po cichu ignorowany (ops r7)
  for (const [k, v, sec] of [...Object.entries(c.thresholds || {}).map(([a, b]) => [a, b, 'thresholds']), ...Object.entries(c.watch || {}).map(([a, b]) => [a, b, 'watch'])]) {
    const r = RANGES[sec][k];
    if (!r || typeof v !== 'number' || v < r[0] || v > r[1] || (r[2] && !Number.isInteger(v))) throw new Error(`zly prog ${sec}.${k}: ${JSON.stringify(v)}${r ? ` (zakres ${r[0]}..${r[1]}${r[2] ? ', calkowita' : ''})` : ` (nieznany klucz w sekcji ${sec})`}`);
  }
  if ((c.allowedHosts || []).some((h) => /twoja-domena|NAZWA-PROJEKTU|TWOJ-ZESPOL/i.test(h))) throw new Error('allowedHosts ma placeholdery z szablonu — uzupelnij (RUNBOOK › Pipeline wdrozenia)');
  const t = c.thresholds || {};
  const w = c.watch || {};
  return {
    allowedHosts: c.allowedHosts || [],
    // dependency: sonda zaleznosci (baza, zewnetrzne API) — jej awaria NIE jest powodem rollbacku (stary build tez jej nie naprawi).
    probes: c.probes.map((p) => ({ name: p.name, path: p.path, expect: p.expect || [200], contains: p.contains || null, json: p.json || null, maxMs: p.maxMs || null, dependency: p.dependency === true })),
    thresholds: { maxFailureRate: t.maxFailureRate ?? 0, maxP95Ms: t.maxP95Ms ?? 2000, timeoutMs: t.timeoutMs ?? 10000, retries: t.retries ?? 1 },
    // WATCH decyduje o rollbacku produkcji: liczy sie stan TERAZ — N OSTATNICH rund z rzedu czerwonych (ops-review r2: agregat okna
    // cofal zdrowy build po przejsciowej awarii). N=3 przy 30 s = rundy t=0/30/60 s, czyli ~1 min do rollbacku, z wczesnym wyjsciem z petli.
    watch: { failingStreak: w.failingStreak ?? 3 },
  };
}

// Asercja JSON: kazde pole z `expected` musi byc ROWNE w odpowiedzi (`{"ok":true}`); podciag `"ok"` przepuszczal `{"ok":false}`
// (data-review 2026-10-11). Zagniezdzone obiekty porownywane rekurencyjnie, nieparsowalna odpowiedz = blad.
export function jsonMatches(body, expected) {
  let got;
  try { got = JSON.parse(body); } catch (e) { return false; }
  const eq = (a, b) => (b !== null && typeof b === 'object' ? a !== null && typeof a === 'object' && Object.keys(b).every((k) => eq(a[k], b[k])) : a === b);
  return eq(got, expected);
}

// Jedna sonda z ponowieniem (zimny start, chwilowy blad sieci). Nie-regresja (blocked): 401/403/407/429 = siec/WAF/ochrona,
// 3xx = przekierowanie (np. apex -> www: PROD_URL nie jest kanoniczna domena) — bramka niesprawna, nigdy powod rollbacku.
export async function hit(base, probe, opts, headers) {
  let last = null;
  for (let attempt = 0; attempt <= (opts.retries ?? 0); attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, opts.retryDelayMs ?? 2000));
    const started = Date.now();
    try {
      const res = await fetch(base + probe.path, { headers, redirect: 'manual', signal: AbortSignal.timeout(opts.timeoutMs) });
      const body = probe.contains || probe.json ? await res.text() : (await res.arrayBuffer(), '');
      const ms = Date.now() - started;
      const redirect = res.status >= 300 && res.status < 400;
      const blocked = (BLOCKED_STATUS.has(res.status) || redirect) && !probe.expect.includes(res.status);
      const why = blocked ? (redirect ? `status ${res.status} -> ${res.headers.get('location') || '?'} (przekierowanie: ustaw kanoniczna domene — nie regresja)` : `status ${res.status} (siec/WAF/ochrona — nie regresja)`)
        : !probe.expect.includes(res.status) ? `status ${res.status}`
          : probe.contains && !body.includes(probe.contains) ? `brak tekstu „${probe.contains}"`
            : probe.json && !jsonMatches(body, probe.json) ? `JSON != ${JSON.stringify(probe.json)}`
            : probe.maxMs && ms > probe.maxMs ? `${ms} ms > ${probe.maxMs}` : null;
      last = { name: probe.name, status: res.status, ms, ok: !why, blocked, dependency: probe.dependency === true, why, attempts: attempt + 1 };
      if (last.ok || blocked) return last;
    } catch (e) {
      last = { name: probe.name, status: 0, ms: Date.now() - started, ok: false, blocked: false, dependency: probe.dependency === true, why: e.name === 'TimeoutError' ? `timeout ${opts.timeoutMs} ms` : e.message, attempts: attempt + 1 };
    }
  }
  return last;
}

// Ile OSTATNICH rund z rzedu ma prawdziwy blad (nie-regresje pomijamy) — stan „teraz" dla WATCH.
// kind: 'app' = sondy aplikacji (powod rollbacku), 'dep' = sondy zaleznosci (alarm, nie rollback).
export function failingTail(rounds, kind = 'app') {
  const isFail = (r) => !r.ok && !r.blocked && (kind === 'dep' ? r.dependency === true : r.dependency !== true);
  let n = 0;
  for (let i = rounds.length - 1; i >= 0 && rounds[i].some(isFail); i--) n++;
  return n;
}

// rounds = tablica rund (runda = wyniki wszystkich sond). BAKE/PREVIEW: zero tolerancji (po ponowieniu) + p95.
// WATCH: rollback tylko gdy ostatnie `failingStreak` rund z rzedu sa czerwone; reszta = notatki.
export function summarize(rounds, cfg, stage) {
  const results = rounds.flat();
  const lat = results.map((r) => r.ms).sort((a, b) => a - b);
  const p95 = lat.length ? lat[Math.min(lat.length - 1, Math.ceil(lat.length * 0.95) - 1)] : 0;
  const failed = results.filter((r) => !r.ok);
  const blocked = failed.filter((r) => r.blocked);
  const real = failed.length - blocked.length;
  const failedRounds = rounds.filter((rd) => rd.some((r) => !r.ok && !r.blocked)).length;
  const tail = failingTail(rounds);
  const reasons = [];
  const notes = [];
  let verdict = EXIT.OK;
  // Sonda zablokowana we WSZYSTKICH rundach (np. health zawsze 401) nigdy nie sprawdzila celu — w BAKE/WATCH to bramka niesprawna,
  // nie „reszta OK" (ops r6). PREVIEW: caly chroniony podglad to osobny przypadek nizej.
  const names = [...new Set(results.map((r) => r.name))];
  const deadProbes = names.filter((n) => results.filter((r) => r.name === n).every((r) => r.blocked));
  if (!results.length) { reasons.push('zero pomiarow'); verdict = EXIT.BROKEN; }
  else if (stage !== 'preview' && deadProbes.length && !real) { reasons.push(`sonda(y) ${deadProbes.join(', ')} zablokowane w kazdej rundzie (401/403/429/3xx) — nigdy nie sprawdzily celu`); verdict = EXIT.BROKEN; }
  else if (blocked.length && !real && blocked.length * 2 <= results.length) notes.push(`${blocked.length}/${results.length} zadan nie-regresji (pojedyncze 401/403/429/3xx) — reszta OK`); // ops r5: jeden 429 nie psuje bramki
  else if (blocked.length && !real && stage === 'preview') notes.push(`${blocked.length} zadan zablokowanych (podglad chroniony, bez sekretu dla kodu PR) — sondy niemozliwe; BAKE sprawdzi build produkcji`);
  else if (blocked.length && !real) { reasons.push(`${blocked.length} zadan nie-regresji (401/403/429/3xx) — sprawdz bypass/WAF/kanoniczna domene`); verdict = EXIT.BROKEN; }
  else if (stage === 'watch') {
    const depTail = failingTail(rounds, 'dep');
    // Zaleznosc NAJPIERW (data-review r4): padnieta baza psuje tez strone glowna; rollback zdrowego buildu niczego nie naprawi.
    if (depTail >= cfg.watch.failingStreak) { reasons.push(`zaleznosc niesprawna (${depTail} rund z rzedu) — rollback aplikacji tego nie naprawi`); verdict = EXIT.BROKEN; }
    else if (tail >= cfg.watch.failingStreak) reasons.push(`ostatnie ${tail} rund z rzedu czerwone (prog ${cfg.watch.failingStreak}) — produkcja zepsuta TERAZ`);
    else if (real) notes.push(`bledy w ${failedRounds} rundzie(ach), ostatnie ${tail} z rzedu < ${cfg.watch.failingStreak} — przejsciowe, bez rollbacku`);
    // p95 w WATCH tylko notatka — wolne odpowiedzi licza sie przez maxMs sond, czyli pod regula serii (code-review r2: zimny start)
    if (p95 > cfg.thresholds.maxP95Ms) notes.push(`p95 ${p95} ms > ${cfg.thresholds.maxP95Ms} ms`);
    if (reasons.length && verdict !== EXIT.BROKEN) verdict = EXIT.BREACH;
  } else {
    if (real / results.length > cfg.thresholds.maxFailureRate) reasons.push(`bledy ${real}/${results.length} > prog ${cfg.thresholds.maxFailureRate}`);
    // p95 ma sens od ~20 probek; ponizej (PREVIEW: 1 runda) p95 = max latencji, wiec jeden zimny start blokowalby merge mimo maxMs
    // sondy (code-review r3). Wtedy latencje ocenia maxMs kazdej sondy, a p95 idzie do notatek.
    if (p95 > cfg.thresholds.maxP95Ms) (results.length >= P95_MIN_SAMPLES ? reasons : notes).push(`p95 ${p95} ms > ${cfg.thresholds.maxP95Ms} ms${results.length < P95_MIN_SAMPLES ? ` (tylko ${results.length} probek)` : ''}`);
    if (reasons.length) verdict = EXIT.BREACH;
  }
  return { stage, requests: results.length, failures: failed.length, blocked: blocked.length, errors5xx: results.filter((r) => r.status >= 500).length, failedRounds, failingTail: tail, p95Ms: p95, verdict, pass: verdict === EXIT.OK, reasons, notes, samples: failed.slice(0, 10) };
}

// Czy wdrozenie z URL-a naprawde nalezy do NASZEGO projektu i zespolu (security-review r2: obcy projekt nazwany
// `<projekt>-x1-<zespol>` przechodzil wzorzec nazwy). GET /v13/deployments/{host}: projectId i ownerId musza sie zgadzac.
// Wiazanie z etapem (security-review r3 F1): BAKE = target 'production' i ten sam commit co w planie; PREVIEW = nie-produkcja i ten sam commit.
export async function verifyDeployment(base, { token, projectId, teamId, sha, stage, retryDelayMs = 2000 }, fetchImpl = fetch) {
  if (!token || !projectId || !teamId) return { ok: false, why: 'brak VERCEL_TOKEN / VERCEL_PROJECT_ID / VERCEL_ORG_ID — bez weryfikacji nie wysylam bypassu' };
  const host = new URL(base).hostname;
  try {
    // 3 proby przy 5xx/429/bledzie sieci (zapytanie idempotentne; ops r6: jedno 503 blokowalo deploy do recznego ponowienia)
    let r = null;
    for (let i = 0; i < 3; i++) {
      if (i) await new Promise((res) => setTimeout(res, retryDelayMs * i));
      try { r = await fetchImpl(`https://api.vercel.com/v13/deployments/${encodeURIComponent(host)}?teamId=${encodeURIComponent(teamId)}`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) }); } catch (e) { r = null; if (i === 2) throw e; continue; }
      if (r.ok || (r.status < 500 && r.status !== 429)) break;
    }
    if (!r.ok) return { ok: false, why: `API Vercela ${r.status} dla ${host}` };
    const d = await r.json();
    if (d.projectId !== projectId || d.ownerId !== teamId) return { ok: false, mismatch: true, why: `wdrozenie ${host} NIE nalezy do projektu/zespolu z konfiguracji` };
    const isProd = d.target === 'production';
    if (stage === 'bake' && !isProd) return { ok: false, mismatch: true, why: `wdrozenie ${host} nie jest buildem produkcji (target=${d.target})` };
    if (stage === 'preview' && isProd) return { ok: false, mismatch: true, why: `wdrozenie ${host} to produkcja, nie podglad` };
    const dsha = (d.meta && (d.meta.githubCommitSha || d.meta.gitCommitSha || d.meta.gitSha)) || '';
    if (sha && dsha !== sha) return { ok: false, mismatch: true, why: `wdrozenie ${host} jest z commita ${dsha.slice(0, 10) || '?'}, a plan dotyczy ${sha.slice(0, 10)}` };
    return { ok: true };
  } catch (e) { return { ok: false, why: `API Vercela: ${e.message}` }; }
}

// Komu wolno dac naglowek bypass: WATCH (dokladna domena produkcji z vars) i BAKE (build produkcji z main, po weryfikacji
// projektu/targetu/commita). PREVIEW NIGDY: kod galezi PR (takze z tego repo, takze boty zaleznosci) nie jest zrecenzowany,
// a sekret otwiera wszystkie chronione wdrozenia projektu (security-review r4 F1).
export function bypassAllowed(stage, env) {
  if (!env.VERCEL_AUTOMATION_BYPASS_SECRET) return false;
  return stage === 'watch' || stage === 'bake';
}

// Cel rollbacku (security-review r4 F3, data-review r4): ostatnie wdrozenie produkcji z zielonym BAKE i innym commitem.
// Wejscie: wiersze „uid sha stan_pg_bake" od najnowszego. Zwraca { uid, sha } albo null (brak celu = bez auto-rollbacku).
// Wiersze „uid sha stan_pg_bake [stan_pg_watch]": pomija buildy juz wycofane przez WATCH (pg/watch=failure) — ops-review r5.
export function pickRollbackTarget(lines, currentSha) {
  for (const l of String(lines || '').split('\n')) {
    const [uid, sha, st, wst] = l.trim().split(/\s+/);
    if (uid && /^[0-9a-f]{40}$/.test(sha || '') && sha !== currentSha && st === 'success' && wst !== 'failure') return { uid, sha };
  }
  return null;
}

// Decyzja o auto-rollbacku (logika z YAML przeniesiona tu, zeby byla testowana — code-review r2). Wejscie zbiera workflow.
// Zwraca kod: rollback | disabled | guard (otwarte issue deploy-rollback) | nosetup | stale (na zywo inny build) | norange | migrations | backend.
// Konserwatywnie (data-review r3): kazdy plik .sql albo segment `migrations/` / `drizzle/` GDZIEKOLWIEK (monorepo apps/*/supabase,
// src/migrations); sciezki cytowane przez gita (nie-ASCII) — cudzyslow zdejmowany. Watpliwosc = bez auto-rollbacku.
export const MIGRATION_RX = /(^|\/)(migrations?|drizzle|db\/migrate)\/|\.sql$|(^|\/)schema\.prisma$/i;
export const BACKEND_RX = /(^|\/)supabase\/functions\//;
export function rollbackDecision({ openRollbackIssues, hasSecrets, prevSha, changedFiles, disabled, liveSha, sha }) {
  if (disabled) return 'disabled'; // vars.PG_AUTO_ROLLBACK=off: tylko alarm (ops-review r3: wylacznik)
  // Bezpiecznik fail-closed: wszystko, co nie jest DOKLADNIE zerem (brak, tekst bledu gh, NaN), = otwarte issue (code r7)
  if (String(openRollbackIssues ?? '').trim() !== '0') return 'guard'; // tylko DOSLOWNE '0' przepuszcza (null/false/'0x0'/'-0' = guard; code r8)
  if (!hasSecrets) return 'nosetup';
  // Co jest na produkcji TERAZ: nieznane (blad API Vercela) = bez auto-rollbacku (rollback i tak uzywa tego API); inny build
  // (nowsza promocja) = 'stale' — jego WATCH go oceni (ops-review r3, code-review r4).
  if (!liveSha) return 'norange';
  if (sha && liveSha !== sha) return 'stale';
  if (!prevSha || changedFiles === null || changedFiles === undefined) return 'norange';
  const files = String(changedFiles).split('\n').map((f) => f.trim().replace(/^"|"$/g, ''));
  if (files.some((f) => MIGRATION_RX.test(f))) return 'migrations';
  if (files.some((f) => BACKEND_RX.test(f))) return 'backend'; // stary front + nowa edge fn = rozjechany kontrakt
  return 'rollback';
}

// PR z sama dokumentacja (dla pominietego podgladu). .mdx to komponenty React = kod (code-review r4).
export function docsOnly(files) {
  const list = String(files || '').split('\n').map((f) => f.trim()).filter(Boolean);
  return list.length > 0 && list.every((f) => /\.(md|txt)$/i.test(f) || /^docs\/[^]*\.(md|txt|png|jpe?g|svg)$/i.test(f));
}

// Deadman: wiersze „sha created_at stan_pg_bake stan_deploymentu" -> wdrozenia 30 min - 6 h bez koncowego statusu pg/bake.
// Build nieudany/anulowany (deployment failure/error/inactive) NIE jest zawieszony — pg/bake dla niego nie powstaje (ops-review r4).
export function stuckDeployments(lines, nowMs) {
  return String(lines || '').split('\n').map((l) => l.trim().split(/\s+/)).filter((p) => /^[0-9a-f]{40}$/.test(p[0] || '')).filter(([, at, st, dst]) => {
    const age = (nowMs - Date.parse(at)) / 1000;
    // '?' = blad odczytu API (nieznane), nie „zawieszony" — chwilowy blad gh nie robi alarmu (code-review r5)
    return age >= 1800 && age <= 21600 && st !== '?' && dst !== '?' && !['success', 'failure', 'error'].includes(st) && !['failure', 'error', 'inactive'].includes(dst);
  }).map(([sha, , st]) => `${sha}(${st || 'brak'})`);
}

// Zdarzenie -> etap. Wartosci z payloadu (moze go wyslac kazdy z prawem zapisu) walidowane TU, a nie w YAML.
export function planFromEvent(env, cfg) {
  const ev = String(env.EVENT || '').replace(/[^a-z_]/g, ''); const action = String(env.ACTION || '').replace(/[^a-z.]/g, '').slice(0, 60);
  const envl = String(env.P_ENV || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40); // payload writera: bez \n i `::` (komendy workflow)
  let stage = 'skip'; let url = ''; let sha = ''; let note = '';
  if (ev === 'schedule') return { stage: 'skip', url: '', sha: '', ref: '', note: 'harmonogram (deadman) — bez bramki' };
  if (ev === 'workflow_dispatch') {
    stage = env.I_STAGE; sha = env.I_SHA || env.HEAD_SHA;
    url = stage === 'watch' ? '' : (env.I_URL || ''); // WATCH zawsze na PROD_URL: rollback dotyczy produkcji (security-review)
  } else if (envl !== 'production' && action === 'vercel.deployment.canceled') {
    return { stage: 'skip', url: '', sha: '', ref: '', note: 'podglad anulowany (nowszy push) — bez statusu' }; // ops-review r2: canceled != zielone
  } else if (envl !== 'production' && /^vercel\.deployment\.(ignored|skipped)$/.test(action)) {
    stage = 'preview-none'; sha = env.P_SHA; note = `podglad pominiety (${action.split('.').pop()}) — nic do sondowania`;
  } else if (envl !== 'production' && /^vercel\.deployment\.(error|failed)$/.test(action)) {
    stage = 'preview-failed'; sha = env.P_SHA; note = `build podgladu padl (${action.split('.').pop()})`;
  } else if (action === 'vercel.deployment.success' && envl !== 'production') { stage = 'preview'; url = env.P_URL; sha = env.P_SHA; }
  else if (action === 'vercel.deployment.ready' && envl === 'production') { stage = 'bake'; url = env.P_URL; sha = env.P_SHA; }
  else if (action === 'vercel.deployment.promoted' && envl === 'production') { stage = 'watch'; sha = env.P_SHA; }
  if (stage === 'skip') return { stage, url: '', sha: '', ref: '', note: `zdarzenie ${ev}/${action}/${envl || '-'} poza bramkami` };
  // Wylacznik (vars.PG_DEPLOY_GATE=off, ops-review r3): bramka przepuszcza — PREVIEW/BAKE dostaja success z opisem, WATCH pomijany.
  if (String(env.GATE_MODE || '').toLowerCase() === 'off') {
    if (stage === 'watch') return { stage: 'skip', url: '', sha: '', ref: '', note: 'bramka wylaczona (vars.PG_DEPLOY_GATE=off)' };
    if (stage === 'preview' || stage === 'bake') {
      if (!/^[0-9a-f]{40}$/.test(String(sha || ''))) throw new Error('zly sha w payloadzie/wejsciu');
      return { stage: `off-${stage}`, url: '', sha, ref: '', note: 'bramka wylaczona (vars.PG_DEPLOY_GATE=off) — bez sond' };
    }
  }
  if (!['preview', 'bake', 'watch', 'preview-none', 'preview-failed'].includes(stage)) throw new Error(`zly etap ${stage}`);
  if (!/^[0-9a-f]{40}$/.test(String(sha || ''))) throw new Error('zly sha w payloadzie/wejsciu');
  if (stage === 'watch') {
    if (!env.PROD_URL) throw new Error('brak vars.PROD_URL (RUNBOOK › Pipeline wdrozenia) — WATCH i rollback nie dzialaja');
    url = env.PROD_URL;
  }
  // Konfiguracja potrzebna dopiero tu: zdarzenia bez sond nie zaleza od probes.json (ops-review r2: placeholdery dawaly issue na kazde zdarzenie).
  if (/^(preview|bake|watch)$/.test(stage)) {
    const c = typeof cfg === 'function' ? cfg() : cfg;
    // PREVIEW/BAKE: tylko hosty WDROZEN (wzorce z `*`), nie domena produkcji — inaczej BAKE moglby „sprawdzic" zywa produkcje (security r5)
    url = allowedBase(url, stage === 'watch' ? c.allowedHosts : c.allowedHosts.filter((h) => String(h).includes('*')));
  }
  const ref = String(env.P_REF || '').replace(/[^\w./-]/g, '').slice(0, 100);
  return { stage, url, sha, ref, note };
}

// Petla rund z wstrzykiwanymi sondami i zegarem (testowalna bez sieci — code-review r5). Zasady wyjscia:
// WATCH: seria app albo dep >= failingStreak -> od razu; po koncu okna nie konczy w srodku serii bledow.
// BAKE: pierwsza czerwona runda (zero tolerancji). PREVIEW: duration 0 = 1 runda.
export async function runRounds({ stage, cfg, duration, interval, probeRound, now = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const rounds = [];
  const end = now() + duration * 1000;
  const inStreak = () => stage === 'watch' && (failingTail(rounds) > 0 || failingTail(rounds, 'dep') > 0);
  for (;;) {
    rounds.push(await probeRound());
    if (stage === 'watch' && (failingTail(rounds) >= cfg.watch.failingStreak || failingTail(rounds, 'dep') >= cfg.watch.failingStreak)) break;
    if (stage === 'bake' && rounds[rounds.length - 1].some((r) => !r.ok && !r.blocked)) break;
    if (now() + interval * 1000 > end && !inStreak()) break;
    if (rounds.length > 10000) break; // bezpiecznik
    await sleep(interval * 1000);
  }
  return rounds;
}

async function probeMain(o) {
  const cfg = loadConfig(readFileSync(o.config, 'utf8'));
  const base = allowedBase(o.base, cfg.allowedHosts);
  const headers = { 'user-agent': 'pg-deploy-probe' };
  const env = process.env;
  if (bypassAllowed(o.stage, env)) {
    const v = o.stage === 'watch' ? { ok: true } : await verifyDeployment(base, { token: env.VERCEL_TOKEN, projectId: env.VERCEL_PROJECT_ID, teamId: env.VERCEL_ORG_ID, sha: env.SHA, stage: o.stage });
    if (v.mismatch) throw new Error(v.why); // podrobiony cel = bramka niesprawna (exit 2), zero zadan z sekretem
    if (o.stage === 'bake' && !v.ok) throw new Error(`BAKE bez weryfikacji wdrozenia (${v.why}) — wynik nie bylby zwiazany z buildem`); // security r5
    if (v.ok) headers['x-vercel-protection-bypass'] = env.VERCEL_AUTOMATION_BYPASS_SECRET;
    else console.log(`deploy-probe: bez naglowka bypass — ${v.why}`);
  }
  const opts = { timeoutMs: cfg.thresholds.timeoutMs, retries: cfg.thresholds.retries };
  const rounds = await runRounds({ stage: o.stage, cfg, duration: o.duration, interval: o.interval, probeRound: () => Promise.all(cfg.probes.map((p) => hit(base, p, opts, headers))) });
  const sum = Object.assign({ base, rounds: rounds.length }, summarize(rounds, cfg, o.stage));
  // Bledy bez odpowiedzi (status 0) moga byc siecia RUNNERA, nie produkcji: sonda kontrolna; gdy tez pada = bramka niesprawna.
  if (sum.verdict === EXIT.BREACH && sum.samples.length && sum.samples.every((s) => s.status === 0)) {
    const control = await fetch('https://api.github.com/zen', { signal: AbortSignal.timeout(5000) }).then((r) => r.ok, () => false);
    if (!control) { sum.verdict = EXIT.BROKEN; sum.pass = false; sum.reasons.push('siec runnera niesprawna (sonda kontrolna api.github.com padla) — to nie regresja'); }
  }
  const label = sum.verdict === EXIT.OK ? 'OK' : sum.verdict === EXIT.BREACH ? 'PRZEKROCZONE' : 'BRAMKA NIESPRAWNA';
  const extra = [...sum.reasons, ...sum.notes];
  const line = `deploy-probe ${o.stage} ${base}: ${label} · ${sum.requests} zadan, bledy ${sum.failures} (5xx ${sum.errors5xx}, blok ${sum.blocked}), rundy z bledem ${sum.failedRounds}, p95 ${sum.p95Ms} ms${extra.length ? ' · ' + extra.join('; ') : ''}`;
  console.log(line);
  for (const s of sum.samples) console.log(`  - ${s.name}: ${s.why} (${s.ms} ms, prob ${s.attempts})`);
  if (o.json) writeFileSync(o.json, JSON.stringify(sum, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### ${line}\n${sum.samples.map((s) => `- ${s.name}: ${s.why}`).join('\n')}\n`);
  return sum.verdict;
}

// --decide-rollback: env OPEN_ROLLBACK, HAS_SECRETS (true/false), PREV_SHA, CHANGED (lista plikow albo pusta przy bledzie: CHANGED_OK=false).
function decideMain() {
  const e = process.env;
  // Brak OPEN_ROLLBACK = bezpiecznik WLACZONY (fail-closed; code r6)
  const d = rollbackDecision({ openRollbackIssues: e.OPEN_ROLLBACK === undefined || e.OPEN_ROLLBACK === '' ? 1 : e.OPEN_ROLLBACK, hasSecrets: e.HAS_SECRETS === 'true', prevSha: e.PREV_SHA || '', changedFiles: e.CHANGED_OK === 'true' ? (e.CHANGED || '') : null, disabled: e.AUTO_ROLLBACK === 'off', liveSha: e.LIVE_SHA || '', sha: e.SHA || '' });
  if (e.GITHUB_OUTPUT) appendFileSync(e.GITHUB_OUTPUT, `decision=${d}\n`);
  console.log(`rollback-decision: ${d}`);
  return EXIT.OK;
}

function planMain(o) {
  const p = planFromEvent(process.env, () => loadConfig(readFileSync(o.config, 'utf8')));
  const out = `stage=${p.stage}\nurl=${p.url}\nsha=${p.sha}\nref=${p.ref}\nnote=${p.note.replace(/[\r\n]/g, ' ')}\n`;
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, out); else process.stdout.write(out);
  console.log(`plan: ${p.stage} ${p.url} ${p.sha} ${p.note}`.replace(/[\r\n]/g, ' ').replace(/::/g, ': :'));
  return EXIT.OK;
}

// pathToFileURL: porownanie ze zwyklym stringiem dawalo cichy exit 0 (bez pomiaru) dla sciezek ze spacja/#/symlinkiem (code-review).
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  let o;
  try { o = args(process.argv.slice(2)); } catch (e) { console.error(`deploy-probe: ${e.message}`); process.exit(EXIT.BROKEN); }
  const stdin = () => { try { return readFileSync(0, 'utf8'); } catch (e) { return ''; } };
  // --docs-only: lista plikow na stdin -> exit 0 = sama dokumentacja, 1 = jest kod. --deadman: wiersze na stdin -> wypisuje zawieszone.
  const main = o.plan ? () => planMain(o) : o.decide ? decideMain
    : o.docsOnly ? () => (docsOnly(stdin()) ? EXIT.OK : EXIT.BREACH)
      : o.deadman ? () => { const s = stuckDeployments(stdin(), Date.now()); if (s.length) console.log(s.join(' ')); return EXIT.OK; }
        : o.pick ? () => { const t = pickRollbackTarget(stdin(), process.env.SHA || ''); if (t) console.log(`${t.uid} ${t.sha}`); return EXIT.OK; }
        : () => probeMain(o);
  Promise.resolve(main()).then((c) => process.exit(c)).catch((e) => { console.error(`deploy-probe: ${e.message}`); process.exit(EXIT.BROKEN); });
}

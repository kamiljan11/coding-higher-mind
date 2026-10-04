#!/usr/bin/env node
'use strict';
// pg-self-approve (uzytkownik 2026-10-02: „self approval — agent sam sprawdza bezpieczenstwo i poprawia"): wydaje wyjatek
// poziomu B (overrides.SELF_APPROVABLE) TYLKO z dowodem recenzji tej samej zmiany. Po pg-review 2026-10-02 (findings
// dalo sie podrobic dwoma pustymi plikami) dowod = transkrypty prawdziwych subagentow, nie same pliki w %TEMP%:
//  1. dla kazdej wymaganej roli (security, code) istnieje transkrypt subagenta `<rola>-reviewer`
//     (~/.claude/projects/*/<sesja>/subagents/agent-*.jsonl + .meta.json), ktory wymienia ten przebieg, jest nowszy niz
//     diff.patch, a findings.<rola>.json NIE jest nowszy niz transkrypt (pozniejsza podmiana = odmowa);
//  2. agregacje liczymy od nowa (pg-aggregate --final): APPROVE, kazdy finding zweryfikowany;
//  3. diff.patch ma te same linie +/- co obecny stan TYCH SAMYCH plikow w repo (z nieśledzonymi), przebieg < 2 h;
//  4. przebieg jednorazowy; wyjatek trafia do sesji, w ktorej dzialali recenzenci (15 min / 1 uzycie, tylko w tym repo).
//  verdicts.json (zmienia werdykt) wymaga transkryptu subagenta `verifier`; czas recenzji = timestamp z JSONL, nie mtime.
// Granica (pg/known-limits.md): agent, ktory celowo podrabia transkrypty JSONL, obejdzie to — model zagrozen = agent na skrotach.
// Uzycie: node pg-self-approve.js --run <katalog pg-review> --repo <sciezka> --allow ALLOW_X[,ALLOW_Y] --reason "<po co>"
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const HOOKS_LIB = path.join(CLAUDE_DIR, 'hooks', 'lib');
const overrides = require(path.join(HOOKS_LIB, 'overrides.js'));
const gateLog = require(path.join(HOOKS_LIB, 'gate-log.js'));
const { aggregate } = require(path.join(__dirname, 'pg-aggregate.js'));

const REQUIRED_ROLES = ['security', 'code'];
// Dodatkowe dzialy per wyjatek (data-review 2026-10-02: PII bez recenzji danych).
const EXTRA_ROLES = { ALLOW_PII: ['data'] };
const rolesFor = (names) => [...new Set([...REQUIRED_ROLES, ...names.flatMap((n) => EXTRA_ROLES[n] || [])])];
const MAX_RUN_AGE_MS = 2 * 3600000;
const GIT_TIMEOUT_MS = 30000;
// Transkrypt JSONL ma `\\` w sciezkach Windows — sprowadzamy oba boki do jednego `/` i malych liter.
const norm = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+/g, '/').toLowerCase();

/** Odcisk linii +/- bez naglowkow i kontekstu (jak odcisk_zmian w pg-merge-bezpieczny.py). '' = pusty diff. */
function fingerprint(diff) {
  const lines = String(diff || '').split('\n').map((l) => l.replace(/\r$/, ''))
    .filter((l) => (l[0] === '+' || l[0] === '-') && !l.startsWith('+++') && !l.startsWith('---'));
  return lines.length ? crypto.createHash('sha256').update(lines.join('\n')).digest('hex') : '';
}

/** Pliki z naglowkow `diff --git a/X b/Y` (strona b; dla nowych plikow z --no-index tez b/). */
function filesOfPatch(patch) {
  const out = new Set();
  for (const m of String(patch || '').matchAll(/^diff --git (?:"?a\/)?.*? "?b\/(.+?)"?$/gm)) out.add(m[1]);
  return [...out];
}

function git(repo, args, allowExit1) {
  try {
    return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: GIT_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    // `git diff --no-index` konczy sie kodem 1, gdy sa roznice — to wynik, nie blad.
    if (allowExit1 && e.status === 1 && typeof e.stdout === 'string') return e.stdout;
    throw new Error(`git ${args.slice(0, 2).join(' ')}: ${String(e.stderr || e.message).trim().slice(0, 160)}`);
  }
}

/** Obecny stan TYCH plikow, ktore recenzja widziala: sledzone `git diff HEAD -- pliki`, nowe — `--no-index` od /dev/null. */
function currentFingerprint(repo, files) {
  if (!files.length) return '';
  const tracked = new Set(git(repo, ['ls-files', '--', ...files]).split('\n').filter(Boolean));
  let diff = tracked.size ? git(repo, ['diff', 'HEAD', '--', ...tracked]) : '';
  for (const f of files.filter((x) => !tracked.has(x))) {
    if (fs.existsSync(path.join(repo, f))) diff += git(repo, ['diff', '--no-index', '--', '/dev/null', f], true);
  }
  return fingerprint(diff);
}

/** Transkrypty subagentow wymieniajace przebieg: [{ role, sid, reviewedAt, ruleIds }]. Szuka tylko swiezych (< 2 h). */
function reviewerTranscripts(run, now) {
  const runNorm = norm(path.resolve(run));
  const runBase = path.basename(run).toLowerCase();
  const out = [];
  const projects = projectsDir();
  for (const proj of safeList(projects)) {
    for (const sess of safeList(path.join(projects, proj))) {
      const dir = path.join(projects, proj, sess, 'subagents');
      for (const f of safeList(dir).filter((x) => x.endsWith('.meta.json'))) {
        const jsonl = path.join(dir, f.replace(/\.meta\.json$/, '.jsonl'));
        let st;
        try { st = fs.statSync(jsonl); } catch (e) { continue; }
        if (now - st.mtimeMs > MAX_RUN_AGE_MS || st.mtimeMs - now > 60000) continue;
        let meta;
        try { meta = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (e) { continue; }
        const m = /^(?:(\w+)-reviewer|(verifier))$/.exec(String(meta.agentType || ''));
        if (!m) continue;
        const raw = fs.readFileSync(jsonl, 'utf8');
        const text = norm(raw);
        if (!text.includes(runNorm) && !text.includes('/' + runBase + '/')) continue;
        // Czas recenzji = najpozniejszy `timestamp` wpisu w transkrypcie, nie mtime pliku (security-review 2026-10-02: `touch`).
        const stamps = [...raw.matchAll(/"timestamp":"([^"]+)"/g)].map((x) => Date.parse(x[1])).filter((n) => n > 0);
        if (!stamps.length) continue;
        // rule_id, ktore recenzent zapisal w swoich komendach — findings bez nich = podmiana po recenzji (security-review
        // 2026-10-02: `touch -r` cofal mtime podmienionych pustych findings).
        // Tylko z WEJSC narzedzi recenzenta (tool_use), nie z wynikow — przeczytane pliki maja cudze rule_id.
        const ruleIds = [...new Set([...toolInputsText(raw).matchAll(/rule_id\\*"\s*:\s*\\*"([A-Za-z0-9_.:-]+)/g)].map((x) => x[1]))];
        out.push({ role: m[1] || m[2], sid: sess, reviewedAt: Math.max(...stamps), ruleIds });
      }
    }
  }
  return out;
}

/**
 * Wlasny wynik recenzenta z transkryptu JSONL: wejscia jego narzedzi (tool_use) i jego tekst (assistant text) —
 * recenzent bez Write oddaje findings tekstem, a zapisuje je orkiestrator (security-review 2026-10-02). Bez wynikow
 * narzedzi: przeczytane pliki maja cudze rule_id.
 */
function toolInputsText(raw) {
  const parts = [];
  for (const line of raw.split('\n')) {
    if (!line.includes('"assistant"')) continue;
    let entry;
    try { entry = JSON.parse(line); } catch (e) { continue; }
    if (entry.type !== 'assistant') continue;
    const content = (entry.message && entry.message.content) || [];
    for (const block of Array.isArray(content) ? content : []) {
      if (block && block.type === 'tool_use') parts.push(JSON.stringify(block.input || {}));
      else if (block && block.type === 'text') parts.push(String(block.text || ''));
    }
  }
  return parts.join('\n');
}

// Katalog transkryptow; nadpisanie tylko w %TEMP% (testy) — jak PG_OVERRIDES_DIR w overrides.js.
function projectsDir() {
  const env = process.env.PG_PROJECTS_DIR;
  if (env && path.resolve(env).toLowerCase().startsWith(path.resolve(os.tmpdir()).toLowerCase() + path.sep)) return path.resolve(env);
  return path.join(CLAUDE_DIR, 'projects');
}

function safeList(dir) {
  try { return fs.readdirSync(dir); } catch (e) { return []; }
}

/**
 * Czysta decyzja. Wejscie: nazwy, powod, agregacja, wiek przebiegu, odciski, transkrypty recenzentow i mtime findings.
 * Zwraca { why } (odmowa) albo { sid } (sesja, ktorej wydac wyjatek).
 */
function evaluate({ names, reason, agg, runAgeMs, reviewFp, currentFp, transcripts, findingsMtime, patchMtime = 0, findingsIds = {} }) {
  const roles = rolesFor(names);
  if (!names.length) return { why: 'brak --allow ALLOW_X' };
  const notB = names.filter((n) => overrides.tierOf(n) !== 'B');
  if (notB.length) {
    return { why: `${notB.join(', ')} nie jest poziomu B — ` + notB.map((n) => (overrides.tierOf(n) === 'A'
      ? `${n}: poziom A, agent dodaje ${n}=1 sam` : `${n}: poziom C, tylko fraza uzytkownika`)).join('; ') };
  }
  if (String(reason || '').trim().length < 10) return { why: '--reason musi opisac po co (min. 10 znakow) — trafia do logu bramek' };
  if (runAgeMs < 0) return { why: 'brak <RUN>/diff.patch — puść pg-review (krok 0)' };
  if (runAgeMs > MAX_RUN_AGE_MS) return { why: 'przebieg recenzji starszy niz 2 h — puść pg-review ponownie' };
  const sids = new Set();
  for (const role of roles) {
    // Transkrypt nowszy niz findings (podmiana po recenzencie = odmowa) ORAZ niz diff.patch (code-review 2026-10-02:
    // diff.patch wygenerowany ponownie po zmianie kodu przy starych findings).
    // Recenzja po diff.patch; plik findings musi istniec. Podmiane tresci lapie zbior rule_id ponizej (nie mtime —
    // orkiestrator legalnie zapisuje findings po recenzencie bez Write, a `touch -r` i tak cofal mtime).
    const fresh = (transcripts || []).filter((t) => t.role === role && Number.isFinite(findingsMtime[role]) && t.reviewedAt >= patchMtime);
    if (!fresh.length) {
      return { why: `brak transkryptu subagenta ${role}-reviewer dla tego przebiegu (albo findings.${role}.json / diff.patch zmienione po recenzji) — odpal recenzenta, nie pisz findings sam` };
    }
    const have = new Set(findingsIds[role] || []);
    const lost = [...new Set(fresh.flatMap((t) => t.ruleIds || []))].filter((id) => !have.has(id));
    if (lost.length) return { why: `findings.${role}.json nie zawiera findings zapisanych przez recenzenta (${lost.slice(0, 5).join(', ')}) — podmiana po recenzji` };
    fresh.forEach((t) => sids.add(t.sid));
  }
  // verdicts.json zmienia werdykt agregacji — piszacy go musi byc prawdziwym weryfikatorem (security-review 2026-10-02).
  if (Number.isFinite(findingsMtime.verifier)) {
    const ver = (transcripts || []).filter((t) => t.role === 'verifier' && t.reviewedAt >= findingsMtime.verifier - 2000);
    if (!ver.length) return { why: 'verdicts.json bez transkryptu subagenta verifier (albo zmieniony po nim) — werdykty wydaje weryfikator, nie orkiestrator' };
    ver.forEach((t) => sids.add(t.sid));
  }
  if (sids.size !== 1) return { why: `recenzenci z roznych sesji (${[...sids].join(', ')}) — wyjatek nalezy do jednej sesji` };
  if (!agg || agg.verdict !== 'APPROVE') {
    return { why: `recenzja nie jest APPROVE (verdict=${agg ? agg.verdict : 'brak'}${agg && agg.incomplete.length ? '; ' + agg.incomplete.join('; ') : ''}) — napraw findings i powtorz pg-review` };
  }
  if (!reviewFp) return { why: 'diff.patch recenzji pusty — nie ma czego zatwierdzac' };
  if (reviewFp !== currentFp) return { why: 'recenzja dotyczyla innej zmiany niz obecny stan tych plikow — puść pg-review na aktualnym diffie' };
  return { sid: [...sids][0] };
}

/**
 * Skrot tresci przebiegu — klucz jednorazowosci odporny na kopie katalogu. Tylko pliki, ktore decyzja sprawdza
 * (data-review 2026-10-02: dopisany pusty findings.x.json zmienial klucz = drugi grant z jednej recenzji).
 */
function runKey(run, roles) {
  const h = crypto.createHash('sha256');
  const files = ['diff.patch', 'verdicts.json', ...roles.map((r) => `findings.${r}.json`)];
  for (const f of files) {
    try { h.update(f + '\0' + fs.readFileSync(path.join(run, f), 'utf8') + '\0'); } catch (e) { /* brak verdicts.json = ok */ }
  }
  return h.digest('hex');
}

function arg(args, name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function main(argv) {
  const run = arg(argv, '--run');
  const repo = arg(argv, '--repo');
  const names = String(arg(argv, '--allow') || '').toUpperCase().split(/[\s,]+/).filter(Boolean);
  const reason = arg(argv, '--reason');
  if (!run || !repo || !fs.existsSync(run) || !overrides.repoRoot(repo)) {
    console.error('uzycie: pg-self-approve.js --run <katalog pg-review> --repo <repo git> --allow ALLOW_X[,ALLOW_Y] --reason "<po co>"');
    return 2;
  }
  const refuse = (why) => {
    gateLog.log({ hook: 'pg-self-approve', event: 'blocked', reason: `${names.join(',')}: ${why}`.slice(0, 300), target: repo });
    console.error(`pg-self-approve: ODMOWA — ${why}`);
    return 1;
  };
  const now = Date.now();
  const patchFile = path.join(run, 'diff.patch');
  const patch = fs.existsSync(patchFile) ? fs.readFileSync(patchFile, 'utf8') : null;
  const runAgeMs = patch === null ? -1 : Math.max(0, now - fs.statSync(patchFile).mtimeMs);
  let agg = null;
  let currentFp = '';
  try {
    agg = aggregate(run, path.join(run, 'verdicts.json'), { requiredRoles: rolesFor(names), final: true });
    currentFp = currentFingerprint(overrides.repoRoot(repo), filesOfPatch(patch));
  } catch (e) { return refuse(`nie da sie policzyc dowodu: ${String(e.message || e).slice(0, 200)}`); }
  const findingsMtime = {};
  for (const role of rolesFor(names)) {
    try { findingsMtime[role] = fs.statSync(path.join(run, `findings.${role}.json`)).mtimeMs; } catch (e) { findingsMtime[role] = Infinity; }
  }
  try { findingsMtime.verifier = fs.statSync(path.join(run, 'verdicts.json')).mtimeMs; } catch (e) { /* brak = agregacja bez werdyktow */ }
  const findingsIds = {};
  for (const role of rolesFor(names)) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(run, `findings.${role}.json`), 'utf8'));
      findingsIds[role] = (data.findings || []).map((f) => String((f && f.rule_id) || ''));
    } catch (e) { findingsIds[role] = []; }
  }
  const verdict = evaluate({
    names, reason, agg, runAgeMs, reviewFp: fingerprint(patch), currentFp, transcripts: reviewerTranscripts(run, now), findingsMtime,
    patchMtime: patch === null ? Infinity : fs.statSync(patchFile).mtimeMs, findingsIds,
  });
  if (verdict.why) return refuse(verdict.why);
  let grants;
  try {
    grants = overrides.mintSelf(verdict.sid, repo, names, { run: path.resolve(run), run_key: runKey(run, rolesFor(names)), reason: String(reason).slice(0, 200) });
  } catch (e) { return refuse(String(e.message || e)); }
  gateLog.log({ hook: 'pg-self-approve', event: 'self_approved', reason: `${names.join(',')}: ${String(reason).slice(0, 200)} (run ${path.basename(run)})`, target: repo });
  console.log(`pg-self-approve: wydano ${grants.map((g) => `${g.name} (${g.uses_left} uzycia, do ${new Date(g.expires).toISOString().slice(11, 16)} UTC)`).join(', ')} ` +
    `dla repo ${overrides.repoRoot(repo)} (sesja recenzji ${verdict.sid}). Teraz komenda z ${names[0]}=1 z katalogu repo.`);
  return 0;
}

module.exports = { evaluate, fingerprint, filesOfPatch, runKey, rolesFor, REQUIRED_ROLES, main };

if (require.main === module) process.exit(main(process.argv.slice(2)));

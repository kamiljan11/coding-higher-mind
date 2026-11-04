#!/usr/bin/env node
'use strict';
// Agregator findings z recenzentow dzialowych (0 tokenow). Czesc [A] i regula decyzji z pg-review.
// Wejscie: katalog z findings.<rola>.json (+ opcjonalnie verdicts.json weryfikatora).
// Zasady (research A9: agregacja niezaleznych przebiegow +43,67 % F1 vs pojedynczy; debata NIE):
//  1. finding bez `evidence` LUB bez `repro_cmd` jest ODRZUCANY — twierdzenie bez dowodu nie istnieje,
//  2. dedupe po (plik, zakres linii +-LINE_TOLERANCE, rule_id); agreement = liczba roznych rol,
//  3. blocker = agreement >= MIN_AGREEMENT_FOR_BLOCKER LUB (agreement == 1 i weryfikator `reproduced`),
//  4. agreement == 1 bez potwierdzenia -> `note` (trafia do raportu, nigdy nie blokuje); minor z agreement == 1 NIE trafia
//     do needs_verification (zostaje note bez weryfikacji, 2026-10-06); blocker i major z agreement == 1 — tak jak dotad,
//  5. severity = MAX z zgadzajacych sie finderow (nigdy srednia); weryfikator moze tylko obnizyc.
//  6. (landscape #1, fail-closed) werdykt INCOMPLETE (exit 3) — nie APPROVE — gdy: 0 plikow findings, plik nieparsowalny
//     / bez tablicy, brakuje roli wymaganej dla tieru, werdykt weryfikatora z nieznanym/zduplikowanym finding_id,
//     a z --final: finding wymagajacy weryfikacji bez werdyktu. Rola = z NAZWY pliku (pole `role` moglo zawyzyc k-of-n).
//  7. (2026-11-01, pg/cases.md CANNOT-RUN-BLOCKER-AS-NOTE) werdykt weryfikatora = ALLOWLISTA VERIFIER_VERDICTS; inna wartosc
//     (`CANNOT_RUN`, `inconclusive`, true...) = INCOMPLETE (pg-review A1 security: denylista jednego stringu dawala APPROVE).
//     `cannot_run` na blockerze = brak werdyktu (zostaje w needs_verification, --final -> INCOMPLETE); weryfikator obniza
//     severity tylko przy `reproduced`. Grupe rozstrzyga werdykt czlonka o NAJWYZSZEJ severity grupy (obalenie slabszego
//     duplikatu nie zrzuca blockera); KAZDY taki czlonek musi miec werdykt (brak = czeka, needs_verification podaje jego id;
//     A2 security: obalenie tylko g.id zrzucalo drugi rownorzedny blocker); sprzeczne werdykty tych czlonkow = INCOMPLETE. Severity: wielkosc liter normalizowana
//     (`Blocker` = blocker); wartosc spoza zbioru dalej odrzucona jawnie w raporcie (kontrakt test_pg_tools.js, bez incydentu).
//  8. (2026-11-01, pg/cases.md AGGREGATE-DEDUPE-MISS, 4. przypadek w runie A1) grupy z ROZNYCH dzialow, ten sam plik, inne
//     rule_id, nakladajace sie linie (oba zakresy <= CROSS_ROLE_MAX_SPAN) = mozliwy ten sam defekt -> NIE scalamy (falszywa
//     zgoda dalaby must_fix bez dowodu), tylko obie ida do weryfikatora takze jako minor (`cross_role_overlap`).
//  9. (2026-11-02, plan F, OBSERVE) finder, ktory nic nie przeczytal: plik roli powinien miec `files_read`; gdy w katalogu jest
//     slice.json (pg-slice), pliki wycinka roli (pusty wycinek = caly diff) musza byc w `files_read`. Luka -> `read_gaps` w wyniku,
//     sekcja w raporcie i `would_block` w gates.jsonl (tylko z --final); werdykt BEZ zmian, dopoki dane nie pokaza, ze finderzy pisza pole
//     (ADR-0008: blokada dopiero po incydencie). Zrodlo: EGM sentinel RESOURCE_UNREADABLE -> not_run.
// Uzycie: node pg-aggregate.js <dir> --repo <sciezka repo> [--tier T2|T3 | --required code,ops] [--final] [--verdicts <plik>] [--json]
const fs = require('fs');
const path = require('path');
const { REVIEWERS_BY_TIER } = require(path.join(__dirname, '..', 'hooks', 'lib', 'risk-tier.js'));

// Agent `code-reviewer` pisze findings.code.json -> rola `code`. Jedno mapowanie dla tieru i dla stop-gate.
const roleOfAgent = (agent) => String(agent).replace(/-reviewer$/, '');

const LINE_TOLERANCE = 3;
const CROSS_ROLE_MAX_SPAN = 60; // zakres > 60 linii (np. caly plik) to brak lokalizacji, nie sygnal tego samego defektu
const MIN_AGREEMENT_FOR_BLOCKER = 2;
// Werdykty agregacji — jedno zrodlo prawdy, czyta je tez stop-gate (dup-literals 2026-09-27).
const VERDICT = Object.freeze({ APPROVE: 'APPROVE', REQUEST_CHANGES: 'REQUEST CHANGES', INCOMPLETE: 'INCOMPLETE' });
const SEVERITY_RANK = { blocker: 3, major: 2, minor: 1 };
const VERIFIER_VERDICTS = new Set(['reproduced', 'not_reproduced', 'cannot_run']);
// hasOwn, nie SEVERITY_RANK[s]: 'constructor' / '__proto__' przechodzily przez prototyp (A2 security PoC).
const isSeverity = (s) => typeof s === 'string' && Object.hasOwn(SEVERITY_RANK, s);
const REQUIRED_FIELDS = ['file', 'rule_id', 'severity', 'claim', 'evidence', 'repro_cmd'];
// Pola findingu przepisywane do stanu agregacji (allowlista). Reszta pliku roli NIE wchodzi do grupy: `verdict`,
// `verdict_ids`, `decision` itp. w findings.*.json dawaly APPROVE bez weryfikatora (pg-review A3 security PoC, 2026-11-01).
const FINDING_FIELDS = [...REQUIRED_FIELDS, 'line_range', 'confidence', 'stride', 'expected', 'screenshot'];

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; }
}

// Zwraca { valid: [...], rejected: [{finding, why}] } dla jednego pliku roli.
function validateRoleFile(file) {
  const data = readJson(file);
  const role = path.basename(file).replace(/^findings\.|\.json$/g, '');
  const valid = [];
  const rejected = [];
  if (!data || !Array.isArray(data.findings)) return { role, valid, broken: true, rejected: [{ finding: null, why: `plik ${path.basename(file)} nieparsowalny albo bez tablicy findings` }] };
  data.findings.forEach((f, idx) => {
    const missing = REQUIRED_FIELDS.filter((k) => !f || !String(f[k] || '').trim());
    if (missing.length) { rejected.push({ finding: f, why: `brak pol: ${missing.join(', ')}` }); return; }
    const severity = String(f.severity).trim().toLowerCase();
    if (!isSeverity(severity)) { rejected.push({ finding: f, why: `severity '${f.severity}' poza {blocker,major,minor}` }); return; }
    const range = Array.isArray(f.line_range) && f.line_range.length === 2 ? f.line_range.map(Number) : [0, 0];
    const picked = Object.fromEntries(FINDING_FIELDS.filter((k) => Object.hasOwn(f, k)).map((k) => [k, f[k]]));
    valid.push(Object.assign(picked, { role, severity, line_range: range, id: `${role}-${idx + 1}` }));
  });
  return { role, valid, rejected };
}

// Sciezka do porownan: bez ./ a/ b/, ukosniki /, male litery. Wpis absolutny pasuje, gdy konczy sie na /<sciezka wycinka>.
const normPath = (p) => String(p).replace(/\\/g, '/').replace(/^(\.\/|[ab]\/)/, '').toLowerCase();

// Plan F (observe): ktore pliki wycinka roli nie sa w files_read. Bez slice.json nie ma z czym porownac -> tylko brak pola.
// Observe nie moze zmienic werdyktu (A18 ops): uszkodzony slice.json albo files_read daje wpis `error`, nie wyjatek z aggregate().
function readGaps(dir, roleFiles) {
  try {
    const slice = readJson(path.join(dir, 'slice.json'));
    const gaps = [];
    for (const { role, data } of roleFiles) {
      if (!data || !Array.isArray(data.files_read)) { gaps.push({ role, missing_field: true, unread: [] }); continue; }
      if (!slice || !slice.roles) continue;
      const own = slice.roles[role] && Array.isArray(slice.roles[role].files) ? slice.roles[role].files : [];
      const expected = own.length ? own : (Array.isArray(slice.files) ? slice.files.map((f) => f.file) : []);
      const read = data.files_read.map(normPath);
      const unread = expected.filter((f) => { const n = normPath(f); return !read.some((r) => r === n || r.endsWith('/' + n)); });
      if (unread.length) gaps.push({ role, missing_field: false, unread });
    }
    return gaps;
  } catch (e) {
    return [{ role: '*', missing_field: false, unread: [], error: String(e && e.message) }];
  }
}

const sameFile = (a, b) => a.file.replace(/\\/g, '/').toLowerCase() === b.file.replace(/\\/g, '/').toLowerCase();
const overlaps = (a, b) => a[0] <= b[1] + LINE_TOLERANCE && b[0] <= a[1] + LINE_TOLERANCE;
const maxSeverity = (a, b) => (SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b);

function dedupe(findings) {
  const groups = [];
  for (const f of findings) {
    const group = groups.find((g) => g.rule_id === f.rule_id && sameFile(g, f) && overlaps(g.line_range, f.line_range));
    const member = { id: f.id, role: f.role, severity: f.severity, claim: f.claim, evidence: f.evidence, repro_cmd: f.repro_cmd };
    if (!group) { groups.push({ ...f, roles: [f.role], member_ids: [f.id], member_severity: { [f.id]: f.severity }, members: [member], line_range: [...f.line_range] }); continue; }
    group.members.push(member);
    if (!group.roles.includes(f.role)) group.roles.push(f.role);
    group.member_ids.push(f.id);
    group.member_severity[f.id] = f.severity;
    // Reprezentant grupy = najsilniejszy czlonek: weryfikator dostaje jego id, claim i repro_cmd, a werdykt grupy liczy
    // sie tylko od czlonkow o najwyzszej severity (A2 code: minor przed blockerem = INCOMPLETE bez wyjscia).
    if (SEVERITY_RANK[f.severity] > SEVERITY_RANK[group.severity]) Object.assign(group, { id: f.id, role: f.role, claim: f.claim, evidence: f.evidence, repro_cmd: f.repro_cmd });
    group.severity = maxSeverity(group.severity, f.severity);
    group.line_range = [Math.min(group.line_range[0], f.line_range[0]), Math.max(group.line_range[1], f.line_range[1])];
    group.confidence = Math.max(Number(group.confidence) || 0, Number(f.confidence) || 0);
  }
  const out = groups.map((g) => Object.assign(g, { agreement: g.roles.length, cross_role_overlap: [] }));
  const narrow = (g) => g.line_range[1] - g.line_range[0] <= CROSS_ROLE_MAX_SPAN;
  for (const a of out) {
    for (const b of out) {
      if (a === b || a.rule_id === b.rule_id || !sameFile(a, b) || !narrow(a) || !narrow(b)) continue;
      if (a.roles.some((r) => b.roles.includes(r)) || !overlaps(a.line_range, b.line_range)) continue;
      a.cross_role_overlap.push(b.id);
    }
  }
  return out;
}

const strongestIds = (g) => g.member_ids.filter((id) => g.member_severity[id] === g.severity);

// Zwraca liste problemow z werdyktami (nieznane / zduplikowane id) — kazdy = INCOMPLETE, bo nie wiemy, co zweryfikowano.
function applyVerdicts(groups, verdicts) {
  const problems = [];
  const known = new Set(groups.flatMap((g) => g.member_ids));
  const byId = new Map();
  for (const v of (verdicts && verdicts.verdicts) || []) {
    if (!known.has(v.finding_id)) { problems.push(`werdykt dla nieznanego finding_id ${v.finding_id}`); continue; }
    if (!VERIFIER_VERDICTS.has(v.verdict)) { problems.push(`werdykt '${String(v.verdict)}' dla ${v.finding_id} poza {${[...VERIFIER_VERDICTS].join(',')}}`); continue; }
    if (byId.has(v.finding_id)) { problems.push(`zduplikowany werdykt dla ${v.finding_id}`); continue; }
    byId.set(v.finding_id, v);
  }
  for (const g of groups) {
    // Rozstrzygaja WSZYSCY czlonkowie o najwyzszej severity grupy (A1: obalenie slabszego duplikatu; A2: obalenie tylko g.id).
    const strongest = strongestIds(g);
    const verdicts = strongest.map((id) => byId.get(id)).filter(Boolean);
    const kinds = new Set(verdicts.map((v) => v.verdict));
    // Rozstrzygnieci czlonkowie; cannot_run = do ponownej weryfikacji (A3 code: mieszanka dawala INCOMPLETE bez id).
    g.verdict_ids = verdicts.filter((v) => v.verdict !== 'cannot_run').map((v) => v.finding_id);
    if (kinds.has('reproduced') && kinds.has('not_reproduced')) {
      g.verdict_conflict = true; // weryfikator jeszcze raz na wszystkich rownorzednych czlonkach
      problems.push(`sprzeczne werdykty dla grupy ${g.id} (${strongest.join(', ')}): reproduced vs not_reproduced — zweryfikuj ponownie`);
      continue;
    }
    let verdict;
    if (kinds.has('reproduced')) verdict = verdicts.find((v) => v.verdict === 'reproduced'); // defekt odtworzony u jednego = potwierdzony
    else if (verdicts.length < strongest.length) continue; // czesc rownorzednych czlonkow bez werdyktu = grupa nierozstrzygnieta
    else if (kinds.size === 1) verdict = verdicts[0]; // wszyscy not_reproduced albo wszyscy cannot_run
    else verdict = verdicts.find((v) => v.verdict === 'cannot_run'); // not_reproduced + cannot_run = nie wiadomo
    if (!verdict) continue;
    g.verdict = verdict.verdict;
    // Obnizenie severity tylko gdy KAZDY rownorzedny czlonek ma reproduced z poprawnym severity_after; bierzemy najwyzsze
    // (security A4: jeden reproduced obnizal grupe, choc drugi blocker nie mial werdyktu).
    const after = verdicts.map((v) => v.severity_after);
    if (verdict.verdict === 'reproduced' && verdicts.length === strongest.length && verdicts.every((v) => v.verdict === 'reproduced') && after.every(isSeverity)) {
      const top = after.reduce(maxSeverity);
      if (SEVERITY_RANK[top] < SEVERITY_RANK[g.severity]) g.severity = top;
    }
    g.verifier_reason = verdict.reason;
  }
  return problems;
}

function decide(groups) {
  for (const g of groups) {
    const verified = g.verdict === 'reproduced';
    const refuted = g.verdict === 'not_reproduced';
    if (refuted) g.decision = 'dropped';
    else if (g.agreement >= MIN_AGREEMENT_FOR_BLOCKER || verified) g.decision = g.severity === 'blocker' ? 'blocker' : 'must_fix';
    else g.decision = 'note';
    // minor zgloszony przez 1 dzial = note BEZ weryfikacji (audyt PG 2026-10-06 #6/#7: r27 15/23 findings to minor; kazdy
    // szedl do weryfikatora (3 calls/finding z 40), a `reproduced` robil z niego must_fix -> petla fixow). Werdykt, jesli
    // weryfikator i tak go wyda, dalej obowiazuje; --final bez werdyktu go nie wymaga.
    const unverified = !g.verdict || (g.verdict === 'cannot_run' && g.severity === 'blocker');
    g.needs_verification = !!g.verdict_conflict || (unverified && (g.severity === 'blocker' || (g.agreement === 1 && (g.severity !== 'minor' || g.cross_role_overlap.length > 0))));
    // id do weryfikatora: rownorzedni czlonkowie bez rozstrzygajacego werdyktu (brak / cannot_run; sprzecznosc = wszyscy).
    const done = new Set(g.verdict_conflict ? [] : g.verdict_ids || []);
    g.verify_ids = g.needs_verification ? strongestIds(g).filter((id) => !done.has(id)) : [];
  }
  const order = { blocker: 0, must_fix: 1, note: 2, dropped: 3 };
  return groups.sort((a, b) => order[a.decision] - order[b.decision] || SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
}

function renderMarkdown(result) {
  // Bez --final niezweryfikowany blocker jest `note`, a verdict APPROVE — naglowek nie moze udawac zamknietej recenzji (2026-10-27).
  const pending = (result.needs_verification || []).length;
  const shown = pending && result.verdict === VERDICT.APPROVE ? `${result.verdict} (wstepnie — ${pending} do weryfikacji)` : result.verdict;
  const lines = [`# pg-review · agregacja (${result.roles.join(', ') || 'brak rol'}) — ${shown}`, ''];
  if (result.incomplete.length) lines.push('**INCOMPLETE — recenzja nie jest kompletna, werdykt nie moze byc APPROVE:**', ...result.incomplete.map((x) => `- ${x}`), '');
  lines.push(`Findings: ${result.stats.total} zgloszonych, ${result.stats.rejected} odrzuconych (brak dowodu/pol), ${result.stats.groups} po dedupe.`);
  lines.push(`Decyzje: ${result.stats.blocker} blocker, ${result.stats.must_fix} must_fix, ${result.stats.note} note, ${result.stats.dropped} dropped (weryfikator)${pending ? `, ${pending} czeka na weryfikatora (--final)` : ''}.`, '');
  for (const g of result.findings) {
    lines.push(`- **[${g.decision}] ${g.severity} ${g.rule_id}** ${g.file}:${g.line_range[0]}-${g.line_range[1]} (zgoda: ${g.roles.join('+')}${g.verdict ? `, verifier: ${g.verdict}` : ''})`);
    lines.push(`  ${g.claim}`);
    lines.push(`  dowod: ${String(g.evidence).split('\n')[0].slice(0, 200)}`);
    if (g.verifier_reason) lines.push(`  verifier: ${g.verifier_reason}`);
  }
  if (result.rejected.length) {
    lines.push('', '## Odrzucone przez agregator (bez dowodu — nie licza sie)');
    for (const r of result.rejected.slice(0, 20)) lines.push(`- ${r.why}${r.finding ? `: ${String(r.finding.claim || '').slice(0, 120)}` : ''}`);
  }
  if ((result.read_gaps || []).length) {
    lines.push('', '## Pokrycie czytania (observe — nie zmienia werdyktu)');
    for (const g of result.read_gaps) lines.push(`- ${g.role}: ${g.error ? `blad sprawdzenia: ${g.error}` : g.missing_field ? 'brak pola files_read' : `nie przeczytal: ${g.unread.slice(0, 10).join(', ')}${g.unread.length > 10 ? ` (+${g.unread.length - 10})` : ''}`}`);
  }
  if (result.questions.length) { lines.push('', '## Pytania do czlowieka'); for (const q of result.questions) lines.push(`- ${q}`); }
  return lines.join('\n') + '\n';
}

// opts: { requiredRoles: ['code','ops'], final: bool }
function aggregate(dir, verdictsPath, opts) {
  const o = opts || {};
  const files = fs.readdirSync(dir).filter((f) => /^findings\.[\w-]+\.json$/.test(f)).map((f) => path.join(dir, f));
  const all = [];
  const rejected = [];
  const roles = [];
  const questions = [];
  const incomplete = [];
  const roleFiles = [];
  if (!files.length) incomplete.push('0 plikow findings.<rola>.json w katalogu przebiegu');
  for (const file of files) {
    const { role, valid, rejected: rej, broken } = validateRoleFile(file);
    if (broken) incomplete.push(`findings.${role}.json nieparsowalny/bez tablicy findings`);
    else roles.push(role);
    all.push(...valid);
    rejected.push(...rej);
    const data = readJson(file);
    if (!broken) roleFiles.push({ role, data });
    if (data && Array.isArray(data.questions)) questions.push(...data.questions.map((q) => `[${role}] ${q}`));
  }
  const missingRoles = (o.requiredRoles || []).filter((r) => !roles.includes(r));
  if (missingRoles.length) incomplete.push(`brak wymaganych rol: ${missingRoles.join(', ')}`);
  const groups = dedupe(all);
  if (verdictsPath && fs.existsSync(verdictsPath)) {
    const v = readJson(verdictsPath);
    if (!v || !Array.isArray(v.verdicts)) incomplete.push('verdicts.json nieparsowalny/bez tablicy verdicts');
    else incomplete.push(...applyVerdicts(groups, v));
  }
  const findings = decide(groups);
  const needsVerification = findings.flatMap((g) => g.verify_ids);
  if (o.final && needsVerification.length) incomplete.push(`${needsVerification.length} finding(ow) wymaga weryfikacji, brak werdyktu`);
  const count = (d) => findings.filter((g) => g.decision === d).length;
  const verdict = incomplete.length ? VERDICT.INCOMPLETE : count('blocker') || count('must_fix') ? VERDICT.REQUEST_CHANGES : VERDICT.APPROVE;
  return {
    roles, findings, rejected, questions, incomplete, required_roles: o.requiredRoles || [],
    stats: { total: all.length + rejected.length, rejected: rejected.length, groups: groups.length, blocker: count('blocker'), must_fix: count('must_fix'), note: count('note'), dropped: count('dropped') },
    needs_verification: needsVerification,
    read_gaps: readGaps(dir, roleFiles),
    verdict,
    generated_at: new Date().toISOString(),
  };
}

function requiredRolesFromArgs(args) {
  const ti = args.indexOf('--tier');
  const ri = args.indexOf('--required');
  if (ri >= 0) return String(args[ri + 1] || '').split(',').map((s) => roleOfAgent(s.trim())).filter(Boolean);
  if (ti >= 0) return (REVIEWERS_BY_TIER[String(args[ti + 1] || '').toUpperCase()] || []).map(roleOfAgent);
  return [];
}

module.exports = { aggregate, readGaps, dedupe, validateRoleFile, decide, roleOfAgent, requiredRolesFromArgs, MIN_AGREEMENT_FOR_BLOCKER, VERDICT };

if (require.main === module) {
  const args = process.argv.slice(2);
  const dir = args.find((a) => !a.startsWith('--'));
  if (!dir || !fs.existsSync(dir)) { console.error('uzycie: pg-aggregate.js <dir z findings.*.json> [--verdicts <plik>] [--json]'); process.exit(2); }
  const verdictsIdx = args.indexOf('--verdicts');
  const result = aggregate(dir, verdictsIdx >= 0 ? args[verdictsIdx + 1] : path.join(dir, 'verdicts.json'), { requiredRoles: requiredRolesFromArgs(args), final: args.includes('--final') });
  // --repo: ktorego repo dotyczy przebieg. stop-gate dopasowuje agregacje do repo (sesja 2026-09-26: przy 2 repo w jednej
  // sesji ostatnia agregacja jednego repo blokowala drugie — „ping-pong").
  const repoIdx = args.indexOf('--repo');
  if (repoIdx >= 0 && args[repoIdx + 1]) result.repo = path.resolve(args[repoIdx + 1]);
  fs.writeFileSync(path.join(dir, 'aggregated.json'), JSON.stringify(result, null, 2));
  // Plan F observe: luka czytania = would_block w gates.jsonl (widoczna w guard_health, linia info; gate_effectiveness liczy
  // tylko git-hooki). Tylko z --final: wstepna agregacja tego samego RUN nie dubluje wpisu (A18 code). reason = rodzaj luki
  // (malo wartosci, liczy sie w top-N guard_health), szczegoly per rola w `detail`.
  if (args.includes('--final') && result.read_gaps.length) {
    const kind = (g) => (g.error ? 'error' : g.missing_field ? 'no-field' : 'unread');
    // Telemetria nie zmienia werdyktu, ale jej brak ma byc widoczny: blad require (A18) i blad zapisu — log() zwraca false (A19).
    let written = false, why = 'blad zapisu';
    try {
      written = require(path.join(__dirname, '..', 'hooks', 'lib', 'gate-log.js')).log({ hook: 'pg-aggregate', event: 'would_block', gate: 'files-read',
        reason: [...new Set(result.read_gaps.map(kind))].sort().join('+'), target: result.repo || dir,
        detail: result.read_gaps.map((g) => `${g.role}:${g.missing_field ? 'no-field' : g.error ? 'error' : g.unread.length}`).join(',') }) === true;
    } catch (e) { why = String(e && e.message); }
    if (!written) console.error(`pg-aggregate: wpis files-read do gates.jsonl nie zapisany: ${why}`);
  }
  fs.writeFileSync(path.join(dir, 'aggregated.md'), renderMarkdown(result));
  process.stdout.write(args.includes('--json') ? JSON.stringify(result, null, 2) : renderMarkdown(result));
  process.exit(result.verdict === VERDICT.APPROVE ? 0 : result.verdict === VERDICT.INCOMPLETE ? 3 : 1);
}

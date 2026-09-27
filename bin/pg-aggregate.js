#!/usr/bin/env node
'use strict';
// Agregator findings z recenzentow dzialowych (0 tokenow). Czesc [A] i regula decyzji z pg-review.
// Wejscie: katalog z findings.<rola>.json (+ opcjonalnie verdicts.json weryfikatora).
// Zasady (research A9: agregacja niezaleznych przebiegow +43,67 % F1 vs pojedynczy; debata NIE):
//  1. finding bez `evidence` LUB bez `repro_cmd` jest ODRZUCANY — twierdzenie bez dowodu nie istnieje,
//  2. dedupe po (plik, zakres linii +-LINE_TOLERANCE, rule_id); agreement = liczba roznych rol,
//  3. blocker = agreement >= MIN_AGREEMENT_FOR_BLOCKER LUB (agreement == 1 i weryfikator `reproduced`),
//  4. agreement == 1 bez potwierdzenia -> `note` (trafia do raportu, nigdy nie blokuje),
//  5. severity = MAX z zgadzajacych sie finderow (nigdy srednia); weryfikator moze tylko obnizyc.
//  6. (landscape #1, fail-closed) werdykt INCOMPLETE (exit 3) — nie APPROVE — gdy: 0 plikow findings, plik nieparsowalny
//     / bez tablicy, brakuje roli wymaganej dla tieru, werdykt weryfikatora z nieznanym/zduplikowanym finding_id,
//     a z --final: finding wymagajacy weryfikacji bez werdyktu. Rola = z NAZWY pliku (pole `role` moglo zawyzyc k-of-n).
// Uzycie: node pg-aggregate.js <dir> --repo <sciezka repo> [--tier T2|T3 | --required code,ops] [--final] [--verdicts <plik>] [--json]
const fs = require('fs');
const path = require('path');
const { REVIEWERS_BY_TIER } = require(path.join(__dirname, '..', 'hooks', 'lib', 'risk-tier.js'));

// Agent `code-reviewer` pisze findings.code.json -> rola `code`. Jedno mapowanie dla tieru i dla stop-gate.
const roleOfAgent = (agent) => String(agent).replace(/-reviewer$/, '');

const LINE_TOLERANCE = 3;
const MIN_AGREEMENT_FOR_BLOCKER = 2;
// Werdykty agregacji — jedno zrodlo prawdy, czyta je tez stop-gate (dup-literals 2026-09-27).
const VERDICT = Object.freeze({ APPROVE: 'APPROVE', REQUEST_CHANGES: 'REQUEST CHANGES', INCOMPLETE: 'INCOMPLETE' });
const SEVERITY_RANK = { blocker: 3, major: 2, minor: 1 };
const REQUIRED_FIELDS = ['file', 'rule_id', 'severity', 'claim', 'evidence', 'repro_cmd'];

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
    if (!SEVERITY_RANK[f.severity]) { rejected.push({ finding: f, why: `severity '${f.severity}' poza {blocker,major,minor}` }); return; }
    const range = Array.isArray(f.line_range) && f.line_range.length === 2 ? f.line_range.map(Number) : [0, 0];
    valid.push(Object.assign({}, f, { role, line_range: range, id: `${role}-${idx + 1}` }));
  });
  return { role, valid, rejected };
}

const sameFile = (a, b) => a.file.replace(/\\/g, '/').toLowerCase() === b.file.replace(/\\/g, '/').toLowerCase();
const overlaps = (a, b) => a[0] <= b[1] + LINE_TOLERANCE && b[0] <= a[1] + LINE_TOLERANCE;
const maxSeverity = (a, b) => (SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b);

function dedupe(findings) {
  const groups = [];
  for (const f of findings) {
    const group = groups.find((g) => g.rule_id === f.rule_id && sameFile(g, f) && overlaps(g.line_range, f.line_range));
    if (!group) { groups.push({ ...f, roles: [f.role], member_ids: [f.id], line_range: [...f.line_range] }); continue; }
    if (!group.roles.includes(f.role)) group.roles.push(f.role);
    group.member_ids.push(f.id);
    group.severity = maxSeverity(group.severity, f.severity);
    group.line_range = [Math.min(group.line_range[0], f.line_range[0]), Math.max(group.line_range[1], f.line_range[1])];
    group.confidence = Math.max(Number(group.confidence) || 0, Number(f.confidence) || 0);
  }
  return groups.map((g) => Object.assign(g, { agreement: g.roles.length }));
}

// Zwraca liste problemow z werdyktami (nieznane / zduplikowane id) — kazdy = INCOMPLETE, bo nie wiemy, co zweryfikowano.
function applyVerdicts(groups, verdicts) {
  const problems = [];
  const known = new Set(groups.flatMap((g) => g.member_ids));
  const byId = new Map();
  for (const v of (verdicts && verdicts.verdicts) || []) {
    if (!known.has(v.finding_id)) { problems.push(`werdykt dla nieznanego finding_id ${v.finding_id}`); continue; }
    if (byId.has(v.finding_id)) { problems.push(`zduplikowany werdykt dla ${v.finding_id}`); continue; }
    byId.set(v.finding_id, v);
  }
  for (const g of groups) {
    const verdict = g.member_ids.map((id) => byId.get(id)).find(Boolean);
    if (!verdict) continue;
    g.verdict = verdict.verdict;
    if (verdict.severity_after && SEVERITY_RANK[verdict.severity_after] && SEVERITY_RANK[verdict.severity_after] < SEVERITY_RANK[g.severity]) g.severity = verdict.severity_after;
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
    g.needs_verification = !g.verdict && (g.agreement === 1 || g.severity === 'blocker');
  }
  const order = { blocker: 0, must_fix: 1, note: 2, dropped: 3 };
  return groups.sort((a, b) => order[a.decision] - order[b.decision] || SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
}

function renderMarkdown(result) {
  const lines = [`# pg-review · agregacja (${result.roles.join(', ') || 'brak rol'}) — ${result.verdict}`, ''];
  if (result.incomplete.length) lines.push('**INCOMPLETE — recenzja nie jest kompletna, werdykt nie moze byc APPROVE:**', ...result.incomplete.map((x) => `- ${x}`), '');
  lines.push(`Findings: ${result.stats.total} zgloszonych, ${result.stats.rejected} odrzuconych (brak dowodu/pol), ${result.stats.groups} po dedupe.`);
  lines.push(`Decyzje: ${result.stats.blocker} blocker, ${result.stats.must_fix} must_fix, ${result.stats.note} note, ${result.stats.dropped} dropped (weryfikator).`, '');
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
  if (!files.length) incomplete.push('0 plikow findings.<rola>.json w katalogu przebiegu');
  for (const file of files) {
    const { role, valid, rejected: rej, broken } = validateRoleFile(file);
    if (broken) incomplete.push(`findings.${role}.json nieparsowalny/bez tablicy findings`);
    else roles.push(role);
    all.push(...valid);
    rejected.push(...rej);
    const data = readJson(file);
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
  const needsVerification = findings.filter((g) => g.needs_verification).map((g) => g.id);
  if (o.final && needsVerification.length) incomplete.push(`${needsVerification.length} finding(ow) wymaga weryfikacji, brak werdyktu`);
  const count = (d) => findings.filter((g) => g.decision === d).length;
  const verdict = incomplete.length ? VERDICT.INCOMPLETE : count('blocker') || count('must_fix') ? VERDICT.REQUEST_CHANGES : VERDICT.APPROVE;
  return {
    roles, findings, rejected, questions, incomplete, required_roles: o.requiredRoles || [],
    stats: { total: all.length + rejected.length, rejected: rejected.length, groups: groups.length, blocker: count('blocker'), must_fix: count('must_fix'), note: count('note'), dropped: count('dropped') },
    needs_verification: needsVerification,
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

module.exports = { aggregate, dedupe, validateRoleFile, decide, roleOfAgent, requiredRolesFromArgs, MIN_AGREEMENT_FOR_BLOCKER, VERDICT };

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
  fs.writeFileSync(path.join(dir, 'aggregated.md'), renderMarkdown(result));
  process.stdout.write(args.includes('--json') ? JSON.stringify(result, null, 2) : renderMarkdown(result));
  process.exit(result.verdict === VERDICT.APPROVE ? 0 : result.verdict === VERDICT.INCOMPLETE ? 3 : 1);
}

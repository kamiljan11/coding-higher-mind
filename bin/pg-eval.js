#!/usr/bin/env node
'use strict';
// pg-eval: golden suite bramek 0-tokenowych PG (2026-09-05). Odpowiada na pytanie „czy nasze bramki
// nadal lapia blizny floty i NIE flaguja czystego kodu" — deterministycznie, bez modelu, w sekundach.
// Metryki: recall (pozytywy zlapane), FP-rate (negatywy blednie flagowane), $0-gate coverage.
// Kadencja (pg/models.md): po kazdej edycji narzedzia/bramki, przed zmiana modelu, raz w miesiacu (guard-health).
// Uzycie: node pg-eval.js [--json] [--cases <plik>]   Exit 1 = regresja (jakikolwiek case nie przeszedl).
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const DEFAULT_CASES = path.join(CLAUDE_DIR, 'pg', 'eval', 'cases.json');
const SQL_LINT = path.join(CLAUDE_DIR, 'bin', 'sql-migration-lint.js');
const FLEET_METRICS = path.join(CLAUDE_DIR, 'bin', 'fleet-metrics.js');
const { classify } = require(path.join(CLAUDE_DIR, 'hooks', 'lib', 'risk-tier.js'));
const TOOL_TIMEOUT_MS = 60000;

// Wzorzec sekretow czytamy Z PRE-COMMITA (jedno zrodlo prawdy) — kopia w evalu dryfowala (brak `gho_`,
// finding dogfood 2026-09-05) i golden suite poswiadczal pokrycie, ktorego bramka nie miala.
function secretPatternFromPreCommit() {
  const hook = fs.readFileSync(path.join(CLAUDE_DIR, 'git-hooks', 'pre-commit'), 'utf8');
  const match = hook.match(/grep -nE '([^']+)'/);
  if (!match) throw new Error('pre-commit: nie znaleziono wzorca sekretow (grep -nE)');
  return new RegExp('^\\+.*(' + match[1] + ')', 'm');
}
// Te same wzorce, ktore egzekwuja pre-commit (sekrety) i DoD G7/G8 (suppression, test razem z kodem).
const DIFF_PATTERNS = {
  suppression: /^\+.*(eslint-disable|@ts-ignore|@ts-expect-error|\bnoqa\b|as any)/m,
  secret: secretPatternFromPreCommit(),
};

function runTool(script, args) {
  return execFileSync('node', [script, ...args], { encoding: 'utf8', timeout: TOOL_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'pipe'] });
}

// Sekrety moga byc sklejane z kawalkow (`"sbp_" + "..."`) — bramka patrzy na linie po usunieciu cudzyslowow i plusow.
const joinStringPieces = (text) => text.replace(/"\s*\+\s*"/g, '').replace(/'\s*\+\s*'/g, '');

function gateSqlLint(caseDir, expect) {
  const out = runTool(SQL_LINT, ['--repo', caseDir, '--min-severity', 'high']);
  const highIds = [...out.matchAll(/^\[HIGH\] (R\d+) /gm)].map((m) => m[1]);
  if (expect.check === null) return { hit: highIds.length > 0, detail: highIds.join(',') || 'brak HIGH' };
  return { hit: highIds.includes(expect.check), detail: highIds.join(',') || 'brak HIGH' };
}

const getPath = (obj, dotted) => dotted.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);

function gateFleetMetrics(caseDir, expect) {
  const metrics = JSON.parse(runTool(FLEET_METRICS, ['--repo', caseDir, '--json']));
  if (expect.paths) {
    const flagged = expect.paths.filter((p) => Number(getPath(metrics, p)) > expect.max);
    return { hit: flagged.length > 0, detail: flagged.length ? `flagowane: ${flagged.join(',')}` : 'czysto' };
  }
  const value = Number(getPath(metrics, expect.path));
  return { hit: value >= expect.min, detail: `${expect.path}=${value}` };
}

function testEditedWithCode(diff) {
  const files = [...diff.matchAll(/^\+\+\+ b\/(.+)$/gm)].map((m) => m[1]);
  const tests = files.filter((f) => /\.(test|spec)\./.test(f));
  const sources = new Set(files.filter((f) => !/\.(test|spec)\./.test(f)));
  return tests.some((t) => sources.has(t.replace(/\.(test|spec)\./, '.')));
}

function gateDiffGrep(caseDir, expect) {
  const diff = fs.readFileSync(path.join(caseDir, 'diff.patch'), 'utf8');
  const hits = [];
  if (DIFF_PATTERNS.suppression.test(diff)) hits.push('suppression');
  if (DIFF_PATTERNS.secret.test(joinStringPieces(diff))) hits.push('secret');
  if (testEditedWithCode(diff)) hits.push('test-with-code');
  if (expect.pattern === null) return { hit: hits.length > 0, detail: hits.join(',') || 'czysto' };
  return { hit: hits.includes(expect.pattern), detail: hits.join(',') || 'brak' };
}

function gateRiskTier(caseDir, expect) {
  const verdict = classify(expect.files.map((f) => path.join(caseDir, f)), expect.lines, caseDir);
  const tierOk = verdict.tier === expect.tier;
  const reviewerOk = !expect.reviewer || verdict.reviewers.includes(expect.reviewer);
  // Dla negatywu (T0) „hit" = falszywa eskalacja: cokolwiek powyzej oczekiwanego tieru albo jacykolwiek recenzenci.
  return { hit: expect.tier === 'T0' ? verdict.tier !== 'T0' || verdict.reviewers.length > 0 : tierOk && reviewerOk, detail: `${verdict.tier} [${verdict.reviewers.join(',')}]` };
}

// bash-guard (landscape #4): ta sama funkcja evaluate(), ktora blokuje w hooku. `disabled` = mutant z pg-mutate.js.
// Token ALLOW_* bez zgody uzytkownika to w hooku blokada `override-required` — tu liczony tak samo.
const { evaluate: evaluateBash, RULES: BASH_RULES } = require(path.join(CLAUDE_DIR, 'hooks', 'lib', 'bash-rules.js'));
const EVAL_CWD = path.join(os.homedir(), 'Desktop', 'pg-eval-project'); // zwykly katalog projektu: nie %TEMP%, nie ~/.claude
function gateBashGuard(caseDir, expect, opts) {
  const r = evaluateBash(expect.command, {
    dialect: expect.dialect || 'sh', cwd: expect.cwd || EVAL_CWD, agentType: expect.agent_type || null,
    disabled: (opts && opts.disabled) || new Set(), exists: () => expect.exists !== false,
  });
  const blockIds = r.blocks.map((b) => b.id);
  if (r.tokens.length && !(opts && opts.disabled && opts.disabled.has('override-required'))) blockIds.push('override-required');
  const observeIds = r.observes.map((o) => o.id);
  const ids = blockIds.concat(observeIds);
  const hit = expect.rule ? ids.includes(expect.rule) : ids.length > 0;
  // Trafienie reguly w trybie observe to wykrycie, NIE blokada (data-review 2026-09-26) — raport liczy je osobno.
  const observeOnly = hit && !(expect.rule ? blockIds.includes(expect.rule) : blockIds.length > 0);
  return { hit, observeOnly, detail: (ids.join(',') || 'przepuszczone') + (observeOnly ? ' (observe)' : '') };
}
const PSEUDO_RULES = ['override-required', 'unparseable']; // reguly hooka spoza tablicy RULES

const GATES = { 'sql-lint': gateSqlLint, 'fleet-metrics': gateFleetMetrics, 'diff-grep': gateDiffGrep, 'risk-tier': gateRiskTier, 'bash-guard': gateBashGuard };

// Kontrakt korpusu (landscape #4: „a check that finds nothing must fail" — OCR check-plugin-contract): pusty korpus,
// zduplikowane id, bramka bez negatywu, regula bash-guard bez przypadku block ORAZ allow = korpus nie swiadczy o niczym.
function contractErrors(cases) {
  const errors = [];
  if (!cases.length) errors.push('pusty korpus (0 przypadkow)');
  const ids = cases.map((c) => c.id);
  const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dup.length) errors.push(`zduplikowane id: ${[...new Set(dup)].join(', ')}`);
  for (const gate of new Set(cases.map((c) => c.gate))) {
    const g = cases.filter((c) => c.gate === gate);
    if (!g.some((c) => c.positive)) errors.push(`bramka ${gate}: brak pozytywu`);
    if (!g.some((c) => !c.positive)) errors.push(`bramka ${gate}: brak negatywu`);
  }
  if (cases.some((c) => c.gate === 'bash-guard')) {
    const ruleIds = BASH_RULES.map((r) => r.id);
    const dupRules = ruleIds.filter((id, i) => ruleIds.indexOf(id) !== i);
    if (dupRules.length) errors.push(`bash-rules: zduplikowane id regul ${dupRules.join(', ')}`);
    for (const id of [...ruleIds, ...PSEUDO_RULES]) {
      const mine = cases.filter((c) => c.gate === 'bash-guard' && c.expect.rule === id);
      if (!mine.some((c) => c.positive)) errors.push(`bash-guard regula ${id}: brak przypadku block`);
      if (!mine.some((c) => !c.positive) && id !== 'unparseable') errors.push(`bash-guard regula ${id}: brak przypadku allow`);
    }
  }
  return errors;
}

function evaluate(casesFile, opts) {
  const suite = JSON.parse(fs.readFileSync(casesFile, 'utf8'));
  const casesRoot = path.join(path.dirname(casesFile), 'cases');
  const results = [];
  const cases = Array.isArray(suite.cases) ? suite.cases : [];
  const contract = contractErrors(cases);
  for (const c of cases) {
    // Przypadek przywiazany do systemu (np. nazwy 8.3 i dyski C: tylko na Windowsie) — na innym systemie pomijany.
    if (c.platform && !['win32', 'linux', 'darwin'].includes(c.platform)) throw new Error(`pg-eval: przypadek ${c.id} ma nieznane platform="${c.platform}" (literowka = cichy skip)`);
    if (c.platform && c.platform !== process.platform) continue;
    const caseDir = path.join(casesRoot, c.id);
    let outcome;
    try {
      const gate = GATES[c.gate];
      if (!gate) throw new Error(`nieznana bramka ${c.gate}`);
      const { hit, detail, observeOnly } = gate(caseDir, c.expect, opts);
      outcome = { pass: c.positive ? hit : !hit, hit, detail, observeOnly: !!observeOnly };
    } catch (e) {
      outcome = { pass: false, hit: false, detail: `blad: ${String(e.message || e).split('\n')[0].slice(0, 120)}` };
    }
    results.push(Object.assign({ id: c.id, rule_id: c.rule_id, gate: c.gate, positive: c.positive }, outcome));
  }
  const positives = results.filter((r) => r.positive);
  const negatives = results.filter((r) => !r.positive);
  const recall = positives.length ? positives.filter((r) => r.hit).length / positives.length : 1;
  const enforceRecall = positives.length ? positives.filter((r) => r.hit && !r.observeOnly).length / positives.length : 1;
  const falsePositiveRate = negatives.length ? negatives.filter((r) => r.hit).length / negatives.length : 0;
  const failed = results.filter((r) => !r.pass).map((r) => r.id);
  return { results, recall, enforceRecall, falsePositiveRate, zeroTokenCoverage: recall, failed: failed.concat(contract.map((e) => 'KONTRAKT: ' + e)), contract };
}

function render(report) {
  const lines = ['pg-eval · golden suite bramek 0-tokenowych', ''];
  for (const r of report.results) lines.push(`${r.pass ? 'ok  ' : 'FAIL'} ${r.id.padEnd(24)} ${r.gate.padEnd(14)} ${(r.positive ? 'pozytyw' : 'negatyw').padEnd(8)} ${r.detail}`);
  lines.push('', `recall (pozytywy zlapane): ${(report.recall * 100).toFixed(0)} % (w tym blokada: ${(report.enforceRecall * 100).toFixed(0)} %, reszta = tryb observe)`, `FP-rate (negatywy flagowane): ${(report.falsePositiveRate * 100).toFixed(0)} %`, `$0-gate coverage: ${(report.zeroTokenCoverage * 100).toFixed(0) } %`);
  lines.push(report.failed.length ? `REGRESJA: ${report.failed.join(', ')}` : 'GOLDEN SUITE: wszystkie OK');
  return lines.join('\n') + '\n';
}

module.exports = { evaluate, contractErrors, DIFF_PATTERNS, testEditedWithCode, PSEUDO_RULES };

if (require.main === module) {
  const args = process.argv.slice(2);
  const casesIdx = args.indexOf('--cases');
  const report = evaluate(casesIdx >= 0 ? args[casesIdx + 1] : DEFAULT_CASES);
  process.stdout.write(args.includes('--json') ? JSON.stringify(report, null, 2) + '\n' : render(report));
  process.exit(report.failed.length ? 1 : 0);
}

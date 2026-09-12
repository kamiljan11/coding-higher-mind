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

const GATES = { 'sql-lint': gateSqlLint, 'fleet-metrics': gateFleetMetrics, 'diff-grep': gateDiffGrep, 'risk-tier': gateRiskTier };

function evaluate(casesFile) {
  const suite = JSON.parse(fs.readFileSync(casesFile, 'utf8'));
  const casesRoot = path.join(path.dirname(casesFile), 'cases');
  const results = [];
  for (const c of suite.cases) {
    const caseDir = path.join(casesRoot, c.id);
    let outcome;
    try {
      const gate = GATES[c.gate];
      if (!gate) throw new Error(`nieznana bramka ${c.gate}`);
      const { hit, detail } = gate(caseDir, c.expect);
      outcome = { pass: c.positive ? hit : !hit, hit, detail };
    } catch (e) {
      outcome = { pass: false, hit: false, detail: `blad: ${String(e.message || e).split('\n')[0].slice(0, 120)}` };
    }
    results.push(Object.assign({ id: c.id, rule_id: c.rule_id, gate: c.gate, positive: c.positive }, outcome));
  }
  const positives = results.filter((r) => r.positive);
  const negatives = results.filter((r) => !r.positive);
  const recall = positives.length ? positives.filter((r) => r.hit).length / positives.length : 1;
  const falsePositiveRate = negatives.length ? negatives.filter((r) => r.hit).length / negatives.length : 0;
  return { results, recall, falsePositiveRate, zeroTokenCoverage: recall, failed: results.filter((r) => !r.pass).map((r) => r.id) };
}

function render(report) {
  const lines = ['pg-eval · golden suite bramek 0-tokenowych', ''];
  for (const r of report.results) lines.push(`${r.pass ? 'ok  ' : 'FAIL'} ${r.id.padEnd(24)} ${r.gate.padEnd(14)} ${(r.positive ? 'pozytyw' : 'negatyw').padEnd(8)} ${r.detail}`);
  lines.push('', `recall (pozytywy zlapane): ${(report.recall * 100).toFixed(0)} %`, `FP-rate (negatywy flagowane): ${(report.falsePositiveRate * 100).toFixed(0)} %`, `$0-gate coverage: ${(report.zeroTokenCoverage * 100).toFixed(0) } %`);
  lines.push(report.failed.length ? `REGRESJA: ${report.failed.join(', ')}` : 'GOLDEN SUITE: wszystkie OK');
  return lines.join('\n') + '\n';
}

module.exports = { evaluate, DIFF_PATTERNS, testEditedWithCode };

if (require.main === module) {
  const args = process.argv.slice(2);
  const casesIdx = args.indexOf('--cases');
  const report = evaluate(casesIdx >= 0 ? args[casesIdx + 1] : DEFAULT_CASES);
  process.stdout.write(args.includes('--json') ? JSON.stringify(report, null, 2) + '\n' : render(report));
  process.exit(report.failed.length ? 1 : 0);
}

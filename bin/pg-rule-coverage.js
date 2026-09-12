#!/usr/bin/env node
// pg-rule-coverage: czy kazda regula "= error/blocker" z pg/paradigm.md ma bramke w hookach/szablonach.
//
// Blizna 2026-09-06: paradigm.md:43 mowil "B006 (mutable default) = error", a zaden hook ani szablon
// nie wlaczal regul B w ruffie — regula istniala tylko na papierze przez 2 dni. To jest klasa bledu
// "system zbudowany z ograniczona wiedza": dokument opisuje bramke, ktorej nie ma. Ten skrypt
// zamienia to w test: identyfikatory regul w paradigm.md (w backtickach, np. `B006`,
// `no-magic-numbers`, `max-classes-per-file`, `noUncheckedIndexedAccess`) musza wystepowac w
// plikach wykonawczych (hooks/, git-hooks/, templates/, tools/). Brak = NIEPOKRYTA regula.
//
// Uzycie: node ~/.claude/bin/pg-rule-coverage.js [--json]   (exit 1 gdy sa niepokryte)
// Ignorowane celowo: identyfikatory, ktore sa komendami/narzedziami, nie regulami (lista IGNORE).

'use strict';
const fs = require('node:fs');
const path = require('node:path');

const HOME = process.env.HOME || process.env.USERPROFILE;
const ROOT = path.join(HOME, '.claude');
const PARADIGM = path.join(ROOT, 'pg', 'paradigm.md');
const ENFORCERS = ['hooks', 'git-hooks', 'templates', 'tools', 'bin'].map((d) => path.join(ROOT, d));
// Reguly rozpoznajemy po identyfikatorach linterow/kompilatora: KOD (B006, E501), kebab-case (no-explicit-any),
// camelCase flagi tsconfig (noUncheckedIndexedAccess), z prefiksem pluginu (@typescript-eslint/x, vitest/x).
const RULE_ID_RX = /`((?:@[a-z-]+\/)?(?:[A-Z]{1,3}\d{3,4}|[a-z]+(?:-[a-z0-9]+)+(?:\/[a-z-]+)?|no[A-Z][A-Za-z]+|exactOptionalPropertyTypes|strict))`/g;
const IGNORE = new Set(['rg', 'git', 'tsc', 'node', 'npm', 'main', 'strict']);

function readAll(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('_bak') || e.name === '.ruff_cache') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) readAll(p, acc);
    else if (/\.(js|mjs|cjs|py|sh|yml|yaml|json|mjs|toml|cfg|ini)$|^pre-(commit|push)$|^commit-msg$/.test(e.name) || !path.extname(e.name)) acc.push(p);
  }
  return acc;
}

function rulesFromParadigm(text) {
  const rules = new Map(); // id -> line no
  text.split('\n').forEach((line, i) => {
    // tylko wiersze, ktore deklaruja egzekwowanie: "= error", "blocker", kolumna "Egzekwuje/Bramka" w tabeli (3. kolumna)
    const enforcing = /= ?error|blocker|error\)|\|\s*`[^`]+`[^|]*\|\s*$/.test(line) || (line.startsWith('|') && line.split('|').length >= 4);
    if (!enforcing) return;
    for (const m of line.matchAll(RULE_ID_RX)) if (!IGNORE.has(m[1])) rules.set(m[1], i + 1);
  });
  return rules;
}

function main() {
  const json = process.argv.includes('--json');
  const paradigm = fs.readFileSync(PARADIGM, 'utf8');
  const rules = rulesFromParadigm(paradigm);
  const corpus = readAll.call(null, ROOT, []) && ENFORCERS.flatMap((d) => readAll(d)).map((p) => ({ p, t: fs.readFileSync(p, 'utf8') }));
  const report = [];
  for (const [id, line] of rules) {
    const hits = corpus.filter(({ t }) => t.includes(id)).map(({ p }) => path.relative(ROOT, p));
    report.push({ rule: id, paradigm_line: line, covered: hits.length > 0, enforced_in: hits.slice(0, 3) });
  }
  const uncovered = report.filter((r) => !r.covered);
  if (json) { process.stdout.write(JSON.stringify({ rules: report.length, uncovered }, null, 1) + '\n'); return uncovered.length ? 1 : 0; }
  console.log(`pg-rule-coverage: ${report.length} regul z paradigm.md, niepokrytych: ${uncovered.length}`);
  for (const r of report) console.log(`  ${r.covered ? 'ok  ' : 'BRAK'} ${r.rule.padEnd(32)} paradigm.md:${r.paradigm_line}${r.covered ? '  <- ' + r.enforced_in[0] : ''}`);
  if (uncovered.length) console.log('Regula bez bramki = regula na papierze. Dodaj do hooka/szablonu albo wykresl z paradigm.md.');
  return uncovered.length ? 1 : 0;
}

if (require.main === module) process.exit(main());
module.exports = { rulesFromParadigm };

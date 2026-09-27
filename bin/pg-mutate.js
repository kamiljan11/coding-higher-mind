#!/usr/bin/env node
'use strict';
// pg-mutate (landscape #4): testy mutacyjne bash-guard. Dla kazdej reguly: wylacz ja (in-process, parametr `disabled`
// funkcji evaluate — bez zadnego przelacznika w hooku ani w env) i sprawdz, czy golden suite to zauwazy.
// Mutant „przezyl" = regule mozna by usunac, a zaden test by nie zczerwienial -> regula nie ma realnej kontroli
// (bram-wq evaluate.mjs: 6/6 mutantow zabitych). Exit 1, gdy jakikolwiek mutant przezyl. 0 tokenow.
// Uzycie: node pg-mutate.js [--cases <plik>] [--json]
const os = require('os');
const path = require('path');

const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const { evaluate, PSEUDO_RULES } = require(path.join(CLAUDE_DIR, 'bin', 'pg-eval.js'));
const { RULES } = require(path.join(CLAUDE_DIR, 'hooks', 'lib', 'bash-rules.js'));

function main() {
  const args = process.argv.slice(2);
  const ci = args.indexOf('--cases');
  const casesFile = ci >= 0 ? args[ci + 1] : path.join(CLAUDE_DIR, 'pg', 'eval', 'cases.json');
  const baseline = evaluate(casesFile);
  if (baseline.failed.length) {
    process.stdout.write(`pg-mutate: golden suite nie jest zielony (${baseline.failed.join(', ')}) — najpierw napraw pg-eval.\n`);
    return 1;
  }
  const mutants = [...RULES.map((r) => r.id), ...PSEUDO_RULES];
  const results = mutants.map((id) => {
    const report = evaluate(casesFile, { disabled: new Set([id]) });
    const killedBy = report.results.filter((r) => r.gate === 'bash-guard' && !r.pass).map((r) => r.id);
    return { mutant: id, killed: killedBy.length > 0, killedBy };
  });
  const survived = results.filter((r) => !r.killed);
  if (args.includes('--json')) process.stdout.write(JSON.stringify({ total: results.length, survived: survived.map((s) => s.mutant), results }, null, 2) + '\n');
  else {
    for (const r of results) process.stdout.write(`${r.killed ? 'zabity  ' : 'PRZEZYL '} ${r.mutant.padEnd(18)} ${r.killed ? 'przez ' + r.killedBy.slice(0, 3).join(', ') : 'zaden test nie zauwazyl wylaczenia reguly'}\n`);
    process.stdout.write(`pg-mutate: ${results.length - survived.length}/${results.length} mutantow zabitych${survived.length ? ` — PRZEZYLY: ${survived.map((s) => s.mutant).join(', ')}` : ''}\n`);
  }
  return survived.length ? 1 : 0;
}

process.exit(main());

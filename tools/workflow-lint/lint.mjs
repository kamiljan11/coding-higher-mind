// gh-workflow-lint: walidacja plikow workflow TYM SAMYM parserem, ktorego uzywa GitHub (github/actions-languageservices).
// Lapie to, czego YAML nie widzi: `secrets` w job-level `if`, zle klucze, zle typy — czyli "run nazwany sciezka pliku".
// Uzycie: node lint.mjs <plik.yml>...   (exit 1 gdy bledy)
import { readFileSync } from 'node:fs';
import { parseWorkflow, NoOperationTraceWriter } from '@actions/workflow-parser';

let failures = 0;
for (const file of process.argv.slice(2)) {
  const result = parseWorkflow({ name: file, content: readFileSync(file, 'utf8') }, new NoOperationTraceWriter());
  const errors = result.context.errors.getErrors();
  if (errors.length === 0) { console.log(`ok   ${file}`); continue; }
  failures++;
  console.log(`FAIL ${file}`);
  for (const e of errors) console.log(`     ${e.message}`);
}
process.exit(failures ? 1 : 0);

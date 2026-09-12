#!/usr/bin/env node
// PostToolUse hook (globalny) — po KAZDEJ edycji pliku (Edit | Write | MultiEdit | NotebookEdit |
// mcp__desktop-commander__write_file | mcp__desktop-commander__edit_block) lint + typecheck.
// Exit 2 => bledy wracaja do Claude i sam poprawia. Nigdy nie wywala sesji przez wlasne bledy.
// v3 (2026-09-05): logika w lib/lint-file.js (wspolna ze stop-gate i post-bash-edit-check),
// telemetria skipow w ~/.claude/logs/gates.jsonl. Edycje przez Bash lapie post-bash-edit-check.js.
'use strict';
const fs = require('fs');
const { lintFiles } = require('./lib/lint-file');

let input = {};
try { input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch (e) { process.exit(0); }
const toolInput = input.tool_input || {};
const file = toolInput.file_path || toolInput.path || toolInput.notebook_path || '';
if (!file || !fs.existsSync(file)) process.exit(0);

const result = lintFiles([file], { hook: 'post-edit' });
if (result) {
  process.stderr.write(result.header + '\n' + result.out + '\n');
  process.exit(2);
}
process.exit(0);

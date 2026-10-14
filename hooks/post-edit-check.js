#!/usr/bin/env node
// PostToolUse hook (globalny) — po KAZDEJ edycji pliku (Edit | Write | MultiEdit | NotebookEdit |
// mcp__desktop-commander__write_file | mcp__desktop-commander__edit_block) lint + typecheck.
// Exit 2 => bledy wracaja do Claude i sam poprawia. Nigdy nie wywala sesji przez wlasne bledy.
// v3 (2026-09-05): logika w lib/lint-file.js (wspolna ze stop-gate i post-bash-edit-check),
// telemetria skipow w ~/.claude/logs/gates.jsonl. Edycje przez Bash lapie post-bash-edit-check.js.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { lintFiles } = require('./lib/lint-file');
const { isTempPath } = require('./lib/protected-paths');
const gateLog = require('./lib/gate-log');

let input = {};
try { input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch (e) { process.exit(0); }
const toolInput = input.tool_input || {};
const file = toolInput.file_path || toolInput.path || toolInput.notebook_path || '';
if (!file || !fs.existsSync(file)) process.exit(0);

// Plan v3 L2 (2026-10-14): jednorazowy skrypt w tmp POZA repo git nie przechodzi bramki lint (51 blokad / 12 dni
// na skryptach w scratchpadzie). Klon repo w /tmp to work tree gita -> nadal lintowany. Skip zostaje w telemetrii.
// Sciezka po realpath (symlink z tmp do repo = repo, security-review 2026-10-14 F1); scratch TYLKO przy jawnym
// „not a git repository" (exit 128) — kazdy inny blad gita (brak binarki, timeout, dubious ownership) = lintuj.
function isScratchOutsideGit(f) {
  let real = f;
  try { real = fs.realpathSync(f); } catch (e) { return false; }
  if (!isTempPath(real)) return false;
  const r = spawnSync('git', ['-C', path.dirname(real), 'rev-parse', '--is-inside-work-tree'], { encoding: 'utf8', timeout: 5000 });
  return r.status === 128 && /not a git repository/i.test(r.stderr || '');
}
if (isScratchOutsideGit(path.resolve(file))) {
  gateLog.log({ hook: 'post-edit', event: 'skipped', reason: 'scratch-outside-git', target: path.resolve(file) });
  process.exit(0);
}

const result = lintFiles([file], { hook: 'post-edit' });
if (result) {
  process.stderr.write(result.header + '\n' + result.out + '\n');
  process.exit(2);
}
process.exit(0);

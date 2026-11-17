#!/usr/bin/env node
'use strict';
// Test: git-hooks/pre-commit lints only files whose CONTENT changed. A mode-only change (chmod +x) of a file with old lint
// debt must commit; a content change to the same file must still be linted (2026-11-15, loop 2).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const HOOKS = path.join(__dirname, '..', 'git-hooks');
const ruff = spawnSync('ruff', ['--version']);
if (ruff.status !== 0) { console.log('test_precommit_mode_only: SKIP (no ruff)'); process.exit(0); }
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-modeonly-'));
const env = Object.assign({}, process.env, { PG_GATE_LOG: path.join(dir, 'gates.jsonl') });
const git = (...a) => spawnSync('git', ['-c', `core.hooksPath=${HOOKS}`, '-c', 'core.fileMode=true', '-C', dir, ...a], { encoding: 'utf8', env });
let fails = 0;
const ok = (c, m, x = '') => { if (!c) { fails++; console.log('FAIL: ' + m + (x ? '\n  ' + x.slice(-400) : '')); } };

git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
// Old debt: unused import (ruff F401). Committed with hooks off, as history would hold it.
fs.writeFileSync(path.join(dir, 'tool.py'), '#!/usr/bin/env python3\nimport os\nprint(1)\n');
spawnSync('git', ['-C', dir, '-c', 'core.hooksPath=/dev/null', 'add', 'tool.py'], { env });
spawnSync('git', ['-C', dir, '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'chore: seed'], { env });

git('update-index', '--chmod=+x', 'tool.py');
let r = git('commit', '-qm', 'fix: track executable bit');
ok(r.status === 0, 'mode-only change commits despite old lint debt', r.stderr + r.stdout);

fs.appendFileSync(path.join(dir, 'tool.py'), 'import sys\n');
git('add', 'tool.py');
r = git('commit', '-qm', 'feat: touch content');
ok(r.status !== 0 && /ruff/i.test(r.stderr + r.stdout), 'content change is still linted and blocked', r.stderr + r.stdout);

fs.rmSync(dir, { recursive: true, force: true });
if (fails) { console.log(`test_precommit_mode_only: ${fails} FAIL`); process.exit(1); }
console.log('test_precommit_mode_only: OK');

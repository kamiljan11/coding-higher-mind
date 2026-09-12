#!/usr/bin/env node
// PG uninstaller — reverses what install.mjs wired: hook registrations in ~/.claude/settings.json, the PG block in
// ~/.claude/CLAUDE.md, and (with --yes) the global git core.hooksPath. Files under ~/.claude are NOT deleted — the last
// line prints the exact command, so removal is your explicit decision, not a script's.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const CLAUDE = path.join(os.homedir(), '.claude');
const YES = process.argv.includes('--yes');
const HOOK_FILES = ['session-context.js', 'bash-guard.js', 'memory-guard.js', 'prompt-guard.js', 'post-edit-check.js', 'post-bash-edit-check.js', 'stop-gate.js'];

const settingsFile = path.join(CLAUDE, 'settings.json');
if (fs.existsSync(settingsFile)) {
  const s = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  let removed = 0;
  for (const [event, entries] of Object.entries(s.hooks || {})) {
    for (const e of entries) {
      const before = (e.hooks || []).length;
      e.hooks = (e.hooks || []).filter((h) => !HOOK_FILES.some((f) => (h.command || '').includes('/.claude/hooks/' + f) || (h.command || '').includes('\\.claude\\hooks\\' + f)));
      removed += before - e.hooks.length;
    }
    s.hooks[event] = entries.filter((e) => e.hooks.length);
    if (!s.hooks[event].length) delete s.hooks[event];
  }
  fs.copyFileSync(settingsFile, settingsFile + '.pg-bak');
  fs.writeFileSync(settingsFile, JSON.stringify(s, null, 2) + '\n');
  console.log(`settings.json: ${removed} PG hook(s) removed (backup: settings.json.pg-bak)`);
}

const claudeMd = path.join(CLAUDE, 'CLAUDE.md');
if (fs.existsSync(claudeMd)) {
  const t = fs.readFileSync(claudeMd, 'utf8');
  const out = t.replace(/\n*<!-- PG:BEGIN -->[\s\S]*?<!-- PG:END -->\n?/, '\n');
  if (out !== t) { fs.copyFileSync(claudeMd, claudeMd + '.pg-bak'); fs.writeFileSync(claudeMd, out); console.log('CLAUDE.md: PG block removed (backup: CLAUDE.md.pg-bak)'); }
  else console.log('CLAUDE.md: no PG block found');
}

const target = path.join(CLAUDE, 'git-hooks').replace(/\\/g, '/');
const cur = (spawnSync('git', ['config', '--global', 'core.hooksPath'], { encoding: 'utf8' }).stdout || '').trim().replace(/\\/g, '/');
if (cur === target) {
  if (YES) { spawnSync('git', ['config', '--global', '--unset', 'core.hooksPath'], { stdio: 'inherit' }); console.log('git: global core.hooksPath unset'); }
  else console.log(`git: core.hooksPath still points to PG. To unset: git config --global --unset core.hooksPath   (or re-run with --yes)`);
}

console.log(`\nFiles were left in place. To remove them:\n  rm -rf "${CLAUDE}/hooks" "${CLAUDE}/git-hooks" "${CLAUDE}/bin" "${CLAUDE}/agents" "${CLAUDE}/pg" "${CLAUDE}/templates" "${CLAUDE}/scheduled-tasks" "${CLAUDE}/tools/workflow-lint"\n  (check first that you have nothing of your own in those folders)`);

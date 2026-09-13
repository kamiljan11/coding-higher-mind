#!/usr/bin/env node
// PG installer — copies the PROMPT-GUARD system into ~/.claude and wires it into Claude Code + git.
// Zero dependencies. Node >= 20. Works on Windows (Git Bash / PowerShell), macOS, Linux.
//
//   node install.mjs            interactive-ish: prints the plan, asks nothing, applies safe steps, tells you the rest
//   node install.mjs --dry-run  show what would change, touch nothing
//   node install.mjs --yes      also set `git config --global core.hooksPath ~/.claude/git-hooks` (global change!)
//   node install.mjs --force    overwrite files that differ from the package (a backup is written first)
//   node uninstall.mjs          remove the hook registrations + CLAUDE.md block (files stay; prints the rm command)
//
// Design rules (so you can trust it):
//  - never overwrites a file you changed unless --force (then backs it up to ~/.claude/_pg-backup-<timestamp>/)
//  - settings.json: MERGES the `hooks` key (your other hooks/keys stay), paths are absolute for THIS machine
//  - CLAUDE.md: APPENDS the PG block between <!-- PG:BEGIN --> / <!-- PG:END --> markers; re-run = replace block only
//  - git hooks: opt-in (--yes). Without it you get the per-repo command instead.
//  - ends with a self-test (node bin/pg-selftest.js) — green output is the proof, not this script's word.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOME = os.homedir();
const CLAUDE = path.join(HOME, '.claude');
const args = new Set(process.argv.slice(2));
const DRY = args.has('--dry-run');
const YES = args.has('--yes');
const FORCE = args.has('--force');
const STAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const BACKUP = path.join(CLAUDE, `_pg-backup-${STAMP}`);

const DIRS = ['hooks', 'git-hooks', 'bin', 'agents', 'pg', 'templates', 'skills', 'scheduled-tasks', 'tools', 'commands'];
const FILES = ['prompt-protocol.md', 'ruff.toml', 'pyrightconfig.json'];
const BEGIN = '<!-- PG:BEGIN -->';
const END = '<!-- PG:END -->';

const log = (s) => console.log(s);
const stats = { copied: 0, skippedSame: 0, keptYours: 0, overwritten: 0, newFiles: [] };

function walk(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name === 'node_modules' || e.name === '__pycache__') continue; out.push(...walk(p)); }
    else out.push(p);
  }
  return out;
}

function sameBytes(a, b) {
  try { return fs.readFileSync(a).equals(fs.readFileSync(b)); } catch { return false; }
}

function copyFile(src, dst) {
  if (fs.existsSync(dst)) {
    if (sameBytes(src, dst)) { stats.skippedSame++; return; }
    if (!FORCE) { stats.keptYours++; stats.newFiles.push(dst + '.pg-new'); if (!DRY) fs.copyFileSync(src, dst + '.pg-new'); return; }
    if (!DRY) { const b = path.join(BACKUP, path.relative(CLAUDE, dst)); fs.mkdirSync(path.dirname(b), { recursive: true }); fs.copyFileSync(dst, b); }
    stats.overwritten++;
  } else stats.copied++;
  if (!DRY) { fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(src, dst); }
}

function preflight() {
  const rows = [];
  const ver = process.versions.node.split('.').map(Number);
  rows.push(['node >= 20', ver[0] >= 20, process.version]);
  const has = (cmd, a = ['--version']) => { const r = spawnSync(cmd, a, { encoding: 'utf8', shell: process.platform === 'win32' }); return r.status === 0 ? (r.stdout || r.stderr).trim().split('\n')[0].slice(0, 40) : null; };
  rows.push(['git', !!has('git'), has('git') || 'MISSING — required']);
  rows.push(['python3 + ruff (Python repos)', !!has('ruff'), has('ruff') || 'optional: pip install ruff']);
  rows.push(['pyright (Python repos)', !!has('pyright'), has('pyright') || 'optional: npm i -g pyright']);
  rows.push(['gitleaks (CI does it too)', !!has('gitleaks', ['version']), has('gitleaks', ['version']) || 'optional']);
  log('\nPreflight:');
  for (const [name, ok, detail] of rows) log(`  ${ok ? 'ok  ' : 'warn'} ${name.padEnd(32)} ${detail}`);
  if (!rows[0][1] || !rows[1][1]) { log('\nNode >= 20 and git are required. Aborting.'); process.exit(1); }
}

function installFiles() {
  log(`\nFiles -> ${CLAUDE}${DRY ? '  (dry-run)' : ''}`);
  for (const d of DIRS) for (const src of walk(path.join(HERE, d))) copyFile(src, path.join(CLAUDE, path.relative(HERE, src)));
  for (const f of FILES) if (fs.existsSync(path.join(HERE, f))) copyFile(path.join(HERE, f), path.join(CLAUDE, f));
  log(`  new: ${stats.copied}  identical: ${stats.skippedSame}  kept yours: ${stats.keptYours}  overwritten(--force): ${stats.overwritten}`);
  if (stats.newFiles.length) log(`  your versions kept; package versions written next to them as *.pg-new (${stats.newFiles.length}). Diff them, or re-run with --force.`);
  if (!DRY && process.platform !== 'win32') for (const f of walk(path.join(CLAUDE, 'git-hooks'))) fs.chmodSync(f, 0o755);
}

function mergeSettings() {
  const pkg = JSON.parse(fs.readFileSync(path.join(HERE, 'settings.pg-hooks.json'), 'utf8')).hooks;
  const file = path.join(CLAUDE, 'settings.json');
  let settings = {};
  if (fs.existsSync(file)) { try { settings = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { log(`  settings.json is not valid JSON (${e.message}) — fix it first, hooks NOT merged.`); return; } }
  settings.hooks = settings.hooks || {};
  const claudeDir = CLAUDE.replace(/\\/g, '/');
  let added = 0;
  for (const [event, entries] of Object.entries(pkg)) {
    settings.hooks[event] = settings.hooks[event] || [];
    for (const entry of entries) {
      for (const h of entry.hooks) {
        const cmd = h.command.replace('{{CLAUDE_DIR}}', claudeDir);
        const base = path.basename(cmd.replace(/"$/, ''));
        const exists = settings.hooks[event].some((e) => (e.hooks || []).some((x) => (x.command || '').includes(base)));
        if (exists) continue;
        let slot = settings.hooks[event].find((e) => (e.matcher || '') === (entry.matcher || ''));
        if (!slot) { slot = { matcher: entry.matcher || '', hooks: [] }; settings.hooks[event].push(slot); }
        slot.hooks.push({ ...h, command: cmd });
        added++;
      }
    }
  }
  // Language of the injected protocol and gate messages: --lang en|pl, else the machine locale (Polish locale -> pl, anything else -> en).
  // Claude Code passes settings.json `env` to hooks; PG_LANG=en switches prompt-guard.js to the English protocol text.
  const langArg = process.argv.find((a) => a.startsWith('--lang='));
  const locale = (Intl.DateTimeFormat().resolvedOptions().locale || process.env.LANG || '').toLowerCase();
  const lang = langArg ? langArg.slice(7) : (locale.startsWith('pl') ? 'pl' : 'en');
  settings.env = settings.env || {};
  const langChanged = settings.env.PG_LANG !== lang;
  settings.env.PG_LANG = lang;
  log(`\nsettings.json: ${added} hook(s) added${DRY ? ' (dry-run)' : ''}, existing entries untouched; env.PG_LANG=${lang}${langChanged ? '' : ' (unchanged)'} (override: --lang=pl|en)`);
  if (!DRY) { if (fs.existsSync(file)) fs.copyFileSync(file, file + '.pg-bak'); fs.writeFileSync(file, JSON.stringify(settings, null, 2) + '\n'); }
}

function mergeClaudeMd() {
  const block = fs.readFileSync(path.join(HERE, 'CLAUDE.pg.md'), 'utf8').trim();
  const file = path.join(CLAUDE, 'CLAUDE.md');
  let text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '# CLAUDE.md\n\n';
  const wrapped = `${BEGIN}\n${block}\n${END}`;
  const has = text.includes(BEGIN) && text.includes(END);
  text = has ? text.replace(new RegExp(`${BEGIN}[\\s\\S]*?${END}`), wrapped) : text.trimEnd() + '\n\n' + wrapped + '\n';
  log(`\nCLAUDE.md: PG block ${has ? 'replaced' : 'appended'} (${block.split('\n').length} lines)${DRY ? ' (dry-run)' : ''}`);
  if (!DRY) { if (fs.existsSync(file)) fs.copyFileSync(file, file + '.pg-bak'); fs.writeFileSync(file, text); }
}

function gitHooks() {
  const target = path.join(CLAUDE, 'git-hooks').replace(/\\/g, '/');
  const cur = (spawnSync('git', ['config', '--global', 'core.hooksPath'], { encoding: 'utf8' }).stdout || '').trim();
  if (cur.replace(/\\/g, '/') === target) { log(`\ngit: core.hooksPath already = ${target}`); return; }
  if (YES) {
    log(`\ngit: setting global core.hooksPath = ${target}${cur ? ` (was: ${cur})` : ''}${DRY ? ' (dry-run)' : ''}`);
    if (!DRY) spawnSync('git', ['config', '--global', 'core.hooksPath', target], { stdio: 'inherit' });
  } else {
    log(`\ngit hooks NOT wired (global change needs --yes). Per repo instead:\n    git config core.hooksPath "${target}"\n  or globally:\n    git config --global core.hooksPath "${target}"${cur ? `\n  note: you currently have core.hooksPath = ${cur}` : ''}`);
  }
}

function workflowLint() {
  const dir = path.join(CLAUDE, 'tools', 'workflow-lint');
  if (!fs.existsSync(path.join(dir, 'package.json'))) return;
  if (fs.existsSync(path.join(dir, 'node_modules'))) { log('\nworkflow-lint: node_modules present'); return; }
  log(`\nworkflow-lint (GitHub's own workflow parser, used by pre-commit): npm install in ${dir}${DRY ? ' (dry-run)' : ''}`);
  if (!DRY) { const r = spawnSync('npm', ['install', '--no-audit', '--no-fund'], { cwd: dir, stdio: 'inherit', shell: process.platform === 'win32' }); if (r.status !== 0) log('  npm install failed — workflow files will not be linted locally (CI still parses them).'); }
}

function selfTest() {
  if (DRY) { log('\nself-test skipped (dry-run)'); return; }
  log('\nSelf-test (node ~/.claude/bin/pg-selftest.js):');
  const r = spawnSync(process.execPath, [path.join(CLAUDE, 'bin', 'pg-selftest.js')], { stdio: 'inherit' });
  log(r.status === 0 ? '\nPG is active on this machine. Open a new Claude Code session — the first non-trivial prompt shows [PROMPT-GUARD].' : '\nSelf-test reported failures — see the lines above. Nothing else was left half-done: files are in place, fix the listed item and re-run.');
}

log(`PG installer  (source: ${HERE})`);
preflight();
installFiles();
mergeSettings();
mergeClaudeMd();
gitHooks();
workflowLint();
selfTest();

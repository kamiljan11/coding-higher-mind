#!/usr/bin/env node
// PostToolUse hook (matcher: Bash|PowerShell) — edycje kodu przez sed -i / heredoc / redirect /
// Set-Content omijaly post-edit-check (matcher Edit|Write). W trybie bypassPermissions harness
// wrecz KAZE edytowac przez Bash, wiec to byla dziura systemowa, nie przypadek (audyt 2026-09-05).
// Po komendzie wygladajacej na zapis: znajdz pliki kodu zmodyfikowane w ostatnich RECENT_MS
// w repo (git status) i przepusc je przez ta sama logike lint/typecheck. Fail-open na wlasne bledy.
'use strict';
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { lintFiles, isCodeFile, isJsonFile, WRITE_COMMAND_RX, CHILD_ENV } = require('./lib/lint-file');
const { log } = require('./lib/gate-log');

const HOOK = 'post-bash-edit';
const RECENT_MS = 3 * 60 * 1000; // komenda mogla trwac (build, testy); liczy sie mtime, nie czas hooka
const MAX_FILES = 12;
const MAX_ROOTS = 3;
const GIT_TIMEOUT_MS = 15000;
// Tokeny wygladajace na sciezki: "w cudzyslowach", C:\..., ./x, ../x, ~/x, /abs
const PATH_TOKEN_RX = /"[^"]+"|'[^']+'|[A-Za-z]:[\\/][^\s"'|&;<>]+|(?:\.{1,2}|~)?\/[^\s"'|&;<>]+/g;

let input = {};
try { input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch (e) { process.exit(0); }
if (!/^(Bash|PowerShell)$/.test(String(input.tool_name || ''))) process.exit(0);
const command = String((input.tool_input || {}).command || '');
if (!command || !WRITE_COMMAND_RX.test(command)) process.exit(0);

function gitRoot(dir) {
  try {
    return path.resolve(execSync('git rev-parse --show-toplevel', { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'], timeout: GIT_TIMEOUT_MS, env: CHILD_ENV }).toString().trim());
  } catch (e) { return null; }
}

// Granica zaufania: lintujemy (= wykonujemy eslint/config repo) TYLKO w drzewie cwd sesji albo pod zaufanym korzeniem
// (~/.claude/pg/trusted-roots.txt). Sciezka spoza tego wspomniana w komendzie (np. `cat /obce/repo/x.ts`) nie moze
// uruchomic kodu z tamtego repo (security-reviewer 2026-09-05: podrzucone repo = RCE przez config lintera / fsmonitor).
// Logika w hooks/lib/trusted-roots.js — wspolna z qa-matrix (2026-09-12: ta sama granica dla node_modules/playwright).
const { isTrustedDir: isTrusted } = require('./lib/trusted-roots');

function candidateRoots(cmd, cwd) {
  const roots = new Set();
  const cwdOk = cwd && fs.existsSync(cwd);
  if (cwdOk) { const root = gitRoot(cwd); if (root) roots.add(root); }
  for (const raw of cmd.match(PATH_TOKEN_RX) || []) {
    const candidate = raw.replace(/^["']|["']$/g, '');
    if (!/[\\/]/.test(candidate) || !fs.existsSync(candidate)) continue;
    const dir = fs.statSync(candidate).isDirectory() ? candidate : path.dirname(candidate);
    if (!isTrusted(dir, cwdOk ? cwd : null)) { log({ hook: HOOK, event: 'skipped', reason: 'path outside cwd tree and trusted roots (untrusted)', target: dir }); continue; }
    const root = gitRoot(dir);
    if (root) roots.add(root);
    if (roots.size >= MAX_ROOTS) break;
  }
  return [...roots].slice(0, MAX_ROOTS);
}

// `git status --porcelain`: "XY sciezka" (2 znaki statusu + spacja); rename => "stara -> nowa"
function recentlyChangedFiles(root) {
  let status = '';
  try {
    status = execSync('git status --porcelain --untracked-files=all', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'], timeout: GIT_TIMEOUT_MS, env: CHILD_ENV }).toString();
  } catch (e) { return []; }
  const now = Date.now();
  const files = [];
  let capped = 0;
  for (const line of status.split('\n')) {
    if (!line.trim() || /^(.D|D)/.test(line)) continue; // usuniete — nie ma czego lintowac
    let rel = line.slice(3).trim();
    if (rel.includes(' -> ')) rel = rel.split(' -> ').pop();
    const abs = path.join(root, rel.replace(/^"|"$/g, ''));
    if (!isCodeFile(abs) && !isJsonFile(abs)) continue;
    let recent = false;
    try { recent = now - fs.statSync(abs).mtimeMs <= RECENT_MS; } catch (e) { continue; /* zniknal w miedzyczasie */ }
    if (!recent) continue;
    if (files.length >= MAX_FILES) { capped++; continue; }
    files.push(abs);
  }
  if (capped) log({ hook: HOOK, event: 'skipped', reason: `cap ${MAX_FILES} files: ${capped} recently changed files not linted`, target: root });
  return files;
}

try {
  const files = [];
  for (const root of candidateRoots(command, input.cwd)) files.push(...recentlyChangedFiles(root));
  if (!files.length) process.exit(0);
  const result = lintFiles([...new Set(files)].slice(0, MAX_FILES), { hook: HOOK });
  if (result) {
    process.stderr.write('[post-bash-edit] Edycja przez Bash tez przechodzi bramke.\n' + result.header + '\n' + result.out + '\n');
    process.exit(2);
  }
} catch (e) { /* fail-open */ }
process.exit(0);

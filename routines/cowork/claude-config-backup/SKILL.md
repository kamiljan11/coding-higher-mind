---
name: claude-config-backup
model: claude-sonnet-5
description: Daily full clone backup of Claude ecosystem to ~/.claude/memory\backup\ - generates one-click INSTALL.ps1 for new-PC restore
---

You are running a daily full-clone backup of the entire Claude ecosystem to ~/.claude/memory\backup\.

Goal: produce a backup that - combined with the auto-generated INSTALL.ps1 - restores everything on a new PC with ONE command. On the current PC, SETUP-THIS-PC.ps1 (run once via double-click) registers the weekly inventory schedule.

## Folder structure

Every backup run creates TWO copies:
1. `~/.claude/memory\backup\latest\` - always the most recent (overwritten each run)
2. `~/.claude/memory\backup\versions\YYYY-MM-DD\` - dated snapshot

Retention: keep last 14 days, minimum 7 versions.

---

## STEP 1 - Claude config + MCP server files

Read `~\AppData\Roaming\Claude\claude_desktop_config.json` -> save to `latest\claude\claude_desktop_config.json` (+ dated).

Parse mcpServers. For every entry, back up files referenced in `command`/`args` (paths starting with C:\ or <backup-drive>:\) plus siblings: `credentials.json`, `token.json`, `requirements.txt`, `server.py`, `server_multi.py`, `config.json`, `.env`.

Save to `latest\claude\mcp-servers\{server-name}\{filename}` (+ dated).

Also back up `~/.claude/memory\claude_desktop_config.json` -> `claude_desktop_config.master.json` (both paths).

---

## STEP 2 - All scheduled tasks

Call list_scheduled_tasks. For each: read SKILL.md -> save to `latest\scheduled\{taskId}\SKILL.md` (+ dated). Save metadata JSON to `latest\scheduled\_index.json`.

---

## STEP 3 - Original utility scripts

Copy if present (both paths):
- `~/.claude/memory\restore-new-pc.ps1` -> `scripts\restore-new-pc.ps1`
- `~/.claude/memory\napraw-config.ps1` -> `scripts\napraw-config.ps1`
- `~/.claude/memory\backup-claude.ps1` -> `scripts\backup-claude.ps1`

---

## STEP 3.5 - CLAUDE.md + protokoły (THREE DISTINCT FILES - back up all, updated 2026-08-02)

These are different files with different content - never treat one as a fallback for another:
1. `~/.claude\CLAUDE.md` -> save as `CLAUDE.md` (global Claude Code rules - primary)
2. `~\AppData\Roaming\Claude\CLAUDE.md` -> save as `CLAUDE-cowork.md` (Cowork-local rules)
3. `~/.claude\prompt-protocol.md` -> save as `prompt-protocol.md` (anti-hallucination protocol)

Save each to `latest\claude\` (+ dated). Legacy session-path CLAUDE.md copies are obsolete - do NOT use session paths.

## STEP 3.6 - Startup automation items (added 2026-08-02)

Copy `~\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup\` items
(`start_n8n_pm2.vbs`, `ObsidianWatchdog.vbs`, `StartObsidian.bat`) -> `latest\extras\startup\` (+ dated).
These keep n8n/pm2 and Obsidian alive after reboot - without them automations silently die.

---

## STEP 4 - Obsidian plugin configs

Copy if present (both paths):
- `~/.claude/memory\.obsidian\community-plugins.json` -> `obsidian\community-plugins.json`
- `~/.claude/memory\.obsidian\app.json` -> `obsidian\app.json`
- `~/.claude/memory\.obsidian\plugins\mcp-tools\data.json` -> `obsidian\mcp-tools-data.json`

---

## STEP 4.5 - User skills directories

```bash
find /sessions -maxdepth 8 -type d -name "skills" 2>/dev/null | grep -vE "node_modules|\.git" | sort -u
```

For each `skills/` under user-side paths (NOT plugin-managed `skills-plugin/.../skills` which auto-redownload from marketplace), `cp -r` to `latest\claude\user-skills\{label}\...` (+ dated). Count.

---

## STEP 4.6 - Installed plugins list

Call `mcp__plugins__list_plugins` -> save full JSON to `latest\claude\plugins-installed.json` (+ dated).

---

## STEP 4.7 - Write `inventory-system.ps1` (Windows-side state capture)

Write to `~/.claude/memory\backup\latest\scripts\inventory-system.ps1` (+ dated). Overwrite each run.

```powershell
# inventory-system.ps1 - Captures Windows-level state
$ErrorActionPreference = "SilentlyContinue"
$out = "~/.claude/memory\backup\latest\system"
New-Item -ItemType Directory -Force -Path $out | Out-Null

$paths = @(
  'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*'
)
Get-ItemProperty $paths | Where-Object { $_.DisplayName } |
  Select-Object DisplayName, DisplayVersion, Publisher, InstallDate |
  Sort-Object DisplayName |
  Export-Csv "$out\installed-programs.csv" -NoTypeInformation -Encoding utf8

winget list --accept-source-agreements 2>$null | Out-File "$out\winget-list.txt" -Encoding utf8
npm list -g --depth=0 2>$null | Out-File "$out\npm-globals.txt" -Encoding utf8
pip list --format=freeze 2>$null | Out-File "$out\pip-globals.txt" -Encoding utf8
code --list-extensions 2>$null | Out-File "$out\vscode-extensions.txt" -Encoding utf8
Get-ChildItem env: | Select-Object Name, Value | Export-Csv "$out\env-vars.csv" -NoTypeInformation -Encoding utf8
Get-Module -ListAvailable | Select-Object Name, Version | Sort-Object Name -Unique |
  Export-Csv "$out\powershell-modules.csv" -NoTypeInformation -Encoding utf8
systeminfo | Out-File "$out\system-info.txt" -Encoding utf8

$ts = Get-Date -Format "yyyy-MM-dd HH:mm"
"[$ts] inventory-system.ps1 ran OK" | Out-File "~/.claude/memory\backup\backup.log" -Append -Encoding utf8
Write-Host "System inventory saved to $out"
```

---

## STEP 4.75 - Write `SETUP-THIS-PC.ps1` (one-time setup for current PC)

Write to `~/.claude/memory\backup\latest\SETUP-THIS-PC.ps1` (+ dated). This is what the user double-clicks ONCE on the current PC to fully automate inventory.

```powershell
# SETUP-THIS-PC.ps1 - Run ONCE on the current PC
# Registers weekly Windows Task Scheduler entry for system inventory
# Also runs an inventory immediately so system/ is populated today
#Requires -RunAsAdministrator

$invScript = "~/.claude/memory\backup\latest\scripts\inventory-system.ps1"

if (-not (Test-Path $invScript)) {
  Write-Error "inventory-system.ps1 not found - wait for next daily backup run (3:09 AM) and try again"
  Read-Host "Press Enter to exit"
  exit 1
}

Write-Host "Registering weekly Windows scheduled task..." -ForegroundColor Yellow
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$invScript`""
$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At 2am
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
Register-ScheduledTask -TaskName "Claude-Inventory-Weekly" -Action $action -Trigger $trigger -Settings $settings -Force -RunLevel Highest | Out-Null

Write-Host "Running inventory now to populate system/ folder..." -ForegroundColor Yellow
& $invScript

Write-Host ""
Write-Host "=== DONE ===" -ForegroundColor Green
Write-Host "Weekly inventory now runs every Sunday at 2 AM."
Write-Host "Combined with the Cowork daily backup at 3:09 AM, you now have a full updating clone on <backup-drive>:."
Write-Host ""
Read-Host "Press Enter to close"
```

Also write `~/.claude/memory\backup\latest\SETUP-THIS-PC.bat` - a self-elevating wrapper so the user just double-clicks the .bat:

```batch
@echo off
:: Self-elevating launcher for SETUP-THIS-PC.ps1
net session >nul 2>&1
if %errorLevel% == 0 (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0SETUP-THIS-PC.ps1"
) else (
  powershell.exe -Command "Start-Process -FilePath powershell.exe -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File \"%~dp0SETUP-THIS-PC.ps1\"' -Verb RunAs"
)
```

---

## STEP 4.8 - Write `INSTALL.ps1` (one-click new-PC restore)

Write to `~/.claude/memory\backup\latest\INSTALL.ps1` (+ dated). Overwrite each run.

```powershell
# INSTALL.ps1 - One-click restore on a fresh Windows PC
# Right-click -> Run with PowerShell (as Administrator)
#Requires -RunAsAdministrator

$ErrorActionPreference = "Continue"
$BackupRoot = "~/.claude/memory\backup\latest"

if (-not (Test-Path $BackupRoot)) {
  Write-Error "Backup folder not found at $BackupRoot - make sure <backup-drive>: drive is connected"
  exit 1
}

Write-Host "=== Claude Ecosystem Restore ===" -ForegroundColor Cyan
Write-Host "Backup source: $BackupRoot"
Write-Host ""

# 1. Core apps via winget
Write-Host "[1/9] Installing core apps..." -ForegroundColor Yellow
$coreApps = @("Anthropic.Claude","Obsidian.Obsidian","OpenJS.NodeJS.LTS","Python.Python.3.12","Microsoft.VisualStudioCode","Git.Git","7zip.7zip")
foreach ($app in $coreApps) {
  Write-Host "  $app..."
  winget install --id $app --silent --accept-source-agreements --accept-package-agreements 2>$null
}

# 2. Bulk install from winget-list
Write-Host "[2/9] Installing remaining apps from winget-list.txt..." -ForegroundColor Yellow
$wingetFile = "$BackupRoot\system\winget-list.txt"
if (Test-Path $wingetFile) {
  Get-Content $wingetFile | Select-Object -Skip 3 | ForEach-Object {
    $cols = $_ -split '\s{2,}'
    if ($cols.Count -ge 2 -and $cols[1] -match '\S') {
      $id = $cols[1].Trim()
      if ($id -and $id -notmatch "^-") {
        winget install --id $id --silent --accept-source-agreements --accept-package-agreements 2>$null
      }
    }
  }
}

# 3. Restore Claude config + MCP servers
Write-Host "[3/9] Restoring Claude config + MCP servers..." -ForegroundColor Yellow
$appdata = "$env:APPDATA\Claude"
New-Item -ItemType Directory -Force -Path $appdata | Out-Null
Copy-Item "$BackupRoot\claude\claude_desktop_config.json" "$appdata\" -Force

$config = Get-Content "$appdata\claude_desktop_config.json" | ConvertFrom-Json
foreach ($srvName in $config.mcpServers.PSObject.Properties.Name) {
  $srv = $config.mcpServers.$srvName
  $args = @($srv.command) + @($srv.args)
  foreach ($a in $args) {
    if ($a -match '^[A-Z]:\\' -and (Test-Path "$BackupRoot\claude\mcp-servers\$srvName")) {
      $fname = Split-Path -Leaf $a
      $src = "$BackupRoot\claude\mcp-servers\$srvName\$fname"
      if (Test-Path $src) {
        $destDir = Split-Path -Parent $a
        New-Item -ItemType Directory -Force -Path $destDir | Out-Null
        Copy-Item $src $a -Force
      }
    }
  }
  $srvSrc = "$BackupRoot\claude\mcp-servers\$srvName"
  if (Test-Path $srvSrc) {
    $firstArg = $srv.args | Where-Object { $_ -match '^[A-Z]:\\' } | Select-Object -First 1
    if ($firstArg) {
      $destDir = Split-Path -Parent $firstArg
      Copy-Item "$srvSrc\*" $destDir -Force -ErrorAction SilentlyContinue
    }
  }
}

# 4. Restore CLAUDE.md
Write-Host "[4/9] Restoring CLAUDE.md..." -ForegroundColor Yellow
$claudeMdSrc = "$BackupRoot\claude\CLAUDE.md"
if (Test-Path $claudeMdSrc) {
  $dest = "$env:USERPROFILE\.claude"
  New-Item -ItemType Directory -Force -Path $dest | Out-Null
  Copy-Item $claudeMdSrc "$dest\CLAUDE.md" -Force
}

# 5. Restore user skills
Write-Host "[5/9] Restoring user skills..." -ForegroundColor Yellow
$skillsSrc = "$BackupRoot\claude\user-skills"
if (Test-Path $skillsSrc) {
  $skillsDest = "$env:USERPROFILE\.claude\skills"
  New-Item -ItemType Directory -Force -Path $skillsDest | Out-Null
  Copy-Item "$skillsSrc\*" $skillsDest -Recurse -Force
}

# 6. Restore scheduled tasks
Write-Host "[6/9] Restoring scheduled tasks..." -ForegroundColor Yellow
$schedSrc = "$BackupRoot\scheduled"
$schedDest = "$env:USERPROFILE\~/.claude/routines/cowork"
if (Test-Path $schedSrc) {
  New-Item -ItemType Directory -Force -Path $schedDest | Out-Null
  Copy-Item "$schedSrc\*" $schedDest -Recurse -Force
}

# 7. Dev globals
Write-Host "[7/9] Restoring dev tool globals..." -ForegroundColor Yellow
$npmFile = "$BackupRoot\system\npm-globals.txt"
if (Test-Path $npmFile) {
  Get-Content $npmFile | ForEach-Object {
    if ($_ -match '([\w\-@/]+)@[\d.]+') {
      $pkg = $matches[1]
      if ($pkg -ne "npm") { npm install -g $pkg 2>$null }
    }
  }
}
$pipFile = "$BackupRoot\system\pip-globals.txt"
if (Test-Path $pipFile) { pip install -r $pipFile 2>$null }
$vsFile = "$BackupRoot\system\vscode-extensions.txt"
if (Test-Path $vsFile) {
  Get-Content $vsFile | ForEach-Object { code --install-extension $_ 2>$null }
}

# 8. Schedule weekly inventory
Write-Host "[8/9] Scheduling weekly inventory..." -ForegroundColor Yellow
$invScript = "$BackupRoot\scripts\inventory-system.ps1"
if (Test-Path $invScript) {
  $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$invScript`""
  $trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At 2am
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
  Register-ScheduledTask -TaskName "Claude-Inventory-Weekly" -Action $action -Trigger $trigger -Settings $settings -Force -RunLevel Highest | Out-Null
}

# 9. Done
Write-Host "" -ForegroundColor Green
Write-Host "=== RESTORE COMPLETE ===" -ForegroundColor Green
Write-Host ""
Write-Host "Done automatically:"
Write-Host "  - All apps installed via winget"
Write-Host "  - Claude config + MCP servers restored"
Write-Host "  - CLAUDE.md restored"
Write-Host "  - User skills restored"
Write-Host "  - Scheduled task SKILL.md files in place"
Write-Host "  - npm/pip/VS Code globals restored"
Write-Host "  - Weekly inventory task scheduled"
Write-Host ""
Write-Host "Remaining (~3 min of clicking):" -ForegroundColor Yellow
Write-Host "  1. Open Claude Desktop -> log in (you@example.com)"
Write-Host "  2. Reinstall plugins listed in plugins-installed.json"
Write-Host "  3. Re-auth OAuth for: gmail-multi, github, obsidian (Claude prompts on first use)"
Write-Host "  4. Open Obsidian -> open vault at ~/.claude/memory"
Write-Host ""
Write-Host "Then type 'hi' in Cowork mode to verify memory loads correctly."
Read-Host "Press Enter to close"
```

Also write `~/.claude/memory\backup\latest\INSTALL.bat` - self-elevating wrapper:

```batch
@echo off
net session >nul 2>&1
if %errorLevel% == 0 (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0INSTALL.ps1"
) else (
  powershell.exe -Command "Start-Process -FilePath powershell.exe -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File \"%~dp0INSTALL.ps1\"' -Verb RunAs"
)
```

---

## STEP 4.9 - Generate `RESTORE.md`

Write to `latest\RESTORE.md` (+ dated):

```markdown
# Disaster Recovery - Claude Ecosystem

**Last backup:** {YYYY-MM-DD HH:MM}
**Backup root:** ~/.claude/memory\backup\latest\

## NEW PC restore (zero typing - 30 min total)

1. Plug in <backup-drive>: drive (or copy `~/.claude/memory\backup\` to the new PC first)
2. Double-click `~/.claude/memory\backup\latest\INSTALL.bat`
3. Confirm UAC prompt
4. Wait ~30 min while everything installs
5. 4 final clicks the installer shows at the end (Claude login, plugins, OAuth, Obsidian vault)

Done.

## CURRENT PC initial setup (run ONCE)

1. Double-click `~/.claude/memory\backup\latest\SETUP-THIS-PC.bat`
2. Confirm UAC prompt
3. Done - weekly inventory now runs automatically Sundays at 2 AM

## What this backup contains

- `claude/` - Claude Desktop config, MCP servers (+ credentials/.env), CLAUDE.md, user skills, plugins list
- `scheduled/` - all scheduled task SKILL.md + _index.json
- `obsidian/` - Obsidian plugin configs
- `scripts/` - original PS1 scripts, inventory-system.ps1
- `system/` - installed-programs.csv, winget-list.txt, npm/pip/vscode globals, env vars (refreshed weekly)
- `INSTALL.ps1` + `INSTALL.bat` - new-PC installer
- `SETUP-THIS-PC.ps1` + `SETUP-THIS-PC.bat` - current-PC inventory scheduler
- `versions/YYYY-MM-DD/` - daily snapshots (last 14 days)

## Automation

- Cowork daily backup: 3:09 AM (Claude scheduled task `claude-config-backup`) - backs up Claude side
- Windows weekly inventory: Sunday 2 AM (task `Claude-Inventory-Weekly`) - set up by SETUP-THIS-PC or INSTALL

Both run themselves. The backup folder is a true updating clone - no manual work after initial setup.

## Recovery from corrupted config (not full disaster)

If a recent change broke something, swap in an older snapshot:
- Look in `versions/` for a working day
- Copy that day's files back over `latest/`
```

Fill in actual timestamp.

---

## STEP 5 - Prune old versions

```bash
VERSIONS_DIR=$(find /sessions -maxdepth 6 -type d -name "versions" 2>/dev/null | grep "MAIN/backup/versions" | head -1)
if [ -z "$VERSIONS_DIR" ]; then echo "WARN: versions dir not found"; exit 0; fi
ls "$VERSIONS_DIR"
```

Parse folder names as YYYY-MM-DD. Sort newest first. Keep 7 most recent. Delete anything older than 14 days outside top 7 via `rm -rf "$VERSIONS_DIR/YYYY-MM-DD"`.

---

## STEP 6 - Backup log

Append to `~/.claude/memory\backup\backup.log`:
```
[YYYY-MM-DD HH:MM] Backup OK - {N} MCP, {M} scheduled, {S} skills dirs, {P} plugins, CLAUDE.md, INSTALL.ps1/bat, SETUP-THIS-PC.ps1/bat, inventory-system.ps1, RESTORE.md generated. Versions: {K}. Pruned: {Q}.
```

Run silently. Warnings inline, no abort.

---

## AUDIT ADDENDUM 2026-08-02 - PERMANENT OVERRIDES (apply on every run; overrides conflicting spec above)

Audit conducted with uzytkownik live in session. These changes are REQUIRED going forward:

1. **INSTALL.ps1 - portable root (different PC / no <backup-drive>: drive).** Do NOT hardcode `$BackupRoot = "<backup-drive>:\..."` as the only path. Generate with:
   `$BackupRoot = $PSScriptRoot` -> fallback to `~/.claude/memory\backup\latest` -> validate by testing `$BackupRoot\claude\claude_desktop_config.json`, friendly error otherwise. INSTALL must work when the backup folder is copied to ANY location on the new PC.

2. **Architecture-aware app restore (different chip).** inventory-system.ps1 must also run: `winget export -o "$out\winget-export.json" --accept-source-agreements`. INSTALL step 2 must PREFER `winget import -i winget-export.json --ignore-unavailable --no-upgrade` (auto-selects x64/ARM64, skips unavailable) and only fall back to winget-list.txt parsing. Log failures to `$env:USERPROFILE\Desktop\claude-restore-log.txt` instead of discarding (`2>$null` hid all failures before).

3. **CLAUDE.md source paths.** Session-scoped paths (local_*) rotate and go stale. Use stable order: `~/.claude\CLAUDE.md` first, then `%APPDATA%\Claude\CLAUDE.md`.

4. **EXTRA COVERAGE step (was missing entirely - restore was incomplete without it).** Back up each run to `latest\claude\dotclaude\` (+dated):
   - `~/.claude\settings.json`, `hooks\`, `commands\`, `agents\`, `bin\`, `templates\`, `git-hooks\`
   - `~/.claude\tasks\scheduled-tasks.json` - the Cowork scheduled-task REGISTRY. Without it, restored SKILL.md files are inert (tasks never re-register).
   - `~/.claude\plugins\installed_plugins.json` + `known_marketplaces.json`
   - `~/.claude.json` -> `latest\claude\claude.json` (skip if >200MB)
   - `~\.n8n\` -> `latest\extras\n8n\` (robocopy /E /XD cache logs binaryData node_modules .cache /XF *.log)
   - AppData helper MCP dirs -> `latest\claude\mcp-servers\_appdata\`: `gmail-mcp`, `google-ads-mcp`, `smart-connections-mcp` (/XD node_modules .git __pycache__) + `obsidian-mcp-extended.py`

5. **INSTALL.ps1 restore additions.** (a) restore `claude\dotclaude\*` -> `%USERPROFILE%\.claude\` and `claude\claude.json` -> `%USERPROFILE%\.claude.json`; (b) restore `_appdata` dirs -> `%APPDATA%\Claude\`; (c) restore `extras\n8n` -> `%USERPROFILE%\.n8n`; (d) FIX skills nesting bug: user-skills contains LABEL folders (dotclaude-skills, authored-skills, ...) - restore the CONTENTS of the best label (prefer dotclaude-skills) into `.claude\skills`, never copy label folders themselves; (e) WARN (not fail) when a config path targets a missing drive (e.g. agent-os on <backup-drive>:\agent-os-mcp).

6. **Prune hardening.** Before pruning, delete version dirs containing 0 files (failed-run artifacts, e.g. empty 2026-07-31). Use `cmd /c rd /s /q` fallback if Remove-Item leaves the dir. Add MCP-sibling `accounts.json` to the sibling list (gmail-multi OAuth store).

7. **Weekly inventory task.** If `schtasks /Query /TN "Claude-Inventory-Weekly"` reports missing, register it directly (user-level `schtasks /Create /SC WEEKLY /D SUN /ST 02:00 ... /F` works without admin) instead of only warning. Registered this way on 2026-08-02.

8. **STEP 2 simplification.** Clone `~\~/.claude/routines/cowork\` wholesale via robocopy /E (excl. `.playwright-mcp`) - captures SKILL.md + task state files. Keep writing fresh `_index.json` from list_scheduled_tasks.

9. **Utility scripts list** additionally includes if present: `fix-claude-config.ps1`, `setup-backup-schedule.ps1`, `diagnose-mcp.ps1`.

Portability verdict recorded in RESTORE.md: any Windows x64 ✓; Windows ARM64 ✓ (winget import auto-arch, x64 emulation fallback, failures logged); no-D:-drive PC ✓ via portable root (only Obsidian vault path + agent-os <backup-drive>:\agent-os-mcp need manual path edit, documented); macOS/Linux ✗ (data portable, installer Windows-only).


---
# STANDING RULE - never expires - ASCII-only in every generated PowerShell file
*(added 2026-09-01 by self-evolution-cycle 32)*

**The bug that will not die.** Em-dash/mojibake parse errors in generated PowerShell (notably `INSTALL.ps1`)
have recurred on **every** run since 2026-08-14 - 7+ documented instances, most recently 08-31 ("7+2 parse
errors") and 09-01 ("em-dash bug recurred again ... fixed"). Each run detects it, patches it in-flight,
reports success, and regenerates the identical bug next run. It has been *diagnosed* eight times and
*fixed at source* zero times. That is the failure, not the parse error.

**The rule.** Any `.ps1` this task writes must be **pure ASCII**. Before writing a PowerShell file:

1. Use only `-` (hyphen-minus, U+002D). Never `—` U+2014, `–` U+2013, `'` `'` U+2018/2019, `"` `"`
   U+201C/201D, `…` U+2026, or non-breaking space U+00A0. These arrive via copied prose and comments.
2. Write the file explicitly as **UTF-8 with BOM** or ASCII - PowerShell 5.1 misreads BOM-less UTF-8,
   which is what turns a stray em-dash into a parse error rather than a harmless comment character.
3. **Verify before declaring success**: scan the generated file for any byte > 0x7F and report the count.
   Zero is the pass condition. If the count is non-zero, fix the *generator text* in this SKILL.md - not
   just the output file - otherwise the next run reproduces it.
4. If you patch the output reactively again, that is a **FAILED** outcome for this rule, not a success.
   Say so explicitly in the run report so the recurrence stays visible as a trend.

**2026-09-02 update: source fixed, not just output.** Every em-dash and right-arrow in this SKILL.md's
own generator text (STEP headers, prose, and all embedded powershell/batch code blocks) was replaced with
plain ASCII hyphen and `->`. Also removed the non-ASCII box-drawing filter (`Select-String "^[...]"` using
tree-drawing characters) from the INSTALL.ps1 template's npm-globals step, matching the fix already proven
in the live output file. Verified by reading this file's raw bytes and decoding as UTF-8 (not relying on
PowerShell's Get-Content default, which misreads BOM-less UTF-8 on this system): 0 em-dashes, arrows, or
box-drawing characters remain in any generator text. The only non-ASCII characters left in the whole file
are the one illustrative line above (which must show the literal forbidden glyphs to be useful), the word
"protokoly" in a STEP 3.5 heading, and checkmark/cross characters in the portability-verdict prose (never
copied into an output file). If the bug recurs after this date, it is being reintroduced by whoever executes
this task deviating from the template above, not by the template itself - check the actual output bytes
first before assuming the source regressed.


---
# STANDING RULE - never expires - do not back up shared interpreter binaries in STEP 1
*(added 2026-09-03 by daily run, found during routine backup)*

**The bug.** STEP 1 says "back up files referenced in command/args (paths starting with C:\ or <backup-drive>:\)".
Several MCP servers have `command` set to a shared runtime binary - e.g.
`C:\Program Files\nodejs\node.exe` (zoho-mail, wiretext, playwright, desktop-commander) or
`C:\Python314\python.exe` (github, via infisical bridge). Treating `command` as backup-worthy the
same way as `args` copies that ~90MB node.exe / python.exe into every server's own subfolder -
5+ duplicate copies, ~870MB wasted, discovered and removed on 2026-09-03.

**The rule.** In STEP 1, only back up paths from `args` (the actual server script: server.py,
proxy.js, index.js, cli.js, server.js, infisical (CLI), etc.) plus the sibling files list.
Do NOT back up `command` itself when it points to a shared runtime executable (node.exe,
python.exe, python3, node, npx, or any path under `Program Files`, `Python3*`, or a bare
interpreter name with no server-specific content) - that binary is reinstalled by the Node.js /
Python installer during restore, it is not per-server user data. If a future run finds node.exe
or python.exe copies inside `claude\mcp-servers\{server-name}\`, delete them and do not
regenerate - that is the same bug recurring, not a new one.

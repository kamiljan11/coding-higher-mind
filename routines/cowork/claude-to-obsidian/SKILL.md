---
name: claude-to-obsidian
description: Daily evening sync: Claude Cowork sessions → Obsidian
model: claude-sonnet-5
---

This is an automated run. The user is not present. Execute autonomously. Only take write actions that are part of the core purpose: saving Claude Cowork session knowledge to Obsidian.

---

## STEP 0 — Pre-load tools (jedno zbiorcze wywołanie, zanim cokolwiek innego)

ToolSearch: `select:TaskCreate,TaskUpdate,mcp__desktop-commander__read_file,mcp__desktop-commander__write_file,mcp__desktop-commander__edit_block,mcp__session_info__list_sessions,mcp__session_info__read_transcript`

Jedno wywołanie ładuje wszystkie schematy. NIE doładowuj narzędzi pojedynczo w trakcie biegu.

## TOOL ACCESS (READ FIRST)

The Obsidian MCP (`create_vault_file`, `append_to_vault_file`, etc.) is frequently NOT connected during scheduled Cowork runs — when that happens this task silently writes nothing (confirmed failure 2026-07-02). The vault is directly reachable on disk at `~/.claude/memory\` via the **desktop-commander** MCP, which DOES work in scheduled runs.

- **Primary method**: use desktop-commander file tools against `~/.claude/memory\...` — `read_file` to read notes, `write_file` (mode `append` or `rewrite`) to write/append. Paths: e.g. `~/.claude/memory\Log\Processed Sessions.md`, `~/.claude/memory\Knowledge\...`. If desktop-commander isn't loaded, load it via ToolSearch (`select:mcp__desktop-commander__read_file,mcp__desktop-commander__write_file,mcp__desktop-commander__edit_block`).
- **Fallback only**: if desktop-commander is unavailable, use the Obsidian MCP tools named below (vault-relative paths).
- Session transcripts come from `mcp__session_info__list_sessions` / `read_transcript` (load via ToolSearch if deferred).
- Whichever path is used, the Obsidian-MCP tool names below map to plain file ops: `create_vault_file` = write new file, `append_to_vault_file` = append. Do NOT abort just because the Obsidian MCP is missing — fall through to desktop-commander.

---

# CLAUDE COWORK SESSION SYNC

## STEP 1 — DETERMINE WHAT'S ALREADY PROCESSED

Read `Log/Processed Sessions.md` from Obsidian. Note all session IDs already processed. Skip these.

## STEP 2 — LIST AND READ SESSIONS

Use `list_sessions` (limit: 60) to get recent sessions. For each session NOT already in Processed Sessions.md:

1. Read the transcript using `read_transcript` (limit: 30 messages)
2. Skip sessions that are: empty, currently running, or purely automated task runs with no novel content (e.g., deferred-task-runner finding nothing, checkpoint-monitor finding nothing, this task's own routine captures with no new content)

## STEP 3 — EXTRACT CONTENT (for each valuable session)

### A. Knowledge & Insights
- Key decisions made and their reasoning
- New knowledge discovered or created
- Technical setup steps worth remembering
- Strategic analysis or recommendations
- Project status changes

### B. Revision Signals (critical for system learning)
Look for:
- **Corrections**: "actually...", "no, make it more...", "that's not right...", "shorter", "less formal", "more direct"
- **Redos**: Was any output significantly changed after first delivery? What changed and in what direction?
- **Tone adjustments**: Did uzytkownik push back on tone, length, format, or style?
- **Abandoned approaches**: Did Claude start one approach and uzytkownik redirected to another?

Format: `**Revision Signal**: [output type] — [what was corrected] → [direction of correction]`

### C. Skill Usage
Note which skills were clearly invoked. If no skill was used, note "No skill invoked" — that's useful data too.

## STEP 4 — SAVE TO OBSIDIAN

> ⛔ **APPEND-ONLY GUARD (data-loss rule — read before any write).** `write_file` defaults to
> `mode: "rewrite"`, which OVERWRITES the whole file. Appending to any existing log with a bare
> `write_file` has already destroyed `Log/Done.md` + `Log/Decisions.md` twice (2026-07-04 and
> 2026-07-08, the 2nd unrecoverable). For **`Log/Decisions.md`, `Log/Done.md`, and
> `Log/Processed Sessions.md`** you MUST pass `mode: "append"` explicitly, or use `edit_block`.
> NEVER call `write_file` on these three files without `mode: "append"`. Only brand-new
> `Knowledge/...` notes may use rewrite (they don't exist yet).

**Knowledge notes**: Save to appropriate location:
- Technical/how-to → `Knowledge/How-To/[Title].md`
- Tool-specific → `Knowledge/Tools/[Title].md`
- Strategic/analysis → `Knowledge/[Title].md`
- Cross-domain insights → `Knowledge/Synthesis/[Title].md`

Always use multi-line YAML for tags (never inline arrays).

**Always stamp a `type:` field in frontmatter on every NEW file you create** (in addition to `date:` and `tags:`), e.g.:
```
---
date: YYYY-MM-DD
type: knowledge
tags:
  - tag1
---
```
Use `type: knowledge` / `type: decision` / `type: session-log` as fits the note. This is the dashboard's memory-freshness metric (`activatedLast7d`) — it only counts notes with a `type:` stamp, and this task is the one running daily (113×/7d), not the weekly organiser. Added 2026-07-06 (Cycle 17) to close `memory-type-stamp-in-daily-sync`: the Cycle 16 fix stamped `type:` in the weekly organiser only, so `activatedLast7d` stayed 0 even though this task was syncing fresh files constantly.

**Decisions**: Append to `Log/Decisions.md` under a dated heading.
**Completed tasks**: Append to `Log/Done.md`.
**Revision signals and skill usage**: Append to `Log/Processed Sessions.md` alongside the session entry.

## STEP 5 — UPDATE PROCESSED SESSIONS LOG

Append a dated section to `Log/Processed Sessions.md`:

| Session ID | Title | Notes | Skills Used | Revision Signals |
|---|---|---|---|---|

Note why skipped sessions were skipped.

---

## CONSTRAINTS
- Use `create_vault_file` for new files, `append_to_vault_file` for adding to existing files
- With desktop-commander, appending to an existing log = `write_file(..., mode: "append")` or `edit_block` — a bare `write_file` (default rewrite) WIPES the file. See the STEP 4 append-only guard.
- Never use `patch_vault_file` for multi-section edits — it has a bug
- Always use multi-line YAML for tags
- Keep knowledge notes focused — one topic per note
- If a session transcript is too long to read fully, read first and last 15 messages

---

## FINAL STEP — Chronicle log

Append one line to `Claude Memory/Agent Action Log.md` (create with header if missing):

Format: `[YYYY-MM-DD HH:MM] | daily-cowork-session-sync | cowork-sessions: N scanned, X saved | revision signals: Y`

If nothing new: `[YYYY-MM-DD HH:MM] | daily-cowork-session-sync | no new content`

---
HARD WRITE-SAFETY RULE (added 2026-08-02 after 5 rewrite-mode wipe incidents, 2 unrecoverable — see Vault Maintenance Log 07-07/07-08): when writing to ANY existing file, desktop-commander `write_file` MUST be called with `mode:"append"`. The default mode is `rewrite` and it destroys the whole file. Full-file `rewrite` is allowed ONLY when the step explicitly rebuilds a file from scratch AND you have read the current content in the same run. Before every write to Done.md, Decisions.md, Processed Sessions.md or any log: read the file first, then append.
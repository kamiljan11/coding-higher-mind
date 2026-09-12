---
name: weekly-obsidian-vault-organiser
model: claude-opus-5
description: Weekly vault maintenance + intelligence pass. Hub-and-spoke graph architecture (Home → Hubs + path-link indexes), incremental frontmatter typing, orphan % watchdog, memory curation, synthesis. backup/ excluded.
---

This is an automated run of a scheduled task. The user is not present to answer questions. Execute autonomously without asking clarifying questions — make reasonable choices and document them clearly. Only take write actions that are part of the task's core purpose: vault maintenance and intelligence.

## TOOL ACCESS (READ FIRST)

The Obsidian MCP is frequently NOT connected during scheduled Cowork runs. The vault is directly reachable on disk at `~/.claude/memory\` via the **desktop-commander** MCP, which DOES work in scheduled runs.

- **Primary method**: use desktop-commander against `~/.claude/memory\...` — `list_directory` to audit, `read_file` to read, `write_file` (rewrite/append) and `edit_block` to write. Load via ToolSearch if deferred (`query: "desktop-commander"`, max_results 30). For bulk operations (indexing, frontmatter, link analysis) prefer a Python REPL via `start_process("python -i")` + `interact_with_process` with exec() blocks — it handles hundreds of files in one pass.
- **Fallback only**: Obsidian MCP tools (vault-relative paths). Never use `patch_vault_file` for multi-section edits (persistent append-instead-of-replace bug). Use full rewrites. Always multi-line YAML for tags.
- Do NOT abort a step because the Obsidian MCP is missing — fall through to desktop-commander.

## GRAPH ARCHITECTURE (established 2026-08-03, W32 — maintain it)

The vault uses hub-and-spoke: `Home.md` (root) → `Hubs/` (7 business MOCs) + folder indexes → files. On 2026-08-03 orphan rate went 78% → 0.5% this way. Core rules:

1. **Tags do NOT create graph edges — only [[wikilinks]] do.** Frontmatter/tags work is metadata hygiene, not linking. Every linking action = an entry in an index or hub.
2. **Every new file must get a wikilink entry in its folder's index.** Indexes: `Samsung Notes/Samsung Notes Index`, `Job Drafts/Job Drafts Index`, `Claude Code Sessions/Claude Code Sessions Index`, `Autonomous Agent/Autonomous Agent Index`, `for-friend/For-Friend Index`, `Log/Log Index`, `Claude Memory/Claude Memory Index`, `Projects/Projects Index`, `Knowledge/Knowledge Index` (grouped by subfolder), `agency-site/agency-site Index` (grouped), `Gemini Chats/_Index`, `Claude Chats/_Index`, `Data Vault/00 – Master Index & Intelligence Overview`.
3. **Always path-based links in indexes**: `- [[Folder/sub/name|name]]` — the vault has mass duplicate basenames (79× SKILL.md in for-friend alone); bare-name links are ambiguous.
4. **Business-relevant new files also get added to the matching hub** in `Hubs/`: <second-domain> Hub, agency-site Hub, project-c Hub, the company Hub, marketplace-app Hub, the company Hub, YouTube Content Hub. New business/venture → create a new hub and link it from `Home.md`.
5. **`backup/` is excluded from the Obsidian index** via `userIgnoreFilters` in `.obsidian/app.json`. Never index, type, tag, or link anything inside `backup/`. Each run, verify app.json still contains `"userIgnoreFilters": ["backup/"]` (Obsidian can overwrite settings) — restore if missing.
6. New top-level folders → create a `<Folder> Index.md` inside and link it from `Home.md`.

## VAULT STRUCTURE

- `Home.md` — root entry point (hubs, indexes, memory core, small folders, loose files)
- `Hubs/` — 7 business MOC hubs
- `Claude Memory/` — Profile.md, Preferences.md, Projects.md, Notes for Claude.md, AI Tools Discoveries.md, Self-Evolution Log.md, Claude Setup & Capabilities.md, Claude Memory Index.md
- `Gemini Chats/` — numbered exports, _Index.md (rebuilt 2026-08-03 as 433-wikilink index; `_Index.old-2026-08-03.md` is the pre-rebuild copy)
- `Claude Chats/`, `Claude Code Sessions/` — chat/session exports with indexes
- `Knowledge/` — ChatGPT/, How-To/, Tools/, Synthesis/, standalone notes + Knowledge Index.md
- `Log/` — Decisions.md, Done.md, Processed Sessions.md, Vault Maintenance Log.md, Weekly/, Quarterly/ + Log Index.md
- `Monthly Compass/`, `Projects/`, `Samsung Notes/`, `Space/`, `YouTube Analytics/`, `Data Vault/`, `agency-site/`, `Clients/`, `Job Drafts/`, `Autonomous Agent/`, `for-friend/`, `agent-os Memory/`
- `backup/` — EXCLUDED, do not touch

## PART 1 — MAINTENANCE (do these first)

### 1. Audit vault structure

List all files (skip `backup/` and `.obsidian/`). Identify new files since last run (mtime), misplaced files, new folders. New folders get an index (rule 6).

### 2. Deduplicate and consolidate

Look for duplicate or near-duplicate notes — same topic, similar titles, overlapping content. For confirmed duplicates: merge richer content into one, delete the other, update index/hub links. Flag uncertain cases in the maintenance log — never delete unless certain.

### 3. Frontmatter on new files

The whole vault was typed on 2026-08-03 (1138 files stamped; type/date/tags complete everywhere outside backup/). Weekly job is now incremental: find files modified since last run that are missing `type`, `date`, or `tags` and stamp them. Taxonomy by folder: project (Projects/, agency-site/, Clients/, Job Drafts/, Autonomous Agent/, Hubs/), knowledge (Knowledge/), log (Log/), journal (Log/Weekly, Log/Quarterly, Monthly Compass/), memory (Claude Memory/, agent-os Memory/, Space/), chat (Gemini Chats/, Claude Chats/, Claude Code Sessions/), reference (everything else). Multi-line YAML tags only. Record count in the log.

### 4. Linking pass (index + hub integrity)

Per the GRAPH ARCHITECTURE rules: every file created since last run gets a path-based entry in its folder's index; business-relevant ones also into the right hub. Then run a quick orphan check (files with 0 inbound and 0 outbound links, excluding backup/) — if orphan count exceeds ~2% of the vault, diagnose and fix; report the orphan % in the log every week. Where notes substantively reference each other's topics, add inline [[wikilinks]] too (Projects ↔ chats, Knowledge ↔ Projects, Synthesis ↔ source chats).

### 5. Update Gemini Chats index

Read `Gemini Chats/_Index.md`. Check "Last Processed Number". For new chat files beyond it, append `- [[NNN - Title]]` entries to the index list and update the stats header. Note dual-numbered chats (037–109 have two files per number — index both).

### 6. Curate Claude Memory briefing files

IMPORTANT: The memory skill loads ONLY `Projects.md` and `Notes for Claude.md` at session start. Keep them tight, current, useful.

**Projects.md — full rewrite each week:**
- Read Projects/ files and recent chats for activity
- Sections: `## Active Projects` (activity last 2 weeks; name, one-line status, next action), `## On Hold`, `## Emerging` (signals from chats without a Projects/ file yet)
- Remove done/abandoned (check Log/Done.md). Keep under ~80 lines.

**Notes for Claude.md — prune and refresh:**
- Remove resolved/stale items (check Done.md, recent chats)
- Keep `## Open Questions` current
- HARD RULE: under 80 lines after pruning. Move data-extraction results to Data Vault/, self-evolution findings to Self-Evolution Log.md, setup records to Knowledge/. Full rewrite, don't patch.

Do NOT touch Profile.md or Preferences.md.

### 7. Clean up Log/

- `Log/Done.md` — items older than 60 days → `## Archived` section at bottom.
- `Log/Processed Sessions.md` — append a record of this run.
- `Log/Vault Maintenance Log.md` — append a dated entry (see Part 3).

## PART 2 — INTELLIGENCE PASS (after maintenance)

### 8. Recurring concern detection

Read the 15 most recently modified Gemini chat files. Flag topics appearing 3+ times without a Done.md entry — under "Recurring Concerns" in the log.

### 9. Intention-execution audit

Most recent Monthly Compass report → "Three Purposeful Moves" → check Done.md. Report completed vs open and weeks elapsed. Log under "Intention-Execution Audit".

### 10. Topic frequency snapshot

Chats added since last run, counted by domain (Iceland business, <second-domain>/spirituality, the company/auto, tech/tools, personal/health, gaming, other). One-sentence "this week your mind was mostly in X and Y". Log under "Topic Frequency".

### 11. Cross-domain synthesis

Read 5–7 recent chats from 2+ domains. Find one creative connection not obvious from either alone. Save as `Knowledge/Synthesis/YYYY-WNN - [Short Title].md` (context + 2–4 sentence insight), add it to Knowledge Index, link it in the maintenance log.

### 12. Open questions tracker

From recent chats and Samsung Notes: 2–4 genuinely unresolved recurring questions → `Claude Memory/Notes for Claude.md` under "## Open Questions (as of YYYY-MM-DD)", replacing the previous section.

## PART 3 — MAINTENANCE REPORT

### 13. Write maintenance log entry

Append dated entry to `Log/Vault Maintenance Log.md`: files added/modified/deleted; duplicates merged/flagged; frontmatter stamped (count); index/hub entries added (count) + current orphan %; Gemini index range updated; memory files curated (final line count of Notes for Claude.md); Recurring Concerns; Intention-Execution Audit; Topic Frequency; Synthesis note link; Open Questions updated; issues for uzytkownik's manual review.

## CONSTRAINTS

- Never delete a file without being very confident it's a true duplicate. When in doubt, flag it.
- Preserve all original content — merges combine, never discard.
- Direct, minimal tone — no fluff.
- The user is NOT present — make reasonable choices and document them.
- If a section is already well-organised, skip it and note that.
- Projects.md and Notes for Claude.md are SESSION BRIEFING FILES — compact and current.
- backup/ is off-limits for all operations except verifying the app.json exclusion.
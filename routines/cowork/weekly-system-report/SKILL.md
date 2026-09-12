---
name: weekly-system-report
model: claude-sonnet-5
description: Sunday evening: weekly system report + creates next week's journal entry in Obsidian (combined)
---

You are generating <owner>'s weekly system report — a single document that answers: "What did my automation system actually do this week, and what is the current state of all my projects?" After the report is complete, you will also create next week's journal entry file.

**"System" means BOTH automation layers**: Cowork scheduled tasks (the `mcp__scheduled-tasks` registry) AND Claude Code scheduled tasks (`~/.claude\scheduled-tasks\`). These are separate schedulers with separate registries. Reporting only the Cowork layer produces a report that looks complete and isn't — that was a real defect in reports up to and including 2026-W36.

This is a Sonnet-tier task. Structured synthesis across known sources — no deep judgment needed.

---

## CRITICAL PRINCIPLE: SUMMARIZE ACTUAL OUTPUTS, NOT JUST ACTIVITY

The report must include the actual findings, results, and content produced by each task — not just "it ran 3 times." For example:
- ai-tools-discovery: Include the FULL ranked tool list with star ratings, what each tool does, why it matters for uzytkownik's projects, new proposals identified, and behavioral patterns observed
- vault organiser: Include specific files created/modified/deleted, duplicates resolved, interlinking added, persistent issues
- self-evolution-cycle: Include what was fixed, what was flagged, what proposals were evaluated, what was built (if anything)
- claude-to-obsidian / daily-ai-session-sync: Include highlights of key sessions — what topics dominated, what decisions were made, what was learned
- Monthly Review: If generated this period, include the core theme and three priorities with their execution status

The goal: uzytkownik reads this ONE document and knows everything the system produced AND the current state of all his projects. He should never need to go read the individual task outputs or open a project file.

---

## TOOL ACCESS (READ FIRST)

The Obsidian MCP is frequently NOT connected during scheduled Cowork runs. The vault is directly reachable on disk at `~/.claude/memory\` via the **desktop-commander** MCP, which DOES work in scheduled runs. Use desktop-commander `read_file`/`write_file` as the primary method; fall back to Obsidian MCP (`get_vault_file` etc.) only if desktop-commander is unavailable. Load via ToolSearch if deferred (`query: "desktop-commander"`, max_results 30).

## PHASE 1 — GATHER INTELLIGENCE

Read the following from `~/.claude/memory\...` (desktop-commander `read_file`; fallback: Obsidian MCP `get_vault_file`):

1. `Log/Vault Maintenance Log.md` — find this week's entry (most recent). Pull: files changed, duplicates handled, recurring concerns, intention-execution audit, topic frequency, synthesis note created. Include ALL specifics.

2. `Log/Processed Sessions.md` — count how many Cowork sessions happened this week. Pull highlights: key user sessions (what topics, what was saved), patterns (heavy days, light days).

3. `Claude Memory/Capability Proposals.md` — check the Build Log for anything built this week. Check Active Proposals for what's queued. Check Predictive Proposals for forward-looking items.

4. `Claude Memory/Notes for Claude.md` — pull any flags, open questions, or corrections logged this week.

5. `Claude Memory/Projects.md` — current project status. Note every project listed and its current state.

6. `Claude Memory/AI Tools Discoveries.md` — Read the FULL file. Pull the complete star-ranked lists (High Signal, Emerging, New This Run) with tool names, descriptions, and relevance to uzytkownik's projects. Include capability proposals and pattern observations.

7. Check for any new files in `Knowledge/Synthesis/` from this week — cross-domain insights generated.

8. Check `Log/Weekly/` for this week's journal entry (if it exists already).

9. Check `YouTube Analytics/` for any new snapshots this month.

10. Check `Monthly Review/` — if a new compass was generated this month, include its core theme, three priorities, and their execution status (check Done.md and session activity for evidence).

11. Read `Log/Done.md` — extract entries from the past 7 days. You'll need these for the journal seeder in Phase 3.

12. Read `Data Vault/Lovable Projects Snapshot.md` — pull the full repo list: active repos with most recent commits, stack info, any new repos detected, and the portfolio observations written at the top. This feeds directly into the Code Activity section of the report.

13. Read ALL files in the `Projects/` folder — these are the source of truth for each project. For each file, extract: current status, what's been done, what's blocked, what's next. This feeds the Project Pulse section.

14. **Claude Code scheduled tasks — SECOND automation layer, do NOT skip.** The Cowork registry (`mcp__scheduled-tasks__list_scheduled_tasks`) shows ONLY Cowork tasks. Claude Code has its own, separate scheduled tasks that this report was blind to until 2026-09-12. They live in `~/.claude\scheduled-tasks\<name>\SKILL.md` (as of 2026-09-12: `fleet-pr-reviewer`, `fleet-cve-watch`, `fleet-auto-improve`, `guard-health`, `pg-reviewer-calibration`). Enumerate the directory every run — do not hardcode this list, it changes.

    **There is no registry and no lastRunAt for these.** Their schedule lives inside the Claude Code app, not in any file on disk (verified 2026-09-12: not in `settings.json`, not in `.claude.json`). So verify them from ARTIFACTS, which is the more reliable method anyway (SYSTEM-MAP rule #4):
    - Each task writes a breadcrumb log to `~/.claude/memory/log\<task-name>.md` — `STARTED <ISO>` at the beginning, then a `STATUS:` / `DONE` / `FAILED` line at the end.
    - Read the tail of each log. Pull: date of last run, what it actually produced (PR numbers, CVE counts, RED/OK verdicts), and any open decisions it left for uzytkownik.
    - **Dead run = the last non-empty line is `STARTED` with no matching DONE/FAILED/STATUS.** Report that as a FAILED run, not a silent gap.
    - **A task with a SKILL.md but no log file at all has either never run or never wrote** — say which task, and say you can't tell which of the two it is rather than guessing.
    - `fleet-auto-improve` is manual-trigger by design (its own SKILL.md says so) — absence of runs there is correct, not a failure. Don't report it as overdue.
    - `Claude Memory/Log/guard-health.md` is the highest-value tail to read: `guard_health.py` runs 90+ deterministic checks weekly and its RED lines name broken things across BOTH layers.

Also: list all Cowork scheduled tasks (`mcp__scheduled-tasks__list_scheduled_tasks`) and note their lastRunAt timestamps. This tells you which Cowork tasks actually fired this week and which didn't. Combine with item 14 so the report covers both layers — a report that silently omits the Claude Code layer is incomplete, and that is exactly the defect this instruction exists to prevent.

---

## PHASE 2 — COMPILE THE REPORT

Create the report as a new file: `Log/Weekly Reports/YYYY-WNN — Weekly System Report.md`

Structure:

```markdown
# Weekly System Report — Week NN, YYYY
*Generated: [date and time]*
*Period: [Monday] to [Sunday]*

---

## System Activity

Which scheduled tasks ran this week, how many times, and when. **Two tables — both layers, always.** Omitting the second table is a defect, not a shortcut.

**Layer 1 — Cowork scheduled tasks** (source: `mcp__scheduled-tasks__list_scheduled_tasks`):

| Task | Runs | Last Run | Status |
|------|------|----------|--------|
| daily-ai-session-sync | 7 | [date] | OK |
| ... | ... | ... | ... |

Flag any tasks that SHOULD have run but didn't (based on their cron schedule vs. lastRunAt).

**Layer 2 — Claude Code scheduled tasks** (source: `~/.claude\scheduled-tasks\` + breadcrumb logs in `Claude Memory/Log/`):

| Task | Last run (from log) | What it produced | Status |
|------|------|------|--------|
| fleet-pr-reviewer | [date from log tail] | [PRs reviewed / comment-only / auto-fixes] | OK / DEAD RUN / NO LOG |
| fleet-cve-watch | [date] | [n high/critical, PR numbers, category-B items] | ... |
| guard-health | [date] | [OK: n checks / RED: what broke] | ... |
| pg-reviewer-calibration | [date or "no log file"] | ... | ... |
| fleet-auto-improve | manual-trigger by design | ... | n/a — not scheduled |

Rules for Layer 2: `STARTED` as the last line = DEAD RUN (report as failed). No log file = say so plainly and say you cannot tell "never ran" from "ran and never wrote". Never infer a run happened because a SKILL.md exists.

**Cross-layer check:** if `guard-health`'s log has RED lines this week, every one of them belongs somewhere in this report — either resolved (say when and by what) or in Open Items. A RED that appears in the guard-health log and nowhere in this report is the exact blind spot this section exists to close.

---

## Project Pulse

For EACH active project in Projects.md and the Projects/ folder — write a paragraph covering:
- Current status in plain terms (what phase is it in, what's working, what's not)
- What moved forward this week (based on session activity, vault changes, Done.md entries, GitHub commits if applicable)
- What's stuck or blocked right now
- The single most important next action

Cover every project — don't skip quiet ones. If there's been no activity, say that clearly and note how long it's been quiet. Base this on the actual project files from Projects/ folder first, then cross-reference with session activity.

Projects to cover: derive the full list from `Claude Memory/Projects.md` and the `Projects/` folder.

---

## Code Activity — GitHub / Lovable

From `Data Vault/Lovable Projects Snapshot.md`:
- Portfolio overview: how many repos total, how many active in the last 14 days
- For each ACTIVE repo: repo name, last commit date + message, what the commits suggest is being built, current stack, any notable changes
- Less active repos: brief list with last commit date
- Any new repos detected this week
- Overall trajectory: is code activity accelerating, steady, or slowing down?

---

## AI Tools Discovery — Full Findings

Include the COMPLETE ranked tool inventory from the discovery file:
- High Signal (⭐⭐) tools: name, what it does, why it matters for uzytkownik — as a table
- Emerging (⭐) tools: same format
- New This Run: same format
- Claude Capabilities ranked list: what's available, what's blocked, what's underused
- New skill/capability proposals identified
- Vault pattern observations (behavioral patterns from chat analysis)

This section should be comprehensive enough that uzytkownik never needs to open AI Tools Discoveries.md separately.

---

## Vault Organiser — Full Results

For each run this week:
- Files created / modified / deleted (specifics, not just counts)
- Duplicates resolved or investigated
- Interlinking added
- Memory files curated (what was pruned/added in Projects.md and Notes for Claude.md)
- Persistent issues still open
- Recurring concerns detected
- Topic frequency snapshot

---

## Self-Evolution Cycle — Results

For each cycle this week:
- What documentation was fixed
- What was flagged or observed
- What proposals were evaluated
- What was built (if anything)
- What predictions were made

---

## Session Capture — Highlights

From daily-ai-session-sync / Processed Sessions:
- Total sessions processed, how many saved vs skipped
- Key sessions grouped by theme (business strategy, infrastructure, creative, etc.)
- What skills were created
- What decisions were made
- What was learned

---

## Monthly Review Status (if applicable)

If a compass exists for this month:
- Core theme
- three priorities with execution status (DONE / IN PROGRESS / NO EVIDENCE)
- Evidence for each status assessment

---

## Predictions & Forward Look

- What did self-evolution-cycle predict? Were any previous predictions confirmed or invalidated?
- What's queued for next week? (Upcoming task runs, pending proposals, approaching deadlines)
- Trajectory signals worth watching

---

## Open Items

Two sections:
- **For the system to handle**: things automated tasks will address in upcoming runs
- **For uzytkownik to handle**: manual actions needed, decisions pending, things the system can't do itself

---

## One-Line Summary

A single sentence capturing the week.
```

---

## PHASE 2.5 — CROSS-REFERENCE

Before saving, do a quick sanity check:
- Does the task activity table match what the cron schedules predict?
- **Are BOTH layer tables present** — Cowork AND Claude Code? Does every directory under `.claude\scheduled-tasks\` have a row? (If the report has only one table, stop and add the second one before saving.)
- **Does every RED line in this week's `guard-health.md` appear somewhere in the report?**
- Are there proposals in the Build Log that don't show up in "What Was Built"?
- Does the project pulse match the session activity?
- If a Compass exists, does the move status match what you see in sessions and logs?

---

## PHASE 2.6 — SAVE, LINK, AND NOTIFY

1. Save the report to `Log/Weekly Reports/YYYY-WNN — Weekly System Report.md`
2. Append a one-line entry to `Log/Processed Sessions.md`: "Weekly System Report generated for Week NN"
3. If the weekly journal entry exists in `Log/Weekly/`, add a link to this report at the bottom
4. Send ntfy push notification via bash (topic `mas-report-586ce6`). Make it genuinely informative — uzytkownik explicitly does NOT want a vague one-liner. Fill EVERY caps field with real values pulled from the report:

```bash
curl -s -X POST "https://ntfy.sh/<your-topic>" \
  -H "Title: [RAPORT] Tydzien NN/YYYY — score SCORE/100" \
  -H "Priority: default" \
  -H "Tags: memo,bar_chart" \
  -d "PODSUMOWANIE TYGODNIA NN/YYYY
ZADANIA: HEALTHY ok / FAILED padly (z TOTAL) | sesje: SESSIONS
TOP WIN: ONE_CONCRETE_WIN
NAJWIEKSZY PROBLEM: ONE_CONCRETE_ISSUE
USAGE/WYDATKI: SPEND_LINE
-> NASTEPNY RUCH: ONE_CONCRETE_NEXT_ACTION"
```

Replace every CAPS placeholder with the real value from the report — no generic phrasing. If the curl command fails, note it in the log but do not block the task.

---

## PHASE 3 — CREATE NEXT WEEK'S JOURNAL ENTRY

Now create next week's journal file so it's waiting for uzytkownik on Monday morning.

**Step 3a — Calculate the week identifier.**
Use today's date + 7 days to determine NEXT week's ISO week number. Format: `YYYY-WNN` (zero-padded). File path: `Log/Weekly/YYYY-WNN.md`.

**Step 3b — Check if the file already exists.**
Use `get_vault_file` to check. If it already exists, skip creation and note it in the action log.

**Step 3c — Pre-populate context.**
Use the data already gathered in Phase 1:
- Done.md entries from the past 7 days (already read in step 11 above)
- three priorities from the most recent Monthly Review (already read above)

**Step 3d — Create the journal file:**

```markdown
---
date: <next Monday's date YYYY-MM-DD>
week: <YYYY-WNN>
tags:
  - journal
  - weekly
---

# Week YYYY-WNN — Journal

*Takes 5 minutes. Be honest, not impressive.*

---

## What I actually worked on this week
[Pre-fill with Done.md entries from the past 7 days. If none found, write: "(nothing logged in Done.md this week)"]

---

## What I kept putting off or avoiding

[uzytkownik fills in]

---

## What shifted my thinking or surprised me

[uzytkownik fills in]

---

## This month's three moves — progress check
[Pre-fill the three moves from the most recent Monthly Review]

- Move 1: [pre-filled from compass]
- Move 2: [pre-filled from compass]
- Move 3: [pre-filled from compass]

How am I tracking on these?

[uzytkownik fills in]

---

## Energy level this week (1–10):
## One word that describes this week:

---
*Auto-created by weekly-system-report on YYYY-MM-DD.*
```

**Step 3e — Note in Claude Memory.**
Append one line to `Claude Memory/Notes for Claude.md`:
`Weekly journal YYYY-WNN pre-created on YYYY-MM-DD — awaiting uzytkownik's input.`

---

## CONSTRAINTS

- This is primarily a READ and SYNTHESIZE task. Only write: the weekly report file, the journal entry file, and the small log/notes entries noted above.
- Keep the report scannable. Tables for data, prose for narrative. No walls of bullet points.
- If a data source is empty or missing, note it and move on.
- Do NOT fill in uzytkownik's open reflection answers in the journal — only pre-populate factual context.
- Total execution: under 40 minutes.

---

RATE LIMIT RECOVERY:

If you hit a Claude rate limit error during execution:

1. STOP and save whatever you've compiled so far to the report file (partial is better than nothing)
2. Save a checkpoint to Claude Memory/Task Checkpoints.md:
   - Task ID: weekly-system-report_[date]
   - Task Name: Weekly System Report - [phase completed]
   - Status: interrupted
   - Definition: {"task_type": "scheduled_task", "original_prompt": "weekly-system-report", "parameters": {"week": "YYYY-WNN"}, "estimated_tokens_remaining": [estimate], "output_location": "Log/Weekly Reports/"}
   - Progress: {"steps_completed": [...], "current_step": "[phase]", "steps_remaining": [...], "outputs_so_far": {"partial_report": "Log/Weekly Reports/YYYY-WNN — Weekly System Report.md"}, "context_for_resume": "[what sections are done]"}
3. STOP gracefully
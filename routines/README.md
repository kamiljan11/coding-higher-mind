# Routines — the part of the system that runs while nobody is typing

PG has two agent runtimes and each has its own scheduler. Both kinds of routine are plain prompts with a cron line and the
[verification protocol](../docs/VERIFIED-PROTOCOL.md) appended, so a routine can never report success without evidence.
The rule that matters most: **a routine that could "find itself work" is off by design** — automation runs on a schedule
only when its cost is deterministic (a script first, a model only on findings) or its scope is a closed loop (audit the
system, back it up, write the report).

## Claude Code routines (`../scheduled-tasks/`)

Registered with Claude Code's scheduled-tasks tool (frontmatter `schedule:` + `model:`; the registry is created by the
tool, you only need the `SKILL.md`). They run inside the same hooks and gates as an interactive session.

| Routine | Cadence | What it does | Tokens |
|---|---|---|---|
| `fleet-pr-reviewer` | weekday mornings | reviews open pull requests across all repos like a senior; mechanical fixes land as separate commits with proof; design/security findings stay comments for the human | model (Sonnet) |
| `guard-health` | weekly | `hooks/guard_health.py`: are the hooks still registered, do the gates still block their own cases, which escape hatches were used and why, did any scheduled task die mid-run | ~0 — script; model only on RED |
| `fleet-cve-watch` | monthly | deterministic dependency scan of the live products first; the model wakes only on findings; fixes are patch/minor only and arrive as pull requests, never pushes | ~0 when clean |
| `pg-reviewer-calibration` | monthly | the same defect in two wrappers (short diff vs long PR description) is reviewed by six fresh-context reviewers in random order; disagreement = length/description bias → alarm, and a human adjusts the rubric (the auditor never edits the instrument it measures) | model |
| `fleet-auto-improve` | **manual only** (disabled cron) | net-negative cleanup of one repository the human points at; historical debt is never cleaned automatically (standing rule) | model |

## Claude Desktop (Cowork) routines (`cowork/`)

Cowork has no hooks, so these routines carry the protocol as text. They are the operations side of the system: memory,
backup, watchdog, self-improvement. Paths were rewritten to `~/.claude/…`; adjust to your own vault.

| Routine | Cadence | What it does |
|---|---|---|
| `deferred-task-runner` | every 2 h | the watchdog: finds routines that are overdue or died mid-run, retries, self-heals what it can, pushes a phone notification only when it cannot; resumes work that a rate limit interrupted (reads the checkpoint file `RESUME.md`) |
| `claude-config-backup` | daily 03:00 | full clone of the agent configuration (`~/.claude`, routines, memory index) to the backup drive and generates a one-click restore script for a new machine — the backup that was never restored is not a backup, so the restore script is part of the backup |
| `claude-code-to-obsidian` / `claude-to-obsidian` | Mon+Thu / daily | sessions document themselves: transcripts → dated notes in the memory vault (decisions, files touched, next step), so the next session starts from a file instead of from scratch |
| `weekly-obsidian-vault-organiser` | weekly | memory hygiene: hub-and-spoke links, frontmatter typing, orphan watchdog, curation — a memory that is not maintained stops being loaded |
| `weekly-system-report` | Sunday evening | one report on the whole system: what ran, what failed, what was skipped, cost, decisions pending — the "how is it going?" answer a sponsor expects |
| `self-evolution-cycle` | every 3 days (**opt-in, disabled by default**) | reads recent transcripts, detects behavioural patterns (repeated corrections, repeated tool errors, rules that were bypassed) and proposes edits to `CLAUDE.md` and operational files — each with cited evidence and a verification command. Only proposals the human approves become standing rules; the loop never edits the rules on its own |
| `ai-tools-discovery` | biweekly (**disabled by default**) | capability scout: new connectors, skills and tools, written as structured proposals for the self-evolution cycle to evaluate |
| `skill-trigger-optimizer` | weekly (cheap model) | audits skill trigger descriptions against what the system actually works on, so the skill router keeps routing |

### Registering a Cowork routine

Open Claude Desktop → Scheduled tasks → new task → paste the `SKILL.md` body as the prompt and set the cadence from the
frontmatter. Keep the `VERIFICATION PROTOCOL` block at the end of every prompt. Give routines a log file per task
(`~/.claude/memory/log/<task>.md`, first line `STARTED <date>`, last line the status) — `guard-health` reads those logs to
detect routines that started and never finished.

## Why the split

| | Claude Code routines | Cowork routines |
|---|---|---|
| Enforcement | hooks + git gates apply | text protocol only |
| Typical job | code review, audits, dependency scans | memory, backup, reports, watchdog |
| Cost control | deterministic script first, model on findings | cheap model where the job is mechanical |
| Failure detection | `guard_health.py` + gate telemetry | `deferred-task-runner` + log files |

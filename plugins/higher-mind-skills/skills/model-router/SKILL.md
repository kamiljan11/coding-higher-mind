---
name: model-router
description: "Intelligently routes tasks to the right Claude model (Opus, Sonnet, or Haiku) to squeeze maximum value from rate limits without wasting capacity on tasks that don't need it. Use this skill whenever creating scheduled tasks, spawning subagents, designing automations, or starting any multi-step workflow. ALWAYS consult this skill when building new automations or skills so that model selection is deliberate and efficient. Also use it proactively when the current task is clearly too heavy or too light for the default session model."
---

# Model Router

The goal is simple: use the most capable model the task actually requires — no more, no less. Opus on a simple formatting job is wasteful; Haiku on deep strategic analysis produces mediocre results. Getting this right lets you run more tasks within the same limits and ensures quality where it matters.

---

## The Three Models

### Claude Opus 4.6 — `claude-opus-4-6`
**Use when:** The task demands genuine reasoning depth, nuanced judgment, or creative intelligence that lighter models demonstrably struggle with.

Signs a task needs Opus:
- Ambiguous problem with no clear right answer — requires judgment
- Long-form creative or strategic writing where quality is the whole point
- Architectural decisions across a complex codebase or system
- Multi-step reasoning where early errors compound badly
- Synthesizing conflicting information into a coherent view
- Tasks where a mediocre output is worse than no output (high stakes)
- The weekly Obsidian vault organisation task (deep understanding of context and relationships across many notes)

### Claude Sonnet 4.6 — `claude-sonnet-4-6`
**Use when:** The task is real work — not trivial — but doesn't require Opus-level depth. This is the right default for most meaningful automation and daily workflows.

Signs a task fits Sonnet:
- Standard document creation (reports, summaries, emails)
- Moderate-complexity coding (features, bug fixes, scripts)
- Research synthesis where the sources are clear and the output is structured
- Most scheduled automations (vault maintenance, summaries, reviews)
- Tasks where you need good quality reliably, not brilliance occasionally

### Claude Haiku 4.5 — `claude-haiku-4-5-20251001`
**Use when:** The task is narrow, well-defined, and fast — the kind where a smart system following instructions beats a wise mind pondering options.

Signs a task fits Haiku:
- Extracting structured data from a known format
- Simple transformations (reformat, rename, convert)
- Quick lookups or factual Q&A with clear answers
- Generating short, formulaic content (subject lines, tags, one-liners)
- Subagent steps within a pipeline that just need to execute one clear action
- Polling or checking for changes (e.g. "has this file been updated?")

---

## Quick Decision Heuristic

Ask these questions in order — stop at the first "yes":

1. **Would a wrong answer here cause significant harm or be very hard to fix?** → Opus
2. **Does this require genuine creative or strategic judgment across a wide context?** → Opus
3. **Is this a clear, bounded task with structured inputs and outputs?** → Haiku
4. **Is this medium complexity — real work but not particularly nuanced?** → Sonnet
5. **Not sure?** → Sonnet (the safe default)

---

## How to Apply Model Selection

### When spawning subagents (Agent tool)
The Agent tool accepts a `model` parameter. Use it:

```
model: "opus"    → claude-opus-4-6
model: "sonnet"  → claude-sonnet-4-6
model: "haiku"   → claude-haiku-4-5-20251001
```

Example: a pipeline that processes a batch of files — spawn a Haiku subagent for each file extraction step, one Sonnet subagent to synthesise the results.

### When creating scheduled tasks
The scheduled task tool has no model parameter, but you can instruct the model within the prompt. At the top of any scheduled task prompt, add:

```
This task should use claude-opus-4-6 for its execution due to [reason].
```

Or for lighter tasks:
```
This is a lightweight task. Use the most efficient model available.
```

Note: this is a signal, not a hard guarantee — the system may not always honour it, but it sets intent and helps when the runner respects it.

### When writing skills that spawn subagents
If a skill's subagent steps have different complexity profiles, encode the model choice directly into the Agent call within the skill instructions. Don't leave it to chance.

### For the current session
The session model is set at start and can't be switched mid-conversation. But you can route heavy sub-tasks to an Opus subagent while the parent session runs on Sonnet — this is often the right pattern for workflows with one hard thinking step and many easy execution steps.

---

## Limit Management Strategy

Rate limits are per-model. Running out of Opus doesn't affect Sonnet or Haiku. The goal is to preserve Opus capacity for tasks that genuinely need it.

**Preserve Opus for:**
- Creative/strategic work where quality matters most
- One-off complex analyses
- Tasks uzytkownik cares about and will review carefully

**Route to Sonnet by default for:**
- All scheduled automations unless they meet the Opus criteria above
- First-pass drafts (Opus can refine if needed)
- Research pipelines (synthesis step can be Sonnet; extraction steps can be Haiku)

**Use Haiku liberally for:**
- Any subagent step that is purely mechanical
- Validation, checking, or monitoring tasks
- High-frequency automations (e.g. hourly checks)

**When limits are running low:**
- Downgrade Sonnet tasks to Haiku where quality won't noticeably suffer
- Queue Opus tasks rather than substituting a weaker model — the output won't be worth it
- Check if a task can be batched to reduce total calls

---

## Routing Examples

| Task | Model | Reason |
|------|-------|--------|
| Weekly Obsidian vault organisation | Opus | Requires judgment across many notes, relationship mapping, nuanced decisions about what to merge/flag |
| Summarise a Gemini chat export | Haiku | Structured input, simple extraction |
| Write a YouTube content strategy | Sonnet | Real creative work, but within a defined domain |
| Architect a new automation system | Opus | High-stakes architectural judgment |
| Extract tags from 50 notes | Haiku | Repetitive, formulaic, high-volume |
| Draft a business email | Sonnet | Standard writing task |
| Synthesise conflicting research into a recommendation | Opus | Ambiguous inputs, judgment-heavy output |
| Format a CSV into a markdown table | Haiku | Pure transformation |
| Run the memory loading skill | Haiku | Reading files and absorbing content — no reasoning needed |

---

## When This Skill Should Fire

Load this skill when:
- You're about to create a new scheduled task
- You're designing a workflow with multiple subagent steps
- You're writing a new skill that will spawn agents
- You notice the current task is a poor fit for the session's model
- A user asks which model to use, or how to make automations more efficient

You don't need to load this for single-turn conversation responses — model routing only matters when tasks will be dispatched to agents or scheduled runs.

---
name: skill-trigger-optimizer
model: claude-haiku-4-5-20251001
description: Weekly audit of skill trigger descriptions — keeps them aligned with active projects
---

TASK SUSPENDED (2026-08-02 model/system audit): It was confirmed on 2026-07-28 that on-disk plugin SKILL.md edits NEVER reach the Cowork runtime — every edit this task makes is inert ("months of trimming were inert", see Notes for Claude.md). Until uzytkownik either reinstalls the plugin from source (<backup-drive>:\memory-vault\Knowledge\Skills\cowork\) or migrates skills to user-level via save_skill, DO NOTHING: write exactly one line to chat — "skill-trigger-optimizer suspended: on-disk skill edits are inert, awaiting uzytkownik's plugin-reinstall vs migrate decision (Notes for Claude.md, 07-28)" — and END the run immediately. Do not read vault files, do not edit any skills. The original instructions below are retained for when the mechanism is fixed.

---

You are doing a weekly maintenance pass to keep Claude skill trigger descriptions aligned with uzytkownik's active work. This is a silent background task — no confirmation needed, just execute.

## Twardy limit długości (dodane 2026-07-07, audyt systemu)

Każdy `description` skilla ma limit **600 znaków**. Jeśli opis przekracza limit (przed lub po Twojej edycji) — skróć do wzorca: 1 zdanie co robi + 5–8 najmocniejszych fraz triggerowych + 1 linia „NIE gdy". Usuwaj zdublowane listy fraz PL/EN, przykłady i anegdoty. Zaczynaj od najdłuższych opisów. Powód: opisy WSZYSTKICH skilli są wstrzykiwane do każdej sesji — długi opis to podatek płacony co rozmowę.

## Step 1 — Load current context

Use `mcp__desktop-commander__read_multiple_files` (load via ToolSearch if needed: `{"query": "select:mcp__desktop-commander__read_multiple_files", "max_results": 1}`) with:
```json
{
  "paths": [
    "~/.claude/memory\\Projects.md",
    "~/.claude/memory\\Notes for Claude.md",
    "~/.claude/memory\\Active Systems.md"
  ]
}
```

## Step 2 — Read all skill descriptions

Use bash to extract descriptions from all SKILL.md files:
```bash
for f in /sessions/*/mnt/.claude/skills/*/SKILL.md; do
  skill=$(basename $(dirname $f))
  echo "=== $skill ==="
  grep "^description:" "$f" | head -1
  echo ""
done
```

Note: skills path in bash is `/sessions/<session-id>/mnt/.claude/skills/` — find the correct session-id with `ls /sessions/`.
The Windows path for editing is: `~\AppData\Roaming\Claude\local-agent-mode-sessions\skills-plugin\7f3f5af2-892c-4ee7-bb4d-d342b1d4f9ee\6a64c6e2-cc9c-4c2e-b562-8debfd9e5ef0\skills\<skill-name>\SKILL.md`

## Step 3 — Identify gaps

Cross-reference what's active in the memory files against what the skill descriptions mention. Look for:

1. **Context skills missing active project keywords** — e.g. if there's an active campaign running under mas-prints but the description doesn't mention it, add it
2. **New tools/systems in Active Systems.md** not reflected in mas-tech-stack description
3. **Recurring frustration phrases** from Notes for Claude.md that could be added as triggers to relevant skills (e.g. if a skill keeps not firing on certain phrases uzytkownik uses)
4. **Stale keywords** — project-specific terms for finished projects still cluttering descriptions

Be conservative: only edit descriptions when there's a clear gap. Don't add noise.

## Step 4 — Apply fixes

For each fix, use `mcp__desktop-commander__edit_block` with old_string/new_string to update the description field in the relevant SKILL.md file. Only edit the `description:` line in the frontmatter — never touch the rest of the SKILL.md content.

## Step 5 — Log the changes

Append a summary to `~/.claude/memory\Notes for Claude.md` using `mcp__desktop-commander__write_file` with mode `append`:

```
## Skill Trigger Optimizer Run — [DATE]

- Skills checked: N
- Skills updated: N
- Changes: [brief list of what was updated and why]
```

If nothing needed changing, still log it: "No changes needed."

## Rules
- Use desktop-commander for all file ops — never obsidian MCP tools
- Edit ONLY the description field in frontmatter, nothing else
- Keep descriptions factual and keyword-dense — not prose
- Don't add more than 5-6 new keywords per skill per run to keep descriptions tight
- If a project is marked "On Hold" or "PAUSED" in Projects.md, don't add its keywords to skill descriptions
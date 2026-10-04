---
name: rate-limit-auto-recovery-templates
description: |
  Automatically inject rate-limit recovery templates into task prompts. Use this skill whenever uzytkownik is creating scheduled tasks, spawning subagents, or running any substantial work that might exceed the 5-hour rate limit window. The skill provides context-appropriate templates with checkpoint and resume logic already built in.

  Trigger on: "schedule", "create task", "spawn subagent", "run this", "automate", "set up a task", "recurring", "long-running", or any request to set up work that might take multiple hours. Include this skill proactively whenever uzytkownik is designing automations or multi-step workflows.
compatibility: Obsidian MCP (for checkpoint storage), Task/Scheduling tools
---

# Rate Limit Auto-Recovery Templates

When uzytkownik creates tasks that might exceed the 5-hour rate limit window, this skill automatically provides the right template with recovery logic embedded.

## How It Works

When you're setting up a task (scheduled, subagent, or manual), instead of creating the prompt from scratch, use the appropriate template below. Each includes:

- Your core task logic
- Automatic rate-limit detection
- Checkpoint saving to Obsidian
- Graceful stop when limited
- Auto-restart capability via checkpoint-monitor

The system works in three phases:
1. Task executes normally
2. If rate limit hit → checkpoints state and stops
3. checkpoint-monitor detects it 5 hours later → spawns subagent to resume

## Pick Your Template

### Template 1: Scheduled Task (Recurring Automations)

Use this for any task you're scheduling to run on a timer (daily, weekly, etc.) that might take longer than 5 hours.

```
[Your core task instructions]

---

RATE LIMIT RECOVERY:

If you hit a Claude rate limit error during execution:

1. STOP immediately and identify what's been completed vs. what remains
2. Save a checkpoint to Claude Memory/Task Checkpoints.md:
   - Task ID: [use timestamp, e.g., task_20260406_1430]
   - Task Name: [original name + phase completed]
   - Status: interrupted
   - Created: [start time]
   - Last Updated: [now]
   - Definition: {"task_type": "scheduled_task", "original_prompt": "[full prompt below]", "parameters": {}, "estimated_tokens_remaining": [estimate], "output_location": "/outputs/"}
   - Progress: {"steps_completed": [...list...], "current_step": "[what you were doing]", "steps_remaining": [...], "outputs_so_far": {...files...}, "context_for_resume": "[key context]"}
3. STOP the task gracefully
4. Report: "Rate limit hit. Checkpoint saved: [task_id]. Will auto-restart in ~5 hours."

checkpoint-monitor will automatically restart this task.

Original full prompt:
[Your task description here]
```

### Template 2: Subagent (Substantial Work in Sessions)

Use this when spawning a subagent for work that might hit the rate limit.

```
TASK: [Your subagent work]

CRITICAL: If you hit a rate limit error:

1. Immediately checkpoint your state to Claude Memory/Task Checkpoints.md:
   - Task ID: [unique ID, e.g., task_20260406_1545]
   - Task Name: [what you're doing + phase]
   - Status: interrupted
   - Definition: {"task_type": "subagent", "original_prompt": "[this full prompt]", "parameters": {}, "estimated_tokens_remaining": [estimate], "output_location": "[where outputs go]"}
   - Progress: {"steps_completed": [done], "current_step": "[current]", "steps_remaining": [left], "outputs_so_far": [files], "context_for_resume": "[critical context]"}
2. STOP and report the checkpoint details
3. checkpoint-monitor will automatically restart you in ~5 hours

Your full task:
[Detailed task instructions]
```

### Template 3: Manual Work (Cowork Sessions)

For work you're running directly in Cowork:

```
Task: [Your work]

If rate limited:
- Tell me "Rate limit hit, saving checkpoint [name]"
- I'll save it to Task Checkpoints.md
- checkpoint-monitor will restart it in 5 hours
- Or I can manually resume it now if you prefer
```

## What Goes in the Definition JSON

This describes **what** the task is so the checkpoint-monitor can understand it:

```json
{
  "task_type": "scheduled_task | subagent | manual",
  "original_prompt": "Full prompt or task description",
  "parameters": {
    "key": "value"
  },
  "estimated_tokens_remaining": 50000,
  "output_location": "/outputs/ or other location"
}
```

## What Goes in the Progress JSON

This describes **where you are** so the task can resume cleanly:

```json
{
  "steps_completed": ["step1", "step2"],
  "current_step": "step3",
  "steps_remaining": ["step4", "step5"],
  "outputs_so_far": {
    "intermediate_file": "/outputs/data.csv"
  },
  "context_for_resume": "Any critical state needed to continue from here"
}
```

## Real Example: Scheduled Daily Analysis

Here's what a filled-in template looks like:

```
Task: Daily market analysis

Your job:
1. Fetch market data from APIs
2. Calculate daily metrics
3. Compare to 7-day average
4. Flag anomalies
5. Generate CSV report
6. Save to /outputs/market-analysis-[date].csv

---

RATE LIMIT RECOVERY:

If you hit a Claude rate limit error:

1. STOP immediately and identify what's been completed
2. Save checkpoint to Claude Memory/Task Checkpoints.md:
   - Task ID: task_20260406_1430
   - Task Name: Market Analysis - Metric Calculation Phase
   - Status: interrupted
   - Created: 2026-04-06 08:00
   - Last Updated: 2026-04-06 14:30
   - Definition: {
       "task_type": "scheduled_task",
       "original_prompt": "Daily market analysis...",
       "parameters": {"date": "2026-04-06"},
       "estimated_tokens_remaining": 35000,
       "output_location": "/outputs/"
     }
   - Progress: {
       "steps_completed": ["fetched API data", "calculated metrics"],
       "current_step": "comparing to 7-day average",
       "steps_remaining": ["flag anomalies", "generate report", "save CSV"],
       "outputs_so_far": {
         "raw_data": "/outputs/market-raw-20260406.json",
         "metrics": "/outputs/market-metrics-20260406.csv"
       },
       "context_for_resume": "Processed data through 2:30pm UTC. Use metrics CSV for comparison. Focus on >5% deviations as anomalies."
     }
3. STOP the task
4. Report: "Rate limit hit. Checkpoint saved: task_20260406_1430. Will auto-restart in ~5 hours."

checkpoint-monitor will automatically detect this and restart you.
```

## Integration Points

When you create a task:

1. **Choose the right template** (scheduled, subagent, or manual)
2. **Insert your core task logic** at the top
3. **Keep the recovery section** as-is (it's the same for all tasks)
4. **Provide clear definitions and progress** so resume is smooth

The checkpoint-monitor scheduled task (running every 5 hours) automatically:
- Scans Claude Memory/Task Checkpoints.md
- Finds interrupted tasks >5 hours old
- Marks as ready_to_resume
- Spawns subagent to continue
- Archives when complete

## Best Practices

**Name tasks clearly**
- Good: "Q4-analysis-extraction-phase"
- Bad: "task_1"

**Save outputs to files, not memory**
- Include paths in outputs_so_far
- Reference them in context_for_resume

**Be granular about progress**
- "steps_completed": ["extract", "clean", "standardize"]
- Not: "data processing" (too vague)

**Include critical context**
- "context_for_resume": "Completed 65% of data. Use cleaned dataset at /outputs/data.csv. Focus on Q4 revenue trends."

**Test with a dummy checkpoint first**
- Create a test entry in Task Checkpoints.md
- Run checkpoint-monitor
- Verify it resumes correctly before relying on it

## Troubleshooting

**Task doesn't checkpoint when rate limited**
- Verify the recovery section is in the prompt
- Make sure it includes checkpoint-saving instructions
- Check that task actually hits a rate limit (not just times out)

**Checkpoint saved but not restarted**
- Check Task Checkpoints.md exists in Obsidian
- Verify Status = "interrupted" (exact case)
- Ensure Last Updated is >5 hours old
- Verify checkpoint-monitor scheduled task is enabled

**Task resumes but doesn't have enough context**
- Add more detail to context_for_resume
- Include file paths and intermediate outputs
- Specify what phase/step you're on

**Same task keeps restarting**
- Don't manually set Status = "ready_to_resume"
- Keep Last Updated current
- Mark as "paused" if you want to stop auto-restart

## When to Use This Skill

This skill automatically triggers and provides the right template whenever you:
- Create a scheduled task
- Spawn a subagent for substantial work
- Set up an automation that might take multiple hours
- Request to "schedule", "automate", "run", "create task", etc.

You'll see the template in the response. Copy the appropriate one and fill in your task details.

---

## Quick Checklist

When using a template:

- [ ] Task name is clear and describes the phase
- [ ] Recovery section included
- [ ] Definition JSON has all required fields
- [ ] Progress JSON is specific enough to resume cleanly
- [ ] Intermediate outputs saved to files
- [ ] context_for_resume is detailed
- [ ] Task prompt is actionable and clear

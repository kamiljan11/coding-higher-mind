# Make PG yours — every configuration point

PG was exported from one person's `~/.claude`. Everything tied to that machine was removed or made configurable; this
page lists every knob, where it lives, and what happens if you leave it alone.

## Global (`~/.claude`)

| Knob | Where | Default | Notes |
|---|---|---|---|
| Your own rules | `~/.claude/CLAUDE.md`, **above** the `<!-- PG:BEGIN -->` block | — | the block is replaced on every `node install.mjs`; anything outside it is yours |
| Hook registration | `~/.claude/settings.json` → `hooks` | merged by the installer | remove a hook by deleting its entry; `node uninstall.mjs` removes all PG entries |
| Memory injected at session start | env `MAS_MEMORY_DIR` (read by `hooks/session-context.js`) | `~/.claude/memory` | files looked for: `RESUME.md`, `Projects.md`, `Notes for Claude.md`, `Active Systems.md`; missing = skipped with a one-line note; cap 40 000 chars |
| Where scheduled tasks log | `hooks/guard_health.py` → `LOG_DIR` | `~/.claude/memory/log` | one markdown file per task; a `STARTED` line without a matching end = the task died (audit shows it) |
| Git hooks | `git config --global core.hooksPath ~/.claude/git-hooks` | opt-in (`install.mjs --yes`) | per-repo alternative: `git config core.hooksPath ~/.claude/git-hooks`; repos with their own hooks (husky) need a decision — PG's are global by design |
| Fleet tools | env `GITHUB_OWNER`, `GITHUB_Token` (or `GITHUB_TOKEN`), `VERCEL_TOKEN` | required by `bin/mas_*.py`, `bin/wait_prod_multi.py` | inject with a secret manager (`infisical run --env=dev -- …`, `op run --`, `doppler run --`); `hooks/bash-guard.js` blocks secrets typed into a command line and reading tokens from credential stores |
| Trusted roots for linting edits made via Bash | `hooks/lib/trusted-roots.js` + optional `~/.claude/pg/trusted-roots.txt` | cwd tree only | only your own repos — a cloned stranger's repo can execute code through a linter config |
| Escape hatches | env vars in the command: `ALLOW_MAIN=1`, `ALLOW_LARGE_DIFF=1`, `ALLOW_BOUNDARIES=1`, `ALLOW_DUP_LITERALS=1`, `ALLOW_UNKNOWN_DEP=1`, `ALLOW_COMMENTED_CODE=1`, `ALLOW_TODO=1`, `ALLOW_PII=1`, `ALLOW_PHASE=1`, `ALLOW_STALE_BASE=1`, `ALLOW_SECRET=1`, `ALLOW_CI_DOWNGRADE=1`, `ALLOW_MSG=1`, `ALLOW_FORCE=1`, `ALLOW_RM=1`, `ALLOW_MERGE=1` | off | each use is logged to `~/.claude/logs/gates.jsonl` and reported by `hooks/guard_health.py` |

## Per repository (`<repo>/CLAUDE.md` and `docs/`)

| Knob | Where | Effect |
|---|---|---|
| `pg.tier_floor: T2` | repo `CLAUDE.md` | the stop gate never rates this repo below T2 |
| `pg.phase: prototype\|poc\|mvp\|production\|maintenance\|handoff` | repo `CLAUDE.md` (+ first line of README) | `prototype`/`poc` cap the tier at T1 (proportionality: a prototype is not nagged for ADRs); changing to `production` requires `docs/prr/<date>.md` in the same commit (`bin/phase-gate.js`) |
| `pg.single_env: true` | repo `CLAUDE.md` | declares "one database, no staging" consciously; otherwise `bin/env-ref-gate.js` warns when `.env.local` points at the production project ref |
| `pg.qa_url: https://…` | repo `CLAUDE.md` | on T3 with UI the QA department becomes **required** (needs the JSON block in `docs/CRITICAL-PATHS.md`) |
| `pg.ownership: mas-saas\|client-transferred\|client-licensed\|oss` | repo `CLAUDE.md` | product-reviewer checks that features have a row in `docs/SCOPE.md` for client repos; `bin/repo-readiness.js` checks LICENSE consistency |
| Module boundaries | `docs/ARCHITECTURE.md`, fenced ```json block with `"pg.boundaries": true`, `layers`, `forbid`, `maxFanIn` | `bin/module-boundaries.js` (pre-push): a new import cycle or an import against the layer order blocks; old cycles only warn |
| QA matrix | `docs/CRITICAL-PATHS.md`, fenced ```json block (`personas`, `viewports`, `locales`, `paths` with steps) | `bin/qa-matrix.js --repo . --base-url <url>` runs every critical path on isolated browser contexts; ships with a `mobile-budget` 360×640 viewport because "works on my machine" is not done |
| Privacy inventory | `docs/PRIVACY.md` table `table.column \| purpose \| basis \| retention \| processor \| how to delete` | `bin/pii-inventory-gate.js` blocks a migration that adds a personal-data column without a row |
| Debt ledger | `docs/quality/BACKLOG.md` | `bin/todo-ledger-gate.js` blocks a new `TODO/FIXME/HACK` without a ledger row (date, file:line, what it will slow down, when to repay) |
| Secrets in `.env.example` | names only, plus `SUPABASE_PROJECT_REF_PROD=<ref>` (a project ref is not a secret) | that one value is what lets the env-ref gate work out of the box |

## Reviewer departments

Each `agents/<role>.md` is a rubric of ≤ 8 numbered rules, each with a `how_to_check` command, a severity policy, a JSON
schema and examples (including a rejected false positive). To adapt:

- add your own scar to `pg/cases.md` with a `rule_id`, then reference that `rule_id` from the relevant rubric line;
- keep the `<verification>` and `<independence>` sections — they are what make findings evidence instead of opinion;
- model choice per tier lives in `hooks/lib/risk-tier.js` (`models`): T3 security/data/verifier on the strongest model.

## Templates for new repositories

`templates/repo/` is copied by `bin/mas-quality-init.ps1 -RepoPath <path> [-Tier T2]` (PowerShell; on macOS/Linux copy the
folder and run `npm install` for the eslint config). Edit the templates once and every new repo inherits the change; for
existing repos `bin/mas_rollout_pr.py` opens one PR per repo with a single updated file.

## Scheduled tasks

`scheduled-tasks/<name>/SKILL.md` are Claude Code scheduled tasks (frontmatter `schedule:` cron + `model:`). They are
plain prompts with a verification block; the only machine-specific part was the log path, now `~/.claude/memory/log`.
Register them with the scheduled-tasks tool of your Claude Code, or copy the prompt into any scheduler you use.

## Language

Hook messages and doctrine are Polish. Every string is plain text in the files above — translate in place; the tests only
assert exit codes and a few marker strings (`[PROMPT-GUARD]`, `ZABLOKOWANE`, `TESTY`), which are listed in
`bin/test_prompt_guard.js` and `bin/test_hooks_v3.js` if you change them.

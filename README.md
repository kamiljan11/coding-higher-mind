# Coding Higher Mind — PG (PROMPT-GUARD) for Claude Code

**Quality gates, reviewer agents, routines and an anti-hallucination protocol for [Claude Code](https://docs.anthropic.com/en/docs/claude-code) and Claude Desktop — enforced by events, not by willpower.**

The name comes from the author's other long project, a free guidebook on practical spirituality ([kamiljan.com](https://kamiljan.com)): practice over belief. A rule you *intend* to follow is a belief. A gate that fires on an event is a practice. This repository is the practice — the "higher mind" that sits above every coding session and refuses to let a good intention be the only safeguard.

PG is the working system behind one person's software company: ~40 production repositories (SaaS for workshops, a marketplace, shops, rental systems, client sites) written almost entirely by AI coding agents, with a human owning the spec, the review and the deploy. It grew out of one audit finding: **every rule written as prose was broken at scale** (0 architecture decision records in 6 of 7 repos, changelog 105 commits behind, code review invoked in 2.5 % of sessions, 79 % of commits pushed straight to `main`). So the rules moved from prose into hooks, git gates, CI and reviewer agents with fresh context — and every gate got a test that proves it blocks its own case.

This repository is that system, exported and sanitized so you can install it on your own machine in five minutes. A long-form description with diagrams lives at **[kamiljan.com/claude](https://kamiljan.com/claude)**.

> **Language note.** PG was written in Polish, its author's working language. What you interact with is bilingual: the prompt protocol injected into every session has a full English version (`PG_LANG=en`, set automatically by the installer from your machine locale, override with `--lang=en|pl`), every git-gate and command-guard block message carries an English `BLOCKED: …` line with the escape hatch, and the installer, this README and `docs/` are English. The doctrine documents and reviewer rubrics are still Polish — the model reads them fine; translate in place if your team needs to, pull requests welcome.

---

## What you get

| Layer | Fires on | What it does | Where |
|---|---|---|---|
| **Prompt hardening** | every non-trivial prompt (`UserPromptSubmit`) | injects PG-core: ambiguity → questions not execution; read-before-assert; "done" only with proof (exit code / diff / HTTP); status `VERIFIED / UNVERIFIED / FAILED`; report format for a sponsor, not "fine" | `hooks/prompt-guard.js` |
| **Edit gate** | every file edit, also edits made through Bash (`PostToolUse`) | eslint / oxlint / `tsc -b` / ruff / pyright on the changed file; errors go straight back to the agent | `hooks/post-edit-check.js`, `hooks/post-bash-edit-check.js` |
| **Command guard** | every shell command (`PreToolUse`) | blocks `--no-verify`, force-push, `reset --hard`, `rm -rf` outside build dirs, `gh pr merge`, secrets in the command line, `curl \| sh`; escape hatches are explicit (`ALLOW_*=1`) and logged | `hooks/bash-guard.js` |
| **Stop gate** | end of session (`Stop`) | computes a **risk tier T0–T3 from the diff** (paths + size), runs lint/types/tests on everything changed, and refuses to close a T2+ session without the required reviewer departments | `hooks/stop-gate.js`, `hooks/lib/risk-tier.js` |
| **Git gates** | commit / push (global `core.hooksPath`) | conventional commit message; secret scan; base freshness (`merge-base` — a clone on an unrelated history is blocked); duplicate literals in new code; new dependency must exist on npm/PyPI and not be a typosquat; commented-out code; new `TODO` without a ledger entry; PII column without a privacy inventory row; SQL migration lint (RLS `USING` + `WITH CHECK`, `SECURITY DEFINER` hygiene, tenant FK); GitHub's own workflow parser on workflow files; diff size > 400 source lines; **new import cycle or import against declared layers** | `git-hooks/pre-commit`, `git-hooks/pre-push`, `git-hooks/commit-msg`, `bin/*` |
| **Reviewer departments** | T1+ (recommended) / T2+ (required) | 9 read-only agents with **fresh context** and a JSON schema: code, security, data, ops, ux, product, qa, verifier, catfish (devil's advocate). A finding without an executed command in `evidence` does not exist. Aggregation is code (`bin/pg-aggregate.js`, k-of-n), not a model; a verifier tries to *refute* findings; no chat between agents | `agents/`, `skills/pg-review` |
| **Council** | architecture decisions | facts → positions → a mandatory dissenter → aggregation → ADR; the catfish role exists because "quiet agreement" is the top failure mode of agent groups | `skills/pg-council`, `bin/pg-council.js`, `pg/council.md` |
| **Doctrine** | loaded on the event that needs it | `design.md` (before code: PRD-lite incl. sponsor/ROI, mini-design, STRIDE-lite, ADR), `dod.md` (definition of done per tier), `prr.md` (before deploy), `postmortem.md` (incident → new gate or new scar), `paradigm.md` (functional core / imperative shell; a stranger takes the repo over in one day), `cases.md` (**149 scars** — every gate points at the real failure that created it) | `pg/` |
| **Repo template** | new repository | CI (`quality.yml`, mutation testing on changed files, release, optional Claude review that *skips* without a token instead of faking green), strict eslint/tsconfig, PR template with docs-parity checkbox, `docs/ARCHITECTURE.md` with a **parsed module-boundary block**, `GLOSSARY`, `RUNBOOK`, `PRIVACY`, `CRITICAL-PATHS` QA matrix, ADR template | `templates/repo/`, `bin/mas-quality-init.ps1` |
| **Fleet tools** | on demand / scheduled | strict branch protection from workflow job names, PR merge only on an up-to-date merge-ref, single-file rollouts as PRs, production proof from the Vercel API (never a hand-typed URL), session and git-history mining, weekly guard health, monthly reviewer calibration (the same defect in two wrappers must get the same verdict) | `bin/mas_*.py`, `scheduled-tasks/` |
| **Self-tests** | `node bin/pg-selftest.js` | every gate has a **positive** test (it must block) and the rule→gate coverage is checked by script; the README index of tools is generated from the tools' own headers (a tool without a self-description shows up as debt) | `bin/test_*.js`, `bin/pg-rule-coverage.js`, `bin/pg-map.py` |

Counted on export day, not estimated: 166 files, ~12 500 lines, 32 tools, 10 test suites, 7 hooks, 3 git hooks, 9 reviewer agents, 149 scars, 25 template files, 4 scheduled agents.

---

## Install (5 minutes)

Requirements: **Node ≥ 20**, **git**, Claude Code. Optional: Python 3 + `ruff` + `pyright` (Python repos), `gitleaks` (CI runs it anyway), PostgreSQL client tools (backup drill).

```bash
git clone https://github.com/kamiljan11/coding-higher-mind.git
cd coding-higher-mind
node install.mjs --dry-run     # shows the plan, touches nothing
node install.mjs               # copies into ~/.claude, merges hooks into settings.json, appends the PG block to CLAUDE.md
node install.mjs --yes         # ...and sets `git config --global core.hooksPath ~/.claude/git-hooks`
```

What the installer promises (read `install.mjs`, it is 150 lines):

- **Never overwrites a file you changed** unless `--force` (then a backup goes to `~/.claude/_pg-backup-<timestamp>/`); differing package versions are written next to yours as `*.pg-new`.
- `settings.json`: **merges** the `hooks` key — your other hooks and keys stay; paths are absolute for your machine.
- `CLAUDE.md`: **appends** the PG block between `<!-- PG:BEGIN -->` / `<!-- PG:END -->`; re-running replaces only that block.
- Git hooks are **opt-in** (`--yes`); without it you get the per-repo command instead.
- Ends with `node ~/.claude/bin/pg-selftest.js` — green output is the proof. Open a new Claude Code session; the first non-trivial prompt shows `[PROMPT-GUARD]`.

Uninstall: `node uninstall.mjs` (removes hook registrations and the CLAUDE.md block; prints the `rm` command for the files — deleting is your call).

Windows works through Git Bash (hooks are `sh`), macOS and Linux natively. Only `~/.claude` is supported as the install root, because Claude Code reads it from there.

---

## The life of a change

```
prompt ──▶ prompt-guard.js (protocol) ──▶ edit ──▶ post-edit-check.js (lint/types) ──▶ git commit ──▶ pre-commit
(secrets · base-check · dup-literals · dep-exists · commented-code · todo-ledger · pii-inventory · sql-lint · workflow-lint · ruff/pyright)
──▶ git push ──▶ pre-push (no direct main · diff-size · module-boundaries · foreign-branch warning)
──▶ PR ──▶ CI from templates/ (quality · mutation on changed files · gitleaks · optional Claude review)
──▶ bin/mas_merge_prs.py (merge only when checks ran on the CURRENT merge-ref) ──▶ bin/wait_prod_multi.py (200 from the real production domain)
session end ──▶ stop-gate.js: tier from the diff; T2+ = reviewer departments (skill pg-review) or the session does not close
```

Any red result stops the change right there. Every escape hatch is a named env var (`ALLOW_MAIN=1`, `ALLOW_LARGE_DIFF=1`, `ALLOW_BOUNDARIES=1`, …) — a conscious decision that is logged to `~/.claude/logs/gates.jsonl` and surfaces in the weekly guard-health audit.

---

## Three ideas the whole thing rests on

1. **Gates, not prose.** A rule the agent can forget is not a rule. Everything that matters fires on an event (prompt, edit, command, stop, commit, push, CI) and has a test proving it blocks its own case. Rules that only exist in a document are checked by `bin/pg-rule-coverage.js` — a rule without a gate fails the audit.
2. **Scar → gate.** `pg/cases.md` holds 149 real failures from the fleet (RLS gate on the wrong state, a fallback that silently changed the seller on an invoice, green CI on a stale merge-ref that broke `main`, a hook that read stdin twice and never ran, …). Every checklist item and every gate cites the scar it came from — the Google SRE rule. Postmortems end with a new gate or a new scar, never with "be more careful".
3. **Proof, not prose.** "Done" means a command, an exit code and an observed state. Reports end with `VERIFIED` (evidence cited) / `UNVERIFIED` (what is missing) / `FAILED` (what happened). This matters most where agents are known to overstate success (75.8 % of agent "successes" in one benchmark were claims without evidence) and to fold under pushback. See [docs/VERIFIED-PROTOCOL.md](docs/VERIFIED-PROTOCOL.md) — it is the single most useful thing to paste into any Claude Cowork or scheduled-task prompt.

---

## Risk tiers (computed from the diff, never from the prompt)

| Tier | Trigger (paths + size) | Required |
|---|---|---|
| T0 | docs, copy, styles, assets | zero-token gates only |
| T1 | isolated component / util | code-reviewer recommended |
| T2 | shared logic, API route, edge function, dependency, CI/build config, > 150 lines | code + ops (+ ux for UI, + data for schema) |
| T3 | auth, RLS / multi-tenant, payments, secrets, SQL migrations, cron, admin, > 600 lines | code + security + data + ops (+ ux) → verifier; security/data/verifier on the strongest model |

Per-repo overrides live in the repo's `CLAUDE.md`: `pg.tier_floor: T2`, `pg.phase: prototype|poc|mvp|production` (a prototype is capped at T1 — proportionality; promoting to production requires a production-readiness review), `pg.qa_url:` (makes the QA department mandatory on T3 with UI).

---

## Map of the repository

| Path | What is in it |
|---|---|
| `hooks/` | Claude Code hooks (7) + `lib/` (risk tier, lint runner, gate telemetry, trusted roots) + `guard_health.py` (audit of the system itself) |
| `git-hooks/` | `commit-msg`, `pre-commit`, `pre-push` — installed once via `core.hooksPath`, active in every repo |
| `bin/` | 32 zero-token tools + 10 test suites; [bin/README.md](bin/README.md) is generated from each tool's own header |
| `agents/` | reviewer departments (read-only, fresh context, JSON schema, `how_to_check` per rubric line) |
| `pg/` | doctrine: `paradigm`, `design`, `dod`, `prr`, `postmortem`, `cases`, `council`, `models`, `github-ready`, retro; `adr/`; `eval/` (golden set for the gates + reviewer calibration pairs) |
| `skills/` | `pg-review`, `pg-council`, `anti-sycophancy`, `verify-audit`, `ultra-loop`, `gauntlet-build` |
| `templates/repo/` | everything a new repository gets: workflows, eslint/tsconfig, PR template, docs skeletons, ADR template |
| `scheduled-tasks/` | Claude Code routines: fleet PR reviewer (weekday mornings), CVE watch (monthly, deterministic first), guard health (weekly), reviewer calibration (monthly) |
| `routines/` | [routines/README.md](routines/README.md) — the routine layer of both runtimes, plus `cowork/`: the Claude Desktop routines (watchdog, backup with restore script, sessions → memory notes, weekly system report, opt-in self-evolution cycle) |
| `tools/workflow-lint/` | GitHub's own workflow parser (`@actions/workflow-parser`) — the pre-commit lints workflow files with the parser GitHub runs |
| `CLAUDE.pg.md` | the PG block the installer appends to your `~/.claude/CLAUDE.md` |
| `settings.pg-hooks.json` | the hook registrations the installer merges into `~/.claude/settings.json` |
| `docs/` | [ARCHITECTURE.md](docs/ARCHITECTURE.md) (diagrams, mind map), [VERIFIED-PROTOCOL.md](docs/VERIFIED-PROTOCOL.md), [CUSTOMIZE.md](docs/CUSTOMIZE.md) |

---

## Make it yours

Everything that was specific to the author's machine was removed or made configurable — see [docs/CUSTOMIZE.md](docs/CUSTOMIZE.md). The short list:

- `~/.claude/CLAUDE.md` — write your own rules above the PG block; the block itself is replaced on update.
- `MAS_MEMORY_DIR` — folder of markdown notes injected at session start by `hooks/session-context.js` (default `~/.claude/memory`; missing files are skipped).
- `GITHUB_OWNER` + a token in the environment — for the fleet tools (`bin/mas_*.py`). Use a secret manager that injects env vars (`infisical run --`, `op run --`, `doppler run --`); PG blocks secrets typed into a command line.
- Per repo: `pg.tier_floor`, `pg.phase`, the module-boundary block in `docs/ARCHITECTURE.md`, the QA matrix in `docs/CRITICAL-PATHS.md`, `docs/PRIVACY.md`.
- Reviewer rubrics in `agents/*.md` — add your own scars to `pg/cases.md` and reference their `rule_id` from the rubric.

---

## Honest limits

- Built and proven at SME scale (dozens of repos, one owner, tens of thousands of lines), not at hyperscale.
- Messages are in Polish today.
- Reviewer agents cost tokens (T2 ≈ 4×, T3 ≈ 8–10× the cost of one diff review); zero-token gates run first so agents never see red lint.
- Some gates depend on the repo having what they check (a `tsconfig.json`, a `docs/ARCHITECTURE.md` block, a `CRITICAL-PATHS.md`); without it they skip **and log the skip**.
- The system was written with AI agents under the same gates it describes. It is not finished; it is engineered against its own failure modes, in the open.

## License

MIT — © 2026 Kamil Jan. Sources of the research behind the rules are cited inline in `prompt-protocol.md`, `pg/*.md` and `hooks/prompt-guard.js`.

---

## Po polsku (skrót)

**Coding Higher Mind** — nazwa od drugiego projektu autora, darmowego przewodnika po praktycznej duchowości: praktyka ponad przekonanie. Reguła, której *zamierzasz* przestrzegać, to przekonanie; bramka, która odpala się na zdarzeniu, to praktyka.

PG to system bramek jakości, recenzentów-agentów i protokołu anty-halucynacyjnego dla Claude Code, który powstał z jednego audytu: **każda reguła zapisana prozą była łamana na skalę**. Dlatego reguły przeszły do hooków (prompt, edycja, komenda, koniec sesji), bramek gita (commit, push), CI i działów-recenzentów ze świeżym kontekstem — a każda bramka ma test, który dowodzi, że blokuje swój przypadek.

- **Instalacja:** `node install.mjs` (Node ≥ 20, git). Instalator nie nadpisuje Twoich plików, dokleja hooki do `settings.json` i blok PG do `CLAUDE.md`, a hooki gita włącza tylko z `--yes`. Kończy się samotestem — zielony wynik jest dowodem.
- **Trzy filary:** bramki zamiast prozy · blizna → bramka (`pg/cases.md`, 149 wpisy) · dowód zamiast prozy (`VERIFIED / UNVERIFIED / FAILED` — patrz [docs/VERIFIED-PROTOCOL.md](docs/VERIFIED-PROTOCOL.md); to jedna rzecz, którą warto wkleić do każdego promptu w Claude Cowork).
- **Tier ryzyka z diffu** (T0–T3), nie z opisu zadania; T2+ bez recenzentów działowych = sesja się nie zamknie.
- **Co dostosować u siebie:** [docs/CUSTOMIZE.md](docs/CUSTOMIZE.md).
- Komunikaty są po polsku, README i instalator po angielsku. Licencja MIT.

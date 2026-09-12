# Changelog

All notable changes to the public PG export. Dates are the export dates; the private system moves faster and is squashed
into these releases.

## [1.0.0] — 2026-09-12

First public export of PG (PROMPT-GUARD) v3.

- Claude Code hooks: prompt-guard, post-edit-check, post-bash-edit-check, bash-guard, stop-gate (risk tier from the diff), session-context, memory-guard; `guard_health.py` audit.
- Git gates: commit-msg, pre-commit (secrets, base-check, dup-literals, dep-exists, commented-code, todo-ledger, pii-inventory, sql-migration-lint, workflow-lint, ruff/pyright), pre-push (no direct main, diff-size, module-boundaries, foreign-branch warning).
- 9 reviewer departments with fresh context + `pg-review` (k-of-n aggregation, verifier) + `pg-council` (mandatory dissenter) + monthly reviewer calibration.
- Doctrine: paradigm, design (incl. sponsor/ROI and cost-vs-value), definition of done per tier, production readiness, postmortem → gate, 144 scars.
- Repo template with strict eslint/tsconfig, CI (quality, mutation testing on changed files, release, token-gated Claude review), docs skeletons with parsed module-boundary and QA-matrix blocks.
- Installer / uninstaller, self-test, generated tool index (`bin/pg-map.py`), rule→gate coverage check.

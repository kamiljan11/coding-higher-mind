# Changelog

All notable changes to the public PG export. Dates are the export dates; the private system moves faster and is squashed
into these releases.

## [1.1.0] — 2026-09-13

- **English protocol**: `PG_LANG=en` switches the prompt-guard protocol to a full English version with the same numbering and markers; the installer sets `env.PG_LANG` in `settings.json` from the machine locale (`--lang=en|pl` overrides).
- **Bilingual gates**: every git-gate, command-guard and stop-gate block message now carries an English `BLOCKED: …` line naming the escape hatch.
- **backup-drill without a local PostgreSQL**: falls back to the `postgres:16-alpine` image through Docker (`localhost` target → `host.docker.internal`); `--docker` forces it; `guard_health.py` accepts Docker as the P16 preflight.
- **Tests that assert**: `test_prompt_guard.js` compares verdicts against expectations in both languages and exits non-zero on mismatch (the previous version always printed DONE — and resolved the hook from a literal `~` path in CI).
- Git hooks are POSIX (`dash`/busybox safe): no here-strings, no bash arrays; `guard_health.py` syntax-checks them under WSL `sh -n` when available.
- Mutation workflow: label events re-run the check, Stryker is installed into the project, and "no tests were executed" is a visible skip instead of a red job.

## [1.0.0] — 2026-09-12

First public export of PG (PROMPT-GUARD) v3.

- Claude Code hooks: prompt-guard, post-edit-check, post-bash-edit-check, bash-guard, stop-gate (risk tier from the diff), session-context, memory-guard; `guard_health.py` audit.
- Git gates: commit-msg, pre-commit (secrets, base-check, dup-literals, dep-exists, commented-code, todo-ledger, pii-inventory, sql-migration-lint, workflow-lint, ruff/pyright), pre-push (no direct main, diff-size, module-boundaries, foreign-branch warning).
- 9 reviewer departments with fresh context + `pg-review` (k-of-n aggregation, verifier) + `pg-council` (mandatory dissenter) + monthly reviewer calibration.
- Doctrine: paradigm, design (incl. sponsor/ROI and cost-vs-value), definition of done per tier, production readiness, postmortem → gate, 149 scars.
- Repo template with strict eslint/tsconfig, CI (quality, mutation testing on changed files, release, token-gated Claude review), docs skeletons with parsed module-boundary and QA-matrix blocks.
- Installer / uninstaller, self-test, generated tool index (`bin/pg-map.py`), rule→gate coverage check.

# Changelog

All notable changes to the public PG export. Dates are the export dates; the private system moves faster and is squashed
into these releases.

## [1.2.1] — 2026-09-28

- **Stop gate, pytest:** the interpreter is picked by a probe (`python -c "import pytest"`, then `python3`) before the tests run. Before, a second run was triggered by matching the test output, so a failing test that printed `…: not found` could lose its red verdict.
- **Lint gate, ruff:** `ruff` → `python -m ruff` → `python3 -m ruff`, and a timeout no longer starts the next attempt (three attempts could exceed the stop-gate budget).
- **A missing tool is recognised by a signal, not by text.** Before, a red test that printed `ENOENT` or `command not found` was logged as "tool unavailable" and the stop passed. Now a skip needs exit 127/9009 (the shell could not find the command) or a failed `import pytest` probe; any other non-zero exit is red. A probe that times out goes the timeout route.
- CI installs ruff and pytest before the self-test.

## [1.2.0] — 2026-09-27

PG v4: built after comparing PG with 35 open-source agent-guard projects, then reviewed after rollout by the security, code, data and ops reviewers plus a verifier.

- **Escape hatches come from the human.** `ALLOW_X=1` in a command passes only after you typed `allow ALLOW_X` (or `pozwól ALLOW_X`) as the whole chat message: 30 min / 3 uses, `ALLOW_CONTROL_PLANE` 60 min. The agent setting it on its own is blocked (`override-required`).
- **Command guard parses the shell** (`hooks/lib/shell-parse.js`, `bash-rules.js`): `sh -c`, `$()`, heredocs fed to a shell, quoting, `$IFS`, PowerShell `-enc`, Desktop Commander processes. New rules: writes to the control plane (hooks, git-hooks, bin, agents, settings, `~/.gitconfig`, `.git/config`), loosening quality config through the shell, persistent `ALLOW_*`/`PG_*` env, reading SSH/AWS keys, files loaded into env (`export $(<f)`), merge via GraphQL or `gh alias`, `git --work-tree`/`GIT_DIR`, read-only reviewers. The old regexes stay as a floor.
- **New hooks:** `edit-guard` (the same control-plane rule for Edit/Write/MCP), `loop-monitor` (4 identical calls = stop signal), `precompact-snapshot` (a deterministic snapshot before compaction, re-injected afterwards; secrets and personal data masked).
- **Seal** (`bin/pg-seal.js`): a hash of the gate files, valid only inside a human grant window; `guard_health.py` and session start report a mismatch.
- **Two machines:** `bin/pg-wire.js` wires the PG hooks into another computer's `settings.json` (only hooks under `~/.claude/hooks/`, backup, live self-test, rollback). `bin/pg-sync.js` pushes the PG repo to a private backup.
- **Stop gate:** verdicts from exit codes, commits made in the session count toward the risk tier, an aggregation of `INCOMPLETE` blocks, nudges go to the human as `systemMessage`. `pg-aggregate` is fail-closed (`--tier`, `--final`, `--repo`).
- **Works on Linux:** path normalisation is case-sensitive outside Windows, `: not found` (dash) counts as a missing tool, `python3` is used on Linux. Checked in a Debian container: all suites green.
- Tests: `pg-eval.js` 102 cases (every rule has a block and an allow case), `pg-mutate.js` 24/24 mutants killed, `pg-replay.js` replays real commands from transcripts for false positives.
- Counts in this release: 10 hooks, 3 git gates, 39 tools, 11 test suites, 160 scars.

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

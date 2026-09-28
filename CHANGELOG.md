# Changelog

All notable changes to the public PG export. Dates are the export dates; the private system moves faster and is squashed
into these releases.

## [1.2.6] — 2026-09-28

- The wrapper and the probe put the absolute working directory back on `sys.path` (like `python -m pytest`), not `''`: a test that calls `monkeypatch.chdir` and then imports a project module passes again. The repo entry is removed only when it is the first one (`PYTHONSAFEPATH`).
- A probe that fails on `python` falls through to `python3`; the stop blocks only when no interpreter gives an answer.
- Child processes get `NoDefaultCurrentDirectoryInExePath=1`, so on Windows a `python.bat` or `npm.cmd` in the repo cannot replace the real tool.

## [1.2.5] — 2026-09-28

- **Tests run through a wrapper instead of `python -m pytest`:** pytest and everything it loads at startup (`runpy`, `importlib`, plugins) are imported with the repo directory removed from `sys.path`; the repo path comes back only before `pytest.main()`, so project imports in tests work as before. An `importlib.py` in the repo that exits 0 no longer turns red tests green.
- The origin probe removes the repo from `sys.path` before importing `importlib.util`, writes UTF-8 (paths with non-ASCII characters), and checks the interpreter with `--version` first: a probe that fails on a working interpreter blocks instead of counting as "no Python".
- Module paths are compared without resolving links, so a junction `pytest/` inside the repo is detected. Known limit: a module imported lazily after startup can still be shadowed; see the docs.

## [1.2.4] — 2026-09-28

- **Shadowed pytest is detected by module origin, not by file name.** One probe per interpreter asks `importlib.util.find_spec` where `pytest` and `_pytest` would load from, with the same `sys.path` as `python -m pytest`, without running any code from the repo. A module inside the repo blocks the stop (a `pytest.py`, `_pytest.py`, `.pyw`, `.pyc` or package, including one that fakes `__file__` and exits 0), even when no real pytest is installed. A virtualenv inside the repo (`site-packages`) is legitimate. Paths are compared after `realpath` (Windows 8.3 names).

## [1.2.3] — 2026-09-28

- A hanging `npm --version` probe blocks the stop (same as a hanging Python probe) instead of silently skipping JS tests; the JS test budget reserves time for the probe.
- A `pytest.py` file or `pytest/` package in the repo root blocks the stop: it would shadow the real pytest and turn `assert False` into exit 0.

## [1.2.2] — 2026-09-28

- **Test verdicts come only from the exit code.** 1.2.1 still skipped a suite that exited with 127 or 9009 as "tool unavailable", so a test script calling a removed binary passed silently. Now the runner is checked by a probe before the tests (`npm --version`; `import pytest` with the repo directory removed from `sys.path`, so a local `pytest.py` cannot shadow it), and any non-zero exit of the suite is red.
- A skipped test run is shown to the human as a `systemMessage`, not only logged. A hanging interpreter probe blocks with its own message instead of the 55 s test-timeout text.

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

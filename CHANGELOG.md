# Changelog

All notable changes to the public PG export. Dates are the export dates; the private system moves faster and is squashed
into these releases.

## [1.6.0] — 2026-10-10

PG v4.5: the guard now covers code that runs inside Claude Code itself, the architect walks every layer of the stack as part
of the same matrix as system design, and the shell guard got a threat model it can actually keep. Three things drove it:
Claude Code mods (extensions that run inside the CLI and bypass settings hooks), a security checklist turned into reviewer
rules, and a security review that kept finding ways around a patch-based rule until the rule was rebuilt.

- **Mods are part of the control plane.** A mod runs inside Claude Code and does not pass through settings hooks, so its
  source is guarded like hooks are: the mod source, the plugin cache and skills that ship a plugin manifest. Installing,
  enabling or updating a plugin, or adding a marketplace, needs the owner's phrase. Disabling and uninstalling are free:
  removing an extension never needs permission.
- **Destructive SQL on a remote database is blocked.** `psql`, `supabase`, `prisma`, `dropdb` and `pg_restore` are parsed
  for their target (flags, connection URLs, `PGHOST`, variables set earlier in the command, wrappers such as `docker exec`
  or `ssh`). `DROP`, `TRUNCATE`, `DELETE` without a filter and similar statements against anything that is not provably
  local are blocked; SQL the guard cannot see (a file, a heredoc) counts as destructive. Local databases stay free.
- **Writes relative to the working directory.** `patch`, archive extraction (`tar x`, `unzip`, `7z`, `cpio`) and scripted
  editors (`ed`, `ex`, `vim -es`) are blocked when they run in or above the control directory. The rule is fail-closed:
  when the guard cannot tell where a command runs (a `cd` into a variable, `CDPATH`, a symlink made earlier in the chain)
  it blocks. In any repository, `patch` with a patch it cannot read, or one that touches `.git/` or `.claude/`, is blocked:
  GNU patch writes `.git/config` (a local `core.hooksPath` switches off every git hook) and `.claude/settings.json`
  (project hooks run in the next session). Use `git apply`, which refuses paths inside `.git`.
  - Threat model, now written down in `pg/known-limits.md`: the shell guard catches mistakes and injected instructions, not
    an agent set on getting around it (`bash some-script.sh` can do anything). The seal, git history and managed settings
    are the net for the rest.
- **The stack is a step in the architecture process.** 25 tool layers (frontend to shipping) became `stack-*` rows in the
  area matrix, which now has 62 rows. Every layer gets DECISION, NOT NOW with a measurable return signal, or NOT APPLICABLE,
  checked by the same `sd-matrix-lint`.
  - `skills/architecture-advisor/assets/stack-picker.html` is the source of an interactive page: nothing is pre-selected,
    you pick a target market (global, Poland, EU, Iceland) and export the rows straight into the matrix. 199 tools, including
    all 131 from Arjay McCandless's public Stack Picker under their original names, plus market options such as Polish
    payment gateways, e-invoicing, parcel lockers and e-ID.
  - `scripts/stack-catalog-from-artifact.js` generates `references/stack-data.json` and `stack-catalog.md` from it; a test
    fails when the page, the catalog and the matrix drift apart.
  - `mas-quality-init.sh` creates an empty `docs/architecture/obszary.md` on bootstrap, and `prompt-guard` points at the step
    when it sees a new project or a stack question.
  - Without the opt-in, `stop-gate` no longer stays silent on T2+ work: it gives a non-blocking hint, and only about open
    one-way doors (data model, IDs, files, identity, region and DR). The rest can wait as NOT NOW.
- **Security reviewer, from a security checklist.** New checks for IDOR (queries scoped by a user-supplied ID), mass
  assignment, secrets in git history and in `NEXT_PUBLIC_` variables, and missing rate limits. The rubric's search
  commands pass file lists NUL-separated, so a crafted file name can no longer inject an option into the command.
- **Secret scanning in the CI template.** Gitleaks scans every new commit (a PR's range, a push's range, the whole history on
  the first push) and the working tree, so a secret pasted while resolving a merge conflict is caught too. The image is
  pinned by digest, and the step fails when git sees no commits instead of reporting zero leaks. The runbook explains what
  to do: a real secret is rotated first and then recorded by file and rule in `.gitleaksignore`; a fake test key gets
  `gitleaks:allow` on its line. Merging a PR that adds `gitleaks:allow` needs the owner's phrase, because that marker
  silences the scanner both locally and in CI.
- **Model routing by difficulty.** The main session orchestrates; subagents get the model the task needs: the smallest for
  lookups, the middle one for writing and rubric review, the strongest for hard reasoning and security on high-risk work
  (`pg/models.md`).
- **Session context fits the hook limit.** Claude Code shows only a 2,000-character preview of hook output above 10,000
  characters, so the start-of-session memory now has per-file caps, keeps the PG status lines whole and leaves an index of
  the sections it cut.
- **Fixes.** `merge-integrity` runs in pre-push; system-design cards gained cache, hot-row, product and web analytics,
  mobile and capacity material, and the trade-off catalog a merchant-of-record entry.

## [1.5.0] — 2026-10-06

PG v4.4: the architect can no longer skip a system-design area, and reviewers get a smaller, sharper input. Two audits drove
it. A coverage audit of 37 system-design areas (437 named variants) found that 46% of variants had a selection criterion,
26% only a name and 28% nothing, and that nothing forced the architect to walk every area. An overload audit of one review
round found each finder was handed the full 9,799-line diff, so it really read 10-30% of it, and a CSS bug (two unclosed
`@media` blocks after a merge) went past three reviewers.

- **System-design area matrix.** `pg/sd-areas.json` lists 37 areas in 12 groups (state and topology, data stores, IDs,
  files and CDN, consistency, async, API contracts, identity, resilience, observability, releases and DR, cost and region),
  each with its decision card and a `one_way` flag. Design (`pg/design.md` section G) now ends with
  `docs/architecture/obszary.md`: one row per area with status DECISION / NOT APPLICABLE / NOT NOW, evidence, and for
  NOT NOW a measurable signal to come back.
  - `bin/sd-matrix-lint.js` checks the matrix: every area present, a valid status, evidence for a decision, a signal for
    NOT NOW. `--template` prints an empty matrix.
  - `stop-gate` blocks the end of a T2+ session on a repo that opts in with `pg.sd_matrix: required` and has an incomplete
    matrix. On an internal PG error it lets the session end (fail-open) and logs it.
- **Area council of micro-agents.** `architecture-advisor` fills the matrix with one agent per group instead of one
  architect for everything; groups with a one-way door or security impact get the stronger model.
- **Decision cards filled in.** Cache strategies, rate-limiting algorithms, backpressure, integration auth, SLOs, files and
  object storage, RPO/RTO, real-time fallback, RAG, network isolation and deployment strategies now have variants with a
  criterion, cost and failure mode.
- **Reviewers read their slice, not the whole diff.**
  - `bin/pg-slice.js` cuts the diff per department (for example security 33% and data 14% of a 2,400-line diff).
    The full diff stays available for context.
  - `bin/pg-prechecks.js` runs 21 mechanical `rg` rules from the rubrics on added lines and hands each department its hits
    to confirm or dismiss.
  - `data-reviewer` gets the stronger model only when the diff has SQL or migrations. A minor finding from a single
    department becomes a note without a verifier round.
- **New zero-token gates.**
  - CSS brace balance after every edit, including edits made through the shell.
  - `bin/merge-integrity.js`: after a merge every line from both branches must survive.
  - `qa-matrix` warns about paths that click nothing (a green run there proves no UI path); `--require-interaction` fails critical-path entries (CP) that click nothing.
- **Fix.** The `pg-review` skill told you to redirect `qa-matrix` stdout into the same `report.json` the tool writes
  itself, which produced unparseable JSON. Stdout now goes to its own file.
- **Tried on a real app (Next.js + Supabase, 2026-10-06).** 12 group agents filled 37/37 rows (31 decisions, 5 not applicable,
  1 not now) and listed about 60 gaps with evidence, among them a scheduled job that never ran because its workflow was not on
  the default branch. The raw gap list still needs a human triage: at least one gap was a false positive (a module the docs
  mark as planned). The lint returns 0 on the full matrix and 1 with one row removed.
- **Counts:** 365 files on the exported tree (the export tool counts them). The other README counts are from 1.4.0 and were not recounted.

## [1.4.0] — 2026-10-05

PG v4.3: the same rules for a much smaller context bill, a stricter CI-downgrade gate and a monthly vulnerability watch that reads Dependabot. Reviewed by the security, code, data and ops reviewers plus a verifier (17 findings, all fixed and re-checked).

- **Token budget.** Measured before the change: about 26k tokens of fixed context per session (the main `CLAUDE.md` alone was 44 KB, the session-start memory block 35 KB) and about 1.3k tokens on every non-trivial prompt, most of it a repeat of `CLAUDE.md`. Now:
  - **Full protocol once per session.** The prompt guard sends rules 1-6, 7 CODE, 7O and 7L in full once per session, then a one-line reminder. Rare event lines (7N, 7D, 7P, 7I) are always sent in full.
  - **Per-session marker.** `logs/pg-seen` records what was already sent. Start and `/compact` reset it, the command and edit guards protect it, and markers older than 14 days are removed. With no session id or a broken marker you get the full text (fail-safe).
  - **Session-start memory block.** It takes the newest `RESUME` entries from the end of the file; before, it showed entries a week old. Open entries from other sessions are listed by title. Every clipped memory file keeps an index of its remaining sections (heading plus first line), so nothing disappears from view.
  - **`CLAUDE.md`.** It keeps the core rules; details move to reference files read on demand.
  - **Result:** a follow-up prompt with code is ~0.9 KB instead of ~4.9 KB, and the session start is 25 KB instead of 35 KB.
  - **Byte budget.** `guard_health.py` checks a budget per source (session start, first and follow-up prompt, `CLAUDE.md`) and goes RED when one grows past it.
- **CI-downgrade gate without false alarms and without the gaps.**
  - **False alarms fixed.** A fresh template repo commits cleanly. The last step of a job no longer runs into the next job. `npm audit --json > file || true` followed by `node .github/scripts/audit-gate.mjs` in the same step is not treated as neutralizing the audit.
  - **Gaps the review found, now closed.** A bare `-` step is detected. So is a job-level `continue-on-error` (before or after `steps:`), including a quoted `"true"` or `${{ true }}`. A gate named only in a comment or an `echo`, or followed by `|| true`, does not count. 16 tests.
- **`fleet-cve-watch` reads Dependabot alerts.**
  - **Live products:** open high/critical alerts are classified together with `npm audit` and fixed through a PR, as before.
  - **Rest of the fleet:** one summary line in the log.
  - **Exceptions:** findings covered by an audit-gate exception with an expiry date count only after that date.
- **Review run directory on Linux.** `pg-review` and `pg-council` no longer try to create `/pg-review-…` when `TEMP` is empty.
- **Main-branch exception for daily-journal repos.** Repos that a scheduled task writes to every day get a narrow exception. It applies only to the local clone path plus the exact push URL and is logged separately. 6 tests.
- **Three new scars.**
  - `RUN-DIR-ON-EMPTY-TEMP`.
  - `PG-CONTEXT-TAX`.
  - `LOVABLE-PAUSED-BACKEND-STILL-BILLED`, marked [UNCERTAIN] about the mechanism.
- **Counts in this release** (same method as 1.3.0, counted on the exported tree): 347 files, 168 scars; the other counts are unchanged.

## [1.3.0] — 2026-10-05

PG v4.2: pull requests can merge without a typed phrase when there is proof of review, every PR can be reviewed in CI, the stop gate no longer mixes up parallel sessions, and the system now writes a note after each session. Several rounds of review by the security, code, data and ops reviewers went into it; the limits that remain are written down in [`pg/known-limits.md`](pg/known-limits.md).

- **Auto-merge with proof of review (`bin/pg-merge-bezpieczny.py`).** A PR merges without the owner typing a phrase when every check is green (the newest run of each check, plus commit statuses), the PR is not a fork, the base is the default branch and the full file list is known. **T0** (only `.md`/`.txt`/`.rst`) needs no review; **T1** needs a code review and **T2** code + ops reviews of the exact diff (`diff_sha256` in each reviewer prompt, the verdict recomputed from the findings and the reviewer transcripts, valid for 2 h). **T3**, sensitive paths (migrations, auth, middleware, payments, dependencies, CI/deploy, agent instructions) and anything the script cannot read still need the human phrase. A 90-day history of CI runs and a deletion detector turn a hole in the record into a refusal, not a pass. Kill switch: create the file `~/.claude/bin/pg-merge-bezpieczny.off`. Every other way to merge (`gh pr merge`, REST/GraphQL, a script) stays blocked by the command guard.
- **PR review in CI as a second proof (`templates/repo/.github/workflows/pg-review.yml`, [ADR-0003](pg/adr/0003-recenzja-pg-review-w-ci-jako-dowod-auto-merge.md)).** A fresh runner runs `claude -p` with read-only tools on the PR diff, with the Claude configuration restored from the base branch, not taken from the PR. The check is green only on APPROVE without blocker or major findings; an infrastructure error ends as SKIPPED. The merge script accepts it only through the Actions API (this workflow path, this PR, first attempt, every head run green, no foreign check with the same name). It needs a `CLAUDE_CODE_OAUTH_TOKEN` secret in the repo; without it the job is skipped, which is no proof. **Do not make `pg-review` a required status check:** GitHub counts a skipped check as passed.
- **Reviewer substitution is a control-plane event.** New command-guard rule `claude-agent-override` (`claude --agents`, `--plugin-dir`, `--settings`, `--system-prompt*`), a project's `.claude/agents/` counts as control plane, steering phrases in a finder prompt void its evidence, and reviewers write only their own findings.
- **Stop gate: parallel sessions.** Commits made in the session count toward the risk tier. A commit is excluded only with positive proof that it belongs to another session (it was made inside another session's tool-execution window and not in this one); when in doubt it counts (fail-closed). Before, a parallel session's commit could raise the tier or be silently ignored.
- **The architecture gate accepts an ADR.** The T2+ `arch` gate (a new dependency, `CREATE TABLE` or an infra file) is satisfied by an ADR of at least 5 added lines in `docs/adr/`.
- **Auto-doc hook (`hooks/auto-doc.py`, `SessionEnd`).** After each session it appends a short note: the first request, the changed files, the commits made in the session and a clipped last answer, with secrets, e-mail addresses and national ID numbers redacted (phone numbers and names are not). It never blocks; any error goes to `logs/auto-doc.log`. Notes land in `~/.claude/session-notes` by default; set `AUTO_DOC_DIR` to point them at your own notes folder (for example an Obsidian vault).
- **System-design decision cards in `architecture-advisor` (`skills/architecture-advisor/references/sd/`).** Cards for the building blocks of a system (fundamentals, data, scale, communication, reliability, patterns, infrastructure), each with when it pays for itself, the default (usually "you don't need it yet"), cost, how it fails, review questions with a search command and one sentence for the client; plus a back-of-envelope capacity worksheet and reviewer checklists. Step B+ in `pg/design.md` asks for a capacity estimate, per-flow consistency, failure modes of every external dependency and idempotency before code. The prompt-guard now hints at system design when a prompt makes an engineering decision (the `SKILL-ROUTER` entry), and the reviewer agents got one checklist line pointing at the cards.
- **The export checks the README.** `bin/pg-export-public.py` fails when `README.md` / `README.pl.md` do not name the newest version and date from this changelog, or when the two language versions have a different number of `##` sections. It also leaves out the per-machine seal file and rewrites the auto-doc output folder to a neutral default.
- **Also in this release:** exception levels A/B/C and `bin/pg-self-approve.js` (the agent can pass the quality gates by itself, and reviewable destructive steps after a review; gate changes, merges to main, secrets and CI downgrades still need the human phrase); the stop gate's anti-loop marker is per session and repository; 18 skills as the `higher-mind-skills` plugin with PL/EN card descriptions; the export cuts payment and eID providers; Linux is a first-class machine (`pg-sync.js`, `guard_health.py` reports API rate limits as info).
- **Known limits worth reading before you switch auto-merge on:** the review proof is one LLM reviewer (probabilistic, open to prompt injection from the diff, no k-of-n); an agent with push rights can change the workflow in an abandoned PR and read the secret; text rules in the command guard cannot close every way to replace a local reviewer. See [`pg/known-limits.md`](pg/known-limits.md).
- Counts in this release (same method as 1.2.0, counted on the exported tree): 345 files, ~45 800 lines, 43 tools, 15 test suites, 11 hooks, 3 git hooks, 9 reviewer agents, 165 scars, 26 template files, 18 skills. The jump in files and lines since 1.2.0 comes mostly from the skills, the plugin and the system-design cards.

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

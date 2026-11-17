# INSTALL.md — installation procedure for an AI agent

This file is written for an AI coding agent (Claude Code, Cursor, Codex, any assistant with a shell) that a person asked
to install Coding Higher Mind on their machine. Humans can follow it too; the short version is in
[README.md](README.md#install-the-whole-system-5-minutes).

The person only has to say something like:

> Install Coding Higher Mind on this machine. Follow https://github.com/kamiljan11/coding-higher-mind/blob/main/INSTALL.md

## Rules for the agent

1. Run the steps **in order**. After every command compare the output with **Expected**. If it does not match, stop
   at that step and go to [Stop conditions](#stop-conditions). Do not improvise a different install.
2. Ask the person **exactly two questions** (step 3) and nothing is changed before both answers are in.
3. Never pass `--force` and never delete files under `~/.claude` unless the person asked for it in this conversation.
4. Do not run `curl … | sh` or install global packages on your own. The installer has zero dependencies.
5. Show the person the real output of steps 2, 4 and 5 (copy the lines, do not paraphrase "it worked").
6. The installer writes only to `~/.claude` (and, if the person agrees, one global git setting). Nothing is sent anywhere.

## Step 0 — preflight

Run each command and check the result:

| Command | Expected | If not |
|---|---|---|
| `node -v` | `v20.x` or higher | Stop: ask the person to install Node 20+ from https://nodejs.org (LTS). |
| `git --version` | any `git version …` | Stop: ask the person to install git. |
| `npm -v` | a version number | Optional. Without npm only the local GitHub-workflow lint is skipped (see Troubleshooting). |
| `ls ~/.claude` | folder exists or "No such file" | Both are fine. If it exists, the person already uses Claude Code; the installer merges, it does not replace. |

Windows: run every command in **Git Bash** (hooks are `sh` scripts). macOS and Linux: any shell.

If `~/.claude/settings.json` or `~/.claude/CLAUDE.md` exists, make a backup first and tell the person where it is:

```bash
mkdir -p ~/.claude/_pg-before-install && cp -p ~/.claude/settings.json ~/.claude/CLAUDE.md ~/.claude/_pg-before-install/ 2>/dev/null; ls ~/.claude/_pg-before-install
```

## Step 1 — get the code

```bash
git clone https://github.com/kamiljan11/coding-higher-mind.git ~/coding-higher-mind
cd ~/coding-higher-mind
git log -1 --format='%h %s'
```

Expected: one commit line. If the folder already exists, update it instead: `cd ~/coding-higher-mind && git pull --ff-only`.

## Step 2 — dry run (changes nothing)

```bash
node install.mjs --dry-run
```

Expected: a plan with lines like `new: <N>  identical: <M>  kept yours: <K>`, the hooks it would add to
`settings.json`, and the CLAUDE.md block. Show the person the summary lines.

`kept yours: K` greater than 0 means the person already has a file with the same name that differs. The installer will
not overwrite it; it writes `<file>.pg-new` next to it.

## Step 3 — ask the person two questions

1. **Language of the protocol** injected into every prompt: `en` or `pl`?
2. **Global git hooks?** "Should every git repository on this machine run the PG checks on commit and push?
   This sets `git config --global core.hooksPath ~/.claude/git-hooks`. If you already use global git hooks
   (husky with core.hooksPath, a company hooks path), say no." Yes → add `--yes`. No → leave it out.

## Step 4 — install

```bash
node install.mjs --lang=<en|pl>            # answer "no" to git hooks
node install.mjs --lang=<en|pl> --yes      # answer "yes" to git hooks
```

Expected, in this order:

- `new: <N>  identical: <M>  kept yours: <K>  overwritten(--force): 0`
- `settings.json: <H> hook(s) added, existing entries untouched; env.PG_LANG=<lang>`
- `CLAUDE.md: PG block appended` (or `replaced` on a re-run)
- with `--yes`: `git: setting global core.hooksPath = …/.claude/git-hooks`
- `workflow-lint (…): npm install in …` followed by npm's own output, or `workflow-lint: node_modules present`.
  `npm install failed — …` is a warning, not a stop: only the local workflow lint is skipped.
- self-test table ending with `pg-selftest: OK` (usually under a minute; allow up to 10 minutes on a slow machine
  before calling it stuck)
- exit code 0 (`echo $?` prints `0`)

Running the installer again is safe: unchanged files are reported as `identical` and hooks are not added twice.

## Step 5 — verify

```bash
node ~/.claude/bin/pg-selftest.js | tail -1                    # person said YES to git hooks
node ~/.claude/bin/pg-selftest.js --no-global-git | tail -1    # person said NO to git hooks
grep -c '^<!-- PG:BEGIN -->$' ~/.claude/CLAUDE.md
ls ~/.claude/skills/pg-review/SKILL.md ~/.claude/skills/pg-maintain/SKILL.md
git config --global core.hooksPath     # only if the person said yes in step 3
```

Expected: `pg-selftest: OK …`, `1`, both SKILL.md paths printed without an error, and (only with yes) the path ending in `/.claude/git-hooks`.
Without `--no-global-git` a "no" answer shows `FAIL git core.hooksPath` — that is the wrong command, not a broken install.

## Step 6 — tell the person what to do next

Claude Code reads hooks when a session starts, so the person must **open a new Claude Code session**. In it, the first
non-trivial prompt is answered with a reply starting `[PG]`. Report to the person:

```
Installed Coding Higher Mind <commit from step 1>.
Files: new <N>, identical <M>, kept yours <K> (see *.pg-new). Hooks added: <H>. Language: <lang>. Global git hooks: <yes/no>.
Self-test: <last line of step 5>. Backup of your previous settings: <path from step 0, or "none needed">.
Next: open a new Claude Code session. Uninstall: cd ~/coding-higher-mind && node uninstall.mjs
```

## Stop conditions

Stop, show the exact output, and ask the person. Do not retry with other flags.

| What happened | Meaning |
|---|---|
| `Node >= 20 and git are required. Aborting.` (exit 1) | Preflight failed: install Node 20+ / git first. |
| A self-test line other than `ok` | A gate test failed on this machine. Run that test alone (the line names it) and show the first `FAIL`. |
| `FAIL settings.json hooks … brak w settings.json: <names>` | `settings.json` could not be merged (invalid JSON?). Run `node -e "JSON.parse(require('fs').readFileSync(process.env.HOME+'/.claude/settings.json','utf8'))"`, show the error, do not rewrite the file. |
| Any other non-zero exit code | Show the last 20 lines of output. |

The [README troubleshooting table](README.md#troubleshooting) lists the known messages and their fixes.

## Uninstall

```bash
cd ~/coding-higher-mind && node uninstall.mjs          # removes hook registrations and the CLAUDE.md block
cd ~/coding-higher-mind && node uninstall.mjs --yes    # ...and the global git core.hooksPath
```

Files under `~/.claude` stay; the last line prints the exact `rm` command, and deleting them is the person's decision.

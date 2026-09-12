# Guard-health: deterministyczny audyt calego systemu jakosci (0 tokenow AI).
# Sprawdza, czy bramki NADAL sa wpiete — hooki, git-hooki, taski, blokada platnych tokenow —
# i (v3) czy REALNIE dzialaja: log bramek gates.jsonl + bateria testow pozytywnych.
# Exit 0 = wszystko OK; exit 1 = lista RED na stdout (do naprawy przez task/sesje).
# v2 (2026-08-24): + bash-guard, session-context, oxlint w post-edit, ruff/pyright na PATH.
# v3 (2026-09-05): + post-bash-edit-check, matcher desktop-commander, timeouty, lib/, tsc -b w 3 miejscach,
#                  telemetria skipow (gates.jsonl), test_hooks_v3 (pozytywne), narzedzia bin/*.js.
import json
import os
import re
import shutil
import subprocess
import sys
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path

HOME = Path(os.environ.get("USERPROFILE", str(Path.home())))
CLAUDE = HOME / ".claude"
_OWNER_LOG_DIR = Path(r"~/.claude/memory/log")  # vault wlasciciela; brak dysku (wersja publiczna PG) -> ~/.claude/memory/log
LOG_DIR = _OWNER_LOG_DIR if _OWNER_LOG_DIR.exists() else CLAUDE / "memory" / "log"
LOG = LOG_DIR / "guard-health.md"
GATES_LOG = CLAUDE / "logs" / "gates.jsonl"
GATES_WINDOW_DAYS = 7
MIN_HOOK_TIMEOUT_S = 120  # post-edit tsc -b ma budzet 90 s; domyslne 60 s harnessu ucinalo hook w ciszy
red = []
ok = []
info = []


def check(name, cond, detail=""):
    (ok if cond else red).append(f"{name}{(' — ' + detail) if detail and not cond else ''}")


def sh(args, stdin=None, timeout=60):
    """Uruchom komende jako liste argumentow (bez shella — brak ryzyka injection)."""
    try:
        # encoding=utf-8: konsola PS to cp1252, a hooki emituja UTF-8 (polskie znaki z vaulta)
        r = subprocess.run(args, input=stdin, capture_output=True, text=True, timeout=timeout,
                           encoding="utf-8", errors="replace", check=False)
        return r.returncode, (r.stdout or "") + (r.stderr or "")
    except Exception as e:  # noqa: BLE001
        return 1, str(e)


def read(p: Path) -> str:
    try:
        return p.read_text(encoding="utf-8")
    except Exception:  # noqa: BLE001
        return ""


HOOK_WIRING = [
    ("UserPromptSubmit", "prompt-guard.js"),
    ("PostToolUse", "post-edit-check.js"),
    ("PostToolUse", "post-bash-edit-check.js"),
    ("Stop", "stop-gate.js"),
    ("PreToolUse", "bash-guard.js"),
    ("PreToolUse", "memory-guard.js"),
    ("SessionStart", "session-context.js"),
]
LIB_FILES = ["lib/gate-log.js", "lib/lint-file.js"]
# `tsc --noEmit` przy project references sprawdza NIC — kazde miejsce z typecheckiem musi znac `tsc -b`
TSC_B_SITES = [
    CLAUDE / "hooks" / "lib" / "lint-file.js",
    CLAUDE / "git-hooks" / "pre-commit",
    CLAUDE / "templates" / "repo" / ".github" / "workflows" / "quality.yml",
    CLAUDE / "scheduled-tasks" / "fleet-pr-reviewer" / "SKILL.md",
]

# 1. settings.json: hooki wpiete, pliki istnieja, matchery i timeouty (v3)
try:
    s = json.loads(read(CLAUDE / "settings.json"))
    hooks = s.get("hooks", {})
    for ev, frag in HOOK_WIRING:
        cmds = " ".join(h.get("command", "") for g in hooks.get(ev, []) for h in g.get("hooks", []))
        check(f"settings.json hook {ev}/{frag}", frag in cmds, f"brak {frag}")
    for _, f in HOOK_WIRING:
        check(f"plik hooka {f}", (CLAUDE / "hooks" / f).exists(), "nie istnieje")
    for f in LIB_FILES:
        check(f"plik {f}", (CLAUDE / "hooks" / f).exists(), "nie istnieje")
    post = hooks.get("PostToolUse", [])
    matchers = " | ".join(g.get("matcher", "") for g in post)
    check("PostToolUse laczy desktop-commander write_file/edit_block", "mcp__desktop-commander__write_file" in matchers, matchers)
    check("PostToolUse laczy Bash|PowerShell (edycje przez sed/heredoc)", "Bash|PowerShell" in matchers, matchers)
    check("PostToolUse timeout >= 120 s", all(h.get("timeout", 60) >= MIN_HOOK_TIMEOUT_S for g in post for h in g.get("hooks", [])), "domyslne 60 s ucina tsc -b")
    stop_ok = any(h.get("timeout", 60) >= 150 for g in hooks.get("Stop", []) for h in g.get("hooks", []) if "stop-gate" in h.get("command", ""))
    check("Stop stop-gate timeout >= 150 s", stop_ok, "lint+tsc+testy nie mieszcza sie w 60 s")
except Exception as e:  # noqa: BLE001
    red.append(f"settings.json nieczytelny — {e}")

# 2. prompt-guard dziala i emituje protokol
rc, out = sh(["node", str(CLAUDE / "hooks" / "prompt-guard.js")], stdin='{"prompt":"napraw bug w api testowy prompt kontrolny"}')
check("prompt-guard.js wykonuje sie", rc == 0, out[:120])
check("prompt-guard.js emituje [PROMPT-GUARD]", "[PROMPT-GUARD]" in out, "brak naglowka w output")
check("prompt-guard.js emituje 7O/7C", "7O." in out and "7C." in out, "brak regul senior/caveman")

# 2b. bash-guard blokuje force-push (exit 2) i przepuszcza zwykly commit (exit 0)
rc, out = sh(["node", str(CLAUDE / "hooks" / "bash-guard.js")], stdin='{"tool_name":"Bash","tool_input":{"command":"git push --force origin main"}}')
check("bash-guard.js blokuje force-push", rc == 2, f"rc={rc} {out[:80]}")
rc, out = sh(["node", str(CLAUDE / "hooks" / "bash-guard.js")], stdin='{"tool_name":"Bash","tool_input":{"command":"git commit -m \\"ok\\""}}')
check("bash-guard.js przepuszcza zwykly commit", rc == 0, f"rc={rc} {out[:80]}")

# 2c. session-context wstrzykuje pamiec
rc, out = sh(["node", str(CLAUDE / "hooks" / "session-context.js")], stdin='{"session_start_reason":"startup"}')
check("session-context.js emituje [SESSION-CONTEXT]", rc == 0 and "[SESSION-CONTEXT" in out, out[:120])
check("session-context.js widzi Notes for Claude", "Notes for Claude.md: BRAK" not in out, "plik pamieci nieczytelny (dysk D:?)")

# 2d. logika lintu zna oxlint, pyright i tsc -b
lint_lib = read(CLAUDE / "hooks" / "lib" / "lint-file.js")
check("lint-file.js obsluguje oxlint", "oxlint" in lint_lib)
check("lint-file.js obsluguje pyright", "pyright" in lint_lib)
for site in TSC_B_SITES:
    check(f"tsc -b w {site.name}", "tsc -b" in read(site), "nadal tylko `tsc --noEmit` = slepy przy project references")

# 2e. narzedzia Pythona realnie dostepne (bez nich sciezka .py w hookach = martwy kod)
ruff_ok = shutil.which("ruff") is not None or sh(["python", "-m", "ruff", "--version"])[0] == 0
check("ruff dostepny (PATH albo python -m ruff)", ruff_ok, "pip install ruff")
check("pyright dostepny na PATH", shutil.which("pyright") is not None, "npm i -g pyright")

# 2f. telemetria bramek: skipy z ostatnich N dni (v3). Skip bez powodu = RED; reszta = info do logu.
counts: Counter = Counter()  # (hook, event) -> n; czytane tez nizej (obejscia ALLOW_* z pre-commit)
if GATES_LOG.exists():
    since = datetime.now(timezone.utc) - timedelta(days=GATES_WINDOW_DAYS)
    counts = Counter()
    empty_reason = 0
    malformed = 0
    for line in read(GATES_LOG).splitlines():
        try:
            e = json.loads(line)
            if datetime.fromisoformat(e["ts"].replace("Z", "+00:00")) < since:
                continue
            counts[(e.get("hook"), e.get("event"))] += 1
            if e.get("event") == "skipped":
                counts[("skip-reason", (e.get("reason") or "")[:40])] += 1
                if not e.get("reason"):
                    empty_reason += 1
        except (ValueError, KeyError, TypeError):
            malformed += 1  # uszkodzona linia = info, nie RED (log jest append-only, moze byc uciety przy rotacji)
    if malformed:
        info.append(f"gates.jsonl: {malformed} nieczytelnych linii")
    check("gates.jsonl: kazdy skip ma powod", empty_reason == 0, f"{empty_reason} skipow bez powodu")
    for (hook, ev), n in sorted(counts.items(), key=lambda kv: -kv[1])[:12]:
        info.append(f"{hook}/{ev}: {n}")
else:
    check("gates.jsonl istnieje (hooki loguja)", False, "zaden hook nic nie zapisal — telemetria martwa albo hooki nie chodza")

# 2f2. golden suite bramek 0-tokenowych (pg-eval, ~5 s): recall/FP bramek na bliznach floty — regresja = RED
rc, out = sh(["node", str(CLAUDE / "bin" / "pg-eval.js"), "--json"], timeout=120)
try:
    report = json.loads(out[out.index("{"):])
    check("pg-eval golden suite: 0 regresji", rc == 0 and not report.get("failed"), f"failed={report.get('failed')}")
    info.insert(0, f"pg-eval recall={round(report.get('recall', 0) * 100)}% fp={round(report.get('falsePositiveRate', 0) * 100)}%")
except (ValueError, json.JSONDecodeError):
    check("pg-eval golden suite uruchamia sie", False, out[:120])

# 2g. bateria testow pozytywnych istnieje (guard-health jej NIE odpala — 2-3 min; robi to test_hooks_v3 w sesji)
check("bin/test_hooks_v3.js istnieje", (CLAUDE / "bin" / "test_hooks_v3.js").exists())

def _rc_out(res):
    """sh() zwraca krotke; wyciagnij (returncode, stdout) niezaleznie od kolejnosci pol."""
    if res is None:
        return 1, ""
    rc = next((x for x in res if isinstance(x, int)), 1)
    out = next((x for x in res if isinstance(x, str)), "")
    return rc, out

# 2h. Bramki anty-slop z 2026-09-06 (research + retro): kazda ma test POZYTYWNY i pokrycie regul z paradigm.md.
for _name in ("dup-literals.js", "diff-size-gate.js", "dep-exists.js", "commented-code-gate.js", "pg-rule-coverage.js"):
    check(f"bin/{_name} istnieje", (CLAUDE / "bin" / _name).exists())
_r = sh(["node", str(CLAUDE / "bin" / "pg-rule-coverage.js")], timeout=60)
check("pg-rule-coverage: kazda regula z paradigm.md ma bramke", _rc_out(_r)[0] == 0, (_rc_out(_r)[1].strip().splitlines() or ["brak wyniku"])[0])
_r = sh(["node", str(CLAUDE / "bin" / "test_slop_gates.js")], timeout=120)
check("test_slop_gates: bramki anty-slop blokuja swoje przypadki", _rc_out(_r)[0] == 0, (_rc_out(_r)[1].strip().splitlines() or ["brak wyniku"])[-1])
_r = sh(["node", str(CLAUDE / "bin" / "test_dup_literals.js")], timeout=60)
check("test_dup_literals: 8 przypadkow", _rc_out(_r)[0] == 0, (_rc_out(_r)[1].strip().splitlines() or ["brak wyniku"])[-1])
# 2g. mapa dla czlowieka (2026-09-12, pytanie uzytkownika o przekazanie systemu): README.md + bin/README.md generowane z samoopisow plikow.
# Nieaktualne = ktos dodal/zmienil narzedzie bez `python bin/pg-map.py`; narzedzie bez opisu = obcy senior nie wie, co to robi.
_r = sh([sys.executable, str(CLAUDE / "bin" / "pg-map.py"), "--check"], timeout=60)
check("pg-map: README.md + bin/README.md aktualne, kazde narzedzie w bin/ ma samoopis", _rc_out(_r)[0] == 0 and "bez opisu: 0" in _rc_out(_r)[1], (_rc_out(_r)[1].strip().splitlines() or ["brak wyniku"])[-1])
for tool in ["sql-migration-lint.js", "fleet-metrics.js"]:
    check(f"bin/{tool} istnieje", (CLAUDE / "bin" / tool).exists(), "narzedzie z audytu 2026-09-05 zniknelo")
# 2h3. Gap-analiza vs slownik software house (2026-09-12, L1-L15): faza, srodowiska, backup, QA-instancje, PII, dlug.
for _name in ("phase-gate.js", "env-ref-gate.js", "todo-ledger-gate.js", "pii-inventory-gate.js", "qa-matrix.js", "backup-drill.py", "usage-by-repo.py"):
    check(f"bin/{_name} istnieje", (CLAUDE / "bin" / _name).exists(), "narzedzie z gap-analizy 2026-09-12 zniknelo")
check("agent qa-reviewer istnieje + schemat + procedure", "<schema>" in read(CLAUDE / "agents" / "qa-reviewer.md") and "<procedure>" in read(CLAUDE / "agents" / "qa-reviewer.md"))
check("pre-commit ma bramki phase/todo/pii", all(k in read(CLAUDE / "git-hooks" / "pre-commit") for k in ("phase-gate.js", "todo-ledger-gate.js", "pii-inventory-gate.js")))
check("pre-push: blok main czyta PUSH_REFS (blizna 2026-09-12)", 'done <<< "$PUSH_REFS"' in read(CLAUDE / "git-hooks" / "pre-push") and read(CLAUDE / "git-hooks" / "pre-push").rstrip().endswith("exit 0"))
check("qa-matrix runtime: tools/qa-matrix/node_modules/playwright", (CLAUDE / "tools" / "qa-matrix" / "node_modules" / "playwright" / "package.json").exists(), "cd ~/.claude/tools/qa-matrix && npm install && npx playwright install chromium")
# Pakiet npm bez pobranej przegladarki = falszywa zielen (ops-reviewer 2026-09-12): sprawdz rewizje chromium z browsers.json w %LOCALAPPDATA%/ms-playwright.
_browsers = CLAUDE / "tools" / "qa-matrix" / "node_modules" / "playwright-core" / "browsers.json"
if _browsers.exists():
    try:
        _rev = next(b["revision"] for b in json.loads(read(_browsers))["browsers"] if b["name"] == "chromium")
        _pw_home = Path(os.environ.get("LOCALAPPDATA", "")) / "ms-playwright"
        check(f"qa-matrix runtime: chromium-{_rev} pobrany", (_pw_home / f"chromium-{_rev}").exists() or (_pw_home / f"chromium_headless_shell-{_rev}").exists(), "cd ~/.claude/tools/qa-matrix && npx playwright install chromium")
    except (StopIteration, KeyError, json.JSONDecodeError) as _err:
        check("qa-matrix runtime: browsers.json czytelny", False, f"{type(_err).__name__}")
# Preflight P16 (backup-drill): bez klienta Postgresa drill nie istnieje — ma byc RED w audycie, nie dopiero przy realnym T3.
for _tool in ("pg_dump", "pg_restore", "psql"):
    check(f"backup-drill preflight: `{_tool}` na PATH", shutil.which(_tool) is not None, "winget install PostgreSQL.PostgreSQL (client tools) — inaczej PRR P16 nie do wykonania")
_r = sh(["node", str(CLAUDE / "bin" / "test_pg_gaps.js")], timeout=300)
check("test_pg_gaps: bramki gap-analizy blokuja swoje przypadki", _rc_out(_r)[0] == 0, (_rc_out(_r)[1].strip().splitlines() or ["brak wyniku"])[-1])
for _name in ("pg-council.js", "test_pg_council.js"):
    check(f"bin/{_name} istnieje", (CLAUDE / "bin" / _name).exists(), "narada dzialow (pg/council.md) zniknela")
check("agent catfish + skill pg-council", (CLAUDE / "agents" / "catfish.md").exists() and (CLAUDE / "skills" / "pg-council" / "SKILL.md").exists() and (CLAUDE / "pg" / "council.md").exists())
_r = sh(["node", str(CLAUDE / "bin" / "test_pg_council.js")], timeout=120)
check("test_pg_council: agregacja narady (tally, sentinel, blocked, DACI)", _rc_out(_r)[0] == 0, (_rc_out(_r)[1].strip().splitlines() or ["brak wyniku"])[-1])
# Obejscia ALLOW_* z pre-commit (okno GATES_WINDOW_DAYS) — maja byc widoczne, nie ciche (hook `pre-commit:<bramka>`, event skipped).
_bypass_hooks: dict[str, int] = {}
if GATES_LOG.exists():
    for (_hook, _ev), _n in counts.items():
        if isinstance(_hook, str) and _hook.startswith("pre-commit:") and _ev == "skipped":
            _bypass_hooks[_hook] = _n
if _bypass_hooks:
    info.append("pre-commit ALLOW_* obejscia: " + ", ".join(f"{h}={n}" for h, n in sorted(_bypass_hooks.items())))

# 2h. PG v3: pliki zdarzeniowe, agenci dzialowi, skill pg-review, router, agregator (2026-09-05)
for rel in ["pg/design.md", "pg/dod.md", "pg/prr.md", "pg/postmortem.md", "pg/cases.md", "pg/paradigm.md", "pg/models.md",
            "hooks/lib/risk-tier.js", "bin/pg-aggregate.js", "bin/test_pg_tools.js", "skills/pg-review/SKILL.md",
            "git-hooks/commit-msg", "templates/repo/eslint.config.mjs", "templates/repo/tsconfig.base.json",
            "templates/repo/.github/pull_request_template.md"]:
    check(f"PG v3 plik {rel}", (CLAUDE / rel).exists(), "brak — PG v3 niekompletne")
for agent in ["code-reviewer", "security-reviewer", "data-reviewer", "ops-reviewer", "ux-reviewer", "product-reviewer"]:
    a = CLAUDE / "agents" / f"{agent}.md"
    body = read(a)
    check(f"agent {agent} istnieje + schemat + how_to_check", a.exists() and "<schema>" in body and "how_to_check" in body, "brak sekcji schema/how_to_check")
verifier_body = read(CLAUDE / "agents" / "verifier.md")
check("agent verifier istnieje + procedura + schemat", "<procedure>" in verifier_body and "<schema>" in verifier_body, "brak sekcji procedure/schema")
check("prompt-guard v3 wskazuje pg/design.md", "pg/design.md" in read(CLAUDE / "hooks" / "prompt-guard.js"))
# 2h1. workflow-lint (parser GitHuba) — bez node_modules bramka pre-commit dla workflowow jest po cichu pomijana (fail-open).
wf_lint = CLAUDE / "tools" / "workflow-lint"
check("workflow-lint zainstalowany (tools/workflow-lint/node_modules/@actions/workflow-parser)",
      (wf_lint / "lint.mjs").exists() and (wf_lint / "hook.mjs").exists() and (wf_lint / "node_modules" / "@actions" / "workflow-parser").exists(),
      "cd ~/.claude/tools/workflow-lint && npm install — inaczej `secrets` w job-level if przechodzi lokalnie (shop-app 2026-09-05)")
check("pre-commit ma bramke workflow-lint + merge-aware (authored_only)",
      "workflow-lint" in read(CLAUDE / "git-hooks" / "pre-commit") and "authored_only" in read(CLAUDE / "git-hooks" / "pre-commit"))

# 2h2. Vault Infisical (<secret-manager-url>) odpowiada — bez niego most nie wstrzykuje sekretow i KAZDY push/PR
#      agentow pada cicho (2026-09-05: backend w stanie D/I-O wait przez >8 min, 12 agentow bez pushu).
try:
    import urllib.request as _ur
    with _ur.urlopen(_ur.Request("http://<secret-manager-url>/api/status", headers={"User-Agent": "pg-guard-health"}), timeout=8) as _resp:
        check("Infisical vault odpowiada (<secret-manager-url>)", _resp.status == 200, f"HTTP {_resp.status}")
except Exception as _err:  # noqa: BLE001 — kazda awaria sieci/kontenera = RED z powodem
    check("Infisical vault odpowiada (<secret-manager-url>)", False, f"{type(_err).__name__}: {str(_err)[:80]} -> cd <secret-manager> && docker compose -f docker-compose.prod.yml -p infisical-vault up -d")

# 2i. Widocznosc repo z sekretami w historii: MUSZA byc prywatne (bez tokena API zwraca 404).
#     Incydent 2026-09-05: agency-site wrocilo do public z haslami admina w historii (Log/incidents.md).
PRIVATE_LIST = CLAUDE / "pg" / "private-repos.txt"
if PRIVATE_LIST.exists():
    import urllib.error
    import urllib.request
    for name in [ln.strip() for ln in read(PRIVATE_LIST).splitlines() if ln.strip() and not ln.startswith("#")]:
        req = urllib.request.Request(f"https://api.github.com/repos/<github-owner>/{name}", headers={"User-Agent": "pg-guard-health"})
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                code = resp.status
        except urllib.error.HTTPError as err:
            code = err.code
        except (urllib.error.URLError, TimeoutError, OSError):
            code = None
        if code is None:
            info.append(f"visibility {name}: brak sieci — nie sprawdzono")
        else:
            check(f"repo {name} prywatne (API bez tokena -> 404)", code == 404, f"HTTP {code} = PUBLICZNE! sekrety w historii")

# 3. git-hooki globalne
rc, out = sh(["git", "config", "--global", "core.hooksPath"])
check("git core.hooksPath", "git-hooks" in out, f"='{out.strip()}'")
pc = CLAUDE / "git-hooks" / "pre-commit"
check("pre-commit istnieje", pc.exists())
check("pre-commit ma skan sekretow", "SECRET" in read(pc))
check("pre-commit ma fallback oxlint", "oxlint" in read(pc), "repo bez eslinta bez lintu na commicie")
check("pre-push istnieje", (CLAUDE / "git-hooks" / "pre-push").exists())

# 4. scheduled taski: SKILL.md + model pin + swieze breadcrumby (STARTED bez DONE = martwy run)
for task in [d.name for d in sorted((CLAUDE / "scheduled-tasks").glob("*")) if d.is_dir()] or ["fleet-pr-reviewer", "fleet-cve-watch", "fleet-auto-improve"]:
    sk = CLAUDE / "scheduled-tasks" / task / "SKILL.md"
    check(f"task {task} SKILL.md", sk.exists())
    if sk.exists():
        check(f"task {task} model pin", re.search(r"^model:", read(sk), re.MULTILINE) is not None, "brak model: we frontmatter")
_cc_tasks = [d.name for d in sorted((CLAUDE / "scheduled-tasks").glob("*")) if d.is_dir()]
for logname in (_cc_tasks or ["fleet-pr-reviewer", "fleet-cve-watch"]):
    lf = LOG_DIR / f"{logname}.md"
    if lf.exists():
        lines = [ln for ln in read(lf).splitlines() if ln.strip()]
        if lines and lines[-1].startswith("STARTED"):
            red.append(f"log {logname}: ostatni wpis to STARTED bez DONE/FAILED — run umarl w trakcie")

# 5. blokada platnych tokenow w tle
rc, out = sh(["schtasks", "/query", "/tn", "PG-DocLog-Auto", "/fo", "csv"])
check("PG-DocLog-Auto wylaczony", rc != 0 or "Disabled" in out, "task WLACZONY = platne tokeny w tle!")
for wf in ["claude-review.yml", "auto-improve.yml"]:
    p = CLAUDE / "templates" / "repo" / ".github" / "workflows" / wf
    check(f"szablon {wf} bez ANTHROPIC_API_KEY", p.exists() and "ANTHROPIC_API_KEY" not in read(p))

# Raport
stamp = datetime.now(timezone.utc).astimezone().strftime("%Y-%m-%d %H:%M")
status = "OK" if not red else "RED"
line = f"- {stamp} — {status}: {len(ok)} ok, {len(red)} problemow" + (": " + "; ".join(red) if red else "")
if info:
    line += " | gates 7d: " + ", ".join(info[:8])
try:
    LOG.parent.mkdir(parents=True, exist_ok=True)
    with LOG.open("a", encoding="utf-8") as f:
        f.write(line + "\n")
except Exception as e:  # noqa: BLE001
    print(f"[warn] nie zapisano logu: {e}")

print(f"GUARD-HEALTH {status} ({len(ok)} ok / {len(red)} red)")
for r in red:
    print("RED:", r)
for i in info[:12]:
    print("gates-7d:", i)
sys.exit(1 if red else 0)

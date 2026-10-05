#!/usr/bin/env python3
# Guard-health: deterministyczny audyt calego systemu jakosci (0 tokenow AI).
# Sprawdza, czy bramki NADAL sa wpiete — hooki, git-hooki, taski, blokada platnych tokenow —
# i (v3) czy REALNIE dzialaja: log bramek gates.jsonl + bateria testow pozytywnych.
# Exit 0 = wszystko OK; exit 1 = lista RED na stdout (do naprawy przez task/sesje).
# v2 (2026-08-24): + bash-guard, session-context, oxlint w post-edit, ruff/pyright na PATH.
# v3 (2026-09-05): + post-bash-edit-check, matcher desktop-commander, timeouty, lib/, tsc -b w 3 miejscach,
#                  telemetria skipow (gates.jsonl), test_hooks_v3 (pozytywne), narzedzia bin/*.js.
import json
import os
import platform
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
# Linux (laptop, 2026-10-02): vault z Syncthinga ~/Obsidian/MAIN; osobny plik logu per komputer, bo deferred-task-runner na
# second-machineu czyta ogon guard-health.md jako stan second-machinea, a rownolegly zapis z dwoch komputerow daje sync-conflict.
_LINUX_LOG_DIR = Path.home() / "Obsidian" / "MAIN" / "Claude Memory" / "Log"
LOG_DIR = next((d for d in (_OWNER_LOG_DIR, _LINUX_LOG_DIR) if d.exists()), CLAUDE / "memory" / "log")
LOG = LOG_DIR / ("guard-health.md" if os.name == "nt" else f"guard-health-{platform.node() or 'linux'}.md")
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
    ("PreToolUse", "edit-guard.js"),
    ("PostToolUse", "loop-monitor.js"),
    ("PreCompact", "precompact-snapshot.js"),
    ("SessionStart", "session-context.js"),
    ("SessionEnd", "auto-doc.py"),  # notatka sesji w Obsidianie (od 2026-10-05; wczesniej auto_doc.py nie byl wpiety)
]
LIB_FILES = ["lib/gate-log.js", "lib/lint-file.js", "lib/shell-parse.js", "lib/bash-rules.js", "lib/overrides.js", "lib/protected-paths.js"]
# `tsc --noEmit` przy project references sprawdza NIC — kazde miejsce z typecheckiem musi znac `tsc -b`
TSC_B_SITES = [
    CLAUDE / "hooks" / "lib" / "lint-file.js",
    CLAUDE / "git-hooks" / "pre-commit",
    CLAUDE / "templates" / "repo" / ".github" / "workflows" / "quality.yml",
    CLAUDE / "scheduled-tasks" / "fleet-pr-reviewer" / "SKILL.md",
]

# auto-doc (2026-10-05): bledy hooka z ostatnich 24 h = RED (poprzedni auto_doc nie dzialal 2 tygodnie niezauwazony)
_ad_log = CLAUDE / "logs" / "auto-doc.log"
try:
    _ad_recent = [ln for ln in _ad_log.read_text(encoding="utf-8").splitlines()[-50:]
                  if ln[:19] >= (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()[:19]]
except OSError:
    _ad_recent = []
check("auto-doc: brak bledow w logs/auto-doc.log z ostatnich 24 h", not _ad_recent, (_ad_recent or [""])[-1][:160])

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
    _pre = hooks.get("PreToolUse", [])
    _bg = " | ".join(g.get("matcher", "") for g in _pre if any("bash-guard" in h.get("command", "") for h in g.get("hooks", [])))
    check("bash-guard lapie tez desktop-commander start_process/interact (omijal matcher Bash)", "start_process" in _bg and "interact_with_process" in _bg, _bg)
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
ruff_ok = shutil.which("ruff") is not None or sh([sys.executable, "-m", "ruff", "--version"])[0] == 0
check("ruff dostepny (PATH albo python -m ruff)", ruff_ok, "pip install ruff")
check("pyright dostepny na PATH", shutil.which("pyright") is not None, "npm i -g pyright")

# 2f. telemetria bramek: skipy z ostatnich N dni (v3). Skip bez powodu = RED; reszta = info do logu.
counts: Counter = Counter()  # (hook, event) -> n; czytane tez nizej (obejscia ALLOW_* z pre-commit)
if GATES_LOG.exists():
    since = datetime.now(timezone.utc) - timedelta(days=GATES_WINDOW_DAYS)
    counts = Counter()
    empty_reason = 0
    malformed = 0
    # Po rotacji (5 MB) czesc okna 7 dni jest w gates.1.jsonl — bez niego obejscia z poczatku tygodnia znikaly z raportu.
    _rotated = GATES_LOG.with_name("gates.1.jsonl")
    for line in (read(_rotated) + "\n" + read(GATES_LOG)).splitlines():
        if not line.strip():
            continue
        try:
            e = json.loads(line)
            if datetime.fromisoformat(e["ts"].replace("Z", "+00:00")) < since:
                continue
            counts[(e.get("hook"), e.get("event"))] += 1
            if e.get("event") in ("bypass", "would_block"):
                counts[(e.get("event") + "-reason", (e.get("reason") or "")[:60])] += 1
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
    # Merge bez frazy (pg-merge-bezpieczny v2, ops-review 2026-10-01): rozklad zawsze widoczny; start bez wyniku albo wynik
    # niepewny (zerwane polaczenie przy PUT /merge) = RED — ktos musi sprawdzic, czy PR wszedl na main.
    start, scalone, odmowy, niepewne, gh_odmowy = (counts[("pg-merge-bezpieczny", "auto-merge" + s)] for s in ("-start", "", "-odmowa", "-niepewny", "-github-odmowa"))
    ocena = counts[("pg-merge-bezpieczny", "auto-merge-ocena-odmowa")]  # --sprawdz: tylko info, bez RED
    info.append(f"auto-merge 7 dni: start={start} scalone={scalone} odmowy={odmowy} ocena-odmowy={ocena} niepewne={niepewne} github-odmowy={gh_odmowy}, "
                f"stop-gate suppressed={counts[('stop-gate', 'suppressed')]}")
    check("auto-merge: kazdy start ma pewny wynik", niepewne == 0 and start <= scalone + gh_odmowy,
          f"start={start} scalone={scalone} niepewne={niepewne} — sprawdz PR-y w gates.jsonl")
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

# Wpiecia hookow tego komputera = migawka pg/settings-hooks.json (pg-wire.js, 2026-09-26). Rozjazd na second-machineu = laptop
# dostanie stare wpiecia (brak --export); na laptopie = czesc bramek nie dziala (brak --apply). Widoczne tez w zadaniu bez sesji.
_w = sh(["node", str(CLAUDE / "bin" / "pg-wire.js"), "--check"], timeout=60)
check("pg-wire: wpiecia hookow w settings.json = pg/settings-hooks.json", _rc_out(_w)[0] == 0, (_rc_out(_w)[1].strip().splitlines() or ["brak wyniku"])[-1])
# 2h. Hooki gita (#!/bin/sh) musza parsowac pod POSIX sh, nie tylko pod Git Bash: na Ubuntu sh = dash, w WSL/busybox tez.
# Blizna PREPUSH-BASHISM-DASH (2026-09-12): here-string `<<<` i tablice `x=()` wywalaly hook z rc 2 = KAZDY push/commit zablokowany
# na Linuksie; wykryte dopiero przez CI publicznego eksportu. Bez WSL = info (CI ubuntu eksportu jest druga linia).
if os.name != "nt" and shutil.which("sh"):
    # Linux/macOS (laptop 2026-10-02): sh = dash/POSIX natywnie, bez WSL.
    for _hook in ("pre-commit", "pre-push", "commit-msg"):
        _rc, _out = _rc_out(sh(["sh", "-n", str(CLAUDE / "git-hooks" / _hook)], timeout=60))
        check(f"git-hooks/{_hook}: skladnia POSIX sh (sh -n)", _rc == 0, (_out.strip().splitlines() or ["brak wyniku"])[-1][:160])
elif shutil.which("wsl"):
    for _hook in ("pre-commit", "pre-push", "commit-msg"):
        # sciezke tlumaczy wslpath WEWNATRZ dystrybucji (docker-desktop montuje C: pod /tmp/docker-desktop-root/..., Ubuntu pod /mnt/c)
        _win = str(CLAUDE / "git-hooks" / _hook)
        _r = sh(["wsl", "-e", "sh", "-c", f"sh -n \"$(wslpath '{_win}')\""], timeout=60)
        _rc, _out = _rc_out(_r)
        # wsl.exe pisze bledy w UTF-16 (bajty NUL); awaria USLUGI WSL (0x8007xxxx, Wsl/Service) = nie da sie sprawdzic,
        # a nie blad skladni hooka — info, jak brak WSL (2026-09-26: RED na commit-msg przy padnietej usludze WSL).
        _plain = _out.replace("\x00", "")
        if _rc != 0 and re.search(r"Wsl/Service|0x8007[0-9a-f]{4}|Wsl/E_", _plain, re.IGNORECASE):
            print(f"info: git-hooks/{_hook}: WSL niedostepny ({_plain.strip().splitlines()[-1][:80] if _plain.strip() else 'brak wyniku'}) — skladnia sprawdzana w CI eksportu")
            continue
        check(f"git-hooks/{_hook}: skladnia POSIX sh (WSL sh -n)", _rc == 0, (_plain.strip().splitlines() or ["brak wyniku"])[-1][:160])
else:
    print("info: brak WSL — skladnia POSIX hookow sprawdzana tylko w CI eksportu (ubuntu)")
for tool in ["sql-migration-lint.js", "fleet-metrics.js"]:
    check(f"bin/{tool} istnieje", (CLAUDE / "bin" / tool).exists(), "narzedzie z audytu 2026-09-05 zniknelo")
# 2h3. Gap-analiza vs slownik software house (2026-09-12, L1-L15): faza, srodowiska, backup, QA-instancje, PII, dlug.
for _name in ("phase-gate.js", "env-ref-gate.js", "todo-ledger-gate.js", "pii-inventory-gate.js", "qa-matrix.js", "backup-drill.py", "usage-by-repo.py"):
    check(f"bin/{_name} istnieje", (CLAUDE / "bin" / _name).exists(), "narzedzie z gap-analizy 2026-09-12 zniknelo")
check("agent qa-reviewer istnieje + schemat + procedure", "<schema>" in read(CLAUDE / "agents" / "qa-reviewer.md") and "<procedure>" in read(CLAUDE / "agents" / "qa-reviewer.md"))
check("pre-commit ma bramki phase/todo/pii", all(k in read(CLAUDE / "git-hooks" / "pre-commit") for k in ("phase-gate.js", "todo-ledger-gate.js", "pii-inventory-gate.js")))
check("pre-push: blok main czyta PUSH_REFS (blizna 2026-09-12; POSIX here-doc, nie bashowy <<<)", "done <<PG_REFS" in read(CLAUDE / "git-hooks" / "pre-push") and "<<<" not in read(CLAUDE / "git-hooks" / "pre-push") and read(CLAUDE / "git-hooks" / "pre-push").rstrip().endswith("exit 0"))
check("qa-matrix runtime: tools/qa-matrix/node_modules/playwright", (CLAUDE / "tools" / "qa-matrix" / "node_modules" / "playwright" / "package.json").exists(), "cd ~/.claude/tools/qa-matrix && npm install && npx playwright install chromium")
# Pakiet npm bez pobranej przegladarki = falszywa zielen (ops-reviewer 2026-09-12): sprawdz rewizje chromium z browsers.json w %LOCALAPPDATA%/ms-playwright.
_browsers = CLAUDE / "tools" / "qa-matrix" / "node_modules" / "playwright-core" / "browsers.json"
if _browsers.exists():
    try:
        _rev = next(b["revision"] for b in json.loads(read(_browsers))["browsers"] if b["name"] == "chromium")
        _pw_home = Path(os.environ.get("PLAYWRIGHT_BROWSERS_PATH") or (Path(os.environ.get("LOCALAPPDATA", "")) / "ms-playwright" if os.name == "nt" else Path.home() / ".cache" / "ms-playwright"))
        check(f"qa-matrix runtime: chromium-{_rev} pobrany", (_pw_home / f"chromium-{_rev}").exists() or (_pw_home / f"chromium_headless_shell-{_rev}").exists(), "cd ~/.claude/tools/qa-matrix && npx playwright install chromium")
    except (StopIteration, KeyError, json.JSONDecodeError) as _err:
        check("qa-matrix runtime: browsers.json czytelny", False, f"{type(_err).__name__}")
# Preflight P16 (backup-drill): bez klienta Postgresa drill nie istnieje — ma byc RED w audycie, nie dopiero przy realnym T3.
# 2026-09-13: brak klienta na PATH, ale jest docker -> backup-drill uzywa obrazu postgres:16-alpine (tryb docker) — to jest OK, nie RED.
_pg_native = all(shutil.which(_t) for _t in ("pg_dump", "pg_restore", "psql"))
_docker_ok = shutil.which("docker") is not None
check("backup-drill preflight: pg_dump/pg_restore/psql na PATH ALBO docker (obraz postgres)", _pg_native or _docker_ok,
      "winget install PostgreSQL.PostgreSQL (client tools) albo Docker Desktop — inaczej PRR P16 nie do wykonania")
if not _pg_native and _docker_ok:
    print("info: backup-drill w trybie docker (postgres:16-alpine) — klient Postgresa nie jest zainstalowany natywnie")
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
    check("Infisical vault odpowiada (<secret-manager-url>)", False, f"{type(_err).__name__}: {str(_err)[:80]} -> " + ("cd <secret-manager> && docker compose -f docker-compose.prod.yml -p infisical-vault up -d" if os.name == "nt" else "systemctl --user restart second-machine-infisical (tunel SSH do second-machinea); dalej pada = Infisical na second-machineu"))

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
            # 403/429 = limit API bez tokena (x-ratelimit-remaining: 0), NIE publiczne repo (falszywy RED 2026-10-04) —
            # wtedy strona WWW repo (bez limitu API): 404 = prywatne, 200 = publiczne.
            if code in (403, 429):
                try:
                    with urllib.request.urlopen(urllib.request.Request(f"https://github.com/<github-owner>/{name}", method="HEAD",
                                                                       headers={"User-Agent": "pg-guard-health"}), timeout=15) as www:
                        code = www.status
                except urllib.error.HTTPError as err2:
                    code = err2.code
                except (urllib.error.URLError, TimeoutError, OSError):
                    code = None
        except (urllib.error.URLError, TimeoutError, OSError):
            code = None
        if code is None or code in (403, 429):
            info.append(f"visibility {name}: {'limit API/WWW' if code else 'brak sieci'} — nie sprawdzono")
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
if os.name == "nt":
    rc, out = sh(["schtasks", "/query", "/tn", "PG-DocLog-Auto", "/fo", "csv"])
    check("PG-DocLog-Auto wylaczony", rc != 0 or "Disabled" in out, "task WLACZONY = platne tokeny w tle!")
else:
    # Linux (2026-10-02): odpowiednik to brak uslugi systemd --user i wpisu crontab, ktore odpalaja `claude -p` / klucz API w tle.
    _paid_rx = re.compile(r"\bclaude\b[^\n]*\s(-p|--print)\b|ANTHROPIC_API_KEY|DocLog")
    _bg = [p.name for p in (Path.home() / ".config" / "systemd" / "user").glob("*.service") if _paid_rx.search(read(p))]
    _crc, _cron = _rc_out(sh(["crontab", "-l"], timeout=15))
    if _crc == 0 and _paid_rx.search(_cron):
        _bg.append("crontab")
    check("brak platnych tokenow w tle (systemd --user / crontab bez claude -p)", not _bg, f"podejrzane: {_bg}")
for wf in ["claude-review.yml", "auto-improve.yml"]:
    p = CLAUDE / "templates" / "repo" / ".github" / "workflows" / wf
    check(f"szablon {wf} bez ANTHROPIC_API_KEY", p.exists() and "ANTHROPIC_API_KEY" not in read(p))

# 6. Landscape 2026-09-26: mutanty bramek, audyt obejsc, efektywne hooki repo, deny baseline, pieczec warstwy kontrolnej.
# 6a. Testy mutacyjne bash-guard: regula, ktorej wylaczenia nie wykrywa zaden test = regula bez kontroli (#4).
_r = sh(["node", str(CLAUDE / "bin" / "pg-mutate.js")], timeout=180)
check("pg-mutate: kazdy mutant bash-guard zabity", _rc_out(_r)[0] == 0, (_rc_out(_r)[1].strip().splitlines() or ["brak wyniku"])[-1])
# 6b. Obejscia (#5) i reguly w trybie observe (#20) z 7 dni — widoczne w raporcie, decyzja o enforce po danych.
for (kind, reason), n in sorted(((k, n) for k, n in counts.items() if k[0] in ("bypass-reason", "would_block-reason")), key=lambda kv: -kv[1])[:8]:
    info.append(f"{kind.split('-')[0]} {reason}: {n}")
# 6c. Efektywne hooki per repo (#7): lokalny core.hooksPath w repo floty omija globalne bramki. WARN (dlug klientow — naprawa
# per repo za zgoda uzytkownika, zasada zakresu 2026-08-09), nie RED.
_global_hooks = (CLAUDE / "git-hooks").resolve()
_roots = [ln.strip() for ln in read(CLAUDE / "pg" / "trusted-roots.txt").splitlines() if ln.strip() and not ln.startswith("#")]
_local_override = []
for _root in _roots:
    _rp = Path(_root)
    for _repo in ([_rp] if (_rp / ".git").exists() else [d for d in _rp.glob("*") if (d / ".git").exists()])[:60]:
        _rc, _hp = _rc_out(sh(["git", "-C", str(_repo), "config", "--local", "--get", "core.hooksPath"], timeout=15))
        if _rc == 0 and _hp.strip() and Path(_repo, _hp.strip()).resolve() != _global_hooks:
            _local_override.append(_repo.name)
if _local_override:
    info.append(f"WARN lokalny core.hooksPath (globalne bramki nie dzialaja): {', '.join(sorted(set(_local_override))[:8])}")
# 6d. permissions.deny zawiera baseline (#10); sciezki absolutne w skladni `//` (inaczej CC traktuje je jako wzgledne).
try:
    _deny = set(json.loads(read(CLAUDE / "settings.json")).get("permissions", {}).get("deny", []))
    _base = set(json.loads(read(CLAUDE / "pg" / "deny-baseline.json")).get("deny", []))
    if os.name != "nt":  # = pg-wire.js localDeny (port Linux 2026-10-02)
        _base = {d.replace("(//d/", "(~/D/") for d in _base}
    check("permissions.deny zawiera baseline (pg/deny-baseline.json)", _base <= _deny, f"brakuje: {sorted(_base - _deny)[:4]}")
    _bad = [d for d in _deny if re.match(r"^\w+\([A-Za-z]:[/\\]", d)]
    check("permissions.deny: sciezki absolutne jako //dysk/...", not _bad, f"zla forma: {_bad[:3]}")
except Exception as e:  # noqa: BLE001
    red.append(f"deny baseline nieczytelny — {e}")
# 6e. Pieczec warstwy kontrolnej (#11): hash hookow i narzedzi wolanych z pre-commit vs hooks/.seal.json.
# Brak pieczeci = RED (data-review 2026-09-26: skasowanie pliku zamienialo RED w info, pieczec niczego nie chronila).
_rc, _out = _rc_out(sh(["node", str(CLAUDE / "bin" / "pg-seal.js"), "--check"], timeout=30))
check("pieczec warstwy kontrolnej istnieje i jest zgodna (hooks/, git-hooks/, bramki bin/)", _rc == 0,
      (_out.strip().splitlines() or ["brak wyniku"])[-1][:160] + (" — utworz: node ~/.claude/bin/pg-seal.js (za zgoda uzytkownika)" if _rc == 3 else ""))

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

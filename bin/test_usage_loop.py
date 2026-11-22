"""Testy hooks/usage_loop.py: sekcja „Petla uzycia" wolana z guard_health.py (progi z pg/usage-loop.json, migawki
tygodniowe, kandydaci). Modul importowany wprost; nic nie pisze do prawdziwego ~/.claude/logs."""
import atexit
import importlib.util
import json
import os
import shutil
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = Path(os.path.abspath(__file__)).parent
_spec = importlib.util.spec_from_file_location("usage_loop", HERE.parent / "hooks" / "usage_loop.py")
if _spec is None or _spec.loader is None:
    raise SystemExit("brak hooks/usage_loop.py")
ul = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(ul)

_TMPS: list = []
atexit.register(lambda: [shutil.rmtree(d, ignore_errors=True) for d in _TMPS])
fails = []
NOW = datetime(2026, 11, 15, 12, 0, tzinfo=timezone.utc)


def check(name, ok, detail=""):
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else f" :: {detail}"))
    if not ok:
        fails.append(name)


def ev(days_ago, hook, event, reason="", **extra):
    return {"ts": (NOW - timedelta(days=days_ago)).isoformat(), "hook": hook, "event": event, "reason": reason, **extra}


def outcome(days_ago, rule, result, repo="a", roles=("code",)):
    return {"ts": (NOW - timedelta(days=days_ago)).isoformat(), "rule_id": rule, "outcome": result, "repo": repo, "roles": list(roles)}


# --- progi ---
thr, problems = ul.load_thresholds("")
check("brak pliku progow: wartosci domyslne i wpis w problemach", thr == ul.DEFAULTS and len(problems) == 1, str(problems))
thr, problems = ul.load_thresholds('{"dead_weeks": 2, "noisy_hook_pct": "duzo", "max_candidates": 0, "safety_prefixes": ["x|"]}')
check("poprawny wpis nadpisuje, zly typ i wartosc < 1 zostaja domyslne z ostrzezeniem",
      thr["dead_weeks"] == 2 and thr["noisy_hook_pct"] == 50 and thr["max_candidates"] == 5 and thr["safety_prefixes"] == ["x|"]
      and len(problems) == 2, str(problems))
check("zepsuty JSON progow: domyslne + ostrzezenie", ul.load_thresholds("{nie json")[0] == ul.DEFAULTS and ul.load_thresholds("{x")[1] != [])
shipped = ul.load_thresholds((HERE.parent / "pg" / "usage-loop.json").read_text(encoding="utf-8"))
check("pg/usage-loop.json w repo: bez problemow, komplet kluczy", shipped[1] == [] and set(shipped[0]) == set(ul.DEFAULTS), str(shipped[1]))

# --- klucz reguly ---
check("klucz z pola gate", ul.rule_key({"hook": "pre-push", "gate": "LARGE_DIFF", "reason": "rc=1"}) == "pre-push|LARGE_DIFF")
check("klucz bez gate: poczatek powodu bez szczegolow przypadku",
      ul.rule_key({"hook": "stop-gate", "reason": "tier-content: T1 -> T3 (payment-gateway)"}) == "stop-gate|tier-content"
      and ul.rule_key({"hook": "stop-gate", "reason": "pytest timeout 55s (testy)"}) == "stop-gate|pytest timeout Ns"
      and ul.rule_key({"hook": "bash-guard", "reason": "rule:rm-rf"}) == "bash-guard|rule:rm-rf")

# --- migawka ---
events = [ev(1, "bash-guard", "blocked", "rule:rm-rf"), ev(2, "bash-guard", "would_block", "rule:rm-rf"),
          ev(2, "stop-gate", "ran", "1/1"), ev(3, "stop-gate", "blocked", "review", origin="test"),
          ev(9, "stop-gate", "blocked", "review"), {"ts": "zly", "hook": "x", "event": "blocked"}, "nie-dict"]
snap = ul.snapshot(events, [], NOW)
check("migawka: odpalenia w oknie 7 dni bez origin test, zle wpisy pominiete",
      snap["rules"] == {"bash-guard|rule:rm-rf": 2} and snap["events"] == 3 and snap["active_days"] == 2, json.dumps(snap))
snap_m = ul.snapshot([ev(1, "bash-guard", "blocked", "rule:force-push", origin="manual")], [], NOW)
check("migawka: origin manual (guard_health probe) skipped", snap_m["rules"] == {}, json.dumps(snap_m))

tmp = tempfile.mkdtemp(prefix="pg-usage-loop-")
_TMPS.append(tmp)
hist = Path(tmp) / "logs" / "usage-loop.jsonl"
check("pierwsza migawka dopisana (katalog tworzony)", ul.append_snapshot(hist, snap) is True and len(ul.read_jsonl(hist.read_text())) == 1)
check("druga tego samego tygodnia pominieta", ul.append_snapshot(hist, ul.snapshot(events, [], NOW + timedelta(days=3))) is False)
check("po 7 dniach dopisana", ul.append_snapshot(hist, ul.snapshot(events, [], NOW + timedelta(days=7))) is True
      and len(ul.read_jsonl(hist.read_text())) == 2)

# --- martwe reguly ---
T = dict(ul.DEFAULTS, dead_weeks=2, dead_min_active_days=4)


def week(rules, days=5):
    return {"ts": NOW.isoformat(), "active_days": days, "rules": rules}


dead, note = ul.dead_rules([week({"a|x": 1}), week({})], T)
check("za krotka historia: None i 'za malo danych', nie zero", dead is None and "za malo danych (n=2" in note, note)
dead, note = ul.dead_rules([week({"a|x": 1}), week({}, days=1), week({}, days=1)], T)
check("za malo dni z aktywnoscia: None", dead is None and "dni z aktywnoscia" in note, note)
history = [week({"a|x": 3, "b|y": 1, "bash-guard|rule:rm-rf": 2}), week({"b|y": 1}), week({})]
dead, note = ul.dead_rules(history, T)
check("martwa = znana wczesniej, 0 odpalen w oknie; bezpiecznik pominiety; odpalona nie", dead == ["a|x"], f"{dead} {note}")

# --- glosne bramki i recenzenci ---
check("git-hook: obejscie po blokadzie > 50% przy n >= 10; n < 10 pominiete",
      ul.noisy_hooks({"SECRET": {"incydenty": 10, "obejscie_po_blokadzie": 6}, "MSG": {"incydenty": 9, "obejscie_po_blokadzie": 9},
                      "LARGE_DIFF": {"incydenty": 10, "obejscie_po_blokadzie": 5}}, ul.DEFAULTS) == [("SECRET", 60, 6, 10)])
rows = [outcome(1, "R", "fixed", roles=("ux",)) for _ in range(6)] + [outcome(1, "R", "verifier_dropped", roles=("ux",)) for _ in range(4)] \
    + [outcome(1, "R", "kept_note", roles=("ux",)) for _ in range(20)] + [outcome(40, "R", "dropped:false_positive", roles=("ops",)) for _ in range(12)]
check("recenzent: 4/10 = 40% ponad prog; kept_note poza ulamkiem; stare wpisy poza oknem",
      ul.noisy_reviewers(rows, NOW, ul.DEFAULTS) == [("ux", 40, 4, 10)], str(ul.noisy_reviewers(rows, NOW, ul.DEFAULTS)))

# --- powtarzajacy sie finding ---
rows2 = [outcome(i % 20, "SILENT-FALLBACK", "fixed", repo="a" if i % 2 else "b") for i in range(10)] \
    + [outcome(1, "ONE-REPO", "fixed", repo="a") for _ in range(12)] + [outcome(1, "FEW", "fixed", repo=str(i)) for i in range(9)]
check("powtarzajacy sie: >= 10 naprawien w >= 2 repo; jedno repo i 9 naprawien odpadaja",
      ul.recurring_findings(rows2, NOW, ul.DEFAULTS) == [("SILENT-FALLBACK", 10, 2)], str(ul.recurring_findings(rows2, NOW, ul.DEFAULTS)))

# --- raport ---
lines = ul.report([], [], {}, NOW, ul.DEFAULTS, ["brak pg/usage-loop.json: progi domyslne"])
check("pusty stan: naglowek, ostrzezenie, 'za malo danych', brak kandydatow",
      lines[0].startswith("PETLA UZYCIA") and any("[warn]" in x for x in lines) and any("za malo danych" in x for x in lines)
      and lines[-1].strip() == "brak kandydatow ponad progami", "\n".join(lines))
T2 = dict(T, max_candidates=1)
lines = ul.report(history, rows2, {"SECRET": {"incydenty": 10, "obejscie_po_blokadzie": 6}}, NOW, T2)
check("limit kandydatow: 3 znalezionych, 1 pokazany (glosna bramka pierwsza), kazdy z komenda dowodu",
      any("id: noisy-hook:SECRET" in x for x in lines) and any("kandydaci: 3, z decyzja: 0, pokazani: 1" in x for x in lines)
      and sum("| dowod: " in x for x in lines) == 1, "\n".join(lines))
G = {"SECRET": {"incydenty": 10, "obejscie_po_blokadzie": 6}}
lines = ul.report([week({"a|x": 3, "b|y": 1}), week({"b|y": 1}), week({})], [], G, NOW, T)
check("martwa regula na liscie, jej dowod zawiera klucz", any("id: dead:a|x" in x and "grep -cF '\"a|x\"'" in x for x in lines), "\n".join(lines))
check("kandydat bez decyzji wraca w kolejnym raporcie (brak wygaszania)",
      any("id: noisy-hook:SECRET" in x for x in ul.report([week({})], [], G, NOW, ul.DEFAULTS)))

# Decyzja wlasciciela zapisana w pliku progow: kandydat znika, liczniki decyzji w raporcie (miara ADR-0013 policzalna).
TD, problems_d = ul.load_thresholds(json.dumps({"decisions": {"noisy-hook:SECRET": "accepted 2026-11-20: przelaczone na observe",
                                                                "recurring:X": "rejected: falszywy kandydat"}}))
lines = ul.report([], [], G, NOW, TD)
check("decyzja: kandydat poza lista, raport liczy przyjete/odrzucone",
      problems_d == [] and not any("| id: " in x for x in lines) and any("przyjete 1, odrzucone 1" in x for x in lines)
      and any("z decyzja: 1" in x for x in lines), "\n".join(lines))
bad_thr, bad_problems = ul.load_thresholds('{"decisions": {"a": "moze", "b": "rejected: szum"}}')
check("decyzja bez slowa accepted|rejected: tylko ten wpis pominiety, ostrzezenie nazywa wymagane slowa i wpis",
      bad_thr["decisions"] == {"b": "rejected: szum"} and len(bad_problems) == 1
      and "accepted albo rejected" in bad_problems[0] and bad_problems[0].endswith("pominiete: a"), str(bad_problems))

# Dziura miedzy migawkami (laptop wylaczony) = brak werdyktu o martwych regulach.
gappy = [dict(week({"a|x": 1}), ts=(NOW - timedelta(days=40)).isoformat()), dict(week({}), ts=(NOW - timedelta(days=7)).isoformat()), week({})]
dead, note = ul.dead_rules(gappy, T)
check("dziura 33 dni miedzy migawkami: None, nie falszywa martwa regula", dead is None and "dziura 33 dni" in note, note)


# --- wpiecie ---
gh = (HERE.parent / "hooks" / "guard_health.py").read_text(encoding="utf-8")
check("guard_health.py wola usage_loop w bloku informacyjnym", "import usage_loop" in gh and "usage_loop.report(" in gh)
check("guard_health.py dopisuje raport petli do pliku logu (pod timerem stdout = journal)",
      "def _log_note(" in gh and "_log_note(_ul_lines)" in gh and "_log_note([_warn])" in gh)

print(f"\n{'OK' if not fails else 'FAIL'}: {len(fails)} bledow")
sys.exit(1 if fails else 0)

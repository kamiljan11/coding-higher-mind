"""Testy hooks/gate_effectiveness.py: sekcje „Skutecznosc bramek" (G3) i „Wyniki recenzji" (G4) wolane z guard_health.py
(Fala 0, design §11.3-11.4). Modul importowany wprost (jak lang_gap_health). Nic nie pisze do prawdziwego ~/.claude/logs."""
import atexit
import importlib.util
import json
import os
import re
import shutil
import sys
import tempfile
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = Path(os.path.abspath(__file__)).parent
GH = HERE.parent / "hooks" / "guard_health.py"
src = GH.read_text(encoding="utf-8")
_spec = importlib.util.spec_from_file_location("gate_effectiveness", HERE.parent / "hooks" / "gate_effectiveness.py")
if _spec is None or _spec.loader is None:
    raise SystemExit("brak hooks/gate_effectiveness.py")
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)
ns = vars(_mod)
ge = _mod.gate_effectiveness

_TMPS: list = []
atexit.register(lambda: [shutil.rmtree(d, ignore_errors=True) for d in _TMPS])
fails = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else f" :: {detail}"))
    if not ok:
        fails.append(name)


T0 = datetime(2026, 11, 1, 12, 0, 0, tzinfo=timezone.utc)


def ts(sec: float) -> str:
    return (T0 + timedelta(seconds=sec)).isoformat().replace("+00:00", "Z")


def blocked(sec, gate, hook="pre-commit", target="/repo/a", **kw):
    return {"ts": ts(sec), "hook": hook, "event": "blocked", "reason": "rc=1", "target": target, "gate": gate, **kw}


def bypass(sec, var, hook="pre-commit", target="/repo/a", **kw):
    return {"ts": ts(sec), "hook": hook, "event": "bypass", "reason": var, "target": target, **kw}


def st(events, gate):
    return ge(events).get(gate, {})


MIN = 60

# 1. podstawowa para blocked -> bypass <= 30 min
s = st([blocked(0, "SECRET"), bypass(5 * MIN, "ALLOW_SECRET=1")], "SECRET")
check("para blocked->bypass: incydent zamkniety obejsciem", (s["incydenty"], s["obejscie_po_blokadzie"], s["bez_obejscia"], s["obejscie_bez_blokady"]) == (1, 1, 0, 0), str(s))
s = st([blocked(0, "SECRET"), bypass(31 * MIN, "ALLOW_SECRET=1")], "SECRET")
check("bypass 31 min po blocked = poza oknem: bez_obejscia + obejscie_bez_blokady", (s["incydenty"], s["obejscie_po_blokadzie"], s["bez_obejscia"], s["obejscie_bez_blokady"]) == (1, 0, 1, 1), str(s))
s = st([blocked(10 * MIN, "SECRET"), bypass(0, "ALLOW_SECRET=1")], "SECRET")
check("bypass PRZED blocked nie zamyka incydentu", (s["obejscie_po_blokadzie"], s["obejscie_bez_blokady"]) == (0, 1), str(s))
s = st([blocked(0, "SECRET"), bypass(5 * MIN, "ALLOW_SECRET=1", target="/repo/inne")], "SECRET")
check("inny target = brak pary", (s["obejscie_po_blokadzie"], s["obejscie_bez_blokady"], s["bez_obejscia"]) == (0, 1, 1), str(s))

# 2. petla poprawek: kolejne blocked <= 30 min od ostatniego = jeden incydent; okno bypassu liczone od OSTATNIEGO blocked
# blocked -> bypass -> blocked (<30 min) -> bypass = 2 incydenty, oba obejscia po blokadzie (recenzja p345 code-1)
s = st([blocked(0, "STALE_BASE"), bypass(2 * MIN, "ALLOW_STALE_BASE=1"), blocked(10 * MIN, "STALE_BASE"), bypass(12 * MIN, "ALLOW_STALE_BASE=1")], "STALE_BASE")
check("blocked po bypassie w oknie 30 min = NOWY incydent (2 incydenty, 2 obejscia po blokadzie)",
      (s["incydenty"], s["obejscie_po_blokadzie"], s["obejscie_bez_blokady"], s["bez_obejscia"]) == (2, 2, 0, 0), str(s))
s = st([blocked(0, "STALE_BASE"), bypass(2 * MIN, "ALLOW_STALE_BASE=1"), blocked(10 * MIN, "STALE_BASE")], "STALE_BASE")
check("blocked po bypassie bez drugiego bypassu = 2 incydenty, 1 bez obejscia", (s["incydenty"], s["bez_obejscia"]) == (2, 1), str(s))
# ts bez strefy = UTC (TS-NAIVE): miesza sie z ts z 'Z' bez TypeError
naive = dict(blocked(0, "TSC"))
naive["ts"] = T0.replace(tzinfo=None).isoformat()
s = st([naive, blocked(60, "TSC")], "TSC")
check("ts bez strefy traktowany jako UTC (jeden incydent z ts 'Z')", s.get("incydenty") == 1, str(s))
loop = [blocked(0, "ESLINT"), blocked(20 * MIN, "ESLINT"), blocked(45 * MIN, "ESLINT")]
check("ESLINT: 3 blocked co <=30 min = 1 incydent", st(loop, "ESLINT")["incydenty"] == 1, str(st(loop, "ESLINT")))
check("ESLINT: blocked po 31 min = nowy incydent", st([blocked(0, "ESLINT"), blocked(31 * MIN, "ESLINT")], "ESLINT")["incydenty"] == 2)
s = st([blocked(0, "STALE_BASE"), blocked(25 * MIN, "STALE_BASE"), bypass(50 * MIN, "ALLOW_STALE_BASE=1")], "STALE_BASE")
check("bypass <= ostatni blocked + 30 min zamyka incydent", (s["incydenty"], s["obejscie_po_blokadzie"]) == (1, 1), str(s))
s = st(loop, "ESLINT")
check("bramka bez zmiennej ALLOW: tylko incydenty, bez obejsc", (s["obejscie_po_blokadzie"], s["obejscie_bez_blokady"], s["bez_obejscia"]) == (0, 0, 1), str(s))

# 3. najstarszy otwarty incydent, kazdy bypass konsumuje max 1 incydent
two = [blocked(0, "TODO", hook="pre-commit"), blocked(5 * MIN, "TODO", hook="pre-push"),
       bypass(10 * MIN, "ALLOW_TODO=1"), bypass(11 * MIN, "ALLOW_TODO=1"), bypass(12 * MIN, "ALLOW_TODO=1")]
s = st(two, "TODO")
check("2 incydenty (rozne hooki), 3 bypassy -> 2 po blokadzie + 1 bez blokady", (s["incydenty"], s["obejscie_po_blokadzie"], s["bez_obejscia"], s["obejscie_bez_blokady"]) == (2, 2, 0, 1), str(s))
check("bramka widoczna w obu hookach", s["hooks"] == {"pre-commit", "pre-push"}, str(s["hooks"]))

# 4. duplikat SECRET (pre-commit + commit-msg z jednego commita, <= 5 s)
s = st([blocked(0, "SECRET"), bypass(60, "ALLOW_SECRET=1", hook="pre-commit"), bypass(62, "ALLOW_SECRET=1", hook="commit-msg")], "SECRET")
check("duplikat SECRET <= 5 s: jeden konsumuje, drugi pomijany", (s["obejscie_po_blokadzie"], s["obejscie_bez_blokady"]) == (1, 0), str(s))
s = st([bypass(60, "ALLOW_SECRET=1", hook="pre-commit"), bypass(62, "ALLOW_SECRET=1", hook="commit-msg")], "SECRET")
check("duplikat bez incydentu: liczony raz jako obejscie_bez_blokady", (s["incydenty"], s["obejscie_bez_blokady"]) == (0, 1), str(s))
s = st([bypass(0, "ALLOW_SECRET=1"), bypass(10, "ALLOW_SECRET=1")], "SECRET")
check("dwa bypassy w odstepie 10 s to dwa zdarzenia", s["obejscie_bez_blokady"] == 2, str(s))

# 5. filtry wejscia
check("origin=test i origin=tmp wykluczone", ge([blocked(0, "SECRET", origin="test"), blocked(1, "SECRET", origin="tmp"), bypass(2, "ALLOW_SECRET=1", origin="test")]) == {})
s = st([blocked(0, "SECRET", origin="agent"), blocked(1, "PII", origin="human"), blocked(2, "MSG")], "SECRET")
check("origin agent/human i brak pola origin liczone", s["incydenty"] == 1 and st([blocked(2, "MSG")], "MSG")["incydenty"] == 1 and st([blocked(1, "PII", origin="human")], "PII")["incydenty"] == 1)
other = [{"ts": ts(0), "hook": "bash-guard", "event": "blocked", "reason": "x", "target": "/repo/a", "gate": "SECRET"},
         {"ts": ts(1), "hook": "edit-guard", "event": "bypass", "reason": "ALLOW_SECRET=1", "target": "/repo/a"},
         {"ts": ts(2), "hook": "prompt-guard", "event": "bypass", "reason": "ALLOW_SECRET=1", "target": "/repo/a"}]
check("bash-guard/edit-guard/prompt-guard nie sa mieszane", ge(other) == {})
check("stary blocked bez pola gate pomijany", ge([{"ts": ts(0), "hook": "pre-commit", "event": "blocked", "reason": "x", "target": "/repo/a"}]) == {})
check("reason `main -> ...` (pg_main_ok) pomijany, ALLOW_MAIN=1 -> bramka MAIN",
      ge([bypass(0, "main -> origin/main")]) == {} and st([blocked(0, "MAIN", hook="pre-push"), bypass(60, "ALLOW_MAIN=1", hook="pre-push")], "MAIN")["obejscie_po_blokadzie"] == 1)
unsorted = [bypass(300, "ALLOW_PHASE=1"), blocked(0, "PHASE"), {"ts": "nie-data", "hook": "pre-commit", "event": "blocked", "gate": "PHASE", "target": "/repo/a"}, {"hook": "pre-commit", "event": "blocked", "gate": "PHASE"}, "smiec", None]
s = st(unsorted, "PHASE")
check("nieposortowane ts, zepsute ts/wpisy tolerowane", (s["incydenty"], s["obejscie_po_blokadzie"]) == (1, 1), str(s))
check("ts z przesunieciem +00:00 (jak nowe wpisy) tez dziala", st([{**blocked(0, "TSC"), "ts": "2026-11-01T12:00:00.000+00:00"}], "TSC")["incydenty"] == 1)

# 6. etykieta poziomu z overrides.js (regex, bez node) + fallback
real = (HERE.parent / "hooks" / "lib" / "overrides.js").read_text(encoding="utf-8")
sets = ns["gate_tier_sets"](real)
check("gate_tier_sets czyta SELF_SERVICE/SELF_APPROVABLE z prawdziwego overrides.js", sets[0] is not None and "LARGE_DIFF" in sets[0] and "PII" in sets[1], str(sets))
lab = ns["gate_tier_label"]
check("etykiety: A (LARGE_DIFF), B (PII), C (SECRET), '-' (ESLINT)", [lab("LARGE_DIFF", sets), lab("PII", sets), lab("SECRET", sets), lab("ESLINT", sets)] == ["A", "B", "C", "-"])
check("wylacznik self-approval.off => C", lab("LARGE_DIFF", sets, True) == "C")
bad_sets = ns["gate_tier_sets"]("nic tu nie ma")
check("brak/zepsuty overrides.js => etykieta '?' (nie wyjatek)", bad_sets == (None, None) and lab("SECRET", bad_sets) == "?" and ns["gate_tier_sets"](None) == (None, None))

# 7. wydruk: procent tylko gdy incydenty >= 5; naglowek interpretacji; pusty stan
five = [blocked(i * 40 * MIN, "TSC") for i in range(5)]
txt = "\n".join(ns["gate_effectiveness_lines"](ge(five), sets))
check("n>=5: procent liczony (TSC 0%)", re.search(r"TSC \| pre-commit \| - \| 5 \| 0 \| 5 \| 0 \| 0%", txt) is not None, txt)
txt4 = "\n".join(ns["gate_effectiveness_lines"](ge(five[:4]), sets))
check("n<5: 'n<5' zamiast procentu", re.search(r"TSC \|.*\| n<5$", txt4, re.MULTILINE) is not None, txt4)
check("naglowek: interpretacja (sygnal do ZBADANIA, nie werdykt)", "SKUTECZNOSC BRAMEK" in txt and "do ZBADANIA" in txt and "nie werdykt" in txt)
check("pusty stan = czytelna informacja, nie wyjatek", "brak danych" in "\n".join(ns["gate_effectiveness_lines"]({}, sets)))
check("wiersz z etykieta poziomu bramki z ALLOW", "SECRET | pre-commit | C |" in "\n".join(ns["gate_effectiveness_lines"](ge([blocked(0, "SECRET")]), sets)))

# 8. migawka do pliku (append, 1 wiersz per bramka)
tmp = Path(tempfile.mkdtemp(prefix="gate-eff-test-"))
_TMPS.append(str(tmp))
snap = tmp / "logs" / "gate-effectiveness.jsonl"
stats = ge([blocked(0, "SECRET"), bypass(60, "ALLOW_SECRET=1"), blocked(0, "ESLINT")])
n1 = ns["append_gate_snapshot"](snap, stats, "2026-11-01T12:00:00+00:00")
n2 = ns["append_gate_snapshot"](snap, stats, "2026-11-01T13:00:00+00:00")
n3 = ns["append_gate_snapshot"](snap, stats, "2026-11-02T08:00:00+00:00", 14)
lines = [json.loads(ln) for ln in snap.read_text(encoding="utf-8").splitlines()]
check("migawka: 1 wiersz per bramka, max 1 migawka na dzien UTC (12:00 + 13:00 + nastepny dzien = 4 wiersze)", (n1, n2, n3, len(lines)) == (2, 0, 2, 4), str((n1, n2, n3, lines)))
check("migawka: pola ts,window_days,gate,hook,incydenty,obejscie_po_blokadzie,bez_obejscia,obejscie_bez_blokady",
      list(lines[0]) == ["ts", "window_days", "gate", "hook", "incydenty", "obejscie_po_blokadzie", "bez_obejscia", "obejscie_bez_blokady"]
      and lines[0]["window_days"] == 7 and lines[2]["window_days"] == 14 and lines[1]["gate"] == "SECRET" and lines[1]["obejscie_po_blokadzie"] == 1, str(lines[:3]))
torn = tmp / "torn" / "g.jsonl"
torn.parent.mkdir(parents=True)
torn.write_text('{"ts":"2026-10-01T00:00:00+00:00","gate":"SEC', encoding="utf-8")
ns["append_gate_snapshot"](torn, stats, "2026-11-01T12:00:00+00:00")
torn_rows = [ln for ln in torn.read_text(encoding="utf-8").splitlines() if ln]
check("migawka: urwany ogon pliku nie skleja sie z nowym wierszem", len(torn_rows) == 3 and json.loads(torn_rows[1])["gate"] in ("ESLINT", "SECRET"), str(torn_rows))
empty_snap = tmp / "empty" / "x.jsonl"
check("migawka: zero bramek = zero wierszy, plik nie powstaje", ns["append_gate_snapshot"](empty_snap, {}, "t") == 0 and not empty_snap.exists())

# 9. G4: wyniki recenzji
rc = ns["review_counts"]
NOW = datetime(2026, 11, 1, 12, 0, tzinfo=timezone.utc)


def orow(outcome, roles=("code",), rule="R1", days_ago=1, run="k1"):
    return {"ts": (NOW - timedelta(days=days_ago)).isoformat(), "run_key": run, "roles": list(roles), "rule_id": rule, "outcome": outcome}


rows = ([orow("fixed")] * 3 + [orow("dropped:false_positive")] * 2 + [orow("dropped:out_of_scope")] + [orow("kept_note")] * 4 + [orow("verifier_dropped")] * 2)
c = rc(rows)
t = c["total"]
check("G4 liczniki: fixed/fp/inne dropped, kept_note i verifier_dropped osobno", (t["fixed"], t["false_positive"], t["dropped_other"], t["kept_note"], t["verifier_dropped"]) == (3, 2, 1, 4, 2), str(t))
check("G4 powody dropped", c["reasons"] == Counter({"dropped:false_positive": 2, "dropped:out_of_scope": 1}))
check("G4 ulamek: (fp+verifier_dropped)/(fixed+dropped+verifier_dropped) = 4/8 = 50%", ns["_rc_pct"](t) == "50% (4/8)", ns["_rc_pct"](t))
check("G4 n<5 = 'za malo danych'", "za malo danych" in ns["_rc_pct"](rc([orow("fixed"), orow("dropped:false_positive")])["total"]))
multi = rc([orow("fixed", roles=("code", "ops")), orow("dropped:false_positive", roles=("ops",))])
check("G4 grupa wielorolowa liczona dla KAZDEJ roli", multi["by_role"]["code"]["fixed"] == 1 and multi["by_role"]["ops"]["fixed"] == 1 and multi["by_role"]["ops"]["false_positive"] == 1, str(multi["by_role"]))
check("G4 per rule_id", rc([orow("fixed", rule="A"), orow("fixed", rule="B")])["by_rule"].keys() == {"A", "B"})
lines = "\n".join(ns["review_outcome_lines"](rows + [orow("fixed", days_ago=60, run="stary")], now=NOW))
check("G4 wydruk: caly log + okno 30 dni, role i rule_id", "[caly log]" in lines and "[30 dni]" in lines and "rola code:" in lines and "rule_id R1:" in lines and "powody dropped:" in lines, lines)
all_line = next(ln for ln in lines.splitlines() if "[caly log]" in ln)
d30_line = next(ln for ln in lines.splitlines() if "[30 dni]" in ln)
check("G4 okno 30 dni pomija stary wiersz", "fixed=4" in all_line and "fixed=3" in d30_line, lines)
check("G4 pusty rejestr = informacja", "brak rejestru" in "\n".join(ns["review_outcome_lines"]([], now=NOW)))
check("read_jsonl pomija smieci", len(ns["read_jsonl"]('{"a":1}\nnie json\n[1,2]\n\n{"b":2}')) == 2)

# 10. guard_health.py: sekcje drukowane jako OSOBNE bloki po liscie info; RED/GREEN (exit) niezmienione
i_info = src.index('for i in info[:12]:')
i_g3 = src.index("ge.gate_effectiveness_lines(_ge_stats", i_info)
i_g4 = src.index("ge.review_outcome_lines(ge.read_jsonl", i_info)
i_exit = src.index("sys.exit(1 if red else 0)", i_info)
check("guard_health: bloki G3/G4 drukowane po liscie info i przed exit", i_info < i_g3 < i_g4 < i_exit)
check("guard_health: G3/G4 nie dopisuja do red/ok/info (tylko print)", not re.search(r"(red|ok|info)\.(append|extend|insert)\([^\n]*(gate_effectiveness|review_outcome)", src))
check("guard_health: migawka w katalogu logow gates.jsonl", 'GATES_LOG.parent / "gate-effectiveness.jsonl"' in src and 'GATES_LOG.parent / "review-outcomes.jsonl"' in src)

print("TESTY gate-effectiveness: " + ("wszystkie OK" if not fails else f"{len(fails)} FAIL"))
sys.exit(1 if fails else 0)

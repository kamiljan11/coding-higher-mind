"""Skutecznosc bramek git-hookow (G3) i wyniki recenzji (G4) — czyste funkcje, wolane z guard_health.py (jak lang_gap_health).

Fala 0 (pg/designs/2026-11-01-fala-0-pomiar.md §11.3-11.4). Tylko informacja — nie zmienia RED/GREEN guard_health.
Kontrakty z producentami (zmiana tam = zmiana tutaj; test: bin/test_gate_effectiveness.py):
- gates.jsonl `blocked` z polem `gate`  <- git-hooks/* (`pg_gate=NAZWA` + trap EXIT) przez hooks/lib/gate-log.js
- gates.jsonl `bypass` reason `ALLOW_X=` <- git-hooks/* (petla bypass na poczatku hooka)
- logs/review-outcomes.jsonl            <- bin/pg-outcome.js (pg-review krok 4)
"""
import json
import re
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path

GE_HOOKS = ("pre-commit", "pre-push", "commit-msg")
GE_GAP = timedelta(minutes=30)  # kolejny blocked tego samego klucza <= 30 min = ten sam incydent; bypass <= 30 min po ostatnim blocked
GE_DUP = timedelta(seconds=5)  # SECRET z pre-commit + commit-msg jednego commita = ten sam bypass
GE_MIN_N = 5
GE_NO_ALLOW = {"ESLINT", "TSC", "RUFF", "PYRIGHT", "OXLINT", "WORKFLOW_LINT", "SQL_LINT", "PG_WIRE", "HUSKY", "UNKNOWN"}  # bramki bez zmiennej ALLOW
_GE_BYPASS_RX = re.compile(r"^ALLOW_([A-Z0-9_]+)=")


def _ge_ts(e):
    try:
        t = datetime.fromisoformat(str(e["ts"]).replace("Z", "+00:00"))
    except (KeyError, ValueError, TypeError):
        return None
    return t.replace(tzinfo=timezone.utc) if t.tzinfo is None else t  # ts bez strefy = UTC (inaczej TypeError przy odejmowaniu)


def gate_tier_sets(overrides_text):
    """(SELF_SERVICE, SELF_APPROVABLE) z hooks/lib/overrides.js (regex, bez node). Brak/niesparsowane -> (None, None)."""
    sets = []
    for name in ("SELF_SERVICE", "SELF_APPROVABLE"):
        m = re.search(r"const " + name + r"\s*=\s*new Set\(\[(.*?)\]\)", overrides_text or "", re.DOTALL)
        sets.append({x for x in re.findall(r"'ALLOW_([A-Z0-9_]+)'", m.group(1))} if m else None)
    return (sets[0], sets[1]) if all(s is not None for s in sets) else (None, None)


def gate_tier_label(gate, sets, kill_switch=False):
    """Etykieta poziomu = tierOf('ALLOW_'+gate) z overrides.js: A/B/C; '-' bramka bez zmiennej ALLOW; '?' gdy nie umiemy odczytac zbiorow."""
    if gate in GE_NO_ALLOW:
        return "-"
    if sets[0] is None:
        return "?"
    if kill_switch:
        return "C"  # wylacznik self-approval.off: tierOf zwraca C dla wszystkiego (swiadomie jako etykieta)
    return "A" if gate in sets[0] else "B" if gate in sets[1] else "C"


def gate_effectiveness(events):
    """events: wpisy gates.jsonl (dict). Zwraca {gate: {hooks, incydenty, obejscie_po_blokadzie, bez_obejscia, obejscie_bez_blokady}}.
    Algorytm: design §11.3 (incydent = (hook, gate, target) z oknem 30 min; bypass ALLOW_X=v konsumuje najstarszy otwarty incydent)."""
    evs = []
    for e in events:
        if not isinstance(e, dict) or e.get("hook") not in GE_HOOKS or e.get("origin") in ("test", "tmp"):
            continue
        t = _ge_ts(e)
        if t is not None:
            evs.append((t, e))
    evs.sort(key=lambda p: p[0])
    # Jeden przebieg w kolejnosci czasu: blocked po bypassie zaczyna NOWY incydent, nawet w oknie 30 min
    # (recenzja p345 code-1: dwa przebiegi doklejaly blocked do incydentu juz zamknietego bypassem).
    incidents = []  # {gate, hook, target, start, last, closed}
    open_by_key = {}
    stats = {}

    def row(gate):
        return stats.setdefault(gate, {"hooks": set(), "incydenty": 0, "obejscie_po_blokadzie": 0, "bez_obejscia": 0, "obejscie_bez_blokady": 0})

    last_counted = {}  # (gate, target) -> ts ostatniego policzonego bypassu (duplikaty <= 5 s pomijamy)
    for t, e in evs:
        if e.get("event") == "blocked" and e.get("gate"):
            key = (e["hook"], e["gate"], e.get("target"))
            cur = open_by_key.get(key)
            if cur and not cur["closed"] and t - cur["last"] <= GE_GAP:
                cur["last"] = t
            else:
                cur = {"gate": e["gate"], "hook": e["hook"], "target": e.get("target"), "start": t, "last": t, "closed": False}
                incidents.append(cur)
                open_by_key[key] = cur
                row(cur["gate"])["hooks"].add(cur["hook"])
                row(cur["gate"])["incydenty"] += 1
            continue
        if e.get("event") != "bypass":
            continue
        m = _GE_BYPASS_RX.match(str(e.get("reason") or ""))
        if not m:
            continue  # np. `main -> ...` (pg_main_ok) to nie zmienna ALLOW
        gate, target = m.group(1), e.get("target")
        cands = [i for i in incidents if i["gate"] == gate and i["target"] == target and not i["closed"] and i["start"] <= t <= i["last"] + GE_GAP]
        if cands:
            min(cands, key=lambda i: i["start"])["closed"] = True
            row(gate)["obejscie_po_blokadzie"] += 1
            last_counted[(gate, target)] = t
            continue
        prev = last_counted.get((gate, target))
        if prev is not None and abs(t - prev) <= GE_DUP:
            continue  # duplikat (drugi hook tego samego commita)
        last_counted[(gate, target)] = t
        row(gate)["obejscie_bez_blokady"] += 1
        row(gate)["hooks"].add(e["hook"])
    for s in stats.values():
        s["bez_obejscia"] = s["incydenty"] - s["obejscie_po_blokadzie"]
    return stats


def gate_effectiveness_lines(stats, sets, kill_switch=False):
    head = ["SKUTECZNOSC BRAMEK (git-hooki pre-commit|pre-push|commit-msg, okno 7 dni, bez origin test/tmp)",
            "  obejscie po blokadzie = sygnal do ZBADANIA (Tricorder: nieprzydatne wg czlowieka), nie werdykt;",
            "  obejscie bez blokady moze znaczyc, ze agent wiedzial, ze bramka zadziala. Bramka z n>=10 i obejscie_bez_blokady > 50% -> przeglad reczny."]
    if not stats:
        return head + ["  brak danych: 0 wpisow blocked z polem gate (git-hooki logujace gate dzialaja od Fali 0) ani bypassow ALLOW_*"]
    out = head + ["  bramka | hook | poziom | incydenty | obejscie_po_blokadzie | bez_obejscia | obejscie_bez_blokady | % obejsc po blokadzie"]
    for gate, s in sorted(stats.items(), key=lambda kv: (-kv[1]["incydenty"], -kv[1]["obejscie_bez_blokady"], kv[0])):
        pct = f"{round(100 * s['obejscie_po_blokadzie'] / s['incydenty'])}%" if s["incydenty"] >= GE_MIN_N else "n<5"
        out.append(f"  {gate} | {'+'.join(sorted(s['hooks'])) or '-'} | {gate_tier_label(gate, sets, kill_switch)} | {s['incydenty']} | "
                   f"{s['obejscie_po_blokadzie']} | {s['bez_obejscia']} | {s['obejscie_bez_blokady']} | {pct}")
    return out


def gate_snapshot_rows(stats, ts, window_days=7):
    """Po 1 wierszu per bramka do logs/gate-effectiveness.jsonl (rotacja gates.jsonl ~11 dni nie ogranicza historii).
    window_days = okno zdarzen, z ktorego policzono stats (GATES_WINDOW_DAYS) — historia porownywalna po zmianie okna."""
    return [{"ts": ts, "window_days": window_days, "gate": g, "hook": "+".join(sorted(s["hooks"])) or "-", "incydenty": s["incydenty"],
             "obejscie_po_blokadzie": s["obejscie_po_blokadzie"], "bez_obejscia": s["bez_obejscia"],
             "obejscie_bez_blokady": s["obejscie_bez_blokady"]} for g, s in sorted(stats.items())]


def append_gate_snapshot(path, stats, ts, window_days=7):
    """Dopisz migawke (append), najwyzej jedna na dzien UTC (task + reczne przebiegi tego samego dnia; okna i tak sie nakladaja,
    wiec wierszy z roznych dni nie sumowac). Zwraca liczbe dopisanych wierszy; blad zapisu = wyjatek (wolajacy decyduje)."""
    rows = gate_snapshot_rows(stats, ts, window_days)
    path = Path(path)
    old = path.read_text(encoding="utf-8") if path.exists() else ""
    if rows and any(str(r.get("ts", ""))[:10] == str(ts)[:10] for r in read_jsonl(old)):
        return 0
    if rows:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as f:
            f.write(("\n" if old and not old.endswith("\n") else "") + "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows))
    return len(rows)


def review_counts(rows):
    """Liczniki wynikow recenzji dla listy wierszy review-outcomes.jsonl. Grupa liczy sie dla KAZDEJ roli z `roles`."""
    def blank():
        return {"fixed": 0, "false_positive": 0, "dropped_other": 0, "kept_note": 0, "verifier_dropped": 0}

    def bump(c, outcome):
        if outcome == "fixed":
            c["fixed"] += 1
        elif outcome == "dropped:false_positive":
            c["false_positive"] += 1
        elif str(outcome).startswith("dropped:"):
            c["dropped_other"] += 1
        elif outcome in ("kept_note", "verifier_dropped"):
            c[outcome] += 1

    total, by_role, by_rule, reasons = blank(), {}, {}, Counter()
    for r in rows:
        outcome = r.get("outcome")
        bump(total, outcome)
        if str(outcome).startswith("dropped:"):
            reasons[outcome] += 1
        for role in (r.get("roles") if isinstance(r.get("roles"), list) else []):
            bump(by_role.setdefault(str(role), blank()), outcome)
        bump(by_rule.setdefault(str(r.get("rule_id") or "?"), blank()), outcome)
    return {"total": total, "by_role": by_role, "by_rule": by_rule, "reasons": reasons}


# verifier_dropped (weryfikator nie odtworzyl findingu) = falszywy alarm dzialu: w liczniku i mianowniku (decyzja 2026-11-01,
# pg-review p345g data-1: bez tego szum dzialu zanizony wzgledem celu Tricorder < 10 %). kept_note poza ulamkiem (brak werdyktu).
def _rc_n(c):
    return c["fixed"] + c["false_positive"] + c["dropped_other"] + c["verifier_dropped"]


def _rc_pct(c):
    n, bad = _rc_n(c), c["false_positive"] + c["verifier_dropped"]
    return f"{round(100 * bad / n)}% ({bad}/{n})" if n >= GE_MIN_N else f"za malo danych (n={n}<{GE_MIN_N})"


def review_outcome_lines(rows, now=None):
    now = now or datetime.now(timezone.utc)
    head = ["WYNIKI RECENZJI (logs/review-outcomes.jsonl)",
            "  nieprzydatne = (dropped:false_positive + verifier_dropped) / (fixed + wszystkie dropped:* + verifier_dropped); kept_note poza ulamkiem; n<5 = za malo danych"]
    if not rows:
        return head + ["  brak rejestru: pg-outcome.js jeszcze nie uzyty (pg-review krok 4)"]
    recent = []
    for r in rows:
        t = _ge_ts(r)
        if t is not None and now - t <= timedelta(days=30):
            recent.append(r)
    out = head + [f"  przebiegow (run_key): {len({r.get('run_key') for r in rows})}, grup: {len(rows)}; ostatnie 30 dni: {len({r.get('run_key') for r in recent})} przebiegow, {len(recent)} grup"]
    for label, subset in (("caly log", rows), ("30 dni", recent)):
        rc = review_counts(subset)
        t = rc["total"]
        out.append(f"  [{label}] nieprzydatne: {_rc_pct(t)}; fixed={t['fixed']} dropped={t['false_positive'] + t['dropped_other']} "
                   f"kept_note={t['kept_note']} verifier_dropped={t['verifier_dropped']}")
        if rc["reasons"]:
            out.append("    powody dropped: " + ", ".join(f"{k.split(':', 1)[1]}={v}" for k, v in sorted(rc["reasons"].items())))
        for role, c in sorted(rc["by_role"].items()):
            out.append(f"    rola {role}: {_rc_pct(c)}")
        for rule, c in sorted(rc["by_rule"].items(), key=lambda kv: (-_rc_n(kv[1]), kv[0]))[:10]:
            out.append(f"    rule_id {rule}: {_rc_pct(c)}")
    return out


def read_jsonl(text):
    out = []
    for ln in (text or "").splitlines():
        try:
            d = json.loads(ln)
        except ValueError:
            continue
        if isinstance(d, dict):
            out.append(d)
    return out

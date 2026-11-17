"""Petla uzycia: tygodniowa lista kandydatow do zmiany regul PG liczona z danych, ktore PG juz zapisuje (0 tokenow).

Czyste funkcje wolane z guard_health.py (jak gate_effectiveness). Tylko informacja: nic nie blokuje, nie zmienia
RED/GREEN i niczego nie usuwa; kazda zmiana reguly idzie dalej zwykla droga (galaz, pg-review, fraza wlasciciela).
Projekt: pg/adr/0013. Trzy ruchy z progami w pg/usage-loop.json (dane, nie kod):
- martwa regula: klucz reguly widziany wczesniej, 0 odpalen w ostatnich `dead_weeks` migawkach tygodniowych,
- glosna bramka: recenzent z udzialem nieprzydatnych findings ponad prog; git-hook obchodzony po blokadzie ponad prog,
- powtarzajacy sie finding: to samo rule_id naprawione >= N razy w oknie w >= M repo (kandydat do pg-prechecks.js).
Czwarty ruch (incydent -> blizna) zostaje w `bin/pg-cases.js --stats`.

Kontrakty z producentami (zmiana tam = zmiana tutaj; test: bin/test_usage_loop.py):
- gates.jsonl: pola ts, hook, event (blocked | would_block = odpalenie), reason, opcjonalnie gate, origin
- logs/review-outcomes.jsonl: pola ts, repo, roles, rule_id, outcome  <- bin/pg-outcome.js
- statystyki G3: slownik z gate_effectiveness.gate_effectiveness()
Historia: logs/usage-loop.jsonl, jedna migawka na tydzien (gates.jsonl rotuje po ok. 11 dniach, wiec okno 6 tygodni
da sie policzyc tylko z migawek). Za krotka historia = wiersz "za malo danych (n=...)", nigdy zero.
"""
import json
import re
from collections import Counter
from datetime import datetime, timedelta, timezone
from itertools import pairwise
from pathlib import Path

FIRE_EVENTS = ("blocked", "would_block")
SKIP_ORIGINS = ("test", "tmp")
BAD_OUTCOMES = ("dropped:false_positive", "verifier_dropped")
DEFAULTS = {
    "dead_weeks": 6,
    "dead_min_active_days": 20,
    "safety_prefixes": ["bash-guard|rule:rm", "bash-guard|rule:secret", "bash-guard|rule:pr-merge", "bash-guard|override-required"],
    "noisy_reviewer_pct": 30,
    "noisy_reviewer_min_n": 10,
    "noisy_hook_pct": 50,
    "noisy_hook_min_n": 10,
    "recurring_fixed_min": 10,
    "recurring_min_repos": 2,
    "recurring_window_days": 28,
    "max_candidates": 5,
    "decisions": {},
}
DECISION_WORDS = ("accepted", "rejected")  # decyzja wlasciciela: {"<id kandydata>": "accepted 2026-11-20: co zrobiono"}
SNAPSHOT_MAX_GAP_DAYS = 10  # wieksza dziura miedzy migawkami (laptop wylaczony) = "za malo danych" dla martwych regul


def _ts(e):
    try:
        t = datetime.fromisoformat(str(e["ts"]).replace("Z", "+00:00"))
    except (KeyError, ValueError, TypeError):
        return None
    return t.replace(tzinfo=timezone.utc) if t.tzinfo is None else t


def read_jsonl(text):
    out = []
    for line in (text or "").splitlines():
        try:
            row = json.loads(line)
        except ValueError:
            continue
        if isinstance(row, dict):
            out.append(row)
    return out


def load_thresholds(text):
    """(progi, problemy). Brak pliku albo zly wpis = wartosc domyslna i wpis w problemach (raport ma to pokazac, nie ukryc)."""
    thr, problems = dict(DEFAULTS), []
    if not (text or "").strip():
        return thr, ["brak pg/usage-loop.json: progi domyslne"]
    try:
        data = json.loads(text)
    except ValueError as e:
        return thr, [f"pg/usage-loop.json nie jest JSON-em ({e}): progi domyslne"]
    if not isinstance(data, dict):
        return thr, ["pg/usage-loop.json: oczekiwany obiekt: progi domyslne"]
    for key, default in DEFAULTS.items():
        if key not in data:
            continue
        value = data[key]
        if isinstance(default, list):
            ok = isinstance(value, list) and all(isinstance(x, str) for x in value)
        elif isinstance(default, dict):
            ok = isinstance(value, dict) and all(isinstance(v, str) and v.split(" ", 1)[0].rstrip(":") in DECISION_WORDS for v in value.values())
        else:
            ok = isinstance(value, int) and not isinstance(value, bool) and value >= 1
        if ok:
            thr[key] = value
        elif isinstance(default, dict) and isinstance(value, dict):  # jeden zly wpis nie kasuje pozostalych decyzji
            good = {k: v for k, v in value.items() if isinstance(v, str) and v.split(" ", 1)[0].rstrip(":") in DECISION_WORDS}
            thr[key] = good
            bad = sorted(str(k) for k in value if k not in good)
            problems.append(f"pg/usage-loop.json: `{key}`: wpis musi zaczynac sie od {' albo '.join(DECISION_WORDS)}; pominiete: {', '.join(bad)}")
        else:
            problems.append(f"pg/usage-loop.json: `{key}` ma zly typ albo wartosc < 1: uzyto {default}")
    return thr, problems


def rule_key(e):
    """Stabilny klucz reguly z wpisu gates.jsonl: `hook|GATE`, a bez pola gate `hook|poczatek powodu` (bez szczegolow przypadku)."""
    hook = str(e.get("hook") or "?")
    if e.get("gate"):
        return f"{hook}|{e['gate']}"
    reason = str(e.get("reason") or "").strip()
    head = re.split(r": | \(|\"", reason, maxsplit=1)[0]
    return f"{hook}|{re.sub(r'[0-9]+', 'N', head)[:40].strip()}"


def snapshot(events, outcomes, now, window_days=7):
    """Migawka tygodnia: odpalenia per klucz reguly i dni z aktywnoscia w oknie (bez origin test/tmp)."""
    since = now - timedelta(days=window_days)
    rules, days, n = Counter(), set(), 0
    for e in events:
        t = _ts(e) if isinstance(e, dict) else None
        if t is None or t < since or t > now or e.get("origin") in SKIP_ORIGINS:
            continue
        n += 1
        days.add(t.date().isoformat())
        if e.get("event") in FIRE_EVENTS:
            rules[rule_key(e)] += 1
    return {"ts": now.isoformat(), "window_days": window_days, "events": n, "active_days": len(days),
            "rules": dict(sorted(rules.items())), "outcomes": len(outcomes)}


def append_snapshot(path, snap, min_gap_days=6):
    """Dopisz migawke, gdy poprzednia jest starsza niz min_gap_days (okna 7 dni nie moga sie nakladac, bo migawki sa sumowane).
    Zwraca True, gdy dopisano. Blad zapisu = wyjatek (wolajacy decyduje)."""
    path = Path(path)
    old = path.read_text(encoding="utf-8") if path.exists() else ""
    last = [t for t in (_ts(r) for r in read_jsonl(old)) if t is not None]
    now = _ts(snap)
    if now is None or (last and now - max(last) < timedelta(days=min_gap_days)):
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(("\n" if old and not old.endswith("\n") else "") + json.dumps(snap, ensure_ascii=False) + "\n")
    return True


def dead_rules(history, thr):
    """(lista kluczy | None, opis). None = za malo danych. Regula, ktora NIGDY sie nie odpalila, nie ma klucza w logu,
    wiec tu jej nie bedzie: te pokrywa bin/pg-eval.js (przypadki wzorcowe)."""
    weeks = thr["dead_weeks"]
    if len(history) < weeks + 1:
        return None, f"za malo danych (n={len(history)} migawek tygodniowych, potrzeba {weeks + 1})"
    recent = history[-weeks:]
    # Migawka powstaje tylko, gdy guard_health sie uruchomi; dziura (laptop wylaczony) ukrywa odpalenia z tego czasu.
    stamps = [t for t in (_ts(r) for r in history[-weeks - 1:]) if t is not None]
    gap = max(((b - a).days for a, b in pairwise(stamps)), default=0)
    if len(stamps) < weeks + 1 or gap > SNAPSHOT_MAX_GAP_DAYS:
        return None, f"za malo danych (dziura {gap} dni miedzy migawkami albo migawka bez czasu; dopuszczalne {SNAPSHOT_MAX_GAP_DAYS})"
    active = sum(int(r.get("active_days") or 0) for r in recent)
    if active < thr["dead_min_active_days"]:
        return None, f"za malo danych (n={active} dni z aktywnoscia w {weeks} tyg., potrzeba {thr['dead_min_active_days']})"
    fired = {k for r in recent for k, v in (r.get("rules") or {}).items() if v}
    known = {k for r in history[:-weeks] for k, v in (r.get("rules") or {}).items() if v}
    dead = sorted(k for k in known - fired if not any(k.startswith(p) for p in thr["safety_prefixes"]))
    return dead, f"{len(dead)} z {len(known)} znanych kluczy bez odpalenia w {weeks} tyg. (bezpieczniki pominiete)"


def noisy_reviewers(outcomes, now, thr):
    """[(rola, procent, zle, n)] dla rol ponad progiem w oknie recurring_window_days; wzor G4 (kept_note poza ulamkiem)."""
    since = now - timedelta(days=thr["recurring_window_days"])
    n, bad = Counter(), Counter()
    for r in outcomes:
        t = _ts(r)
        outcome = str(r.get("outcome") or "")
        if t is None or t < since or not (outcome == "fixed" or outcome.startswith("dropped:") or outcome == "verifier_dropped"):
            continue
        for role in (r.get("roles") if isinstance(r.get("roles"), list) else []):
            n[str(role)] += 1
            bad[str(role)] += outcome in BAD_OUTCOMES
    out = [(role, round(100 * bad[role] / total), bad[role], total) for role, total in n.items()
           if total >= thr["noisy_reviewer_min_n"] and 100 * bad[role] > thr["noisy_reviewer_pct"] * total]
    return sorted(out, key=lambda x: (-x[1], x[0]))


def noisy_hooks(ge_stats, thr):
    """[(bramka, procent, obejscia, incydenty)] z statystyk G3 (okno guard_health): obejscie po blokadzie ponad progiem."""
    out = []
    for gate, s in (ge_stats or {}).items():
        inc, byp = int(s.get("incydenty") or 0), int(s.get("obejscie_po_blokadzie") or 0)
        if inc >= thr["noisy_hook_min_n"] and 100 * byp > thr["noisy_hook_pct"] * inc:
            out.append((str(gate), round(100 * byp / inc), byp, inc))
    return sorted(out, key=lambda x: (-x[1], x[0]))


def recurring_findings(outcomes, now, thr):
    """[(rule_id, naprawione, repo)] naprawione >= prog razy w oknie w >= prog repo."""
    since = now - timedelta(days=thr["recurring_window_days"])
    n, repos = Counter(), {}
    for r in outcomes:
        t = _ts(r)
        if t is None or t < since or r.get("outcome") != "fixed" or not r.get("rule_id"):
            continue
        rule = str(r["rule_id"])
        n[rule] += 1
        repos.setdefault(rule, set()).add(str(r.get("repo") or "?"))
    out = [(rule, count, len(repos[rule])) for rule, count in n.items()
           if count >= thr["recurring_fixed_min"] and len(repos[rule]) >= thr["recurring_min_repos"]]
    return sorted(out, key=lambda x: (-x[1], x[0]))


def candidates(history, outcomes, ge_stats, now, thr):
    """(kandydaci, opis martwych). Kandydat = {id, text, cmd}; kolejnosc: glosne, powtarzajace sie, martwe."""
    out = []
    for gate, pct, byp, inc in noisy_hooks(ge_stats, thr):
        out.append({"id": f"noisy-hook:{gate}", "text": f"glosna bramka {gate}: obejscie po blokadzie {pct}% ({byp}/{inc}) -> observe albo zawezic wzorzec",
                    "cmd": "python3 ~/.claude/hooks/guard_health.py | grep -A12 'SKUTECZNOSC BRAMEK'"})
    for role, pct, bad, n in noisy_reviewers(outcomes, now, thr):
        out.append({"id": f"noisy-reviewer:{role}", "text": f"glosny recenzent {role}: nieprzydatne {pct}% ({bad}/{n}) w {thr['recurring_window_days']} dni -> przejrzec rubryke",
                    "cmd": f"grep -c '\"{role}\"' ~/.claude/logs/review-outcomes.jsonl"})
    for rule, count, repos in recurring_findings(outcomes, now, thr):
        out.append({"id": f"recurring:{rule}", "text": f"powtarzajacy sie finding {rule}: naprawiony {count}x w {repos} repo w {thr['recurring_window_days']} dni -> regula w bin/pg-prechecks.js",
                    "cmd": f"grep -c '\"rule_id\": *\"{rule}\"' ~/.claude/logs/review-outcomes.jsonl"})
    dead, dead_note = dead_rules(history, thr)
    for key in dead or []:
        out.append({"id": f"dead:{key}", "text": f"martwa regula {key}: 0 odpalen w {thr['dead_weeks']} tyg. -> usunac albo poprawic wzorzec",
                    "cmd": "grep -cF '" + json.dumps(key, ensure_ascii=False).replace("'", "'\\''") + "' ~/.claude/logs/usage-loop.jsonl"})
    return out, dead_note


def report(history, outcomes, ge_stats, now, thr, problems=()):
    """Linie raportu. Kandydat z decyzja wlasciciela (`decisions` w pliku progow) znika z listy; kandydat bez decyzji
    wraca co tydzien, az wlasciciel wpisze `accepted` albo `rejected` (jedna linia JSON)."""
    cands, dead_note = candidates(history, outcomes, ge_stats, now, thr)
    decisions = thr["decisions"]
    undecided = [c for c in cands if c["id"] not in decisions]
    shown = undecided[:thr["max_candidates"]]
    verdicts = Counter(v.split(" ", 1)[0].rstrip(":") for v in decisions.values())
    lines = ["PETLA UZYCIA (kandydaci do zmiany regul; tylko propozycje, decyzja wlasciciela; progi i decyzje: pg/usage-loop.json)"]
    lines += [f"  [warn] {p}" for p in problems]
    lines.append(f"  martwe reguly: {dead_note}")
    lines.append(f"  decyzje wlasciciela: przyjete {verdicts['accepted']}, odrzucone {verdicts['rejected']}")
    lines.append(f"  kandydaci: {len(cands)}, z decyzja: {len(cands) - len(undecided)}, pokazani: {len(shown)}")
    for c in shown:
        lines.append(f"  - {c['text']} | id: {c['id']} | dowod: {c['cmd']}")
    if not cands:
        lines.append("  brak kandydatow ponad progami")
    return lines

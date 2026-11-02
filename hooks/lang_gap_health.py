"""Ocena luk jezykowych z telemetrii gates.jsonl (ADR-0010) — czyste funkcje, wolane z guard_health.py.

Kontrakty z producentami zdarzen (zmiana tekstu tam = zmiana tutaj; test: bin/test_lang_gap_health.py):
- `skipped` "no checker for .ext"      <- hooks/lib/lint-file.js (kod w jezyku bez sprawdzacza)
- `skipped` "tool missing: <narzedzie>" <- hooks/lib/lang-checkers.js exec()
- `would_block` UNUSED_EXPORT_REASON    <- bin/unused-export-gate.js (observe, pole `count`)
"""
from collections import Counter

NO_CHECKER_PREFIX = "no checker for "
TOOL_MISSING_PREFIX = "tool missing: "
UNUSED_EXPORT_REASON = "unused-export: nowe definicje bez uzycia"
NO_CHECKER_RED_FILES = 3  # roznych plikow w jezyku bez sprawdzacza w oknie -> RED; 1-2 = info (post-edit + stop-gate loguja plik 2x)


def evaluate(events, lang_tools, which, window_days, unchecked_exts=None):
    """events: zdarzenia z okna (bez `redirected`); lang_tools: {jezyk: [narzedzia]}; which: shutil.which;
    unchecked_exts: rozszerzenia NADAL bez sprawdzacza (NO_CHECKER_EXTS z lang-checkers.js; None = wszystkie z okna).

    Zwraca (checks, infos): checks = [(nazwa, ok, detail)], infos = [tekst]."""
    tools = {t for ts in lang_tools.values() for t in ts}
    gap: dict = {}
    missing: Counter = Counter()
    unused_pushes: set = set()  # (repo, head): ten sam commit pushowany 2x = 1 ostrzezenie (pg-review data r2)
    unused_defs: set = set()  # (repo, plik:nazwa): base...HEAD jest kumulatywne — kolejny push galezi nie liczy tych samych definicji (data r3)
    legacy_defs = 0  # zdarzenia bez `items` (stary format): tylko `count`
    overflow: dict = {}  # repo -> max nadwyzki ponad zapisane `items` (gate zapisuje max 20 pozycji)
    for e in events:
        reason = e.get("reason") or ""
        if e.get("event") == "skipped" and reason.startswith(NO_CHECKER_PREFIX):
            gap.setdefault(reason[len(NO_CHECKER_PREFIX):], set()).add(e.get("target") or "?")
        elif e.get("event") == "skipped" and reason.startswith(TOOL_MISSING_PREFIX) and reason[len(TOOL_MISSING_PREFIX):] in tools:
            missing[reason[len(TOOL_MISSING_PREFIX):]] += 1
        elif e.get("event") == "would_block" and reason == UNUSED_EXPORT_REASON:
            try:
                n = int(e.get("count") or 0)
            except (TypeError, ValueError):
                n = 0
            repo = e.get("target") or "?"
            unused_pushes.add((repo, e.get("head") or e.get("ts") or id(e)))  # bez head (stary wpis) = osobne zdarzenie
            items = e.get("items") if isinstance(e.get("items"), list) else []
            if items:
                unused_defs.update((repo, str(i)) for i in items)
                # base...HEAD jest kumulatywne -> nadwyzka to MAX per repo, nie suma zdarzen (ten sam push 2x = 1x, data r5)
                overflow[repo] = max(overflow.get(repo, 0), n - len(items))
            else:
                legacy_defs += n
    checks = []
    infos = []
    files = {ext: len(fs) for ext, fs in gap.items()}
    # Rozszerzenie, ktore dostalo sprawdzacz, nie jest juz luka — stare skipy z okna nie trzymaja RED (pg-review data r2).
    red = {ext: n for ext, n in files.items() if n >= NO_CHECKER_RED_FILES and (unchecked_exts is None or ext in unchecked_exts)}
    if files and not red and any(unchecked_exts is None or ext in unchecked_exts for ext in files):
        infos.append("kod bez sprawdzacza (ponizej progu): " + ", ".join(f"{ext}: {n} plik" for ext, n in sorted(files.items())))
    checks.append((f"kod bez sprawdzacza ({window_days} dni, >= {NO_CHECKER_RED_FILES} pliki)", not red,
                   ", ".join(f"{ext}: {n} plikow" for ext, n in sorted(red.items(), key=lambda kv: -kv[1]))
                   + " — dodaj sprawdzacz (pg/design.md › F.10)"))
    # RED tylko, gdy narzedzia NADAL brak — po instalacji alarm znika od razu, nie po 7 dniach (pg-review data r2).
    still = {t: n for t, n in missing.items() if not which(t)}
    fixed = sorted(t for t in missing if t not in still)
    if fixed:
        infos.append("sprawdzacz jezyka: narzedzie doinstalowane po skipie w oknie: " + ", ".join(fixed))
    checks.append((f"sprawdzacz jezyka bez narzedzia ({window_days} dni)", not still,
                   ", ".join(f"{t}: {n}x" for t, n in sorted(still.items()))
                   + " — kod w tym jezyku nie byl sprawdzony; zainstaluj narzedzie (weryfikacja zrodla)"))
    if unused_pushes:
        infos.append(f"unused-export-gate (observe, ADR-0010, przeglad 2026-11-23): {len(unused_pushes)} pushy z ostrzezeniem, "
                     f"{len(unused_defs) + legacy_defs + sum(overflow.values())} roznych definicji — ocen trafnosc przed decyzja o blokadzie")
    return checks, infos

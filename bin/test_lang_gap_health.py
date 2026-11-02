#!/usr/bin/env python3
"""Testy hooks/lang_gap_health.py (progi guard_health dla luk jezykowych, ADR-0010) + kontrakt tekstow z producentami.
Uruchom: python3 ~/.claude/bin/test_lang_gap_health.py"""
import importlib.util
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
_spec = importlib.util.spec_from_file_location("lang_gap_health", ROOT / "hooks" / "lang_gap_health.py")
assert _spec is not None and _spec.loader is not None, "brak hooks/lang_gap_health.py"
lg = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(lg)

TOOLS = {"go": ["go", "gofmt"], "php": ["php"]}
none_installed = lambda t: None
all_installed = lambda t: "/usr/bin/" + t


def skip(reason, target):
    return {"event": "skipped", "reason": reason, "target": target}


def by_name(checks, prefix):
    return next(c for c in checks if c[0].startswith(prefix))


n = 0
# 1. ten sam plik 2x (post-edit + stop-gate) i 2 rozne pliki = ponizej progu -> info, nie RED
ev = [skip("no checker for .kt", "/r/A.kt"), skip("no checker for .kt", "/r/A.kt"), skip("no checker for .kt", "/r/B.kt")]
checks, infos = lg.evaluate(ev, TOOLS, none_installed, 7)
assert by_name(checks, "kod bez sprawdzacza")[1] is True
assert any(".kt: 2 plik" in i for i in infos), infos
n += 1
# 2. 3 rozne pliki -> RED
checks, _ = lg.evaluate(ev + [skip("no checker for .kt", "/r/C.kt")], TOOLS, none_installed, 7)
ok, detail = by_name(checks, "kod bez sprawdzacza")[1:]
assert ok is False and ".kt: 3 plikow" in detail, detail
n += 1
# 3. tool missing: RED tylko dla narzedzia z TOOLS, ktorego NADAL brak; po instalacji -> info
ev = [skip("tool missing: php", "/r"), skip("tool missing: eslint", "/r")]
checks, _ = lg.evaluate(ev, TOOLS, none_installed, 7)
ok, detail = by_name(checks, "sprawdzacz jezyka bez narzedzia")[1:]
assert ok is False and "php: 1x" in detail and "eslint" not in detail, detail
checks, infos = lg.evaluate(ev, TOOLS, all_installed, 7)
assert by_name(checks, "sprawdzacz jezyka bez narzedzia")[1] is True
assert any("doinstalowane" in i and "php" in i for i in infos), infos
n += 1
# 4. unused-export-gate: licznik pushy i definicji w info (miara przegladu ADR-0010); stary format bez items/head -> `count`
ev = [{"event": "would_block", "reason": lg.UNUSED_EXPORT_REASON, "count": 2, "ts": "t1"}, {"event": "would_block", "reason": lg.UNUSED_EXPORT_REASON, "count": "x", "ts": "t2"}]
_, infos = lg.evaluate(ev, TOOLS, none_installed, 7)
assert any("2 pushy" in i and "2 roznych definicji" in i for i in infos), infos
n += 1
# 4b. ten sam commit 2x = 1 push; kolejny commit galezi (base...HEAD kumulatywne) z ta sama definicja + nowa = 2 rozne definicje
wb = {"event": "would_block", "reason": lg.UNUSED_EXPORT_REASON, "target": "/r"}
ev = [dict(wb, count=1, head="abc", items=["a.ts:foo"])] * 2 + [dict(wb, count=2, head="def", items=["a.ts:foo", "b.ts:bar"])]
_, infos = lg.evaluate(ev, TOOLS, none_installed, 7)
assert any("2 pushy" in i and "2 roznych definicji" in i for i in infos), infos
n += 1
# 4b2. push z > 20 definicjami: items obciete do 20, nadwyzka liczona z count
ev = [dict(wb, count=30, head="ghi", items=[f"f.ts:x{i}" for i in range(20)])]
_, infos = lg.evaluate(ev, TOOLS, none_installed, 7)
assert any("30 roznych definicji" in i for i in infos), infos
# ten sam push 2x i kolejny push galezi (31, te same 20 items) -> 31, nie 40/41 (data r5)
_, infos = lg.evaluate(ev * 2 + [dict(wb, count=31, head="jkl", items=[f"f.ts:x{i}" for i in range(20)])], TOOLS, none_installed, 7)
assert any("2 pushy" in i and "31 roznych definicji" in i for i in infos), infos
n += 1
# 4c. rozszerzenie, ktore dostalo sprawdzacz, nie trzyma RED mimo starych skipow w oknie
ev = [skip("no checker for .kt", f"/r/{c}.kt") for c in "ABC"]
checks, infos = lg.evaluate(ev, TOOLS, none_installed, 7, unchecked_exts={".swift"})
assert by_name(checks, "kod bez sprawdzacza")[1] is True and not infos, (checks, infos)
assert by_name(lg.evaluate(ev, TOOLS, none_installed, 7, unchecked_exts={".kt"})[0], "kod bez sprawdzacza")[1] is False
n += 1
# 5. kontrakt: producenci zdarzen nadal pisza te same teksty (rozjazd = alarm po cichu martwy)
lint = (ROOT / "hooks" / "lib" / "lint-file.js").read_text(encoding="utf-8")
langs = (ROOT / "hooks" / "lib" / "lang-checkers.js").read_text(encoding="utf-8")
gate = (ROOT / "bin" / "unused-export-gate.js").read_text(encoding="utf-8")
assert "`" + lg.NO_CHECKER_PREFIX + "${" in lint, "lint-file.js nie loguje juz 'no checker for .ext'"
assert "`" + lg.TOOL_MISSING_PREFIX + "${tool}`" in langs, "lang-checkers.js nie loguje juz 'tool missing: X'"
assert "'" + lg.UNUSED_EXPORT_REASON + "'" in gate, "unused-export-gate.js zmienil powod would_block"
n += 1
print(f"test_lang_gap_health: {n} OK")

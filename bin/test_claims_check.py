"""Testy bin/claims-check.py: kotwica (src: ...) = kazda liczba z linii musi byc w zrodle; bez kotwicy = tylko licznik."""
import atexit
import importlib.util
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("claims_check", os.path.join(HERE, "claims-check.py"))
assert spec is not None and spec.loader is not None, "brak bin/claims-check.py"
cc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cc)
_TMPS: list[str] = []


def mkdtemp(prefix: str) -> str:
    """Katalog fikstury sprzatany na koncu przebiegu — test jest w baterii guard_health (r13 ops: /tmp rosl co przebieg)."""
    d = tempfile.mkdtemp(prefix=prefix)
    _TMPS.append(d)
    return d


atexit.register(lambda: [shutil.rmtree(d, ignore_errors=True) for d in _TMPS])
fails = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else f" :: {detail}"))
    if not ok:
        fails.append(name)


def make_root(claude_md: str) -> str:
    root = mkdtemp(prefix="pg-claims-")
    os.makedirs(os.path.join(root, "hooks", "lib"))
    os.makedirs(os.path.join(root, "pg"))
    with open(os.path.join(root, "hooks", "lib", "overrides.js"), "w", encoding="utf-8") as fh:
        fh.write("const P = {\n  ALLOW_CONTROL_PLANE: { ttlMin: 60, uses: 200 },\n  default: { ttlMin: 30, uses: 3 },\n};\n")
    with open(os.path.join(root, "CLAUDE.md"), "w", encoding="utf-8") as fh:
        fh.write(claude_md)
    return root


res = cc.check(make_root("- fraza: 30 min / 3 uzycia; CONTROL_PLANE 60 min / 200 uzyc (src: hooks/lib/overrides.js)\n"))
check("zgodne liczby z kotwica = 0 rozjazdow", res["mismatches"] == [] and res["anchored"] == 1, str(res))

res = cc.check(make_root("- 30 min / 3 uzycia (src: hooks/lib/overrides.js#default:); CONTROL_PLANE 60 min / 200 uzyc (src: hooks/lib/overrides.js#ALLOW_CONTROL_PLANE:)\n"))
check("dwa twierdzenia, dwie kotwice z kluczem = zgodne", res["mismatches"] == [] and res["anchored"] == 2, str(res))

res = cc.check(make_root("- CONTROL_PLANE 60 min / 3 uzycia (src: hooks/lib/overrides.js#ALLOW_CONTROL_PLANE:)\n"))
check("zla para z kluczem (3 zamiast 200) = rozjazd (r6 ops: pula pliku dawala zielone)", len(res["mismatches"]) == 1 and "3" in res["mismatches"][0]["why"], str(res))

res = cc.check(make_root("- 999 uzyc (src: hooks/lib/overrides.js#NIE_MA_KLUCZA)\n"))
check("klucz bez trafien w zrodle = rozjazd (pusta pula nie przepuszcza)", len(res["mismatches"]) == 1, str(res))

res = cc.check(make_root("- default 30 min (src: hooks/lib/overrides.js#default:), a potem 7 dni bez kotwicy\n"))
check("liczby za ostatnia kotwica = pokrycie, nie rozjazd", res["mismatches"] == [] and res["unanchored_with_numbers"] == 1, str(res))

res = cc.check(make_root("- CONTROL_PLANE 60 min / 3 uzycia, okno 90 min (src: hooks/lib/overrides.js)\n"))
check("liczba spoza zrodla = rozjazd z numerem linii", len(res["mismatches"]) == 1 and "90" in res["mismatches"][0]["why"]
      and res["mismatches"][0]["line"] == 1, str(res))

res = cc.check(make_root("- limit 5 uzyc (src: hooks/lib/nie-ma.js)\n"))
check("kotwica do nieistniejacego pliku = rozjazd", len(res["mismatches"]) == 1 and "nie istnieje" in res["mismatches"][0]["why"], str(res))

res = cc.check(make_root("- data 2026-10-19 o 16:31, tier T3, okno 400k, limit 7 dni\n"))
check("bez kotwicy: tylko licznik pokrycia, nie blad", res["mismatches"] == [] and res["unanchored_with_numbers"] == 1, str(res))

check("daty, godziny i tokeny z literami nie sa liczbami", cc.numbers("2026-10-19 16:31 T3 400k v3 ma 7 dni") == {"7"},
      str(cc.numbers("2026-10-19 16:31 T3 400k v3 ma 7 dni")))

root = make_root("- okno 90 min (src: hooks/lib/overrides.js)\n")
r = subprocess.run([sys.executable, os.path.join(HERE, "claims-check.py"), "--root", root], capture_output=True, text=True, check=False)
check("CLI: rozjazd = exit 1 + linia ROZJAZD", r.returncode == 1 and "ROZJAZD CLAUDE.md:1" in r.stdout, r.stdout + r.stderr)
r = subprocess.run([sys.executable, os.path.join(HERE, "claims-check.py"), "--root", make_root("- 30 min (src: hooks/lib/overrides.js)\n")],
                   capture_output=True, text=True, check=False)
check("CLI: zgodne = exit 0", r.returncode == 0, r.stdout + r.stderr)

r = subprocess.run([sys.executable, os.path.join(HERE, "claims-check.py"), "--root", make_root("- bez kotwic 7 dni\n")],
                   capture_output=True, text=True, check=False)
check("CLI: 0 kotwic = exit 1 (skasowane kotwice nie wylaczaja bramki)", r.returncode == 1 and "min-anchors" in r.stdout, r.stdout + r.stderr)

print("TESTY claims-check: " + ("wszystkie OK" if not fails else f"{len(fails)} FAIL"))
sys.exit(1 if fails else 0)

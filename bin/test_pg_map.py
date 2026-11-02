"""Testy bin/pg-map.py: opis z naglowka pliku do indeksu — pelne zdanie, nie 1. linia ucieta w pol slowa (r10 code)."""
import importlib.util
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("pg_map", os.path.join(HERE, "pg-map.py"))
assert spec is not None and spec.loader is not None, "brak bin/pg-map.py"
pm = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pm)
fails = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else f" :: {detail!r}"))
    if not ok:
        fails.append(name)


TMP = tempfile.TemporaryDirectory(prefix="pg-map-")  # jeden katalog, sprzatany na koncu (r12 ops: 6 katalogow /tmp na przebieg)


def doc_of(name: str, text: str) -> str:
    path = os.path.join(TMP.name, name)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text)
    return pm.first_doc(path)


d = doc_of("hook.js", "#!/usr/bin/env node\n// PostToolUse hook — Loop Guardrails („ten sam blad 2x ->\n// zmien podejscie\") jako kod.\n'use strict';\n")
check("js: blok komentarza sklejony do konca zdania", d == "PostToolUse hook — Loop Guardrails („ten sam blad 2x -> zmien podejscie\") jako kod.", d)

d = doc_of("lib.js", "/**\n * Jedno zrodlo prawdy dla bramek.\n * Druga linia nie wchodzi.\n */\n")
check("js: konczy na pierwszym zdaniu", d == "Jedno zrodlo prawdy dla bramek.", d)

d = doc_of("x.js", "// eslint-disable-next-line\n// Opis po dyrektywie eslint.\nconst a = 1;\n")
check("js: dyrektywa eslint pominieta", d == "Opis po dyrektywie eslint.", d)

d = doc_of("t.py", '#!/usr/bin/env python3\n"""Modul: opis.\n\nReszta."""\ndef f():\n    """Docstring funkcji."""\n')
check("py: docstring modulu, nie funkcji", d == "Modul: opis.", d)

d = doc_of("w.py", '#!/usr/bin/env python3\n"""Czeka na 4 wymagane\nchecki CI. Reszta.\n\nDalej."""\n')
check("py: docstring sklejony do konca zdania", d == "Czeka na 4 wymagane checki CI. Reszta.", d)
d = doc_of("s.sh", "#!/bin/bash\n# Publikacja: klon -> eksport -> bit\n# wykonywania -> push.\nset -e\n")
check("sh: komentarz sklejony do konca zdania", d == "Publikacja: klon -> eksport -> bit wykonywania -> push.", d)
s = pm.short("Opis narzedzia testowego " * 4 + "zero zaleznosci; odpalaj: node test_x.js " + "b " * 60)
check("short: nie tnie na sredniku (komenda uruchomienia zostaje)", "odpalaj: node test_x.js" in s, s)
d = doc_of("t2.js", "#!/usr/bin/env node\n'use strict';\n// test_x.js — testy x.js (+ bramka). Zero zaleznosci; odpalaj: node test_x.js\n// Fixture'y w TEMP; telemetria poza logami.\n")
check("js: nastepna linia z wielkiej litery = nowe zdanie, komenda uruchomienia zostaje (r12 product)",
      d == "test_x.js — testy x.js (+ bramka). Zero zaleznosci; odpalaj: node test_x.js", d)
s = pm.short("a " * 50 + "koniec. " + "b " * 80)
check("short: tnie na koncu zdania w 2. polowie limitu", s == "a " * 50 + "koniec.", s)
s = pm.short("slowo " * 40)
check("short: bez zdania tnie na granicy slowa z wielokropkiem", s.endswith(" …") and "slow …" not in s and len(s) <= pm.SHORT + 2, s)
check("short: krotki tekst bez zmian, | zamieniony", pm.short("a | b") == "a / b", pm.short("a | b"))
s = pm.short("x" * 200)
check("short: bez spacji tnie na limicie, nie gubi znaku", s == "x" * pm.SHORT + " …", s[-8:])

root = os.path.join(TMP.name, "root")
os.makedirs(os.path.join(root, "pg"))
os.makedirs(os.path.join(root, "git-hooks"))
with open(os.path.join(root, "settings.json"), "w", encoding="utf-8") as fh:
    fh.write('{"hooks": {"Stop": [{"hooks": [{"command": "node \\"C:/x/.claude/hooks/stop-gate.js\\""}]}], "Notification": [{"hooks": [{"command": "notify-send hi"}]}]}}')
with open(os.path.join(root, "git-hooks", "pre-push"), "w", encoding="utf-8") as fh:
    fh.write('node "$HOME/.claude/bin/diff-size-gate.js" || x\nnode "$HOME/.claude/bin/diff-size-gate.js" --again\n')
w = pm.render_wiring(root)
check("wiring: hook z migawki i narzedzie z git-hooka (bez duplikatow), znaczniki na brzegach",
      "Stop([Stop]) --> Stop_stop_gate_js[stop-gate.js]" in w and w.count("diff-size-gate.js]") == 1
      and w.startswith(pm.WIRING_START) and w.endswith(pm.WIRING_END) and "Notification_unknown[unrecognized hook command]" in w, w)
doc = f"A\n{pm.WIRING_START}\nstare\n{pm.WIRING_END}\nB\n"
check("wiring: podmiana tylko miedzy znacznikami", pm.with_wiring(doc, "NOWE") == "A\nNOWE\nB\n", pm.with_wiring(doc, "NOWE"))
check("wiring: brak znacznikow = None (pg-map --check czerwone, nie cicha zgoda)", pm.with_wiring("A\nB\n", "X") is None)
home = os.path.join(TMP.name, "home")
claude = os.path.join(home, ".claude")
os.makedirs(os.path.join(claude, "pg", "public", "docs"))
with open(os.path.join(claude, "pg", "public", "docs", "ARCHITECTURE.md"), "w", encoding="utf-8") as fh:
    fh.write(f"{pm.WIRING_START}\n{pm.WIRING_END}\n")


def run_map() -> subprocess.CompletedProcess[str]:
    # Osobny proces z HOME=fikstura: main() czyta ~/.claude, bez podmiany atrybutow modulu.
    return subprocess.run([sys.executable, os.path.join(HERE, "pg-map.py"), "--check"], capture_output=True, text=True,
                          env={**os.environ, "HOME": home}, check=False)


r_missing = run_map()
with open(os.path.join(claude, "settings.json"), "w", encoding="utf-8") as fh:
    fh.write('{"nohooks": 1}')
r_shape = run_map()
rc_missing, rc_shape = r_missing.returncode, r_shape.returncode
check("wiring: brak settings.json albo zly ksztalt JSON = exit 2 (blad narzedzia, nie werdykt)", rc_missing == 2 and rc_shape == 2, f"{rc_missing} {rc_shape}")

TMP.cleanup()
print("TESTY pg-map: " + ("wszystkie OK" if not fails else f"{len(fails)} FAIL"))
sys.exit(1 if fails else 0)

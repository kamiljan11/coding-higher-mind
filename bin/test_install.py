#!/usr/bin/env python3
"""test_install: publiczny instalator na czystym HOME (eksport -> install.mjs -> re-run -> uninstall), 0 tokenow, bez sieci.
Przypadki z instalacji „jak obcy" 2026-11-17: re-run psul CLAUDE.md (znacznik cytowany w bloku), odmowa hookow gita = FAIL,
czerwony selftest = exit 0. Uzycie: python3 ~/.claude/bin/test_install.py  (exit 0 = OK; wymaga zacommitowanego drzewa)."""
import os
import re
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
FAILS: list[str] = []
WHOLE_BEGIN = re.compile(r"^<!-- PG:BEGIN -->$", re.MULTILINE)
WHOLE_END = re.compile(r"^<!-- PG:END -->$", re.MULTILINE)


def check(name: str, ok: bool, detail: str = "") -> None:
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else "  " + detail[-400:]))
    if not ok:
        FAILS.append(name)


def read(path: str) -> str:
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def node(home: str, *args: str, cwd: str) -> subprocess.CompletedProcess:
    node_bin = shutil.which("node") or "node"
    env = {"HOME": home, "PATH": os.path.dirname(node_bin) + os.pathsep + "/usr/bin:/bin", "LANG": "C.UTF-8"}
    return subprocess.run([node_bin, *args], cwd=cwd, env=env, capture_output=True, text=True, check=False, timeout=600)


with tempfile.TemporaryDirectory() as td:
    out = os.path.join(td, "export")
    r = subprocess.run([sys.executable, os.path.join(HERE, "pg-export-public.py"), "--out", out],
                       capture_output=True, text=True, check=False, timeout=600)
    if r.returncode != 0:
        print("test_install: eksport nie powstal (blad narzedzia):", (r.stdout + r.stderr)[-400:])
        sys.exit(2)
    home = os.path.join(td, "home")
    os.makedirs(home)
    claude_md = os.path.join(home, ".claude", "CLAUDE.md")

    r1 = node(home, "install.mjs", "--lang=en", cwd=out)
    check("install bez --yes: exit 0 (odmowa hookow gita to wybor, nie FAIL)", r1.returncode == 0, r1.stdout + r1.stderr)
    check("install bez --yes: selftest pomija globalne hooki", "--no-global-git" in r1.stdout and "pg-selftest: OK" in r1.stdout, r1.stdout)
    first = read(claude_md)
    r2 = node(home, "install.mjs", "--lang=en", cwd=out)
    second = read(claude_md)
    check("re-run: CLAUDE.md bez zmian (blok podmieniony w calosci)", r2.returncode == 0 and second == first,
          f"linie {first.count(chr(10))} -> {second.count(chr(10))}")
    check("re-run: dokladnie 1 znacznik BEGIN jako cala linia", len(WHOLE_BEGIN.findall(second)) == 1, str(len(WHOLE_BEGIN.findall(second))))

    # Plik uszkodzony przez stara wersje (jak na maszynie 2026-11-17): podmiana konczyla sie na cytowanym znaczniku,
    # wiec za nowym END zostawal w tej samej linii ogon starego bloku, a prawdziwy END stal dalej.
    damaged = first.replace("<!-- PG:END -->\n", "<!-- PG:END -->` (aktualizacja = podmiana bloku).\nstara tresc\n<!-- PG:END -->\n", 1)
    with open(claude_md, "w", encoding="utf-8") as fh:
        fh.write(damaged)
    node(home, "install.mjs", "--lang=en", cwd=out)
    healed = read(claude_md)
    check("uszkodzony CLAUDE.md: kolejny install zostawia 1 blok bez ogona",
          len(WHOLE_BEGIN.findall(healed)) == 1 and len(WHOLE_END.findall(healed)) == 1 and "stara tresc" not in healed, healed[-300:])

    os.remove(os.path.join(out, "bin", "test_slop_gates.js"))
    os.remove(os.path.join(home, ".claude", "bin", "test_slop_gates.js"))
    r3 = node(home, "install.mjs", "--lang=en", cwd=out)
    check("czerwony selftest -> install exit 1 (agent widzi porazke)", r3.returncode == 1, f"rc={r3.returncode}")

    r4 = node(home, "uninstall.mjs", cwd=out)
    gone = read(claude_md)
    check("uninstall: blok PG usuniety w calosci", r4.returncode == 0 and "PG:BEGIN" not in gone and "PG:END" not in gone, gone[-300:])

print("TESTY: " + ("wszystkie OK" if not FAILS else f"{len(FAILS)} FAIL"))
sys.exit(1 if FAILS else 0)

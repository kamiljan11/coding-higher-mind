#!/usr/bin/env python3
"""test_pg_skill_links: martwe dowiazanie -> przepiete; zywe nietkniete; 0 i 2 kandydatow -> bez zmian, exit 1; blad -> exit 2.
Uzycie: python3 ~/.claude/bin/test_pg_skill_links.py  (exit 0 = wszystkie OK). 0 tokenow, bez sieci."""
import os
import subprocess
import sys
import tempfile

TOOL = os.path.join(os.path.dirname(os.path.abspath(__file__)), "pg-skill-links.py")
fails = 0


def check(name: str, ok: bool, detail: str = "") -> None:
    global fails
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else "  " + detail))
    fails += 0 if ok else 1


def skill(root: str, rel: str) -> str:
    d = os.path.join(root, rel)
    os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, "SKILL.md"), "w", encoding="utf-8") as fh:
        fh.write("---\nname: x\n---\n")
    return d


def tool(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, TOOL, *args], capture_output=True, text=True, check=False)


with tempfile.TemporaryDirectory() as td:
    skills, root = os.path.join(td, "skills"), os.path.join(td, "plugins")
    os.makedirs(skills)
    new_a = skill(root, "u/o/rpm/plugin_1/skills/moved")
    skill(root, "u/o/rpm/plugin_2/skills/twice")
    skill(root, "u/o/rpm/plugin_3/skills/twice")
    alive = skill(root, "skills-plugin/o/u/skills/alive")
    os.symlink(os.path.join(root, "skills-plugin/o/u/skills/moved"), os.path.join(skills, "moved"))
    os.symlink(os.path.join(root, "gone/twice"), os.path.join(skills, "twice"))
    os.symlink(os.path.join(root, "gone/orphan"), os.path.join(skills, "orphan"))
    os.symlink(alive, os.path.join(skills, "alive"))
    skill(skills, "real-dir")
    a = ["--skills-dir", skills, "--plugins-root", root]

    r = tool(*a)
    check("raport: martwe zostaja, exit 1, nic nie zmienia", r.returncode == 1 and os.readlink(os.path.join(skills, "moved")).endswith("skills-plugin/o/u/skills/moved"), r.stdout)
    r = tool("--fix", *a)
    check("--fix: jeden kandydat -> przepiete na nowy uklad rpm", os.readlink(os.path.join(skills, "moved")) == new_a, r.stdout)
    check("--fix: 2 kandydatow -> bez zmian (wybor reczny)", os.readlink(os.path.join(skills, "twice")) == os.path.join(root, "gone/twice"), r.stdout)
    check("--fix: 0 kandydatow -> bez zmian", os.readlink(os.path.join(skills, "orphan")) == os.path.join(root, "gone/orphan"), r.stdout)
    check("--fix: zywe dowiazanie i zwykly katalog nietkniete", os.readlink(os.path.join(skills, "alive")) == alive and not os.path.islink(os.path.join(skills, "real-dir")), r.stdout)
    check("--fix: zostaly martwe (twice, orphan) -> exit 1", r.returncode == 1 and "martwych dowiazan: 2" in r.stdout, r.stdout)
    check("--fix: brak pliku tymczasowego", not any(f.endswith(".tmp") for f in os.listdir(skills)), repr(os.listdir(skills)))
    r = tool("--skills-dir", os.path.join(td, "nie-ma"), "--plugins-root", root)
    check("brak katalogu skilli = blad narzedzia exit 2, nie werdykt", r.returncode == 2 and "blad narzedzia" in r.stderr, r.stderr)

print(f"TESTY: {fails} FAIL" if fails else "TESTY: OK")
sys.exit(1 if fails else 0)

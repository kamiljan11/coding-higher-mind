#!/usr/bin/env python3
"""test_pg_export: testy eksportu publicznego (frontmatter, sanityzacja sciezek Linuksa, NUL/UTF-16, ochrona --out, skills.json).
Uzycie: python3 ~/.claude/bin/test_pg_export.py  (exit 0 = wszystkie OK). 0 tokenow, bez sieci."""
import importlib.util
import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("exp", os.path.join(HERE, "pg-export-public.py"))
assert spec and spec.loader
exp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(exp)

FAILS: list[str] = []


def check(name: str, cond: bool, detail: str = "") -> None:
    print(("ok   " if cond else "FAIL ") + name + ("" if cond else f"  {detail}"))
    if not cond:
        FAILS.append(name)


fm = exp.frontmatter("---\nname: x\ndescription: >-\n  Pierwsza linia\n  druga linia.\nmodel: opus\n---\nbody\n")
check("frontmatter: zlozona wartosc >- sklejona", fm.get("description") == "Pierwsza linia druga linia.", repr(fm))
check("frontmatter: klucz prosty", fm.get("model") == "opus", repr(fm))

text, _ = exp.substitute("vault ~/Obsidian/MAIN, user user, Komputer uzytkownika, shop-app-case-study, owner-stack.md")
check("substytucje: brak sciezek domowych / nazwiska / klienta", not any(t in text for t in ("user", "Jana", "shop-app", "owner-stack")), text)
check("denylista: lapie linuksowa sciezke domowa", bool(exp.scan("~/x", "f")), "brak trafienia")
check("denylista: fikstura /home/user/ przechodzi", not exp.scan("rm -rf /home/user/x", "f"))
check("SECRET: token Meta EAA", any("SECRET" in p for p in exp.scan("EAAG" + "a1" * 40, "f")))
check("scan: kazde trafienie w linii osobno", len(exp.scan("uzytkownik i shop-app", "f")) >= 2, repr(exp.scan("uzytkownik i shop-app", "f")))

with tempfile.TemporaryDirectory() as d:
    u16 = os.path.join(d, "a.csv")
    with open(u16, "wb") as fh:
        fh.write("<owner>".encode("utf-16"))
    ini = os.path.join(d, "b.ini")
    with open(ini, "w", encoding="utf-8") as fh:
        fh.write("x=1\n")
    png = os.path.join(d, "c.png")
    with open(png, "wb") as fh:
        fh.write(b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR")
    check("decodes_as_text: UTF-16 i .ini = tekst do skanu", exp.decodes_as_text(u16) and exp.decodes_as_text(ini))
    check("decodes_as_text: PNG = binarny", not exp.decodes_as_text(png))

r = subprocess.run([sys.executable, os.path.join(HERE, "pg-export-public.py"), "--out", os.path.expanduser("~")], capture_output=True, text=True, check=False)
check("--out ~ odmowa (exit 2), nic nie skasowane", r.returncode == 2 and "odmowa" in r.stdout, f"rc={r.returncode} {r.stdout[-120:]}")

with tempfile.TemporaryDirectory() as out:
    r = subprocess.run([sys.executable, os.path.join(HERE, "pg-export-public.py"), "--out", out], capture_output=True, text=True, check=False)
    check("eksport: exit 0, problemy 0", r.returncode == 0 and "problemy: 0" in r.stdout, r.stdout[-300:])
    with open(os.path.join(out, "skills.json"), encoding="utf-8") as fh:
        data = json.load(fh)
    check("skills.json: schema_version + liczba = allowlista", data.get("schema_version") == 1 and data["count"] == len(exp.SKILLS), f"{data.get('count')} vs {len(exp.SKILLS)}")
    plugin_skills = sorted(os.listdir(os.path.join(out, "plugins", exp.PLUGIN_NAME, "skills")))
    check("plugin: bez skilli wymagajacych pelnej instalacji", not set(plugin_skills) & exp.NEEDS_FULL_INSTALL, repr(plugin_skills))
    check("summary: bez urwanych slow (… albo koniec zdania)", all(len(s["summary"]) <= 241 or s["summary"].endswith("…") for s in data["skills"]))

print("TESTY: " + ("wszystkie OK" if not FAILS else f"{len(FAILS)} FAIL"))
sys.exit(1 if FAILS else 0)

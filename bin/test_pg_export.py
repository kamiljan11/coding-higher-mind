#!/usr/bin/env python3
"""test_pg_export: testy eksportu publicznego (frontmatter, sanityzacja sciezek Linuksa, NUL/UTF-16, ochrona --out, skills.json).
Uzycie: python3 ~/.claude/bin/test_pg_export.py  (exit 0 = wszystkie OK). 0 tokenow, bez sieci."""
import fnmatch
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
t_v, _ = exp.substitute("payment-gateway cards, local-acquirer ISK, esign-provider + esign-provider-b + eid-provider (CIBA), payment-provider")
check("dostawcy platnosci/eID wycieci (decyzja 2026-10-04)", not exp.scan(t_v, "f") and "payment-gateway" in t_v, t_v)
t_v2, _ = exp.substitute("zamiast payment-gateway; payment-gateway; esign-provider; /\\bpayment-gateway\\b/; local-acquirer")
check("dostawcy: odmiany i identyfikatory tez wycinane", not exp.scan(t_v2, "f") and "apyd" not in t_v2.lower(), t_v2)
mixed = [x for x in exp.scan("<owner>: shop-app i ~/x", "f") if not exp.deny_allowed(x)]
check("wyjatek denylisty po tokenie: uzytkownik w linii nie przepuszcza klienta ani sciezki", len(mixed) >= 2, repr(mixed))
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
    edge = os.path.join(d, "d.csv")  # polski znak przeciety granica 64 KB (code-review 2026-10-04)
    with open(edge, "wb") as fh:
        fh.write(b"a" * 65535 + "ą".encode() + b" <owner>")
    u16le = os.path.join(d, "e.csv")
    with open(u16le, "wb") as fh:
        fh.write("utf16 bez BOM: prywatna tresc".encode("utf-16-le"))
    check("file_kind: UTF-16 z BOM i bez BOM = utf16 (fail-closed)", exp.file_kind(u16) == "utf16" and exp.file_kind(u16le) == "utf16")
    check("file_kind: .ini i znak na granicy 64 KB = text (idzie przez skan)", exp.file_kind(ini) == "text" and exp.file_kind(edge) == "text")
    check("file_kind: PNG = binary", exp.file_kind(png) == "binary")

EXPORT = [sys.executable, os.path.join(HERE, "pg-export-public.py"), "--out"]
with tempfile.TemporaryDirectory() as d:
    keep = os.path.join(d, "dane")
    os.makedirs(keep)
    with open(os.path.join(keep, "wazne.txt"), "w", encoding="utf-8") as fh:
        fh.write("nie kasowac\n")
    link = os.path.join(d, "link")
    os.symlink(keep, link)
    r1 = subprocess.run([*EXPORT, keep], capture_output=True, text=True, check=False)
    r2 = subprocess.run([*EXPORT, link], capture_output=True, text=True, check=False)
    check("--out niepusty katalog bez klonu repo (i dowiazanie do niego) = odmowa, plik zostaje",
          r1.returncode == 2 and r2.returncode == 2 and os.path.exists(os.path.join(keep, "wazne.txt")), f"rc={r1.returncode}/{r2.returncode}")

with tempfile.TemporaryDirectory() as out:
    r = subprocess.run([sys.executable, os.path.join(HERE, "pg-export-public.py"), "--out", out], capture_output=True, text=True, check=False)
    check("eksport: exit 0, problemy 0", r.returncode == 0 and "problemy: 0" in r.stdout, r.stdout[-300:])
    with open(os.path.join(out, "skills.json"), encoding="utf-8") as fh:
        data = json.load(fh)
    check("skills.json: schema_version + liczba = allowlista", data.get("schema_version") == 1 and data["count"] == len(exp.SKILLS), f"{data.get('count')} vs {len(exp.SKILLS)}")
    plugin_skills = sorted(os.listdir(os.path.join(out, "plugins", exp.PLUGIN_NAME, "skills")))
    check("plugin: bez skilli wymagajacych pelnej instalacji", not set(plugin_skills) & exp.NEEDS_FULL_INSTALL, repr(plugin_skills))
    check("tlumaczenia: kazda karta ma summary_pl i summary_en", all(e.get("summary_pl") and e.get("summary_en") for e in data["skills"] + data["agents"]),
          str([e["name"] for e in data["skills"] + data["agents"] if not e.get("summary_pl")]))
    check("summary: bez urwanych slow (… albo koniec zdania)", all(len(s["summary"]) <= 241 or s["summary"].endswith("…") for s in data["skills"]))

with tempfile.TemporaryDirectory() as d:
    def clone(name: str, url: str) -> str:
        c = os.path.join(d, name)
        subprocess.run(["git", "init", "-q", c], check=True)
        subprocess.run(["git", "-C", c, "remote", "add", "origin", url], check=True)
        os.makedirs(os.path.join(c, "docs"))
        return c
    ok = clone("ok", "https://github.com/<github-owner>/coding-higher-mind.git")
    priv = clone("priv", "https://github.com/<github-owner>/coding-higher-mind-private.git")
    wiki = clone("wiki", "https://github.com/<github-owner>/coding-higher-mind.wiki.git")
    check("is_public_clone: tylko korzen klonu z dokladnym URL", exp.is_public_clone(ok) and not exp.is_public_clone(os.path.join(ok, "docs"))
          and not exp.is_public_clone(priv) and not exp.is_public_clone(wiki))
check("DIR_EXCLUDES: rutyny klienckie sagitum-* poza eksportem",
      any(fnmatch.fnmatch("scheduled-tasks/sagitum-x/SKILL.md", g) for g in exp.DIR_EXCLUDES))

# pg-publish-public.sh: naglowek (set -e, trap ERR, MSG) musi sie wykonac — `bash -n` nie zlapal sklejonej linii trap (2026-10-04)
PUB = os.path.join(HERE, "pg-publish-public.sh")
with open(PUB, encoding="utf-8") as fh:
    lines = fh.read().splitlines()
upto = next(i for i, ln in enumerate(lines) if ln.startswith("MSG="))
head = "\n".join(lines[: upto + 1]) + "\necho DOSZLO"
r = subprocess.run(["bash", "-c", head, "x", "feat: x"], capture_output=True, text=True, check=False)
check("pg-publish-public: naglowek wykonuje sie do MSG=", r.returncode == 0 and "DOSZLO" in r.stdout, (r.stderr or r.stdout)[-160:])

print("TESTY: " + ("wszystkie OK" if not FAILS else f"{len(FAILS)} FAIL"))
sys.exit(1 if FAILS else 0)

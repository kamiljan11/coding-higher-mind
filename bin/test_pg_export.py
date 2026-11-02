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

# pg/INDEX.md w eksporcie (r11 code/security): tylko linie, ktorych sciezki `...` sa w eksporcie — fail-closed takze dla prozy.
idx = ("# PG\nNarzedzia: `bin/README.md`.\n| Plik | Wlasciciel |\n|---|---|\n| `pg/GLOSSARY.md` | slownik |\n"
       "| `pg/ref-meta.md` | prywatne |\nProza o `pg/reflect-guard.md` tez.\nBez sciezki zostaje.\n")
pub = exp.public_index(idx, {"pg/GLOSSARY.md"})
check("public_index: wiersz pliku z eksportu zostaje", "`pg/GLOSSARY.md`" in pub, pub)
check("public_index: wiersz i proza z plikiem prywatnym odpadaja", "ref-meta" not in pub and "reflect-guard" not in pub, pub)
pub2 = exp.public_index("a `~/.claude/pg/ref-meta.md` b\nc `/home/user/.claude/pg/GLOSSARY.md` d\ngoly ref-infisical tutaj\n`/etc/passwd`\n", {"pg/GLOSSARY.md"})
check("public_index: ~/ i /home/ normalizowane, goly rdzen pliku prywatnego i obca sciezka absolutna odpadaja (r12 security)",
      pub2 == "c `/home/user/.claude/pg/GLOSSARY.md` d\n", repr(pub2))
check("public_index: martwy odsylacz (bin/README.md spoza eksportu) odpada, tekst bez sciezki zostaje",
      "bin/README.md" not in pub and "Bez sciezki zostaje." in pub and "| Plik |" in pub, pub)
with open(os.path.join(exp.ROOT, "pg", "INDEX.md"), encoding="utf-8") as _fh:
    real = exp.public_index(_fh.read(), set(exp.allowlist()))
check("public_index: realny INDEX bez plikow prywatnych", not any(x in real for x in ("ref-meta", "ref-infisical", "reflect-guard", "ref-skills")), "")
t_b, _ = exp.substitute("`infisical run --env=dev -- node bin/pg-sync.js push`")
check("substytucja: komenda mostu w calosci (bez resztek cd/python3 przed nazwa narzedzia)", t_b == "`infisical run --env=dev -- node bin/pg-sync.js push`", t_b)
t_b2, _ = exp.substitute("infisical run --env=dev -- python3 x.py")
check("substytucja: komenda mostu ze sciezka absolutna (r11 ops)", t_b2 == "infisical run --env=dev -- python3 x.py", t_b2)
check("SECRET: token Meta EAA", any("SECRET" in p for p in exp.scan("EAAG" + "a1" * 40, "f")))
check("scan: kazde trafienie w linii osobno", len(exp.scan("uzytkownik i shop-app", "f")) >= 2, repr(exp.scan("uzytkownik i shop-app", "f")))
# security etap1f: klient spoza tablicy przeszedl eksport z „problemy: 0" (ADR-0007, fleet-cve-watch) — podmiana + denylista.
_cl = exp.substitute("replay " + "client-app 31, repo sten" + "erg-prototyp")[0]
check("substytucja: klient client-app i jego repo", "tenerg" not in _cl.lower() and "client-prototype" in _cl, _cl)
check("denylista: klient client-app", bool(exp.scan("sten" + "erg", "f")))

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

# 2026-10-05 (PR #20): diakrytyk omijal denyliste; pliki *.local.md i pieczec maszyny poza eksportem; wersja w README.
check("fold: eid-provider -> eid-provider", exp.fold("eid-provider Þór") == "eid-provider Thor", exp.fold("eid-provider Þór"))
check("scan: nazwa z diakrytykiem = DENY (fail-closed)", bool(exp.scan("eID " + "Au" + "ðkenni", "x.md")))
check("substytucja: wariant z „ð” podmieniony", "eid-provider" in exp.substitute("Au" + "ðkenni")[0])
check("scan: niewidoczny znak w nazwie (zero-width, soft hyphen) = DENY", bool(exp.scan("R\u200b" + "apyd", "x")) and bool(exp.scan("rap\u00ad" + "yd", "x")))
check("substytucja: rental-site w calosci, second-machine, import @" + "DEV" + "ICES.md", "rental-site-" not in exp.substitute("mountain" + "-car-rental")[0] and all(w not in exp.substitute("mountain" + "-car-x zen" + "book\n@DEV" + "ICES.md\n")[0].lower()
      for w in ("mountain" + "-car", "zen" + "book", "dev" + "ices.md")))
check("skip_file: *.local.md i hooks/.seal.json poza eksportem",
      exp.skip_file("skills/a/references/prywatne notatki floty (poza eksportem)") and exp.skip_file("hooks/.seal.json") and not exp.skip_file("skills/a/SKILL.md"))
_hooks = json.loads(exp.settings_hooks_json(json.dumps({"hooks": {"SessionEnd": [{"hooks": [{"type": "command",
        "command": 'python3 "/home/user/.claude/hooks/auto-doc.py"'}]}]}})))
check("settings_hooks_json: python3 -> {{CLAUDE_DIR}}, bez sciezki domowej",
      _hooks["hooks"]["SessionEnd"][0]["hooks"][0]["command"] == 'python3 "{{CLAUDE_DIR}}/hooks/auto-doc.py"', json.dumps(_hooks))
with tempfile.TemporaryDirectory() as vd:
    with open(os.path.join(vd, "CHANGELOG.md"), "w", encoding="utf-8") as fh:
        fh.write("# Changelog\n\n## [1.3.0] — 2026-10-05\n- x\n")
    def _readme(tresc: str) -> list[str]:
        for rel in ("README.md", "README.pl.md"):
            with open(os.path.join(vd, rel), "w", encoding="utf-8") as fh:
                fh.write(tresc)
        return exp.version_stamp_problems(vd)
    check("version_stamp: brak wersji w README = problem (x2)", len(_readme("# Tytul\n")) == 2)
    check("version_stamp: v1.3.0 + data = OK", _readme("# T\n**Version 1.3.0 — v1.3.0, 2026-10-05**\n") == [])
    check("version_stamp: v1.3.01 nie udaje v1.3.0", len(_readme("# T\nv1.3.01 2026-10-05\n")) == 2)
    check("version_stamp: kropka konczaca zdanie po v1.3.0 = OK", _readme("# T\nReleased v1.3.0. 2026-10-05\n") == [])
    os.makedirs(os.path.join(vd, "pg", ".github"))
    with open(os.path.join(vd, "pg", "cases.md"), "w", encoding="utf-8") as fh:
        fh.write("| ID | x |\n| A-ONE | y |\n| B-TWO | z |\n")
    with open(os.path.join(vd, "pg", ".github", "w.yml"), "w", encoding="utf-8") as fh:
        fh.write("x\n")
    def _read(rel="README.md"):
        with open(os.path.join(vd, rel), encoding="utf-8") as fh:
            return fh.read()
    _readme("# T\n5 files, 3 scars, 26 template files\n")
    check("fill_counters: zgodne liczniki (5 plikow z .github, 3 blizny) = bez zmian", exp.fill_counters(vd) == ([], []), repr(exp.fill_counters(vd)))
    _readme("# T\n99 files, 3 scars, 26 template files\n")
    fc = exp.fill_counters(vd)
    check("fill_counters: reczny licznik != eksport -> eksport wpisuje policzony (wiedza raz, r11)",
          fc[0] == [] and "5 files" in _read() and "99" not in _read() and "26 template files" in _read(), repr(fc) + _read())
    os.makedirs(os.path.join(vd, "scheduled-tasks", "a"))
    _readme("# T\n5 files, 3 scars, 2 Claude Code routines\n")
    fc = exp.fill_counters(vd)
    check("fill_counters: licznik rutyn = liczba katalogow scheduled-tasks", "1 Claude Code routines" in _read() and any("routines" in x for x in fc[1]), repr(fc) + _read())
    os.makedirs(os.path.join(vd, "skills", "s1"))
    with open(os.path.join(vd, "skills", "s1", "SKILL.md"), "w", encoding="utf-8") as fh:
        fh.write("x\n")
    os.makedirs(os.path.join(vd, "plugins", "p", "skills"))  # plugin bez skilli = 0 (r13 code: plugin != wszystkie skille)
    _readme("# T\n18 skills, listed; 18 working skills as a plugin\n")
    with open(os.path.join(vd, "README.pl.md"), "w", encoding="utf-8") as fh:
        fh.write("# T\n18 skilli w eksporcie; 18 skilli roboczych jako plugin\n")
    exp.fill_counters(vd)
    check("fill_counters: skille = skills/*/SKILL.md, 'working skills' = skille pluginu (EN)",
          "1 skills, listed" in _read() and "0 working skills" in _read(), _read())
    check("fill_counters: to samo w README.pl.md (skilli vs skilli roboczych)",
          "1 skilli w eksporcie" in _read("README.pl.md") and "0 skilli roboczych" in _read("README.pl.md"), _read("README.pl.md"))
    os.remove(os.path.join(vd, "pg", "cases.md"))
    _readme("# T\n5 files, 3 scars\n")
    fc = exp.fill_counters(vd)
    check("fill_counters: brak cases.md = problem (nie wpisuje -1)", len(fc[0]) == 1 and "-1" not in _read(), repr(fc) + _read())

def _shebang(p):
    with open(p, "rb") as fh:
        return fh.read(2) == b"#!"


with tempfile.TemporaryDirectory() as out:
    r = subprocess.run([sys.executable, os.path.join(HERE, "pg-export-public.py"), "--out", out], capture_output=True, text=True, check=False)
    check("eksport: exit 0, problemy 0", r.returncode == 0 and "problemy: 0" in r.stdout, r.stdout[-300:])
    # Bit wykonywania zachowany (wydanie 1.4.0 zgubilo +x w 68 plikach): kazdy wykonywalny plik zrodla w hooks/,
    # git-hooks/ i bin/ jest wykonywalny w eksporcie.
    _root = os.path.dirname(HERE)
    _zgubione = [rel for d in ("hooks", "git-hooks", "bin") for rel in (os.path.join(d, f) for f in os.listdir(os.path.join(out, d)))
                 if os.path.isfile(os.path.join(out, rel)) and os.path.exists(os.path.join(_root, rel))
                 and os.access(os.path.join(_root, rel), os.X_OK) and _shebang(os.path.join(out, rel))
                 and not os.access(os.path.join(out, rel), os.X_OK)]
    check("eksport: zachowany bit wykonywania plikow z shebangiem (hooks, git-hooks, bin)", not _zgubione, repr(_zgubione[:5]))
    # +x bez shebanga = ruff EXE002 w pre-commit publicznego repo (1.5.0) — taki plik wychodzi jako 0644.
    _bez_shebanga = [rel for d in ("hooks", "git-hooks", "bin") for rel in (os.path.join(d, f) for f in os.listdir(os.path.join(out, d)))
                     if os.path.isfile(os.path.join(out, rel)) and not _shebang(os.path.join(out, rel)) and os.access(os.path.join(out, rel), os.X_OK)]
    check("eksport: brak +x na plikach bez shebanga", not _bez_shebanga, repr(_bez_shebanga[:5]))
    _lokalne = [os.path.join(dp, f) for dp, _, fs in os.walk(out) for f in fs if f.endswith(".local.md") or f == ".seal.json"]
    check("eksport: zero plikow *.local.md i .seal.json", not _lokalne, repr(_lokalne[:3]))
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
check("DIR_EXCLUDES: rutyny klienckie tender-app-* poza eksportem",
      any(fnmatch.fnmatch("scheduled-tasks/tender-app-x/SKILL.md", g) for g in exp.DIR_EXCLUDES))

# pg-publish-public.sh: naglowek (set -e, trap ERR, MSG) musi sie wykonac — `bash -n` nie zlapal sklejonej linii trap (2026-10-04)
PUB = os.path.join(HERE, "pg-publish-public.sh")
with open(PUB, encoding="utf-8") as fh:
    lines = fh.read().splitlines()
upto = next(i for i, ln in enumerate(lines) if ln.startswith("MSG="))
head = "\n".join(lines[: upto + 1]) + "\necho DOSZLO"
r = subprocess.run(["bash", "-c", head, "x", "feat: x"], capture_output=True, text=True, check=False)
check("pg-publish-public: naglowek wykonuje sie do MSG=", r.returncode == 0 and "DOSZLO" in r.stdout, (r.stderr or r.stdout)[-160:])

# 1.6.0 (code-review): klient i prywatny marketplace wycinane; katalog stacku BEZ wyjatku dla dostawcow (decyzja 2026-10-04).
t_c, _ = exp.substitute("tender-app, tender-app, marketplace local-mods")
check("klient tender-app i local-mods wycinane", not exp.scan(t_c, "f") and "tender-app" in t_c and "local-mods" in t_c, t_c)
check("denylista lapie tender-app, gdyby substytucja zawiodla", bool(exp.scan("projekt tender-app", "f")))
t_s, _ = exp.substitute('| payment-gateway | Islandia | Hostowany checkout | ["payment-provider","Europejska bramka"] |')
check("katalog stacku: dostawcy wycieci jak wszedzie", not exp.scan(t_s, "skills/architecture-advisor/references/stack-catalog.md")
      and "payment-gateway" not in t_s and "payment-provider" not in t_s, t_s)

# 2026-11-02 (EXPORT-UNTRACKED-PRIVATE, A12): do eksportu tylko pliki z HEAD; staged bez commita, nieśledzone (DIRS, skille,
# bin, bin/lib) odpadaja; sledzony plik z niezacommitowana zmiana = odmowa; blad gita (takze brak binarki) = exit 2.
def _w(root: str, rel: str, text: str = "") -> None:
    text = text or {".py": "VALUE = 1\n", ".js": "module.exports = {};\n"}.get(os.path.splitext(rel)[1], "# x\n")
    os.makedirs(os.path.dirname(os.path.join(root, rel)), exist_ok=True)
    with open(os.path.join(root, rel), "w", encoding="utf-8") as fh:
        fh.write(text)


def _git(root: str, *a: str) -> None:
    subprocess.run(["git", "-C", root, "-c", "user.name=t", "-c", "user.email=t@t", *a], check=True, capture_output=True)


SK = exp.SKILLS[0]
with tempfile.TemporaryDirectory() as td:
    pub = ["scheduled-tasks/publiczna/SKILL.md", f"skills/{SK}/SKILL.md", "bin/pub.py", "bin/lib/pub.js", "pg/public/README.md"]
    priv = ["scheduled-tasks/prywatna-sesji/SKILL.md", f"skills/{SK}/private.md", "bin/private_fleet.py", "bin/lib/private.js",
            "scheduled-tasks/staged-bez-commita/SKILL.md", "pg/public/notatki-sesji.md"]
    for rel in pub + priv:
        _w(td, rel)
    subprocess.run(["git", "init", "-q", td], check=True)
    _git(td, "add", *pub)
    _git(td, "commit", "-q", "-m", "chore: fixture")
    _git(td, "add", "scheduled-tasks/staged-bez-commita/SKILL.md")
    old_root = exp.ROOT
    old_pub = exp.PUBLIC_SRC
    vars(exp)["ROOT"] = td  # modul ladowany przez importlib: pyright nie zna atrybutu, ruff B010 zabrania setattr
    vars(exp)["PUBLIC_SRC"] = os.path.join(td, "pg", "public")
    try:
        al = set(exp.allowlist())
        ps = exp.public_src_files()
        check("pg/public: tylko pliki z HEAD (security A13)", ps == ["pg/public/README.md"], repr(ps))
        check("allowlista: tylko pliki z HEAD (DIRS, skille, bin, bin/lib; staged bez commita odpada)",
              all(p in al for p in pub if not p.startswith("pg/public/")) and not any(p in al for p in priv), repr(sorted(al)))
        _w(td, "bin/pub.py", "prywatna zmiana\n")
        try:
            exp.allowlist()
            check("allowlista: sledzony plik z niezacommitowana zmiana = RuntimeError", False, "brak wyjatku")
        except RuntimeError as e:
            check("allowlista: sledzony plik z niezacommitowana zmiana = RuntimeError", "bin/pub.py" in str(e), str(e))
        # Odmowa PRZED kasowaniem --out (code/ops A14): bez --check-only, --out = klon publiczny z plikiem-wartownikiem.
        # Mutant z allowlist() za rmtree przechodzil wszystkie testy (oba wczesniejsze exit 2 chodza z --check-only).
        pclone = os.path.join(td, "pubclone")
        subprocess.run(["git", "init", "-q", pclone], check=True)
        subprocess.run(["git", "-C", pclone, "remote", "add", "origin", f"https://github.com/{exp.PUBLIC_REPO}.git"], check=True)
        _w(pclone, "wartownik.md")
        drv = ("import importlib.util, sys\n"
               "s = importlib.util.spec_from_file_location('e', sys.argv[1]); m = importlib.util.module_from_spec(s)\n"
               "s.loader.exec_module(m); m.ROOT = sys.argv[2]; m.PUBLIC_SRC = sys.argv[2] + '/pg/public'\n"
               "sys.argv = ['x', '--out', sys.argv[3]]; sys.exit(m.main())\n")
        r = subprocess.run([sys.executable, "-c", drv, os.path.join(HERE, "pg-export-public.py"), td, pclone],
                           capture_output=True, text=True, check=False)
        check("odmowa (dirty) bez --check-only = exit 2 i --out nietkniety", r.returncode == 2 and "niezacommitowane" in r.stdout
              and os.path.isfile(os.path.join(pclone, "wartownik.md")),
              f"rc={r.returncode} {r.stdout[-200:]}{r.stderr[-200:]}")
        _git(td, "checkout", "--", "bin/pub.py")
        _w(td, "pg/public/README.md", "# prywatna zmiana\n")
        try:
            exp.public_src_files()
            check("pg/public: sledzony plik z niezacommitowana zmiana = RuntimeError", False, "brak wyjatku")
        except RuntimeError as e:
            check("pg/public: sledzony plik z niezacommitowana zmiana = RuntimeError", "pg/public/README.md" in str(e), str(e))
        _git(td, "checkout", "--", "pg/public/README.md")
        _w(td, "CLAUDE.md", "# x\n")
        _git(td, "add", "CLAUDE.md")
        _git(td, "commit", "-q", "-m", "chore: fixture")
        _w(td, "CLAUDE.md", "# prywatna zmiana\n")
        try:
            exp.allowlist()
            check("allowlista: zmieniony CLAUDE.md (plik pochodny) = RuntimeError", False, "brak wyjatku")
        except RuntimeError as e:
            check("allowlista: zmieniony CLAUDE.md (plik pochodny) = RuntimeError", "CLAUDE.md" in str(e), str(e))
        vars(exp)["ROOT"] = os.path.join(td, "brak")
        try:
            exp.tracked_files()
            check("tracked_files: brak repo = RuntimeError", False, "brak wyjatku")
        except RuntimeError:
            check("tracked_files: brak repo = RuntimeError", True)
    finally:
        vars(exp)["ROOT"] = old_root
        vars(exp)["PUBLIC_SRC"] = old_pub
    nogit = os.path.join(td, "nogit")
    os.makedirs(nogit)
    r = subprocess.run([sys.executable, os.path.join(HERE, "pg-export-public.py"), "--out", os.path.join(td, "out"), "--check-only"],
                       capture_output=True, text=True, check=False, env={**os.environ, "PATH": nogit})
    check("brak binarki git = exit 2 (blad narzedzia, nie denylista)", r.returncode == 2, f"rc={r.returncode} {r.stdout[-200:]}{r.stderr[-200:]}")
    _w(td, "out2/plik.txt")  # niepusty --out: is_public_clone tez wola gita (code A13)
    r2 = subprocess.run([sys.executable, os.path.join(HERE, "pg-export-public.py"), "--out", os.path.join(td, "out2"), "--check-only"],
                        capture_output=True, text=True, check=False, env={**os.environ, "PATH": nogit})
    check("brak binarki git + niepusty --out = exit 2", r2.returncode == 2, f"rc={r2.returncode} {r2.stdout[-200:]}{r2.stderr[-200:]}")

print("TESTY: " + ("wszystkie OK" if not FAILS else f"{len(FAILS)} FAIL"))
sys.exit(1 if FAILS else 0)

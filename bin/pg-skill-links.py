#!/usr/bin/env python3
"""pg-skill-links: sprawdza i naprawia dowiazania skilli Cowork w ~/.claude/skills (0 tokenow).

Skille Cowork w ~/.claude/skills to dowiazania do pluginow konta (decyzja uzytkownika 2026-10-04, .gitignore: nie wersjonujemy).
Aplikacja zmienia uklad katalogow pluginow: 2026-11-17 `skills-plugin/<a>/<b>/skills/X` -> `<b>/<a>/rpm/plugin_*/skills/X`.
Wtedy 20 dowiazan umarlo po cichu: CLI tracil skille, a publiczny eksport zgubilby 5 z 19 skilli.

Uzycie: python3 ~/.claude/bin/pg-skill-links.py [--fix] [--skills-dir D] [--plugins-root R]
  bez --fix: raport. --fix: martwe dowiazanie z DOKLADNIE jednym kandydatem przepina atomowo (os.replace);
  0 albo >1 kandydatow = bez zmian, opis w raporcie.
Exit: 0 = wszystkie dowiazania zywe; 1 = martwe zostaly; 2 = blad narzedzia.
"""
import argparse
import glob
import os
import sys

DEFAULT_SKILLS = os.path.expanduser("~/.claude/skills")
DEFAULT_ROOT = os.path.expanduser("~/.config/Claude/local-agent-mode-sessions")
# Znane uklady pluginow (najnowszy pierwszy). Nowy uklad aplikacji = nowy wzorzec tutaj.
LAYOUTS = ["*/*/rpm/plugin_*/skills/{name}", "skills-plugin/*/*/skills/{name}"]


def candidates(root: str, name: str) -> list[str]:
    found: list[str] = []
    for pattern in LAYOUTS:
        found += [os.path.dirname(p) for p in glob.glob(os.path.join(root, pattern.format(name=glob.escape(name)), "SKILL.md"))]
    return sorted(set(found))


TMP_SUFFIX = ".pg-skill-links.tmp"


def relink(link: str, target: str) -> None:
    tmp = link + TMP_SUFFIX
    if os.path.lexists(tmp):
        os.unlink(tmp)
    os.symlink(target, tmp)
    os.replace(tmp, link)


def run(skills_dir: str, root: str, fix: bool) -> int:
    broken_left = 0
    for name in sorted(os.listdir(skills_dir)):
        link = os.path.join(skills_dir, name)
        if name.endswith(TMP_SUFFIX):  # own leftover of an interrupted relink: not a skill, never counted as dead
            if fix and os.path.islink(link):
                os.unlink(link)
                print(f"usuniete {name} (pozostalosc przerwanego przepiecia)")
            continue
        if not os.path.islink(link) or os.path.isfile(os.path.join(link, "SKILL.md")):
            continue
        cands = candidates(root, name)
        if fix and len(cands) == 1:
            relink(link, cands[0])
            print(f"naprawione {name}: {os.readlink(link)}")
            continue
        broken_left += 1
        why = "brak kandydata w znanych ukladach (LAYOUTS)" if not cands else f"{len(cands)} kandydatow, wybor reczny: {cands}"
        print(f"MARTWE {name} -> {os.readlink(link)} ({why if fix or not cands else 'kandydat: ' + cands[0]})")
    print(f"pg-skill-links: martwych dowiazan: {broken_left}" + ("" if fix or not broken_left else " (napraw: --fix)"))
    return 1 if broken_left else 0


def main() -> int:
    ap = argparse.ArgumentParser(description="pg-skill-links: sprawdza i naprawia dowiazania skilli Cowork (0 tokenow).")
    ap.add_argument("--fix", action="store_true")
    ap.add_argument("--skills-dir", default=DEFAULT_SKILLS)
    ap.add_argument("--plugins-root", default=DEFAULT_ROOT)
    a = ap.parse_args()
    try:
        return run(a.skills_dir, a.plugins_root, a.fix)
    except OSError as e:
        print(f"pg-skill-links: blad narzedzia: {e} (skills={a.skills_dir}, root={a.plugins_root})", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())

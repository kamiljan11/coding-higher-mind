#!/usr/bin/env python3
"""claims-check: liczby w recznych streszczeniach PG (CLAUDE.md, pg/ref-*.md) zgodne ze zrodlem, 0 tokenow.

Retro 2026-10-19 (pytanie uzytkownika: „czy streszczenia nie gubia kontekstu"): CLAUDE.md:71 mowilo „CONTROL_PLANE 60 min",
kod `hooks/lib/overrides.js` = 60 min i 200 uzyc; prog amplifikacji byl sparafrazowany 3 sposobami w 3 plikach.
Streszczenie pisane recznie = kopia sekretu, ktora dryfuje. Regula: kazde twierdzenie z liczba konczy sie kotwica
`(src: sciezka[#KLUCZ][, ...])` wzgledem ~/.claude; KAZDA liczba z odcinka przed kotwica (od poprzedniej kotwicy) musi
byc w zrodle, a z `#KLUCZ` — w liniach zrodla zawierajacych KLUCZ (inaczej „60 min / 3 uzycia" przechodzi na puli pliku).
Linie z liczba bez kotwicy liczy jako pokrycie (raport, nie blad) — kotwice dokladamy przy okazji, nie hurtem.

Uzycie: python3 ~/.claude/bin/claims-check.py [--root DIR] [--json] [--min-anchors N (domyslnie 1)]
Exit: 0 = zgodne, 1 = rozjazd (liczba z kotwica nie ma pokrycia w zrodle albo zrodla brak), 2 = blad narzedzia.
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import re
import sys

SUMMARIES = ["CLAUDE.md", "pg/ref-*.md"]
ANCHOR_RX = re.compile(r"\(src:\s*([^)]+)\)")
DATE_RX = re.compile(r"\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}:\d{2}\b")
# Liczba jako samodzielny token: bez liter/cyfr/kropek/myslnikow przyklejonych (T3, 400k, v3, 2026-10 odpadaja).
NUM_RX = re.compile(r"(?<![\w.\-/])\d+(?:[.,]\d+)?(?![\w\-/])")


def numbers(text: str) -> set[str]:
    return {n.replace(",", ".") for n in NUM_RX.findall(DATE_RX.sub(" ", text))}


def source_numbers(full: str, key: str) -> set[str] | None:
    """Liczby zrodla; z `#KLUCZ` tylko z linii zawierajacych KLUCZ (para „60 min / 200 uzyc" sprawdzana na jednej linii)."""
    if not os.path.isfile(full):
        return None
    with open(full, encoding="utf-8") as fh:
        text = fh.read()
    if key:
        text = "\n".join(ln for ln in text.splitlines() if key in ln)
    return numbers(text)


def check(root: str) -> dict:
    """Kazda kotwica sprawdza SWOJ odcinek linii: tekst od poprzedniej kotwicy do niej (jedno twierdzenie = jedna kotwica)."""
    mismatches: list[dict] = []
    anchored = unanchored = 0
    cache: dict[str, set[str] | None] = {}
    for pattern in SUMMARIES:
        for path in sorted(glob.glob(os.path.join(root, pattern))):
            rel = os.path.relpath(path, root)
            with open(path, encoding="utf-8") as fh:
                for lineno, line in enumerate(fh, 1):
                    pos = 0
                    for m in ANCHOR_RX.finditer(line):
                        anchored += 1
                        claimed = numbers(line[pos:m.start()])
                        pos = m.end()
                        pool: set[str] = set()
                        broken = False
                        for ref in (r.strip().strip("`") for r in m.group(1).split(",")):
                            if ref not in cache:
                                src, _, key = ref.partition("#")
                                cache[ref] = source_numbers(os.path.join(root, src), key)
                            src_numbers = cache[ref]
                            if src_numbers is None:
                                broken = True
                                mismatches.append({"file": rel, "line": lineno, "why": f"zrodlo {ref} nie istnieje"})
                            else:
                                pool |= src_numbers
                        missing = sorted(claimed - pool)
                        if missing and not broken:
                            mismatches.append({"file": rel, "line": lineno,
                                               "why": f"liczby {', '.join(missing)} nie wystepuja w {m.group(1).strip()}"})
                    unanchored += bool(numbers(line[pos:]))
    return {"mismatches": mismatches, "anchored": anchored, "unanchored_with_numbers": unanchored}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--root", default=os.path.join(os.path.expanduser("~"), ".claude"))
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--min-anchors", type=int, default=1,
                    help="mniej kotwic = exit 1 (skasowane kotwice nie wylaczaja po cichu bramki; r7 ops)")
    args = ap.parse_args()
    try:
        res = check(args.root)
    except (OSError, UnicodeDecodeError) as e:
        print(f"claims-check: blad narzedzia (nie werdykt): {e}", file=sys.stderr)
        return 2
    if args.json:
        print(json.dumps(res, ensure_ascii=False))
    else:
        for mm in res["mismatches"]:
            print(f"ROZJAZD {mm['file']}:{mm['line']} — {mm['why']}")
        print(f"claims-check: {len(res['mismatches'])} rozjazdow | kotwic: {res['anchored']} | linii z liczbami bez kotwicy: {res['unanchored_with_numbers']}")
    if res["anchored"] < args.min_anchors:
        print(f"claims-check: {res['anchored']} kotwic < --min-anchors {args.min_anchors} — bramka bez pokrycia (zly --root albo skasowane kotwice)")
        return 1
    return 1 if res["mismatches"] else 0


if __name__ == "__main__":
    sys.exit(main())

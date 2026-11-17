#!/usr/bin/env python3
"""coverage-ledger: rejestr pokrycia analizy zrodel (anty-wybiorczosc, cases.md SAMPLE-GENERALIZED).

Analiza „X vs PG" (kurs, filmy, dokumenty, dane) bierze KAZDA jednostke zrodla w KAZDEJ modalnosci
(tekst, transkrypt, slajdy/obrazy, tabele). Wniosek o calosci wolno ogloszyc dopiero, gdy raport ma
0 pending. Probka (pilot) to deklarowany `skip` z powodem, nie cicha luka — a w trybie --strict skip tez
czerwieni raport.

Uzycie:
  coverage-ledger.py init   L.json --modality NAZWA=GLOB [--modality ...] [--force]  # inwentarz (glob z ~ i **); istniejacy L = blad bez --force
  coverage-ledger.py mark   L.json --modality NAZWA --by "kto/jak" SCIEZKA... # przeczytane/obejrzane
  coverage-ledger.py skip   L.json --modality NAZWA --reason "..." SCIEZKA...
  coverage-ledger.py report L.json [--strict] [--json]

Raport: per modalnosc read/skip/pending + LUKI MIEDZY MODALNOSCIAMI: jednostka (klucz = numer na
poczatku nazwy, np. „15 - Layered.mp4" -> 15) obecna w jednej modalnosci, a nieobecna w innej
(np. transkrypt 29/29, slajdy 5/29). Exit: 0 komplet, 1 braki (pending / luki / skip przy --strict),
2 blad uzycia albo pliku.
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import re
import sys
from datetime import datetime, timezone

EXIT_OK, EXIT_GAPS, EXIT_USAGE = 0, 1, 2
KEY_RX = re.compile(r"^\s*(\d+)")


def unit_key(path: str) -> str:
    """Klucz jednostki do porownania modalnosci: numer z poczatku nazwy pliku albo katalogu-rodzica."""
    for part in (os.path.basename(path), os.path.basename(os.path.dirname(path))):
        m = KEY_RX.match(part)
        if m:
            return str(int(m.group(1)))
    return os.path.splitext(os.path.basename(path))[0].lower()


def now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ")


def load(path: str) -> dict:
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    validate(data)
    return data


STATUSES = ("read", "skip", "pending")


def validate(data) -> None:
    """Zly ksztalt rejestru = blad narzedzia (exit 2), nigdy werdykt; pusty inwentarz nie jest kompletem."""
    mods = data.get("modalities") if isinstance(data, dict) else None
    if not isinstance(mods, dict):
        raise TypeError("'modalities' musi byc obiektem JSON")
    if not mods:
        raise ValueError("pusty inwentarz (0 modalnosci) — to nie jest komplet; uruchom init")
    for name, m in mods.items():
        units = m.get("units") if isinstance(m, dict) else None
        if not isinstance(units, dict) or not units:
            raise ValueError(f"modalnosc '{name}': brak jednostek ('units' pusty albo nie obiekt)")
        bad = [p for p, u in units.items() if not isinstance(u, dict) or u.get("status") not in STATUSES]
        if bad:
            raise ValueError(f"modalnosc '{name}': {len(bad)} jednostek bez poprawnego 'status' ({', '.join(STATUSES)}), np. {bad[0]}")


def save(path: str, data: dict) -> None:
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    os.replace(tmp, path)


def cmd_init(a) -> int:
    if os.path.exists(a.ledger) and not a.force:
        print(f"{a.ledger} istnieje — init skasowalby postep (mark/skip); uzyj --force, jesli swiadomie", file=sys.stderr)
        return EXIT_USAGE
    mods = {}
    for spec in a.modality:
        if "=" not in spec:
            print(f"zla --modality '{spec}' (format NAZWA=GLOB)", file=sys.stderr)
            return EXIT_USAGE
        name, pattern = spec.split("=", 1)
        files = sorted(glob.glob(os.path.expanduser(pattern), recursive=True))
        if not files:
            print(f"modalnosc '{name}': glob '{pattern}' nie znalazl plikow — inwentarz pusty to blad, nie komplet",
                  file=sys.stderr)
            return EXIT_USAGE
        mods[name] = {"glob": pattern, "units": {p: {"status": "pending"} for p in files}}
    save(a.ledger, {"created": now(), "modalities": mods})
    for name, m in mods.items():
        print(f"{name}: {len(m['units'])} jednostek")
    return EXIT_OK


def _set(a, status: str, extra: dict) -> int:
    data = load(a.ledger)
    mod = data["modalities"].get(a.modality)
    if mod is None:
        print(f"nieznana modalnosc '{a.modality}' (sa: {', '.join(data['modalities'])})", file=sys.stderr)
        return EXIT_USAGE
    unknown = [p for p in a.paths if p not in mod["units"]]
    if unknown:
        print(f"spoza inwentarza ({len(unknown)}): {unknown[:3]}", file=sys.stderr)
        return EXIT_USAGE
    for p in a.paths:
        mod["units"][p] = {"status": status, "at": now(), **extra}
    save(a.ledger, data)
    print(f"{a.modality}: {status} x{len(a.paths)}")
    return EXIT_OK


def cmd_mark(a) -> int:
    return _set(a, "read", {"by": a.by})


def cmd_skip(a) -> int:
    if not a.reason.strip():
        print("skip wymaga niepustego --reason", file=sys.stderr)
        return EXIT_USAGE
    return _set(a, "skip", {"reason": a.reason})


def analyse(data: dict, strict: bool) -> dict:
    out = {"modalities": {}, "cross_gaps": [], "ok": True}
    keys_by_mod = {}
    for name, m in data["modalities"].items():
        counts: dict[str, int] = dict.fromkeys(STATUSES, 0)
        for u in m["units"].values():
            counts[u["status"]] += 1
        counts["total"] = len(m["units"])
        out["modalities"][name] = counts
        keys_by_mod[name] = {unit_key(p) for p in m["units"]}
        if counts["pending"] or (strict and counts["skip"]):
            out["ok"] = False
    all_keys = set().union(*keys_by_mod.values()) if keys_by_mod else set()
    for name, keys in keys_by_mod.items():
        missing = sorted(all_keys - keys, key=lambda k: (len(k), k))
        if missing:
            out["cross_gaps"].append({"modality": name, "missing_units": missing})
            out["ok"] = False
    return out


def cmd_report(a) -> int:
    res = analyse(load(a.ledger), a.strict)
    if a.json:
        print(json.dumps(res, ensure_ascii=False))
    else:
        for name, c in res["modalities"].items():
            print(f"{name}: przeczytane {c['read']}/{c['total']}, skip {c['skip']}, pending {c['pending']}")
        for g in res["cross_gaps"]:
            print(f"LUKA {g['modality']}: brak jednostek {', '.join(g['missing_units'][:20])}"
                  f"{' …' if len(g['missing_units']) > 20 else ''} ({len(g['missing_units'])})")
        print("KOMPLET" if res["ok"] else "NIEKOMPLETNE: wniosek o calosci = UNVERIFIED")
    return EXIT_OK if res["ok"] else EXIT_GAPS


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("init"); p.add_argument("ledger"); p.add_argument("--modality", action="append", required=True)
    p.add_argument("--force", action="store_true", help="nadpisz istniejacy rejestr (kasuje postep)")
    p.set_defaults(fn=cmd_init)
    for name, fn in (("mark", cmd_mark), ("skip", cmd_skip)):
        p = sub.add_parser(name); p.add_argument("ledger"); p.add_argument("--modality", required=True)
        p.add_argument("paths", nargs="+")
        if name == "mark":
            p.add_argument("--by", required=True)
        else:
            p.add_argument("--reason", required=True)
        p.set_defaults(fn=fn)
    p = sub.add_parser("report"); p.add_argument("ledger"); p.add_argument("--strict", action="store_true")
    p.add_argument("--json", action="store_true"); p.set_defaults(fn=cmd_report)
    try:
        a = ap.parse_args(argv)
    except SystemExit as e:
        return EXIT_USAGE if e.code else EXIT_OK
    try:
        return a.fn(a)
    except (OSError, TypeError, ValueError) as e:
        print(f"coverage-ledger: blad narzedzia: {e}", file=sys.stderr)
        return EXIT_USAGE


if __name__ == "__main__":
    sys.exit(main())

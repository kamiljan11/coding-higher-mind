#!/usr/bin/env python3
"""Testy coverage-ledger: inwentarz, pending, skip/--strict, luki miedzy modalnosciami, kontrakt exit 0/1/2."""
from __future__ import annotations

import importlib.util
import json
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("cl", os.path.join(HERE, "coverage-ledger.py"))
if spec is None or spec.loader is None:
    sys.exit("nie moge zaladowac coverage-ledger.py")
cl = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cl)

fails = 0


def ok(name: str, cond: bool, info: str = "") -> None:
    global fails
    print(("PASS: " if cond else "FAIL: ") + name + ("" if cond else f" | {info}"))
    if not cond:
        fails += 1


def read_json(p: str) -> dict:
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def touch(p: str) -> None:
    os.makedirs(os.path.dirname(p), exist_ok=True)
    open(p, "w").close()


with tempfile.TemporaryDirectory() as d:
    # 3 filmy z transkryptem, slajdy tylko dla 1 (blizna 2026-11-02: transkrypty 29/29, slajdy 5/29)
    for n in ("15 - Layered", "16 - Modular", "19 - Porownanie"):
        touch(f"{d}/tr/{n}.txt")
    touch(f"{d}/sl/18 - EDA/s001_t0.jpg")
    touch(f"{d}/sl/15 - Layered/s001_t0.jpg")
    touch(f"{d}/sl/15 - Layered/s002_t9.jpg")
    L = f"{d}/l.json"

    ok("unit_key: numer z nazwy pliku", cl.unit_key("x/15 - Layered.txt") == "15")
    ok("unit_key: numer z katalogu-rodzica slajdu", cl.unit_key("x/15 - Layered/s002_t9.jpg") == "15")
    ok("unit_key: 09 == 9", cl.unit_key("09 - Kwanty.txt") == "9")

    ok("init: pusty glob = blad uzycia (2), nie komplet",
       cl.main(["init", L, "--modality", f"x={d}/nic/*.txt"]) == 2)
    ok("init: zly format modalnosci = 2", cl.main(["init", L, "--modality", "bez-rownasie"]) == 2)
    ok("init ok", cl.main(["init", L, "--modality", f"transkrypt={d}/tr/*.txt",
                             "--modality", f"slajdy={d}/sl/**/*.jpg"]) == 0)
    ok("init na istniejacym rejestrze bez --force = 2 (nie kasuje postepu)",
       cl.main(["init", L, "--modality", f"transkrypt={d}/tr/*.txt"]) == 2)
    data = read_json(L)
    ok("inwentarz: 3 transkrypty, 3 slajdy", len(data["modalities"]["transkrypt"]["units"]) == 3
       and len(data["modalities"]["slajdy"]["units"]) == 3)

    res = cl.analyse(cl.load(L), strict=False)
    gaps = {g["modality"]: g["missing_units"] for g in res["cross_gaps"]}
    ok("luka: slajdy bez 16 i 19", gaps.get("slajdy") == ["16", "19"], json.dumps(gaps))
    ok("luka: transkrypt bez 18", gaps.get("transkrypt") == ["18"], json.dumps(gaps))
    ok("pending -> report exit 1", cl.main(["report", L]) == 1)

    ok("mark spoza inwentarza = 2", cl.main(["mark", L, "--modality", "transkrypt", "--by", "t", f"{d}/obcy.txt"]) == 2)
    ok("mark nieznana modalnosc = 2", cl.main(["mark", L, "--modality", "wideo", "--by", "t", "x"]) == 2)
    trs = sorted(data["modalities"]["transkrypt"]["units"])
    sls = sorted(data["modalities"]["slajdy"]["units"])
    ok("mark ok", cl.main(["mark", L, "--modality", "transkrypt", "--by", "t", *trs]) == 0)
    ok("skip bez powodu = 2", cl.main(["skip", L, "--modality", "slajdy", "--reason", " ", sls[0]]) == 2)
    ok("skip z powodem", cl.main(["skip", L, "--modality", "slajdy", "--reason", "czarna klatka", sls[0]]) == 0)
    ok("mark reszty slajdow", cl.main(["mark", L, "--modality", "slajdy", "--by", "t", *sls[1:]]) == 0)
    c = cl.analyse(cl.load(L), strict=False)["modalities"]
    ok("liczniki: transkrypt 3/3, slajdy read 2 skip 1", c["transkrypt"]["read"] == 3
       and c["slajdy"]["read"] == 2 and c["slajdy"]["skip"] == 1, json.dumps(c))
    ok("nadal luka miedzy modalnosciami -> exit 1 mimo 0 pending", cl.main(["report", L]) == 1)

    # komplet: te same jednostki w obu modalnosciach
    L2 = f"{d}/l2.json"
    ok("init 2", cl.main(["init", L2, "--modality", f"slajdy={d}/sl/15*/*.jpg",
                            "--modality", f"transkrypt={d}/tr/15*.txt"]) == 0)
    d2 = read_json(L2)
    for m, u in d2["modalities"].items():
        cl.main(["mark", L2, "--modality", m, "--by", "t", *u["units"]])
    ok("komplet -> exit 0", cl.main(["report", L2]) == 0)
    first = min(d2["modalities"]["slajdy"]["units"])
    cl.main(["skip", L2, "--modality", "slajdy", "--reason", "pilot", first])
    ok("skip bez --strict -> 0", cl.main(["report", L2]) == 0)
    ok("skip z --strict -> 1", cl.main(["report", L2, "--strict"]) == 1)

    with open(f"{d}/zly.json", "w") as f:
        f.write("{nie json")
    ok("uszkodzony plik = blad narzedzia 2, nie werdykt", cl.main(["report", f"{d}/zly.json"]) == 2)
    with open(f"{d}/zly2.json", "w") as f:
        json.dump({"modalities": []}, f)
    ok("zly typ modalities = 2", cl.main(["report", f"{d}/zly2.json"]) == 2)
    for name, body in (("pusty inwentarz {} = 2, nie KOMPLET", {"modalities": {}}),
                       ("jednostka bez status = 2, nie werdykt 1", {"modalities": {"a": {"units": {"x": {}}}}}),
                       ("status spoza listy = 2", {"modalities": {"a": {"units": {"x": {"status": "done"}}}}}),
                       ("modalnosc bez units = 2", {"modalities": {"a": {}}}),
                       ("units puste = 2", {"modalities": {"a": {"units": {}}}}),
                       ("korzen nie obiekt = 2", [])):
        with open(f"{d}/ksztalt.json", "w", encoding="utf-8") as f:
            json.dump(body, f)
        ok(name, cl.main(["report", f"{d}/ksztalt.json"]) == 2)

print("wszystkie PASS" if not fails else f"{fails} FAIL")
sys.exit(1 if fails else 0)

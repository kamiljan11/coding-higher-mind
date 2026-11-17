#!/usr/bin/env python3
"""ledger-import-generic: extracted theses (P9, any source) -> pg/knowledge-ledger.jsonl.

Usage:
  python3 bin/ledger-import-generic.py --source sd-course --input RUN/extract/sd-course.jsonl --expect N
         [--ledger pg/knowledge-ledger.jsonl] [--vault DIR] [--pg-root DIR] [--refs-dir DIR] --date YYYY-MM-DD

Input = one JSON object per line, as returned by the extraction:
  {id, file, thesis, quote, weight, weight_reason, status, evidence, [duplicate_of], [reference]}
Checks (any failure -> exit 1 and the ledger is NOT written):
  - lines read == --expect (count of returned theses), every record valid,
  - id unique in the whole ledger (other sources included) and prefixed with "<source>-",
  - weight in W / Ś / N, status in MAMY / CZĘŚCIOWO / BRAK / NIE DOTYCZY, weight_reason and evidence non-empty,
  - quote verbatim in the source file (bin/ack-check.py rules; `line` is computed from the quote, not trusted),
  - duplicate: the same normalised thesis or the same quote as another record (any source) needs
    `duplicate_of` pointing at an existing id; otherwise it is refused,
  - re-import of a source keeps downstream fields (trigger, place, wont, micro_steps, ...) of unchanged
    theses and refuses when a changed thesis would lose them.
Records of other sources are kept as they are. Exit codes: 0 ok, 1 validation failed, 2 tool error.
"""
import argparse
import datetime
import importlib.util
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent


def _load(name, file):
    spec = importlib.util.spec_from_file_location(name, HERE / file)
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


ack = _load("ack_check", "ack-check.py")
dev = _load("ledger_import_devsteer", "ledger-import-devsteer.py")

STATUSES = set(dev.STATUSES.values())
REQUIRED = ("id", "file", "thesis", "quote", "weight", "weight_reason", "status", "evidence")
IMPORT_KEYS = {"source", "id", "file", "line", "lesson", "thesis", "detail", "instruction", "weight", "weight_reason",
               "status", "evidence", "quote", "duplicate_of", "reference", "proposal", "rank", "date"}
NULL_FROM_IMPORT = {"trigger", "place"}


def downstream(rec):
    return {k: v for k, v in rec.items() if k not in IMPORT_KEYS and not (k in NULL_FROM_IMPORT and v is None)}


def build(raw, source, date):
    rec = {
        "source": source, "id": raw["id"], "file": raw["file"], "line": None, "lesson": None,
        "thesis": raw["thesis"].strip(), "detail": None, "instruction": dev.instruction_of(raw["thesis"].strip()),
        "weight": raw["weight"], "weight_reason": raw["weight_reason"], "status": raw["status"],
        "evidence": raw["evidence"], "quote": ack.norm(raw["quote"]), "proposal": None,
        "trigger": None, "place": None, "rank": None, "date": date,
    }
    for k in ("duplicate_of", "reference"):
        if raw.get(k):
            rec[k] = raw[k]
    return rec


def validate(raws, source, keep, vault, pg_root, refs_dir):
    problems = []
    for i, r in enumerate(raws, 1):
        missing = [k for k in REQUIRED if not str(r.get(k) or "").strip()]
        if missing:
            problems.append(f"wiersz {i} ({r.get('id', '?')}): brak pol {missing}")
            continue
        if r.get("source") not in (None, source):
            problems.append(f"{r['id']}: source={r.get('source')} != {source}")
        if not r["id"].startswith(source + "-"):
            problems.append(f"{r['id']}: id musi zaczynac sie od '{source}-'")
        if r["weight"] not in dev.WEIGHTS:
            problems.append(f"{r['id']}: zla waga {r['weight']!r}")
        if r["status"] not in STATUSES:
            problems.append(f"{r['id']}: zly status {r['status']!r}")
    if problems:
        return problems, []
    ids = {}
    for r in keep + raws:
        ids[r["id"]] = ids.get(r["id"], 0) + 1
    problems += [f"duplikat id: {k}" for k, v in ids.items() if v > 1]
    recs = [build(r, source, None) for r in raws]
    problems += ack.check_records(keep + recs, source, vault, pg_root, refs_dir)
    for rec in recs:
        try:
            path = Path(refs_dir) / f"{rec['id']}.txt" if source == "general" else ack.resolve(rec["file"], vault, pg_root)
            if source != "general" and path.is_file():
                rec["line"] = ack.quote_line(path.read_text(encoding="utf-8"), rec["quote"])
        except ValueError:
            pass  # already reported by check_records
    seen_thesis, seen_quote = {}, {}
    for r in keep:
        seen_thesis.setdefault(ack.norm(r.get("thesis", "")).lower(), r["id"])
        if r.get("quote"):
            seen_quote.setdefault(ack.norm(r["quote"]), r["id"])
    known = set(ids)
    for rec in recs:
        t, q = ack.norm(rec["thesis"]).lower(), rec["quote"]
        other = seen_thesis.get(t) or seen_quote.get(q)
        if rec.get("duplicate_of"):
            if rec["duplicate_of"] not in known or rec["duplicate_of"] == rec["id"]:
                problems.append(f"{rec['id']}: duplicate_of={rec['duplicate_of']} nie istnieje")
        elif other:
            problems.append(f"{rec['id']}: duplikat {other} (ta sama teza albo cytat) bez duplicate_of")
        seen_thesis.setdefault(t, rec["id"])
        seen_quote.setdefault(q, rec["id"])
    return problems, recs


def merge(recs, old, source, date):
    prev = {r["id"]: r for r in old if r.get("source") == source}
    problems = []
    for rec in recs:
        p = prev.get(rec["id"])
        rec["date"] = p.get("date", date) if p and p.get("thesis") == rec["thesis"] else date
        if p and downstream(p):
            if p.get("thesis") == rec["thesis"]:
                rec.update(downstream(p))
            else:
                problems.append(f"{rec['id']}: zmieniona teza zgubilaby {sorted(downstream(p))}")
    gone = [i for i, p in prev.items() if downstream(p) and i not in {r["id"] for r in recs}]
    problems += [f"{i}: usuniety rekord mial {sorted(downstream(prev[i]))}" for i in gone]
    return problems


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", required=True)
    ap.add_argument("--input", required=True)
    ap.add_argument("--expect", type=int, required=True)
    ap.add_argument("--ledger", default="pg/knowledge-ledger.jsonl")
    ap.add_argument("--vault", default=str(ack.VAULT_DEFAULT))
    ap.add_argument("--pg-root", default=".")
    ap.add_argument("--refs-dir")
    ap.add_argument("--date", required=True)
    a = ap.parse_args(argv)
    try:
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", a.date):
            raise ValueError("--date YYYY-MM-DD")
        datetime.date.fromisoformat(a.date)
        if a.source == "devsteer":
            raise ValueError("source=devsteer ma wlasny importer (ledger-import-devsteer.py)")
        if a.source == "general" and not a.refs_dir:
            raise ValueError("source=general wymaga --refs-dir (cytat sprawdzany w general-refs/<id>.txt)")
        lines = [l for l in Path(a.input).read_text(encoding="utf-8").split("\n") if l.strip()]
        raws = [json.loads(l) for l in lines]
        bad = [i for i, r in enumerate(raws, 1) if not isinstance(r, dict)]
        if bad:
            raise ValueError(f"wiersze wejscia niebedace obiektem JSON: {bad[:10]}")
        ledger = Path(a.ledger)
        old = dev.load_jsonl(ledger) if ledger.exists() else []
        wrong = ack.type_errors(raws, "wiersz wejscia") + ack.type_errors(old, "wiersz rejestru")
        if wrong:
            raise ValueError("; ".join(wrong[:10]))
    except (OSError, ValueError) as e:
        print(f"ledger-import-generic: blad narzedzia: {e}", file=sys.stderr)
        return 2
    keep = [r for r in old if r.get("source") != a.source]
    problems = [] if len(raws) == a.expect else [f"wczytane {len(raws)} != oczekiwane {a.expect}"]
    vproblems, recs = validate(raws, a.source, keep, a.vault, a.pg_root, a.refs_dir)
    problems += vproblems
    if not vproblems:
        problems += merge(recs, old, a.source, a.date)
    written = False
    if not problems:
        try:
            dev.write_atomic(ledger, keep + recs)
        except OSError as e:
            print(f"ledger-import-generic: blad zapisu rejestru: {e}", file=sys.stderr)
            return 2
        written = True
    print(json.dumps({"source": a.source, "read": len(raws), "expect": a.expect, "written": written,
                      "problems": len(problems), "first": problems[:20]}, ensure_ascii=False))
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())

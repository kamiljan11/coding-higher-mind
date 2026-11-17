#!/usr/bin/env python3
"""ledger-search.py: one read entry point to the knowledge ledger (pg/knowledge-ledger.jsonl). 0 model tokens.

Usage:
  python3 bin/ledger-search.py "<words>" [-n 8] [--json] [--log F] [--ledger F] [--pg-root DIR]
  python3 bin/ledger-search.py --unused [--window-days 28] [--log F]

Search: only weight W theses, without `duplicate_of`, status other than NIE DOTYCZY. Plain token scoring over
thesis / detail / lesson / quote, case-insensitive; Polish without a stemmer: a word matches on its first 5 letters.
Ranking: more distinct query words matched first, then weighted hits (thesis 3, detail 2, lesson 2, quote 1).
Result: id, status, thesis, one-line quote, mechanism (trigger file, else a file cited in evidence of a used
thesis) or "brak mechanizmu".

Usage log: every search appends one JSON line {ts, query, n_results, ids}. Path: --log, else env
PG_LEDGER_USAGE_LOG, else ~/.claude/logs/ledger-usage.jsonl. --unused (no log line): W theses never returned in
the window AND without trigger = archive candidates (count + first 20).
Exit: 0 ok, 2 bad input.
"""
import argparse
import importlib.util
import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("ledger_check", HERE / "ledger-check.py")
assert _spec is not None and _spec.loader is not None
lc = importlib.util.module_from_spec(_spec)
sys.modules.setdefault("ledger_check", lc)
_spec.loader.exec_module(lc)

DEFAULT_LOG = Path.home() / ".claude" / "logs" / "ledger-usage.jsonl"
LOG_ENV = "PG_LEDGER_USAGE_LOG"
PREFIX = 5
FIELD_WEIGHTS = (("thesis", 3), ("detail", 2), ("lesson", 2), ("quote", 1))
STOPWORDS = {"kiedy", "zamiast", "przy", "oraz", "jest", "czy", "jak", "dla", "bez", "the", "and", "for"}
QUOTE_CHARS = 140
NO_MECHANISM = "brak mechanizmu"
WORD_RX = re.compile(r"\w+", re.UNICODE)


def tokens(text):
    """Set of 5-letter prefixes of the words of a text (lowercase)."""
    return {w[:PREFIX] for w in WORD_RX.findall(str(text or "").lower()) if len(w) >= 3}


def query_tokens(query):
    words = [w for w in WORD_RX.findall(query.lower()) if len(w) >= 3 and w not in STOPWORDS]
    return {w[:PREFIX] for w in words}


def searchable(rec):
    return (
        rec.get("weight") == "W"
        and not lc.filled(rec.get("duplicate_of"))
        and rec.get("status") != "NIE DOTYCZY"
    )


def score(rec, qtok):
    matched, total = set(), 0
    for field, weight in FIELD_WEIGHTS:
        hit = qtok & tokens(rec.get(field))
        matched |= hit
        total += weight * len(hit)
    return len(matched), total


def mechanism(rec, pg_root):
    if lc.filled(rec.get("trigger")):
        return rec["trigger"]
    if rec.get("status") in lc.USED_STATUSES:
        found = lc.mechanisms_of(rec, pg_root)
        if found:
            return found[0]
    return NO_MECHANISM


def one_line(text, limit=QUOTE_CHARS):
    flat = " ".join(str(text or "").split())
    return flat if len(flat) <= limit else flat[: limit - 3] + "..."


def search(records, query, pg_root, limit=8):
    qtok = query_tokens(query)
    if not qtok:
        return []
    ranked = []
    for rec in records:
        if not searchable(rec):
            continue
        distinct, total = score(rec, qtok)
        if distinct:
            ranked.append((-distinct, -total, str(rec.get("id")), rec))
    ranked.sort(key=lambda item: item[:3])
    return [
        {
            "id": rec.get("id"),
            "status": rec.get("status"),
            "thesis": one_line(rec.get("thesis"), 200),
            "quote": one_line(rec.get("quote")),
            "mechanism": mechanism(rec, pg_root),
        }
        for *_, rec in ranked[:limit]
    ]


def log_path(arg):
    return Path(arg or os.environ.get(LOG_ENV) or DEFAULT_LOG)


def append_log(path, query, results):
    line = {
        "ts": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "query": query,
        "n_results": len(results),
        "ids": [r["id"] for r in results],
    }
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(line, ensure_ascii=False) + "\n")
    except OSError as e:
        print(f"ledger-search: usage log not written ({e})", file=sys.stderr)


def returned_ids(path, window_days, now):
    since = now - timedelta(days=window_days)
    seen = set()
    if not path.is_file():
        return seen
    for raw in path.read_text(encoding="utf-8", errors="replace").splitlines():
        try:
            entry = json.loads(raw)
        except json.JSONDecodeError:
            continue
        ts = lc.parse_ts(entry.get("ts")) if isinstance(entry, dict) else None
        ids = entry.get("ids") if isinstance(entry, dict) else None
        if ts and ts >= since and isinstance(ids, list):
            seen.update(i for i in ids if isinstance(i, str))
    return seen


def unused(records, log, window_days, now):
    seen = returned_ids(log, window_days, now)
    return [r for r in records if searchable(r) and r.get("id") not in seen and not lc.filled(r.get("trigger"))]


def main(argv=None):
    ap = argparse.ArgumentParser(description=(__doc__ or "").split("\n")[0])
    ap.add_argument("query", nargs="?", default="")
    ap.add_argument("-n", type=int, default=8)
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--log", default=None)
    ap.add_argument("--ledger", default=None)
    ap.add_argument("--pg-root", default=str(lc.PG_ROOT_DEFAULT))
    ap.add_argument("--unused", action="store_true")
    ap.add_argument("--window-days", type=int, default=28)
    args = ap.parse_args(argv)
    ledger = Path(args.ledger) if args.ledger else Path(args.pg_root) / "pg" / "knowledge-ledger.jsonl"
    try:
        records = lc.read_ledger(ledger)
    except (OSError, ValueError, TypeError) as e:
        print(f"ledger-search: {e}", file=sys.stderr)
        return 2
    log = log_path(args.log)
    if args.unused:
        cand = unused(records, log, args.window_days, datetime.now(timezone.utc))
        print(f"archive candidates (W, not returned in {args.window_days} days, no trigger): {len(cand)}")
        for rec in cand[:20]:
            print(f"  {rec.get('id')} [{rec.get('status')}] {one_line(rec.get('thesis'), 100)}")
        return 0
    if not args.query.strip():
        print("ledger-search: give a query or --unused", file=sys.stderr)
        return 2
    results = search(records, args.query, args.pg_root, args.n)
    append_log(log, args.query, results)
    if args.json:
        print(json.dumps(results, ensure_ascii=False, indent=2))
        return 0
    if not results:
        print("no matching W thesis")
    for r in results:
        print(f"{r['id']} [{r['status']}] {r['thesis']}")
        if r["quote"]:
            print(f"    > {r['quote']}")
        print(f"    mechanism: {r['mechanism']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

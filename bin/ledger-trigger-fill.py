#!/usr/bin/env python3
"""ledger-trigger-fill.py: deterministic fill of `trigger` in pg/knowledge-ledger.jsonl (no model judgement).

Usage:
  python3 bin/ledger-trigger-fill.py [--check] [--ledger F] [--pg-root DIR]

1. For records with status MAMY / CZĘŚCIOWO and an empty `trigger`: the first file cited in `evidence`
   (cite extraction and the existence check are ledger-check.py's) that exists in the repo and lives under
   hooks/, git-hooks/, bin/, agents/ or a .github/workflows/ path becomes the trigger (repo-relative path).
   A cited `.github/workflows/X` resolves to `templates/repo/.github/workflows/X` when only the template exists.
   A non-empty trigger is never overwritten (idempotent).
2. Records with status `unknown` become `NIE DOTYCZY` only when the evidence itself says there is nothing new
   for PG (nothing new / summary / transition / intro / glossary / formatting junk) and names no other status.
   The rest stay `unknown` and are printed with the reason.

--check prints the counts and writes nothing. Exit 0 always (it is a filler, not a gate); 2 = bad input.
"""
import argparse
import importlib.util
import json
import os
import re
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("ledger_check", HERE / "ledger-check.py")
assert _spec is not None and _spec.loader is not None
lc = importlib.util.module_from_spec(_spec)
sys.modules.setdefault("ledger_check", lc)
_spec.loader.exec_module(lc)

TRIGGER_KINDS = {"hook", "git-hook", "tool", "agent"}
WORKFLOW_PREFIX = ".github/workflows/"
TEMPLATE_WORKFLOWS = "templates/repo/.github/workflows/"
NOTHING_NEW = re.compile(
    r"nic nowego|nic (?:wi[eę]cej )?do PG|podsumowani|przej[sś]cie|wst[eę]p|słownik|[sś]mieci formatowania",
    re.IGNORECASE,
)
OTHER_STATUS = re.compile(r"\b(?:MAMY|CZĘŚCIOWO|BRAK)\b")


def resolve(cite, pg_root):
    """Repo-relative existing mechanism path for one cite, or None."""
    cite = cite.removeprefix(".claude/")
    root = Path(pg_root)
    candidates = [cite]
    if cite.startswith(WORKFLOW_PREFIX):
        candidates.append(TEMPLATE_WORKFLOWS + cite[len(WORKFLOW_PREFIX):])
    for path in candidates:
        is_workflow = path.startswith((WORKFLOW_PREFIX, TEMPLATE_WORKFLOWS))
        if (is_workflow or lc.mechanism_kind(path) in TRIGGER_KINDS) and (root / path).is_file():
            return path
    return None


def trigger_for(rec, pg_root):
    explicit = rec.get("mechanism")
    if isinstance(explicit, list) and explicit:
        cites = [str(m).split(":")[0] for m in explicit]
    else:
        text = str(rec.get("evidence") or "")[: lc.EVIDENCE_SCAN_CHARS]
        cites = [m.group(1) for m in lc.CITE_RX.finditer(text)]
    for cite in cites:
        path = resolve(cite, pg_root)
        if path:
            return path
    return None


def unknown_verdict(rec):
    """(new_status or None, reason) for a record with status `unknown`."""
    evidence = str(rec.get("evidence") or "")
    if OTHER_STATUS.search(evidence):
        return None, "evidence names another status"
    if NOTHING_NEW.search(evidence):
        return "NIE DOTYCZY", "evidence says nothing new for PG"
    return None, "evidence does not say there is nothing new"


def fill(records, pg_root):
    """Mutates records in place; returns the stats dict and the list of unresolved unknown records."""
    stats = {"trigger_set": 0, "used_without_trigger": 0, "nd_set": 0, "unknown_left": 0}
    left = []
    for rec in records:
        status = rec.get("status")
        if status in lc.USED_STATUSES and not lc.filled(rec.get("trigger")):
            path = trigger_for(rec, pg_root)
            if path:
                rec["trigger"] = path
                stats["trigger_set"] += 1
            else:
                stats["used_without_trigger"] += 1
        elif status == "unknown":
            new, reason = unknown_verdict(rec)
            if new:
                rec["status"] = new
                stats["nd_set"] += 1
            else:
                stats["unknown_left"] += 1
                left.append((rec, reason))
    return stats, left


def main(argv=None):
    ap = argparse.ArgumentParser(description=(__doc__ or "").split("\n")[0])
    ap.add_argument("--check", action="store_true", help="print counts, write nothing")
    ap.add_argument("--pg-root", default=str(lc.PG_ROOT_DEFAULT))
    ap.add_argument("--ledger", default=None)
    args = ap.parse_args(argv)
    ledger = Path(args.ledger) if args.ledger else Path(args.pg_root) / "pg" / "knowledge-ledger.jsonl"
    try:
        records = lc.read_ledger(ledger)
    except (OSError, ValueError, TypeError) as e:
        print(f"ledger-trigger-fill: {e}", file=sys.stderr)
        return 2
    stats, left = fill(records, args.pg_root)
    for key, value in stats.items():
        print(f"{key}: {value}")
    w_with = sum(1 for r in records if r.get("weight") == "W" and lc.filled(r.get("trigger")))
    w_wired = sum(1 for r in records if r.get("weight") == "W" and lc.has_trigger(r))
    print(f"w_with_trigger: {w_with}")
    # ledger-check closes a thesis only with trigger AND place (or wont); print that number too, so the two never read as one.
    print(f"w_wired_for_closure: {w_wired}")
    for rec, reason in left:
        print(f"unknown: {rec.get('id')} [{reason}] {str(rec.get('evidence') or '')[:100]}")
    if not args.check:
        fd, tmp = tempfile.mkstemp(dir=ledger.parent, prefix=ledger.name + ".", suffix=".tmp")
        try:  # tmp + fsync + rename: a crash must not leave a half-written ledger
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                fh.write("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in records))
                fh.flush()
                os.fsync(fh.fileno())
            os.chmod(tmp, ledger.stat().st_mode & 0o777)
            os.replace(tmp, ledger)
        except BaseException:
            Path(tmp).unlink(missing_ok=True)
            raise
        print(f"written: {ledger}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

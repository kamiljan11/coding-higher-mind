#!/usr/bin/env python3
"""ack-check: proof-of-reading check for the knowledge ledger (rules.md R2).

Usage:
  python3 bin/ack-check.py --ledger-source SOURCE [--ledger pg/knowledge-ledger.jsonl] [--vault DIR] [--pg-root DIR]
  python3 bin/ack-check.py --ledger-source general --refs-dir RUN/general-refs

For every ledger record of SOURCE the check fails when:
  - there are no records of SOURCE at all,
  - `quote` is missing or not 8-40 words,
  - the quote is not found verbatim (whitespace-normalised) in `file`
    (source=general: in <refs-dir>/<id>.txt instead, which is a web fragment fetched in the run),
  - `line` is set but the quote does not start on that line,
  - one quote is reused by records of a different source (one quote cannot prove reading of two sources).
File resolution: `Knowledge/...` -> under --vault (default ~/Obsidian/MAIN); anything else -> under --pg-root
(default: current directory = the PG tree). Absolute paths and `..` are refused (the ledger is tracked in git).
Playbook acks (pg/playbooks/acks/*.jsonl, P11) are a separate mode added with the playbooks.
Exit codes: 0 ok, 1 problems found, 2 tool error.
"""
import argparse
import json
import re
import sys
from pathlib import Path

VAULT_DEFAULT = Path.home() / "Obsidian/MAIN"
MIN_WORDS, MAX_WORDS = 8, 40
WS = re.compile(r"\s+")


def norm(text):
    return WS.sub(" ", text).strip()


STR_FIELDS = ("source", "id", "file", "thesis", "quote", "weight", "weight_reason", "status", "evidence",
              "duplicate_of", "reference")


def type_errors(records, label="wiersz"):
    """Fields that must be text (or absent/null) but are not; `line` must be an integer or null.

    A wrong JSON type is a broken input file, not a finding about knowledge: callers turn it into exit 2.
    """
    errors = []
    for i, r in enumerate(records, 1):
        bad = [k for k in STR_FIELDS if r.get(k) is not None and not isinstance(r[k], str)]
        if r.get("line") is not None and (isinstance(r["line"], bool) or not isinstance(r["line"], int)):
            bad.append("line")
        if bad:
            errors.append(f"{label} {i}: pola o zlym typie JSON {bad}")
    return errors


def resolve(file, vault, pg_root):
    p = Path(file)
    if p.is_absolute() or ".." in p.parts:
        raise ValueError(f"sciezka bezwzgledna albo z '..' niedozwolona: {file}")
    return (Path(vault) if p.parts and p.parts[0] == "Knowledge" else Path(pg_root)) / p


def quote_line(text, quote):
    """1-based line where the whitespace-normalised quote starts in text, or None when absent."""
    q = norm(quote)
    if not q:
        return None
    flat, offsets = [], []  # normalised text with a map back to original line numbers
    line = 1
    prev_space = True
    for ch in text:
        if ch.isspace():
            if not prev_space:
                flat.append(" ")
                offsets.append(line)
            prev_space = True
        else:
            flat.append(ch)
            offsets.append(line)
            prev_space = False
        if ch == "\n":
            line += 1
    idx = "".join(flat).find(q)
    return offsets[idx] if idx >= 0 else None


def check_records(records, source, vault, pg_root, refs_dir=None):
    problems = []
    mine = [r for r in records if r.get("source") == source]
    if not mine:
        return [f"brak rekordow zrodla {source}"]
    owners = {}
    for r in records:
        q = norm(r.get("quote") or "")
        if q:
            owners.setdefault(q, set()).add(r.get("source"))
    cache = {}
    for r in mine:
        rid = r.get("id", "?")
        quote = r.get("quote")
        if not quote:
            problems.append(f"{rid}: brak quote")
            continue
        n = len(norm(quote).split())
        if not MIN_WORDS <= n <= MAX_WORDS:
            problems.append(f"{rid}: quote ma {n} slow (wymagane {MIN_WORDS}-{MAX_WORDS})")
        if len(owners.get(norm(quote), ())) > 1:
            problems.append(f"{rid}: ten sam cytat w roznych zrodlach {sorted(owners[norm(quote)])}")
        try:
            if source == "general":
                if not refs_dir:
                    raise ValueError("source=general wymaga --refs-dir")
                path = Path(refs_dir) / f"{rid}.txt"
            else:
                path = resolve(r.get("file") or "", vault, pg_root)
            if path not in cache:
                cache[path] = path.read_text(encoding="utf-8") if path.is_file() else None
        except ValueError as e:
            problems.append(f"{rid}: {e}")
            continue
        text = cache[path]
        if text is None:
            problems.append(f"{rid}: plik zrodla nie istnieje: {path}")
            continue
        at = quote_line(text, quote)
        if at is None:
            problems.append(f"{rid}: cytat nie wystepuje doslownie w {r.get('file') if source != 'general' else path.name}")
        elif source != "general" and r.get("line") not in (None, at):
            problems.append(f"{rid}: line={r.get('line')}, a cytat zaczyna sie w linii {at}")
    return problems


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--ledger-source", required=True)
    ap.add_argument("--ledger", default="pg/knowledge-ledger.jsonl")
    ap.add_argument("--vault", default=str(VAULT_DEFAULT))
    ap.add_argument("--pg-root", default=".")
    ap.add_argument("--refs-dir")
    a = ap.parse_args(argv)
    try:
        records = [json.loads(l) for l in Path(a.ledger).read_text(encoding="utf-8").split("\n") if l.strip()]
        bad = [i for i, r in enumerate(records, 1) if not isinstance(r, dict)]
        if bad:
            raise ValueError(f"wiersze rejestru niebedace obiektem JSON: {bad[:10]}")
        wrong = type_errors(records, "wiersz rejestru")
        if wrong:
            raise ValueError("; ".join(wrong[:10]))
        problems = check_records(records, a.ledger_source, a.vault, a.pg_root, a.refs_dir)
    except (OSError, ValueError) as e:
        print(f"ack-check: blad narzedzia: {e}", file=sys.stderr)
        return 2
    n = sum(r.get("source") == a.ledger_source for r in records)
    print(json.dumps({"source": a.ledger_source, "records": n, "problems": len(problems), "first": problems[:20]},
                     ensure_ascii=False))
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())

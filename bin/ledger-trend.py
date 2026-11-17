#!/usr/bin/env python3
"""ledger-trend.py: one periodic measurement of the knowledge ledger, compared with the previous one.

  python3 bin/ledger-trend.py [--history F] [--dry-run] [--json] [ledger-check options: --ledger --sources
                              --vault --pg-root --logs --window-days --now]

Why: `ledger-check --usage` is one measurement without memory. Knowledge dies quietly between measurements:
a hook that used to fire stops firing, notes appear that nobody indexed, theses disappear from a source.
This tool runs `ledger-check --usage --json`, appends a snapshot line to the history file and reports what got
WORSE since the previous snapshot:
  went_silent     mechanism files that are silent now and were not silent before (both snapshots need
                  telemetry `ok`; otherwise the comparison is skipped and `telemetry` is reported instead);
  gaps_grew       a closure number (see ledger-check GAP_KEYS) that is larger than before;
  theses_lost     sources whose thesis count dropped;
  telemetry       telemetry is missing or stale, so usage cannot be measured at all.
The first run only writes the baseline. Nothing is fixed or blocked here: the output is a work list.

Not wired anywhere on purpose. Running it on a schedule (weekly task, or a section of guard_health) is a
decision made when this branch is merged; until then nothing calls it and it writes nothing by itself.

Exit: 0 = nothing got worse (or baseline), 1 = something got worse, 2 = bad input / ledger-check failed.
"""
import argparse
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
HISTORY_DEFAULT = Path.home() / ".claude" / "logs" / "knowledge-trend.jsonl"
GAP_KEYS = (  # same list as ledger-check.py GAP_KEYS; a test keeps the two equal
    "w_without_trigger", "w_without_status", "invalid_weight", "duplicates", "dangling_duplicate_of",
    "count_mismatch", "unregistered_sources", "unindexed_files", "ignored_with_theses",
)
USAGE_KEYS = ("theses_used", "with_mechanism", "fired", "fired_inherited", "skipped", "silent", "unmeasured",
              "unknown", "no_mechanism")
PASS_THROUGH = ("ledger", "sources", "vault", "pg_root", "logs", "window_days", "now")
MEASURE_TIMEOUT_S = 300  # the real ledger takes ~1 s; a scheduled run must not hang on broken logs
SNAPSHOT_KEYS = {"ts": str, "by_source": dict, "gaps": dict, "telemetry": str, "silent_mechanisms": list}


def size(value):
    return len(value) if isinstance(value, (list, dict)) else int(value or 0)


def measure(args):
    """Run ledger-check --usage --json; returns its report or raises ValueError with its stderr."""
    cmd = [sys.executable, str(HERE / "ledger-check.py"), "--usage", "--json"]
    for name in PASS_THROUGH:
        value = getattr(args, name)
        if value is not None:
            cmd += [f"--{name.replace('_', '-')}", str(value)]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, check=False, timeout=MEASURE_TIMEOUT_S)
    except subprocess.TimeoutExpired:
        raise ValueError(f"ledger-check did not finish in {MEASURE_TIMEOUT_S} s") from None
    if proc.returncode not in (0, 1):
        raise ValueError(f"ledger-check exit {proc.returncode}: {proc.stderr.strip()[:300]}")
    return json.loads(proc.stdout)


def snapshot(report, ts):
    usage = report["usage"]
    return {
        "ts": ts,
        "total": report["total"],
        "by_source": report["by_source"],
        "gaps": {key: size(report.get(key)) for key in GAP_KEYS},
        "telemetry": usage["telemetry"],
        "usage": {key: usage.get(key, 0) for key in USAGE_KEYS},
        "silent_mechanisms": sorted(m["path"] for m in usage.get("silent_mechanisms", [])),
    }


def read_last(path):
    """Last valid snapshot of the history file, or None (missing file / no valid line)."""
    path = Path(path)
    if not path.is_file():
        return None
    last = None
    for line in path.read_text(encoding="utf-8").splitlines():
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue  # a torn line must not stop the measurement; the next snapshot is still appended
        if isinstance(row, dict) and all(isinstance(row.get(k), t) for k, t in SNAPSHOT_KEYS.items()):
            last = row  # a row of another shape is skipped like a torn one: compare() reads exactly these keys
    return last


def compare(prev, cur):
    """What got worse between two snapshots (see module docstring)."""
    found = {}
    if cur["telemetry"] != "ok":
        found["telemetry"] = cur["telemetry"]
    elif prev["telemetry"] == "ok":
        went = sorted(set(cur["silent_mechanisms"]) - set(prev["silent_mechanisms"]))
        if went:
            found["went_silent"] = went
    grew = {key: [prev["gaps"].get(key, 0), n] for key, n in cur["gaps"].items() if n > prev["gaps"].get(key, 0)}
    if grew:
        found["gaps_grew"] = grew
    lost = {name: [n, cur["by_source"].get(name, 0)] for name, n in prev["by_source"].items()
            if cur["by_source"].get(name, 0) < n}
    if lost:
        found["theses_lost"] = lost
    return found


def render_text(result):
    cur = result["snapshot"]
    lines = [f"pomiar {cur['ts']}: {cur['total']} tez, telemetria: {cur['telemetry']}, uzycie: {cur['usage']}"]
    if result["baseline"]:
        return "\n".join([*lines, "pierwszy pomiar: zapisany jako punkt odniesienia, brak porownania"])
    found = result["worse"]
    if not found:
        return "\n".join([*lines, f"bez pogorszenia wzgledem {result['previous_ts']}"])
    lines.append(f"POGORSZENIE wzgledem {result['previous_ts']}:")
    if "telemetry" in found:
        lines.append(f"  telemetria {found['telemetry']}: uzycia nie da sie zmierzyc (sprawdz logi bramek)")
    lines += [f"  mechanizm ucichl: {path}" for path in found.get("went_silent", [])]
    lines += [f"  luka urosla: {key} {a} -> {b}" for key, (a, b) in found.get("gaps_grew", {}).items()]
    lines += [f"  zrodlo stracilo tezy: {name} {a} -> {b}" for name, (a, b) in found.get("theses_lost", {}).items()]
    return "\n".join(lines)


def main(argv=None):
    ap = argparse.ArgumentParser(description=(__doc__ or "").splitlines()[0])
    ap.add_argument("--history", default=str(HISTORY_DEFAULT))
    ap.add_argument("--dry-run", action="store_true", help="measure and compare, do not append the snapshot")
    ap.add_argument("--json", action="store_true")
    for name in PASS_THROUGH:
        ap.add_argument(f"--{name.replace('_', '-')}", dest=name)
    args = ap.parse_args(argv)
    try:
        report = measure(args)
        ts = args.now or datetime.now(timezone.utc).isoformat(timespec="seconds")
        cur = snapshot(report, ts)
        prev = read_last(args.history)
        worse = compare(prev, cur) if prev else {}
        if not args.dry_run:
            history = Path(args.history)
            history.parent.mkdir(parents=True, exist_ok=True)
            with history.open("a", encoding="utf-8") as fh:
                fh.write(json.dumps(cur, ensure_ascii=False) + "\n")
    except (OSError, ValueError, KeyError, TypeError) as e:
        print(f"ledger-trend: {e}", file=sys.stderr)
        return 2
    result = {"snapshot": cur, "baseline": prev is None, "previous_ts": prev["ts"] if prev else None, "worse": worse}
    print(json.dumps(result, ensure_ascii=False, indent=1) if args.json else render_text(result))
    return 1 if worse else 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""ledger-check.py: closure check of the knowledge ledger (pg/knowledge-ledger.jsonl) and usage report.

Usage:
  python3 bin/ledger-check.py [--json] [--usage] [--ledger F] [--sources F] [--vault DIR] [--pg-root DIR]
                              [--logs DIR] [--window-days N] [--now ISO]

Closure (always): total, by_source, w_without_trigger, w_without_status (`pending` counts as no status),
invalid_weight, duplicates, dangling_duplicate_of,
count_mismatch, unregistered_sources, unindexed_files, ignored_with_theses. Reported only, never block:
w_without_micro_steps and s_without_trigger (their phases fill them; a gate on them today would fail every
run), ignored (how many notes each exclusion hides) and ignored_stale (exclusions that match no note).

Source registry (pg/knowledge-sources.json, required): {"<source>": {"expect": N, "indexed_files": [...]}}.
  - `expect` = number of theses the last verified import of that source wrote; another count in the ledger
    means theses were lost or added without a verified import. Update it in the same commit as the import.
  - `indexed_files` = vault-relative notes of the source that were read but yielded no thesis.
  - New source: import it (bin/ledger-import-generic.py), verify it, then add its entry here.
  - A note under Knowledge/ that is not PG knowledge gets frontmatter `pg-ignore: true`, or is listed under the
    reserved key `_ignored`: {"<vault-relative note, or directory ending with />": "<reason>"}. Every entry
    needs a reason; the report shows how many notes each entry hides, so an exclusion is never silent.
    An excluded note that still has theses in the ledger is a gap (decide: knowledge or not).

--usage adds `usage`: for every MAMY / CZĘŚCIOWO thesis, the mechanism files it rests on (field `mechanism`,
else the `path:line` cites of `evidence`) and whether telemetry shows them WORKING inside the window:
  fired       a mechanism logged ran / blocked / would_block (or a review outcome for an agent role);
              `fired_inherited` = only through the hook that calls the cited tool (weaker evidence);
  skipped     its mechanisms woke up but only logged skipped / bypass / suppressed;
  silent      a hook, git hook or agent role left no event at all (candidate for dead knowledge, not proof);
  unmeasured  only mechanisms that cannot leave a trace under their own name (template, card, skill, policy,
              and tools / hook libraries: a file name inside a hook's source is not proof of a call);
  unknown     telemetry is missing or stale (last event older than STALE_DAYS before --now).
No target value and no history here: one run = one measurement. Nothing runs this tool on a schedule yet;
the periodic run that stores the trend is a separate change (dead-knowledge guard).
Granularity is the FILE of the mechanism, not the rule line.

Exit: 0 = closed, 1 = gaps, 2 = bad input (also: missing ledger, source registry or Knowledge/ directory).
"""
import argparse
import json
import re
import sys
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path

PG_ROOT_DEFAULT = Path(__file__).resolve().parent.parent
VAULT_DEFAULT = Path.home() / "Obsidian" / "MAIN"
LOGS_DEFAULT = Path.home() / ".claude" / "logs"
WEIGHTS = {"W", "Ś", "N"}
STATUSES = {"MAMY", "CZĘŚCIOWO", "BRAK", "NIE DOTYCZY", "pending"}
USED_STATUSES = {"MAMY", "CZĘŚCIOWO"}
EXCLUDED_DIRS = ("How-To", "the company", "career_readiness")
MICRO_KEYS = ("action", "output", "verify", "done_when")
IGNORED_KEY = "_ignored"  # reserved key of the source registry: notes that are not PG knowledge
# Events that prove a gate did its job; skipped / bypass / suppressed only prove it woke up.
WORK_EVENTS = {"ran", "blocked", "would_block"}
STALE_DAYS = 2
EVIDENCE_SCAN_CHARS = 4000  # CITE_RX backtracks quadratically on long text without a file extension
CITE_RX = re.compile(
    r"((?:[A-Za-z0-9_.\-]+/)+[A-Za-z0-9_.\-]+\.(?:md|js|mjs|cjs|py|json|ya?ml|sh|ts|tsx|sql|txt)"
    r"|git-hooks/[a-z][a-z\-]+|CLAUDE\.md)(?::\d+)?"
)
# Mechanism file stem -> name used in telemetry, where the two differ.
TELEMETRY_ALIAS = {
    "bash-rules": "bash-guard",
    "post-edit-check": "post-edit",
    "outbound-observe": "outbound",
    "protected-paths": "edit-guard",
}
# Kinds that log under their own name. A tool logs only through the hook that calls it.
SELF_LOGGING_KINDS = {"hook", "git-hook", "agent"}
CALLER_DIRS = ("hooks", "git-hooks")


def read_ledger(path):
    records = []
    for n, line in enumerate(Path(path).read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        try:
            rec = json.loads(line)
        except json.JSONDecodeError as e:
            raise ValueError(f"{path}:{n}: zly JSON ({e.msg})") from e
        if not isinstance(rec, dict):
            raise TypeError(f"{path}:{n}: wiersz nie jest obiektem")
        records.append(rec)
    return records


def read_sources(path):
    path = Path(path)
    if not path.is_file():
        raise ValueError(f"brak rejestru zrodel: {path} (bez niego kontrola liczby tez nie dziala)")
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict) or not all(isinstance(v, dict) for v in data.values()):
        raise TypeError(f"{path}: oczekiwany obiekt {{zrodlo: {{expect, indexed_files}}}}")
    ignored = data.pop(IGNORED_KEY, {})
    bad = sorted(str(k) for k, v in ignored.items() if not filled(v) or not str(k).startswith("Knowledge/"))
    if bad:
        raise ValueError(f"{path}: wpis {IGNORED_KEY} bez powodu albo spoza Knowledge/: {bad[:5]}")
    return data, ignored


def filled(value):
    return isinstance(value, str) and bool(value.strip())


def has_trigger(rec):
    """A thesis is wired when it names a trigger and the place realising it, or carries a recorded refusal."""
    return (filled(rec.get("trigger")) and filled(rec.get("place"))) or filled(rec.get("wont"))


def has_micro_steps(rec):
    steps = rec.get("micro_steps")
    if not isinstance(steps, list) or not steps:
        return False
    return all(isinstance(s, dict) and all(filled(s.get(k)) for k in MICRO_KEYS) for s in steps)


def frontmatter_ignored(path):
    try:
        head = path.read_text(encoding="utf-8", errors="replace")[:2000]
    except OSError:
        return False
    if not head.startswith("---"):
        return False
    end = head.find("\n---", 3)
    block = head[3:end] if end != -1 else head
    return re.search(r"^pg-ignore:\s*true\s*$", block, re.MULTILINE) is not None


def ignore_entry(rel, ignored):
    """The `_ignored` key covering this vault-relative note (exact note, or a directory entry ending with /)."""
    if rel in ignored:
        return rel
    return next((key for key in ignored if key.endswith("/") and rel.startswith(key)), None)


def unindexed_files(records, sources, vault, ignored=None):
    """Notes under Knowledge/ that no thesis and no registry entry points at, plus what `_ignored` hides.

    Returns (unindexed, hidden, with_theses): `hidden` = {entry: number of notes it excludes} (0 = stale entry),
    `with_theses` = excluded notes that still have theses in the ledger.
    """
    ignored = ignored or {}
    root = Path(vault) / "Knowledge"
    if not root.is_dir():
        raise ValueError(f"brak katalogu notatek: {root} (bez niego kontrola plikow bez tez nie dziala)")
    known = {r.get("file") for r in records if filled(r.get("file"))}
    for entry in sources.values():
        known.update(entry.get("indexed_files") or [])
    theses_files = {r.get("file") for r in records if filled(r.get("file"))}
    out, hidden, with_theses = [], dict.fromkeys(sorted(ignored), 0), []
    for path in sorted(root.rglob("*.md")):
        rel = path.relative_to(vault).as_posix()
        if any(part in EXCLUDED_DIRS for part in path.relative_to(root).parts):
            continue
        entry = ignore_entry(rel, ignored)
        if entry is not None:
            hidden[entry] += 1
            if rel in theses_files:
                with_theses.append(rel)
            continue
        if rel in known or frontmatter_ignored(path):
            continue
        out.append(rel)
    return out, hidden, with_theses


def closure(records, sources, vault, ignored=None):
    unindexed, hidden, with_theses = unindexed_files(records, sources, vault, ignored)
    by_source = Counter(str(r.get("source")) for r in records)
    ids = Counter(r.get("id") for r in records)
    known_ids = set(ids)
    w = [r for r in records if r.get("weight") == "W"]
    s = [r for r in records if r.get("weight") == "Ś"]
    mismatch = [
        {"source": name, "expect": entry.get("expect"), "found": by_source.get(name, 0)}
        for name, entry in sorted(sources.items())
        if entry.get("expect") != by_source.get(name, 0)
    ]
    return {
        "total": len(records),
        "by_source": dict(sorted(by_source.items())),
        "w_total": len(w),
        "w_without_trigger": sum(1 for r in w if not has_trigger(r)),
        "w_without_status": sum(1 for r in w if r.get("status") not in STATUSES - {"pending"}),
        "w_without_micro_steps": sum(1 for r in w if not has_micro_steps(r)),
        "s_total": len(s),
        "s_without_trigger": sum(1 for r in s if not (has_trigger(r) or filled(r.get("card_only")))),
        "invalid_weight": sorted(str(r.get("id")) for r in records if r.get("weight") not in WEIGHTS),
        "duplicates": sorted(str(i) for i, n in ids.items() if n > 1),
        "dangling_duplicate_of": sorted(
            str(r.get("id")) for r in records if filled(r.get("duplicate_of")) and r["duplicate_of"] not in known_ids
        ),
        "count_mismatch": mismatch,
        "unregistered_sources": sorted(name for name in by_source if name not in sources),
        "unindexed_files": unindexed,
        "ignored": hidden,
        "ignored_stale": sorted(key for key, n in hidden.items() if n == 0),
        "ignored_with_theses": with_theses,
    }


def mechanism_kind(path):
    if path.startswith("hooks/"):
        return "hook"
    if path.startswith("git-hooks/"):
        return "git-hook"
    if path.startswith("bin/"):
        return "tool"
    if path.startswith("agents/"):
        return "agent"
    if path.startswith("skills/"):
        return "skill"
    if path.startswith("templates/"):
        return "template"
    if path.startswith("pg/"):
        return "card"
    return "policy"


def telemetry_key(path):
    stem = Path(path).name
    for suffix in (".js", ".mjs", ".cjs", ".py", ".sh", ".md"):
        if stem.endswith(suffix):
            stem = stem[: -len(suffix)]
            break
    if mechanism_kind(path) == "agent":
        return "role:" + stem.removesuffix("-reviewer")
    stem = TELEMETRY_ALIAS.get(stem, stem)
    return stem.lower().replace("_", "-")


def mechanisms_of(rec, pg_root):
    """Mechanism files of a thesis: explicit `mechanism` list, else files cited in evidence that exist."""
    explicit = rec.get("mechanism")
    if isinstance(explicit, list) and explicit:
        cites = [str(m).split(":")[0] for m in explicit]
    else:
        cites = [m.group(1) for m in CITE_RX.finditer(str(rec.get("evidence") or "")[:EVIDENCE_SCAN_CHARS])]
    seen = []
    for path in cites:
        if path not in seen and (Path(pg_root) / path).exists():
            seen.append(path)
    return seen


def parse_ts(text):
    """ISO time as aware UTC; a time without zone is read as UTC (the gate log writes Z)."""
    try:
        ts = datetime.fromisoformat(str(text).replace("Z", "+00:00"))
    except ValueError:
        return None
    return ts if ts.tzinfo else ts.replace(tzinfo=timezone.utc)


def read_telemetry(logs, since):
    """Per telemetry name: Counter(work=n, woke=n) since `since`, plus the span the logs really cover."""
    seen = {}
    first = last = None
    logs = Path(logs)
    for path in [*sorted(logs.glob("gates*.jsonl")), logs / "review-outcomes.jsonl"]:
        if not path.is_file():
            continue
        for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
            try:
                ev = json.loads(line)
            except json.JSONDecodeError:
                continue
            ts = parse_ts(ev.get("ts")) if isinstance(ev, dict) else None
            if ts is None:
                continue
            first = ts if first is None or ts < first else first
            last = ts if last is None or ts > last else last
            if ts < since:
                continue
            names = [ev[k].lower().replace("_", "-") for k in ("hook", "gate") if filled(ev.get(k))]
            # A line with a wrong field type is skipped like a broken JSON line: one bad log entry
            # must not take the whole report down.
            raw_roles, event = ev.get("roles"), ev.get("event")
            roles = [f"role:{role}" for role in raw_roles if isinstance(role, str)] if isinstance(raw_roles, list) else []
            event = event if isinstance(event, str) else None
            kind = "work" if roles or event in WORK_EVENTS else "woke"
            for name in names + roles:
                seen.setdefault(name, Counter())[kind] += 1
    return seen, first, last


def callers_of(pg_root):
    """Lookup: mechanism path -> telemetry names of the hooks whose source mentions that file name.

    Only for files that do not log under their own name: tools (bin/) and hook libraries (hooks/lib/).
    """
    root = Path(pg_root)
    texts = {}
    for folder in CALLER_DIRS:
        base = root / folder
        for path in sorted(base.glob("*")) if base.is_dir() else []:
            if path.is_file():
                texts[path.relative_to(root).as_posix()] = path.read_text(encoding="utf-8", errors="replace")
    cache = {}

    def lookup(mech):
        if mech not in cache:
            callable_by_hook = mechanism_kind(mech) == "tool" or mech.startswith("hooks/lib/")
            # Stem, not file name: hooks load their libraries as require('./lib/arch-signals') without ".js".
            name = re.compile(r"(?<![\w-])" + re.escape(Path(mech).stem) + r"(?![\w-])")
            cache[mech] = (
                [telemetry_key(src) for src, text in texts.items() if src != mech and name.search(text)]
                if callable_by_hook
                else []
            )
        return cache[mech]

    return lookup


def logs_itself(mech):
    return mechanism_kind(mech) in SELF_LOGGING_KINDS and not mech.startswith("hooks/lib/")


def classify(mechs, seen, callers):
    """One thesis -> fired | fired_inherited | skipped | silent | unmeasured."""
    own = [telemetry_key(m) for m in mechs if logs_itself(m)]
    inherited = [key for m in mechs for key in callers(m)]
    if any(seen.get(k, {}).get("work") for k in own):
        return "fired"
    if any(seen.get(k, {}).get("work") for k in inherited):
        return "fired_inherited"
    if any(seen.get(k, {}).get("woke") for k in own + inherited):
        return "skipped"
    # Tools and hook libraries never log under their own name, so their silence proves nothing: unmeasured.
    return "silent" if own else "unmeasured"


def usage(records, pg_root, logs, window_days, now):
    since = now - timedelta(days=window_days)
    seen, first, last = read_telemetry(logs, since)
    covered = round((min(last, now) - max(first, since)).total_seconds() / 86400, 1) if first and last and last > since else 0.0
    age = round((now - last).total_seconds() / 86400, 1) if last else None
    in_window = bool(last and last > since)  # not `covered`: a log shorter than 1.2 h rounds to 0.0 days
    state = "missing" if not in_window else "stale" if age is not None and age > STALE_DAYS else "ok"
    callers = callers_of(pg_root)
    used = [r for r in records if r.get("status") in USED_STATUSES]
    classes = Counter()
    kinds = Counter()
    quiet = {"silent": Counter(), "skipped": Counter()}
    for rec in used:
        mechs = mechanisms_of(rec, pg_root)
        if not mechs:
            classes["no_mechanism"] += 1
            continue
        kinds.update(mechanism_kind(m) for m in mechs)
        cls = classify(mechs, seen, callers)
        if cls != "unmeasured" and state != "ok":
            cls = "unknown"
        classes[cls] += 1
        if cls in quiet:
            quiet[cls].update(m for m in mechs if logs_itself(m))
    total = len(used)
    fired = classes["fired"] + classes["fired_inherited"]
    pct = (lambda n: round(100.0 * n / total, 1)) if total else (lambda n: 0.0)
    return {
        "granularity": "file",
        "telemetry": state,
        "window": {
            "requested_days": window_days,
            "covered_days": covered,
            "log_age_days": age,
            "log_first": first.isoformat() if first else None,
            "log_last": last.isoformat() if last else None,
        },
        "theses_used": total,
        "with_mechanism": total - classes["no_mechanism"],
        "with_mechanism_pct": pct(total - classes["no_mechanism"]),
        "fired": fired,
        "fired_pct": pct(fired),
        "fired_inherited": classes["fired_inherited"],
        "skipped": classes["skipped"],
        "silent": classes["silent"],
        "unmeasured": classes["unmeasured"],
        "unknown": classes["unknown"],
        "no_mechanism": classes["no_mechanism"],
        "mechanism_cites_by_kind": dict(sorted(kinds.items())),
        "silent_mechanisms": [{"path": p, "theses": n} for p, n in quiet["silent"].most_common()],
        "skipped_mechanisms": [{"path": p, "theses": n} for p, n in quiet["skipped"].most_common()],
    }


GAP_KEYS = (
    "w_without_trigger", "w_without_status", "invalid_weight", "duplicates", "dangling_duplicate_of",
    "count_mismatch", "unregistered_sources", "unindexed_files", "ignored_with_theses",
)


def has_gaps(report):
    return any(report[key] for key in GAP_KEYS)


def render_text(report):
    lines = [
        f"rejestr: {report['total']} tez, zrodla: {report['by_source']}",
        f"W bez wyzwalacza: {report['w_without_trigger']} / {report['w_total']}",
        f"W bez statusu: {report['w_without_status']}; W bez mikro-krokow: {report['w_without_micro_steps']}",
        f"S bez wyzwalacza (tylko raport): {report['s_without_trigger']} / {report['s_total']}",
        (
            f"zla waga: {len(report['invalid_weight'])}; duplikaty id: {len(report['duplicates'])}; "
            f"duplicate_of bez celu: {len(report['dangling_duplicate_of'])}"
        ),
        f"niezgodna liczba tez: {report['count_mismatch']}; zrodla poza rejestrem: {report['unregistered_sources']}",
        f"pliki bez tez: {len(report['unindexed_files'])} (teza w rejestrze, wpis indexed_files albo pg-ignore: true)",
    ]
    lines += [f"  - {f}" for f in report["unindexed_files"][:20]]
    hidden = report.get("ignored") or {}
    if hidden:
        lines.append(
            f"wylaczone ({IGNORED_KEY}): {sum(hidden.values())} notatek w {len(hidden)} wpisach; "
            f"wpisy bez notatek: {report['ignored_stale']}; wylaczone z tezami w rejestrze: {report['ignored_with_theses']}"
        )
        lines += [f"  - {key}: {n}" for key, n in hidden.items()]
    u = report.get("usage")
    if u:
        w = u["window"]
        lines += [
            (
                f"uzycie (okno {w['requested_days']} d, logi pokrywaja {w['covered_days']} d, "
                f"ziarno: plik mechanizmu, telemetria: {u['telemetry']}):"
            ),
            f"  tezy MAMY/CZESCIOWO: {u['theses_used']}; z mechanizmem: {u['with_mechanism']} ({u['with_mechanism_pct']} %)",
            f"  odpalone: {u['fired']} ({u['fired_pct']} %), w tym tylko przez hook wolajacy: {u['fired_inherited']}",
            (
                f"  tylko pominiete/obejscie: {u['skipped']}; ciche: {u['silent']}; niemierzalne: {u['unmeasured']}; "
                f"nieznane (brak telemetrii): {u['unknown']}; bez mechanizmu: {u['no_mechanism']}"
            ),
        ]
        lines += [f"  cichy (kandydat na martwy): {m['path']} ({m['theses']} tez)" for m in u["silent_mechanisms"][:20]]
        lines += [f"  tylko pominiety: {m['path']} ({m['theses']} tez)" for m in u["skipped_mechanisms"][:10]]
    return "\n".join(lines)


def main(argv=None):
    ap = argparse.ArgumentParser(description=(__doc__ or "").splitlines()[0])
    ap.add_argument("--ledger", default=str(PG_ROOT_DEFAULT / "pg" / "knowledge-ledger.jsonl"))
    ap.add_argument("--sources", default=str(PG_ROOT_DEFAULT / "pg" / "knowledge-sources.json"))
    ap.add_argument("--vault", default=str(VAULT_DEFAULT))
    ap.add_argument("--pg-root", default=str(PG_ROOT_DEFAULT))
    ap.add_argument("--logs", default=str(LOGS_DEFAULT))
    ap.add_argument("--window-days", type=int, default=30)
    ap.add_argument("--now", help="ISO time used as the end of the usage window (tests)")
    ap.add_argument("--usage", action="store_true")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args(argv)
    try:
        records = read_ledger(args.ledger)
        sources, ignored = read_sources(args.sources)
        report = closure(records, sources, Path(args.vault), ignored)
        if args.usage:
            now = parse_ts(args.now) if args.now else datetime.now(timezone.utc)
            if now is None:
                raise ValueError(f"--now: zly czas ISO: {args.now}")
            report["usage"] = usage(records, args.pg_root, args.logs, args.window_days, now)
    except (OSError, ValueError, TypeError) as e:
        print(f"ledger-check: {e}", file=sys.stderr)
        return 2
    print(json.dumps(report, ensure_ascii=False, indent=1) if args.json else render_text(report))
    return 1 if has_gaps(report) else 0


if __name__ == "__main__":
    sys.exit(main())

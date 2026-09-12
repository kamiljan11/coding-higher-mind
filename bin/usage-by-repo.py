#!/usr/bin/env python3
"""usage-by-repo: „ekonomia projektow" dla floty na subskrypcji (slownik SH sekcja 18; PG gap L14). 0 tokenow.

Czyta transkrypty ~/.claude/projects/*/*.jsonl i liczy per TYDZIEN (ISO) per REPO: sesje, odpowiedzi modelu,
tool calle, tokeny wyjsciowe i wejsciowe (z cache). Repo = katalog gita z `cwd` sesji, a gdy cwd nie jest repo
(np. <workspace>) — najczesciej edytowane repo w tej sesji. Odpowiada na pytanie „ktore repo zjada limit
tygodniowy" liczbami, nie odczuciem. Nic nie wysyla, nic nie modyfikuje.

Uzycie: python usage-by-repo.py [--weeks 4] [--root ~/.claude/projects] [--json] [--out raport.md]
        python usage-by-repo.py --self-test
"""
from __future__ import annotations

import argparse
import collections
import datetime as dt
import glob
import json
import os
import sys
from typing import Any

EDIT_PATH_KEYS = ("file_path", "path", "notebook_path")


def week_key(ts_iso: str) -> str | None:
    """ISO timestamp -> 'RRRR-Www' (ISO week); None gdy nie da sie sparsowac."""
    try:
        when = dt.datetime.fromisoformat(ts_iso.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return None
    year, week, _ = when.isocalendar()
    return f"{year}-W{week:02d}"


def git_root(start: str, cache: dict[str, str | None], exists: Any = os.path.isdir) -> str | None:
    """Najblizszy katalog nadrzedny z `.git` (bez subprocessu). Cache per katalog."""
    cur = os.path.abspath(start)
    seen: list[str] = []
    while True:
        if cur in cache:
            root = cache[cur]
            break
        seen.append(cur)
        if exists(os.path.join(cur, ".git")):
            root = cur
            break
        parent = os.path.dirname(cur)
        if parent == cur:
            root = None
            break
        cur = parent
    for d in seen:
        cache[d] = root
    return root


def attribute_repo(cwd: str | None, edited_roots: collections.Counter[str], cache: dict[str, str | None], exists: Any = os.path.isdir) -> str:
    """Nazwa repo dla sesji: git root z cwd; inaczej najczesciej edytowane repo; inaczej basename(cwd)."""
    if cwd:
        root = git_root(cwd, cache, exists)
        if root:
            return os.path.basename(root)
    if edited_roots:
        return os.path.basename(edited_roots.most_common(1)[0][0])
    return os.path.basename(cwd) if cwd else "(brak cwd)"


def mine_file(path: str, cache: dict[str, str | None]) -> dict[str, Any]:
    weeks: dict[str, collections.Counter[str]] = collections.defaultdict(collections.Counter)
    edited_roots: collections.Counter[str] = collections.Counter()
    cwd: str | None = None
    with open(path, encoding="utf-8", errors="replace") as fh:
        for line in fh:
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                continue
            cwd = cwd or rec.get("cwd")
            msg = rec.get("message") or {}
            if not isinstance(msg, dict):
                continue
            wk = week_key(str(rec.get("timestamp", "")))
            if wk is None:
                continue
            content = msg.get("content")
            if isinstance(content, list):
                for part in content:
                    if isinstance(part, dict) and part.get("type") == "tool_use":
                        weeks[wk]["tool_calls"] += 1
                        inp = part.get("input") or {}
                        for key in EDIT_PATH_KEYS:
                            target = inp.get(key) if isinstance(inp, dict) else None
                            if isinstance(target, str) and target:
                                root = git_root(os.path.dirname(target), cache)
                                if root:
                                    edited_roots[root] += 1
            usage = msg.get("usage")
            if rec.get("type") == "assistant" and isinstance(usage, dict):
                weeks[wk]["responses"] += 1
                weeks[wk]["output_tokens"] += int(usage.get("output_tokens") or 0)
                weeks[wk]["input_tokens"] += int(usage.get("input_tokens") or 0) + int(usage.get("cache_creation_input_tokens") or 0) + int(usage.get("cache_read_input_tokens") or 0)
    return {"repo": attribute_repo(cwd, edited_roots, cache), "weeks": {k: dict(v) for k, v in weeks.items()}}


def aggregate(sessions: list[dict[str, Any]], since_week: str | None) -> dict[tuple[str, str], collections.Counter[str]]:
    table: dict[tuple[str, str], collections.Counter[str]] = collections.defaultdict(collections.Counter)
    for s in sessions:
        for wk, counts in s["weeks"].items():
            if since_week and wk < since_week:
                continue
            key = (wk, s["repo"])
            table[key]["sessions"] += 1
            for name, value in counts.items():
                table[key][name] += value
    return table


def render_markdown(table: dict[tuple[str, str], collections.Counter[str]]) -> str:
    total_out = sum(c["output_tokens"] for c in table.values()) or 1
    rows = ["| Tydzien | Repo | Sesje | Odpowiedzi | Tool calls | Output tok | Input tok (z cache) | Udzial output % |", "|---|---|---|---|---|---|---|---|"]
    for (wk, repo), c in sorted(table.items(), key=lambda kv: (kv[0][0], -kv[1]["output_tokens"])):
        rows.append(f"| {wk} | {repo} | {c['sessions']} | {c['responses']} | {c['tool_calls']} | {c['output_tokens']:,} | {c['input_tokens']:,} | {100 * c['output_tokens'] / total_out:.1f} |")
    return "\n".join(rows)


def self_test() -> int:
    failures = 0

    def check(name: str, cond: bool) -> None:
        nonlocal failures
        print(("ok   " if cond else "FAIL ") + name)
        if not cond:
            failures += 1

    check("week_key: ISO week", week_key("2026-09-12T10:00:00.000Z") == "2026-W37")
    check("week_key: smieci -> None", week_key("nope") is None)
    fake_fs = {"C:/w/repoA/.git", "C:/w/repoB/.git"}

    def exists(p: str) -> bool:
        return p.replace("\\", "/") in fake_fs

    cache: dict[str, str | None] = {}
    check("git_root: znajduje .git w gorze", (git_root("C:/w/repoA/src/deep", cache, exists) or "").replace("\\", "/").endswith("repoA"))
    check("git_root: brak = None", git_root("C:/nowhere/x", cache, exists) is None)
    check("attribute: cwd w repo", attribute_repo("C:/w/repoA/src", collections.Counter(), cache, exists) == "repoA")
    check("attribute: cwd poza repo -> najczesciej edytowane", attribute_repo("C:/nowhere", collections.Counter({"C:/w/repoB": 5, "C:/w/repoA": 1}), cache, exists) == "repoB")
    check("attribute: nic -> basename cwd", attribute_repo("C:/nowhere/dir", collections.Counter(), cache, exists) == "dir")
    sessions = [{"repo": "a", "weeks": {"2026-W36": {"responses": 2, "output_tokens": 100, "input_tokens": 1000, "tool_calls": 3}, "2026-W37": {"responses": 1, "output_tokens": 50, "input_tokens": 10, "tool_calls": 1}}},
                {"repo": "a", "weeks": {"2026-W37": {"responses": 1, "output_tokens": 50, "input_tokens": 10, "tool_calls": 0}}}]
    table = aggregate(sessions, "2026-W37")
    check("aggregate: filtr tygodnia + suma sesji", ("2026-W36", "a") not in table and table[("2026-W37", "a")]["sessions"] == 2 and table[("2026-W37", "a")]["output_tokens"] == 100)
    md = render_markdown(table)
    check("markdown: naglowek + wiersz + 100 %", md.startswith("| Tydzien |") and "| 2026-W37 | a | 2 | 2 | 1 | 100 |" in md and "| 100.0 |" in md)
    print("TESTY: " + (f"{failures} FAIL" if failures else "wszystkie OK"))
    return 1 if failures else 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--root", default=os.path.join(os.path.expanduser("~"), ".claude", "projects"))
    ap.add_argument("--weeks", type=int, default=4)
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--out", help="zapisz markdown do pliku (append)")
    ap.add_argument("--self-test", action="store_true")
    args = ap.parse_args()
    if args.self_test:
        return self_test()
    since = week_key((dt.datetime.now(dt.UTC) - dt.timedelta(weeks=args.weeks)).isoformat())
    cache: dict[str, str | None] = {}
    sessions: list[dict[str, Any]] = []
    for p in sorted(glob.glob(os.path.join(args.root, "*", "*.jsonl"))):
        try:
            sessions.append(mine_file(p, cache))
        except OSError as err:
            print(f"skip {p}: {err}", file=sys.stderr)
    table = aggregate(sessions, since)
    if args.json:
        print(json.dumps([{"week": wk, "repo": repo, **c} for (wk, repo), c in sorted(table.items())], ensure_ascii=False, indent=1))
        return 0
    md = render_markdown(table)
    print(f"usage-by-repo: {len(sessions)} sesji, od tygodnia {since}\n\n{md}")
    if args.out:
        with open(args.out, "a", encoding="utf-8") as fh:  # append — nigdy rewrite
            fh.write(f"\n## usage-by-repo {dt.datetime.now(dt.UTC).date().isoformat()} (od {since})\n\n{md}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""usage-by-repo: „ekonomia projektow" dla floty na subskrypcji (slownik SH sekcja 18; PG gap L14). 0 tokenow.

Czyta transkrypty ~/.claude/projects/*/*.jsonl ORAZ transkrypty subagentow */<sesja>/subagents/*.jsonl i liczy per
TYDZIEN (ISO) per REPO: sesje, odpowiedzi modelu, tool calle, tokeny wyjsciowe i wejsciowe (z cache). Repo = katalog
gita z `cwd` sesji, a gdy cwd nie jest repo (np. <workspace>) — najczesciej edytowane repo w tej sesji.
Odpowiada na pytanie „ktore repo zjada limit tygodniowy" liczbami, nie odczuciem. Nic nie wysyla, nic nie modyfikuje.
Kolumny: udzial subagentow w output (do 2026-11-04 subagenci nie byli liczeni wcale: 4902 pliki / 28 dni), udzial
cache_read we wejsciu i sredni kontekst na odpowiedz (= koszt kazdego wywolania; okno kompakcji w CLAUDE.md).

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
import tempfile
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


def mine_file(path: str, cache: dict[str, str | None], subagent: bool = False) -> dict[str, Any]:
    """Liczniki tygodniowe jednego transkryptu. subagent=True: te same liczniki + kopia w `sub_*` (udzial subagentow)."""
    weeks: dict[str, collections.Counter[str]] = collections.defaultdict(collections.Counter)
    edited_roots: collections.Counter[str] = collections.Counter()
    cwd: str | None = None
    # Jedna odpowiedz modelu = kilka linii transkryptu (po jednej na blok tresci), kazda z TYM SAMYM `usage`.
    # Sumowanie linii zawyzalo tokeny 2,5-3x (ECC cost-tracker: 704 linie = 286 id; landscape #9) -> licz raz na message.id.
    seen_usage_ids: set[str] = set()
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
            msg_id = msg.get("id")
            if isinstance(msg_id, str) and msg_id:
                if msg_id in seen_usage_ids:
                    usage = None
                else:
                    seen_usage_ids.add(msg_id)
            if rec.get("type") == "assistant" and isinstance(usage, dict):
                out = int(usage.get("output_tokens") or 0)
                cache_read = int(usage.get("cache_read_input_tokens") or 0)
                total_in = int(usage.get("input_tokens") or 0) + int(usage.get("cache_creation_input_tokens") or 0) + cache_read
                weeks[wk]["responses"] += 1
                weeks[wk]["output_tokens"] += out
                weeks[wk]["input_tokens"] += total_in
                weeks[wk]["cache_read_tokens"] += cache_read
                if subagent:
                    weeks[wk]["sub_responses"] += 1
                    weeks[wk]["sub_output_tokens"] += out
                    weeks[wk]["sub_input_tokens"] += total_in
    return {"repo": attribute_repo(cwd, edited_roots, cache), "subagent": subagent, "weeks": {k: dict(v) for k, v in weeks.items()}}


def transcripts(root: str) -> list[tuple[str, bool]]:
    """(sciezka, subagent?) — sesje glowne <projekt>/<sesja>.jsonl i subagenci <projekt>/<sesja>/subagents/*.jsonl."""
    main_files = [(p, False) for p in glob.glob(os.path.join(root, "*", "*.jsonl"))]
    sub_files = [(p, True) for p in glob.glob(os.path.join(root, "*", "*", "subagents", "*.jsonl"))]
    return sorted(main_files + sub_files)


def aggregate(sessions: list[dict[str, Any]], since_week: str | None) -> dict[tuple[str, str], collections.Counter[str]]:
    table: dict[tuple[str, str], collections.Counter[str]] = collections.defaultdict(collections.Counter)
    for s in sessions:
        for wk, counts in s["weeks"].items():
            if since_week and wk < since_week:
                continue
            key = (wk, s["repo"])
            table[key]["subagents" if s.get("subagent") else "sessions"] += 1
            for name, value in counts.items():
                table[key][name] += value
    return table


def pct(part: int, whole: int) -> str:
    return f"{100 * part / whole:.1f}" if whole else "-"


def render_markdown(table: dict[tuple[str, str], collections.Counter[str]]) -> str:
    total_out = sum(c["output_tokens"] for c in table.values())
    rows = ["| Tydzien | Repo | Sesje | Subagenci | Odpowiedzi | Tool calls | Output tok | Input tok (z cache) | Udzial output % | Output subagentow % | Cache read % | Sr. kontekst / odp |",
            "|---|---|---|---|---|---|---|---|---|---|---|---|"]
    for (wk, repo), c in sorted(table.items(), key=lambda kv: (kv[0][0], -kv[1]["output_tokens"])):
        avg_ctx = f"{c['input_tokens'] // c['responses']:,}" if c["responses"] else "-"
        rows.append(f"| {wk} | {repo} | {c['sessions']} | {c['subagents']} | {c['responses']} | {c['tool_calls']} | {c['output_tokens']:,} | {c['input_tokens']:,} "
                    f"| {pct(c['output_tokens'], total_out)} | {pct(c['sub_output_tokens'], c['output_tokens'])} | {pct(c['cache_read_tokens'], c['input_tokens'])} | {avg_ctx} |")
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
    B = "C:" if os.name == "nt" else ""  # Linux: fikstura musi byc sciezka absolutna (port 2026-10-02)
    fake_fs = {B + "/w/repoA/.git", B + "/w/repoB/.git"}

    def exists(p: str) -> bool:
        return p.replace("\\", "/") in fake_fs

    cache: dict[str, str | None] = {}
    check("git_root: znajduje .git w gorze", (git_root(B + "/w/repoA/src/deep", cache, exists) or "").replace("\\", "/").endswith("repoA"))
    check("git_root: brak = None", git_root(B + "/nowhere/x", cache, exists) is None)
    check("attribute: cwd w repo", attribute_repo(B + "/w/repoA/src", collections.Counter(), cache, exists) == "repoA")
    check("attribute: cwd poza repo -> najczesciej edytowane", attribute_repo(B + "/nowhere", collections.Counter({B + "/w/repoB": 5, B + "/w/repoA": 1}), cache, exists) == "repoB")
    check("attribute: nic -> basename cwd", attribute_repo(B + "/nowhere/dir", collections.Counter(), cache, exists) == "dir")
    sessions = [{"repo": "a", "weeks": {"2026-W36": {"responses": 2, "output_tokens": 100, "input_tokens": 1000, "tool_calls": 3}, "2026-W37": {"responses": 1, "output_tokens": 50, "input_tokens": 10, "tool_calls": 1}}},
                {"repo": "a", "weeks": {"2026-W37": {"responses": 1, "output_tokens": 50, "input_tokens": 10, "tool_calls": 0}}}]
    table = aggregate(sessions, "2026-W37")
    check("aggregate: filtr tygodnia + suma sesji", ("2026-W36", "a") not in table and table[("2026-W37", "a")]["sessions"] == 2 and table[("2026-W37", "a")]["output_tokens"] == 100)
    with tempfile.TemporaryDirectory() as tmp:
        transcript = os.path.join(tmp, "s.jsonl")
        usage = {"output_tokens": 10, "input_tokens": 1}
        lines = [{"type": "assistant", "timestamp": "2026-09-12T10:00:00Z", "message": {"id": mid, "usage": usage, "content": []}} for mid in ("m1", "m1", "m1", "m2")]
        with open(transcript, "w", encoding="utf-8") as fh:
            fh.write("\n".join(json.dumps(x) for x in lines))
        mined = mine_file(transcript, {})["weeks"]["2026-W37"]
        check("mine_file: usage liczone raz na message.id (3 linie m1 + m2 = 2 odpowiedzi)", mined["responses"] == 2 and mined["output_tokens"] == 20)
        cached = os.path.join(tmp, "c.jsonl")
        with open(cached, "w", encoding="utf-8") as fh:
            fh.write(json.dumps({"type": "assistant", "timestamp": "2026-09-12T10:00:00Z", "message": {"id": "c1", "content": [],
                                 "usage": {"output_tokens": 5, "input_tokens": 2, "cache_creation_input_tokens": 8, "cache_read_input_tokens": 90}}}))
        main_c, sub_c = mine_file(cached, {}), mine_file(cached, {}, subagent=True)
        mw, sw = main_c["weeks"]["2026-W37"], sub_c["weeks"]["2026-W37"]
        check("mine_file: input = in + cache_write + cache_read, cache_read osobno", mw["input_tokens"] == 100 and mw["cache_read_tokens"] == 90)
        check("mine_file: sesja glowna bez sub_*", "sub_output_tokens" not in mw and main_c["subagent"] is False)
        check("mine_file: subagent liczy sie do sumy i do sub_*", sw["output_tokens"] == 5 and sw["sub_output_tokens"] == 5 and sw["sub_input_tokens"] == 100 and sw["sub_responses"] == 1)
        for rel in ("proj/sid.jsonl", "proj/sid/subagents/agent-a.jsonl", "proj/sid/tool-results/x.jsonl"):
            target = os.path.join(tmp, *rel.split("/"))
            os.makedirs(os.path.dirname(target), exist_ok=True)
            open(target, "w", encoding="utf-8").close()
        found = [(os.path.relpath(p, tmp).replace("\\", "/"), sub) for p, sub in transcripts(tmp)]
        check("transcripts: sesja glowna + subagent, nic wiecej", found == [("proj/sid.jsonl", False), ("proj/sid/subagents/agent-a.jsonl", True)])
        mixed = aggregate([main_c, sub_c, sub_c], None)[("2026-W37", main_c["repo"])]
        check("aggregate: subagent nie jest sesja", mixed["sessions"] == 1 and mixed["subagents"] == 2 and mixed["output_tokens"] == 15 and mixed["sub_output_tokens"] == 10)
        mixed_md = render_markdown({("2026-W37", "r"): mixed})
        check("markdown: subagenci 66.7 %, cache read 90.0 %, kontekst 100 / odp", "| 2026-W37 | r | 1 | 2 | 3 | 0 | 15 | 300 | 100.0 | 66.7 | 90.0 | 100 |" in mixed_md)
    md = render_markdown(table)
    check("markdown: naglowek + wiersz + 100 %", md.startswith("| Tydzien |") and "| 2026-W37 | a | 2 | 0 | 2 | 1 | 100 | 20 | 100.0 | 0.0 | 0.0 | 10 |" in md)
    check("markdown: pusta tabela bez dzielenia przez 0", render_markdown({("2026-W01", "z"): collections.Counter()}).endswith("| 0 | 0 | 0 | 0 | 0 | 0 | - | - | - | - |"))
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
    for p, subagent in transcripts(args.root):
        try:
            sessions.append(mine_file(p, cache, subagent))
        except OSError as err:
            print(f"skip {p}: {err}", file=sys.stderr)
    table = aggregate(sessions, since)
    if args.json:
        print(json.dumps([{"week": wk, "repo": repo, **c} for (wk, repo), c in sorted(table.items())], ensure_ascii=False, indent=1))
        return 0
    md = render_markdown(table)
    n_sub = sum(1 for s in sessions if s["subagent"])
    print(f"usage-by-repo: {len(sessions) - n_sub} sesji + {n_sub} transkryptow subagentow, od tygodnia {since}\n\n{md}")
    if args.out:
        with open(args.out, "a", encoding="utf-8") as fh:  # append — nigdy rewrite
            fh.write(f"\n## usage-by-repo {dt.datetime.now(dt.UTC).date().isoformat()} (od {since})\n\n{md}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())

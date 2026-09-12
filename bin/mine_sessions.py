#!/usr/bin/env python3
"""mine_sessions: zliczanie sygnalow "musialem wracac i naprawiac" w transkryptach Claude Code (0 tokenow).

Czyta ~/.claude/projects/*/*.jsonl strumieniowo (1.5 GB) i liczy per sesja:
- blokady hookow (typecheck/ruff/eslint/pre-commit/bash-guard/workflow-lint) — z tresci tool_result,
- powtorzone bledy narzedzi (ten sam tool + ten sam pierwszy wiersz bledu 2x pod rzad),
- korekty od uzytkownika (wiadomosc zaczyna sie od "nie"/"przeciez"/"czemu"/"to nieprawda"),
- samosprostowania asystenta ("sprostowanie", "moj blad", "biore to na siebie", "poprawiam"),
- czerwone CI / nieudane merge'e w outputach.
Wyjscie: JSON (--out) + tabela top sesji i top klas bledow. Nic nie wysyla, nic nie modyfikuje.
"""
from __future__ import annotations

import argparse
import collections
import glob
import json
import os
import re
import sys

HOOK_RX = {
    "typecheck": re.compile(r"TypeScript — bledy typow|error TS\d{4}"),
    "ruff/pyright": re.compile(r"Ruff znalazl|pyright: popraw|ruff check"),
    "eslint/oxlint": re.compile(r"ESLint|oxlint.*(error|warning)"),
    "pre-commit": re.compile(r"\[pre-commit\]"),
    "bash-guard": re.compile(r"\[bash-guard:[a-z-]+\] ZABLOKOWANE"),
    "workflow-lint": re.compile(r"workflow-lint|NIEWAZNY"),
    "stop-gate": re.compile(r"\[stop-gate\]|stop-gate"),
    "ci-red": re.compile(r"CI: RED|conclusion=failure|'failure'\)|not merged: [1-9]"),
    "secrets-scan": re.compile(r"gitleaks|leaks found|Skan sekret"),
}
USER_CORR_RX = re.compile(r"^\s*(nie[ ,.!]|przeciez|czemu|to nieprawda|zle|ale przeciez|nie chce)", re.IGNORECASE)
SELF_CORR_RX = re.compile(r"sprostowanie|m[oó]j b[lł][aą]d|bior[eę] (to )?na siebie|poprawiam|nieprawda[ ,:]|myli[lł]em|pomyli[lł]em|korekta", re.IGNORECASE)
ERR_HEAD_RX = re.compile(r"(error|Error|ERROR|fatal|FAIL|Traceback|ZABLOKOWANE)[^\n]{0,80}")


def text_of(content) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        out = []
        for part in content:
            if isinstance(part, dict):
                if part.get("type") == "text":
                    out.append(part.get("text", ""))
                elif part.get("type") == "tool_result":
                    out.append(text_of(part.get("content", "")))
        return "\n".join(out)
    return ""


def mine_file(path: str) -> dict:
    stats: dict = {"session": os.path.basename(path)[:-6], "project": os.path.basename(os.path.dirname(path)),
                   "turns": 0, "user_msgs": 0, "hooks": collections.Counter(), "user_corrections": 0,
                   "self_corrections": 0, "tool_errors": 0, "repeat_errors": 0, "top_errors": collections.Counter()}
    last_err = None
    with open(path, encoding="utf-8", errors="replace") as fh:
        for line in fh:
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                continue
            msg = rec.get("message") or {}
            role = msg.get("role") or rec.get("type")
            content = msg.get("content", "")
            txt = text_of(content)
            if not txt:
                continue
            stats["turns"] += 1
            if role == "user":
                is_tool_result = isinstance(content, list) and any(isinstance(p, dict) and p.get("type") == "tool_result" for p in content)
                if is_tool_result:
                    for name, rx in HOOK_RX.items():
                        if rx.search(txt):
                            stats["hooks"][name] += 1
                    m = ERR_HEAD_RX.search(txt)
                    if m:
                        stats["tool_errors"] += 1
                        head = re.sub(r"\d+", "N", m.group(0))[:60]
                        stats["top_errors"][head] += 1
                        if head == last_err:
                            stats["repeat_errors"] += 1
                        last_err = head
                    else:
                        last_err = None
                else:
                    stats["user_msgs"] += 1
                    if USER_CORR_RX.search(txt[:60]):
                        stats["user_corrections"] += 1
            elif role == "assistant":
                if SELF_CORR_RX.search(txt):
                    stats["self_corrections"] += 1
    stats["hooks"] = dict(stats["hooks"])
    stats["top_errors"] = stats["top_errors"].most_common(5)
    return stats


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--root", default=os.path.join(os.path.expanduser("~"), ".claude", "projects"))
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    files = [p for p in glob.glob(os.path.join(args.root, "*", "*.jsonl")) if "subagents" not in p]
    rows = []
    for i, p in enumerate(sorted(files), 1):
        try:
            rows.append(mine_file(p))
        except OSError as err:
            print(f"skip {p}: {err}", file=sys.stderr)
        if i % 10 == 0:
            print(f"... {i}/{len(files)}", file=sys.stderr)
    total_hooks: collections.Counter = collections.Counter()
    total_errs: collections.Counter = collections.Counter()
    for r in rows:
        total_hooks.update(r["hooks"])
        total_errs.update(dict(r["top_errors"]))
    summary = {
        "sessions": len(rows),
        "user_msgs": sum(r["user_msgs"] for r in rows),
        "user_corrections": sum(r["user_corrections"] for r in rows),
        "self_corrections": sum(r["self_corrections"] for r in rows),
        "tool_errors": sum(r["tool_errors"] for r in rows),
        "repeat_errors": sum(r["repeat_errors"] for r in rows),
        "hooks_total": dict(total_hooks.most_common()),
        "top_error_heads": total_errs.most_common(25),
        "worst_sessions": sorted(rows, key=lambda r: -(r["user_corrections"] * 3 + r["self_corrections"] * 2 + r["repeat_errors"]))[:12],
    }
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump({"summary": summary, "sessions": rows}, fh, ensure_ascii=False, indent=1)
    s = summary
    print(f"sesji={s['sessions']} wiadomosci_usera={s['user_msgs']} korekty_usera={s['user_corrections']} "
          f"samosprostowania={s['self_corrections']} bledy_narzedzi={s['tool_errors']} powtorzone={s['repeat_errors']}")
    print("hooki:", s["hooks_total"])
    print("top bledy:")
    for head, n in s["top_error_heads"][:15]:
        print(f"  {n:4d}  {head}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""mine_git: sygnaly "wracania i naprawiania" w historii wszystkich repo floty (GitHub API, 0 tokenow).

Per repo (do --max commitow z galezi domyslnej):
- udzial commitow fix/revert/hotfix/napraw/poprawk/ci: w subject,
- "fix po fixie": fix < 24 h po poprzednim commicie dotykajacym TEGO SAMEGO pliku,
- churn: pliki dotykane >= 3 commitami w 7 dni,
- commity prosto na main (bez "(#N)" w subject i bez rodzica-merge) vs przez PR,
- CI-fixy ("ci:", "workflow", "quality.yml" w subject) — koszt walki z wlasna bramka.
Wyjscie: JSON (--out) + tabela. Tylko odczyt. Token z env GITHUB_Token (menedzer sekretow (np. Infisical CLI)).
"""
from __future__ import annotations

import argparse
import collections
import datetime as dt
import json
import os
import re
import subprocess
import sys

API = "https://api.github.com"
FIX_RX = re.compile(r"^(fix|hotfix|revert|napraw|poprawk|bugfix)|\b(fix|napraw|poprawk|revert)\b", re.IGNORECASE)
CI_RX = re.compile(r"^ci[(:]|workflow|quality\.yml|gitleaks|semgrep|pre-commit|\bCI\b", re.IGNORECASE)
PR_RX = re.compile(r"\(#\d+\)\s*$")


def curl(url: str, token: str):
    out = subprocess.run(["curl", "-sS", "-o", "-", "-w", "\n%{http_code}", "-H", f"Authorization: Bearer {token}",
                          "-H", "User-Agent: mas-mine-git/1.0", "-H", "Accept: application/vnd.github+json", url],
                         capture_output=True, text=True, encoding="utf-8", errors="replace", check=False).stdout or ""
    if "\n" not in out:  # curl padl / pusta odpowiedz — traktuj jak brak danych, nie jak wyjatek
        return 0, {}
    body, code = out.rsplit("\n", 1)
    return int(code), (json.loads(body) if body.strip() else {})


def commits(full: str, branch: str, token: str, limit: int) -> list[dict]:
    rows: list[dict] = []
    page = 1
    while len(rows) < limit:
        code, batch = curl(f"{API}/repos/{full}/commits?sha={branch}&per_page=100&page={page}", token)
        if code != 200 or not batch:
            break
        rows += batch
        if len(batch) < 100:
            break
        page += 1
    return rows[:limit]


def files_of(full: str, sha: str, token: str) -> list[str]:
    code, data = curl(f"{API}/repos/{full}/commits/{sha}", token)
    return [f["filename"] for f in data.get("files", [])] if code == 200 else []


def mine_repo(r: dict, token: str, limit: int, with_files: int) -> dict:
    full, branch = r["full_name"], r["default_branch"]
    rows = commits(full, branch, token, limit)
    n = len(rows)
    fix = ci = direct = merges = 0
    # API zwraca commity od NAJNOWSZEGO; "poprzedni commit tego pliku" trzeba liczyc po zebraniu
    # wszystkich dat (pierwsza wersja liczyla przeciw NOWSZYM commitom i zawsze dawala 0 — retro 2026-09-06).
    per_file: dict[str, list[tuple[dt.datetime, bool]]] = collections.defaultdict(list)
    detailed = 0
    for c in rows:
        subj = (c["commit"]["message"] or "").splitlines()[0]
        when = dt.datetime.fromisoformat(c["commit"]["committer"]["date"].replace("Z", "+00:00"))
        is_fix = bool(FIX_RX.search(subj))
        is_merge = len(c.get("parents", [])) > 1
        fix += is_fix
        ci += bool(CI_RX.search(subj))
        merges += is_merge
        if not is_merge and not PR_RX.search(subj):
            direct += 1
        if detailed < with_files:
            detailed += 1
            for f in files_of(full, c["sha"], token):
                per_file[f].append((when, is_fix))
    fix_after_fix = 0
    for entries in per_file.values():
        entries.sort()
        for i in range(1, len(entries)):
            when, is_fix = entries[i]
            if is_fix and (when - entries[i - 1][0]) <= dt.timedelta(hours=24):
                fix_after_fix += 1
    per_file_dates = {f: [w for w, _ in e] for f, e in per_file.items()}
    churn = 0
    for dates in per_file_dates.values():
        dates.sort()
        for i in range(len(dates) - 2):
            if dates[i + 2] - dates[i] <= dt.timedelta(days=7):
                churn += 1
                break
    return {"repo": r["name"], "private": r["private"], "commits": n, "fix_ratio": round(fix / n, 2) if n else 0,
            "ci_fix": ci, "direct_to_main": direct, "via_pr": n - direct - merges, "merges": merges,
            "fix_after_fix_24h": fix_after_fix, "churn_files_3in7d": churn, "detailed_commits": detailed}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", required=True)
    ap.add_argument("--max", type=int, default=300, help="max commitow na repo")
    ap.add_argument("--with-files", type=int, default=120, help="ile najnowszych commitow rozwinac o liste plikow")
    ap.add_argument("--skip", default="travel-site")
    args = ap.parse_args()
    token = os.environ["GITHUB_Token"]
    skip = set(args.skip.split(","))
    repos: list[dict] = []
    page = 1
    while True:
        code, batch = curl(f"{API}/user/repos?per_page=100&affiliation=owner&page={page}", token)
        if code != 200 or not batch:
            break
        repos += batch
        if len(batch) < 100:
            break
        page += 1
    out = []
    for r in sorted(repos, key=lambda x: x["name"]):
        if r["name"] in skip or r.get("archived"):
            continue
        try:
            out.append(mine_repo(r, token, args.max, args.with_files))
            print(f"... {r['name']}", file=sys.stderr)
        except (KeyError, ValueError, json.JSONDecodeError) as err:
            print(f"skip {r['name']}: {err}", file=sys.stderr)
    tot = {k: sum(x[k] for x in out) for k in ("commits", "ci_fix", "direct_to_main", "via_pr", "fix_after_fix_24h", "churn_files_3in7d")}
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump({"totals": tot, "repos": out}, fh, ensure_ascii=False, indent=1)
    print(f"{'repo':28s} {'commits':>7} {'fix%':>5} {'ci':>4} {'direct':>6} {'viaPR':>5} {'fix<24h':>7} {'churn':>5}")
    for x in sorted(out, key=lambda x: -x["fix_after_fix_24h"]):
        print(f"{x['repo']:28s} {x['commits']:7d} {int(x['fix_ratio']*100):4d}% {x['ci_fix']:4d} {x['direct_to_main']:6d} {x['via_pr']:5d} {x['fix_after_fix_24h']:7d} {x['churn_files_3in7d']:5d}")
    print("TOTAL:", tot)
    return 0


if __name__ == "__main__":
    sys.exit(main())

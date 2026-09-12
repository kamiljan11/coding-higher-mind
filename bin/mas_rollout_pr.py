#!/usr/bin/env python3
"""mas_rollout_pr: rollout JEDNEGO pliku szablonu do repo floty PRZEZ PR-y (nie prosto na main).

Dlaczego nie mas_rollout.py: on robi PUT na main i nadpisuje quality.yml wszedzie — po strict branch protection
(2026-09-06) i tak dostanie 409, a wczesniej byl zrodlem 80 % commitow "prosto na main". Ten skrypt:
- bierze tylko repo, w ktorych plik JUZ ISTNIEJE (nie wprowadza nowych workflowow),
- pomija repo, gdzie tresc jest identyczna z szablonem, archiwalne i --skip,
- tworzy galaz z main, commituje plik przez Contents API, otwiera PR (opis z pliku, nie z literalu),
- NIE merguje — merge robi mas_merge_prs.py po zielonym CI na aktualnym merge-ref.
Token z env GITHUB_Token (menedzer sekretow (np. Infisical CLI)). curl zamiast urllib (Python pod mostem miewa getaddrinfo).

Uzycie: infisical run --env=dev -- python mas_rollout_pr.py \\
          --file .github/workflows/claude-review.yml --branch chore/claude-review-skipped --title "ci(claude-review): ..." \\
          --body-file opis.md [--skip travel-site] [--only a,b] [--confirm]
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import subprocess
import sys

API = "https://api.github.com"
TPL = os.path.join(os.path.expanduser("~"), ".claude", "templates", "repo")


def curl(method: str, url: str, token: str, body: dict | None = None) -> tuple[int, dict | list]:
    cmd = ["curl", "-sS", "-o", "-", "-w", "\n%{http_code}", "-X", method,
           "-H", f"Authorization: Bearer {token}", "-H", "User-Agent: mas-rollout-pr/1.0",
           "-H", "Accept: application/vnd.github+json", url]
    if body is not None:
        cmd += ["-H", "Content-Type: application/json", "--data-binary", "@-"]
    proc = subprocess.run(cmd, input=json.dumps(body) if body is not None else None, capture_output=True,
                          text=True, encoding="utf-8", errors="replace", check=False)
    out = proc.stdout or ""
    if "\n" not in out:
        return 0, {"message": (proc.stderr or "curl bez odpowiedzi").strip()[:200]}
    text, code = out.rsplit("\n", 1)
    try:
        return int(code), (json.loads(text) if text.strip() else {})
    except json.JSONDecodeError:
        return int(code), {"message": text[:200]}


def list_repos(token: str) -> list[dict]:
    repos: list[dict] = []
    page = 1
    while True:
        code, batch = curl("GET", f"{API}/user/repos?per_page=100&affiliation=owner&page={page}", token)
        if code != 200 or not batch:
            break
        repos += batch  # type: ignore[arg-type]
        if len(batch) < 100:
            break
        page += 1
    return [r for r in repos if not r.get("archived") and not r.get("fork")]


def rollout_one(repo: dict, path: str, content_b64: str, branch: str, title: str, body: str, token: str, confirm: bool,
                create_if_vitest: bool = False) -> str:
    full, base = repo["full_name"], repo["default_branch"]
    code, cur = curl("GET", f"{API}/repos/{full}/contents/{path}?ref={base}", token)
    if code != 200:
        # --create-if-vitest: nowy plik tylko tam, gdzie ma sens (repo z vitest w package.json); reszta bez zmian.
        if not create_if_vitest:
            return "brak pliku — pomijam"
        code_p, pkg = curl("GET", f"{API}/repos/{full}/contents/package.json?ref={base}", token)
        if code_p != 200 or '"vitest"' not in base64.b64decode(pkg.get("content", "")).decode("utf-8", "replace"):  # type: ignore[union-attr]
            return "brak pliku i brak vitest — pomijam"
        cur = {}
    if cur.get("content", "").replace("\n", "") == content_b64:  # type: ignore[union-attr]
        return "identyczny z szablonem"
    if not confirm:
        return "DRY: rozni sie, wyszlby PR"
    code, ref = curl("GET", f"{API}/repos/{full}/git/ref/heads/{base}", token)
    if code != 200:
        return f"ERR ref main {code}"
    base_sha = ref["object"]["sha"]  # type: ignore[index]
    code, _ = curl("POST", f"{API}/repos/{full}/git/refs", token, {"ref": f"refs/heads/{branch}", "sha": base_sha})
    if code not in (201, 422):  # 422 = galaz juz istnieje (powtorka) — jedziemy dalej
        return f"ERR galaz {code}"
    code, on_branch = curl("GET", f"{API}/repos/{full}/contents/{path}?ref={branch}", token)
    sha_on_branch = on_branch.get("sha") if code == 200 else cur.get("sha")  # type: ignore[union-attr]
    code, res = curl("PUT", f"{API}/repos/{full}/contents/{path}", token,
                     {"message": title, "content": content_b64, "sha": sha_on_branch, "branch": branch})
    if code not in (200, 201):
        return f"ERR commit {code}: {str(res.get('message', ''))[:80]}"  # type: ignore[union-attr]
    code, pr = curl("POST", f"{API}/repos/{full}/pulls", token, {"title": title, "head": branch, "base": base, "body": body})
    if code == 201:
        return f"PR #{pr['number']}"  # type: ignore[index]
    if code == 422 and "already exists" in json.dumps(pr):
        return "PR juz istnieje"
    return f"ERR PR {code}: {str(pr.get('message', ''))[:80]}"  # type: ignore[union-attr]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--file", required=True, help="sciezka w repo == sciezka w templates/repo")
    ap.add_argument("--branch", required=True)
    ap.add_argument("--title", required=True)
    ap.add_argument("--body-file", required=True)
    ap.add_argument("--skip", default="travel-site")
    ap.add_argument("--only", default="")
    ap.add_argument("--confirm", action="store_true")
    ap.add_argument("--create-if-vitest", action="store_true", help="tworz plik tam, gdzie go nie ma, ale package.json ma vitest (np. mutation.yml)")
    args = ap.parse_args()
    token = os.environ["GITHUB_Token"]
    with open(os.path.join(TPL, args.file.replace("/", os.sep)), "rb") as fh:
        content_b64 = base64.b64encode(fh.read()).decode()
    with open(args.body_file, encoding="utf-8") as fh:
        body = fh.read()
    skip = set(args.skip.split(","))
    only = {s for s in args.only.split(",") if s}
    opened = 0
    for r in sorted(list_repos(token), key=lambda x: x["name"]):
        if r["name"] in skip or (only and r["name"] not in only):
            continue
        result = rollout_one(r, args.file, content_b64, args.branch, args.title, body, token, args.confirm, args.create_if_vitest)
        opened += result.startswith("PR #")
        print(f"{r['name']:28s} {result}", flush=True)
    print(f"\notwartych PR-ow: {opened}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

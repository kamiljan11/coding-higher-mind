"""Otwiera (albo aktualizuje) pull request na GitHubie przez REST API.

Token: WYLACZNIE z env `GITHUB_Token` (wstrzykuje menedzer sekretow (np. Infisical CLI)) — nigdy nie jest drukowany.
Uzycie (przez most):
  infisical run --env=dev -- \
    python "~/.claude/bin/mas_open_pr.py" --repo <github-owner>/<repo> \
    --head chore/pg-v3-github-ready --base main --title "chore(pg): ..." --body-file body.md [--draft]
Jesli PR dla (head, base) juz istnieje -> aktualizuje tytul i opis (idempotentne). Drukuje URL PR.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

API = "https://api.github.com"
USER_AGENT = "mas-open-pr/1.0"
TIMEOUT_S = 30


def api(method: str, url: str, token: str, body: dict | None = None) -> tuple[int, dict | list]:
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "User-Agent": USER_AGENT,
        "Content-Type": "application/json",
    })
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_S) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as err:
        payload = err.read().decode("utf-8", errors="replace")
        try:
            return err.code, json.loads(payload)
        except json.JSONDecodeError:
            return err.code, {"message": payload[:300]}


def find_existing(repo: str, head: str, base: str, token: str) -> dict | None:
    owner = repo.split("/")[0]
    status, prs = api("GET", f"{API}/repos/{repo}/pulls?state=open&head={owner}:{head}&base={base}", token)
    if status == 200 and isinstance(prs, list) and prs:
        return prs[0]
    return None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--repo", required=True, help="owner/name")
    parser.add_argument("--head", required=True)
    parser.add_argument("--base", default="main")
    parser.add_argument("--title", required=True)
    parser.add_argument("--body-file", required=True)
    parser.add_argument("--draft", action="store_true")
    args = parser.parse_args()

    token = os.environ.get("GITHUB_Token") or os.environ.get("GITHUB_TOKEN")
    if not token:
        print("[mas_open_pr] brak GITHUB_Token w env — uruchom przez infisical run --env=dev --", file=sys.stderr)
        return 2
    body = Path(args.body_file).read_text(encoding="utf-8")

    existing = find_existing(args.repo, args.head, args.base, token)
    if existing:
        status, pr = api("PATCH", f"{API}/repos/{args.repo}/pulls/{existing['number']}", token, {"title": args.title, "body": body})
        verb = "updated"
    else:
        status, pr = api("POST", f"{API}/repos/{args.repo}/pulls", token,
                         {"title": args.title, "head": args.head, "base": args.base, "body": body, "draft": args.draft})
        verb = "created"
    if status not in (200, 201) or not isinstance(pr, dict):
        message = pr.get("message") if isinstance(pr, dict) else pr
        print(f"[mas_open_pr] {status}: {message}", file=sys.stderr)
        errors = pr.get("errors") if isinstance(pr, dict) else None
        if errors:
            print(json.dumps(errors)[:500], file=sys.stderr)
        return 1
    print(f"[mas_open_pr] PR {verb}: {pr.get('html_url')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

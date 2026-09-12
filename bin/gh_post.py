#!/usr/bin/env python3
"""gh_post: opis PR-a / komentarz / edycja opisu na GitHubie ZAWSZE z pliku — nigdy z literalu w shellu.

Blizna 2026-09-06 (2x tego samego dnia): markdown wpisany w `python -c "..."` w Bashu — shell wykonal backticki
jako polecenia i rozwinal `$`, tekst dotarl na GitHuba z dziurami ("main: command not found" w logu = zjedzony
fragment). Ten skrypt czyta tresc z pliku (UTF-8) i wysyla przez curl (Python pod mostem miewa `getaddrinfo`).

Uzycie (zawsze przez most, token z env GITHUB_Token):
  infisical run --env=dev --repo owner/name --head branch --base main --title "..." --body-file plik.md
  infisical run --env=dev --repo owner/name --number 12 --body-file plik.md
  infisical run --env=dev --repo owner/name --number 12 --body-file plik.md
Sciezka pliku w formie Windows (C:/...), nie MSYS (/c/...).
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys

API = "https://api.github.com"


def curl(method: str, url: str, token: str, body: dict) -> tuple[int, dict]:
    proc = subprocess.run(
        ["curl", "-sS", "-o", "-", "-w", "\n%{http_code}", "-X", method,
         "-H", f"Authorization: Bearer {token}", "-H", "User-Agent: mas-gh-post/1.0",
         "-H", "Accept: application/vnd.github+json", "-H", "Content-Type: application/json",
         "--data-binary", "@-", url],
        input=json.dumps(body), capture_output=True, text=True, encoding="utf-8", errors="replace", check=False,
    )
    out = proc.stdout or ""
    if "\n" not in out:
        return 0, {"message": (proc.stderr or "curl bez odpowiedzi").strip()[:200]}
    text, code = out.rsplit("\n", 1)
    try:
        return int(code), (json.loads(text) if text.strip() else {})
    except json.JSONDecodeError:
        return int(code), {"message": text[:200]}


def read_body(path: str) -> str:
    with open(path, encoding="utf-8") as fh:
        body = fh.read()
    if not body.strip():
        raise SystemExit(f"gh_post: plik {path} jest pusty")
    return body


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p_pr = sub.add_parser("pr")
    p_pr.add_argument("--repo", required=True)
    p_pr.add_argument("--head", required=True)
    p_pr.add_argument("--base", default="main")
    p_pr.add_argument("--title", required=True)
    p_pr.add_argument("--body-file", required=True)
    p_c = sub.add_parser("comment")
    p_c.add_argument("--repo", required=True)
    p_c.add_argument("--number", type=int, required=True)
    p_c.add_argument("--body-file", required=True)
    p_e = sub.add_parser("edit-body")
    p_e.add_argument("--repo", required=True)
    p_e.add_argument("--number", type=int, required=True)
    p_e.add_argument("--body-file", required=True)
    args = ap.parse_args()
    token = os.environ["GITHUB_Token"]
    body = read_body(args.body_file)

    if args.cmd == "pr":
        code, res = curl("POST", f"{API}/repos/{args.repo}/pulls", token,
                         {"title": args.title, "head": args.head, "base": args.base, "body": body})
        ok = code == 201
        print(f"PR #{res.get('number')} {res.get('html_url')}" if ok else f"HTTP {code}: {res.get('message')}")
    elif args.cmd == "comment":
        code, res = curl("POST", f"{API}/repos/{args.repo}/issues/{args.number}/comments", token, {"body": body})
        ok = code == 201
        print(f"komentarz dodany: {res.get('html_url')}" if ok else f"HTTP {code}: {res.get('message')}")
    else:
        code, res = curl("PATCH", f"{API}/repos/{args.repo}/pulls/{args.number}", token, {"body": body})
        ok = code == 200
        print(f"opis PR #{args.number} zaktualizowany ({len(res.get('body') or '')} znakow)" if ok else f"HTTP {code}: {res.get('message')}")
    # Dowod, ze nic nie zostalo zjedzone: dlugosc wyslana == dlugosc odebrana
    sent, got = len(body), len(res.get("body") or "")
    if ok and got and got != sent:
        print(f"UWAGA: wyslano {sent} znakow, GitHub ma {got} — sprawdz tresc", file=sys.stderr)
        return 1
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

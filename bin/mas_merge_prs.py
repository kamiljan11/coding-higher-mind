#!/usr/bin/env python3
"""mas_merge_prs: merguje (squash) otwarte PR-y jednej galezi w podanych repo — z bramkami, nie na slepo.

Przed mergem kazdego PR-a: mergeable_state musi byc clean/unstable/has_hooks (nie dirty/blocked/behind),
a wszystkie check-runy HEAD musza byc completed z conclusion success/skipped/neutral (brak checkow = OK tylko
gdy repo nie ma workflowow). Po mergu drukuje SHA merge-commita. Wymaga JAWNEGO --confirm (bez niego dry-run)
oraz ALLOW_MERGE=1 w srodowisku — marker swiadomej decyzji uzytkownika (2026-09-06: "dzialaj 1-4").

Uzycie: ALLOW_MERGE=1 infisical run --env=dev --repos a,b [--branch B] [--confirm]
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request

API = "https://api.github.com"
OWNER = os.environ["GITHUB_OWNER"]  # wlasciciel repo floty; w publicznej wersji PG = wymagane env
OK_STATES = {"clean", "unstable", "has_hooks"}
OK_CONCLUSIONS = {"success", "skipped", "neutral"}


def request(method: str, url: str, token: str, body: dict | None = None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={
        "Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json",
        "User-Agent": "mas-merge-prs/1.0", "Content-Type": "application/json"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                return resp.status, json.loads(resp.read().decode("utf-8") or "{}")
        except urllib.error.HTTPError as err:
            try:
                payload = json.loads(err.read().decode("utf-8"))
            except (json.JSONDecodeError, UnicodeDecodeError):
                payload = {}
            return err.code, payload
        except (urllib.error.URLError, ConnectionError, OSError):
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"GitHub API unreachable: {url}")


def has_workflows(repo: str, sha: str, token: str) -> bool:
    status, entries = request("GET", f"{API}/repos/{OWNER}/{repo}/contents/.github/workflows?ref={sha}", token)
    return status == 200 and any(e["name"].endswith((".yml", ".yaml")) for e in entries)


def latest_per_name(runs: list) -> list:
    """Na jednym HEAD ten sam check moze miec kilka runow (re-run, zdarzenie `labeled`): liczy sie NAJNOWSZY per nazwa —
    tak jak pokazuje UI GitHuba. 2026-09-13 (demo-site #19): stary run `Mutation` = failure, nowy (po etykiecie
    allow-low-mutation) = skipped; narzedzie brało oba i odmawialo merge'u zielonego PR-a. Czysta funkcja."""
    best: dict[str, dict] = {}
    for run in runs:
        key = run.get("name", "")
        stamp = (run.get("started_at") or run.get("completed_at") or "", int(run.get("id") or 0))
        cur = best.get(key)
        if cur is None or stamp > (cur.get("started_at") or cur.get("completed_at") or "", int(cur.get("id") or 0)):
            best[key] = run
    return list(best.values())


def self_test() -> int:
    runs = [
        {"id": 1, "name": "Mutation", "status": "completed", "conclusion": "failure", "started_at": "2026-09-13T10:00:00Z"},
        {"id": 2, "name": "Mutation", "status": "completed", "conclusion": "skipped", "started_at": "2026-09-13T10:05:00Z"},
        {"id": 3, "name": "Build", "status": "completed", "conclusion": "success", "started_at": "2026-09-13T10:01:00Z"},
    ]
    latest = {r["name"]: r["conclusion"] for r in latest_per_name(runs)}
    ok = latest == {"Mutation": "skipped", "Build": "success"} and latest_per_name([]) == []
    print(("ok   " if ok else "FAIL ") + "latest_per_name: najnowszy run per nazwa wygrywa (failure -> skipped po etykiecie)")
    return 0 if ok else 1



def base_moved_after_checks(repo: str, pr: dict, runs: list, token: str) -> str | None:
    """Zwraca opis, gdy galaz bazowa dostala commit PO starcie checkow na HEAD PR-a.
    Checki GitHuba testuja merge-ref z chwili pushu; pozniejszy commit na bazie (np. cudzy PR
    z tym samym fixem) nie uruchamia ich ponownie. 2026-09-06 (parts-shop): dwa PR-y dodaly
    `permissions:` w tym samym jobie -> po drugim squashu YAML z duplikatem klucza, GitHub przestal
    parsowac workflow i main byl bez zadnej bramki, a oba PR-y mialy zielone checki."""
    if not runs:
        return None
    started = min((r.get("started_at") or r.get("completed_at") or "") for r in runs)
    base = pr["base"]["ref"]
    _, tip = request("GET", f"{API}/repos/{OWNER}/{repo}/commits/{base}", token)
    tip_date = ((tip.get("commit") or {}).get("committer") or {}).get("date", "")
    if started and tip_date and tip_date > started:
        return f"baza {base} ma commit z {tip_date}, checki startowaly {started}"
    return None


def invalid_workflow_after_merge(repo: str, sha: str, token: str) -> list[str]:
    """Po mergu: run NAZWANY SCIEZKA pliku = GitHub nie sparsowal workflow (zero bramek na main)."""
    for _ in range(12):
        _, data = request("GET", f"{API}/repos/{OWNER}/{repo}/actions/runs?head_sha={sha}&per_page=30", token)
        runs = data.get("workflow_runs", [])
        if runs:
            return sorted({r["path"] for r in runs if r.get("name") == r.get("path")})
        time.sleep(5)
    return []


def workflow_files_in_pr(repo: str, number: int, token: str) -> list[str]:
    _, files = request("GET", f"{API}/repos/{OWNER}/{repo}/pulls/{number}/files?per_page=100", token)
    return [f["filename"] for f in files if f["filename"].startswith(".github/workflows/") and f["status"] != "removed"]


def lint_merge_ref_workflows(repo: str, number: int, paths: list[str], token: str) -> list[str]:
    """Parser GitHuba na plikach workflow z refs/pull/N/merge — czyli na WYNIKU merge'a, nie na galezi PR-a.
    2026-09-06: dwa PR-y dodaly ten sam klucz do joba; kazdy z osobna byl poprawny, wynik merge'a nie.
    Zwraca liste bledow (pusta = OK). Brak narzedzia lokalnie = pomijamy z ostrzezeniem, nie udajemy zieleni."""
    import base64
    import subprocess
    import tempfile
    tool = os.path.join(os.path.expanduser("~"), ".claude", "tools", "workflow-lint")
    if not os.path.isfile(os.path.join(tool, "lint.mjs")):
        return ["workflow-lint niedostepny lokalnie (~/.claude/tools/workflow-lint) — merge-ref NIE sprawdzony"]
    errors: list[str] = []
    with tempfile.TemporaryDirectory() as tmp:
        local: list[str] = []
        for path in paths:
            status, data = request("GET", f"{API}/repos/{OWNER}/{repo}/contents/{path}?ref=refs/pull/{number}/merge", token)
            if status != 200 or "content" not in data:
                errors.append(f"{path}: nie mozna pobrac z refs/pull/{number}/merge (HTTP {status})")
                continue
            dst = os.path.join(tmp, os.path.basename(path))
            with open(dst, "wb") as fh:
                fh.write(base64.b64decode(data["content"]))
            local.append(dst)
        if local:
            proc = subprocess.run(["node", "--import", "./hook.mjs", "lint.mjs", *local], cwd=tool,
                                  capture_output=True, text=True, check=False)
            if proc.returncode != 0:
                errors.append((proc.stdout + proc.stderr).strip()[-600:])
    return errors

def main() -> int:
    if "--self-test" in sys.argv:
        return self_test()
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--repos", required=True)
    parser.add_argument("--branch", default="chore/pg-v3-github-ready")
    parser.add_argument("--update-branch", action="store_true", help="przy mergeable_state=behind: PUT update-branch, poczekaj na CI, ocen ponownie (strict protection, 2026-09-06)")
    parser.add_argument("--confirm", action="store_true")
    args = parser.parse_args()
    token = os.environ.get("GITHUB_Token") or os.environ.get("GITHUB_TOKEN")
    if not token:
        print("brak GITHUB_Token — uruchom przez menedzer sekretow (np. Infisical CLI)", file=sys.stderr)
        return 2
    if args.confirm and os.environ.get("ALLOW_MERGE") != "1":
        print("merge wymaga ALLOW_MERGE=1 w srodowisku (swiadoma decyzja uzytkownika)", file=sys.stderr)
        return 2

    failures = 0
    for repo in [r for r in args.repos.split(",") if r]:
        status, prs = request("GET", f"{API}/repos/{OWNER}/{repo}/pulls?state=open&head={OWNER}:{args.branch}", token)
        if status != 200 or not prs:
            print(f"--   {repo:32s} brak otwartego PR na {args.branch}")
            continue
        _, pr = request("GET", prs[0]["url"], token)
        number, sha, state = pr["number"], pr["head"]["sha"], pr.get("mergeable_state")
        _, checks = request("GET", f"{API}/repos/{OWNER}/{repo}/commits/{sha}/check-runs?per_page=100", token)
        runs = latest_per_name(checks.get("check_runs", []))
        bad = [c["name"] for c in runs if c["status"] != "completed" or c.get("conclusion") not in OK_CONCLUSIONS]
        if state == "behind" and args.update_branch and args.confirm:
            # strict protection: galaz za baza -> GitHub sam wciaga baze (merge commit), CI liczy sie na WYNIKU.
            # Zweryfikowane w polu przez sesje warsztatu 2026-09-06 (#145/#148/#149: 405 -> update-branch -> merge).
            st_up, res_up = request("PUT", f"{API}/repos/{OWNER}/{repo}/pulls/{number}/update-branch", token, {})
            if st_up != 202:
                print(f"!!   {repo:32s} #{number} update-branch HTTP {st_up}: {str(res_up.get('message', ''))[:100]} — POMIJAM")
                failures += 1
                continue
            print(f"     {repo:32s} #{number} update-branch przyjety, czekam na CI (max 20 min)")
            for _ in range(60):
                time.sleep(20)
                _, pr = request("GET", f"{API}/repos/{OWNER}/{repo}/pulls/{number}", token)
                sha, state = pr["head"]["sha"], pr.get("mergeable_state")
                _, checks = request("GET", f"{API}/repos/{OWNER}/{repo}/commits/{sha}/check-runs?per_page=100", token)
                runs = latest_per_name(checks.get("check_runs", []))
                if runs and all(c["status"] == "completed" for c in runs) and state not in (None, "unknown", "behind"):
                    break
            bad = [c["name"] for c in runs if c["status"] != "completed" or c.get("conclusion") not in OK_CONCLUSIONS]
        if state not in OK_STATES:
            print(f"!!   {repo:32s} #{number} mergeable_state={state} — POMIJAM" + (" (behind: uzyj --update-branch)" if state == "behind" else ""))
            failures += 1
            continue
        if bad:
            print(f"!!   {repo:32s} #{number} checki nie zielone: {bad} — POMIJAM")
            failures += 1
            continue
        if not runs and has_workflows(repo, sha, token):
            print(f"!!   {repo:32s} #{number} 0 checkow mimo workflowow — POMIJAM")
            failures += 1
            continue
        stale = base_moved_after_checks(repo, pr, runs, token)
        if stale and os.environ.get("ALLOW_STALE_BASE") != "1":
            print(f"!!   {repo:32s} #{number} checki sprzed ruchu bazy ({stale}) — wypchnij/rebase, zeby CI "
                  f"przeliczylo merge; swiadome ominiecie: ALLOW_STALE_BASE=1 — POMIJAM")
            failures += 1
            continue
        wf_paths = workflow_files_in_pr(repo, number, token)
        if wf_paths:
            wf_errors = lint_merge_ref_workflows(repo, number, wf_paths, token)
            if wf_errors:
                print(f"!!   {repo:32s} #{number} workflow po mergu NIEWAZNY dla GitHuba: {' | '.join(wf_errors)[:400]} — POMIJAM")
                failures += 1
                continue
            print(f"     {repo:32s} #{number} workflow-lint na refs/pull/{number}/merge: OK ({len(wf_paths)} plik/ow)")
        if not args.confirm:
            print(f"DRY  {repo:32s} #{number} {sha[:7]} state={state} checks={len(runs)} -> squash '{pr['title'][:60]}'")
            continue
        status, res = request("PUT", f"{API}/repos/{OWNER}/{repo}/pulls/{number}/merge", token,
                              {"merge_method": "squash", "commit_title": f"{pr['title']} (#{number})", "sha": sha})
        if status == 200 and res.get("merged"):
            print(f"ok   {repo:32s} #{number} merged -> {res.get('sha', '?')[:7]}")
            broken = invalid_workflow_after_merge(repo, res.get("sha", ""), token)
            if broken:
                failures += 1
                print(f"!!!  {repo:32s} main po mergu ma NIEWAZNY workflow (run nazwany sciezka): {broken} — "
                      f"repo jest bez bramek, napraw natychmiast")
        else:
            failures += 1
            print(f"!!   {repo:32s} #{number} merge HTTP {status}: {res.get('message', '')[:120]}")
    print(f"\nnot merged: {failures}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())

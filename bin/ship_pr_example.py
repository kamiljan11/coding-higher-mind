"""Ship one PR end to end: update-branch if behind, wait for the 4 required
checks + claude-review, merge ONLY when every required check is green AND the
latest claude-review comment says APPROVE, delete the branch, then wait for the
Vercel production deploy and exit non-zero unless it reports success.

Merge authority: this script merges through the GitHub REST API, so bash-guard's
`gh pr merge` rule does not see it. uzytkownik authorised this flow for kamiljan.com
(demo-site) on 2026-09-21: an agent may merge its own PR only through this
script, which refuses unless CI is green and the independent reviewer approves.
Do not point it at another repo (SHIP_REPO) without his OK for that repo.

Usage: python ship_pr_example.py <pr-number>   (GITHUB_Token from the Infisical bridge)
       python ship_pr_example.py --self-test   (pure logic, no network, no token)
Loops up to 3 update-branch rounds (each round re-triggers CI + review)."""

import io
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from typing import Any

# reuse the merge-ref workflow lint from the fleet merger instead of copying it
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mas_merge_prs import lint_merge_ref_workflows, workflow_files_in_pr

if isinstance(sys.stdout, io.TextIOWrapper):
    sys.stdout.reconfigure(encoding="utf-8")  # review bodies carry Polish text

REPO = os.environ.get("SHIP_REPO", "<github-owner>/demo-site")
API = f"https://api.github.com/repos/{REPO}"
REQUIRED = {
    "Build + Lint + Typecheck + Test",
    "Semgrep SAST",
    "Gitleaks secrets scan",
    "E2E smoke (Playwright)",
}
REVIEW_CHECK = "claude-review"
REVIEW_BOT = "claude[bot]"


# ---- pure logic (tested by --self-test) ----


def failing_required(runs: dict[str, dict[str, Any]]) -> list[str]:
    """Required checks that did not conclude success (missing counts as failing)."""
    return sorted(name for name in REQUIRED if runs.get(name, {}).get("conclusion") != "success")


def all_done(runs: dict[str, dict[str, Any]]) -> bool:
    names = REQUIRED | {REVIEW_CHECK}
    return all(runs.get(name, {}).get("status") == "completed" for name in names)


def parse_verdict(comments: Any) -> tuple[str | None, str | None]:
    """Verdict from the LATEST review-bot comment, e.g. 'APPROVE' or 'REQUEST CHANGES'."""
    if not isinstance(comments, list):
        return None, None
    bodies = [c.get("body", "") for c in comments if c.get("user", {}).get("login") == REVIEW_BOT]
    if not bodies:
        return None, None
    match = re.search(r"Werdykt\W*([A-Z][A-Z ]*[A-Z])", bodies[-1])
    return (match.group(1).strip() if match else None), bodies[-1]


def prod_state(deployments: Any, statuses_of) -> str | None:
    """State of the Production deployment, or None while it is not there yet."""
    state = None
    for dep in deployments if isinstance(deployments, list) else []:
        if dep.get("environment") == "Production":
            statuses = statuses_of(dep["id"])
            state = statuses[0]["state"] if isinstance(statuses, list) and statuses else None
    return state


def self_test() -> None:
    ok = {"status": "completed", "conclusion": "success"}
    green = {name: ok for name in REQUIRED} | {REVIEW_CHECK: ok}
    assert failing_required(green) == []
    assert failing_required({}) == sorted(REQUIRED), "missing checks must count as failing"
    red = dict(green) | {"Semgrep SAST": {"status": "completed", "conclusion": "failure"}}
    assert failing_required(red) == ["Semgrep SAST"]
    skipped = dict(green) | {"E2E smoke (Playwright)": {"status": "completed", "conclusion": "skipped"}}
    assert failing_required(skipped) == ["E2E smoke (Playwright)"], "skipped is not green"
    assert all_done(green) and not all_done({k: v for k, v in green.items() if k != REVIEW_CHECK})

    bot = {"login": REVIEW_BOT}
    older = {"user": bot, "body": "## Werdykt: APPROVE"}
    newer = {"user": bot, "body": "## Werdykt: REQUEST CHANGES\nfix X"}
    human = {"user": {"login": "<github-owner>"}, "body": "Werdykt: APPROVE"}
    assert parse_verdict([older, newer])[0] == "REQUEST CHANGES", "latest bot comment wins"
    assert parse_verdict([human])[0] is None, "a human comment is not the review"
    assert parse_verdict([older, human])[0] == "APPROVE"
    assert parse_verdict("403 rate limited") == (None, None), "API error body must not approve"

    deps = [{"id": 1, "environment": "Preview"}, {"id": 2, "environment": "Production"}]
    assert prod_state(deps, lambda i: [{"state": "success"}] if i == 2 else []) == "success"
    assert prod_state(deps, lambda i: []) is None
    assert prod_state({"message": "err"}, lambda i: []) is None
    print("self-test OK")


# ---- network shell ----


def call(path: str, method: str = "GET", data: Any = None) -> tuple[int, Any]:
    headers = {
        "Authorization": f"Bearer {os.environ['GITHUB_Token']}",
        "Accept": "application/vnd.github+json",
        "User-Agent": "kamil-pr-bot",
        "Content-Type": "application/json",
    }
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(API + path, data=body, method=method, headers=headers)
    try:
        # a hung socket must not hang an unattended scheduled task forever
        with urllib.request.urlopen(req, timeout=30) as resp:
            text = resp.read().decode()
            return resp.status, (json.loads(text) if text else {})
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:400]
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        # transient network error: callers poll, so report it and let them retry
        print(f"network error on {method} {path}: {e}", file=sys.stderr)
        return 0, {}


def check_runs(sha: str) -> dict[str, dict[str, Any]]:
    _, data = call(f"/commits/{sha}/check-runs?per_page=100")
    runs = data.get("check_runs", []) if isinstance(data, dict) else []
    return {run["name"]: run for run in runs}


def wait_for_prod(merge_sha: str) -> str | None:
    state = None
    for _ in range(40):
        _, deps = call(f"/deployments?sha={merge_sha}")
        state = prod_state(deps, lambda dep_id: call(f"/deployments/{dep_id}/statuses")[1])
        print("prod deploy", state)
        if state in ("success", "failure", "error"):
            break
        time.sleep(20)
    return state


def ship(num: str) -> None:
    for round_ in range(3):
        _, pr = call(f"/pulls/{num}")
        if not isinstance(pr, dict):
            sys.exit(f"cannot read PR #{num}: {str(pr)[:200]}")
        if pr.get("merged"):
            print("already merged")
            return
        # mergeable_state is computed lazily; poll until it settles
        for _ in range(10):
            if pr.get("mergeable_state") not in (None, "unknown"):
                break
            time.sleep(5)
            _, pr = call(f"/pulls/{num}")
        state = pr.get("mergeable_state")
        sha = pr["head"]["sha"]
        print(f"round {round_} sha {sha[:7]} mergeable_state {state}")
        if state == "behind":
            code, data = call(f"/pulls/{num}/update-branch", "PUT", {})
            print("update-branch", code, str(data)[:120])
            if code != 202:
                sys.exit("update-branch failed")
            time.sleep(30)
            continue
        if state == "dirty":
            sys.exit("CONFLICT: merge conflict with main — resolve locally")

        deadline = time.time() + 1500  # required checks + review, max 25 min
        runs = check_runs(sha)
        while not all_done(runs) and time.time() < deadline:
            time.sleep(30)
            runs = check_runs(sha)
        for name in sorted(runs):
            print(f"  {name}: {runs[name]['status']}/{runs[name]['conclusion']}")
        bad = failing_required(runs)
        if bad:
            sys.exit(f"REFUSED: required checks not green on {sha[:7]}: {bad}")
        verdict, body = parse_verdict(call(f"/issues/{num}/comments?per_page=100")[1])
        print("verdict", verdict)
        if verdict != "APPROVE":
            print((body or "")[:3000])
            sys.exit(f"REFUSED: claude-review verdict is {verdict!r}, not APPROVE")
        _, pr = call(f"/pulls/{num}")
        if pr.get("mergeable_state") == "behind":
            print("became behind while waiting; another round")
            continue
        # scar 2026-09-06: two workflow edits valid on their own, invalid once
        # merged; GitHub then runs no gates on main. Lint the merge result.
        repo_name = REPO.split("/", 1)[1]
        token = os.environ["GITHUB_Token"]
        wf_paths = workflow_files_in_pr(repo_name, int(num), token)
        if wf_paths:
            wf_errors = lint_merge_ref_workflows(repo_name, int(num), wf_paths, token)
            if wf_errors:
                sys.exit("REFUSED: workflow files invalid on the merge ref: " + "; ".join(wf_errors))
            print("workflow-lint on merge ref OK:", ", ".join(wf_paths))
        payload = {"merge_method": "squash", "commit_title": f"{pr['title']} (#{num})"}
        code, data = call(f"/pulls/{num}/merge", "PUT", payload)
        print("merge", code, str(data)[:200])
        if code != 200:
            sys.exit("merge failed")
        merge_sha = data["sha"]
        code, _ = call(f"/git/refs/heads/{pr['head']['ref']}", "DELETE")
        print("delete branch", pr["head"]["ref"], code)
        state = wait_for_prod(merge_sha)
        if state != "success":
            # main is already merged: the caller must not treat this as done
            sys.exit(
                f"DEPLOY NOT CONFIRMED: PR #{num} is merged ({merge_sha[:7]}) but the production "
                f"deploy ended as {state!r}. Check Vercel; roll back with `vercel promote <previous>` "
                "or revert the merge commit."
            )
        return
    sys.exit("gave up after 3 update-branch rounds")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    if sys.argv[1] == "--self-test":
        self_test()
    else:
        ship(sys.argv[1])

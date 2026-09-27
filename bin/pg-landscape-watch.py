#!/usr/bin/env python3
"""Monthly scan for PG-landscape watchlist: repo drift + new high-star candidates.

stdlib only. Reads GITHUB_Token from env (injected by the caller, e.g. the
Infisical bridge). Never logs or prints the token.

Exit codes:
  0  - clean run, no significant change
  10 - significant change found (report written, caller should hand to a model)
  2  - clean run but some repos could not be scanned (partial failure) — no
       drift signal for those repos this month, human should check
  1  - hard failure: watchlist missing/unreadable, no token, or every repo
       scan failed (nothing usable came back)
"""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request
from collections.abc import Callable
from pathlib import Path
from urllib.parse import quote

GhGetFn = Callable[..., "tuple[dict | list | None, int]"]

WATCHLIST_PATH = Path(__file__).resolve().parent.parent / "pg" / "landscape" / "watchlist.json"
LOG_DIR = Path(__file__).resolve().parent.parent / "logs" / "pg-landscape-watch"

TRACKED_DIRS = {"hooks", "scripts", "bin", "agents", "skills", "src"}
# Vendored/built/fixture copies would crowd real enforcement files out of the
# 20-file report cap.
EXCLUDED_DIRS = {
    "node_modules", "vendor", "third_party", "dist", "build", "fixtures", "__fixtures__", "testdata", "examples", "website", "docs",
}
MD_ALLOW_BASENAMES = {"skill.md", "agents.md"}
MAX_REPORTED_FILENAME_LEN = 200

NEW_CANDIDATE_STAR_THRESHOLD = 500
NEW_CANDIDATE_GROWTH_THRESHOLD = 200

# GitHub Search API allows 30 req/min authenticated; stay comfortably under it.
SEARCH_SLEEP_SECONDS = 2.2
# Rate-limit statuses: retrying blind makes secondary rate limits worse, not
# better (GitHub often wants 60s+ via Retry-After) — fail fast instead.
RATE_LIMIT_STATUSES = {403, 429}
# Transient server errors: a short single retry is legitimately helpful here.
SERVER_ERROR_STATUSES = {500, 502, 503, 504}
RETRY_BACKOFF_SECONDS = 2.0
MAX_REPORTED_CHANGED_FILES = 20


AUTH_HEADER = "Authorization"  # jedno zrodlo prawdy (dup-literals 2026-09-27)


class _HostCheckedRedirectHandler(urllib.request.HTTPRedirectHandler):
    """Strip Authorization before following a redirect to a different host."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        new_req = super().redirect_request(req, fp, code, msg, headers, newurl)
        if new_req is None:
            return None
        if new_req.host != req.host or new_req.type != req.type:
            new_req.remove_header(AUTH_HEADER)
        return new_req


_OPENER = urllib.request.build_opener(_HostCheckedRedirectHandler)


def gh_get(path: str, token: str, _retried: bool = False) -> tuple[dict | list | None, int]:
    headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "pg-landscape-watch",
    }
    if token:
        headers[AUTH_HEADER] = f"Bearer {token}"
    req = urllib.request.Request(f"https://api.github.com{path}", headers=headers)
    try:
        with _OPENER.open(req, timeout=20) as r:
            return json.loads(r.read().decode("utf-8")), r.status
    except urllib.error.HTTPError as e:
        if e.code in SERVER_ERROR_STATUSES and not _retried:
            # Transient server error: one short retry is worth it.
            time.sleep(RETRY_BACKOFF_SECONDS)
            return gh_get(path, token, _retried=True)
        # Rate-limit statuses (403/429): GitHub usually wants 60s+ before a
        # retry would succeed. Blindly retrying after a couple of seconds
        # doesn't help and can make a secondary rate limit worse — fail
        # fast and let the caller count it as a scan/search error instead.
        return None, e.code
    except urllib.error.URLError:
        if not _retried:
            time.sleep(RETRY_BACKOFF_SECONDS)
            return gh_get(path, token, _retried=True)
        return None, 0


def is_tracked_path(path: str) -> bool:
    # Match the directory anywhere in the path, not only at the repo root:
    # plugin-style repos keep enforcement code in plugins/<name>/hooks/ etc.
    # (root-only matching missed >50 % of such files in 19 of 35 repos).
    parts = path.split("/")
    dirs, basename = parts[:-1], parts[-1].lower()
    if any(d in EXCLUDED_DIRS for d in dirs):
        return False
    in_tracked_dir = any(d in TRACKED_DIRS for d in dirs) or "/.github/workflows/" in f"/{path}"
    if basename.endswith(".md"):
        # Docs are noise; skill/agent definitions are the enforcement content.
        return basename in MD_ALLOW_BASENAMES or "agents" in dirs
    return in_tracked_dir


def _sanitize_reported_string(value: str | None) -> str | None:
    """Untrusted repo-controlled text lands in a report a model may read.

    Strip control characters and cap length so a hostile filename/tag can't
    smuggle a large prompt-injection payload into that context.
    """
    if not value:
        return value
    cleaned = "".join(ch for ch in value if ch.isprintable())
    return cleaned[:MAX_REPORTED_FILENAME_LEN]


def scan_repo(slug: str, saved: dict, token: str, gh_get_fn: GhGetFn | None = None) -> dict:
    if gh_get_fn is None:
        gh_get_fn = gh_get
    owner, name = slug.split("/", 1)
    repo_data, status = gh_get_fn(f"/repos/{owner}/{name}", token)
    if status != 200 or not isinstance(repo_data, dict):
        return {"repo": slug, "error": True, "status": status, "significant": False}

    branch = quote(repo_data.get("default_branch", "main"), safe="")
    stars = repo_data.get("stargazers_count", 0)
    saved_sha = saved.get("head_sha")

    commit_data, cstatus = gh_get_fn(f"/repos/{owner}/{name}/commits/{branch}", token)
    head_sha = commit_data.get("sha") if cstatus == 200 and isinstance(commit_data, dict) else None

    result = {
        "repo": slug,
        "stars": stars,
        "stars_prev": saved.get("stars"),
        "pushed_at": repo_data.get("pushed_at"),
        "head_sha": head_sha,
        "head_sha_prev": saved_sha,
        "commits_since": None,
        "changed_tracked_files": [],
        "new_release": None,
        "compare_failed": False,
        # HEAD-FETCH-FAIL-SILENT: the /repos call above can succeed while
        # /commits fails independently — that must still count as "this
        # repo could not be fully scanned", not a quiet no-op.
        "head_fetch_failed": cstatus != 200,
        "significant": False,
    }

    if saved_sha and head_sha and saved_sha != head_sha:
        safe_saved_sha = quote(saved_sha, safe="")
        safe_head_sha = quote(head_sha, safe="")
        # Public, token-free diff for whoever evaluates the change later, so
        # that reader never needs the GitHub token in its context.
        result["diff_url"] = f"https://github.com/{slug}/compare/{safe_saved_sha}...{safe_head_sha}.diff"
        compare_data, comp_status = gh_get_fn(
            f"/repos/{owner}/{name}/compare/{safe_saved_sha}...{safe_head_sha}", token
        )
        if comp_status == 200 and isinstance(compare_data, dict):
            result["commits_since"] = len(compare_data.get("commits", []))
            tracked = [
                _sanitize_reported_string(f["filename"])
                for f in compare_data.get("files", []) or []
                if is_tracked_path(f["filename"])
            ]
            # Cap on the *number* of reported filenames too, not just each
            # filename's length — an attacker-controlled commit could touch
            # hundreds of tracked-looking paths to inflate the report.
            if len(tracked) > MAX_REPORTED_CHANGED_FILES:
                tracked = [*tracked[:MAX_REPORTED_CHANGED_FILES], f"...(+{len(tracked) - MAX_REPORTED_CHANGED_FILES} more)"]
            result["changed_tracked_files"] = tracked
            if tracked:
                result["significant"] = True
        else:
            # Comparison failed (404 on a rebased/force-pushed branch, rate
            # limit, transient 5xx, ...): flag it so a human notices instead
            # of it looking like "nothing happened". The baseline still
            # advances (see main()) so a permanently-stale saved_sha (e.g.
            # after a force-push) doesn't get the repo stuck reporting this
            # every month forever.
            result["compare_failed"] = True
            result["significant"] = True

    releases_data, rstatus = gh_get_fn(f"/repos/{owner}/{name}/releases", token)
    if rstatus == 200 and releases_data:
        latest = releases_data[0] if releases_data else None
        if latest:
            prev_release = saved.get("latest_release")
            tag = _sanitize_reported_string(latest.get("tag_name"))
            if tag != prev_release:
                result["new_release"] = tag
                result["significant"] = True
            result["latest_release"] = tag

    return result


def gh_search(query: str, token: str, gh_get_fn: GhGetFn | None = None) -> tuple[list[dict], bool]:
    """Returns (items, failed). failed=True means the query could not be run
    (rate limit / error), distinct from a genuine zero-result search."""
    if gh_get_fn is None:
        gh_get_fn = gh_get
    data, status = gh_get_fn(f"/search/repositories?q={quote(query)}&sort=stars&order=desc&per_page=20", token)
    if status != 200 or not isinstance(data, dict):
        return [], True
    return data.get("items", []), False


def run_discovery(watchlist: dict, token: str, gh_get_fn: GhGetFn | None = None) -> tuple[list[dict], int]:
    """Returns (new_candidates, failed_query_count)."""
    if gh_get_fn is None:
        gh_get_fn = gh_get
    known_slugs = set(watchlist.get("repos", {}).keys())
    # setdefault (not get) so mutations here are visible to the caller, who
    # persists watchlist["stars_history"] after this returns. A hand-edited
    # `null` in the JSON would otherwise make setdefault a no-op and crash
    # the next .get() call, so normalize that case first.
    if watchlist.get("stars_history") is None:
        watchlist["stars_history"] = {}
    star_history = watchlist["stars_history"]
    # Candidates already reported once shouldn't be re-reported every month
    # just for sitting above the flat star threshold — only a fresh sighting
    # or a further jump in popularity is worth surfacing again.
    if watchlist.get("reported_candidates") is None:
        watchlist["reported_candidates"] = {}
    reported = watchlist["reported_candidates"]
    queries = watchlist.get("queries_run", [])
    new_candidates: dict[str, dict] = {}
    failed_query_count = 0

    for query in queries:
        items, failed = gh_search(query, token, gh_get_fn)
        if failed:
            failed_query_count += 1
        for item in items:
            slug = item.get("full_name")
            if not slug:
                continue
            stars = item.get("stargazers_count", 0)
            prev_stars = star_history.get(slug)
            growth = (stars - prev_stars) if prev_stars is not None else None
            # Track every candidate we ever see (bounded by search result
            # size), so a repo's growth is measurable on a *later* run even
            # if it doesn't cross the threshold today. Without this, growth
            # never had a baseline to compare against.
            star_history[slug] = stars
            if slug in known_slugs or slug in new_candidates:
                continue
            already_reported_at = reported.get(slug)
            grown_since_reported = (
                already_reported_at is None or stars - already_reported_at > NEW_CANDIDATE_GROWTH_THRESHOLD
            )
            if not grown_since_reported:
                continue
            if stars > NEW_CANDIDATE_STAR_THRESHOLD or (
                growth is not None and growth > NEW_CANDIDATE_GROWTH_THRESHOLD
            ):
                new_candidates[slug] = {
                    "repo": slug,
                    "stars": stars,
                    "growth_since_last_scan": growth,
                    "matched_query": query,
                    "url": item.get("html_url"),
                }
                reported[slug] = stars
        time.sleep(SEARCH_SLEEP_SECONDS)

    return list(new_candidates.values()), failed_query_count


def _atomic_write_json(path: Path, data: dict) -> None:
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    tmp_path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp_path, path)


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    # --dry-run: write the report but never advance the persisted baseline.
    # Validation/test runs without it silently consume real drift signal.
    dry_run = "--dry-run" in args
    token = os.environ.get("GITHUB_Token", "")
    if not token:
        print("ERROR: GITHUB_Token is empty — refusing to run unauthenticated (rate limits collapse to 10/min).", file=sys.stderr)
        return 1

    if not WATCHLIST_PATH.exists():
        print(f"ERROR: watchlist not found at {WATCHLIST_PATH}", file=sys.stderr)
        return 1

    watchlist = json.loads(WATCHLIST_PATH.read_text(encoding="utf-8"))
    if watchlist.get("stars_history") is None:
        watchlist["stars_history"] = {}
    repos = watchlist.get("repos", {})

    repo_results = []
    schema_errors = []
    for slug, saved in repos.items():
        if "/" not in slug or not isinstance(saved, dict):
            schema_errors.append(slug)
            continue
        repo_results.append(scan_repo(slug, saved, token))
        time.sleep(0.2)

    new_candidates, failed_query_count = run_discovery(watchlist, token)

    scan_errors = [r for r in repo_results if r.get("error") or r.get("head_fetch_failed")]
    significant_repos = [r for r in repo_results if r.get("significant")]
    significant = bool(significant_repos) or bool(new_candidates)
    # SCHEMA-ERRORS-NOT-SURFACED / the exit-code blocker this fixed: "how many
    # entries did we actually manage to scan" is the single source of truth
    # for hard-vs-partial failure, covering schema-invalid entries AND API
    # errors uniformly instead of two separate, inconsistent special cases.
    scanned_ok_count = len(repo_results) - len(scan_errors)
    total_entries = len(repos)

    now = time.gmtime()
    report = {
        "scanned_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", now),
        "dry_run": dry_run,
        "repo_results": repo_results,
        "new_candidates": new_candidates,
        "significant": significant,
        "scan_error_count": len(scan_errors),
        "scan_error_repos": [r["repo"] for r in scan_errors],
        "schema_error_slugs": schema_errors,
        "failed_search_query_count": failed_query_count,
    }

    LOG_DIR.mkdir(parents=True, exist_ok=True)
    # Timestamped, not just dated: a second run the same day used to overwrite
    # the first report, losing the only record of drift it had detected.
    out_path = LOG_DIR / f"{time.strftime('%Y-%m-%dT%H%M%SZ', now)}{'-dryrun' if dry_run else ''}.json"
    out_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"Report written to {out_path}")
    print(
        f"Significant: {significant} ({len(significant_repos)} repo changes, {len(new_candidates)} new candidates); "
        f"scanned_ok={scanned_ok_count}/{total_entries}, schema_errors={len(schema_errors)}, "
        f"failed_search_queries={failed_query_count}"
    )

    if total_entries > 0 and scanned_ok_count == 0:
        # Nothing usable came back at all (every entry schema-invalid, every
        # API call failed, or a mix summing to zero successes). Don't touch
        # the watchlist — advancing last_scan_at here would make a total
        # outage look like "we checked, all quiet" next time someone reads it.
        print("ERROR: nothing could be scanned (schema errors + API failures cover every entry) — hard failure, not 'no change'.", file=sys.stderr)
        return 1

    if dry_run:
        print("DRY RUN: watchlist.json not modified.")
        return _exit_code(significant, scan_errors, schema_errors, failed_query_count)

    for r in repo_results:
        if r.get("error"):
            continue
        target = repos[r["repo"]]
        # Always advance head_sha when we have a new one, even if the
        # compare call itself failed — otherwise a permanently-stale
        # saved_sha (e.g. after a force-push) gets the repo stuck reporting
        # compare_failed every month with no way to recover.
        if r.get("head_sha"):
            target["head_sha"] = r["head_sha"]
        if r.get("stars") is not None:
            target["stars"] = r["stars"]
            watchlist["stars_history"][r["repo"]] = r["stars"]
        if r.get("pushed_at"):
            target["pushed_at"] = r["pushed_at"]
        if r.get("latest_release"):
            target["latest_release"] = r["latest_release"]
    watchlist["last_scan_at"] = report["scanned_at"]
    _atomic_write_json(WATCHLIST_PATH, watchlist)
    return _exit_code(significant, scan_errors, schema_errors, failed_query_count)


def _exit_code(significant: bool, scan_errors: list, schema_errors: list, failed_query_count: int) -> int:
    if significant:
        return 10
    if scan_errors or schema_errors or failed_query_count:
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())

"""Testy czystych funkcji bin/fleet-active-repos.py (bez sieci). Uruchom: python3 ~/.claude/bin/test_fleet_active_repos.py"""
import importlib.util
import sys
import unittest
from pathlib import Path
from unittest import mock

_spec = importlib.util.spec_from_file_location("far", Path(__file__).with_name("fleet-active-repos.py"))
assert _spec is not None and _spec.loader is not None
far = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(far)

BOTS = {"dependabot[bot]", "renovate[bot]", "github-actions[bot]"}
CFG = {"exclude": ["travel-site"], "pin": ["rental-site"], "sweep_min_repos": 3}
SINCE = "2026-09-14T00:00:00Z"


def ev(iso, text="feat: x", src="commit"):
    return (iso, text, src)


class IsActivity(unittest.TestCase):
    def test_human_commit_counts(self):
        self.assertTrue(far.is_activity("<github-owner>", "feat: booking calendar", BOTS))

    def test_lovable_bot_counts(self):
        self.assertTrue(far.is_activity("gpt-engineer-app[bot]", "Changes", BOTS))

    def test_dependency_bot_does_not_count(self):
        self.assertFalse(far.is_activity("dependabot[bot]", "Bump next from 14.2.3 to 14.2.5", BOTS))

    def test_routine_traces_do_not_count(self):
        for msg in ("chore(deps): bump vite", "chore(cve): override undici", "fix(review): null guard [auto-fix po review]",
                    "docs(review): learnings", "build(deps-dev): bump eslint"):
            self.assertFalse(far.is_activity("<github-owner>", msg, BOTS), msg)


class Rollouts(unittest.TestCase):
    def test_same_title_in_3_repos_is_fleet_rollout(self):
        prs = [("a", "docs: handover"), ("b", "docs: handover"), ("c", "docs: handover"), ("a", "feat: x"), ("a", "feat: x")]
        self.assertEqual(far.rollout_titles(prs), frozenset({"docs: handover"}))

    def test_rollout_pr_and_its_squash_commit_do_not_count(self):
        r = far.rollout_titles([("a", "docs: handover"), ("b", "docs: handover"), ("c", "docs: handover")])
        self.assertFalse(far.is_activity("<github-owner>", "docs: handover", BOTS, r))
        self.assertFalse(far.is_activity("<github-owner>", "docs: handover (#12)", BOTS, r))
        self.assertTrue(far.is_activity("<github-owner>", "feat(radar): fala 2", BOTS, r))


class Classify(unittest.TestCase):
    def setUp(self):
        self.repos = [{"name": n, "archived": n == "archived-one", "pushed_at": "2026-10-13T00:00:00Z"}
                      for n in ("travel-site", "workshop-app", "radar", "old-proto", "rental-site",
                                "archived-one", "a", "b", "c")]

    def run_classify(self, events):
        return far.classify(self.repos, events, CFG, SINCE)

    def test_journey_iceland_always_excluded_and_not_counted_for_sweeps(self):
        active, dormant, excluded, sweeps = self.run_classify({
            "travel-site": [ev("2026-10-13T01:00:00Z")], "a": [ev("2026-10-13T02:00:00Z")], "b": [ev("2026-10-13T03:00:00Z")]})
        self.assertEqual(excluded, ["travel-site"])
        self.assertNotIn("travel-site", [x["name"] for x in active] + dormant)
        self.assertEqual(sweeps, [])  # 2 repo poza exclude < progu 3

    def test_commit_or_pr_in_window_is_active_with_evidence(self):
        active, _, _, _ = self.run_classify({"workshop-app": [ev("2026-10-12T00:00:00Z", "feat: invoices")],
                                             "radar": [ev("2026-10-11T00:00:00Z", "feat(radar): fala 2", "pr")]})
        got = {x["name"]: (x["source"], x["evidence"]) for x in active}
        self.assertEqual(got["workshop-app"], ("commit", "feat: invoices"))
        self.assertEqual(got["radar"], ("pr", "feat(radar): fala 2"))

    def test_activity_before_window_is_dormant(self):
        _, dormant, _, _ = self.run_classify({"old-proto": [ev("2026-05-01T00:00:00Z")]})
        self.assertIn("old-proto", dormant)

    def test_fleet_sweep_day_does_not_make_repo_active(self):
        day = "2026-10-05T1{}:00:00Z"
        active, dormant, _, sweeps = self.run_classify({
            "a": [ev(day.format(1))], "b": [ev(day.format(2))], "c": [ev(day.format(3))],
            "radar": [ev(day.format(4)), ev("2026-10-08T10:00:00Z", "feat(radar): robot")]})
        self.assertEqual(sweeps, ["2026-10-05"])
        self.assertTrue({"a", "b", "c"} <= set(dormant))
        self.assertEqual(next(x for x in active if x["name"] == "radar")["evidence"], "feat(radar): robot")

    def test_pin_keeps_dormant_repo_and_archived_skipped(self):
        active, dormant, _, _ = self.run_classify({})
        self.assertEqual(next(x for x in active if x["name"] == "rental-site")["source"], "pin")
        self.assertNotIn("archived-one", [x["name"] for x in active] + dormant)


class MainContract(unittest.TestCase):
    """Kontrakt dla rutyn: kazdy blad = exit 1 (FAILED), nigdy cicha pelna flota (code-review 2026-10-14)."""

    def setUp(self):
        self._env = {k: far.os.environ.pop(k) for k in ("GITHUB_Token", "GITHUB_TOKEN", "GH_TOKEN") if k in far.os.environ}

    def tearDown(self):
        far.os.environ.pop("GITHUB_Token", None)
        far.os.environ.update(self._env)

    def test_no_token_exits_1(self):
        self.assertEqual(far.main(["--days", "30"]), 1)

    def test_days_zero_is_rejected_not_replaced_by_config(self):
        far.os.environ["GITHUB_Token"] = "t"
        with mock.patch.object(far, "gh", side_effect=AssertionError("--days 0 nie moze dojsc do API")) as gh:
            self.assertEqual(far.main(["--days", "0"]), 1)
        gh.assert_not_called()

    def test_api_error_exits_1(self):
        far.os.environ["GITHUB_Token"] = "t"
        with mock.patch.object(far, "gh", side_effect=far.urllib.error.URLError("down")):
            self.assertEqual(far.main(["--days", "30"]), 1)

    def test_zero_repos_from_api_exits_1(self):
        far.os.environ["GITHUB_Token"] = "t"
        with mock.patch.object(far, "gh", return_value=[]):
            self.assertEqual(far.main(["--days", "30"]), 1)


class Events(unittest.TestCase):
    def test_pr_events_skips_bots_and_rollouts(self):
        items = [{"user": {"login": "<github-owner>"}, "title": "feat: a", "created_at": "2026-10-10T00:00:00Z",
                  "repository_url": "https://api.github.com/repos/<github-owner>/radar"},
                 {"user": {"login": "dependabot[bot]"}, "title": "Bump x", "created_at": "2026-10-11T00:00:00Z",
                  "repository_url": "https://api.github.com/repos/<github-owner>/shop"}]
        self.assertEqual(far.pr_events(items, BOTS, frozenset()), {"radar": [("2026-10-10T00:00:00Z", "feat: a", "pr")]})

    def test_commit_events_skips_merges_and_empty_repo_409(self):
        def fake_gh(path, token, **k):
            if "/empty/" in path:
                raise far.urllib.error.HTTPError(path, 409, "Git Repository is empty", {}, None)
            return [{"parents": [{}, {}], "author": {"login": "<github-owner>"}, "commit": {"message": "Merge pull request #1", "committer": {"date": "2026-10-12T00:00:00Z"}}},
                    {"parents": [{}], "author": {"login": "<github-owner>"}, "commit": {"message": "feat: real\n\nbody", "committer": {"date": "2026-10-11T00:00:00Z"}}}]
        repos = [{"name": n, "archived": False, "pushed_at": "2026-10-13T00:00:00Z", "default_branch": "main"} for n in ("empty", "radar")]
        with mock.patch.object(far, "gh", side_effect=fake_gh):
            got = far.commit_events("<github-owner>", repos, SINCE, BOTS, frozenset(), "t")
        self.assertEqual(got, {"radar": [("2026-10-11T00:00:00Z", "feat: real", "commit")]})

    def test_gh_retries_transient_5xx_then_succeeds(self):
        calls = []

        class Resp:
            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def read(self):
                return b"[1]"

        def fake_urlopen(req, timeout):
            calls.append(1)
            if len(calls) < 3:
                raise far.urllib.error.HTTPError("u", 502, "bad gateway", {}, None)
            return Resp()
        with mock.patch.object(far.urllib.request, "urlopen", side_effect=fake_urlopen):
            self.assertEqual(far.gh("/x", "t", sleep=lambda s: None), [1])
        self.assertEqual(len(calls), 3)

    def _repos(self, *names):
        return [{"name": n, "archived": False, "pushed_at": "2026-10-13T00:00:00Z", "default_branch": "main"} for n in names]

    def test_commit_events_all_404_is_run_error_not_quiet_month(self):
        def all_404(path, token, **k):
            raise far.urllib.error.HTTPError(path, 404, "Not Found", {}, None)
        with mock.patch.object(far, "gh", side_effect=all_404), self.assertRaises(RuntimeError):
            far.commit_events("<github-owner>", self._repos("a", "b"), SINCE, BOTS, frozenset(), "t")

    def test_commit_events_403_aborts_whole_run(self):
        def forbidden(path, token, **k):
            raise far.urllib.error.HTTPError(path, 403, "Forbidden", {}, None)
        with mock.patch.object(far, "gh", side_effect=forbidden), self.assertRaises(far.urllib.error.HTTPError):
            far.commit_events("<github-owner>", self._repos("a"), SINCE, BOTS, frozenset(), "t")

    def test_gh_does_not_retry_404(self):
        calls = []

        def nf(req, timeout):
            calls.append(1)
            raise far.urllib.error.HTTPError("u", 404, "Not Found", {}, None)
        with mock.patch.object(far.urllib.request, "urlopen", side_effect=nf), self.assertRaises(far.urllib.error.HTTPError):
            far.gh("/x", "t", sleep=lambda s: None)
        self.assertEqual(len(calls), 1)

    def test_search_prs_partial_or_truncated_result_is_run_error(self):
        partial = {"incomplete_results": True, "items": []}
        with mock.patch.object(far, "gh", return_value=partial) as gh, self.assertRaises(RuntimeError):
            far.search_prs("<github-owner>", SINCE, "t", sleep=lambda s: None)
        self.assertEqual(gh.call_count, 3)  # strona ponawiana, dopiero potem FAILED (data + ops etap1f)
        full_page = {"incomplete_results": False, "items": [{}] * 100}
        with mock.patch.object(far, "gh", return_value=full_page) as gh, self.assertRaises(RuntimeError):
            far.search_prs("<github-owner>", SINCE, "t")
        self.assertEqual(gh.call_count, 10)

    def test_search_prs_retries_incomplete_page_then_joins_pages(self):
        pages = [{"incomplete_results": True, "items": []},
                 {"incomplete_results": False, "items": [{"n": i} for i in range(100)]},
                 {"incomplete_results": False, "items": [{"n": 100}, {"n": 101}]}]
        with mock.patch.object(far, "gh", side_effect=pages) as gh:
            items = far.search_prs("<github-owner>", SINCE, "t", sleep=lambda s: None)
        self.assertEqual(len(items), 102)  # strona pelna + krotka = laczenie, bez gubienia stron (code + data etap1f)
        self.assertEqual(gh.call_count, 3)

    def test_main_never_queries_commits_of_excluded_repo(self):
        cfg = {"owner": "<github-owner>", "active_days": 30, "exclude": ["travel-site"], "pin": [], "sweep_min_repos": 8}
        with mock.patch.object(far, "SCOPE") as scope, mock.patch.dict(far.os.environ, {"GITHUB_Token": "t"}), \
                mock.patch.object(far, "list_repos", return_value=self._repos("travel-site", "demo-site")), \
                mock.patch.object(far, "search_prs", return_value=[]), \
                mock.patch.object(far, "commit_events", return_value={}) as ce, mock.patch("sys.stdout"):
            scope.read_text.return_value = far.json.dumps(cfg)
            self.assertEqual(far.main([]), 0)
        self.assertEqual([r["name"] for r in ce.call_args.args[1]], ["demo-site"])

    def test_gh_sends_token_only_as_unredirected_header(self):
        seen = {}

        def capture(req, timeout):
            seen["headers"], seen["unredirected"] = dict(req.headers), dict(req.unredirected_hdrs)
            raise far.urllib.error.HTTPError("u", 404, "Not Found", {}, None)
        with mock.patch.object(far.urllib.request, "urlopen", side_effect=capture), self.assertRaises(far.urllib.error.HTTPError):
            far.gh("/x", "secret", sleep=lambda s: None)
        self.assertNotIn("Authorization", seen["headers"])  # przekierowanie kopiuje headers, nie unredirected (security etap1e F3)
        self.assertEqual(seen["unredirected"].get("Authorization"), "Bearer secret")

    def test_unknown_pin_or_exclude_names_are_reported(self):
        cfg = {"pin": ["rental-sites"], "exclude": ["travel-site"]}
        self.assertEqual(far.unknown_names(self._repos("travel-site", "rental-site"), cfg), ["rental-sites"])

    def test_gh_retries_dropped_connection_then_fails_loud(self):
        calls = []

        def drop(req, timeout):
            calls.append(1)
            raise far.http.client.RemoteDisconnected("closed without response")
        with mock.patch.object(far.urllib.request, "urlopen", side_effect=drop), self.assertRaises(OSError):
            far.gh("/x", "t", sleep=lambda s: None)
        self.assertEqual(len(calls), 3)


if __name__ == "__main__":
    sys.exit(0 if unittest.main(exit=False, verbosity=1).result.wasSuccessful() else 1)

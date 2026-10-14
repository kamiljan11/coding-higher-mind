"""Testy bin/fleet-dependabot-alerts.py (bez sieci). Uruchom: python3 ~/.claude/bin/test_fleet_dependabot_alerts.py"""
import email.message
import http.client
import importlib.util
import io
import json
import sys
import unittest
import urllib.error
from pathlib import Path
from unittest import mock

_spec = importlib.util.spec_from_file_location("fda", Path(__file__).with_name("fleet-dependabot-alerts.py"))
assert _spec is not None and _spec.loader is not None
fda = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(fda)

CFG = {"owner": "<github-owner>", "exclude": ["travel-site"]}
ALERT = {"security_advisory": {"severity": "critical", "ghsa_id": "GHSA-aaaa"},
         "security_vulnerability": {"first_patched_version": {"identifier": "15.0.1"}},
         "dependency": {"package": {"ecosystem": "npm", "name": "next"}, "scope": "runtime"}}
ROW = "critical\tnpm/next\tGHSA-aaaa\truntime\t15.0.1"


def repos(*names, archived=()):
    return lambda owner, token: [{"name": n, "archived": n in archived} for n in names]


def http_error(code, body=b""):
    return urllib.error.HTTPError("u", code, "x", email.message.Message(), io.BytesIO(body))


def collect(cfg, list_repos, gh):
    lines = []
    rc = fda.run(cfg, "t", out=lines.append, list_repos=list_repos, gh=gh)
    return rc, lines


class Run(unittest.TestCase):
    def test_alerts_disabled_and_end_marker(self):
        def gh(path, token):
            if "/demo-site/" in path:
                return [ALERT]
            if "/shop-base/" in path:
                raise http_error(403, b'{"message":"Dependabot alerts are disabled for this repository."}')
            return []
        rc, lines = collect(CFG, repos("demo-site", "shop-base", "quiet"), gh)
        self.assertEqual(rc, 0)
        self.assertIn("ALERT\tdemo-site\t" + ROW, lines)
        self.assertIn("DISABLED\tshop-base", lines)
        self.assertEqual(lines[-1], "END repos=3 alerts=1 disabled=1 err=0")

    def test_other_http_error_is_err_and_exit_1(self):
        def gh(path, token):
            raise http_error(403, b'{"message":"Resource not accessible by integration"}')  # 403 bez „disabled" = brak uprawnien
        rc, lines = collect(CFG, repos("a"), gh)
        self.assertEqual((rc, lines[0]), (1, "ERR\ta\t403"))
        self.assertEqual(lines[-1], "END repos=1 alerts=0 disabled=0 err=1")

    def test_excluded_and_archived_repos_never_queried(self):
        asked = []

        def gh(path, token):
            asked.append(path)
            return []
        rc, lines = collect(CFG, repos("travel-site", "old", "live", archived=("old",)), gh)
        self.assertEqual(rc, 0)
        self.assertEqual(len(asked), 1)
        self.assertIn("/live/", asked[0])
        self.assertFalse(any("travel-site" in line for line in lines))

    def test_no_repos_is_failure_not_quiet_month(self):
        rc, lines = collect(CFG, repos(), lambda p, t: [])
        self.assertEqual(rc, 1)
        self.assertEqual(lines[-1], "END repos=0 alerts=0 disabled=0 err=1")

    def test_full_page_is_err_not_undercount(self):
        rc, lines = collect(CFG, repos("big"), lambda p, t: [ALERT] * 100)
        self.assertEqual((rc, lines[0]), (1, "ERR\tbig\ttruncated"))

    def test_network_error_and_5xx_mark_repo_and_scan_continues(self):
        def gh(path, token):
            if "/a/" in path:
                raise urllib.error.URLError("timed out")
            if "/b/" in path:
                raise http_error(502)
            return [ALERT]
        rc, lines = collect(CFG, repos("a", "b", "c"), gh)
        self.assertEqual(rc, 1)
        self.assertEqual(lines[:2], ["ERR\ta\tnet:URLError", "ERR\tb\t502"])
        self.assertIn("ALERT\tc\t" + ROW, lines)  # repo po bledzie nadal skanowane
        self.assertEqual(lines[-1], "END repos=3 alerts=1 disabled=0 err=2")

    def test_bad_json_object_and_incomplete_read_are_per_repo_err(self):
        def gh(path, token):
            if "/a/" in path:
                raise json.JSONDecodeError("x", "<html>", 0)
            if "/b/" in path:
                return {"message": "Bad credentials"}
            if "/c/" in path:
                raise http.client.IncompleteRead(b"")
            return []
        rc, lines = collect(CFG, repos("a", "b", "c", "d"), gh)
        self.assertEqual(rc, 1)
        self.assertEqual(lines, ["ERR\ta\tjson", "ERR\tb\tshape", "ERR\tc\tnet:IncompleteRead",
                                 "END repos=4 alerts=0 disabled=0 err=3"])

    def test_alert_without_fix_or_scope_keeps_columns(self):
        bare = {"security_advisory": {"severity": "high", "ghsa_id": "GHSA-bbbb"},
                "dependency": {"package": {"ecosystem": "pip", "name": "pillow"}}}
        rc, lines = collect(CFG, repos("py"), lambda p, t: [bare])
        self.assertEqual((rc, lines[0]), (0, "ALERT\tpy\thigh\tpip/pillow\tGHSA-bbbb\t?\t-"))


class Main(unittest.TestCase):
    def _main(self, cfg_text, env):
        out = io.StringIO()
        with mock.patch.object(fda.far, "SCOPE") as scope, mock.patch.dict(fda.os.environ, env, clear=True), \
                mock.patch("sys.stdout", out), mock.patch("sys.stderr", io.StringIO()):
            scope.read_text.return_value = cfg_text
            rc = fda.main()
        return rc, out.getvalue().strip().splitlines()

    def test_missing_token_fails_closed(self):
        rc, lines = self._main(json.dumps(CFG), {})
        self.assertEqual((rc, lines[-1]), (1, "END repos=0 alerts=0 disabled=0 err=1"))

    def test_exclude_without_journey_iceland_fails_closed(self):
        rc, lines = self._main(json.dumps({"owner": "<github-owner>", "exclude": []}), {"GITHUB_Token": "t"})
        self.assertEqual((rc, lines[-1]), (1, "END repos=0 alerts=0 disabled=0 err=1"))

    def test_list_repos_http_exception_still_prints_end(self):
        with mock.patch.object(fda, "run", side_effect=http.client.IncompleteRead(b"")):
            rc, lines = self._main(json.dumps(CFG), {"GITHUB_Token": "t"})
        self.assertEqual((rc, lines[-1]), (1, "END repos=0 alerts=0 disabled=0 err=1"))

    def test_broken_config_fails_closed(self):
        rc, lines = self._main("{not json", {"GITHUB_Token": "t"})
        self.assertEqual((rc, lines[-1]), (1, "END repos=0 alerts=0 disabled=0 err=1"))


if __name__ == "__main__":
    sys.exit(0 if unittest.main(exit=False, verbosity=1).result.wasSuccessful() else 1)

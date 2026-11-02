#!/usr/bin/env python3
"""Testy bin/pg-escapes.py (M-C: orientacyjny wskaznik ucieczek). Uruchom: python3 ~/.claude/bin/test_pg_escapes.py

Syntetyczne repo git w tmp z ustalonymi datami (GIT_AUTHOR_DATE/GIT_COMMITTER_DATE), osobny GIT_CONFIG_GLOBAL, bez core.hooksPath.
Wymaga git i node (tier liczy hooks/lib/risk-tier.js).
"""
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

BIN = Path(__file__).resolve().parent
SCRIPT = BIN / "pg-escapes.py"
BASE_TS = 1767268800  # 2026-01-01T12:00:00Z
DAY = 86400

TMP = Path(tempfile.mkdtemp(prefix="pg-escapes-test-"))
GITCONFIG = TMP / "gitconfig"
GITCONFIG.write_text("[user]\n\tname = Test\n\temail = test@example.invalid\n[init]\n\tdefaultBranch = main\n"
                     "[commit]\n\tgpgsign = false\n")
_ENV_BEFORE = dict(os.environ)  # env testu tylko na czas modulu: pytest zbiera wiele plikow w jednym procesie
_TEST_ENV_KEYS = ("GIT_CONFIG_GLOBAL", "GIT_CONFIG_NOSYSTEM", "GIT_TERMINAL_PROMPT", "GIT_CONFIG_PARAMETERS")

_spec = importlib.util.spec_from_file_location("pg_escapes", SCRIPT)
if _spec is None or _spec.loader is None:
    raise SystemExit(f"nie mozna zaladowac {SCRIPT}")
pe = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(pe)


def setUpModule():
    os.environ.update({"GIT_CONFIG_GLOBAL": str(GITCONFIG), "GIT_CONFIG_NOSYSTEM": "1", "GIT_TERMINAL_PROMPT": "0"})
    os.environ.pop("GIT_CONFIG_PARAMETERS", None)


def tearDownModule():
    shutil.rmtree(TMP, ignore_errors=True)
    for k in _TEST_ENV_KEYS:
        if k in _ENV_BEFORE:
            os.environ[k] = _ENV_BEFORE[k]
        else:
            os.environ.pop(k, None)


class Repo:
    """Cienkie opakowanie na repo git z deterministycznymi datami (dzien = offset od BASE_TS)."""

    _n = 0

    def __init__(self, branch="main", init=True):
        Repo._n += 1
        self.path = TMP / f"repo{Repo._n}"
        self.path.mkdir()
        if init:
            self.git("init", "-q", "-b", branch)

    def git(self, *args, day=None, check=True):
        env = dict(os.environ)
        if day is not None:
            stamp = f"{BASE_TS + int(day * DAY)} +0000"
            env.update({"GIT_AUTHOR_DATE": stamp, "GIT_COMMITTER_DATE": stamp})
        p = subprocess.run(["git", "-C", str(self.path), *args], env=env, capture_output=True, check=False)
        if check and p.returncode != 0:
            raise RuntimeError(f"git {args}: {p.stderr.decode()}")
        return p.stdout.decode().strip()

    def write(self, files):
        for rel, content in files.items():
            f = self.path / rel
            f.parent.mkdir(parents=True, exist_ok=True)
            f.write_bytes(content if isinstance(content, bytes) else content.encode())

    def commit(self, msg, files, day):
        self.write(files)
        self.git("add", "-A")
        self.git("commit", "-q", "-m", msg, day=day)

    def merge_pr(self, number, branch, pr_title, files, day):
        """Merge commit w stylu GitHub: subject `Merge pull request #N ...`, tytul PR w tresci."""
        self.git("checkout", "-q", "-b", branch)
        self.write(files)
        self.git("add", "-A")
        self.git("commit", "-q", "-m", "wip: " + branch, day=day - 0.5)
        self.git("checkout", "-q", "main")
        self.git("merge", "-q", "--no-ff", branch, "-m", f"Merge pull request #{number} from user/{branch}", "-m", pr_title, day=day)

    def init_commit(self, files=None):
        self.commit("chore: init", files or {"README.md": "x\n"}, day=0)


def analyze(repo, **kw):
    return pe.analyze_repo(repo.path, **kw)


class TestPgEscapes(unittest.TestCase):
    def test_squash_and_merge_commit_with_scope_and_bang(self):
        r = Repo()
        r.init_commit({"README.md": "x\n", "src/api.ts": "a\n", "src/b.ts": "b\n"})
        r.commit("feat: add api (#1)", {"src/api.ts": "a1\n"}, day=10)
        r.commit("fix(api): repair (#2)", {"src/api.ts": "a2\n"}, day=12)
        r.merge_pr(3, "feat-b", "feat: add b", {"src/b.ts": "b1\n"}, day=40)
        r.merge_pr(4, "fix-b", "fix(b)!: break things", {"src/b.ts": "b2\n"}, day=42)
        r.commit("docs: readme tweak (#5)", {"README.md": "w\n"}, day=60)
        r.commit("chore: tail", {"README.md": "y\n"}, day=100)  # HEAD: wiek 0 -> cenzura
        res = analyze(r)
        self.assertEqual(res["branch"], "main")
        # feat a, merge b; fixy, root i HEAD (cenzura) poza mianownikiem; docs (sam README.md) = unlinkable (nie moze uciec)
        self.assertEqual((res["units"], res["unlinkable"]), (2, 1))
        self.assertEqual(res["escapes"], 2)
        self.assertEqual(res["by_tier"]["T1"], {"units": 2, "escapes": 2})
        self.assertEqual(res["by_tier"]["T0"], {"units": 0, "escapes": 0})
        self.assertEqual(res["conventional_pct"], 100.0)
        self.assertTrue(res["reliable"])

    def test_merge_commit_without_pr_title_is_unit_not_fix(self):
        r = Repo()
        r.init_commit({"README.md": "x\n", "src/b.ts": "b\n"})
        r.merge_pr(1, "feat-b", "feat: b", {"src/b.ts": "b1\n"}, day=10)
        r.commit("chore: tail", {"README.md": "y\n"}, day=60)
        res = analyze(r)
        self.assertEqual((res["units"], res["escapes"]), (1, 0))

    def test_fix_regex(self):
        for ok in ("fix: a", "fix(x): a", "fix!: a", "fix(scope)!: a"):
            self.assertTrue(pe.FIX_RX.match(ok), ok)
        for bad in ("feat: a", "fixup: a", "Fix: a", "bugfix: a", "chore(fix): a", "Revert \"fix: a\""):
            self.assertFalse(pe.FIX_RX.match(bad), bad)

    def test_nearest_unit_attribution_one_fix_one_escape(self):
        r = Repo()
        r.init_commit({"README.md": "x\n", "src/x.ts": "x\n", "src/y.ts": "y\n"})
        r.commit("feat: u1 (#1)", {"src/x.ts": "1\n", "src/y.ts": "1\n"}, day=10)
        r.commit("feat: u2 (#2)", {"src/x.ts": "2\n"}, day=11)
        r.commit("fix: touches x and y (#3)", {"src/x.ts": "3\n", "src/y.ts": "3\n"}, day=12)  # -> u2 (najblizsza, wspolny x)
        r.commit("chore: tail", {"README.md": "t\n"}, day=100)
        res = analyze(r)
        self.assertEqual(res["units"], 2)  # u1, u2
        self.assertEqual(res["escapes"], 1, "fix ma trafic tylko do u2, nie do u1")
        pairs = res["_pairs"]
        self.assertEqual(len(pairs), 1)
        self.assertEqual(pairs[0]["files"], ["src/x.ts"])

    def test_fix_falls_through_to_older_unit_sharing_file(self):
        r = Repo()
        r.init_commit({"README.md": "x\n", "src/x.ts": "x\n", "src/y.ts": "y\n"})
        r.commit("feat: u1 (#1)", {"src/y.ts": "1\n"}, day=10)
        r.commit("feat: u2 (#2)", {"src/x.ts": "2\n"}, day=11)
        r.commit("fix: y only (#3)", {"src/y.ts": "3\n"}, day=12)  # u2 nie dzieli y -> u1
        r.commit("fix: y again (#4)", {"src/y.ts": "4\n"}, day=13)  # drugi fix, ta sama jednostka: nadal 1 ucieczka
        r.commit("chore: tail", {"README.md": "t\n"}, day=100)
        res = analyze(r)
        self.assertEqual(res["escapes"], 1)
        self.assertEqual(len(res["_pairs"]), 2)

    def test_fix_outside_days_window_not_attributed(self):
        r = Repo()
        r.init_commit({"README.md": "x\n", "src/x.ts": "x\n"})
        r.commit("feat: u (#1)", {"src/x.ts": "1\n"}, day=10)
        r.commit("fix: late (#2)", {"src/x.ts": "2\n"}, day=10 + 20)
        r.commit("chore: tail", {"README.md": "t\n"}, day=100)
        self.assertEqual(analyze(r)["escapes"], 0)
        self.assertEqual(analyze(r, days=30)["escapes"], 1)

    def test_ignored_files_do_not_link_fix_to_unit(self):
        r = Repo()
        r.init_commit({"README.md": "x\n", "src/q.ts": "q\n", "package-lock.json": "{}\n", "package.json": "{}\n"})
        r.commit("feat: deps and docs (#1)", {"src/q.ts": "1\n", "package-lock.json": "{\"a\":1}\n", "package.json": "{\"a\":1}\n",
                                              "docs/a.md": "a\n", "CHANGELOG.md": "c\n"}, day=10)
        r.commit("fix: lockfile and docs only (#2)", {"package-lock.json": "{\"a\":2}\n", "package.json": "{\"a\":2}\n",
                                                     "docs/a.md": "b\n", "CHANGELOG.md": "d\n", "README.md": "z\n"}, day=11)
        r.commit("chore: tail", {"README.md": "t\n"}, day=100)
        res = analyze(r)
        self.assertEqual(res["escapes"], 0)
        self.assertTrue(pe.is_ignored("a/b/pnpm-lock.yaml"))
        self.assertTrue(pe.is_ignored("Cargo.lock"))
        self.assertFalse(pe.is_ignored("src/lock.ts"))

    def test_censoring_of_young_units(self):
        r = Repo()
        r.init_commit({"README.md": "x\n", "src/x.ts": "x\n"})
        r.commit("feat: old (#1)", {"src/x.ts": "1\n"}, day=50)       # wiek 50 dni -> liczona
        r.commit("feat: edge (#2)", {"src/x.ts": "2\n"}, day=86)      # wiek dokladnie 14 dni -> liczona
        r.commit("feat: young (#3)", {"src/x.ts": "3\n"}, day=87)     # wiek 13 dni -> cenzura
        r.commit("fix: young fix (#4)", {"src/x.ts": "4\n"}, day=90)  # fix -> young (wykluczona), nie trafia w statystyki
        r.commit("chore: head (#5)", {"README.md": "t\n"}, day=100)   # HEAD, wiek 0 -> cenzura
        res = analyze(r)
        self.assertEqual(res["units"], 2)
        self.assertEqual(res["escapes"], 0, "ucieczka przypisana do jednostki cenzurowanej nie wchodzi do statystyk")
        self.assertEqual(sum(t["units"] for t in res["by_tier"].values()), 2)

    def test_binary_numstat_and_line_based_tier(self):
        self.assertEqual(pe.parse_numstat(b"-\t-\timg.png\x003\t4\tsrc/a.ts\x00"), (["img.png", "src/a.ts"], 7))
        r = Repo()
        r.init_commit({"README.md": "x\n"})
        r.commit("feat: binary only (#1)", {"src/blob.bin": b"\x89PNG\x00\x01\x02\xff" * 50}, day=10)
        r.commit("feat: big text (#2)", {"src/big.ts": "line\n" * 200}, day=20)  # 200 linii >= T2 (150)
        r.commit("chore: tail", {"README.md": "t\n"}, day=100)
        res = analyze(r)
        self.assertEqual(res["units"], 2)
        self.assertEqual(res["by_tier"]["T2"]["units"], 1)
        self.assertEqual(res["by_tier"]["T1"]["units"], 1, "binarny plik: linie = 0, tier z samej sciezki")

    def test_branch_selection_and_skips(self):
        # brak galezi domyslnej (tylko `dev`) -> skip z powodem
        r = Repo(branch="dev")
        r.init_commit()
        res = analyze(r)
        self.assertIn("brak galezi domyslnej", res["skipped"])
        # puste repo -> skip
        self.assertIn("skipped", analyze(Repo()))
        # katalog bez git -> skip
        plain = TMP / "plain"
        plain.mkdir()
        self.assertIn("nie jest repo git", pe.analyze_repo(plain)["skipped"])
        # master gdy brak main
        m = Repo(branch="master")
        m.init_commit({"README.md": "x\n", "src/a.ts": "a\n"})
        m.commit("feat: a (#1)", {"src/a.ts": "1\n"}, day=10)
        m.commit("chore: tail", {"README.md": "t\n"}, day=100)
        self.assertEqual(analyze(m)["branch"], "master")

    def test_origin_head_wins_over_local_main(self):
        r = Repo()
        r.init_commit({"README.md": "x\n", "src/a.ts": "a\n"})
        r.commit("feat: a (#1)", {"src/a.ts": "1\n"}, day=10)
        r.commit("chore: tail", {"README.md": "t\n"}, day=100)
        sha = r.git("rev-parse", "HEAD")
        r.git("update-ref", "refs/remotes/origin/trunk", sha)
        r.git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/trunk")
        self.assertEqual(analyze(r)["branch"], "origin/trunk")

    def test_non_conventional_repo_is_unreliable_and_excluded_from_totals(self):
        r = Repo()
        r.init_commit({"README.md": "x\n", "src/a.ts": "a\n"})
        r.commit("update stuff", {"src/a.ts": "1\n"}, day=10)
        r.commit("more stuff", {"src/a.ts": "2\n"}, day=11)
        r.commit("fix: one", {"src/a.ts": "3\n"}, day=12)
        r.commit("tail", {"README.md": "t\n"}, day=100)
        res = analyze(r)
        self.assertFalse(res["reliable"])
        self.assertLess(res["conventional_pct"], 50)
        good = Repo()
        good.init_commit({"README.md": "x\n", "src/a.ts": "a\n"})
        good.commit("feat: a (#1)", {"src/a.ts": "1\n"}, day=10)
        good.commit("chore: tail", {"README.md": "t\n"}, day=100)
        _, totals, _ = pe.build_report([res, analyze(good)], 10)
        self.assertEqual(totals["T1"]["units"], 1)  # tylko wiarygodne repo
        text = pe.render_text(*pe.build_report([res, analyze(good)], 10), 14, 180)
        self.assertIn("NIEWIARYGODNE", text)

    def test_sample_is_deterministic_and_capped(self):
        r = Repo()
        files = {f"src/f{i}.ts": "0\n" for i in range(6)}
        files["README.md"] = "x\n"
        r.init_commit(files)
        for i in range(6):
            r.commit(f"feat: f{i} (#{i})", {f"src/f{i}.ts": "1\n"}, day=10 + 3 * i)
            r.commit(f"fix: f{i} (#{i + 100})", {f"src/f{i}.ts": "2\n"}, day=11 + 3 * i)
        r.commit("chore: tail", {"README.md": "t\n"}, day=100)
        res = analyze(r)
        self.assertEqual(res["escapes"], 6)
        _, _, s1 = pe.build_report([res], 3)
        _, _, s2 = pe.build_report([res], 3)
        self.assertEqual(len(s1), 3)
        self.assertEqual(s1, s2)
        self.assertEqual(len(pe.build_report([res], 99)[2]), 6)
        self.assertEqual(pe.build_report([res], 0)[2], [])

    def test_never_writes_to_repo(self):
        r = Repo()
        r.init_commit({"README.md": "x\n", "src/a.ts": "a\n"})
        r.commit("feat: a (#1)", {"src/a.ts": "1\n"}, day=10)
        r.commit("chore: tail", {"README.md": "t\n"}, day=100)
        before = (r.git("status", "--porcelain=v1"), r.git("rev-parse", "HEAD"), r.git("reflog"))
        analyze(r)
        self.assertEqual(before, (r.git("status", "--porcelain=v1"), r.git("rev-parse", "HEAD"), r.git("reflog")))

    def test_child_env_hardening(self):
        self.assertIn("core.fsmonitor=false", pe.CHILD_ENV["GIT_CONFIG_PARAMETERS"])
        self.assertIn("core.hooksPath=/dev/null", pe.CHILD_ENV["GIT_CONFIG_PARAMETERS"])
        self.assertEqual(pe.CHILD_ENV["CI"], "1")
        self.assertFalse([k for k in pe.CHILD_ENV if pe._SECRET_ENV_RX.search(k)])
        for name in ("GITHUB_TOKEN", "ANTHROPIC_API_KEY", "db_password", "MY_SECRET"):
            self.assertTrue(pe._SECRET_ENV_RX.search(name), name)
        self.assertFalse(pe._SECRET_ENV_RX.search("PATH"))

    def test_repo_cannot_run_code_via_fsmonitor(self):
        r = Repo()
        r.init_commit({"README.md": "x\n", "src/a.ts": "a\n"})
        r.commit("feat: a (#1)", {"src/a.ts": "1\n"}, day=10)
        r.commit("chore: tail", {"README.md": "t\n"}, day=100)
        marker = TMP / "pwned"
        hook = TMP / "fsmon.sh"
        hook.write_text(f"#!/bin/sh\ntouch {marker}\n")
        hook.chmod(0o755)
        r.git("config", "core.fsmonitor", str(hook))
        analyze(r)
        self.assertFalse(marker.exists())

    def test_commit_message_cannot_inject_records_or_options(self):
        # tresc commita z \x1e/\x1f udawala rekord git log, a jego pola szly do `git diff` jako opcje (pg-review p345c security-1)
        victim = TMP / "victim-inj.txt"
        victim.write_text("victim-content\n")
        r = Repo()
        r.init_commit({"README.md": "x\n", "src/a.ts": "a\n"})
        r.commit(f"feat: add x (#1)\n\nbody\x1eHEAD\x1f--output={victim}\x1f1700000000\x1ffeat: y\x1fz", {"src/a.ts": "1\n"}, day=10)
        r.commit("fix(a): repair\x1e\x1f (#2)", {"src/a.ts": "2\n"}, day=11)
        r.commit("chore: tail", {"README.md": "t\n"}, day=100)
        res = analyze(r)
        self.assertEqual(victim.read_text(), "victim-content\n", "git diff dostal wstrzyknieta opcje --output")
        self.assertEqual((res["units"], res["escapes"]), (1, 1), "sfalszowany rekord nie moze dodac jednostki")

    def test_repo_cannot_run_code_via_signature_check(self):
        # log.showSignature + gpg.program z .git/config: `git log` weryfikowal podpis programem repo (pg-review p345b, odtworzone)
        r = Repo()
        r.init_commit({"README.md": "x\n", "src/a.ts": "a\n"})
        r.commit("feat: a (#1)", {"src/a.ts": "1\n"}, day=10)
        raw = r.git("cat-file", "commit", "HEAD")
        signed = re.sub(r"(?m)^(committer .*)$", r"\1\ngpgsig -----BEGIN PGP SIGNATURE-----\n x\n -----END PGP SIGNATURE-----", raw, count=1)
        p = subprocess.run(["git", "-C", str(r.path), "hash-object", "-t", "commit", "-w", "--stdin"], input=(signed + "\n").encode(),
                           capture_output=True, check=True)
        r.git("update-ref", "refs/heads/main", p.stdout.decode().strip())
        marker = TMP / "pwned-gpg"
        prog = TMP / "gpg.sh"
        prog.write_text(f"#!/bin/sh\ntouch {marker}\nexit 1\n")
        prog.chmod(0o755)
        for key in ("gpg.program", "gpg.openpgp.program", "gpg.ssh.program", "gpg.x509.program"):
            r.git("config", key, str(prog))
        r.git("config", "log.showSignature", "true")
        r.git("log", "-1", check=False)  # kontrola: bez ochrony program repo rusza (fixture naprawde podpisany)
        self.assertTrue(marker.exists(), "fixture: git log bez ochrony powinien odpalic gpg.program")
        marker.unlink()
        analyze(r)
        self.assertFalse(marker.exists())

    def _history(self, r):
        r.init_commit({"README.md": "x\n", "src/a.ts": "a\n"})
        r.commit("feat: a (#1)", {"src/a.ts": "1\n"}, day=10)
        r.commit("fix: a (#2)", {"src/a.ts": "2\n"}, day=11)
        r.commit("chore: tail", {"README.md": "t\n"}, day=100)

    def test_partial_clone_cannot_lazy_fetch_via_ssh_command(self):
        # partial clone: brakujacy blob -> git pobiera go z promisora, a core.sshCommand z .git/config to dowolny program
        # (pg-review p345d security-1, odtworzone). Repo-cien nie ma promisora: blad zamiast pobierania.
        src = Repo()
        self._history(src)
        src.git("config", "uploadpack.allowFilter", "true")
        evil = TMP / "evil-partial"
        subprocess.run(["git", "clone", "-q", "--no-local", "--no-checkout", "--filter=blob:none", f"file://{src.path}", str(evil)],
                       check=True, capture_output=True)
        marker = TMP / "pwned-lazy"
        prog = TMP / "ssh.sh"
        prog.write_text(f"#!/bin/sh\ntouch {marker}\nexit 1\n")
        prog.chmod(0o755)
        subprocess.run(["git", "-C", str(evil), "config", "remote.origin.url", "ssh://x/y"], check=True)
        subprocess.run(["git", "-C", str(evil), "config", "core.sshCommand", str(prog)], check=True)
        subprocess.run(["git", "-C", str(evil), "log", "-p", "-1", "main"], capture_output=True, check=False)
        self.assertTrue(marker.exists(), "fixture: git bez ochrony powinien odpalic core.sshCommand (lazy fetch)")
        marker.unlink()
        with self.assertRaises(pe.ToolError):
            pe.analyze_repo(evil)
        self.assertFalse(marker.exists(), "lazy fetch z repo floty uruchomil core.sshCommand")

    def test_worktree_packed_refs_and_shallow_clone(self):
        r = Repo()
        self._history(r)
        want = analyze(r)
        self.assertEqual((want["units"], want["escapes"]), (1, 1))
        wt = TMP / "wt-linked"
        r.git("worktree", "add", "-q", "--detach", str(wt))
        self.assertTrue((wt / ".git").is_file())
        self.assertEqual(pe.analyze_repo(wt)["escapes"], 1, "worktree: .git = plik gitdir + commondir")
        r.git("pack-refs", "--all")
        self.assertFalse((r.path / ".git" / "refs" / "heads" / "main").exists())
        self.assertEqual(analyze(r)["escapes"], 1, "packed-refs")
        deep = Repo()
        deep.init_commit({"README.md": "x\n", "src/a.ts": "a\n"})
        deep.commit("chore: pre", {"README.md": "p\n"}, day=5)  # granica plytkiego klonu: ponizej jednostki feat
        deep.commit("feat: a (#1)", {"src/a.ts": "1\n"}, day=10)
        deep.commit("fix: a (#2)", {"src/a.ts": "2\n"}, day=11)
        deep.commit("chore: tail", {"README.md": "t\n"}, day=100)
        sh = TMP / "shallow-clone"
        subprocess.run(["git", "clone", "-q", "--no-local", "--depth", "4", f"file://{deep.path}", str(sh)], check=True, capture_output=True)
        self.assertTrue((sh / ".git" / "shallow").is_file())
        self.assertEqual(pe.analyze_repo(sh)["escapes"], 1, "plytki klon: plik shallow przeniesiony do repo-cienia")

    def test_symref_cannot_escape_git_dir(self):
        r = Repo()
        self._history(r)
        outside = TMP / "outside-ref"
        outside.write_text(r.git("rev-parse", "HEAD") + "\n")
        common = r.path / ".git"
        (common / "refs" / "heads" / "evil").write_text(f"ref: refs/heads/../../../../{outside.name}\n")
        self.assertIsNone(pe.read_ref(common, "refs/heads/evil"))
        self.assertIsNone(pe.read_ref(common, "HEAD"))  # tylko refs/heads|remotes
        loop = common / "refs" / "heads" / "loop"
        loop.write_text("ref: refs/heads/loop\n")
        self.assertIsNone(pe.read_ref(common, "refs/heads/loop"))
        self.assertEqual(pe.read_ref(common, "refs/heads/main"), r.git("rev-parse", "main"))

    def test_missing_git_is_tool_error(self):
        r = Repo()
        self._history(r)
        # exit 2, nie traceback (pg-review p345g code)
        with mock.patch.object(pe.subprocess, "run", side_effect=FileNotFoundError("git")), self.assertRaises(pe.ToolError):
            analyze(r)

    def test_render_escapes_control_chars(self):
        repos = [{"repo": "a\x1b[2Jb", "skipped": "blad: \x1b]0;x\x07"}]
        sample = [{"repo": "r", "unit_sha": "0" * 40, "fix_sha": "1" * 40, "files": ["src/\x1b[31mx.ts"]}]
        text = pe.render_text(repos, {t: {"units": 0, "escapes": 0} for t in pe.TIERS}, sample, 14, 180)
        self.assertNotRegex(text, r"[\x00-\x09\x0b-\x1f\x7f]")
        self.assertIn("\\x1b[2J", text)


class TestCli(unittest.TestCase):
    def run_cli(self, *args, env=None):
        e = dict(os.environ)
        e.update(env or {})
        return subprocess.run([sys.executable, str(SCRIPT), *args], capture_output=True, text=True, env=e, check=False)

    def make_repo(self):
        r = Repo()
        r.init_commit({"README.md": "x\n", "src/a.ts": "a\n"})
        r.commit("feat: a (#1)", {"src/a.ts": "1\n"}, day=10)
        r.commit("fix(a): a (#2)", {"src/a.ts": "2\n"}, day=11)
        r.commit("chore: tail", {"README.md": "t\n"}, day=100)
        return r

    def test_json_shape_and_exit_zero(self):
        r = self.make_repo()
        p = self.run_cli(str(r.path), "--json")
        self.assertEqual(p.returncode, 0, p.stderr)
        d = json.loads(p.stdout)
        self.assertEqual(set(d), {"repos", "totals", "sample"})
        rep = d["repos"][0]
        self.assertEqual(set(rep) - {"skipped"}, {"repo", "branch", "units", "escapes", "unlinkable", "conventional_pct", "reliable", "by_tier"})
        self.assertEqual(set(rep["by_tier"]), {"T0", "T1", "T2", "T3"})
        self.assertEqual((rep["units"], rep["escapes"]), (1, 1))  # feat a (ucieczka); HEAD "chore: tail" cenzurowany
        self.assertEqual(set(d["sample"][0]), {"repo", "unit_sha", "fix_sha", "files"})

    def test_text_output_and_since_suffix(self):
        r = self.make_repo()
        p = self.run_cli(str(r.path), "--since", "90d", "--sample", "1")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn("Orientacyjny wskaznik ucieczek", p.stdout)
        self.assertIn("T1", p.stdout)
        self.assertIn("Probka", p.stdout)

    def test_tool_errors_exit_2(self):
        self.assertEqual(self.run_cli().returncode, 2)
        self.assertEqual(self.run_cli(str(TMP / "nie-ma-takiej")).returncode, 2)
        self.assertEqual(self.run_cli(str(self.make_repo().path), "--days", "0").returncode, 2)

    def test_skipped_repo_still_exit_0(self):
        r = Repo(branch="dev")
        r.init_commit()
        p = self.run_cli(str(r.path), "--json")
        self.assertEqual(p.returncode, 0)
        self.assertIn("skipped", json.loads(p.stdout)["repos"][0])

    def test_fleet_failure_is_tool_error_with_clear_message(self):
        fail = TMP / "fleet-fail.py"
        fail.write_text("import sys\nsys.stderr.write('brak tokenu\\n')\nsys.exit(1)\n")
        with mock.patch.object(pe, "FLEET_SCRIPT", fail), self.assertRaises(pe.ToolError) as cm:
            pe.fleet_paths()
        self.assertIn("infisical", str(cm.exception))
        self.assertIn("brak tokenu", str(cm.exception))

    def test_fleet_maps_to_src_and_skips_missing(self):
        home = TMP / "home"
        (home / "src" / "present").mkdir(parents=True)
        ok = TMP / "fleet-ok.py"
        ok.write_text("import json\nprint(json.dumps({'active': [{'name': 'present'}, {'name': 'absent'}, {'name': '../evil'}]}))\n")
        with mock.patch.object(pe, "FLEET_SCRIPT", ok), mock.patch.dict(os.environ, {"HOME": str(home)}):
            got = pe.fleet_paths()
        self.assertEqual([(p.name, s is None) for p, s in got], [("present", True), ("absent", False), ("evil", False)])
        self.assertTrue(all(home in p.parents for p, _ in got))

    def test_fleet_isolates_broken_repo(self):
        good = Repo()
        good.init_commit({"README.md": "x\n", "src/a.ts": "a\n"})
        good.commit("feat: a (#1)", {"src/a.ts": "1\n"}, day=10)
        good.commit("chore: tail", {"README.md": "t\n"}, day=100)
        broken = TMP / "broken-repo"
        broken.mkdir()
        real = pe.analyze_repo

        def analyze_or_fail(path, *a, **kw):  # np. plytki klon: git diff na brakujacym rodzicu -> ToolError
            if path == broken:
                raise pe.ToolError("git diff: bad object")
            return real(path, *a, **kw)

        with mock.patch.object(pe, "fleet_paths", lambda: [(good.path, None), (broken, None)]), \
                mock.patch.object(pe, "analyze_repo", analyze_or_fail):
            with mock.patch("builtins.print"):
                rc = pe.main(["--fleet", "--json", "--sample", "0"])
            self.assertEqual(rc, 0, "--fleet: zepsute repo = pominiete, reszta floty liczona")
            with mock.patch("builtins.print") as out:
                pe.main(["--fleet", "--json", "--sample", "0"])
            data = json.loads(out.call_args[0][0])
        by = {r["repo"]: r for r in data["repos"]}
        self.assertTrue(str(by["broken-repo"]["skipped"]).startswith("blad:"), by["broken-repo"])
        self.assertEqual(by[good.path.name]["units"], 1)
        with mock.patch.object(pe, "analyze_repo", analyze_or_fail), mock.patch("sys.stderr"):
            self.assertEqual(pe.main([str(broken)]), 2, "jawna sciezka: blad repo = blad narzedzia (exit 2)")


if __name__ == "__main__":
    unittest.main(verbosity=2)

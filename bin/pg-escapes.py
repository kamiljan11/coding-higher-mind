#!/usr/bin/env python3
"""pg-escapes: orientacyjny wskaznik ucieczek per tier ryzyka z historii git (M-C, Fala 0 pomiaru PG; 0 tokenow, zero zapisu, zero sieci).

Jednostka = commit first-parent na galezi domyslnej, ktory nie jest `fix:` (squash albo merge commit; przy `Merge pull request`
tytulem jest pierwsza linia tresci = tytul PR). Ucieczka = jednostka, do ktorej przypisano pozniejszy `fix(...)?!?:` <= --days dni,
dzielacy >= 1 plik (lockfile'e, package.json, CHANGELOG.md, *.md sie nie licza); fix trafia do NAJBLIZSZEJ wczesniejszej jednostki,
jeden fix = max jedna ucieczka. Jednostki mlodsze niz --days od HEAD sa cenzurowane (poza mianownikiem), jednostki bez pliku do
powiazania (same *.md / lockfile'e) tez (pole unlinkable). Tier liczy
hooks/lib/risk-tier.js na plikach commita (+ suma numstat jako --lines; binarne '-' = 0), wg OBECNEGO CLAUDE.md repo.
To NIE jest gorna granica i NIE mierzy "co przeszlo przez bramki" (brak warunku na recenzje) - to baza per tier do pozniejszego
porownania przed/po. Repo z < 50 % commitow w stylu Conventional = "niewiarygodne" (poza suma).
Bezpieczenstwo: git nie startuje w repo floty ani z jego configiem - refy czytane w Pythonie, git log/diff w tymczasowym repo-cieniu
(objects/info/alternates -> obiekty repo floty; bez promisora, wiec brakujacy obiekt = blad, nie pobieranie z sieci).
Refy w formacie reftable = repo pominiete.

Uzycie:
  python3 ~/.claude/bin/pg-escapes.py <repo-path>... [--fleet] [--days 14] [--since 180] [--json] [--sample 10]
  --fleet: lista z fleet-active-repos.py --json (wymaga tokenu; uruchom przez most:
  infisical run --env=dev -- python3 ~/.claude/bin/pg-escapes.py --fleet), mapowana na ~/src/<repo>.
Wyjscie: tabela per tier + probka do recznej kontroli (random.Random(0)); --json: {repos:[...], totals:{...}, sample:[...]}.
Exit 0 = OK (takze gdy repo pominiete z powodem), 2 = blad narzedzia (brak git/node/risk-tier, zla sciezka, blad --fleet).
"""
import argparse
import contextlib
import json
import os
import random
import re
import subprocess
import sys
import tempfile
from pathlib import Path

CLAUDE_DIR = Path(__file__).resolve().parent.parent
RISK_TIER = CLAUDE_DIR / "hooks" / "lib" / "risk-tier.js"
FLEET_SCRIPT = Path(__file__).resolve().parent / "fleet-active-repos.py"
TIERS = ("T0", "T1", "T2", "T3")
FIX_RX = re.compile(r"^fix(\([^)]*\))?!?:")
CONV_RX = re.compile(r"^(feat|fix|chore|docs|style|refactor|perf|test|build|ci|revert)(\([^)]*\))?!?:")
MERGE_PR_RX = re.compile(r"^Merge pull request")
IGNORED_NAMES = {"package.json", "CHANGELOG.md", "go.sum", "bun.lockb", "npm-shrinkwrap.json"}
IGNORED_RX = re.compile(r"(\.md|\.lock|-lock\.json|-lock\.yaml)$", re.IGNORECASE)
RELIABLE_MIN_PCT = 50.0
TIER_CHUNK = 200
SHA_RX = re.compile(r"[0-9a-f]{40}(?:[0-9a-f]{24})?")  # sha1 albo sha256

REF_RX = re.compile(r"refs/(heads|remotes)/[A-Za-z0-9._/-]{1,200}")
MAX_REF_HOPS = 5
MAX_META_BYTES = 1 << 20  # HEAD/packed-refs/shallow/gitdir: wiecej = nie czytamy (plik z repo floty)

# git NIGDY nie startuje w repo floty ani z jego configiem (pg-review p345d security-1: partial clone -> lazy fetch ->
# core.sshCommand z .git/config = RCE; wczesniej p345b gpg.program, fsmonitor). Lista zakazanych kluczy to wyscig bez konca,
# wiec: refy czytamy w Pythonie, a git pracuje w tymczasowym repo-cieniu z naszym configiem, ktore widzi obiekty repo floty
# przez objects/info/alternates. Ponizsze parametry to juz tylko druga warstwa.
# Dzieci (git, node) nie potrzebuja sekretow ze srodowiska sesji (recenzja p345): wycinamy *TOKEN*/*SECRET*/*KEY*/*PASSWORD*.
_SECRET_ENV_RX = re.compile(r"TOKEN|SECRET|KEY|PASSWORD|PASSWD|CREDENTIAL", re.IGNORECASE)
CHILD_ENV = {k: v for k, v in os.environ.items() if not _SECRET_ENV_RX.search(k) and not k.startswith("GIT_")}
CHILD_ENV.update({
    "CI": "1",
    "GIT_CONFIG_PARAMETERS": "'core.fsmonitor=false' 'core.untrackedCache=false' 'core.hooksPath=/dev/null' 'log.showSignature=false'"
                             " 'gpg.program=false' 'gpg.openpgp.program=false' 'gpg.ssh.program=false' 'gpg.x509.program=false'"
                             " 'protocol.allow=never'",
    "GIT_NO_LAZY_FETCH": "1",
    "GIT_NO_REPLACE_OBJECTS": "1",
    "NoDefaultCurrentDirectoryInExePath": "1",
    "GIT_TERMINAL_PROMPT": "0",
    "GIT_OPTIONAL_LOCKS": "0",
})


class ToolError(Exception):
    """Blad narzedzia (nie repo): exit 2."""


class RepoSkip(Exception):
    """Repo do pominiecia z powodem (nie blad narzedzia)."""


def git(gitdir, *args, check=True):
    """git na repo-cieniu (nasz katalog tymczasowy), nigdy na repo floty."""
    cmd = ["git", "--git-dir", str(gitdir), *args]
    try:
        p = subprocess.run(cmd, cwd=str(gitdir), capture_output=True, env=CHILD_ENV, timeout=120, check=False)
    except FileNotFoundError:
        raise ToolError("brak programu git w PATH")
    except subprocess.TimeoutExpired:
        raise ToolError(f"timeout: git {' '.join(args[:3])}")
    if check and p.returncode != 0:
        raise ToolError(f"git {' '.join(args[:3])}: {p.stderr.decode('utf-8', 'replace').strip()[:300]}")
    return p


def _read_small(path):
    """Tekst malego zwyklego pliku albo None (brak, katalog, FIFO, za duzy)."""
    try:
        if not path.is_file() or path.stat().st_size > MAX_META_BYTES:
            return None
        return path.read_bytes().decode("utf-8", "replace")
    except OSError:
        return None


def git_dirs(repo):
    """(gitdir, commondir) repo floty, czytane bez gita: `.git` katalog albo plik `gitdir: X` (worktree), plus `commondir`."""
    dot = repo / ".git"
    if dot.is_dir():
        gitdir = dot
    else:
        txt = _read_small(dot)
        if not txt or not txt.startswith("gitdir:"):
            raise RepoSkip("to nie jest repo git")
        gitdir = (repo / txt[len("gitdir:"):].strip()).resolve()
        if not gitdir.is_dir():
            raise RepoSkip(f"gitdir z .git nie istnieje: {gitdir}")
    common = gitdir
    cd = _read_small(gitdir / "commondir")
    if cd and cd.strip():
        common = (gitdir / cd.strip()).resolve()
    if (common / "reftable").exists():
        raise RepoSkip("refy w formacie reftable (nieobslugiwane)")
    if not (common / "objects").is_dir():
        raise RepoSkip("brak katalogu objects")
    return gitdir, common


def read_ref(common, name):
    """sha refu `name` z luznego pliku albo packed-refs (symref `ref: X` max MAX_REF_HOPS); None gdy brak.
    Nazwy tylko refs/heads|remotes bez `..`: tresc symrefu z repo floty nie wyprowadzi odczytu poza commondir."""
    for _ in range(MAX_REF_HOPS):
        if not REF_RX.fullmatch(name) or ".." in name.split("/") or "//" in name:
            return None
        txt = _read_small(common / name)
        if txt is None:
            packed = _read_small(common / "packed-refs") or ""
            for ln in packed.splitlines():
                parts = ln.split(" ", 1)
                if len(parts) == 2 and parts[1] == name and SHA_RX.fullmatch(parts[0]):
                    return parts[0]
            return None
        txt = txt.strip()
        if txt.startswith("ref:"):
            name = txt[4:].strip()
            continue
        return txt if SHA_RX.fullmatch(txt) else None
    return None


def default_branch(common):
    """(etykieta, sha) albo None: origin/HEAD, inaczej main, inaczej master (sha jeszcze niesprawdzony jako commit)."""
    cand = []
    txt = (_read_small(common / "refs" / "remotes" / "origin" / "HEAD") or "").strip()
    if txt.startswith("ref:"):
        target = txt[4:].strip()
        if REF_RX.fullmatch(target):
            cand.append((target.replace("refs/remotes/", "", 1), target))
    cand += [("main", "refs/heads/main"), ("master", "refs/heads/master")]
    for label, ref in cand:
        sha = read_ref(common, ref)
        if sha:
            return label, sha
    return None


@contextlib.contextmanager
def shadow_repo(common, sha):
    """Tymczasowe repo bare z naszym configiem; obiekty repo floty przez alternates, `shallow` skopiowany po walidacji.
    Bez konfiguracji promisora: brakujacy obiekt = blad, nie pobieranie z sieci."""
    with tempfile.TemporaryDirectory(prefix="pg-escapes-shadow-") as tmp:
        gd = Path(tmp) / "shadow.git"
        fmt = "sha256" if len(sha) == 64 else "sha1"
        try:
            p = subprocess.run(["git", "init", "--bare", "-q", f"--object-format={fmt}", str(gd)], cwd=tmp, capture_output=True,
                               env=CHILD_ENV, timeout=60, check=False)
        except FileNotFoundError:
            raise ToolError("brak programu git w PATH")
        except subprocess.TimeoutExpired:
            raise ToolError("timeout: git init repo-cienia")
        if p.returncode != 0:
            raise ToolError(f"git init repo-cienia: {p.stderr.decode('utf-8', 'replace').strip()[:200]}")
        objects = (common / "objects").resolve()
        if "\n" in str(objects):
            raise RepoSkip("sciezka objects z nowa linia")
        (gd / "objects" / "info" / "alternates").write_text(str(objects) + "\n")
        shallow = _read_small(common / "shallow")
        if shallow:
            lines = shallow.split()
            if not all(SHA_RX.fullmatch(x) for x in lines):
                raise RepoSkip("nieczytelny plik shallow")
            (gd / "shallow").write_text("\n".join(lines) + "\n")
        if git(gd, "cat-file", "-e", "--end-of-options", sha + "^{commit}", check=False).returncode != 0:
            raise RepoSkip(f"ref galezi domyslnej nie wskazuje commita ({sha[:12]})")
        yield gd


def is_ignored(path):
    name = path.rsplit("/", 1)[-1]
    return name in IGNORED_NAMES or bool(IGNORED_RX.search(name))


def parse_numstat(raw):
    """-z numstat (--no-renames) -> ([pliki], suma linii; binarne '-' = 0)."""
    files, lines = [], 0
    for rec in raw.decode("utf-8", "replace").split("\0"):
        if not rec:
            continue
        parts = rec.split("\t", 2)
        if len(parts) != 3:
            continue
        a, d, path = parts
        files.append(path)
        lines += (int(a) if a.isdigit() else 0) + (int(d) if d.isdigit() else 0)
    return files, lines


def read_commits(gd, ref, since_days):
    """First-parent od najnowszego: [{sha, parents, ts, title, files, lines}]. Commit bez rodzica (root) pomijamy.
    gd = repo-cien (shadow_repo). Metadane (sha, ts, rodzice) z formatu bez tresci autora i walidowane; temat/tresc osobnym
    wywolaniem per commit, a przed rewizjami `--end-of-options`: tresc commita z niezaufanego repo nie sfalszuje rekordu ani nie
    wstrzyknie opcji do `git diff` (pg-review p345c security-1: `\\x1e...--output=<plik>` w tresci nadpisywal dowolny plik)."""
    head = git(gd, "log", "--no-show-signature", "-1", "--format=%ct", "--end-of-options", ref).stdout.decode("ascii", "replace").strip()
    if not head.isdigit():
        raise ToolError(f"nieczytelny czas HEAD: {head[:40]!r}")
    head_ts = int(head)
    cutoff = head_ts - since_days * 86400
    meta = git(gd, "log", "--no-show-signature", "--first-parent", f"--max-age={cutoff}", "--format=%H %ct %P",
               "--end-of-options", ref).stdout.decode("ascii", "replace")
    commits = []
    for line in meta.splitlines():
        parts = line.split()
        if len(parts) < 3:
            continue  # root (bez rodzica)
        sha, ts, parents = parts[0], parts[1], parts[2:]
        if not (SHA_RX.fullmatch(sha) and ts.isdigit() and all(SHA_RX.fullmatch(x) for x in parents)):
            raise ToolError(f"nieoczekiwany wynik git log: {line[:80]!r}")
        msg = git(gd, "log", "--no-show-signature", "-1", "--format=%s%x00%b", "--end-of-options", sha).stdout.decode("utf-8", "replace")
        subject, _, body = msg.partition("\x00")
        title = subject.strip()
        if MERGE_PR_RX.match(title):
            lines = [ln.strip() for ln in body.splitlines() if ln.strip()]
            if lines:
                title = lines[0]
        raw = git(gd, "diff", "--no-textconv", "--no-ext-diff", "--numstat", "--no-renames", "-z", "--end-of-options", parents[0], sha).stdout
        files, nlines = parse_numstat(raw)
        commits.append({"sha": sha, "ts": int(ts), "title": title, "files": files, "lines": nlines})
    return head_ts, commits


_tier_cache = {}


def tier_of(repo, files, lines):
    """Tier z hooks/lib/risk-tier.js (max po paczkach po 200 plikow)."""
    if not files:
        return "T0"
    key = (str(repo), tuple(sorted(files)), lines)
    if key in _tier_cache:
        return _tier_cache[key]
    best = "T0"
    ordered = sorted(files)
    for i in range(0, len(ordered), TIER_CHUNK):
        chunk = ordered[i:i + TIER_CHUNK]
        try:
            p = subprocess.run(["node", str(RISK_TIER), str(repo), "--lines", str(lines), *chunk],
                               capture_output=True, env=CHILD_ENV, timeout=60, check=False)
        except FileNotFoundError:
            raise ToolError("brak programu node w PATH (potrzebny dla hooks/lib/risk-tier.js)")
        except subprocess.TimeoutExpired:
            raise ToolError("timeout risk-tier.js")
        if p.returncode != 0:
            raise ToolError(f"risk-tier.js exit {p.returncode}: {p.stderr.decode('utf-8', 'replace').strip()[:300]}")
        try:
            t = json.loads(p.stdout.decode())["tier"]
        except (ValueError, KeyError):
            raise ToolError("risk-tier.js: nieczytelny wynik")
        if t not in TIERS:
            raise ToolError(f"risk-tier.js: nieznany tier {t!r}")
        if TIERS.index(t) > TIERS.index(best):
            best = t
    _tier_cache[key] = best
    return best


def analyze_repo(repo, days=14, since_days=180):
    """Wynik per repo (slownik jak w --json). Repo bez git/galezi domyslnej => {'repo', 'skipped': powod}."""
    repo = Path(repo)
    name = repo.resolve().name
    try:
        _, common = git_dirs(repo)
        br = default_branch(common)
        if br is None:
            return {"repo": name, "skipped": "brak galezi domyslnej (origin/HEAD, main, master)"}
        label, sha = br
        with shadow_repo(common, sha) as gd:
            head_ts, commits = read_commits(gd, sha, since_days)
    except RepoSkip as e:
        return {"repo": name, "skipped": str(e)}
    window = days * 86400
    conv = sum(1 for c in commits if CONV_RX.match(c["title"]))
    conv_pct = round(100.0 * conv / len(commits), 1) if commits else 0.0

    # commits: od najnowszego. Fix -> najblizsza wczesniejsza (dalej w liscie) jednostka <= window, wspolny plik.
    units = [c for c in commits if not FIX_RX.match(c["title"])]
    fixes = [c for c in commits if FIX_RX.match(c["title"])]
    unit_ids = {c["sha"] for c in units}
    for c in units:
        c["match"] = {f for f in c["files"] if not is_ignored(f)}
    pos = {c["sha"]: i for i, c in enumerate(commits)}
    escaped = {}  # sha jednostki -> najstarszy przypisany fix
    pairs = []
    for fx in sorted(fixes, key=lambda c: c["ts"]):
        fx_files = {f for f in fx["files"] if not is_ignored(f)}
        if not fx_files:
            continue
        # commits sa od najnowszego: wczesniejsze od fixa = wieksze indeksy; pierwsza pasujaca jednostka = najblizsza
        for u in commits[pos[fx["sha"]] + 1:]:
            if u["sha"] not in unit_ids:
                continue
            if not 0 <= fx["ts"] - u["ts"] <= window:
                continue  # ts nie musi byc monotoniczny w kolejnosci git log (rebase, cherry-pick): bez break
            shared = sorted(fx_files & u["match"])
            if shared:
                escaped.setdefault(u["sha"], fx["sha"])
                pairs.append({"repo": name, "unit_sha": u["sha"], "fix_sha": fx["sha"], "files": shared[:10]})
                break

    by_tier = {t: {"units": 0, "escapes": 0} for t in TIERS}
    n_units = n_esc = n_unlinkable = 0
    for u in units:
        if head_ts - u["ts"] < window:
            continue  # cenzura: za mlody, ucieczka mogla jeszcze nie wystapic
        if not u["match"]:
            n_unlinkable += 1  # same *.md/lockfile'e: z definicji nie moze uciec -> poza mianownikiem (recenzja p345b code-1)
            continue
        t = tier_of(repo, u["files"], u["lines"])
        by_tier[t]["units"] += 1
        n_units += 1
        if u["sha"] in escaped:
            by_tier[t]["escapes"] += 1
            n_esc += 1
    live = {u["sha"] for u in units if head_ts - u["ts"] >= window}
    sample_pairs = [p for p in pairs if p["unit_sha"] in live]
    return {
        "repo": name, "branch": label, "units": n_units, "escapes": n_esc, "unlinkable": n_unlinkable, "conventional_pct": conv_pct,
        "reliable": conv_pct >= RELIABLE_MIN_PCT, "by_tier": by_tier, "_pairs": sample_pairs,
    }


_CTRL_RX = re.compile(r"[\x00-\x1f\x7f-\x9f]")


def safe(s):
    """Nazwy plikow/galezi/bledy z repo floty bez znakow sterujacych (sekwencje ANSI w terminalu; pg-review p345d security-2)."""
    return _CTRL_RX.sub(lambda m: f"\\x{ord(m.group()):02x}", str(s))


def pct(a, b):
    return f"{100.0 * a / b:.0f}%" if b else "-"


def build_report(results, sample_n):
    totals = {t: {"units": 0, "escapes": 0} for t in TIERS}
    pool = []
    for r in results:
        if r.get("skipped") or not r["reliable"]:
            continue
        for t in TIERS:
            totals[t]["units"] += r["by_tier"][t]["units"]
            totals[t]["escapes"] += r["by_tier"][t]["escapes"]
        pool += r["_pairs"]
    pool.sort(key=lambda p: (p["repo"], p["unit_sha"], p["fix_sha"]))
    sample = random.Random(0).sample(pool, min(sample_n, len(pool))) if sample_n > 0 else []
    repos = [{k: v for k, v in r.items() if k != "_pairs"} for r in results]
    return repos, totals, sample


def render_text(repos, totals, sample, days, since_days):
    L = [
        "Orientacyjny wskaznik ucieczek (NIE gorna granica; baza per tier, bez warunku na recenzje)",
        (f"Okno {since_days} dni; ucieczka = fix(...) <= {days} dni po jednostce, wspolny plik; "
         f"jednostki mlodsze niz {days} dni od HEAD i bez pliku do powiazania (same *.md/lockfile) pominiete; "
         "tier wg OBECNEGO CLAUDE.md repo."),
        "",
        f"{'repo':<28}{'galaz':<14}{'jedn.':>6}{'ucieczki':>9}{'%':>6}{'conv%':>7}  uwagi",
    ]
    for r in repos:
        if r.get("skipped"):
            L.append(f"{safe(r['repo']):<28}{'-':<14}{'-':>6}{'-':>9}{'-':>6}{'-':>7}  POMINIETE: {safe(r['skipped'])}")
            continue
        note = "" if r["reliable"] else "NIEWIARYGODNE (< 50% commitow Conventional) - poza suma"
        L.append(f"{safe(r['repo']):<28}{safe(r['branch']):<14}{r['units']:>6}{r['escapes']:>9}{pct(r['escapes'], r['units']):>6}"
                 f"{r['conventional_pct']:>6.0f}%  {note}")
    L += ["", "Per tier (tylko repo wiarygodne)", f"{'tier':<6}{'jednostki':>10}{'ucieczki':>10}{'%':>6}"]
    tu = te = 0
    for t in TIERS:
        u, e = totals[t]["units"], totals[t]["escapes"]
        tu, te = tu + u, te + e
        L.append(f"{t:<6}{u:>10}{e:>10}{pct(e, u):>6}")
    L.append(f"{'razem':<6}{tu:>10}{te:>10}{pct(te, tu):>6}")
    if sample:
        L += ["", f"Probka do recznej kontroli ({len(sample)}, seed 0): repo unit_sha fix_sha pliki"]
        for s in sample:
            L.append(f"  {safe(s['repo'])} {s['unit_sha'][:10]} {s['fix_sha'][:10]} {safe(', '.join(s['files'][:5]))}")
    return "\n".join(L)


def fleet_paths():
    """Repo floty z fleet-active-repos.py --json -> (sciezka, powod_pominiecia). Bez tokenu => ToolError."""
    try:
        p = subprocess.run([sys.executable, str(FLEET_SCRIPT), "--json"], capture_output=True, env=os.environ.copy(), timeout=300, check=False)
    except subprocess.TimeoutExpired:
        raise ToolError("--fleet: timeout fleet-active-repos.py")
    if p.returncode != 0:
        err = p.stderr.decode("utf-8", "replace").strip()[:200]
        raise ToolError(f"--fleet: fleet-active-repos.py nie zadzialal (exit {p.returncode}: {err}). Uruchom przez most: "
                        f"infisical run --env=dev -- python3 {Path(__file__).resolve()} --fleet")
    try:
        names = [a["name"] for a in json.loads(p.stdout.decode())["active"]]
    except (ValueError, KeyError, TypeError):
        raise ToolError("--fleet: nieczytelny JSON z fleet-active-repos.py")
    out = []
    for n in names:
        base = Path(str(n)).name
        d = Path.home() / "src" / base
        out.append((d, None) if base and d.is_dir() else (d, f"brak katalogu {d}"))
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description="Orientacyjny wskaznik ucieczek per tier z historii git.")
    ap.add_argument("repos", nargs="*", help="sciezki do repo git")
    ap.add_argument("--fleet", action="store_true", help="repo aktywne wg fleet-active-repos.py --json -> ~/src/<repo>")
    ap.add_argument("--days", type=int, default=14, help="okno ucieczki i cenzury w dniach (domyslnie 14)")
    ap.add_argument("--since", default="180", help="ile dni historii (domyslnie 180; dozwolone '90d')")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--sample", type=int, default=10)
    args = ap.parse_args(argv)
    try:
        since_days = int(str(args.since).rstrip("d"))
    except ValueError:
        print(f"pg-escapes: zle --since: {args.since}", file=sys.stderr)
        return 2
    if args.days < 1 or since_days < 1:
        print("pg-escapes: --days i --since musza byc >= 1", file=sys.stderr)
        return 2
    try:
        targets = []
        for r in args.repos:
            p = Path(r).expanduser()
            if not p.is_dir():
                raise ToolError(f"sciezka nie istnieje: {r}")
            targets.append((p, None))
        if args.fleet:
            targets += fleet_paths()
        if not targets:
            raise ToolError("podaj sciezki repo albo --fleet")
        if not RISK_TIER.is_file():
            raise ToolError(f"brak {RISK_TIER}")
        results = []
        for path, skip in targets:
            if skip:
                results.append({"repo": path.name, "skipped": skip})
                continue
            try:
                results.append(analyze_repo(path, args.days, since_days))
            except (ToolError, ValueError, UnicodeError) as e:
                if not args.fleet:
                    raise ToolError(str(e)) from e
                # --fleet: jedno zepsute repo (plytki klon, timeout git) nie kasuje wyniku reszty floty (recenzja p345b)
                results.append({"repo": path.name, "skipped": f"blad: {str(e)[:120]}"})
        repos, totals, sample = build_report(results, args.sample)
    except ToolError as e:
        print(f"pg-escapes: {safe(e)}", file=sys.stderr)
        return 2
    if args.json:
        # ensure_ascii: znaki C1 (U+0080-009F, np. CSI) z nazw plikow repo floty jako \u009b, jak safe() w trybie tekstowym
        print(json.dumps({"repos": repos, "totals": totals, "sample": sample}, indent=2, ensure_ascii=True))
    else:
        print(render_text(repos, totals, sample, args.days, since_days))
    return 0


if __name__ == "__main__":
    sys.exit(main())

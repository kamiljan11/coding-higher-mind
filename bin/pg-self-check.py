#!/usr/bin/env python3
"""pg-self-check: jedna komenda przed commitem zmiany W SAMYM PG — skladnia, testy konsumentow, mapy, streszczenia, wlasciciele.

Retro 2026-10-19 (uzytkownik: „zbuduj system pracy z samym PG, zeby nie produkowac krzakow"). Bledy z sesji 2026-10-18/19,
ktore ten skrypt lapie mechanicznie zamiast pamieci agenta (katalog: skills/pg-maintain/SKILL.md):
  - zmiana pliku bez testow, ktore go dotycza (test_* odwolujacy sie do nazwy pliku),
  - mapa/indeks nieaktualne (pg-map --check), liczba w CLAUDE.md/ref-*.md rozjechana ze zrodlem (claims-check),
  - zmiana nazwy/stalej, a stare odwolanie zostaje w innym pliku (jobs -> background_jobs w 6 plikach),
  - poprawka w konsumencie zamiast we wlascicielu (service_role w pg-merge zamiast risk-tier) — lista konsumentow do oceny,
  - pieczec nieaktualna po zmianie warstwy kontrolnej.
Uzycie: python3 ~/.claude/bin/pg-self-check.py [--root DIR]   (inny --root = test; mapy i pieczec tylko dla ~/.claude)
Exit: 0 = zielone (ostrzezenia dopuszczalne), 1 = czerwone (skladnia, testy, mapy, streszczenia), 2 = blad narzedzia.
"""
from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
import tempfile

TIMEOUT = 600
ALWAYS = {"hooks": ["bin/test_hooks_v3.js"], "git-hooks": ["bin/test_hooks_v3.js"]}
TOKEN_RX = re.compile(r"`([A-Za-z_][\w./-]{5,})`|'([A-Za-z_][\w./-]{5,})'|\b([A-Z][A-Z0-9_]{5,})\b")


HERE = os.path.dirname(os.path.abspath(__file__))


class ToolError(Exception):
    """Brak programu (ruff/node/git) albo timeout = blad narzedzia (exit 2), nie werdykt (ADR-0008)."""


def sh(cmd: list[str], root: str) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(cmd, cwd=root, capture_output=True, text=True, timeout=TIMEOUT, check=False)
    except (OSError, subprocess.TimeoutExpired) as e:
        raise ToolError(f"{cmd[0]}: {e}") from e


def changed_files(root: str) -> list[str]:
    # rc != 0 (brak repo / HEAD) = blad narzedzia; inaczej 0 plikow dawalo ZIELONE (r7 code).
    runs = [sh(["git", "diff", "--name-only", "HEAD"], root), sh(["git", "ls-files", "--others", "--exclude-standard"], root)]
    for r in runs:
        if r.returncode != 0:
            raise ToolError(f"git rc={r.returncode}: {r.stderr.strip()[:200]}")
    tracked, untracked = runs[0].stdout.split(), runs[1].stdout.split()
    return sorted({f for f in tracked + untracked if os.path.isfile(os.path.join(root, f))})


def deleted_files(root: str) -> list[str]:
    r = sh(["git", "diff", "--name-only", "--diff-filter=D", "HEAD"], root)
    if r.returncode != 0:
        raise ToolError(f"git rc={r.returncode}: {r.stderr.strip()[:200]}")
    return r.stdout.split()


def syntax_cmd(f: str) -> list[str] | None:
    # `--` przed sciezka z gita: plik `--require=x.js` nie staje sie opcja node/ruff/bash (r10 security).
    if f.endswith(".py"):
        return ["ruff", "check", "--quiet", "--", f]
    if f.endswith((".js", ".cjs", ".mjs")):
        return ["node", "--check", "--", f]
    if f.endswith(".json"):
        return [sys.executable, "-m", "json.tool", "--", f]
    if f.startswith("git-hooks/") or f.endswith(".sh"):
        return ["bash", "-n", "--", f]
    return None


def tests_for(files: list[str], root: str) -> list[str]:
    bindir = os.path.join(root, "bin")
    if not os.path.isdir(bindir):
        raise ToolError(f"brak katalogu {bindir} (--root nie jest PG)")
    tests = sorted(f for f in os.listdir(bindir) if f.startswith("test_") and f.endswith((".js", ".py")))
    picked: set[str] = set()
    for f in files:
        top = f.split("/")[0]
        picked.update(ALWAYS.get(top, []))
        if f.startswith("bin/test_"):
            picked.add(f)
            continue
        stem = os.path.splitext(os.path.basename(f))[0]
        if not f.endswith((".js", ".mjs", ".cjs", ".py", ".sh")) and not f.startswith("git-hooks/"):
            continue
        for t in tests:
            with open(os.path.join(root, "bin", t), encoding="utf-8", errors="replace") as fh:
                if stem in fh.read():
                    picked.add("bin/" + t)
    return sorted(picked)


def removed_tokens(f: str, root: str) -> set[str]:
    """Nazwy w `...`/'...'/STALA z usunietych linii, ktorych nie ma juz w pliku po zmianie."""
    diff = sh(["git", "diff", "-U0", "HEAD", "--", f], root).stdout
    gone: set[str] = set()
    for line in diff.splitlines():
        if line.startswith("-") and not line.startswith("---"):
            gone.update(next(g for g in m.groups() if g) for m in TOKEN_RX.finditer(line))
    with open(os.path.join(root, f), encoding="utf-8", errors="replace") as fh:
        now = fh.read()
    # Sciezka do ISTNIEJACEGO pliku nie jest starym odwolaniem — to tylko usunieta wzmianka (szum przy edycji ADR, r10 fix).
    return {t for t in gone if t not in now and not os.path.exists(os.path.join(root, t))}


def stale_refs(files: list[str], root: str) -> list[str]:
    out = []
    for f in files:
        for tok in sorted(removed_tokens(f, root)):
            hits = [h for h in sh(["git", "grep", "-l", "-F", tok], root).stdout.split() if h not in files]
            if hits:
                out.append(f"{tok} (usuniete z {f}) wciaz w: {', '.join(hits[:5])}")
    return out


def consumers(files: list[str], root: str) -> list[str]:
    out = []
    for f in files:
        if not (f.startswith(("hooks/lib/", "bin/")) and f.endswith((".js", ".py"))) or "/test_" in f:
            continue
        base = os.path.basename(f)
        users = [u for u in sh(["git", "grep", "-l", "-F", base, "--", "bin", "hooks", "git-hooks"], root).stdout.split()
                 if u != f and "/test_" not in u and not u.endswith("README.md")]
        if users:
            out.append(f"{f} <- {', '.join(users[:6])}")
    return out


def export_check_cmd() -> list[str]:
    """Skan publicznego eksportu (denylista: /home/<user>/, nazwisko, ID) bez zapisu plikow.

    Dwa incydenty (a2e0118, bfb2e7e: /home/<litera>/ w przykladzie) wylapal dopiero test_pg_export w guard_health, po commicie.
    pg-export-public czyta stale ~/.claude (ROOT), jak pg-map — stad tylko dla wlasnego --root.
    --out = katalog, ktory nie istnieje: narzedzie odmawia niepustego --out, a --check-only nic w nim nie tworzy.
    """
    out = os.path.join(tempfile.gettempdir(), f"pg-selfcheck-export-{os.getpid()}")
    return [sys.executable, os.path.join(HERE, "pg-export-public.py"), "--out", out, "--check-only"]


def checks_for(root: str, own: bool) -> list[tuple[str, list[str]]]:
    claims = [sys.executable, os.path.join(HERE, "claims-check.py"), "--root", root] + ([] if own else ["--min-anchors", "0"])
    if not own:
        return [("claims-check", claims)]
    return [("pg-map --check", [sys.executable, os.path.join(HERE, "pg-map.py"), "--check"]), ("claims-check", claims),
            ("pg-export-public --check-only", export_check_cmd())]


def run_checks(root: str) -> tuple[list[str], list[str]]:
    red: list[str] = []
    warn: list[str] = []
    files = changed_files(root)
    print(f"pg-self-check: {len(files)} zmienionych plikow")
    for f in files:
        cmd = syntax_cmd(f)
        if cmd and (r := sh(cmd, root)).returncode != 0:
            red.append(f"skladnia {f}: {(r.stdout + r.stderr).strip()[:300]}")
    for t in tests_for(files, root):
        r = sh([sys.executable if t.endswith(".py") else "node", t], root)
        print(f"  test {t}: {'OK' if r.returncode == 0 else 'FAIL'}")
        if r.returncode != 0:
            red.append(f"test {t}: " + "; ".join(ln for ln in (r.stdout + r.stderr).splitlines() if ln.lstrip().startswith("FAIL"))[:400])
    # Mapy i pieczec opisuja ~/.claude (stale sciezki w pg-map/pg-seal) — dla innego --root pomijane jawnie.
    own = os.path.realpath(root) == os.path.realpath(os.path.dirname(HERE))
    checks = checks_for(root, own)
    if not own:
        warn.append("--root poza ~/.claude: pg-map --check, skan eksportu i pieczec pominiete")
    for name, cmd in checks:
        r = sh(cmd, root)
        print(f"  {name}: {r.stdout.strip().splitlines()[-1] if r.stdout.strip() else r.stderr.strip()[:200]}")
        if r.returncode == 2:
            raise ToolError(f"{name}: {r.stderr.strip()[:200]}")
        if r.returncode != 0:
            red.append(f"{name}: rc={r.returncode} (pg-map bez --check regeneruje; claims-check: popraw liczbe albo kotwice;"
                       " eksport: prywatna sciezka/nazwa w pliku z allowlisty -> zamien na ~/ albo dodaj substytucje)")
    warn += [f"stare odwolanie? {s_}" for s_ in stale_refs(files, root)]
    # Usuniety/przemianowany PLIK: changed_files go nie widzi (isfile), wiec szukamy jego nazwy osobno (r10 code).
    for d in deleted_files(root):
        hits = [h for h in sh(["git", "grep", "-l", "-F", "--", os.path.basename(d)], root).stdout.split() if h not in files and h != d]
        if hits:
            warn.append(f"stare odwolanie? {os.path.basename(d)} (plik usuniety: {d}) wciaz w: {', '.join(hits[:5])}")
    warn += [f"konsumenci zmienionego pliku (popraw we wlascicielu, sprawdz ich): {c}" for c in consumers(files, root)]
    if own and sh(["node", os.path.join(HERE, "pg-seal.js"), "--check"], root).returncode != 0:
        warn.append("pieczec nieaktualna -> po review: ALLOW_CONTROL_PLANE=1 node bin/pg-seal.js")
    return red, warn


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--root", default=os.path.dirname(HERE))
    root = ap.parse_args().root
    try:
        red, warn = run_checks(root)
    except ToolError as e:
        print(f"pg-self-check: blad narzedzia (nie werdykt): {e}", file=sys.stderr)
        return 2
    for w in warn:
        print(f"  UWAGA {w}")
    for r_ in red:
        print(f"  RED {r_}")
    print(f"pg-self-check: {'CZERWONE' if red else 'ZIELONE'} | red={len(red)} uwag={len(warn)}")
    return 1 if red else 0


if __name__ == "__main__":
    sys.exit(main())

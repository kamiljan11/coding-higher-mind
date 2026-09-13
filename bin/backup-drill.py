#!/usr/bin/env python3
"""backup-drill: „backup, ktorego nigdy nie odtworzono probnie, nie jest backupem" (slownik SH sekcja 4; PG gap L3, PRR P16).

Dump z bazy zrodlowej -> restore do bazy DOCELOWEJ (lokalnej, nigdy prod) -> porownanie liczby wierszy
w wybranych tabelach -> raport JSON + linia do logu (append). Exit 0 tylko gdy wszystkie tabele sie zgadzaja.

Uzycie (URL zrodla ZAWSZE z env przez menedzer sekretow (np. Infisical CLI), nigdy jako argument):
  infisical run --env=dev -- \
    python ~/.claude/bin/backup-drill.py --source-env PROD_DATABASE_URL \
      --target-url postgres://postgres:postgres@localhost:5432/drill --tables customers,orders,invoices \
      --log "~/.claude/memory/log/backup-drill.md"
  python ~/.claude/bin/backup-drill.py --self-test        # testy funkcji czystych (bez Postgresa)

Narzedzia: pg_dump / pg_restore / psql z PATH; gdy ich brak, a jest `docker` -> te same komendy w kontenerze
`postgres:16-alpine` (2026-09-13: host bez klienta Postgresa nie moze byc powodem braku drillu; Docker Desktop jest).
W trybie docker `localhost` celu = `host.docker.internal` (kontener ma wlasny localhost). Brak obu = glosny blad, nie cichy skip.
Zrzut kasowany po drillu (--keep-dump zostawia). Cel z hostem zrodla albo `supabase.co` = odmowa (drill NIGDY nie nadpisuje produkcji).
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import shutil
import subprocess
import sys
import tempfile
from dataclasses import asdict, dataclass
from urllib.parse import parse_qs, unquote, urlparse

REQUIRED_TOOLS = ("pg_dump", "pg_restore", "psql")
DOCKER_IMAGE = "postgres:16-alpine"
DOCKER_WORKDIR = "/work"
PG_ENV_KEYS = ("PGHOST", "PGPORT", "PGUSER", "PGPASSWORD", "PGDATABASE", "PGSSLMODE")
# ALLOW-lista celu (security-reviewer 2026-09-12: deny-lista hostow przepuszczala db.firma.pl / IP / port-forward na prod).
LOCAL_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})
TABLE_NAME_MAX = 63
DEFAULT_PG_PORT = 5432


@dataclass(frozen=True)
class TableResult:
    table: str
    source_rows: int | None
    target_rows: int | None

    @property
    def ok(self) -> bool:
        return self.source_rows is not None and self.source_rows == self.target_rows


@dataclass(frozen=True)
class Tools:
    """Jak uruchamiac narzedzia Postgresa: natywnie (sciezki z PATH) albo przez docker (prefix komendy + katalog roboczy)."""

    mode: str  # "native" | "docker"
    paths: dict[str, str]
    work_dir: str  # katalog hosta ze zrzutem; w dockerze montowany jako /work

    def cmd(self, tool: str, args: list[str], env: dict[str, str]) -> list[str]:
        return docker_cmd(tool, args, self.work_dir) if self.mode == "docker" else [self.paths[tool], *args]

    def dump_path_for_tool(self, host_path: str) -> str:
        return f"{DOCKER_WORKDIR}/{os.path.basename(host_path)}" if self.mode == "docker" else host_path


def docker_cmd(tool: str, args: list[str], work_dir: str) -> list[str]:
    """`docker run` z narzedziem Postgresa: env PG* przekazywane z procesu (bez wartosci w argv), katalog zrzutu jako /work."""
    envs = [x for key in PG_ENV_KEYS for x in ("-e", key)]
    return ["docker", "run", "--rm", "-i", *envs, "-v", f"{work_dir}:{DOCKER_WORKDIR}", DOCKER_IMAGE, tool, *args]


def docker_env(env: dict[str, str]) -> dict[str, str]:
    """W kontenerze `localhost` to kontener: lokalny cel drillu -> host.docker.internal (Docker Desktop / Linux z --add-host)."""
    out = dict(env)
    if out.get("PGHOST", "").lower() in LOCAL_HOSTS:
        out["PGHOST"] = "host.docker.internal"
    return out


def parse_tables(raw: str) -> list[str]:
    """`customers, orders,invoices` -> ['customers','orders','invoices']; odrzuca nazwy z niebezpiecznymi znakami."""
    tables: list[str] = []
    for part in raw.split(","):
        name = part.strip()
        if not name:
            continue
        if not all(ch.isalnum() or ch in "_." for ch in name) or len(name) > TABLE_NAME_MAX:
            raise ValueError(f"niepoprawna nazwa tabeli: {name!r} (dozwolone: litery, cyfry, _ i . dla schematu)")
        tables.append(name)
    if not tables:
        raise ValueError("--tables: podaj co najmniej jedna tabele (3 najwazniejsze dla biznesu)")
    return tables


def is_forbidden_target(source_url: str, target_url: str, allow_remote: bool = False) -> str | None:
    """Powod odmowy albo None. Drill restore'uje do LOKALNEJ bazy (allow-lista hostow); zdalny cel tylko jawnie."""
    src, dst = urlparse(source_url), urlparse(target_url)
    if not dst.hostname:
        return "brak hosta w --target-url"
    if src.hostname and dst.hostname.lower() == src.hostname.lower():
        return f"cel ma ten sam host co zrodlo ({dst.hostname}) — restore nadpisalby produkcje"
    if dst.hostname.lower() not in LOCAL_HOSTS and not allow_remote:
        return f"cel {dst.hostname} nie jest lokalny — drill tylko do localhost/127.0.0.1 (zdalny cel: --allow-remote-target, zostaje w logu)"
    return None


def libpq_env(url: str) -> dict[str, str]:
    """URL polaczenia -> zmienne libpq (PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE/PGSSLMODE).
    Haslo NIGDY w argv procesu (widoczne w ps / Win32_Process / historii powloki) — security-reviewer 2026-09-12."""
    u = urlparse(url)
    env = {
        "PGHOST": u.hostname or "",
        "PGPORT": str(u.port or DEFAULT_PG_PORT),
        "PGUSER": unquote(u.username or ""),
        "PGPASSWORD": unquote(u.password or ""),
        "PGDATABASE": u.path.lstrip("/") or "postgres",
    }
    sslmode = parse_qs(u.query).get("sslmode")
    if sslmode:
        env["PGSSLMODE"] = sslmode[0]
    return env


def compare_counts(source: dict[str, int | None], target: dict[str, int | None]) -> list[TableResult]:
    return [TableResult(table=t, source_rows=source.get(t), target_rows=target.get(t)) for t in source]


def format_log_line(when: dt.datetime, label: str, results: list[TableResult], dump_bytes: int) -> str:
    status = "OK" if results and all(r.ok for r in results) else "FAILED"
    detail = ", ".join(f"{r.table}={r.source_rows}/{r.target_rows}" for r in results)
    return f"- {when.date().isoformat()} {label}: restore {status} — dump {dump_bytes // 1024} KB; wiersze zrodlo/cel: {detail}"


def resolve_tools(work_dir: str, force_docker: bool = False) -> Tools:
    """Natywne narzedzia z PATH; brak -> docker (jesli jest); brak obu -> glosny blad z instrukcja."""
    paths = {t: shutil.which(t) or "" for t in REQUIRED_TOOLS}
    if all(paths.values()) and not force_docker:
        return Tools(mode="native", paths=paths, work_dir=work_dir)
    if shutil.which("docker"):
        missing = [t for t, p in paths.items() if not p]
        sys.stderr.write(f"backup-drill: {'wymuszony docker' if force_docker else 'brak na PATH: ' + ', '.join(missing)} -> narzedzia z obrazu {DOCKER_IMAGE}\n")
        return Tools(mode="docker", paths={}, work_dir=work_dir)
    raise SystemExit("backup-drill: brak pg_dump/pg_restore/psql na PATH i brak dockera — zainstaluj PostgreSQL client tools "
                     "(winget install PostgreSQL.PostgreSQL) albo Docker Desktop. Bez tego drill nie istnieje.")


def run_tool(tools: Tools, tool: str, args: list[str], env: dict[str, str], timeout: int) -> subprocess.CompletedProcess[str]:
    full_env = {**os.environ, **(docker_env(env) if tools.mode == "docker" else env)}
    return subprocess.run(tools.cmd(tool, args, env), capture_output=True, text=True, timeout=timeout, check=False, env=full_env)


def count_rows(tools: Tools, url: str, tables: list[str]) -> dict[str, int | None]:
    counts: dict[str, int | None] = {}
    env = libpq_env(url)
    for table in tables:
        run = run_tool(tools, "psql", ["-Atc", f"select count(*) from {table}"], env, timeout=120)
        if run.returncode != 0:
            sys.stderr.write(f"backup-drill: count({table}) nieudany: {run.stderr.strip()[:200]}\n")
            counts[table] = None
        else:
            counts[table] = int(run.stdout.strip() or "0")
    return counts


def run_drill(args: argparse.Namespace) -> int:
    source_url = os.environ.get(args.source_env, "")
    if not source_url:
        raise SystemExit(f"backup-drill: zmienna {args.source_env} pusta — uruchom przez menedzer sekretow (np. Infisical CLI) (`infisical (CLI) run --secrets {args.source_env} -- ...`).")
    forbidden = is_forbidden_target(source_url, args.target_url, allow_remote=args.allow_remote_target)
    if forbidden:
        raise SystemExit(f"backup-drill: ODMOWA — {forbidden}.")
    if args.allow_remote_target:
        sys.stderr.write(f"backup-drill: UWAGA — zdalny cel restore ({urlparse(args.target_url).hostname}) za jawna zgoda; --clean nadpisze obiekty w tej bazie.\n")
    tables = parse_tables(args.tables)
    work_dir = tempfile.mkdtemp(prefix="backup-drill-")
    tools = resolve_tools(work_dir, force_docker=args.docker)
    source_env = libpq_env(source_url)
    target_env = libpq_env(args.target_url)
    started = dt.datetime.now(dt.UTC)
    dump_path = os.path.join(work_dir, "dump.pgc")
    tool_dump_path = tools.dump_path_for_tool(dump_path)
    try:
        # Polaczenie przez env libpq (PG*), nie argv — zadnych hasel w linii komend (takze w `docker run -e KEY` bez wartosci).
        dump = run_tool(tools, "pg_dump", ["--format=custom", "--no-owner", "--no-privileges", f"--file={tool_dump_path}"], source_env, args.timeout)
        if dump.returncode != 0:
            raise SystemExit(f"backup-drill: pg_dump nieudany (rc={dump.returncode}): {dump.stderr.strip()[:400]}")
        dump_bytes = os.path.getsize(dump_path) if os.path.exists(dump_path) else 0
        if dump_bytes == 0:
            raise SystemExit("backup-drill: pg_dump wyprodukowal PUSTY plik — to nie jest backup.")
        restore = run_tool(tools, "pg_restore", ["--clean", "--if-exists", "--no-owner", "--no-privileges", f"--dbname={target_env['PGDATABASE']}", tool_dump_path], target_env, args.timeout)
        if restore.returncode != 0:
            # pg_restore zwraca 1 takze przy ostrzezeniach (np. brak roli); rozstrzyga porownanie wierszy ponizej, ale ostrzezenie ma byc WIDOCZNE.
            sys.stderr.write(f"backup-drill: pg_restore rc={restore.returncode}: {restore.stderr.strip()[-600:]}\n")
        results = compare_counts(count_rows(tools, source_url, tables), count_rows(tools, args.target_url, tables))
    finally:
        if not args.keep_dump and os.path.exists(dump_path):
            os.remove(dump_path)
    ok = all(r.ok for r in results)
    report = {"started": started.isoformat(), "source_env": args.source_env, "target_host": urlparse(args.target_url).hostname,
              "tools": tools.mode, "dump_bytes": dump_bytes, "tables": [asdict(r) | {"ok": r.ok} for r in results], "ok": ok}
    if args.report:
        with open(args.report, "w", encoding="utf-8") as fh:
            json.dump(report, fh, indent=1)
    line = format_log_line(started, args.source_env, results, dump_bytes)
    if args.log:
        with open(args.log, "a", encoding="utf-8") as fh:  # APPEND — nigdy rewrite (regula pamieci)
            fh.write(line + "\n")
    print(line)
    if ok:
        print(f"backup-drill: VERIFIED — wpisz do docs/RUNBOOK.md: 'Ostatni test restore: {started.date().isoformat()} — {len(results)} tabel zgodnych'.")
    else:
        print("backup-drill: FAILED — liczby wierszy sie roznia albo count padl; backup NIE jest potwierdzony.")
    return 0 if ok else 1


def self_test() -> int:
    failures = 0

    def check(name: str, cond: bool) -> None:
        nonlocal failures
        print(("ok   " if cond else "FAIL ") + name)
        if not cond:
            failures += 1

    check("parse_tables: trim + schemat", parse_tables(" customers, public.orders ,invoices ") == ["customers", "public.orders", "invoices"])
    try:
        parse_tables("customers; drop table x")
        check("parse_tables: odrzuca niebezpieczne znaki", False)
    except ValueError:
        check("parse_tables: odrzuca niebezpieczne znaki", True)
    try:
        parse_tables(" , ")
        check("parse_tables: pusta lista = blad", False)
    except ValueError:
        check("parse_tables: pusta lista = blad", True)
    src = "postgres://u:p@db.abcdefghijklmnopqrst.supabase.co:5432/postgres"
    check("target: ten sam host = odmowa", is_forbidden_target(src, src) is not None)
    check("target: supabase.co = odmowa", is_forbidden_target(src, "postgres://u:p@db.zzzzzzzzzzzzzzzzzzzz.supabase.co:5432/x") is not None)
    check("target: dowolny zdalny host (db.firma.pl / IP) = odmowa (allow-lista)", is_forbidden_target(src, "postgres://u:p@db.firma.pl/x") is not None and is_forbidden_target(src, "postgres://u:p@10.0.0.5/x") is not None)
    check("target: zdalny + --allow-remote-target = OK", is_forbidden_target(src, "postgres://u:p@db.firma.pl/x", allow_remote=True) is None)
    check("target: localhost / 127.0.0.1 = OK", is_forbidden_target(src, "postgres://postgres:postgres@localhost:5432/drill") is None and is_forbidden_target(src, "postgres://p:p@127.0.0.1/drill") is None)
    check("target: brak hosta = odmowa", is_forbidden_target(src, "postgres:///drill") is not None)
    env = libpq_env("postgres://us%40er:p%40ss@db.example.com:6543/mydb?sslmode=require")
    check("libpq_env: host/port/user/haslo(unquote)/db/sslmode", env == {"PGHOST": "db.example.com", "PGPORT": "6543", "PGUSER": "us@er", "PGPASSWORD": "p@ss", "PGDATABASE": "mydb", "PGSSLMODE": "require"})
    check("libpq_env: domyslny port i baza", libpq_env("postgres://u:p@localhost")["PGPORT"] == "5432" and libpq_env("postgres://u:p@localhost")["PGDATABASE"] == "postgres")
    res = compare_counts({"a": 10, "b": 5, "c": None}, {"a": 10, "b": 4})
    check("compare: zgodne/niezgodne/brak", [r.ok for r in res] == [True, False, False])
    line = format_log_line(dt.datetime(2026, 9, 12, tzinfo=dt.UTC), "X_DB", res, 4096)
    check("log line: FAILED + szczegoly", line.startswith("- 2026-09-12 X_DB: restore FAILED") and "a=10/10" in line and "c=None/None" in line)
    ok_line = format_log_line(dt.datetime(2026, 9, 12, tzinfo=dt.UTC), "X_DB", res[:1], 4096)
    check("log line: OK gdy wszystko zgodne", "restore OK" in ok_line)
    # tryb docker: haslo NIGDY w argv (tylko `-e PGPASSWORD` bez wartosci), zrzut pod /work, localhost celu -> host.docker.internal
    dcmd = docker_cmd("pg_dump", ["--format=custom", "--file=/work/dump.pgc"], "/tmp/x")
    check("docker_cmd: obraz + narzedzie + argumenty, env bez wartosci, wolumen /work", dcmd[:3] == ["docker", "run", "--rm"] and DOCKER_IMAGE in dcmd and dcmd[-3:] == ["pg_dump", "--format=custom", "--file=/work/dump.pgc"] and "-v" in dcmd and "/tmp/x:/work" in dcmd and all(k in dcmd for k in PG_ENV_KEYS) and not any("=" in x and x.startswith("PG") for x in dcmd))
    check("docker_env: localhost -> host.docker.internal, zdalny host bez zmian", docker_env({"PGHOST": "localhost"})["PGHOST"] == "host.docker.internal" and docker_env({"PGHOST": "db.example.com"})["PGHOST"] == "db.example.com")
    t = Tools(mode="docker", paths={}, work_dir="/tmp/x")
    check("Tools.docker: sciezka zrzutu w kontenerze, komenda przez docker", t.dump_path_for_tool("/tmp/x/dump.pgc") == "/work/dump.pgc" and t.cmd("psql", ["-Atc", "select 1"], {})[0] == "docker")
    n = Tools(mode="native", paths={"psql": "/usr/bin/psql", "pg_dump": "/usr/bin/pg_dump", "pg_restore": "/usr/bin/pg_restore"}, work_dir="/tmp/x")
    check("Tools.native: sciezka z PATH, zrzut bez zmian", n.cmd("psql", ["-Atc", "select 1"], {}) == ["/usr/bin/psql", "-Atc", "select 1"] and n.dump_path_for_tool("/tmp/x/dump.pgc") == "/tmp/x/dump.pgc")
    print("TESTY: " + (f"{failures} FAIL" if failures else "wszystkie OK"))
    return 1 if failures else 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--source-env", help="NAZWA zmiennej env z URL bazy zrodlowej (wartosc wstrzykuje menedzer sekretow (np. Infisical CLI))")
    ap.add_argument("--target-url", help="URL lokalnej bazy docelowej (nigdy prod)")
    ap.add_argument("--tables", help="lista tabel do porownania, po przecinku")
    ap.add_argument("--report", help="sciezka raportu JSON")
    ap.add_argument("--log", help="plik logu (append), np. Obsidian Log/backup-drill.md")
    ap.add_argument("--keep-dump", action="store_true")
    ap.add_argument("--allow-remote-target", action="store_true", help="zdalny cel restore (domyslnie tylko localhost) — swiadoma decyzja, logowana")
    ap.add_argument("--docker", action="store_true", help=f"wymus narzedzia z obrazu {DOCKER_IMAGE} nawet gdy sa na PATH")
    ap.add_argument("--timeout", type=int, default=1800, help="sekundy na pg_dump / pg_restore (duza baza = podnies)")
    ap.add_argument("--self-test", action="store_true")
    args = ap.parse_args()
    if args.self_test:
        return self_test()
    if not (args.source_env and args.target_url and args.tables):
        ap.error("wymagane: --source-env, --target-url, --tables (albo --self-test)")
    return run_drill(args)


if __name__ == "__main__":
    sys.exit(main())

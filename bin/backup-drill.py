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

Wymaga pg_dump / pg_restore / psql na PATH (brak = glosny blad, nie cichy skip). Zrzut kasowany po drillu
(--keep-dump zostawia). Cel z hostem zrodla albo `supabase.co` = odmowa (drill NIGDY nie nadpisuje produkcji).
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


def which_or_die(tool: str) -> str:
    found = shutil.which(tool)
    if not found:
        raise SystemExit(f"backup-drill: brak narzedzia `{tool}` na PATH — zainstaluj PostgreSQL client tools (winget install PostgreSQL.PostgreSQL). Bez tego drill nie istnieje.")
    return found


def count_rows(psql: str, url: str, tables: list[str]) -> dict[str, int | None]:
    counts: dict[str, int | None] = {}
    env = {**os.environ, **libpq_env(url)}
    for table in tables:
        cmd = [psql, "-Atc", f"select count(*) from {table}"]
        run = subprocess.run(cmd, capture_output=True, text=True, timeout=120, check=False, env=env)
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
    pg_dump, pg_restore, psql = (which_or_die(t) for t in REQUIRED_TOOLS)
    source_env = {**os.environ, **libpq_env(source_url)}
    target_env = {**os.environ, **libpq_env(args.target_url)}
    started = dt.datetime.now(dt.UTC)
    dump_path = os.path.join(tempfile.mkdtemp(prefix="backup-drill-"), "dump.pgc")
    try:
        # Polaczenie przez env libpq (PG*), nie argv — zadnych hasel w linii komend.
        dump = subprocess.run([pg_dump, "--format=custom", "--no-owner", "--no-privileges", f"--file={dump_path}"],
                              capture_output=True, text=True, timeout=args.timeout, check=False, env=source_env)
        if dump.returncode != 0:
            raise SystemExit(f"backup-drill: pg_dump nieudany (rc={dump.returncode}): {dump.stderr.strip()[:400]}")
        dump_bytes = os.path.getsize(dump_path)
        if dump_bytes == 0:
            raise SystemExit("backup-drill: pg_dump wyprodukowal PUSTY plik — to nie jest backup.")
        restore = subprocess.run([pg_restore, "--clean", "--if-exists", "--no-owner", "--no-privileges", f"--dbname={target_env['PGDATABASE']}", dump_path],
                                 capture_output=True, text=True, timeout=args.timeout, check=False, env=target_env)
        if restore.returncode != 0:
            # pg_restore zwraca 1 takze przy ostrzezeniach (np. brak roli); rozstrzyga porownanie wierszy ponizej, ale ostrzezenie ma byc WIDOCZNE.
            sys.stderr.write(f"backup-drill: pg_restore rc={restore.returncode}: {restore.stderr.strip()[-600:]}\n")
        results = compare_counts(count_rows(psql, source_url, tables), count_rows(psql, args.target_url, tables))
    finally:
        if not args.keep_dump and os.path.exists(dump_path):
            os.remove(dump_path)
    ok = all(r.ok for r in results)
    report = {"started": started.isoformat(), "source_env": args.source_env, "target_host": urlparse(args.target_url).hostname,
              "dump_bytes": dump_bytes, "tables": [asdict(r) | {"ok": r.ok} for r in results], "ok": ok}
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

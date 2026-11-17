#!/usr/bin/env python3
"""ledger-import-devsteer: DevSteer `| U###` tables (98-M1..M7) -> pg/knowledge-ledger.jsonl.

Usage:
  python3 bin/ledger-import-devsteer.py import [--src DIR] [--out pg/knowledge-ledger.jsonl] [--expect 2375]
  python3 bin/ledger-import-devsteer.py apply --verdicts RUN/restatus-llm-*.json --date YYYY-MM-DD
  python3 bin/ledger-import-devsteer.py restatus [--ledger pg/knowledge-ledger.jsonl] [--cwd .] --report RUN/restatus.json

One table row = one ledger record; id = <module>-L<lecture>-<U range> (U restarts per lecture) (a row may cover a range, e.g. U002-U004). Nothing is dropped: a status
that is not one of MAMY / CZESCIOWO / BRAK / NIE DOTYCZY becomes "unknown".
Field mapping (8-column table `U | Sekcja zrodla | Teza | W | Status w PG + dowod | Propozycja | Koszt | WK`):
  lesson  = nearest "## NN - title" heading above the table (the lecture)
  detail  = "Sekcja zrodla" cell
  thesis  = "Teza" cell
  weight  = W / S / N cell (Polish S-with-acute kept as in source)
  status  = first word(s) of the status cell; evidence = whole status cell
  proposal= Z-codes from "Propozycja" (list) or null; rank = best place of those codes in "Ranking wartosc / koszt"
  instruction = thesis when it already starts with an imperative verb from IMPERATIVES (mechanical), else null
Exit codes: 0 ok, 1 count/duplicate check failed, 2 tool error.
"""
import argparse
import datetime
import json
import os
import re
import shlex
import subprocess
import sys
import tempfile
from pathlib import Path

SRC_DEFAULT = Path.home() / "Obsidian/MAIN/Knowledge/DevSteer - Architekt Przyszłości"
STATUSES = {"MAMY": "MAMY", "CZĘŚCIOWO": "CZĘŚCIOWO", "BRAK": "BRAK", "NIE DOTYCZY": "NIE DOTYCZY"}
WEIGHTS = {"W", "Ś", "N"}
ROW_RX = re.compile(r"^\| (U\d+(?:-U?\d+)?) \|")
CELL_SPLIT = re.compile(r"(?<!\\)\|")
RG_RX = re.compile(r"`(rg [^`]+)`\s*(?:=|→|->)\s*0\b")
# Exactly the flags the 697 ledger commands use (+ -F). No -u/--no-ignore: with explicit dotfile paths they read secrets.
RG_FLAGS = {"-n", "-i", "-w", "-F", "--hidden"}
RG_ROOTS = {"hooks", "pg", "agents", "bin", "templates", "skills", "git-hooks"}
RG_HIDDEN_OK = {".github"}
MAIN_ROOT = Path.home() / "Obsidian/MAIN"
# The ledger (and this tool's test fixture) quote the rg patterns themselves: never evidence for themselves.
SELF_EXCLUDE = ["--glob", "!pg/knowledge-ledger.jsonl", "--glob", "!*.jsonl", "--glob", "!bin/test_knowledge_ledger.py"]
# Lowercase on purpose: compared after .lower(); the public-export denylist treats one capitalised verb as a surname.
IMPERATIVES = {
    "zapisz", "sprawdź", "porównaj", "zacznij", "oddziel", "ustal", "zadaj", "traktuj", "pytaj", "dodaj", "mierz",
    "rozdziel", "opisz", "wybierz", "zdefiniuj", "nazwij", "unikaj", "używaj", "zbieraj", "szukaj", "licz", "oceń",
    "określ", "rozróżniaj", "zaplanuj", "zapytaj", "pokaż", "udokumentuj", "przyjmij", "odrzuć", "zmierz", "testuj",
    "wpisz", "zostaw", "pilnuj", "weryfikuj", "planuj", "narysuj", "rysuj", "buduj", "twórz", "utrzymuj", "trzymaj",
    "ogranicz", "wyznacz", "rozpisz", "wskaż", "podziel", "sprawdzaj", "zadbaj", "zmień", "usuń", "przeczytaj",
    "myśl", "mów", "pisz", "projektuj", "dokumentuj", "rozważ", "uwzględnij", "przygotuj", "prowadź",
    "stosuj", "zbadaj", "wyjaśnij", "potwierdź", "odróżniaj", "kończ", "dziel", "łącz", "oznacz", "ustaw",
}


def split_cells(line):
    cells = [c.strip() for c in CELL_SPLIT.split(line.strip())]
    return cells[1:-1] if cells and cells[0] == "" else cells


def parse_row(cells):
    """Locate the weight cell instead of trusting column positions (unescaped pipes inside cells shift them)."""
    widx = next((i for i in range(3, len(cells)) if cells[i] in WEIGHTS), None)
    if widx is None:
        return None
    thesis = " | ".join(cells[2:widx]).strip()
    status_cell = cells[widx + 1] if widx + 1 < len(cells) else ""
    status = next((v for k, v in STATUSES.items() if status_cell.upper().startswith(k)), "unknown")
    rest = cells[widx + 2:]
    proposal_cell = rest[0] if rest else ""
    return {
        "u": cells[0], "detail": cells[1], "thesis": thesis, "weight": cells[widx], "status": status,
        "evidence": status_cell, "proposal_cell": proposal_cell,
    }


def instruction_of(thesis):
    words = thesis.split()
    if not words:
        return None
    first = words[1] if words[0] in ("Najpierw", "Zawsze") and len(words) > 1 else words[0]
    word = first.strip(":,.")
    return thesis if word[:1].isupper() and word.lower() in IMPERATIVES else None


def rel_file(path):
    """Vault-relative path (no /home/<user> in the tracked ledger); outside the vault -> file name only."""
    try:
        return str(Path(path).resolve().relative_to(MAIN_ROOT.resolve()))
    except ValueError:
        return Path(path).name


def lesson_no(lesson):
    """U numbers restart in every lecture ('## 11 - Title'), so the id carries the lecture number."""
    m = re.match(r"(\d+)", lesson or "")
    return m[1] if m else "x"


def ranking(lines):
    """Z-code -> place from the 'Ranking wartosc / koszt' table of a module."""
    ranks, inside = {}, False
    for line in lines:
        if line.startswith("### Ranking"):
            inside = True
            continue
        if inside and line.startswith("#"):
            break
        m = re.match(r"^\| (\d+) \| (Z\d+) \|", line) if inside else None
        if m:
            ranks[m[2]] = int(m[1])
    return ranks


def parse_module(path):
    text = path.read_text(encoding="utf-8")
    lines = text.split("\n")
    mod_m = re.match(r"98-(M\d)", path.name)
    if mod_m is None:
        raise ValueError(f"nazwa pliku bez modulu 98-M<n>: {path.name}")
    module = mod_m[1]
    date_m = re.search(r"odczyt (\d{4}-\d{2}-\d{2})", text) or re.search(r"^date: (\d{4}-\d{2}-\d{2})", text, re.MULTILINE)
    date = date_m[1] if date_m else None  # reading date; frontmatter date when the body has no 'odczyt'

    ranks = ranking(lines)
    lesson, out = None, []
    for no, line in enumerate(lines, 1):
        if line.startswith("## "):
            lesson = line[3:].strip()
        row_m = ROW_RX.match(line)
        if row_m is None:
            continue
        row = parse_row(split_cells(line))
        if row is None:
            row = {"u": row_m[1], "detail": "", "thesis": line, "weight": "unknown", "status": "unknown",
                   "evidence": "", "proposal_cell": ""}
        zs = sorted(set(re.findall(r"\bZ\d+\b", row["proposal_cell"])), key=lambda z: int(z[1:]))
        best = min((ranks[z] for z in zs if z in ranks), default=None)
        out.append({
            "source": "devsteer", "id": f"{module}-L{lesson_no(lesson)}-{row['u']}", "file": rel_file(path), "line": no, "lesson": lesson,
            "thesis": row["thesis"], "detail": row["detail"], "instruction": instruction_of(row["thesis"]),
            "weight": row["weight"], "status": row["status"], "evidence": row["evidence"],
            "proposal": zs or None, "trigger": None, "place": None, "rank": best, "date": date,
        })
    return out


def check_counts(records, expect=None):
    """Seeded-fault target: returns list of problems (count mismatch, duplicate ids)."""
    problems = []
    if expect is not None and len(records) != expect:
        problems.append(f"liczba rekordow {len(records)} != oczekiwana {expect}")
    seen = {}
    for r in records:
        seen[r["id"]] = seen.get(r["id"], 0) + 1
    dups = sorted(k for k, n in seen.items() if n > 1)
    if dups:
        problems.append(f"duplikaty id: {', '.join(dups[:20])}")
    return problems


def import_all(src):
    files = sorted(p for p in Path(src).glob("98-M*.md") if re.match(r"98-M[1-9]", p.name))
    records = []
    for f in files:
        records.extend(parse_module(f))
    return records, files


def rg_argv(cmd):
    """Markdown table escapes '|' as '\\|' inside the command; the original run meant alternation."""
    try:
        argv = shlex.split(cmd.replace("\\|", "|"))
    except ValueError:  # unbalanced quote in a note: this command is refused, the run goes on
        return None
    if not argv or argv[0] != "rg" or any(t in cmd for t in (";", "&&", "$(", ">", "`")):
        return None
    positional = []
    for tok in argv[1:]:
        if tok.startswith("-"):
            if tok not in RG_FLAGS:  # e.g. --pre=<program> would execute code named in a note
                return None
        else:
            positional.append(tok)
    if len(positional) < 2:  # no path = rg searches all of cwd incl. hidden files; every ledger command names a path
        return None
    for path in positional[1:]:  # first positional = pattern, rest = PG source dirs only
        parts = Path(path).parts
        if path.startswith(("/", "~")) or not parts or parts[0] not in RG_ROOTS:
            return None
        if any(x == ".." or (x.startswith(".") and x not in RG_HIDDEN_OK) for x in parts):
            return None
    return argv


def inside(cwd, argv):
    """Explicit path args must resolve inside cwd (a symlinked dir would leave it)."""
    root = Path(cwd).resolve()
    pos = [t for t in argv[1:] if not t.startswith("-")][1:]
    return all((root / p).resolve().is_relative_to(root) for p in pos)


def restatus(records, cwd, runner=subprocess.run):
    rerun, changed, errors = 0, [], []
    for r in records:
        for m in RG_RX.finditer(r.get("evidence") or ""):
            argv = rg_argv(m[1])
            if argv is None:
                errors.append({"id": r["id"], "cmd": m[1], "error": "niedozwolona komenda (tylko rg bez operatorow)"})
                continue
            if not inside(cwd, argv):
                errors.append({"id": r["id"], "cmd": m[1], "error": "sciezka wychodzi poza cwd (symlink)"})
                continue
            rerun += 1
            env = {k: v for k, v in os.environ.items() if k != "RIPGREP_CONFIG_PATH"}
            try:
                p = runner([argv[0], "--no-config", *argv[1:], *SELF_EXCLUDE], cwd=cwd, env=env, capture_output=True, text=True, timeout=60)
            except (subprocess.TimeoutExpired, OSError) as e:  # tool error is recorded, never silent
                errors.append({"id": r["id"], "cmd": m[1], "error": str(e)[:200]})
                continue
            if p.returncode not in (0, 1):
                errors.append({"id": r["id"], "cmd": m[1], "error": f"rg exit {p.returncode}: {p.stderr[:200]}"})
                continue
            hits = [l for l in p.stdout.split("\n") if l.strip()]
            if hits:
                changed.append({"id": r["id"], "weight": r["weight"], "cmd": m[1], "hits": len(hits), "sample": hits[:3]})
    return {"rerun": rerun, "changed": changed, "errors": errors}


def apply_verdicts(records, verdicts, date):
    """LLM re-check of W units whose rg=0 evidence now has hits. Old status is kept in status_snapshot."""
    if any(not isinstance(v, dict) or "id" not in v for v in verdicts):
        raise ValueError("werdykt bez pola id")
    ids = [v["id"] for v in verdicts]
    dup = sorted({i for i in ids if ids.count(i) > 1})
    if dup:
        raise ValueError(f"zdublowane werdykty: {', '.join(dup[:5])}")
    by_id = {v["id"]: v for v in verdicts}
    unknown = sorted(set(by_id) - {r["id"] for r in records})
    if unknown:
        raise ValueError(f"werdykty dla nieznanych id: {', '.join(unknown[:5])}")
    applied = 0
    for r in records:
        v = by_id.get(r["id"])
        if not v:
            continue
        if v.get("new_status") not in ("MAMY", "CZĘŚCIOWO", "BRAK"):
            raise ValueError(f"{r['id']}: zly new_status {v.get('new_status')!r}")
        r.setdefault("status_snapshot", r["status"])  # first snapshot = 2026-10-12 source status
        if "restatus" in r:  # earlier verdicts are history, not overwritten
            r.setdefault("restatus_history", []).append({**r["restatus"], "status": r["status"]})
        r["status"] = v["new_status"]
        r["restatus"] = {"date": date, "evidence": v.get("evidence", ""), "reason": v.get("reason", "")}
        applied += 1
    return applied


def load_jsonl(path):
    return [json.loads(l) for l in Path(path).read_text(encoding="utf-8").split("\n") if l.strip()]


def write_atomic(path, records):
    """Single writer assumed (no lock): unique tmp + fsync + rename, so a crash never leaves a half file."""
    path = Path(path)
    fd, tmp = tempfile.mkstemp(dir=path.parent or ".", prefix=path.name + ".", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write("\n".join(json.dumps(r, ensure_ascii=False) for r in records) + "\n")
            f.flush()
            os.fsync(f.fileno())
        os.chmod(tmp, path.stat().st_mode & 0o777 if path.exists() else 0o644)  # mkstemp is 0600
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


PARSER_KEYS = {"source", "id", "file", "line", "lesson", "thesis", "detail", "instruction", "weight", "status",
               "evidence", "proposal", "rank", "date"}
NULL_FROM_PARSER = {"trigger", "place"}  # parser writes None; later phases (P6.6) fill them in


def downstream(rec):
    """Fields written after import (restatus, P6.6 trigger/place/wont, ...) that a re-import must not lose."""
    return {k: v for k, v in rec.items() if k not in PARSER_KEYS and not (k in NULL_FROM_PARSER and v is None)}


def carry_restatus(records, old):
    """Re-import must not erase a dated restatus. Carried only when the thesis AND the source status are
    unchanged; otherwise the old verdict no longer applies and its id is returned as dropped (import refuses)."""
    prev = {r["id"]: r for r in old if r.get("source") == "devsteer" and downstream(r)}
    n, kept = 0, set()
    for r in records:
        p = prev.get(r["id"])
        if p and p.get("thesis") == r["thesis"] and p.get("status_snapshot", r["status"]) == r["status"]:
            r.update(downstream(p))
            if "restatus" in p:
                r["status"] = p["status"]
            kept.add(r["id"])
            n += 1
    return n, sorted(set(prev) - kept)


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["import", "restatus", "apply"])
    ap.add_argument("--verdicts", nargs="*", default=[])
    ap.add_argument("--date", default=None)
    ap.add_argument("--src", default=str(SRC_DEFAULT))
    ap.add_argument("--out", default="pg/knowledge-ledger.jsonl")
    ap.add_argument("--ledger", default="pg/knowledge-ledger.jsonl")
    ap.add_argument("--expect", type=int, default=2375)
    ap.add_argument("--cwd", default=".")
    ap.add_argument("--report")
    a = ap.parse_args(argv)
    try:
        if a.cmd == "import":
            records, files = import_all(a.src)
            problems = check_counts(records, a.expect)
            out = Path(a.out)
            old = load_jsonl(out) if out.exists() else []
            carried, dropped = carry_restatus(records, old)
            if dropped:
                problems.append(f"dane po imporcie (restatus/trigger/place/...) utracone (zmieniona teza/status/id) dla {len(dropped)}: {', '.join(dropped[:10])}")
            keep = [r for r in old if r.get("source") != "devsteer"]
            if not check_counts(records):  # devsteer ids are unique; now check them against other sources (P9 rows)
                problems += [f"kolizja id miedzy zrodlami: {p}" for p in check_counts(keep + records)]
            if not problems:
                write_atomic(out, keep + records)
            by_mod = {}
            for r in records:
                by_mod[r["id"].split("-")[0]] = by_mod.get(r["id"].split("-")[0], 0) + 1
            print(json.dumps({"files": len(files), "records": len(records), "by_module": by_mod,
                              "unknown_status": sum(r["status"] == "unknown" for r in records), "restatus_carried": carried, "restatus_dropped": len(dropped),
                              "written": not problems, "problems": problems}, ensure_ascii=False))
            return 1 if problems else 0
        records = [json.loads(l) for l in Path(a.ledger).read_text(encoding="utf-8").split("\n") if l.strip()]
        if a.cmd == "apply":
            if not a.date or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", a.date):
                raise ValueError("apply wymaga --date YYYY-MM-DD")
            datetime.date.fromisoformat(a.date)  # ValueError (-> exit 2) on 2026-13-40
            verdicts = [v for f in a.verdicts for v in json.loads(Path(f).read_text(encoding="utf-8"))]
            n = apply_verdicts(records, verdicts, a.date)
            write_atomic(Path(a.ledger), records)
            print(json.dumps({"verdicts": len(verdicts), "applied": n}))
            return 0 if n == len(verdicts) else 1
        rep = restatus([r for r in records if r["source"] == "devsteer"], a.cwd)
        if a.report:
            Path(a.report).write_text(json.dumps(rep, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        print(json.dumps({"rerun": rep["rerun"], "changed": len(rep["changed"]), "errors": len(rep["errors"])}))
        return 2 if rep["errors"] else 0
    except (OSError, ValueError, KeyError) as e:
        print(f"ledger-import-devsteer: blad narzedzia: {e}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())

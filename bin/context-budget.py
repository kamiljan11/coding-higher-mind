#!/usr/bin/env python3
"""context-budget: stały kontekst sesji (to, co model dostaje przed pierwszą odpowiedzią), rozbity na źródła. 0 tokenów.

Czyta transkrypty główne ~/.claude/projects/*/*.jsonl. Dla każdego zlicza znaki załączników sprzed pierwszej
odpowiedzi: listę skilli (plugin / ~/.claude/skills śledzone w gicie / nieśledzone / konto), odroczone narzędzia per
serwer MCP, pliki instrukcji (CLAUDE.md...), wyjścia hooków (per skrypt), listę agentów, instrukcje MCP. Do tego
kontekst pierwszej odpowiedzi w tokenach (input + cache). Każde wywołanie modelu w sesji płaci ten stały koszt jeszcze
raz (z cache), więc to on, a nie rozmiar plików pamięci, rośnie po cichu (pomiar 2026-11-04: mediana 80k tok W39 ->
91k W45; `pg/GLOSSARY.md` › Stały kontekst). `--baseline RRRR-MM-DD` dokłada te same mediany z N sesji rozpoczętych
przed datą i kolumnę zmiany, czyli odpowiada, SKĄD przyrost. Reszta kontekstu (prompt systemowy i schematy narzędzi
Claude Code) nie ma załącznika: raport podaje ją jako SZACUNEK „kontekst - załączniki / CHARS_PER_TOKEN".
Uruchom przed i po zmianie CLAUDE.md, skilli, hooków SessionStart/UserPromptSubmit albo listy serwerów MCP.
Exit: 0 = raport, 2 = brak sesji z odpowiedzią albo 0 znaków załączników przy niezerowym kontekście (zły --root albo
zmieniony format transkryptu — nie „kontekst 0"). Nic nie wysyła, nic nie modyfikuje.

Użycie: python context-budget.py [--sessions 10] [--baseline 2026-09-28] [--root ~/.claude/projects] [--json]
        python context-budget.py --self-test
"""
from __future__ import annotations

import argparse
import collections
import datetime as dt
import glob
import json
import os
import statistics
import subprocess
import sys
import tempfile
from typing import Any

SKILL_LINE_PREFIX = "- "
USAGE_KEYS = ("input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens")
SCRIPT_EXT = (".js", ".py", ".sh", ".mjs", ".cjs")
# Przelicznik znaki -> tokeny tylko dla wiersza „reszta" (szacunek; tekst PL/EN + JSON, nie mierzony tokenizerem).
CHARS_PER_TOKEN = 3.5


def skill_owner(name: str, local: set[str], tracked: set[str] | None = None) -> str:
    """`plugin:skill` -> plugin <nazwa>; skill z ~/.claude/skills -> śledzony / nieśledzony w gicie; reszta = konto."""
    if ":" in name:
        return "skill plugin " + name.split(":", 1)[0]
    if name not in local:
        return "skill konto/wbudowane"
    if tracked is None:
        return "skill ~/.claude/skills"
    return "skill ~/.claude/skills (sledzone)" if name in tracked else "skill ~/.claude/skills (niesledzone)"


def tool_owner(name: str) -> str:
    """mcp__<serwer>__<narzedzie> -> mcp <serwer>; inne = wbudowane."""
    parts = name.split("__")
    return "narzedzia mcp " + parts[1] if name.startswith("mcp__") and len(parts) >= 3 else "narzedzia wbudowane"


def hook_script(command: str) -> str:
    """Nazwa skryptu hooka: pierwszy token z rozszerzeniem skryptu (argumenty po nim nie zmieniają źródła)."""
    tokens = [t.strip("\"'") for t in command.split()]
    for tok in tokens:
        if tok.endswith(SCRIPT_EXT):
            return os.path.basename(tok)
    return os.path.basename(tokens[0]) if tokens and tokens[0] else "?"


def usage_tokens(usage: dict[str, Any]) -> int:
    """input + cache; gdy górny poziom ma same zera, suma `iterations[]` (3 na 105 275 rekordów, pomiar 2026-11-04)."""
    top = sum(int(usage.get(k) or 0) for k in USAGE_KEYS)
    if top:
        return top
    its = usage.get("iterations")
    return sum(int(i.get(k) or 0) for i in its if isinstance(i, dict) for k in USAGE_KEYS) if isinstance(its, list) else 0


def preamble(path: str, local_skills: set[str], tracked: set[str] | None = None) -> dict[str, Any] | None:
    """Znaki per źródło przed pierwszą odpowiedzią z niezerowym kontekstem + jej kontekst i start sesji; None = brak."""
    chars: collections.Counter[str] = collections.Counter()
    started = None
    with open(path, encoding="utf-8", errors="replace") as fh:
        for line in fh:
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                continue
            if not isinstance(rec, dict):
                continue
            started = started or rec.get("timestamp")
            msg = rec.get("message")
            if rec.get("type") == "assistant" and isinstance(msg, dict) and isinstance(msg.get("usage"), dict):
                ctx = usage_tokens(msg["usage"])
                if ctx:  # odpowiedz syntetyczna (model <synthetic>, 0 tokenow) nie jest pierwsza odpowiedzia modelu
                    return {"context_tokens": ctx, "started": started, "chars": dict(chars)}
                continue
            att = rec.get("attachment")
            if rec.get("type") != "attachment" or not isinstance(att, dict):
                continue
            kind = att.get("type")
            if kind == "skill_listing":
                for row in str(att.get("content") or "").splitlines():
                    if row.startswith(SKILL_LINE_PREFIX):
                        chars[skill_owner(row[len(SKILL_LINE_PREFIX):].split(": ", 1)[0], local_skills, tracked)] += len(row) + 1
            elif kind == "deferred_tools_delta":
                for name in att.get("addedNames") or []:
                    chars[tool_owner(str(name))] += len(str(name)) + 1
            elif kind == "instructions":
                for item in att.get("files") or att.get("items") or []:
                    if isinstance(item, dict):
                        chars["instrukcje " + str(item.get("path") or "?").replace(os.path.expanduser("~"), "~")] += len(str(item.get("content") or ""))
            elif kind == "hook_success":
                chars["hook " + hook_script(str(att.get("command") or ""))] += len(str(att.get("content") or ""))
            elif kind in ("agent_listing_delta", "mcp_instructions_delta"):
                chars[kind] += len(json.dumps(att, ensure_ascii=False))
    return None


def summarize(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Mediana kontekstu i mediana znaków per źródło (brak źródła w sesji = 0)."""
    keys = sorted({k for r in rows for k in r["chars"]})
    med = {k: int(statistics.median([r["chars"].get(k, 0) for r in rows])) for k in keys}
    return {"sessions": len(rows), "context_tokens_median": int(statistics.median([r["context_tokens"] for r in rows])) if rows else 0,
            "chars_median": dict(sorted(med.items(), key=lambda kv: -kv[1]))}


def rest_tokens(summary: dict[str, Any]) -> int:
    """Szacunek kontekstu bez zalacznika (prompt systemowy + schematy narzedzi CC) = kontekst - zalaczniki/CHARS_PER_TOKEN."""
    return summary["context_tokens_median"] - round(sum(summary["chars_median"].values()) / CHARS_PER_TOKEN)


def render(summary: dict[str, Any], baseline: dict[str, Any] | None = None, top: int = 25, tracked_known: bool = True) -> str:
    total = sum(summary["chars_median"].values())
    out = [f"context-budget: {summary['sessions']} sesji, kontekst 1. odpowiedzi mediana {summary['context_tokens_median']:,} tok"]
    if baseline:
        out.append(f"baza: {baseline['sessions']} sesji, mediana {baseline['context_tokens_median']:,} tok -> zmiana "
                   f"{summary['context_tokens_median'] - baseline['context_tokens_median']:+,} tok")
    out.append(f"zalaczniki przed 1. odpowiedzia (mediana znakow): {total:,} zn ~ {round(total / CHARS_PER_TOKEN):,} tok")
    rest = f"reszta bez zalacznika (prompt systemowy + schematy narzedzi CC, SZACUNEK przy {CHARS_PER_TOKEN} zn/tok): {rest_tokens(summary):,} tok"
    out.append(rest + (f" (baza {rest_tokens(baseline):,} -> zmiana {rest_tokens(summary) - rest_tokens(baseline):+,})" if baseline else ""))
    if baseline:
        out.append("uwaga: podzial skilli sledzone/niesledzone/konto wg DZISIEJSZEGO dysku i gita, takze dla sesji bazowych")
    if not tracked_known:
        out.append("uwaga: katalog skilli bez gita -> bez podzialu sledzone/niesledzone")
    out.append("")
    if baseline:
        base = baseline["chars_median"]
        keys = sorted(set(summary["chars_median"]) | set(base), key=lambda k: -abs(summary["chars_median"].get(k, 0) - base.get(k, 0)))
        out += ["| Zrodlo | Znaki (mediana) | Baza | Zmiana |", "|---|---|---|---|"]
        for k in keys[:top]:
            now, was = summary["chars_median"].get(k, 0), base.get(k, 0)
            out.append(f"| {k} | {now:,} | {was:,} | {now - was:+,} |")
        return "\n".join(out)
    out += ["| Zrodlo | Znaki (mediana) | % zalacznikow |", "|---|---|---|"]
    for k, v in list(summary["chars_median"].items())[:top]:
        out.append(f"| {k} | {v:,} | {100 * v / total:.1f} |" if total else f"| {k} | {v:,} | - |")
    return "\n".join(out)


def transcript_files(root: str) -> list[str]:
    """Wszystkie transkrypty glowne; kolejnosc bez znaczenia (wybor N sesji = pick() po starcie sesji)."""
    return sorted(glob.glob(os.path.join(root, "*", "*.jsonl")))


def pick(rows: list[dict[str, Any]], n: int, before: str | None = None) -> list[dict[str, Any]]:
    """N sesji o najpóźniejszym starcie (opcjonalnie: rozpoczętych przed `before`, RRRR-MM-DD)."""
    ok = [r for r in rows if isinstance(r.get("started"), str) and (before is None or r["started"] < before)]
    return sorted(ok, key=lambda r: r["started"], reverse=True)[:n]


def tracked_skills(skills_dir: str) -> set[str] | None:
    """Skille śledzone w gicie repo nad katalogiem skilli; None = brak gita (wtedy bez podziału)."""
    try:
        res = subprocess.run(["git", "-C", os.path.dirname(skills_dir), "ls-files", os.path.basename(skills_dir)],
                             capture_output=True, text=True, timeout=30, check=False)
    except (OSError, subprocess.TimeoutExpired):
        return None
    if res.returncode != 0:
        return None
    return {p.split("/")[1] for p in res.stdout.split() if p.endswith("/SKILL.md") and p.count("/") == 2}


def self_test() -> int:
    failures = 0

    def check(name: str, cond: bool) -> None:
        nonlocal failures
        print(("ok   " if cond else "FAIL ") + name)
        if not cond:
            failures += 1

    check("skill_owner: plugin", skill_owner("legal:review", set()) == "skill plugin legal")
    check("skill_owner: lokalny vs konto", skill_owner("pg-review", {"pg-review"}) == "skill ~/.claude/skills" and skill_owner("x", set()) == "skill konto/wbudowane")
    check("skill_owner: sledzony vs niesledzony", skill_owner("a", {"a", "b"}, {"a"}).endswith("(sledzone)") and skill_owner("b", {"a", "b"}, {"a"}).endswith("(niesledzone)"))
    check("tool_owner: mcp / wbudowane", tool_owner("mcp__rea__open_binary") == "narzedzia mcp rea" and tool_owner("WebFetch") == "narzedzia wbudowane")
    check("hook_script: skrypt z argumentem, cudzyslowy, pusta komenda",
          hook_script('node "/h/x.js" --flag') == "x.js" and hook_script("python3 /h/g.py") == "g.py" and hook_script('""') == "?" and hook_script("   ") == "?")
    check("usage_tokens: gorny poziom, zera -> iterations, brak = 0",
          usage_tokens({"input_tokens": 1, "cache_read_input_tokens": 9}) == 10
          and usage_tokens({"input_tokens": 0, "iterations": [{"cache_read_input_tokens": 7}, {"input_tokens": 3}]}) == 10 and usage_tokens({}) == 0)
    recs = [
        {"type": "user", "timestamp": "2026-11-01T10:00:00Z"},
        {"type": "attachment", "attachment": {"type": "skill_listing", "content": "- legal:review: aaa\n- pg-review: bb\nnaglowek"}},
        {"type": "attachment", "attachment": {"type": "deferred_tools_delta", "addedNames": ["mcp__rea__a", "WebFetch"]}},
        {"type": "attachment", "attachment": {"type": "instructions", "files": [{"path": "/x/CLAUDE.md", "content": "12345"}]}},
        {"type": "attachment", "attachment": {"type": "hook_success", "command": 'node "/h/hooks/session-context.js"', "content": "abc"}},
        {"type": "attachment", "attachment": {"type": "hook_success", "command": '""', "content": "zz"}},
        {"type": "attachment", "attachment": {"type": "agent_listing_delta", "addedLines": ["a"]}},
        {"type": "attachment", "attachment": {"type": "mcp_instructions_delta", "x": 1}},
        "not-a-dict",
        {"type": "assistant", "message": {"model": "<synthetic>", "usage": {"input_tokens": 0, "output_tokens": 0}}},
        {"type": "attachment", "attachment": {"type": "hook_success", "command": "between.js", "content": "q"}},
        {"type": "assistant", "message": {"usage": {"input_tokens": 1, "cache_creation_input_tokens": 9, "cache_read_input_tokens": 90}}},
        {"type": "attachment", "attachment": {"type": "hook_success", "command": "late.js", "content": "po odpowiedzi"}},
    ]
    with tempfile.TemporaryDirectory() as tmp:
        p = os.path.join(tmp, "s.jsonl")
        with open(p, "w", encoding="utf-8") as fh:
            fh.write("\n".join(json.dumps(r) for r in recs) + "\n{zly json\n")
        got = preamble(p, {"pg-review"})
        check("preamble: kontekst = in + cache, odpowiedz syntetyczna pominieta", got is not None and got["context_tokens"] == 100)
        check("preamble: start sesji = 1. timestamp", got is not None and got["started"] == "2026-11-01T10:00:00Z")
        c = got["chars"] if got else {}
        check("preamble: skille per wlasciciel, naglowek pominiety", c.get("skill plugin legal") == len("- legal:review: aaa") + 1 and c.get("skill ~/.claude/skills") == len("- pg-review: bb") + 1)
        check("preamble: narzedzia per serwer", c.get("narzedzia mcp rea") == len("mcp__rea__a") + 1 and c.get("narzedzia wbudowane") == len("WebFetch") + 1)
        check("preamble: instrukcje i hook po nazwie skryptu, pusta komenda = ?", c.get("instrukcje /x/CLAUDE.md") == 5 and c.get("hook session-context.js") == 3 and c.get("hook ?") == 2)
        check("preamble: lista agentow i instrukcje MCP", c.get("agent_listing_delta", 0) > 0 and c.get("mcp_instructions_delta", 0) > 0)
        check("preamble: zalacznik miedzy syntetyczna a 1. odpowiedzia sie liczy, po niej nie", c.get("hook between.js") == 1 and "hook late.js" not in c)
        empty = os.path.join(tmp, "e.jsonl")
        with open(empty, "w", encoding="utf-8") as fh:
            fh.write(json.dumps(recs[1]))
        check("preamble: bez odpowiedzi = None", preamble(empty, set()) is None)
        os.makedirs(os.path.join(tmp, "root", "proj"))
        os.makedirs(os.path.join(tmp, "root", "proj", "sid", "subagents"))
        with open(os.path.join(tmp, "root", "proj", "s.jsonl"), "w", encoding="utf-8") as fh:
            fh.write("\n".join(json.dumps(r) for r in recs) + "\n")
        open(os.path.join(tmp, "root", "proj", "sid", "subagents", "x.jsonl"), "w", encoding="utf-8").close()
        check("transcript_files: tylko sesje glowne", [os.path.relpath(x, tmp).replace("\\", "/") for x in transcript_files(os.path.join(tmp, "root"))] == ["root/proj/s.jsonl"])
        check("tracked_skills: katalog bez gita = None", tracked_skills(os.path.join(tmp, "root")) is None)

        def run(*argv: str) -> subprocess.CompletedProcess[str]:
            return subprocess.run([sys.executable, "-I", os.path.abspath(__file__), *argv, "--skills", os.path.join(tmp, "none")],
                                  capture_output=True, text=True, timeout=60, check=False)
        ok, missing, early = run("--root", os.path.join(tmp, "root")), run("--root", os.path.join(tmp, "brak")), run("--root", os.path.join(tmp, "root"), "--baseline", "2020-01-01")
        check("main: raport exit 0 + wiersz reszty", ok.returncode == 0 and "reszta bez zalacznika" in ok.stdout)
        check("main: brak sesji = exit 2 (takze pusta baza)", missing.returncode == 2 and early.returncode == 2 and "brak sesji" in early.stderr)
        drift_root = os.path.join(tmp, "drift", "proj")
        os.makedirs(drift_root)
        with open(os.path.join(drift_root, "d.jsonl"), "w", encoding="utf-8") as fh:
            fh.write("\n".join(json.dumps(r) for r in (recs[0], {"type": "attachment", "attachment": {"type": "renamed_listing"}}, recs[-2])) + "\n")
        drift = run("--root", os.path.join(tmp, "drift"))
        check("main: kontekst bez znanych zalacznikow = exit 2 (zmiana formatu)", drift.returncode == 2 and "format" in drift.stderr)
    rows = [{"started": s, "context_tokens": 1, "chars": {}} for s in ("2026-09-20T00:00Z", "2026-11-02T00:00Z", "2026-11-03T00:00Z")] + [{"started": None, "context_tokens": 1, "chars": {}}]
    check("pick: najnowsze N, filtr --baseline, brak startu pominiety",
          [r["started"][:10] for r in pick(rows, 2)] == ["2026-11-03", "2026-11-02"] and [r["started"][:10] for r in pick(rows, 5, "2026-10-01")] == ["2026-09-20"])
    s = summarize([{"context_tokens": 10, "chars": {"a": 4}}, {"context_tokens": 30, "chars": {"a": 2, "b": 6}}, {"context_tokens": 20, "chars": {}}])
    check("summarize: mediany, brak zrodla = 0", s["context_tokens_median"] == 20 and s["chars_median"] == {"a": 2, "b": 0})
    md = render(summarize([{"context_tokens": 5, "chars": {"x": 3, "y": 1}}]))
    check("render: tabela z procentami", "| x | 3 | 75.0 |" in md and "| y | 1 | 25.0 |" in md)
    check("rest_tokens: kontekst - zalaczniki / CHARS_PER_TOKEN", rest_tokens({"context_tokens_median": 100, "chars_median": {"a": 70}}) == 80)
    delta = render(summarize([{"context_tokens": 50, "chars": {"x": 3, "new": 9}}]), summarize([{"context_tokens": 40, "chars": {"x": 5}}]))
    check("render --baseline: zmiana kontekstu i zrodel, najwieksza zmiana pierwsza",
          "zmiana +10 tok" in delta and delta.index("| new | 9 | 0 | +9 |") < delta.index("| x | 3 | 5 | -2 |") and "DZISIEJSZEGO" in delta)
    check("render: brak gita = uwaga o podziale", "bez podzialu" in render(summarize([{"context_tokens": 5, "chars": {"x": 1}}]), tracked_known=False))
    check("render: pusta lista bez dzielenia przez 0", "0 sesji" in render(summarize([])))
    print("TESTY: " + (f"{failures} FAIL" if failures else "wszystkie OK"))
    return 1 if failures else 0


def positive_int(value: str) -> int:
    n = int(value)
    if n < 1:
        raise argparse.ArgumentTypeError("musi byc >= 1")
    return n


def iso_date(value: str) -> str:
    dt.date.fromisoformat(value)  # ValueError -> argparse: blad uzycia
    return value


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--root", default=os.path.join(os.path.expanduser("~"), ".claude", "projects"))
    ap.add_argument("--skills", default=os.path.join(os.path.expanduser("~"), ".claude", "skills"))
    ap.add_argument("--sessions", type=positive_int, default=10)
    ap.add_argument("--baseline", type=iso_date, help="porownaj z N sesjami rozpoczetymi przed ta data (RRRR-MM-DD)")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--self-test", action="store_true")
    args = ap.parse_args()
    if args.self_test:
        return self_test()
    local = {os.path.basename(os.path.dirname(p)) for p in glob.glob(os.path.join(args.skills, "*", "SKILL.md"))}
    tracked = tracked_skills(args.skills)
    rows = []
    for p in transcript_files(args.root):
        try:
            row = preamble(p, local, tracked)
        except OSError as err:
            print(f"skip {p}: {err}", file=sys.stderr)
            continue
        if row:
            rows.append(row)
    current = summarize(pick(rows, args.sessions))
    baseline = summarize(pick(rows, args.sessions, args.baseline)) if args.baseline else None
    drift = [s for s in (current, baseline) if s and s["sessions"] and not s["chars_median"]]
    if drift:
        print("context-budget: sesje maja kontekst, ale 0 znakow zalacznikow — zmieniony format transkryptu "
              "(nazwy typow zalacznikow w preamble())", file=sys.stderr)
        return 2
    if not current["sessions"] or (baseline is not None and not baseline["sessions"]):
        print(f"context-budget: brak sesji z odpowiedzia w {args.root}" + (f" przed {args.baseline}" if args.baseline else "")
              + " — zly --root albo zmieniony format transkryptu (to nie jest „kontekst 0”)", file=sys.stderr)
        return 2
    if args.json:
        print(json.dumps({"current": current, "baseline": baseline}, ensure_ascii=False, indent=1))
    else:
        print(render(current, baseline, tracked_known=tracked is not None))
    return 0


if __name__ == "__main__":
    sys.exit(main())

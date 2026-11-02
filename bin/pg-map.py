#!/usr/bin/env python3
"""pg-map: mapa systemu PG dla CZLOWIEKA (README.md w ~/.claude i bin/README.md), generowana z plikow (0 tokenow).

Retro 2026-09-12 (pytanie uzytkownika o przekazanie systemu dalej): ~/.claude mial 57 skryptow w bin/ i 15 plikow w pg/
bez zadnego indeksu — maszyna sie w tym porusza, obcy senior nie. Regula: kazde narzedzie opisuje sie SAMO
w pierwszym komentarzu/docstringu; ten skrypt tylko to zbiera. Brak opisu = wiersz "(BEZ OPISU)" — widoczny dlug.

Generuje tez blok „Wiring” (diagram wpiec z settings.json + bin/ wolane z git-hooks) w pg/public/docs/ARCHITECTURE.md miedzy znacznikami.
Uzycie: python ~/.claude/bin/pg-map.py [--check]   (--check: exit 1, gdy README/INDEX/Wiring sa nieaktualne — do guard_health)
Exit: 0 = aktualne/zapisane; 1 = nieaktualne (--check) albo brak znacznikow Wiring; 2 = blad narzedzia (brak/zly settings.json, dokument).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys

ROOT = os.path.join(os.path.expanduser("~"), ".claude")
SKIP_DIRS = {"node_modules", "__pycache__", ".ruff_cache", "_bak-2026-08-24-v1"}

SECTIONS = [  # (katalog, rola dla czlowieka)
    ("hooks", "Bramki NA ZDARZENIE Claude Code: przed promptem (prompt-guard), po edycji (post-edit-check), przed Bashem (bash-guard), przy zakonczeniu (stop-gate), na starcie sesji (session-context). Audyt calosci: guard_health.py"),
    ("git-hooks", "Bramki gita dla KAZDEGO repo (core.hooksPath): commit-msg, pre-commit, pre-push. Tu siedza skany sekretow, lint, typy, dup-literals, dep-exists, base-check, diff-size"),
    ("bin", "Narzedzia 0-tokenowe i skrypty floty — indeks ponizej w bin/README.md"),
    ("agents", "Recenzenci dzialowi ze swiezym kontekstem (code, security, data, ops, ux, product, qa, verifier, catfish) — read-only, schemat JSON"),
    ("skills", "Skille (procedury) — wlasne w katalogach bez prefiksu; vendorowane (Anthropic i inne) NIE sa lintowane (ruff.toml/pyrightconfig)"),
    ("pg", "Doktryna PG: paradigm (jak piszemy), design (przed kodem), dod (kiedy gotowe), prr (przed deployem), postmortem (po incydencie), cases (blizny floty), retro-*, eval (golden set + kalibracja recenzentow)"),
    ("templates/repo", "Szablon nowego repo: workflows CI (quality, claude-review, mutation, release), eslint/tsconfig, PR template, docs/ARCHITECTURE+GLOSSARY, ADR"),
    ("scheduled-tasks", "Zadania cykliczne na subskrypcji: fleet-pr-reviewer, fleet-cve-watch, guard-health, pg-reviewer-calibration, fleet-auto-improve (wylaczony)"),
    ("tools/workflow-lint", "Parser workflow GitHuba (@actions/workflow-parser) — ten sam, ktory GitHub uruchamia; uzywany w pre-commit i mas_merge_prs"),
    ("commands", "Slash-komendy Claude Code"),
]

ENTRY_POINTS = [
    ("CLAUDE.md", "globalne instrukcje uzytkownika — pierwsze, co czyta kazda sesja"),
    ("prompt-protocol.md", "pelny protokol anty-halucynacyjny (prompt-guard.js wstrzykuje wersje skrocona)"),
    ("settings.json", "rejestracja hookow i uprawnien Claude Code"),
    ("pg/retro-2026-09-06.md", "retrospektywa: co w PG bylo na papierze i jak to naprawiono — najlepszy punkt startu dla obcego"),
    ("pg/cases.md", "biblioteka blizn — kazda bramka ma tu swoje realne zdarzenie"),
]


SHORT = 160


def short(text: str, n: int = SHORT) -> str:
    """Opis do tabeli: calosc, gdy krotki; inaczej do konca zdania albo do granicy slowa + „…" (nie w pol slowa)."""
    text = text.replace("|", "/").strip()
    if len(text) <= n:
        return text
    cut = text[:n]
    end = cut.rfind(". ")  # nie na „; ” — tam bywa komenda uruchomienia (r11 product: „odpalaj: node …” znikalo)
    if end >= n // 2:
        return cut[:end + 1]
    space = cut.rfind(" ")
    return (cut[:space] if space > 0 else cut).rstrip(" ,;:-—(") + " …"


def continues(line: str) -> bool:
    """Linia ciagnie poprzednie zdanie (mala litera, cudzyslow, nawias, strzalka); wielka litera = nowe zdanie, wtedy nie
    doklejamy — inaczej short() tnal na „. ” i gubil komende uruchomienia z konca 1. linii (r12 product: test_sd_matrix_lint)."""
    return not line[:1].isupper()


def sentence(lines: list[str]) -> str:
    """Linie opisu sklejone do konca pierwszego zdania (albo do pustej linii / limitu) — 1. linia bywa ucieta w pol zdania."""
    parts: list[str] = []
    for ln in lines:
        ln = ln.strip()
        if not ln or (parts and not continues(ln)):
            break
        parts.append(ln)
        if re.search(r"[.!?]$", ln) or len(" ".join(parts)) > SHORT:
            break
    return " ".join(parts)


def first_doc(path: str) -> str:
    """Pierwsze zdanie samoopisu: docstring (.py), komentarz naglowkowy (.js/.mjs/.sh/.ps1), frontmatter description (.md)."""
    try:
        with open(path, encoding="utf-8", errors="replace") as fh:
            head = fh.read(4000)
    except OSError:
        return ""
    head = head.lstrip("﻿")  # BOM ze starych skryptow mas_*.py
    ext = os.path.splitext(path)[1].lower()
    if ext == ".py":
        # Tylko docstring MODULU (po shebangu/komentarzach): pierwszy """ w pliku bywa docstringiem funkcji (guard_health.py).
        m = re.match(r'(?:[ \t]*(?:#[^\n]*)?\n)*[ \t]*(?:[rRuU]?)"""(.*?)(?:\n\n|""")', head, re.DOTALL)
        if m:
            return sentence(m.group(1).strip().splitlines())
    if ext in (".js", ".mjs", ".cjs", ".ts"):
        # Pierwszy blok komentarza sklejony do konca zdania: sama 1. linia bywala ucieta w pol zdania (r10 code: loop-monitor „->").
        parts: list[str] = []
        for ln in [ln for ln in head.splitlines() if ln.strip()][:12]:
            s = ln.strip()
            if not s.startswith(("//", "/*", "*")):
                if parts:
                    break
                continue
            s = re.sub(r"^(//|/\*+|\*+)\s?", "", s).replace("*/", "").strip()
            if not parts and (not s or s.startswith("eslint") or len(s) <= 8):
                continue
            if not s or (parts and not continues(s)):
                break
            parts.append(s)
            if re.search(r"[.!?]$", s) or len(" ".join(parts)) > SHORT:
                break
        return " ".join(parts)
    if ext in (".py", ".sh", ".ps1", ""):
        block: list[str] = []
        for ln in head.splitlines()[:16]:
            s = ln.strip()
            if s.startswith("#") and not s.startswith("#!"):
                s = s.lstrip("#").strip()
                if block or len(s) > 8:
                    block.append(s)
            elif block:
                break
        return sentence(block)
    if ext == ".md":
        m = (re.search(r"^description:\s*\|?\s*(.+)$", head, re.MULTILINE) or re.match(r"\s*<!--\s*(.+?)\s*-->", head)
             or re.search(r"^#\s+(.+)$", head, re.MULTILINE))
        return m.group(1).strip() if m else ""
    return ""


def bin_index() -> str:
    rows = []
    for name in sorted(os.listdir(os.path.join(ROOT, "bin"))):
        p = os.path.join(ROOT, "bin", name)
        if not os.path.isfile(p) or name == "README.md":
            continue
        kind = "test" if name.startswith("test_") else ("hook" if name.endswith(".ps1") else "tool")
        doc = first_doc(p) or "(BEZ OPISU — dopisz docstring/komentarz naglowkowy)"
        rows.append(f"| `{name}` | {kind} | {short(doc)} |")
    return "\n".join(rows)


# Indeks pojec (2026-10-19, „czy streszczenia nie gubia kontekstu"): WSKAZNIK, nie parafraza. Wiersz mowi, KTORY plik
# jest wlascicielem tematu; regul, progow i liczb nie przepisujemy (kopia dryfuje) — czytaj plik przed decyzja.
INDEX_DIRS = [("hooks", (".js", ".py")), ("hooks/lib", (".js", ".py")), ("git-hooks", ("",)), ("agents", (".md",)), ("pg", (".md",)), ("pg/adr", (".md",))]


def concept_index() -> str:
    out = ["# PG — indeks wlascicieli (generowany)", "",
           "Generowane przez `bin/pg-map.py` z naglowkow plikow — nie edytuj recznie. To WSKAZNIKI: kto jest wlascicielem tematu.",
           "Regul, progow i liczb tu nie ma (parafraza dryfuje) — przed decyzja otworz plik.\nNarzedzia: `bin/README.md`.", ""]
    for d, exts in INDEX_DIRS:
        full = os.path.join(ROOT, d)
        if not os.path.isdir(full):
            continue
        rows = []
        for name in sorted(os.listdir(full)):
            p = os.path.join(full, name)
            if not os.path.isfile(p) or name in ("README.md", "INDEX.md") or os.path.splitext(name)[1] not in exts:
                continue
            doc = first_doc(p) or "(BEZ OPISU — dopisz naglowek)"
            rows.append(f"| `{d}/{name}` | {short(doc)} |")
        if rows:
            out += [f"## {d}/", "", "| Plik | Wlasciciel czego |", "|---|---|", *rows, ""]
    return "\n".join(out)


def render_root() -> str:
    lines = ["# ~/.claude — mapa systemu PG (dla czlowieka)", "",
             "Generowane przez `bin/pg-map.py` z samoopisow plikow — nie edytuj recznie, popraw naglowek pliku i odpal generator.",
             "", "## Od czego zaczac (obcy senior, 15 minut)", ""]
    for rel, why in ENTRY_POINTS:
        lines.append(f"- `{rel}` — {why}")
    lines += ["", "## Jak to jest polaczone (jedna sciezka zmiany)", "",
              "prompt -> `hooks/prompt-guard.js` (protokol) -> edycja -> `hooks/post-edit-check.js` (lint/typy) -> `git commit` -> `git-hooks/pre-commit`",
              "(sekrety, dup-literals, dep-exists, base-check, workflow-lint, ruff/pyright) -> `git push` -> `git-hooks/pre-push` (diff-size, cudza galaz)",
              "-> PR -> CI z `templates/repo/.github/workflows/*` -> `bin/mas_merge_prs.py` (merge tylko na aktualnym merge-ref) -> `bin/wait_prod_multi.py` (dowod z produkcji).",
              "Zakonczenie sesji: `hooks/stop-gate.js` (tier z diffu, T2+ wymaga recenzentow z `agents/` przez skill `pg-review`).",
              "", "## Katalogi", "", "| Katalog | Rola |", "|---|---|"]
    # Bez licznikow plikow (2026-10-04): liczby roznily sie miedzy laptopem i second-machineiem (skille-junctiony, porty),
    # wiec --check byl zawsze czerwony na jednej z maszyn. Mapa opisuje role katalogow, nie ich rozmiar.
    for d, role in SECTIONS:
        lines.append(f"| `{d}/` | {role} |")
    lines += ["", "## Testy systemu (zielone = dowod)", "",
              "`node bin/test_hooks_v3.js` · `node bin/test_slop_gates.js` · `node bin/test_dup_literals.js` · `node bin/pg-rule-coverage.js` · `python hooks/guard_health.py` (odpala wszystkie powyzsze)",
              "", "## Repo", "", "To repo = `<github-owner>/<your-private-pg-repo>` (prywatne). Poza gitem: transkrypty (`projects/`), telemetria (`logs/`), cache, poswiadczenia — patrz `.gitignore` (whitelist).", ""]
    return "\n".join(lines)


# Diagram wpiec w publicznym ARCHITECTURE.md (audyt 2026-10-24: reczny diagram nie znal 4 hookow, 44 commity za kodem).
# Zrodla: settings.json (zywe wpiecia; tylko laptop od 2026-10-04, notatki maszyn (prywatne) — migawka pg/settings-hooks.json z second-machinea nie zna
# SessionEnd/auto-doc, pg-review 1024 ops) + wywolania bin/ w git-hooks/*. Do diagramu ida same nazwy plikow, bez sciezek.
WIRING_DOC = os.path.join("pg", "public", "docs", "ARCHITECTURE.md")
WIRING_START, WIRING_END = "<!-- pg-map:wiring start -->", "<!-- pg-map:wiring end -->"
GIT_HOOKS = ("commit-msg", "pre-commit", "pre-push")
TOOL_RX = re.compile(r"\.claude/bin/([\w-]+\.(?:js|py|sh))")
HOOK_RX = re.compile(r"hooks/([\w.-]+\.(?:js|py))")


def node_id(text: str) -> str:
    return re.sub(r"\W", "_", text)


def render_wiring(root: str | None = None) -> str:
    root = root or ROOT
    with open(os.path.join(root, "settings.json"), encoding="utf-8") as fh:
        hooks = json.load(fh)["hooks"]
    lines = ["```mermaid", "flowchart LR", "  subgraph CC[Claude Code events]"]
    for ev, entries in hooks.items():
        names = list(dict.fromkeys(m for e in entries for h in e.get("hooks", []) for m in HOOK_RX.findall(h.get("command", ""))))
        # Komenda spoza hooks/<x>.js|py = widoczny wezel, nie cicha dziura w diagramie (pg-review 1024 r2 ops).
        lines += [f"    {node_id(ev)}([{ev}]) --> {node_id(ev + '_' + n)}[{n}]" for n in names] or [f"    {node_id(ev)}([{ev}]) --> {node_id(ev)}_unknown[unrecognized hook command]"]
    lines.append("  end")
    lines.append("  subgraph GIT[git hooks, every repo]")
    for gh in GIT_HOOKS:
        path = os.path.join(root, "git-hooks", gh)
        if not os.path.isfile(path):
            continue
        with open(path, encoding="utf-8", errors="replace") as fh:
            tools = list(dict.fromkeys(TOOL_RX.findall(fh.read())))
        lines += [f"    {node_id(gh)}([{gh}]) --> {node_id(gh + '_' + t)}[{t}]" for t in tools] or [f"    {node_id(gh)}([{gh}])"]
    lines += ["  end", "```"]
    return (f"{WIRING_START}\n_Generated by `bin/pg-map.py` from `settings.json` (Claude Code hook wiring) and the `bin/` tools each git hook calls — do not edit by hand. Inline git-hook checks (secret scan, lint, types, workflow lint) are in the map above. Refresh: `python3 bin/pg-map.py`; `guard_health` runs `--check` and goes red on drift._\n\n"
            + "\n".join(lines) + f"\n{WIRING_END}")


def with_wiring(doc: str, block: str) -> str | None:
    """Dokument z podmienionym blokiem miedzy znacznikami; None = brak znacznikow (wtedy --check czerwone)."""
    i, j = doc.find(WIRING_START), doc.find(WIRING_END)
    if i < 0 or j < i:
        return None
    return doc[:i] + block + doc[j + len(WIRING_END):]


def render_bin() -> str:
    return ("# bin/ — indeks narzedzi PG\n\nGenerowane przez `pg-map.py` z pierwszego komentarza/docstringu kazdego pliku. "
            "Wiersz `(BEZ OPISU)` = dlug do splaty w naglowku pliku.\n\n| Plik | Typ | Co robi |\n|---|---|---|\n" + bin_index() + "\n")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()
    # Wiring pierwszy: blad jego zrodla = exit 2, zanim reszta mapy cokolwiek przeczyta.
    wiring_path = os.path.join(ROOT, WIRING_DOC)
    try:
        with open(wiring_path, encoding="utf-8") as fh:
            wired = with_wiring(fh.read(), render_wiring())
    except (OSError, ValueError, KeyError, TypeError, AttributeError) as e:
        # brak pliku albo zly ksztalt JSON = blad narzedzia, nie werdykt (ADR-0008); stdout, bo guard_health czyta ostatnia linie stdout
        msg = f"pg-map: blad narzedzia (wiring): {type(e).__name__}: {e}"
        print(msg)
        print(msg, file=sys.stderr)  # pg-self-check bierze powod ToolError ze stderr
        return 2
    if wired is None:
        # Takze bez --check: bez znacznikow diagram nie powstaje, wiec to nie jest „zapisano” (pg-review 1024 code).
        print(f"pg-map: {WIRING_DOC} bez znacznikow {WIRING_START} / {WIRING_END} — diagram wpiec nie wygenerowany")
        return 1
    targets = {os.path.join(ROOT, "README.md"): render_root(), os.path.join(ROOT, "bin", "README.md"): render_bin(),
               os.path.join(ROOT, "pg", "INDEX.md"): concept_index() + "\n"}
    stale = []
    targets[wiring_path] = wired
    for path, content in targets.items():
        current = None
        if os.path.exists(path):
            with open(path, encoding="utf-8") as fh:
                current = fh.read()
        if current != content:
            stale.append(os.path.relpath(path, ROOT))
            if not args.check:
                with open(path, "w", encoding="utf-8", newline="\n") as fh:
                    fh.write(content)
    missing = bin_index().count("(BEZ OPISU") + concept_index().count("(BEZ OPISU")
    if args.check:
        print(f"pg-map --check: {'NIEAKTUALNE: ' + ', '.join(stale) if stale else 'aktualne'} | narzedzi bez opisu: {missing}")
        return 1 if stale else 0
    print(f"pg-map: zapisano {', '.join(stale) if stale else 'nic (bez zmian)'} | narzedzi bez opisu: {missing}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

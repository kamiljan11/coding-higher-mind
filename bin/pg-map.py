#!/usr/bin/env python3
"""pg-map: mapa systemu PG dla CZLOWIEKA (README.md w ~/.claude i bin/README.md), generowana z plikow (0 tokenow).

Retro 2026-09-12 (pytanie uzytkownika o przekazanie systemu dalej): ~/.claude mial 57 skryptow w bin/ i 15 plikow w pg/
bez zadnego indeksu — maszyna sie w tym porusza, obcy senior nie. Regula: kazde narzedzie opisuje sie SAMO
w pierwszym komentarzu/docstringu; ten skrypt tylko to zbiera. Brak opisu = wiersz "(BEZ OPISU)" — widoczny dlug.

Uzycie: python ~/.claude/bin/pg-map.py [--check]   (--check: exit 1, gdy README sa nieaktualne — do guard_health)
"""
from __future__ import annotations

import argparse
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
        m = re.search(r'"""(.*?)(?:\n\n|""")', head, re.DOTALL)
        if m:
            return m.group(1).strip().splitlines()[0].strip()
    if ext in (".js", ".mjs", ".cjs", ".ts"):
        lines = [ln for ln in head.splitlines() if ln.strip()]
        for ln in lines[:8]:
            s = ln.strip()
            if s.startswith(("//", "/*", "*")):
                s = re.sub(r"^(//|/\*+|\*+)\s?", "", s).strip()
                if s and not s.startswith("eslint") and len(s) > 8:
                    return s
        return ""
    if ext in (".py", ".sh", ".ps1", ""):
        for ln in head.splitlines()[:8]:
            s = ln.strip()
            if s.startswith("#") and not s.startswith("#!"):
                s = s.lstrip("#").strip()
                if len(s) > 8:
                    return s
        return ""
    if ext == ".md":
        m = re.search(r"^description:\s*\|?\s*(.+)$", head, re.MULTILINE)
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
        rows.append(f"| `{name}` | {kind} | {doc[:140]} |")
    return "\n".join(rows)


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
    for d, role in SECTIONS:
        n = 0
        for dp, dns, fns in os.walk(os.path.join(ROOT, d)):
            dns[:] = [x for x in dns if x not in SKIP_DIRS]
            n += len(fns)
        lines.append(f"| `{d}/` ({n} plikow) | {role} |")
    lines += ["", "## Testy systemu (zielone = dowod)", "",
              "`node bin/test_hooks_v3.js` · `node bin/test_slop_gates.js` · `node bin/test_dup_literals.js` · `node bin/pg-rule-coverage.js` · `python hooks/guard_health.py` (odpala wszystkie powyzsze)",
              "", "## Repo", "", "To repo = `<github-owner>/<your-private-pg-repo>` (prywatne). Poza gitem: transkrypty (`projects/`), telemetria (`logs/`), cache, poswiadczenia — patrz `.gitignore` (whitelist).", ""]
    return "\n".join(lines)


def render_bin() -> str:
    return ("# bin/ — indeks narzedzi PG\n\nGenerowane przez `pg-map.py` z pierwszego komentarza/docstringu kazdego pliku. "
            "Wiersz `(BEZ OPISU)` = dlug do splaty w naglowku pliku.\n\n| Plik | Typ | Co robi |\n|---|---|---|\n" + bin_index() + "\n")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()
    targets = {os.path.join(ROOT, "README.md"): render_root(), os.path.join(ROOT, "bin", "README.md"): render_bin()}
    stale = []
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
    missing = bin_index().count("(BEZ OPISU")
    if args.check:
        print(f"pg-map --check: {'NIEAKTUALNE: ' + ', '.join(stale) if stale else 'aktualne'} | narzedzi bez opisu: {missing}")
        return 1 if stale else 0
    print(f"pg-map: zapisano {', '.join(stale) if stale else 'nic (bez zmian)'} | narzedzi bez opisu: {missing}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

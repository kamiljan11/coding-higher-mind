#!/usr/bin/env python3
"""skill-usage: liczy REALNE uzycie skilli i kart pg/*.md z transkryptow Claude Code (0 tokenow, tylko odczyt).

Po co: petla "system poprawia sie z uzycia" potrzebuje odpowiedzi, ktore skille i karty ktos naprawde wywolal,
a ktore tylko leza. Transkrypty (~/.claude/projects/*/*.jsonl) juz zapisuja kazde wywolanie narzedzia Skill i kazdy
Read karty, wiec nie trzeba nowego hooka ani drugiej kopii danych.

Liczy w oknie --days (domyslnie 30) oraz w ostatnich 7 dniach:
- skill: tool_use `Skill` (pole input.skill) oraz komenda uzytkownika `<command-name>/nazwa</command-name>`, gdy nazwa
  to zainstalowany skill albo skill pluginu (`plugin:nazwa`); komendy wbudowane (/clear, /model) nie sa skillami,
- karta: tool_use `Read` pliku <claude>/pg/*.md.
Wynik: JSON na stdout albo do --out; `unused_skills` = skille zainstalowane w <claude>/skills bez uzycia w oknie.
Niczego nie usuwa i niczego nie blokuje: lista jest kandydatem do przegladu, decyzje podejmuje czlowiek.
Exit: 0 = policzone, 2 = blad narzedzia (brak katalogu transkryptow).

Pomysl (liczenie uzycia 7/30 dni i lista kandydatow do wycofania) zaadaptowany z everything-claude-code
(skills/skill-stocktake, commands/skill-health.md, commands/prune.md), MIT, Copyright (c) 2026 Affaan Mustafa.
Kod napisany od zera; roznica: zrodlem sa transkrypty, nie osobny hook obserwujacy (pg/adr/0012).
"""
from __future__ import annotations

import argparse
import collections
import datetime as dt
import glob
import json
import os
import re
import sys

COMMAND_RX = re.compile(r"<command-name>/?([A-Za-z0-9:_-]+)</command-name>")
CARD_RX = re.compile(r"[\\/]\.claude[\\/]pg[\\/]([A-Za-z0-9._-]+\.md)$")
PREFILTER = ('"Skill"', "<command-name>", "/pg/")


def parse_ts(value) -> dt.datetime | None:
    if not isinstance(value, str):
        return None
    try:
        return dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def events_of(record: dict):
    """Zwraca (rodzaj, nazwa, id) dla jednego rekordu transkryptu; id sluzy do odrzucenia powtorzen."""
    message = record.get("message")
    if not isinstance(message, dict):
        return
    content = message.get("content")
    kind = record.get("type")
    if kind == "user":
        text = content if isinstance(content, str) else " ".join(
            part.get("text", "") for part in content if isinstance(part, dict) and part.get("type") == "text"
        ) if isinstance(content, list) else ""
        for match in COMMAND_RX.finditer(text):
            yield "command", match.group(1), None
        return
    if kind != "assistant" or not isinstance(content, list):
        return
    for part in content:
        if not isinstance(part, dict) or part.get("type") != "tool_use":
            continue
        raw = part.get("input")
        args: dict = raw if isinstance(raw, dict) else {}
        skill, file_path = args.get("skill"), args.get("file_path")
        if part.get("name") == "Skill" and isinstance(skill, str):
            yield "skill", skill, part.get("id")
        elif part.get("name") == "Read" and isinstance(file_path, str):
            match = CARD_RX.search(file_path)
            if match:
                yield "card", match.group(1), part.get("id")


def installed_skills(claude_dir: str) -> list[str]:
    return sorted(os.path.basename(os.path.dirname(p)) for p in glob.glob(os.path.join(claude_dir, "skills", "*", "SKILL.md")))


def count(root: str, now: dt.datetime, days: int, installed: set[str]) -> dict:
    cutoff = now - dt.timedelta(days=days)
    week = now - dt.timedelta(days=7)
    stats = {"skill": collections.defaultdict(lambda: {"d7": 0, "window": 0, "last": ""}),
             "card": collections.defaultdict(lambda: {"d7": 0, "window": 0, "last": ""})}
    seen: set[str] = set()
    paths = glob.glob(os.path.join(root, "*", "*.jsonl")) + glob.glob(os.path.join(root, "*", "*", "subagents", "*.jsonl"))
    files = [p for p in paths
             if dt.datetime.fromtimestamp(os.path.getmtime(p), dt.timezone.utc) >= cutoff]
    unreadable = 0
    for path in files:
        try:
            with open(path, encoding="utf-8", errors="replace") as handle:
                for line in handle:
                    if not any(token in line for token in PREFILTER):
                        continue
                    try:
                        record = json.loads(line)
                    except ValueError:
                        continue
                    stamp = parse_ts(record.get("timestamp")) if isinstance(record, dict) else None
                    if stamp is None or stamp < cutoff or stamp > now:
                        continue
                    for kind, name, ident in events_of(record):
                        if kind == "command":
                            if name not in installed and ":" not in name:
                                continue
                            kind = "skill"
                        if ident:
                            if ident in seen:
                                continue
                            seen.add(ident)
                        row = stats[kind][name]
                        row["window"] += 1
                        row["d7"] += 1 if stamp >= week else 0
                        row["last"] = max(row["last"], stamp.date().isoformat())
        except OSError:
            unreadable += 1
    return {"files": len(files), "unreadable": unreadable,
            "skills": dict(sorted(stats["skill"].items(), key=lambda kv: -kv[1]["window"])),
            "cards": dict(sorted(stats["card"].items(), key=lambda kv: -kv[1]["window"]))}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    home = os.path.join(os.path.expanduser("~"), ".claude")
    ap.add_argument("--root", default=os.path.join(home, "projects"), help="katalog transkryptow")
    ap.add_argument("--claude-dir", default=home, help="katalog z skills/ (lista zainstalowanych)")
    ap.add_argument("--days", type=int, default=30)
    ap.add_argument("--now", help="ISO, do testow; domyslnie teraz (UTC)")
    ap.add_argument("--out")
    args = ap.parse_args()
    if not os.path.isdir(args.root):
        print(f"skill-usage: brak katalogu transkryptow: {args.root}", file=sys.stderr)
        return 2
    now = parse_ts(args.now) if args.now else dt.datetime.now(dt.timezone.utc)
    if now is None or args.days < 1:
        print("skill-usage: zly --now albo --days", file=sys.stderr)
        return 2
    if now.tzinfo is None:
        now = now.replace(tzinfo=dt.timezone.utc)
    installed = installed_skills(args.claude_dir)
    result = count(args.root, now, args.days, set(installed))
    used = set(result["skills"])
    result.update({"now": now.isoformat(), "window_days": args.days, "installed_skills": len(installed),
                   "unused_skills": [name for name in installed if name not in used]})
    # Zero zdarzen przy przeczytanych plikach to raczej zmiana formatu transkryptu niz fakt; bez ostrzezenia raport
    # pokazalby "wszystkie skille bez uzycia" (pg-review 2026-11-15 ops). Dalej exit 0: to pomiar, nie werdykt.
    warnings = []
    if result["files"] and not result["skills"] and not result["cards"]:
        warnings.append(f"0 zdarzen w {result['files']} plikach: format transkryptu mogl sie zmienic, lista bez uzycia niewiarygodna")
    if result["unreadable"]:
        warnings.append(f"{result['unreadable']} plikow nieczytelnych: liczniki zanizone")
    result["warnings"] = warnings
    for warning in warnings:
        print(f"skill-usage: UWAGA {warning}", file=sys.stderr)
    text = json.dumps(result, ensure_ascii=False, indent=1)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as handle:
            handle.write(text + "\n")
        print(f"skill-usage: plikow={result['files']} skille_uzyte={len(used)} zainstalowane={len(installed)} "
              f"bez_uzycia={len(result['unused_skills'])} karty={len(result['cards'])} okno={args.days}d "
              f"nieczytelne={result['unreadable']} uwagi={len(warnings)}")
    else:
        print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())

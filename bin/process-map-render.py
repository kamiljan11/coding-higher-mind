"""process-map-render: pg/process-map.json -> pg/process-map.md, one page for a non-technical owner (0 tokens).

The page is a table of stages (when it starts, steps, what guards each step, cost) and, at the end, the counts of holes
and orphans from bin/process-map-lint.py. Deterministic: no dates, sorted output.

Usage: process-map-render.py [--root DIR] [--check]
  default  writes pg/process-map.md
  --check  exit 1 when the committed pg/process-map.md differs from a fresh render (nothing is written)
"""
import argparse
import importlib.util
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
MAP_REL = "pg/process-map.json"
MD_REL = "pg/process-map.md"


def load_lint():
    spec = importlib.util.spec_from_file_location("process_map_lint", os.path.join(HERE, "process-map-lint.py"))
    if spec is None or spec.loader is None:
        raise SystemExit("missing bin/process-map-lint.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def cell(text):
    """Make text safe for one markdown table cell."""
    return str(text).replace("|", "/").replace("\n", " ").strip()


def guard_label(path):
    return "`" + os.path.basename(path) + "`"


def step_guard_cell(n, step):
    parts = []
    guards = step.get("guards") or []
    if guards:
        parts.append(f"{n}. " + ", ".join(guard_label(g) for g in guards))
    reason = (step.get("unguarded_reason") or "").strip()
    if reason:
        label = "Luka" if guards else "Nic nie pilnuje"
        parts.append(f"{n}. **{label}:** {cell(reason)}")
    return "<br>".join(parts)


def render(root):
    with open(os.path.join(root, MAP_REL), encoding="utf-8") as fh:
        data = json.load(fh)
    lint = load_lint()
    rep = lint.analyze(root)
    lines = [
        "# Jak pracujemy z PG: mapa procesu",
        "",
        "Plik generowany z `pg/process-map.json` przez `bin/process-map-render.py`; nie edytuj ręcznie.",
        "Każdy krok ma ochronę (skrypt, hook, karta, recenzent) albo jawne uzasadnienie, że nic go nie pilnuje.",
        "",
        "| Etap | Kiedy się zaczyna | Kroki | Co pilnuje | Koszt |",
        "|---|---|---|---|---|",
    ]
    for stage in data.get("stages", []):
        steps = stage.get("steps") or []
        what = "<br>".join(f"{i}. {cell(s.get('text', ''))}" for i, s in enumerate(steps, 1))
        guards = "<br>".join(step_guard_cell(i, s) for i, s in enumerate(steps, 1))
        costs = "<br>".join(f"{i}. {cell(s.get('cost', ''))}" for i, s in enumerate(steps, 1))
        lines.append(
            f"| **{cell(stage.get('title_pl', ''))}** | {cell(stage.get('starts_when', ''))} | {what} | {guards} | {costs} |"
        )
    n_holes = len(rep["holes"])
    n_orph = len(rep["orphans"])
    lines += [
        "",
        "## Stan mapy",
        "",
        f"- Etapów: {rep['n_stages']}, kroków: {rep['n_steps']}.",
        f"- Dziury (krok bez ochrony i bez uzasadnienia, nieistniejąca ścieżka): {n_holes}.",
        (
            "- Sieroty (pliki systemu, do których żaden krok nie prowadzi; liczone też przez jedno przywołanie "
            f"w pliku z mapy): {n_orph} z {rep.get('scope_total', 0)}."
        ),
    ]
    groups = lint.group_by_dir(rep["orphans"])
    if groups:
        lines.append("- Sieroty wg katalogu: " + ", ".join(f"`{d}/` {len(v)}" for d, v in sorted(groups.items())) + ".")
    lines += ["", "Pełna lista sierot: `python3 bin/process-map-lint.py`. Sieroty nie psują kontroli, to lista do przeglądu.", ""]
    return "\n".join(lines)


def main(argv=None):
    ap = argparse.ArgumentParser(description="Render pg/process-map.md from pg/process-map.json")
    ap.add_argument("--root", default=os.path.join(HERE, ".."))
    ap.add_argument("--check", action="store_true", help="fail when the committed md differs from a fresh render")
    args = ap.parse_args(argv)
    root = os.path.abspath(args.root)
    fresh = render(root)
    target = os.path.join(root, MD_REL)
    if args.check:
        try:
            with open(target, encoding="utf-8") as fh:
                current = fh.read()
        except OSError:
            print(f"STALE {MD_REL} is missing")
            return 1
        if current != fresh:
            print(f"STALE {MD_REL} differs from a fresh render (run bin/process-map-render.py)")
            return 1
        print(f"ok {MD_REL} is current")
        return 0
    with open(target, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(fresh)
    print(f"wrote {MD_REL}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

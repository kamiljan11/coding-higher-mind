"""process-map-lint: pg/process-map.json versus the files that really exist (0 tokens, stdlib only).

Two directions:
  HOLES   (exit 1): stage without steps; step with neither `guards` nor `unguarded_reason`; guard path that does not exist
                    (or escapes the root); committed pg/process-map.md differing from a fresh render.
  ORPHANS (never fail): files of the control plane that no step references. A file also counts as reached when it is
                    named (path or basename) inside a file that a step references directly (one level only; the generated listings
                    pg/INDEX.md and bin/README.md are not used as a source, they name everything).

Scope of the orphan scan: hooks/*.js|*.py, git-hooks/*, bin/* (no test_*, no bin/lib), pg/*.md, agents/*.md,
skills/pg-*/SKILL.md. The generated pg/process-map.md is excluded (it would count itself).

Usage: process-map-lint.py [--root DIR] [--json] [--skip-render-check]
"""
import argparse
import importlib.util
import json
import os
import re
import sys

MAP_REL = "pg/process-map.json"
MD_REL = "pg/process-map.md"
MAX_READ = 2_000_000  # bytes read from one reached file when looking for references
# Generated listings name every file, so they would make every file "reached"; they never act as a transitive source.
INDEX_FILES = frozenset({"pg/INDEX.md", "bin/README.md"})


def scope_files(root):
    """Repo-relative paths of files the orphan scan is about, sorted."""
    out = []

    def add_dir(rel, ok):
        full = os.path.join(root, rel)
        if not os.path.isdir(full):
            return
        for name in sorted(os.listdir(full)):
            if os.path.isfile(os.path.join(full, name)) and ok(name):
                out.append(f"{rel}/{name}")

    add_dir("hooks", lambda n: n.endswith((".js", ".py")))
    add_dir("git-hooks", lambda n: True)
    add_dir("bin", lambda n: not n.startswith("test_"))
    add_dir("pg", lambda n: n.endswith(".md") and f"pg/{n}" != MD_REL)
    add_dir("agents", lambda n: n.endswith(".md"))
    skills = os.path.join(root, "skills")
    if os.path.isdir(skills):
        for name in sorted(os.listdir(skills)):
            if name.startswith("pg-") and os.path.isfile(os.path.join(skills, name, "SKILL.md")):
                out.append(f"skills/{name}/SKILL.md")
    return sorted(out)


def read_text(path):
    try:
        with open(path, encoding="utf-8", errors="replace") as fh:
            return fh.read(MAX_READ)
    except OSError:
        return ""


def analyze(root):
    """Return the full report dict for the map under `root`."""
    holes = []
    path = os.path.join(root, MAP_REL)
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, ValueError) as exc:
        return {"stages": [], "n_stages": 0, "n_steps": 0, "holes": [f"{MAP_REL}: cannot load ({exc})"],
                "orphans": [], "reached_direct": 0, "reached_transitive": 0}
    stages = data.get("stages") if isinstance(data, dict) else None
    if not isinstance(stages, list):
        return {"stages": [], "n_stages": 0, "n_steps": 0, "holes": [f"{MAP_REL}: no `stages` list"],
                "orphans": [], "reached_direct": 0, "reached_transitive": 0}
    n_steps = 0
    direct = set()
    real_root = os.path.realpath(root)
    for si, stage in enumerate(stages):
        sid = stage.get("id") or f"#{si}"
        steps = stage.get("steps") or []
        if not steps:
            holes.append(f"stage {sid}: no steps")
        for ti, step in enumerate(steps, 1):
            n_steps += 1
            where = f"stage {sid} step {ti}"
            guards = step.get("guards") or []
            reason = (step.get("unguarded_reason") or "").strip()
            if not guards and not reason:
                holes.append(f"{where}: neither guards nor unguarded_reason")
            for g in guards:
                full = os.path.realpath(os.path.join(root, g))
                inside = os.path.isabs(g) is False and (full == real_root or full.startswith(real_root + os.sep))
                if not inside or not os.path.exists(full):
                    holes.append(f"{where}: guard path does not exist: {g}")
                else:
                    direct.add(os.path.relpath(full, real_root).replace(os.sep, "/"))
    scope = scope_files(root)
    texts = {}
    for rel in sorted(direct):
        full = os.path.join(root, rel)
        if rel not in INDEX_FILES and os.path.isfile(full):
            texts[rel] = read_text(full)
    transitive = set()
    for cand in scope:
        if cand in direct:
            continue
        base = re.escape(os.path.basename(cand))
        rx = re.compile(r"(?<![A-Za-z0-9_-])(?:" + re.escape(cand) + "|" + base + r")(?![A-Za-z0-9_-])")
        for rel, text in texts.items():
            if rel != cand and rx.search(text):
                transitive.add(cand)
                break
    orphans = [c for c in scope if c not in direct and c not in transitive]
    return {
        "stages": [s.get("id") for s in stages],
        "n_stages": len(stages),
        "n_steps": n_steps,
        "holes": holes,
        "orphans": orphans,
        "reached_direct": len([c for c in scope if c in direct]),
        "reached_transitive": len(transitive),
        "scope_total": len(scope),
    }


def group_by_dir(paths):
    groups = {}
    for p in paths:
        groups.setdefault(os.path.dirname(p) or ".", []).append(os.path.basename(p))
    return groups


def render_stale(root):
    """True when the committed pg/process-map.md differs from a fresh render (or is missing)."""
    here = os.path.dirname(os.path.abspath(__file__))
    spec = importlib.util.spec_from_file_location("process_map_render", os.path.join(here, "process-map-render.py"))
    if spec is None or spec.loader is None:
        return "process-map-render.py not found"
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    fresh = mod.render(root)
    try:
        with open(os.path.join(root, MD_REL), encoding="utf-8") as fh:
            current = fh.read()
    except OSError:
        return f"{MD_REL} is missing (run bin/process-map-render.py)"
    if current != fresh:
        return f"{MD_REL} differs from a fresh render (run bin/process-map-render.py)"
    return ""


def main(argv=None):
    ap = argparse.ArgumentParser(description="Lint pg/process-map.json: holes and orphans")
    ap.add_argument("--root", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
    ap.add_argument("--json", action="store_true", help="machine-readable report")
    ap.add_argument("--skip-render-check", action="store_true", help="do not compare pg/process-map.md with a fresh render")
    args = ap.parse_args(argv)
    root = os.path.abspath(args.root)
    rep = analyze(root)
    if not args.skip_render_check and not rep["holes"]:
        stale = render_stale(root)
        if stale:
            rep["holes"].append(stale)
    if args.json:
        print(json.dumps(rep, ensure_ascii=False, indent=2))
    else:
        print(f"process-map: {rep['n_stages']} stages, {rep['n_steps']} steps, {len(rep['holes'])} holes, "
              f"{len(rep['orphans'])} orphans (of {rep.get('scope_total', 0)} files in scope; "
              f"{rep['reached_direct']} direct, {rep['reached_transitive']} via a reached file)")
        for h in rep["holes"]:
            print(f"HOLE  {h}")
        for d, names in sorted(group_by_dir(rep["orphans"]).items()):
            print(f"ORPHANS {d}/ ({len(names)}): " + ", ".join(names))
    return 1 if rep["holes"] else 0


if __name__ == "__main__":
    sys.exit(main())

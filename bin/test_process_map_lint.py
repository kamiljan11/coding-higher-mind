"""Tests for bin/process-map-lint.py and bin/process-map-render.py on temp-dir fixtures (no real repo files touched)."""
import importlib.util
import io
import json
import os
import sys
import tempfile
from contextlib import redirect_stdout

HERE = os.path.dirname(os.path.abspath(__file__))


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, os.path.join(HERE, filename))
    assert spec is not None and spec.loader is not None, f"missing bin/{filename}"
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


lint = load("process_map_lint", "process-map-lint.py")
render = load("process_map_render", "process-map-render.py")
fails = []


def check(name, ok, detail=None):
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else f" :: {detail!r}"))
    if not ok:
        fails.append(name)


def quiet_lint(root):
    """Exit code of the lint CLI (--json, md freshness skipped) with its output swallowed."""
    with redirect_stdout(io.StringIO()):
        return lint.main(["--root", root, "--skip-render-check", "--json"])


TMP = tempfile.TemporaryDirectory(prefix="process-map-")
COUNTER = [0]


def make_repo(stages, files):
    """Fixture repo: `files` maps repo-relative path -> text; the map is written to pg/process-map.json."""
    COUNTER[0] += 1
    root = os.path.join(TMP.name, f"r{COUNTER[0]}")
    for rel, text in files.items():
        full = os.path.join(root, rel)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "w", encoding="utf-8") as fh:
            fh.write(text)
    os.makedirs(os.path.join(root, "pg"), exist_ok=True)
    with open(os.path.join(root, "pg", "process-map.json"), "w", encoding="utf-8") as fh:
        json.dump({"version": 1, "stages": stages}, fh)
    return root


def stage(steps, sid="s1"):
    return {"id": sid, "title_pl": "Etap", "starts_when": "kiedy", "cost": "0", "steps": steps}


GOOD = {"text": "Krok.", "guards": ["bin/gate.js"], "cost": "0 tokenów"}
BASE_FILES = {"bin/gate.js": "// gate\n"}

# correct entry: no holes, exit 0
root = make_repo([stage([GOOD])], BASE_FILES)
rep = lint.analyze(root)
check("correct entry: no holes", rep["holes"] == [], rep["holes"])
check("correct entry: counts", (rep["n_stages"], rep["n_steps"]) == (1, 1), rep)
check("correct entry: exit 0", quiet_lint(root) == 0)

# step with neither guards nor reason
root = make_repo([stage([{"text": "Goły krok.", "cost": "0"}])], BASE_FILES)
rep = lint.analyze(root)
check("step without guards and reason is a hole", len(rep["holes"]) == 1 and "neither guards" in rep["holes"][0], rep["holes"])
check("hole -> exit 1", quiet_lint(root) == 1)

# explicit reason is enough
root = make_repo([stage([{"text": "Ręcznie.", "unguarded_reason": "nic tego nie pilnuje", "cost": "0"}])], BASE_FILES)
check("unguarded_reason alone is not a hole", lint.analyze(root)["holes"] == [])

# non-existing guard path
root = make_repo([stage([{"text": "Krok.", "guards": ["bin/missing.js"], "cost": "0"}])], BASE_FILES)
rep = lint.analyze(root)
check("non-existing guard path is a hole", any("does not exist: bin/missing.js" in h for h in rep["holes"]), rep["holes"])

# guard escaping the root is a hole even when the target exists
root = make_repo([stage([{"text": "Krok.", "guards": ["../" + os.path.basename(TMP.name)], "cost": "0"}])], BASE_FILES)
check("guard outside the root is a hole", len(lint.analyze(root)["holes"]) == 1)

# stage without steps
root = make_repo([stage([])], BASE_FILES)
check("stage without steps is a hole", any("no steps" in h for h in lint.analyze(root)["holes"]))

# orphans: unreferenced file listed, never fails
files = dict(BASE_FILES)
files.update({"bin/lonely.js": "// nobody\n", "bin/test_x.js": "// test\n", "bin/lib/helper.js": "// lib\n",
              "hooks/h.py": "pass\n", "git-hooks/pre-x": "#!/bin/sh\n", "agents/a.md": "# a\n", "pg/card.md": "# c\n",
              "skills/pg-x/SKILL.md": "# s\n", "skills/other/SKILL.md": "# o\n", "pg/process-map.md": "# generated\n"})
root = make_repo([stage([GOOD])], files)
rep = lint.analyze(root)
check("orphan is listed", "bin/lonely.js" in rep["orphans"], rep["orphans"])
check("all scoped kinds are scanned", {"hooks/h.py", "git-hooks/pre-x", "agents/a.md", "pg/card.md", "skills/pg-x/SKILL.md"} <= set(rep["orphans"]), rep["orphans"])
check("test_*, bin/lib, non-pg skills and the generated md are out of scope",
      not ({"bin/test_x.js", "bin/lib/helper.js", "skills/other/SKILL.md", "pg/process-map.md"} & set(rep["orphans"])), rep["orphans"])
check("orphans alone: exit 0", quiet_lint(root) == 0)

# transitive reach: one level, by basename or by path
files = {"bin/gate.js": "// calls bin/helper-a.js and helper-b.py\n", "bin/helper-a.js": "// a\n", "bin/helper-b.py": "pass\n",
         "bin/deep.js": "// referenced only from helper-a.js\n", "bin/helper-a-extra.js": "// near-name\n"}
files["bin/helper-a.js"] = "// a uses deep.js\n"
root = make_repo([stage([GOOD])], files)
rep = lint.analyze(root)
check("file named inside a reached file is reached", "bin/helper-a.js" not in rep["orphans"] and "bin/helper-b.py" not in rep["orphans"], rep["orphans"])
check("transitive reach stops after one level", "bin/deep.js" in rep["orphans"], rep["orphans"])
check("a longer name is not matched by a shorter basename", "bin/helper-a-extra.js" in rep["orphans"], rep["orphans"])

# generated listings are never a transitive source
files = {"bin/gate.js": "// gate\n", "bin/README.md": "bin/listed.js\n", "bin/listed.js": "// x\n"}
root = make_repo([stage([{"text": "Krok.", "guards": ["bin/README.md"], "cost": "0"}])], files)
check("README listing does not rescue an orphan", "bin/listed.js" in lint.analyze(root)["orphans"])

# render + freshness check
root = make_repo([stage([GOOD])], BASE_FILES)
buf = io.StringIO()
with redirect_stdout(buf):
    rc_missing = lint.main(["--root", root])
check("missing md fails the lint", rc_missing == 1, buf.getvalue())
with redirect_stdout(io.StringIO()):
    rc_write = render.main(["--root", root])
    rc_check = render.main(["--root", root, "--check"])
    rc_lint = lint.main(["--root", root])
check("render writes, --check and lint pass on a fresh md", (rc_write, rc_check, rc_lint) == (0, 0, 0), (rc_write, rc_check, rc_lint))
md_path = os.path.join(root, "pg", "process-map.md")
with open(md_path, "a", encoding="utf-8") as fh:
    fh.write("manual edit\n")
with redirect_stdout(io.StringIO()):
    rc_stale = render.main(["--root", root, "--check"])
    rc_lint_stale = lint.main(["--root", root])
check("a hand-edited md fails --check and the lint", (rc_stale, rc_lint_stale) == (1, 1), (rc_stale, rc_lint_stale))
text = render.render(root)
check("render shows counts and guard basenames", "Dziury" in text and "Sieroty" in text and "`gate.js`" in text, text[-300:])

TMP.cleanup()
if fails:
    print(f"\n{len(fails)} FAILED: {', '.join(fails)}")
    sys.exit(1)
print("\nall ok")

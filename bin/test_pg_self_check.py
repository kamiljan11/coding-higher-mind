"""Testy bin/pg-self-check.py na tymczasowym repo: dobor testow, skladnia, stare odwolania, konsumenci, exit 0/1/2."""
import atexit
import importlib.util
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
TOOL = os.path.join(HERE, "pg-self-check.py")
_TMPS: list[str] = []


def mkdtemp(prefix: str) -> str:
    """Katalog fikstury sprzatany na koncu przebiegu — test jest w baterii guard_health (r13 ops: /tmp rosl co przebieg)."""
    d = tempfile.mkdtemp(prefix=prefix)
    _TMPS.append(d)
    return d


atexit.register(lambda: [shutil.rmtree(d, ignore_errors=True) for d in _TMPS])
fails = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else f" :: {detail[-600:]}"))
    if not ok:
        fails.append(name)


def write(root: str, rel: str, text: str) -> None:
    os.makedirs(os.path.dirname(os.path.join(root, rel)), exist_ok=True)
    with open(os.path.join(root, rel), "w", encoding="utf-8") as fh:
        fh.write(text)


def git(root: str, *args: str) -> None:
    # Repo-fikstura: globalne git-hooki PG (lint, sekrety) nie dotycza plikow testowych w %TEMP%.
    subprocess.run(["git", "-c", "core.hooksPath=/dev/null", "-c", "user.email=t@t", "-c", "user.name=t", *args],
                   cwd=root, check=True, capture_output=True)


def run(root: str, env: dict | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run([sys.executable, TOOL, "--root", root], capture_output=True, text=True, env=env, check=False)


root = mkdtemp(prefix="pg-selfcheck-")
write(root, "bin/foo.js", "const OLD_CONSTANT_X = 1;\nmodule.exports = { OLD_CONSTANT_X };\n")
write(root, "bin/bar.js", "const f = require('./foo.js');\nconsole.log(f);\n")
write(root, "bin/test_foo.js", "const s = require('fs').readFileSync(__dirname + '/foo.js', 'utf8');\n"
      "if (s.includes('BROKEN')) { console.log('FAIL foo zepsute'); process.exit(1); }\nconsole.log('ok foo');\n")
write(root, "docs.md", "Stala `OLD_CONSTANT_X` opisana tutaj.\n")
write(root, "notes.md", "Patrz `bin/bar.js`.\n")
write(root, "index.md", "Lista: `bin/bar.js`.\n")
git(root, "init", "-q")
git(root, "add", ".")
git(root, "commit", "-q", "-m", "init")

write(root, "bin/foo.js", "const NEW_CONSTANT_Y = 1;\nmodule.exports = { NEW_CONSTANT_Y };\n")
write(root, "notes.md", "Nic.\n")
r = run(root)
out = r.stdout + r.stderr
check("zielone: exit 0 + test dotyczacy pliku uruchomiony", r.returncode == 0 and "test bin/test_foo.js: OK" in out, out)
check("stare odwolanie po zmianie nazwy wskazane", "stare odwolanie? OLD_CONSTANT_X" in out and "docs.md" in out, out)
check("konsumenci zmienionego pliku wypisani", "bin/foo.js <- bin/bar.js" in out, out)
check("usunieta wzmianka o ISTNIEJACYM pliku (notes.md -> `bin/bar.js`) to nie stare odwolanie", "stare odwolanie? bin/bar.js" not in out, out)

write(root, "bin/foo.js", "// BROKEN\nconst NEW_CONSTANT_Y = 1;\nmodule.exports = { NEW_CONSTANT_Y };\n")
r = run(root)
out = r.stdout + r.stderr
check("czerwony test konsumenta = exit 1 + RED test", r.returncode == 1 and "RED test bin/test_foo.js" in out, out)

write(root, "bin/foo.js", "const = ;\n")
r = run(root)
out = r.stdout + r.stderr
check("blad skladni = exit 1 + RED skladnia", r.returncode == 1 and "RED skladnia bin/foo.js" in out, out)

r = run(root, env={"PATH": mkdtemp(prefix="pg-nopath-")})
out = r.stdout + r.stderr
check("brak git/node w PATH = exit 2 (blad narzedzia, nie werdykt)", r.returncode == 2 and "blad narzedzia" in out, out)

write(root, "bin/foo.js", "const NEW_CONSTANT_Y = 1;\nmodule.exports = { NEW_CONSTANT_Y };\n")
write(root, "conf.json", "{ zepsuty json")
write(root, "bin/esm.mjs", "export const = 1;\n")
r = run(root)
out = r.stdout + r.stderr
check(".json i .mjs tez sprawdzane skladniowo (r8 ops)", r.returncode == 1 and "RED skladnia conf.json" in out and "RED skladnia bin/esm.mjs" in out, out)

os.remove(os.path.join(root, "conf.json"))
os.remove(os.path.join(root, "bin/esm.mjs"))
os.remove(os.path.join(root, "bin/bar.js"))
write(root, "bin/foo.js", "const OLD_CONSTANT_X = 1;\nmodule.exports = { OLD_CONSTANT_X };\n")
write(root, "bin/uses_bar.js", "// laduje bar.js\n")
git(root, "add", "bin/uses_bar.js")
git(root, "commit", "-q", "-m", "uses bar")
r = run(root)
out = r.stdout + r.stderr
check("usuniety plik nadal wymieniony gdzie indziej = UWAGA (r10 code)", "bar.js (plik usuniety: bin/bar.js) wciaz w: bin/uses_bar.js" in out, out)

nogit = mkdtemp(prefix="pg-selfcheck-nogit-")
os.makedirs(os.path.join(nogit, "bin"))
r = run(nogit)
check("katalog bez gita = exit 2, nie ZIELONE (r7 code)", r.returncode == 2 and "ZIELONE" not in r.stdout, r.stdout + r.stderr)
nobin = mkdtemp(prefix="pg-selfcheck-nobin-")
git(nobin, "init", "-q")
write(nobin, "a.txt", "x\n")
git(nobin, "add", ".")
git(nobin, "commit", "-q", "-m", "init")
r = run(nobin)
check("repo bez bin/ = exit 2 bez tracebacku", r.returncode == 2 and "Traceback" not in r.stderr, r.stdout + r.stderr)

# Skan eksportu publicznego (2026-11-03, incydenty a2e0118, bfb2e7e: /home/<litera>/ w przykladzie): tylko dla wlasnego --root,
# bez zapisu (--check-only) i z --out, ktorego nie ma (eksport odmawia niepustego katalogu).
_spec = importlib.util.spec_from_file_location("pg_self_check", TOOL)
assert _spec is not None and _spec.loader is not None
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)
cmd = _mod.export_check_cmd()
out_dir = cmd[cmd.index("--out") + 1]
check("skan eksportu: --check-only, istniejacy skrypt, --out nie istnieje",
      "--check-only" in cmd and os.path.isfile(cmd[1]) and cmd[1].endswith("pg-export-public.py") and not os.path.exists(out_dir), str(cmd))
names = [n for n, _ in _mod.checks_for(root, True)]
check("wlasny --root: skan eksportu wpiety w checki (obok pg-map i claims)", names == ["pg-map --check", "claims-check", "pg-export-public --check-only"], repr(names))
check("obcy --root: tylko claims-check", [n for n, _ in _mod.checks_for(root, False)] == ["claims-check"])
r = run(root)
check("obcy --root: skan eksportu jawnie pominiety (UWAGA)", "skan eksportu i pieczec pominiete" in r.stdout + r.stderr, r.stdout + r.stderr)

print("TESTY pg-self-check: " + ("wszystkie OK" if not fails else f"{len(fails)} FAIL"))
sys.exit(1 if fails else 0)

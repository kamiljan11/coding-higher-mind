"""Testy bin/skill-usage.py: uzycie skilli i kart liczone z transkryptow, okno czasu, powtorzenia, lista nieuzywanych."""
import atexit
import json
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
TOOL = os.path.join(HERE, "skill-usage.py")
NOW = "2026-11-15T12:00:00+00:00"
_TMPS: list[str] = []
atexit.register(lambda: [shutil.rmtree(d, ignore_errors=True) for d in _TMPS])
fails = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else f" :: {detail}"))
    if not ok:
        fails.append(name)


def tool_use(ts: str, name: str, args: dict, ident: str) -> str:
    return json.dumps({"type": "assistant", "timestamp": ts,
                       "message": {"content": [{"type": "tool_use", "id": ident, "name": name, "input": args}]}})


def user(ts: str, text: str) -> str:
    return json.dumps({"type": "user", "timestamp": ts, "message": {"content": text}})


def make_fixture() -> tuple[str, str]:
    base = tempfile.mkdtemp(prefix="pg-skill-usage-")
    _TMPS.append(base)
    root = os.path.join(base, "projects")
    os.makedirs(os.path.join(root, "proj-a"))
    for skill in ("pg-review", "humanizer", "never-used"):
        os.makedirs(os.path.join(base, "skills", skill))
        with open(os.path.join(base, "skills", skill, "SKILL.md"), "w", encoding="utf-8") as fh:
            fh.write("---\nname: x\n---\n")
    card = "/srv/u/.claude/pg/design.md"
    lines = [
        tool_use("2026-11-14T10:00:00.000Z", "Skill", {"skill": "pg-review"}, "t1"),
        tool_use("2026-11-14T10:00:00.000Z", "Skill", {"skill": "pg-review"}, "t1"),  # ten sam id = powtorzony zapis
        tool_use("2026-10-25T10:00:00.000Z", "Skill", {"skill": "pg-review"}, "t2"),  # w oknie 30 dni, poza 7
        tool_use("2026-09-01T10:00:00.000Z", "Skill", {"skill": "humanizer"}, "t3"),  # poza oknem
        tool_use("2026-11-13T09:00:00.000Z", "Read", {"file_path": card}, "t4"),
        tool_use("2026-11-13T09:05:00.000Z", "Read", {"file_path": "/srv/repo/pg/design.md"}, "t5"),  # nie karta PG
        user("2026-11-12T08:00:00.000Z", "<command-name>/humanizer</command-name> popraw"),
        user("2026-11-12T08:00:30.000Z", "<command-name>/clear</command-name>"),  # komenda wbudowana, nie skill
        user("2026-11-12T08:00:40.000Z", "<command-name>/legal:brief</command-name>"),  # skill pluginu
        tool_use("2026-11-12T08:01:00.000Z", "Skill", {"skill": 7}, "t6"),  # zly typ pola = pominiete
        "{zepsuta linia \"Skill\"",
        json.dumps({"type": "assistant", "message": {"content": [{"type": "tool_use", "id": "t7", "name": "Skill",
                                                                   "input": {"skill": "pg-review"}}]}}),  # bez czasu
    ]
    with open(os.path.join(root, "proj-a", "s1.jsonl"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")
    return base, root


def run(*argv: str) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, TOOL, *argv], capture_output=True, text=True, timeout=60, check=False)


base, root = make_fixture()
proc = run("--root", root, "--claude-dir", base, "--now", NOW)
check("exit 0 na poprawnej fiksturze", proc.returncode == 0, proc.stderr)
out = json.loads(proc.stdout) if proc.returncode == 0 else {}
skills = out.get("skills", {})
check("pg-review: 2 w oknie (powtorzony id liczony raz, wpis bez czasu pominiety)", skills.get("pg-review", {}).get("window") == 2, str(skills))
check("pg-review: 1 w ostatnich 7 dniach", skills.get("pg-review", {}).get("d7") == 1, str(skills))
check("pg-review: ostatnie uzycie 2026-11-14", skills.get("pg-review", {}).get("last") == "2026-11-14", str(skills))
check("komenda uzytkownika liczy sie jako uzycie skilla", skills.get("humanizer", {}).get("window") == 1, str(skills))
check("komenda wbudowana /clear nie jest skillem, skill pluginu jest", "clear" not in skills and skills.get("legal:brief", {}).get("window") == 1, str(skills))
check("karta pg/design.md policzona raz, sciezka spoza ~/.claude/pg nie", out.get("cards") == {"design.md": {"d7": 1, "window": 1, "last": "2026-11-13"}}, str(out.get("cards")))
check("nieuzywany skill na liscie, uzywane nie", out.get("unused_skills") == ["never-used"], str(out.get("unused_skills")))
check("zainstalowane = 3", out.get("installed_skills") == 3, str(out.get("installed_skills")))

proc7 = run("--root", root, "--claude-dir", base, "--now", NOW, "--days", "7")
out7 = json.loads(proc7.stdout) if proc7.returncode == 0 else {}
check("okno 7 dni: pg-review 1", out7.get("skills", {}).get("pg-review", {}).get("window") == 1, str(out7.get("skills")))

missing = run("--root", os.path.join(base, "nie-ma"), "--claude-dir", base)
check("brak katalogu transkryptow = exit 2 (blad narzedzia, nie werdykt)", missing.returncode == 2, str(missing.returncode))
bad = run("--root", root, "--claude-dir", base, "--now", "wczoraj")
check("zly --now = exit 2", bad.returncode == 2, str(bad.returncode))

outfile = os.path.join(base, "usage.json")
written = run("--root", root, "--claude-dir", base, "--now", NOW, "--out", outfile)
check("--out zapisuje JSON i wypisuje jedna linie", written.returncode == 0 and os.path.isfile(outfile)
      and written.stdout.count("\n") == 1 and "bez_uzycia=1" in written.stdout, written.stdout)

check("fikstura ze zdarzeniami: brak ostrzezen", out.get("warnings") == [] and "UWAGA" not in proc.stderr, proc.stderr)

# Subagent: transkrypt w <projekt>/<sesja>/subagents/ tez sie liczy.
os.makedirs(os.path.join(root, "proj-a", "s1", "subagents"))
with open(os.path.join(root, "proj-a", "s1", "subagents", "agent-1.jsonl"), "w", encoding="utf-8") as fh:
    fh.write(tool_use("2026-11-14T11:00:00.000Z", "Skill", {"skill": "humanizer"}, "sub-1") + "\n")
sub = json.loads(run("--root", root, "--claude-dir", base, "--now", NOW).stdout)
check("Skill wywolany przez subagenta jest liczony", sub["skills"].get("humanizer", {}).get("window") == 2, str(sub["skills"]))

# Pliki sa, zdarzen brak (np. zmieniony format transkryptu) = ostrzezenie, nie cicha lista "wszystko bez uzycia".
empty_base = tempfile.mkdtemp(prefix="pg-skill-usage-empty-")
_TMPS.append(empty_base)
os.makedirs(os.path.join(empty_base, "projects", "p"))
with open(os.path.join(empty_base, "projects", "p", "s.jsonl"), "w", encoding="utf-8") as fh:
    fh.write(json.dumps({"kind": "assistant", "ts": "2026-11-14", "calls": [{"tool": "Skill"}]}) + "\n")
silent = run("--root", os.path.join(empty_base, "projects"), "--claude-dir", base, "--now", NOW)
silent_out = json.loads(silent.stdout)
check("0 zdarzen przy przeczytanych plikach: exit 0 + ostrzezenie w JSON i na stderr",
      silent.returncode == 0 and len(silent_out.get("warnings", [])) == 1 and "UWAGA" in silent.stderr, silent.stderr)

print(f"\n{'OK' if not fails else 'FAIL'}: {len(fails)} bledow")
sys.exit(1 if fails else 0)

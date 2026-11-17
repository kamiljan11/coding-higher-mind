"""Tests for bin/ledger-import-devsteer.py: parser on samples, count, restatus on fixtures, seeded faults (rules.md R4)."""
import importlib.util
import json
import subprocess
from collections import Counter
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("ledger_import", HERE / "ledger-import-devsteer.py")
assert _spec is not None and _spec.loader is not None
li = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(li)

HEADER = "| U | Sekcja źródła | Teza (własnymi słowami) | W | Status w PG + dowód | Propozycja | Koszt | WK |\n|---|---|---|---|---|---|---|---|\n"
MODULE = (
    "---\ndate: 2026-10-11\n---\n# 98-M2 - Test\n\nŹródło: (`devsteer-raw/NN.txt`, odczyt 2026-10-12, laptop).\n\n## 21 - Subdomeny\n\n" + HEADER
    + "| U001 | Wstęp | Zapisz klasę modułu. | W | BRAK: `rg -n -i \"klasa modu\\|module class\" pg` = 0 | Z1 | S | nie |\n"
    + "| U002-U004 | Sekcja | Teza z \\| pipe w środku | Ś | CZĘŚCIOWO: `pg/design.md:35` | Z8, Z9 | M | nie |\n"
    + "| U005 | Sekcja | Teza z nieucieczonym | pipe | N | przejście, nic nowego do PG | - | - | - |\n"
    + "\n## 22 - Następna lekcja\n\n" + HEADER
    + "| U001 | Wstęp | Klasyfikujesz znaczenie. | W | MAMY: `pg/x.md:1` | - | - | - |\n"
    + "\n### Ranking wartość / koszt\n\n| Miejsce | Kod | Dlaczego | Koszt |\n|---|---|---|---|\n| 1 | Z8 | a | S |\n| 2 | Z9 | b | S |\n| 3 | Z1 | c | S |\n"
)


@pytest.fixture
def src(tmp_path):
    d = tmp_path / "src"
    d.mkdir()
    (d / "98-M2 - Test.md").write_text(MODULE, encoding="utf-8")
    (d / "98-M0 - Bez tabel.md").write_text("# M0\n| U001 | x | y | W | BRAK | - | - | - |\n", encoding="utf-8")
    return d


def test_parser_fields(src):
    records, files = li.import_all(src)
    assert [f.name for f in files] == ["98-M2 - Test.md"], "M0 has no U tables and is excluded"
    ids = [r["id"] for r in records]
    assert ids == ["M2-L21-U001", "M2-L21-U002-U004", "M2-L21-U005", "M2-L22-U001"]
    r0, r1, r2, r3 = records
    assert r0["weight"] == "W" and r0["status"] == "BRAK" and r0["proposal"] == ["Z1"] and r0["rank"] == 3
    assert r0["instruction"] == "Zapisz klasę modułu." and r3["instruction"] is None
    assert r0["date"] == "2026-10-12" and r0["lesson"] == "21 - Subdomeny" and r0["line"] == 12
    assert r1["thesis"] == "Teza z \\| pipe w środku" and r1["rank"] == 1 and r1["status"] == "CZĘŚCIOWO"
    assert r2["thesis"] == "Teza z nieucieczonym | pipe" and r2["weight"] == "N" and r2["status"] == "unknown"
    assert r3["status"] == "MAMY" and all(r["trigger"] is None and r["place"] is None for r in records)


def test_count_matches_rows(src):
    records, _ = li.import_all(src)
    assert li.check_counts(records, expect=4) == []


def test_seeded_removed_unit_detected(src):
    records, _ = li.import_all(src)
    problems = li.check_counts(records[:-1], expect=4)
    assert any("3 != oczekiwana 4" in p for p in problems)


def test_seeded_duplicate_detected(src):
    records, _ = li.import_all(src)
    problems = li.check_counts(records + [records[0]], expect=5)
    assert any("duplikaty id: M2-L21-U001" in p for p in problems)


def test_seeded_lecture_collision_would_duplicate(src):
    """Without the lecture number both U001 rows collide: the check must catch that class of bug."""
    records, _ = li.import_all(src)
    flattened = [{**r, "id": r["id"].replace("-L21-", "-").replace("-L22-", "-")} for r in records]
    assert li.check_counts(flattened) != []


def test_restatus_unescapes_and_reports_changes(src, tmp_path):
    records, _ = li.import_all(src)
    pg = tmp_path / "pg"
    pg.mkdir()
    (pg / "a.md").write_text("tu jest module class\n", encoding="utf-8")
    rep = li.restatus(records, cwd=tmp_path)
    assert rep["rerun"] == 1 and rep["errors"] == []
    assert rep["changed"][0]["id"] == "M2-L21-U001" and rep["changed"][0]["hits"] == 1


def test_restatus_zero_hits_not_changed(src, tmp_path):
    records, _ = li.import_all(src)
    (tmp_path / "pg").mkdir()
    rep = li.restatus(records, cwd=tmp_path)
    assert rep["rerun"] == 1 and rep["changed"] == []


def test_seeded_restatus_refuses_shell_operators():
    rec = [{"id": "X", "weight": "W", "evidence": "BRAK: `rg -n x pg; rm -rf /` = 0"}]
    calls = []
    rep = li.restatus(rec, cwd=".", runner=lambda *a, **k: calls.append(a))
    assert calls == [] and rep["errors"][0]["error"].startswith("niedozwolona")


def test_restatus_tool_error_is_recorded_not_silent():
    rec = [{"id": "X", "weight": "W", "evidence": "BRAK: `rg -n x pg` = 0"}]

    def boom(*a, **k):
        return subprocess.CompletedProcess(a, 2, "", "regex parse error")

    rep = li.restatus(rec, cwd=".", runner=boom)
    assert rep["changed"] == [] and "rg exit 2" in rep["errors"][0]["error"]


def test_cli_exit_codes(src, tmp_path):
    out = tmp_path / "ledger.jsonl"
    assert li.main(["import", "--src", str(src), "--out", str(out), "--expect", "4"]) == 0
    assert li.main(["import", "--src", str(src), "--out", str(out), "--expect", "5"]) == 1
    assert out.read_text(encoding="utf-8").count('"source": "devsteer"') == 4


def test_apply_verdicts_keeps_snapshot(src):
    records, _ = li.import_all(src)
    n = li.apply_verdicts(records, [{"id": "M2-L21-U001", "new_status": "CZĘŚCIOWO", "evidence": "pg/a.md:1", "reason": "r"}], "2026-11-14")
    assert n == 1 and records[0]["status"] == "CZĘŚCIOWO" and records[0]["status_snapshot"] == "BRAK"
    assert records[0]["restatus"]["evidence"] == "pg/a.md:1"


def test_seeded_apply_rejects_unknown_id_and_bad_status(src):
    records, _ = li.import_all(src)
    with pytest.raises(ValueError, match="nieznanych id"):
        li.apply_verdicts(records, [{"id": "M9-L1-U1", "new_status": "MAMY"}], "d")
    with pytest.raises(ValueError, match="zly new_status"):
        li.apply_verdicts(records, [{"id": "M2-L21-U001", "new_status": "TAK"}], "d")


def test_seeded_rg_pre_and_outside_paths_refused():
    assert li.rg_argv('rg -n --pre=./x.sh "a" pg') is None
    assert li.rg_argv('rg -n "a" /etc') is None
    assert li.rg_argv('rg -n "a" ../other') is None
    assert li.rg_argv('rg -n -i "a\\|b" pg agents') == ["rg", "-n", "-i", "a|b", "pg", "agents"]


def test_reimport_keeps_restatus_and_failed_import_does_not_write(src, tmp_path):
    out = tmp_path / "ledger.jsonl"
    assert li.main(["import", "--src", str(src), "--out", str(out), "--expect", "4"]) == 0
    v = tmp_path / "v.json"
    v.write_text('[{"id": "M2-L21-U001", "new_status": "MAMY", "evidence": "pg/a.md:1"}]', encoding="utf-8")
    assert li.main(["apply", "--ledger", str(out), "--verdicts", str(v), "--date", "2026-11-14"]) == 0
    assert li.main(["import", "--src", str(src), "--out", str(out), "--expect", "4"]) == 0
    r0 = li.load_jsonl(out)[0]
    assert r0["status"] == "MAMY" and r0["status_snapshot"] == "BRAK"
    assert li.main(["import", "--src", str(tmp_path / "missing"), "--out", str(out), "--expect", "4"]) == 1
    assert len(li.load_jsonl(out)) == 4, "failed import must not overwrite the ledger"
    assert r0["file"] == "98-M2 - Test.md", "outside the vault only the file name is stored (no /home path)"


def test_apply_exit_codes_and_second_apply_keeps_first_snapshot(src, tmp_path):
    out = tmp_path / "ledger.jsonl"
    li.main(["import", "--src", str(src), "--out", str(out), "--expect", "4"])
    bad = tmp_path / "bad.json"
    bad.write_text('[{"new_status": "MAMY"}]', encoding="utf-8")
    assert li.main(["apply", "--ledger", str(out), "--verdicts", str(bad)]) == 2
    dup = tmp_path / "dup.json"
    dup.write_text('[{"id": "M2-L21-U001", "new_status": "MAMY"}, {"id": "M2-L21-U001", "new_status": "BRAK"}]', encoding="utf-8")
    before = out.read_text(encoding="utf-8")
    assert li.main(["apply", "--ledger", str(out), "--verdicts", str(dup)]) == 2 and out.read_text(encoding="utf-8") == before
    records = li.load_jsonl(out)
    li.apply_verdicts(records, [{"id": "M2-L21-U001", "new_status": "MAMY"}], "d1")
    li.apply_verdicts(records, [{"id": "M2-L21-U001", "new_status": "CZĘŚCIOWO"}], "d2")
    assert records[0]["status_snapshot"] == "BRAK"


def test_restatus_exit_2_on_tool_errors(tmp_path):
    led = tmp_path / "l.jsonl"
    led.write_text('{"source": "devsteer", "id": "X", "weight": "W", "evidence": "BRAK: `rg -n x pg; ls` = 0"}\n', encoding="utf-8")
    assert li.main(["restatus", "--ledger", str(led), "--cwd", str(tmp_path)]) == 2


def test_seeded_ledger_self_hit_ignored(src, tmp_path):
    records, _ = li.import_all(src)
    (tmp_path / "pg").mkdir()
    (tmp_path / "pg" / "knowledge-ledger.jsonl").write_text('{"evidence": "module class"}\n', encoding="utf-8")
    rep = li.restatus(records, cwd=tmp_path)
    assert rep["changed"] == [], "hits inside the ledger itself are not evidence"


def test_seeded_rg_secret_paths_refused(tmp_path):
    assert li.rg_argv("rg -uu -n accessToken .credentials.json") is None
    assert li.rg_argv("rg -n --hidden accessToken pg/.env") is None
    assert li.rg_argv("rg -n --no-ignore x pg") is None
    assert li.rg_argv("rg -n x node_modules") is None
    assert li.rg_argv("rg -n -i x templates/repo/.github/workflows") is not None
    (tmp_path / "skills").symlink_to("/etc")
    assert li.inside(tmp_path, ["rg", "-n", "x", "skills"]) is False


def test_restatus_runs_rg_without_user_config(src, tmp_path):
    records, _ = li.import_all(src)
    seen = {}

    def fake(argv, **kw):
        seen.update(argv=argv, env=kw.get("env"))
        return subprocess.CompletedProcess(argv, 1, "", "")

    (tmp_path / "pg").mkdir()
    li.restatus(records, cwd=tmp_path, runner=fake)
    assert seen["argv"][:2] == ["rg", "--no-config"] and "RIPGREP_CONFIG_PATH" not in seen["env"]


def test_seeded_frontmatter_date_used_when_no_odczyt(src):
    (src / "98-M3 - Bez odczytu.md").write_text("---\ndate: 2026-10-12\n---\n## 30 - L\n\n" + HEADER
                                              + "| U001 | s | t | W | BRAK | - | - | - |\n", encoding="utf-8")
    records, _ = li.import_all(src)
    assert {r["id"]: r["date"] for r in records}["M3-L30-U001"] == "2026-10-12"
    assert all(r["date"] for r in records), "no record may lose its reading date"


def _ledger_with_restatus(src, tmp_path):
    out = tmp_path / "ledger.jsonl"
    li.main(["import", "--src", str(src), "--out", str(out), "--expect", "4"])
    v = tmp_path / "v.json"
    v.write_text('[{"id": "M2-L21-U001", "new_status": "MAMY", "evidence": "pg/a.md:1"}]', encoding="utf-8")
    assert li.main(["apply", "--ledger", str(out), "--verdicts", str(v), "--date", "2026-11-14"]) == 0
    return out


def test_seeded_edited_thesis_refuses_import_instead_of_losing_restatus(src, tmp_path):
    out = _ledger_with_restatus(src, tmp_path)
    before = out.read_text(encoding="utf-8")
    f = src / "98-M2 - Test.md"
    f.write_text(f.read_text(encoding="utf-8").replace("Zapisz klasę modułu.", "Zapisz klasę modułu (poprawka)."), encoding="utf-8")
    assert li.main(["import", "--src", str(src), "--out", str(out), "--expect", "4"]) == 1
    assert out.read_text(encoding="utf-8") == before, "a dropped restatus must block the write"


def test_seeded_changed_source_status_is_not_overwritten_by_old_restatus(src, tmp_path):
    out = _ledger_with_restatus(src, tmp_path)
    f = src / "98-M2 - Test.md"
    f.write_text(f.read_text(encoding="utf-8").replace("| W | BRAK: `rg", "| W | CZĘŚCIOWO: `rg"), encoding="utf-8")
    records, _ = li.import_all(src)
    carried, dropped = li.carry_restatus(records, li.load_jsonl(out))
    assert carried == 0 and dropped == ["M2-L21-U001"] and records[0]["status"] == "CZĘŚCIOWO"


def test_apply_requires_date_and_keeps_history(src, tmp_path):
    out = _ledger_with_restatus(src, tmp_path)
    v = tmp_path / "v2.json"
    v.write_text('[{"id": "M2-L21-U001", "new_status": "BRAK", "evidence": "b"}]', encoding="utf-8")
    assert li.main(["apply", "--ledger", str(out), "--verdicts", str(v)]) == 2
    assert li.main(["apply", "--ledger", str(out), "--verdicts", str(v), "--date", "2026-11-15"]) == 0
    r0 = li.load_jsonl(out)[0]
    assert r0["status"] == "BRAK" and r0["status_snapshot"] == "BRAK"
    assert r0["restatus_history"] == [{"date": "2026-11-14", "evidence": "pg/a.md:1", "reason": "", "status": "MAMY"}]


def test_seeded_cross_source_id_collision_refused(src, tmp_path):
    out = tmp_path / "ledger.jsonl"
    out.write_text('{"source": "sd-course", "id": "M2-L21-U001"}\n', encoding="utf-8")
    assert li.main(["import", "--src", str(src), "--out", str(out), "--expect", "4"]) == 1
    assert len(li.load_jsonl(out)) == 1


def test_seeded_rg_without_path_or_bad_quote_refused():
    assert li.rg_argv("rg -n --hidden accessToken") is None, "no path = whole cwd incl. dotfiles"
    assert li.rg_argv('rg -n "x pg') is None
    rec = [{"id": "A", "weight": "W", "evidence": 'BRAK: `rg -n "x pg` = 0'},
           {"id": "B", "weight": "W", "evidence": "BRAK: `rg -n zzz pg` = 0"}]
    rep = li.restatus(rec, cwd=".", runner=lambda argv, **k: subprocess.CompletedProcess(argv, 1, "", ""))
    assert rep["rerun"] == 1 and rep["errors"][0]["id"] == "A", "one broken note must not abort the run"


def test_seeded_reimport_keeps_downstream_fields(src, tmp_path):
    out = tmp_path / "ledger.jsonl"
    li.main(["import", "--src", str(src), "--out", str(out), "--expect", "4"])
    rs = li.load_jsonl(out)
    rs[3].update(trigger="przy nowym module", place="pg/design.md", wont=None)
    li.write_atomic(out, rs)
    assert li.main(["import", "--src", str(src), "--out", str(out), "--expect", "4"]) == 0
    r3 = li.load_jsonl(out)[3]
    assert r3["trigger"] == "przy nowym module" and r3["place"] == "pg/design.md" and "wont" in r3
    f = src / "98-M2 - Test.md"
    f.write_text(f.read_text(encoding="utf-8").replace("Klasyfikujesz znaczenie.", "Klasyfikujesz znaczenie!"), encoding="utf-8")
    assert li.main(["import", "--src", str(src), "--out", str(out), "--expect", "4"]) == 1, "edited thesis with trigger = refuse"


def test_seeded_apply_rejects_bad_date(src, tmp_path):
    out = _ledger_with_restatus(src, tmp_path)
    v = tmp_path / "v3.json"
    v.write_text('[{"id": "M2-L21-U001", "new_status": "BRAK"}]', encoding="utf-8")
    for bad in ("d", "2026-13-40", "14.11.2026"):
        assert li.main(["apply", "--ledger", str(out), "--verdicts", str(v), "--date", bad]) == 2


def test_write_atomic_keeps_mode(tmp_path):
    out = tmp_path / "l.jsonl"
    out.write_text("{}\n", encoding="utf-8")
    out.chmod(0o644)
    li.write_atomic(out, [{"a": 1}])
    assert out.stat().st_mode & 0o777 == 0o644 and not list(tmp_path.glob("*.tmp"))


# ---- ledger-import-generic (P9.2): fake quote, duplicate, count mismatch, re-import keeps downstream ----
_gspec = importlib.util.spec_from_file_location("ledger_import_generic", HERE / "ledger-import-generic.py")
assert _gspec is not None and _gspec.loader is not None
lg = importlib.util.module_from_spec(_gspec)
_gspec.loader.exec_module(lg)

CARD = "# Karta\n\nZasada pierwsza: każda decyzja jednokierunkowa dostaje ADR\nzanim powstanie pierwszy kod modułu.\n\nDruga zasada mówi, że kolejka jest potrzebna dopiero przy realnym obciążeniu systemu.\n"


def _gen_env(tmp_path):
    root = tmp_path / "pg"
    (root / "skills/sd").mkdir(parents=True, exist_ok=True)
    (root / "skills/sd/01-test.md").write_text(CARD, encoding="utf-8")
    (root / "pg").mkdir(exist_ok=True)
    ledger = root / "pg/knowledge-ledger.jsonl"
    ledger.write_text(json.dumps({"source": "devsteer", "id": "M1-L10-U001", "thesis": "Inna teza.", "weight": "W"}) + "\n",
                      encoding="utf-8")
    return root, ledger


def _thesis(i, quote, thesis=None, **kw):
    r = {"id": f"sd-course-{i:03d}", "file": "skills/sd/01-test.md", "thesis": thesis or f"Teza {i}.", "quote": quote,
         "weight": "W", "weight_reason": "zmienia decyzje", "status": "MAMY", "evidence": "pg/design.md:1"}
    r.update(kw)
    return r


Q1 = "każda decyzja jednokierunkowa dostaje ADR zanim powstanie pierwszy kod modułu."
Q2 = "Druga zasada mówi, że kolejka jest potrzebna dopiero przy realnym obciążeniu systemu."


def _run_generic(tmp_path, rows, expect=None, root=None, ledger=None):
    if root is None:
        root, ledger = _gen_env(tmp_path)
    inp = tmp_path / "in.jsonl"
    inp.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows), encoding="utf-8")
    rc = lg.main(["--source", "sd-course", "--input", str(inp), "--expect", str(len(rows) if expect is None else expect),
                  "--ledger", str(ledger), "--pg-root", str(root), "--vault", str(tmp_path / "vault"), "--date", "2026-11-14"])
    return rc, root, ledger


def _reported(capsys):
    """Problems printed by the last importer run: a seeded fault must be refused for ITS reason, not any reason."""
    out = [l for l in capsys.readouterr().out.split("\n") if l.strip()]
    return json.loads(out[-1])["first"]


def test_generic_import_ok_line_computed_and_other_sources_kept(tmp_path):
    rc, _, ledger = _run_generic(tmp_path, [_thesis(1, Q1), _thesis(2, Q2)])
    recs = li.load_jsonl(ledger)
    assert rc == 0
    assert [r["source"] for r in recs] == ["devsteer", "sd-course", "sd-course"]
    assert recs[1]["line"] == 3 and recs[2]["line"] == 6  # quote spans a line break: start line counts


def test_generic_seeded_fake_quote_refused_and_not_written(tmp_path, capsys):
    root, ledger = _gen_env(tmp_path)
    before = ledger.read_text(encoding="utf-8")
    rc, _, _ = _run_generic(tmp_path, [_thesis(1, Q1), _thesis(2, "To zdanie nie wystepuje nigdzie w karcie zrodlowej ani w PG.")],
                            root=root, ledger=ledger)
    assert rc == 1 and ledger.read_text(encoding="utf-8") == before
    assert _reported(capsys) == ["sd-course-002: cytat nie wystepuje doslownie w skills/sd/01-test.md"]


def test_generic_seeded_duplicate_thesis_without_duplicate_of_refused(tmp_path, capsys):
    rc, _, _ = _run_generic(tmp_path, [_thesis(1, Q1, thesis="Ta sama teza."), _thesis(2, Q2, thesis="ta  sama teza.")])
    assert rc == 1
    assert _reported(capsys) == ["sd-course-002: duplikat sd-course-001 (ta sama teza albo cytat) bez duplicate_of"]


def test_generic_duplicate_of_existing_id_accepted_unknown_refused(tmp_path, capsys):
    rc, _, _ = _run_generic(tmp_path, [_thesis(1, Q1, thesis="Inna teza.", duplicate_of="M1-L10-U001")])
    assert rc == 0
    rc, _, _ = _run_generic(tmp_path, [_thesis(1, Q1, thesis="Inna teza.", duplicate_of="M9-X")])
    assert rc == 1
    assert _reported(capsys) == ["sd-course-001: duplicate_of=M9-X nie istnieje"]


def test_generic_seeded_count_mismatch_refused(tmp_path, capsys):
    rc, _, ledger = _run_generic(tmp_path, [_thesis(1, Q1)], expect=2)
    assert rc == 1 and all(r["source"] != "sd-course" for r in li.load_jsonl(ledger))
    assert _reported(capsys) == ["wczytane 1 != oczekiwane 2"]


def test_generic_seeded_bad_weight_status_id_and_short_quote_refused(tmp_path, capsys):
    for bad, why in (({"weight": "X"}, "sd-course-001: zla waga 'X'"), ({"status": "TAK"}, "sd-course-001: zly status 'TAK'"),
                     ({"id": "other-001"}, "other-001: id musi zaczynac sie od 'sd-course-'")):
        rc, _, _ = _run_generic(tmp_path, [_thesis(1, Q1, **bad)])
        assert rc == 1, bad
        assert _reported(capsys) == [why]
    rc, _, _ = _run_generic(tmp_path, [_thesis(1, "kolejka jest potrzebna dopiero")])  # verbatim but < 8 words
    assert rc == 1
    assert _reported(capsys) == ["sd-course-001: quote ma 4 slow (wymagane 8-40)"]


def test_generic_seeded_id_collision_with_other_source_refused(tmp_path, capsys):
    root, ledger = _gen_env(tmp_path)
    ledger.write_text(ledger.read_text(encoding="utf-8") + json.dumps({"source": "yt", "id": "sd-course-001", "thesis": "x"}) + "\n",
                      encoding="utf-8")
    rc, _, _ = _run_generic(tmp_path, [_thesis(1, Q1)], root=root, ledger=ledger)
    assert rc == 1
    assert _reported(capsys) == ["duplikat id: sd-course-001"]


def test_generic_reimport_keeps_downstream_and_refuses_losing_it(tmp_path, capsys):
    rc, root, ledger = _run_generic(tmp_path, [_thesis(1, Q1)])
    recs = li.load_jsonl(ledger)
    recs[1]["trigger"] = "pg/design.md:5"
    li.write_atomic(ledger, recs)
    rc, _, _ = _run_generic(tmp_path, [_thesis(1, Q1)], root=root, ledger=ledger)
    assert rc == 0 and li.load_jsonl(ledger)[1]["trigger"] == "pg/design.md:5"
    rc, _, _ = _run_generic(tmp_path, [_thesis(1, Q1, thesis="Zmieniona teza.")], root=root, ledger=ledger)
    assert rc == 1 and li.load_jsonl(ledger)[1]["trigger"] == "pg/design.md:5"
    assert _reported(capsys) == ["sd-course-001: zmieniona teza zgubilaby ['trigger']"]


def test_generic_seeded_absolute_path_and_devsteer_source_refused(tmp_path, capsys):
    rc, _, _ = _run_generic(tmp_path, [_thesis(1, Q1, file="/etc/passwd")])
    assert rc == 1
    assert _reported(capsys) == ["sd-course-001: sciezka bezwzgledna albo z '..' niedozwolona: /etc/passwd"]
    _, ledger = _gen_env(tmp_path)
    inp = tmp_path / "in.jsonl"
    inp.write_text("", encoding="utf-8")
    assert lg.main(["--source", "devsteer", "--input", str(inp), "--expect", "0", "--ledger", str(ledger), "--date", "2026-11-14"]) == 2


def test_generic_seeded_non_object_row_and_general_without_refs_are_tool_errors(tmp_path):
    root, ledger = _gen_env(tmp_path)
    inp = tmp_path / "in.jsonl"
    inp.write_text("[1]\n", encoding="utf-8")
    base = ["--input", str(inp), "--expect", "1", "--ledger", str(ledger), "--pg-root", str(root), "--date", "2026-11-14"]
    assert lg.main(["--source", "sd-course", *base]) == 2
    assert lg.main(["--source", "general", *base]) == 2


def test_generic_seeded_non_string_fields_are_tool_errors_not_tracebacks(tmp_path, capsys):
    for bad in ({"id": 5}, {"thesis": ["a"]}, {"quote": 7}, {"file": {"p": 1}}, {"weight": 1}, {"duplicate_of": 3}):
        rc, _, _ = _run_generic(tmp_path, [{**_thesis(1, Q1), **bad}])
        err = capsys.readouterr().err
        assert rc == 2, bad
        assert "zlym typie JSON" in err and next(iter(bad)) in err, (bad, err)
    root, ledger = _gen_env(tmp_path)
    ledger.write_text(ledger.read_text(encoding="utf-8") + json.dumps({"source": "yt", "id": "yt-001", "quote": 9}) + "\n",
                      encoding="utf-8")
    rc, _, _ = _run_generic(tmp_path, [_thesis(1, Q1)], root=root, ledger=ledger)
    assert rc == 2 and "wiersz rejestru 2" in capsys.readouterr().err


def test_generic_write_error_is_exit_2(tmp_path, monkeypatch):
    def boom(*_a, **_k):
        raise OSError("disk full")
    monkeypatch.setattr(lg.dev, "write_atomic", boom)
    rc, _, _ = _run_generic(tmp_path, [_thesis(1, Q1)])
    assert rc == 2


# --- bin/ledger-check.py (P6.1, P6.7; usage report) -------------------------------------------------------------

_cspec = importlib.util.spec_from_file_location("ledger_check", HERE / "ledger-check.py")
assert _cspec is not None and _cspec.loader is not None
lc = importlib.util.module_from_spec(_cspec)
_cspec.loader.exec_module(lc)

NOW = "2026-11-14T12:00:00+00:00"


def _rec(n, **over):
    base = {"source": "yt", "id": f"yt-{n:03d}", "file": "Knowledge/a.md", "thesis": f"Teza {n}.", "weight": "Ś",
            "status": "BRAK", "evidence": "rg -> 0", "trigger": None, "place": None}
    return {**base, **over}


def _check_env(tmp_path, records, sources=None, notes=("a.md",), events=()):
    """Ledger + vault + PG tree + logs in tmp_path; returns the argv common to every call."""
    vault = tmp_path / "vault"
    (vault / "Knowledge").mkdir(parents=True)
    for name in notes:
        path = vault / "Knowledge" / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("# note\n", encoding="utf-8")
    root = tmp_path / "pg"
    files = {"hooks/stop-gate.js": "require('./lib/called-tool'); // not-called-tool-x\n", "hooks/idle-gate.js": "x\n",
             "hooks/env-gate.js": "x\n", "bin/called-tool.js": "x\n", "bin/quiet-tool.js": "x\n",
             "agents/product-reviewer.md": "x\n", "templates/repo/README.md": "x\n"}
    for rel, text in files.items():
        (root / rel).parent.mkdir(parents=True, exist_ok=True)
        (root / rel).write_text(text, encoding="utf-8")
    ledger = tmp_path / "ledger.jsonl"
    ledger.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in records), encoding="utf-8")
    src = tmp_path / "sources.json"
    if sources is None:  # default: a registry that matches the ledger, so only the seeded defect shows
        sources = {name: {"expect": n} for name, n in Counter(str(r.get("source")) for r in records).items()}
    src.write_text(json.dumps(sources), encoding="utf-8")
    logs = tmp_path / "logs"
    logs.mkdir()
    (logs / "gates.jsonl").write_text("".join(json.dumps(e) + "\n" for e in events), encoding="utf-8")
    return ["--ledger", str(ledger), "--sources", str(src), "--vault", str(vault), "--pg-root", str(root),
            "--logs", str(logs), "--now", NOW, "--json"]


def _check(argv, capsys):
    rc = lc.main(argv)
    return rc, json.loads(capsys.readouterr().out)


def test_check_closed_ledger_is_exit_0(tmp_path, capsys):
    wired = _rec(1, weight="W", status="MAMY", trigger="nowa zaleznosc", place="hooks/stop-gate.js:1")
    refused = _rec(2, weight="W", wont="SWIADOMIE NIE: catfish, skala")
    rc, out = _check(_check_env(tmp_path, [wired, refused, _rec(3)], {"yt": {"expect": 3}}), capsys)
    assert rc == 0, out
    assert (out["total"], out["w_total"], out["w_without_trigger"], out["w_without_status"]) == (3, 2, 0, 0)
    assert out["by_source"] == {"yt": 3} and out["unindexed_files"] == []


def test_check_seeded_w_without_trigger_and_status_counted(tmp_path, capsys):
    only_trigger = _rec(1, weight="W", trigger="x")          # place missing -> not wired
    no_status = _rec(2, weight="W", status="", trigger="x", place="hooks/stop-gate.js:1")
    rc, out = _check(_check_env(tmp_path, [only_trigger, no_status]), capsys)
    assert rc == 1
    assert out["w_without_trigger"] == 1 and out["w_without_status"] == 1


def test_check_seeded_removed_unit_and_duplicate_reported(tmp_path, capsys):
    records = [_rec(1), _rec(2), _rec(2)]                    # yt-003 lost, yt-002 twice
    rc, out = _check(_check_env(tmp_path, records, {"yt": {"expect": 4}}), capsys)
    assert rc == 1
    assert out["duplicates"] == ["yt-002"]
    assert out["count_mismatch"] == [{"source": "yt", "expect": 4, "found": 3}]


def test_check_seeded_dangling_duplicate_of_reported(tmp_path, capsys):
    rc, out = _check(_check_env(tmp_path, [_rec(1, duplicate_of="yt-999")]), capsys)
    assert rc == 1 and out["dangling_duplicate_of"] == ["yt-001"]


def test_check_micro_steps_need_every_key(tmp_path, capsys):
    step = {"n": 1, "action": "Zapisz.", "input": "x", "output": "plik", "verify": "test -s plik", "done_when": "jest"}
    full = _rec(1, weight="W", wont="nie", micro_steps=[step])
    partial = _rec(2, weight="W", wont="nie", micro_steps=[{**step, "verify": " "}])
    _, out = _check(_check_env(tmp_path, [full, partial, _rec(3, weight="W", wont="nie")]), capsys)
    assert out["w_without_micro_steps"] == 2


def test_check_s_without_trigger_is_reported_but_never_blocks(tmp_path, capsys):
    card = _rec(2, card_only="tylko karta, ladowana na zdarzenie: nowa integracja")
    rc, out = _check(_check_env(tmp_path, [_rec(1), card, _rec(3, trigger="t", place="hooks/stop-gate.js:1")]), capsys)
    assert rc == 0
    assert (out["s_total"], out["s_without_trigger"]) == (3, 1)


def test_check_seeded_unindexed_new_file_listed(tmp_path, capsys):
    notes = ("a.md", "new/fresh.md", "How-To/skip.md", "listed.md", "ignored.md")
    argv = _check_env(tmp_path, [_rec(1)], {"yt": {"indexed_files": ["Knowledge/listed.md"]}}, notes=notes)
    vault = Path(argv[argv.index("--vault") + 1])
    (vault / "Knowledge" / "ignored.md").write_text("---\npg-ignore: true\n---\n# x\n", encoding="utf-8")
    rc, out = _check(argv, capsys)
    assert rc == 1
    assert out["unindexed_files"] == ["Knowledge/new/fresh.md"]


def test_check_usage_classes(tmp_path, capsys):
    records = [
        _rec(1, status="MAMY", evidence="bramka `hooks/stop-gate.js:12` blokuje"),             # fired
        _rec(2, status="CZĘŚCIOWO", evidence="narzedzie bin/quiet-tool.js:3 istnieje"),        # unmeasured: no hook calls it
        _rec(3, status="MAMY", evidence="szablon templates/repo/README.md:5"),                  # unmeasured
        _rec(4, status="CZĘŚCIOWO", evidence="tylko zdanie, bez sciezki"),                      # no mechanism
        _rec(5, status="MAMY", evidence="x", mechanism=["agents/product-reviewer.md:23"]),      # fired by role
        _rec(6, status="MAMY", evidence="hooks/nie-ma-takiego.js:1"),                           # cite does not exist
        _rec(7, status="BRAK", evidence="hooks/stop-gate.js:1"),                                # not a used thesis
        _rec(8, status="MAMY", evidence="bin/called-tool.js:4"),                                # fired through its caller
        _rec(9, status="MAMY", evidence="hooks/idle-gate.js:2"),                                # silent: can log, did not
        _rec(10, status="MAMY", evidence="hooks/env-gate.js:2"),                                # skipped only
    ]
    events = [
        {"ts": "2026-11-13T10:00:00Z", "hook": "stop-gate", "event": "ran"},
        {"ts": "2026-11-12T10:00:00Z", "roles": ["product"], "rule_id": "X"},
        {"ts": "2026-11-12T11:00:00Z", "hook": "env-gate", "event": "skipped"},
        {"ts": "2026-11-12T11:00:01Z", "hook": "env-gate", "event": "bypass"},
        {"ts": "2026-09-01T10:00:00Z", "hook": "idle-gate", "event": "ran"},                    # outside the window
    ]
    _, out = _check([*_check_env(tmp_path, records, events=events), "--usage"], capsys)
    u = out["usage"]
    got = {k: u[k] for k in ("theses_used", "with_mechanism", "fired", "fired_inherited", "skipped", "silent",
                             "unmeasured", "unknown", "no_mechanism")}
    assert got == {"theses_used": 9, "with_mechanism": 7, "fired": 3, "fired_inherited": 1, "skipped": 1,
                   "silent": 1, "unmeasured": 2, "unknown": 0, "no_mechanism": 2}
    assert u["silent_mechanisms"] == [{"path": "hooks/idle-gate.js", "theses": 1}]
    assert u["skipped_mechanisms"] == [{"path": "hooks/env-gate.js", "theses": 1}]
    assert u["granularity"] == "file" and u["telemetry"] == "ok" and u["window"]["requested_days"] == 30


def test_check_usage_without_logs_is_unknown_not_silent(tmp_path, capsys):
    records = [_rec(1, status="MAMY", evidence="hooks/stop-gate.js:12"),
               _rec(2, status="MAMY", evidence="templates/repo/README.md:5")]
    _, out = _check([*_check_env(tmp_path, records), "--usage"], capsys)
    u = out["usage"]
    assert (u["telemetry"], u["fired"], u["silent"], u["unknown"], u["unmeasured"]) == ("missing", 0, 0, 1, 1)
    assert u["window"]["covered_days"] == 0.0 and u["window"]["log_first"] is None


def test_check_usage_naive_timestamps_are_read_as_utc(tmp_path, capsys):
    events = [{"ts": "2026-11-13T10:00:00", "hook": "stop-gate", "event": "blocked"},
              {"ts": "2026-11-10T10:00:00Z", "hook": "stop-gate", "event": "ran"}]
    argv = _check_env(tmp_path, [_rec(1, status="MAMY", evidence="hooks/stop-gate.js:12")], events=events)
    rc, out = _check([*argv, "--usage", "--now", "2026-11-14T12:00:00"], capsys)
    assert rc == 0 and out["usage"]["fired"] == 1 and out["usage"]["window"]["covered_days"] == 3.0


def test_check_missing_registry_or_notes_dir_is_exit_2(tmp_path, capsys):
    argv = _check_env(tmp_path, [_rec(1)])
    Path(argv[3]).unlink()
    assert lc.main(argv) == 2 and "brak rejestru zrodel" in capsys.readouterr().err
    Path(argv[3]).write_text(json.dumps({"yt": {"expect": 1}}), encoding="utf-8")
    assert lc.main([*argv[:5], str(tmp_path / "no-vault"), *argv[6:]]) == 2
    assert "brak katalogu notatek" in capsys.readouterr().err


def test_check_unregistered_source_missing_expect_and_bad_weight_block(tmp_path, capsys):
    records = [_rec(1), _rec(2, source="nowe", id="nowe-001"), _rec(3, weight="unknown")]
    rc, out = _check(_check_env(tmp_path, records, {"yt": {"indexed_files": []}}), capsys)
    assert rc == 1
    assert out["unregistered_sources"] == ["nowe"] and out["invalid_weight"] == ["yt-003"]
    assert out["count_mismatch"] == [{"source": "yt", "expect": None, "found": 2}]


def test_check_defaults_do_not_depend_on_cwd(tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    lc.main(["--json", "--vault", str(Path(_check_env(tmp_path, [_rec(1)])[5]))])
    repo_ledger = HERE.parent / "pg" / "knowledge-ledger.jsonl"
    lines = sum(1 for line in repo_ledger.read_text(encoding="utf-8").splitlines() if line.strip())
    assert json.loads(capsys.readouterr().out)["total"] == lines  # the repo ledger, not ./pg/ of the cwd


def test_check_w_pending_counts_as_without_status(tmp_path, capsys):
    rec = _rec(1, weight="W", status="pending", trigger="t", place="hooks/stop-gate.js:1")
    rc, out = _check(_check_env(tmp_path, [rec]), capsys)
    assert rc == 1 and out["w_without_status"] == 1


def test_check_usage_alias_and_stale_logs(tmp_path, capsys):
    records = [_rec(1, status="MAMY", evidence="hooks/bash-rules.js:3"), _rec(2, status="MAMY", evidence="hooks/idle-gate.js:2"),
               _rec(3, status="MAMY", evidence="bin/called-tool.js:1 " + "a/" * 40000)]
    events = [{"ts": "2026-11-13T10:00:00Z", "hook": "bash-guard", "event": "blocked"},
              {"ts": "2026-11-01T10:00:00Z", "hook": "stop-gate", "event": "ran"}]
    argv = _check_env(tmp_path, records, events=events)
    (tmp_path / "pg" / "hooks" / "bash-rules.js").write_text("x\n", encoding="utf-8")
    _, out = _check([*argv, "--usage"], capsys)
    u = out["usage"]  # alias bash-rules -> bash-guard fires; the tool inherits; the long evidence does not hang
    assert (u["fired"], u["fired_inherited"], u["silent"], u["telemetry"]) == (2, 1, 1, "ok")
    _, out = _check([*argv, "--usage", "--now", "2026-11-20T12:00:00+00:00"], capsys)
    u = out["usage"]  # the same logs read a week later: stale, so nothing is called silent or fired
    assert (u["telemetry"], u["silent"], u["fired"], u["unknown"]) == ("stale", 0, 0, 3) and u["window"]["log_age_days"] == 7.1


def test_check_bad_input_is_exit_2(tmp_path, capsys):
    argv = _check_env(tmp_path, [_rec(1)])
    Path(argv[1]).write_text("{not json\n", encoding="utf-8")
    assert lc.main(argv) == 2 and "zly JSON" in capsys.readouterr().err
    Path(argv[1]).write_text("[1]\n", encoding="utf-8")
    assert lc.main(argv) == 2 and "nie jest obiektem" in capsys.readouterr().err
    Path(argv[1]).write_text(json.dumps(_rec(1)) + "\n", encoding="utf-8")
    assert lc.main([*argv, "--usage", "--now", "wczoraj"]) == 2 and "--now" in capsys.readouterr().err


def test_check_text_output_names_the_blocking_number(tmp_path, capsys):
    argv = [a for a in _check_env(tmp_path, [_rec(1, weight="W")]) if a != "--json"]
    assert lc.main([*argv, "--usage"]) == 1
    text = capsys.readouterr().out
    assert "W bez wyzwalacza: 1 / 1" in text and "ziarno: plik mechanizmu" in text


def test_check_usage_skips_telemetry_lines_with_wrong_field_types(tmp_path, capsys):
    events = [{"ts": "2026-11-13T10:00:00Z", "hook": "x", "event": ["ran"]}, {"ts": "2026-11-13T10:00:00Z", "roles": 5},
              {"ts": "2026-11-13T10:00:00Z", "hook": 7, "gate": {"a": 1}, "roles": [3, "product"]},
              {"ts": "2026-11-13T11:00:00Z", "hook": "stop-gate", "event": "ran"}]
    records = [_rec(1, status="MAMY", evidence="hooks/stop-gate.js:12"),
               _rec(2, status="MAMY", evidence="agents/product-reviewer.md:3")]
    rc, out = _check([*_check_env(tmp_path, records, events=events), "--usage"], capsys)
    assert rc == 0 and out["usage"]["fired"] == 2 and out["usage"]["telemetry"] == "ok"


def test_check_ignored_entries_hide_notes_and_are_counted(tmp_path, capsys):
    notes = ("a.md", "private/one.md", "private/deep/two.md", "single.md", "left.md")
    ignored = {"Knowledge/private/": "private life, not PG knowledge", "Knowledge/single.md": "journal"}
    argv = _check_env(tmp_path, [_rec(1)], {"yt": {"expect": 1}, "_ignored": ignored}, notes=notes)
    rc, out = _check(argv, capsys)
    assert rc == 1 and out["unindexed_files"] == ["Knowledge/left.md"]
    assert out["ignored"] == {"Knowledge/private/": 2, "Knowledge/single.md": 1}
    assert out["ignored_stale"] == [] and out["ignored_with_theses"] == []
    assert out["count_mismatch"] == [] and out["unregistered_sources"] == []  # the reserved key is not a source


def test_check_ignored_closes_the_ledger_and_text_names_every_entry(tmp_path, capsys):
    argv = _check_env(tmp_path, [_rec(1)], {"yt": {"expect": 1}, "_ignored": {"Knowledge/private/": "private"}},
                      notes=("a.md", "private/one.md"))
    assert lc.main([a for a in argv if a != "--json"]) == 0
    text = capsys.readouterr().out
    assert "wylaczone (_ignored): 1 notatek w 1 wpisach" in text and "  - Knowledge/private/: 1" in text


def test_check_seeded_ignored_without_reason_or_outside_notes_is_exit_2(tmp_path, capsys):
    for bad in ({"Knowledge/private/": ""}, {"Knowledge/private/": None}, {"Other/x.md": "reason"}):
        argv = _check_env(tmp_path / str(len(str(bad))), [_rec(1)], {"yt": {"expect": 1}, "_ignored": bad})
        assert lc.main(argv) == 2
        assert "bez powodu albo spoza Knowledge/" in capsys.readouterr().err


def test_check_seeded_stale_ignored_entry_is_reported_but_does_not_block(tmp_path, capsys):
    ignored = {"Knowledge/gone/": "old folder", "Knowledge/private": "no trailing slash = a note name, not a folder"}
    argv = _check_env(tmp_path, [_rec(1)], {"yt": {"expect": 1}, "_ignored": ignored}, notes=("a.md", "private/one.md"))
    rc, out = _check(argv, capsys)
    assert out["ignored_stale"] == ["Knowledge/gone/", "Knowledge/private"]
    assert rc == 1 and out["unindexed_files"] == ["Knowledge/private/one.md"]  # blocked by the note, not the entry


def test_check_seeded_ignored_note_with_theses_blocks(tmp_path, capsys):
    argv = _check_env(tmp_path, [_rec(1)], {"yt": {"expect": 1}, "_ignored": {"Knowledge/a.md": "not knowledge"}})
    rc, out = _check(argv, capsys)
    assert rc == 1 and out["ignored_with_theses"] == ["Knowledge/a.md"] and out["unindexed_files"] == []


def test_check_seeded_prefix_does_not_swallow_sibling_folder(tmp_path, capsys):
    argv = _check_env(tmp_path, [_rec(1)], {"yt": {"expect": 1}, "_ignored": {"Knowledge/priv/": "private"}},
                      notes=("a.md", "priv/x.md", "private/y.md"))
    rc, out = _check(argv, capsys)
    assert rc == 1 and out["ignored"] == {"Knowledge/priv/": 1}
    assert out["unindexed_files"] == ["Knowledge/private/y.md"]


# --- bin/ledger-trend.py (E9: periodic measurement compared with the previous one) -------------------------------

_tspec = importlib.util.spec_from_file_location("ledger_trend", HERE / "ledger-trend.py")
assert _tspec is not None and _tspec.loader is not None
lt = importlib.util.module_from_spec(_tspec)
_tspec.loader.exec_module(lt)

FIRED = [{"ts": "2026-11-13T10:00:00Z", "hook": "stop-gate", "event": "ran"},
         {"ts": "2026-11-13T10:00:00Z", "hook": "idle-gate", "event": "ran"}]
TREND_RECORDS = [{"status": "MAMY", "evidence": "hooks/stop-gate.js:1"}, {"status": "MAMY", "evidence": "hooks/idle-gate.js:1"}]


def _trend_env(tmp_path, events=FIRED):
    """A closed ledger whose two mechanisms both fired; returns (argv for ledger-trend, history path)."""
    records = [_rec(n, **over) for n, over in enumerate(TREND_RECORDS, 1)]
    argv = [a for a in _check_env(tmp_path, records, events=events) if a != "--json"]
    history = tmp_path / "history" / "trend.jsonl"
    return [*argv, "--history", str(history)], history


def _trend(argv, capsys):
    rc = lt.main([*argv, "--json"])
    return rc, json.loads(capsys.readouterr().out)


def _set(argv, flag, value):
    return [value if i and argv[i - 1] == flag else a for i, a in enumerate(argv)]


def test_trend_first_run_writes_baseline_and_second_run_reports_no_change(tmp_path, capsys):
    argv, history = _trend_env(tmp_path)
    rc, out = _trend(argv, capsys)
    assert rc == 0 and out["baseline"] is True and out["worse"] == {}
    assert out["snapshot"]["usage"]["fired"] == 2 and out["snapshot"]["silent_mechanisms"] == []
    rc, out = _trend(argv, capsys)
    assert rc == 0 and out["baseline"] is False and out["worse"] == {} and out["previous_ts"] == NOW
    assert len(history.read_text(encoding="utf-8").splitlines()) == 2
    assert lt.main(argv) == 0 and "bez pogorszenia wzgledem" in capsys.readouterr().out


def test_trend_seeded_mechanism_that_stops_firing_is_reported(tmp_path, capsys):
    argv, _ = _trend_env(tmp_path)
    _trend(argv, capsys)
    logs = Path(argv[argv.index("--logs") + 1]) / "gates.jsonl"
    logs.write_text(json.dumps(FIRED[0]) + "\n", encoding="utf-8")  # idle-gate no longer leaves a trace
    rc, out = _trend(argv, capsys)
    assert rc == 1 and out["worse"] == {"went_silent": ["hooks/idle-gate.js"]}
    rc, out = _trend(argv, capsys)  # already silent in the previous snapshot: reported once, not every week
    assert rc == 0 and out["worse"] == {}


def test_trend_seeded_new_unindexed_note_and_lost_thesis_are_reported(tmp_path, capsys):
    argv, _ = _trend_env(tmp_path)
    _trend(argv, capsys)
    vault = Path(argv[argv.index("--vault") + 1])
    (vault / "Knowledge" / "new.md").write_text("# nobody indexed me\n", encoding="utf-8")
    ledger = Path(argv[argv.index("--ledger") + 1])
    ledger.write_text(ledger.read_text(encoding="utf-8").splitlines()[0] + "\n", encoding="utf-8")
    rc, out = _trend(argv, capsys)
    assert rc == 1 and out["worse"]["theses_lost"] == {"yt": [2, 1]}
    assert out["worse"]["gaps_grew"] == {"unindexed_files": [0, 1], "count_mismatch": [0, 1]}
    assert lt.main([*argv, "--dry-run"]) == 0  # the worse state is the new reference; text mode, nothing appended
    assert "bez pogorszenia" in capsys.readouterr().out


def test_trend_stale_telemetry_is_reported_instead_of_silence(tmp_path, capsys):
    argv, _ = _trend_env(tmp_path)
    _trend(argv, capsys)
    late = _set(argv, "--now", "2026-11-25T12:00:00+00:00")
    rc, out = _trend(late, capsys)
    assert rc == 1 and out["worse"] == {"telemetry": "stale"}  # no went_silent: usage was not measured at all
    assert lt.main(late) == 1 and "uzycia nie da sie zmierzyc" in capsys.readouterr().out


def test_trend_dry_run_writes_nothing_and_torn_history_line_is_skipped(tmp_path, capsys):
    argv, history = _trend_env(tmp_path)
    rc, out = _trend([*argv, "--dry-run"], capsys)
    assert rc == 0 and out["baseline"] is True and not history.exists()
    _trend(argv, capsys)
    with history.open("a", encoding="utf-8") as fh:
        fh.write('{"ts": "torn\n[1, 2]\n' + json.dumps({"gaps": {}, "usage": {}}) + "\n")  # torn, not a dict, old shape
    rc, out = _trend(argv, capsys)
    assert rc == 0 and out["baseline"] is False and out["previous_ts"] == NOW


def test_trend_failing_measurement_is_exit_2_and_appends_nothing(tmp_path, capsys):
    argv, history = _trend_env(tmp_path)
    Path(argv[argv.index("--sources") + 1]).write_text("{not json\n", encoding="utf-8")
    assert lt.main(argv) == 2
    assert "ledger-check exit 2" in capsys.readouterr().err and not history.exists()


def test_trend_tracks_every_closure_number_of_ledger_check():
    assert lt.GAP_KEYS == lc.GAP_KEYS  # a key added only to ledger-check would silently drop out of the trend


def test_trend_measurement_that_hangs_is_exit_2(tmp_path, capsys, monkeypatch):
    argv, history = _trend_env(tmp_path)

    def hang(cmd, **kwargs):
        raise subprocess.TimeoutExpired(cmd, kwargs["timeout"])

    monkeypatch.setattr(lt.subprocess, "run", hang)
    assert lt.main(argv) == 2
    assert "did not finish in 300 s" in capsys.readouterr().err and not history.exists()

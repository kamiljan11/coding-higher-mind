"""Tests for bin/ack-check.py ledger mode (rules.md R2, R4 seeded faults). Playbook-ack mode arrives with P11."""
import importlib.util
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("ack_check", HERE / "ack-check.py")
assert _spec is not None and _spec.loader is not None
ac = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(ac)

TEXT = "# Karta\n\nPierwsza linia.\nKażdy moduł ma jednego właściciela tabel i nikt inny\nnie pisze do jego tabel bezpośrednio.\n"
QUOTE = "Każdy moduł ma jednego właściciela tabel i nikt inny nie pisze do jego tabel bezpośrednio."


def _env(tmp_path, **kw):
    (tmp_path / "pg/skills").mkdir(parents=True, exist_ok=True)
    (tmp_path / "pg/skills/k.md").write_text(TEXT, encoding="utf-8")
    rec = {"source": "sd-course", "id": "sd-course-001", "file": "skills/k.md", "line": 4, "quote": QUOTE}
    rec.update(kw)
    return [rec]


def _check(tmp_path, records, source="sd-course", refs=None):
    return ac.check_records(records, source, tmp_path / "vault", tmp_path / "pg", refs)


def test_ok_quote_across_line_break(tmp_path):
    assert _check(tmp_path, _env(tmp_path)) == []


def test_seeded_fake_quote_detected(tmp_path):
    assert _check(tmp_path, _env(tmp_path, quote="Każdy moduł ma dwóch właścicieli tabel i każdy może pisać do nich.")) == [
        "sd-course-001: cytat nie wystepuje doslownie w skills/k.md"]


def test_seeded_missing_quote_and_no_records_detected(tmp_path):
    assert _check(tmp_path, _env(tmp_path, quote=None)) == ["sd-course-001: brak quote"]
    assert _check(tmp_path, _env(tmp_path), source="yt") == ["brak rekordow zrodla yt"]


def test_seeded_wrong_line_detected(tmp_path):
    assert _check(tmp_path, _env(tmp_path, line=2)) == ["sd-course-001: line=2, a cytat zaczyna sie w linii 4"]


def test_seeded_quote_reused_by_other_source_detected(tmp_path):
    recs = _env(tmp_path) + [{"source": "yt", "id": "yt-001", "file": "skills/k.md", "quote": QUOTE}]
    assert any("roznych zrodlach" in p for p in _check(tmp_path, recs))


def test_seeded_path_escape_and_missing_file_detected(tmp_path):
    assert _check(tmp_path, _env(tmp_path, file="../etc/passwd")) == [
        "sd-course-001: sciezka bezwzgledna albo z '..' niedozwolona: ../etc/passwd"]
    missing = _check(tmp_path, _env(tmp_path, file="skills/none.md"))
    assert len(missing) == 1 and missing[0].startswith("sd-course-001: plik zrodla nie istnieje:")


def test_general_uses_refs_dir(tmp_path):
    refs = tmp_path / "refs"
    refs.mkdir()
    rec = [{"source": "general", "id": "general-001", "file": "https://example.org", "quote": QUOTE}]
    no_ref = _check(tmp_path, rec, "general", refs)  # no ref file yet
    assert len(no_ref) == 1 and no_ref[0].startswith("general-001: plik zrodla nie istnieje:")
    (refs / "general-001.txt").write_text("URL: https://example.org\n" + QUOTE + "\n", encoding="utf-8")
    assert _check(tmp_path, rec, "general", refs) == []


def test_cli_exit_codes(tmp_path):
    led = tmp_path / "l.jsonl"
    led.write_text(json.dumps(_env(tmp_path)[0], ensure_ascii=False) + "\n", encoding="utf-8")
    base = ["--ledger", str(led), "--pg-root", str(tmp_path / "pg"), "--vault", str(tmp_path / "v")]
    assert ac.main(["--ledger-source", "sd-course", *base]) == 0
    assert ac.main(["--ledger-source", "arc42", *base]) == 1
    assert ac.main(["--ledger-source", "sd-course", "--ledger", str(tmp_path / "none.jsonl")]) == 2


def test_seeded_non_object_ledger_row_is_tool_error(tmp_path):
    led = tmp_path / "l.jsonl"
    led.write_text("[1]\n", encoding="utf-8")
    assert ac.main(["--ledger-source", "sd-course", "--ledger", str(led)]) == 2


def test_seeded_non_string_fields_are_tool_errors(tmp_path, capsys):
    led = tmp_path / "l.jsonl"
    base = ["--ledger", str(led), "--pg-root", str(tmp_path / "pg"), "--vault", str(tmp_path / "v")]
    for bad in ({"id": 5}, {"file": 3}, {"quote": ["x"]}, {"line": "4"}, {"line": True}):
        led.write_text(json.dumps(_env(tmp_path, **bad)[0], ensure_ascii=False) + "\n", encoding="utf-8")
        assert ac.main(["--ledger-source", "sd-course", *base]) == 2, bad
        err = capsys.readouterr().err
        assert "zlym typie JSON" in err and next(iter(bad)) in err, (bad, err)
    assert ac.type_errors(_env(tmp_path)) == []

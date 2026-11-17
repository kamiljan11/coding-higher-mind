"""Tests for bin/ledger-trigger-fill.py: trigger fill from evidence cites, unknown -> NIE DOTYCZY, idempotence, seeded faults."""
import importlib.util
import json
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("ledger_trigger_fill", HERE / "ledger-trigger-fill.py")
assert _spec is not None and _spec.loader is not None
tf = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(tf)


def rec(rid, status, evidence, **extra):
    return {"id": rid, "weight": "W", "status": status, "evidence": evidence, "trigger": None, "place": None, **extra}


@pytest.fixture
def root(tmp_path):
    for rel in ("hooks/guard.js", "bin/tool.py", "agents/x-reviewer.md", "pg/design.md",
                "git-hooks/pre-commit", "templates/repo/.github/workflows/quality.yml"):
        path = tmp_path / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("x\n", encoding="utf-8")
    return tmp_path


def test_first_existing_mechanism_wins(root):
    r = rec("a", "MAMY", "pg/design.md:3 i `hooks/missing.js` i `bin/tool.py:9` i `hooks/guard.js`")
    stats, _ = tf.fill([r], root)
    assert r["trigger"] == "bin/tool.py" and stats["trigger_set"] == 1


@pytest.mark.parametrize("cite,expected", [
    ("`agents/x-reviewer.md:1`", "agents/x-reviewer.md"),
    ("`git-hooks/pre-commit`", "git-hooks/pre-commit"),
    ("`~/.claude/hooks/guard.js:5`", "hooks/guard.js"),
    ("`.github/workflows/quality.yml`", "templates/repo/.github/workflows/quality.yml"),
])
def test_mechanism_kinds(root, cite, expected):
    r = rec("a", "CZĘŚCIOWO", f"CZĘŚCIOWO: {cite}")
    tf.fill([r], root)
    assert r["trigger"] == expected


def test_seeded_nonexistent_file_never_becomes_trigger(root):
    r = rec("a", "MAMY", "`hooks/ghost.js:1`, `bin/ghost.py`")
    stats, _ = tf.fill([r], root)
    assert r["trigger"] is None and stats["used_without_trigger"] == 1


def test_non_mechanism_files_and_other_statuses_untouched(root):
    only_card = rec("a", "MAMY", "`pg/design.md:3`")
    brak = rec("b", "BRAK", "`bin/tool.py`")
    nd = rec("c", "NIE DOTYCZY", "`bin/tool.py`")
    tf.fill([only_card, brak, nd], root)
    assert only_card["trigger"] is None and brak["trigger"] is None and nd["trigger"] is None


def test_existing_trigger_not_overwritten_and_idempotent(root):
    kept = rec("a", "MAMY", "`bin/tool.py`", trigger="hooks/guard.js")
    fresh = rec("b", "MAMY", "`bin/tool.py`")
    records = [kept, fresh]
    tf.fill(records, root)
    snapshot = json.dumps(records, sort_keys=True)
    stats, _ = tf.fill(records, root)
    assert kept["trigger"] == "hooks/guard.js" and fresh["trigger"] == "bin/tool.py"
    assert json.dumps(records, sort_keys=True) == snapshot and stats["trigger_set"] == 0


@pytest.mark.parametrize("evidence", ["podsumowanie sekcji, nic nowego do PG", "N, przejście", "słownik, nic do PG"])
def test_unknown_with_nothing_new_becomes_nd(root, evidence):
    r = rec("a", "unknown", evidence)
    stats, left = tf.fill([r], root)
    assert r["status"] == "NIE DOTYCZY" and stats["nd_set"] == 1 and left == []


@pytest.mark.parametrize("evidence", [
    "N, przykład", "jak wyżej", "Operacje: CZĘŚCIOWO. Organizacja: NIE DOTYCZY.", "BRAK, nic do PG, ale rg = 0", ""])
def test_unknown_without_explicit_nothing_new_stays(root, evidence):
    r = rec("a", "unknown", evidence)
    stats, left = tf.fill([r], root)
    assert r["status"] == "unknown" and stats["unknown_left"] == 1 and left[0][0] is r and left[0][1]


def test_main_check_writes_nothing_and_write_is_stable(root, capsys):
    ledger = root / "pg" / "knowledge-ledger.jsonl"
    rows = [rec("a", "MAMY", "`bin/tool.py`"), rec("b", "unknown", "nic nowego")]
    original = "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows)
    ledger.write_text(original, encoding="utf-8")
    assert tf.main(["--check", "--pg-root", str(root)]) == 0
    assert ledger.read_text(encoding="utf-8") == original
    assert tf.main(["--pg-root", str(root)]) == 0
    written = ledger.read_text(encoding="utf-8")
    out = [json.loads(line) for line in written.splitlines()]
    assert out[0]["trigger"] == "bin/tool.py" and out[1]["status"] == "NIE DOTYCZY"
    assert tf.main(["--pg-root", str(root)]) == 0 and ledger.read_text(encoding="utf-8") == written
    printed = capsys.readouterr().out
    assert "w_with_trigger: 1" in printed
    assert "w_wired_for_closure: 0" in printed  # trigger without place is not closed for ledger-check


def test_missing_ledger_is_exit_2(root):
    assert tf.main(["--pg-root", str(root)]) == 2

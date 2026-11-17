"""Tests for bin/ledger-search.py: ranking, exclusions, 5-letter prefix match, usage log, --unused, seeded faults."""
import importlib.util
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("ledger_search", HERE / "ledger-search.py")
assert _spec is not None and _spec.loader is not None
ls = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(ls)


def rec(rid, thesis, status="MAMY", weight="W", **extra):
    return {"id": rid, "weight": weight, "status": status, "thesis": thesis, "detail": "", "lesson": "",
            "quote": None, "evidence": "", "trigger": None, "duplicate_of": None, **extra}


@pytest.fixture
def pg_root(tmp_path):
    (tmp_path / "hooks").mkdir()
    (tmp_path / "hooks" / "guard.js").write_text("x\n", encoding="utf-8")
    return tmp_path


@pytest.fixture
def log(tmp_path, monkeypatch):
    path = tmp_path / "logs" / "usage.jsonl"
    monkeypatch.setenv(ls.LOG_ENV, str(path))
    return path


def ids(results):
    return [r["id"] for r in results]


def test_excludes_duplicates_nd_and_non_w(pg_root):
    records = [
        rec("ok", "Idempotencja webhooka płatności"),
        rec("dup", "Idempotencja webhooka płatności", duplicate_of="ok"),
        rec("nd", "Idempotencja webhooka płatności", status="NIE DOTYCZY"),
        rec("s", "Idempotencja webhooka płatności", weight="Ś"),
    ]
    assert ids(ls.search(records, "idempotencja webhook", pg_root)) == ["ok"]


def test_polish_prefix_matching(pg_root):
    records = [rec("a", "Webhooki płatności muszą być idempotentne"), rec("b", "Zupełnie inny temat")]
    assert ids(ls.search(records, "webhooka", pg_root)) == ["a"]
    assert ids(ls.search(records, "PŁATNOŚCIOWY", pg_root)) == ["a"]


def test_more_distinct_words_rank_first_then_field_weight(pg_root):
    records = [
        rec("one", "idempotencja idempotencja idempotencja"),
        rec("two", "idempotencja webhooka"),
        rec("quote-only", "x", quote="webhooka"),
        rec("thesis", "webhooka"),
    ]
    assert ids(ls.search(records, "idempotencja webhooka", pg_root)) == ["two", "one", "thesis", "quote-only"]


def test_limit_and_empty_query(pg_root):
    records = [rec(f"r{i}", "webhook") for i in range(12)]
    assert len(ls.search(records, "webhook", pg_root)) == 8
    assert len(ls.search(records, "webhook", pg_root, limit=3)) == 3
    assert ls.search(records, "  ", pg_root) == []
    assert ls.search(records, "kiedy czy", pg_root) == [], "stopwords alone must not match"


def test_mechanism_trigger_then_cited_file_then_none(pg_root):
    records = [
        rec("t", "webhook", trigger="bin/x.py"),
        rec("c", "webhook", evidence="`hooks/guard.js:4`"),
        rec("n", "webhook", status="BRAK", evidence="`hooks/guard.js:4` = 0"),
        rec("g", "webhook", evidence="`hooks/ghost.js:4`"),
    ]
    got = {r["id"]: r["mechanism"] for r in ls.search(records, "webhook", pg_root)}
    assert got == {"t": "bin/x.py", "c": "hooks/guard.js", "n": ls.NO_MECHANISM, "g": ls.NO_MECHANISM}


def test_quote_is_one_line_and_truncated(pg_root):
    records = [rec("a", "webhook", quote="line one\nline two " + "x" * 300)]
    quote = ls.search(records, "webhook", pg_root)[0]["quote"]
    assert "\n" not in quote and len(quote) <= ls.QUOTE_CHARS and quote.endswith("...")


def write_ledger(root, records):
    (root / "pg").mkdir(exist_ok=True)
    (root / "pg" / "knowledge-ledger.jsonl").write_text(
        "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in records), encoding="utf-8")


def test_main_appends_one_log_line_per_call(pg_root, log, capsys):
    write_ledger(pg_root, [rec("a", "idempotencja webhooka"), rec("dup", "idempotencja webhooka", duplicate_of="a")])
    assert ls.main(["idempotencja", "--pg-root", str(pg_root)]) == 0
    assert ls.main(["nic takiego", "--pg-root", str(pg_root), "--json"]) == 0
    lines = [json.loads(x) for x in log.read_text(encoding="utf-8").splitlines()]
    assert [x["n_results"] for x in lines] == [1, 0]
    assert lines[0]["ids"] == ["a"] and lines[0]["query"] == "idempotencja" and lines[0]["ts"].endswith("Z")
    assert "mechanism: brak mechanizmu" in capsys.readouterr().out.split("[]")[0]


def test_json_output_and_explicit_log_overrides_env(pg_root, log, tmp_path, capsys):
    write_ledger(pg_root, [rec("a", "idempotencja webhooka")])
    explicit = tmp_path / "explicit.jsonl"
    assert ls.main(["webhook", "--pg-root", str(pg_root), "--json", "--log", str(explicit)]) == 0
    out = json.loads(capsys.readouterr().out)
    assert out[0]["id"] == "a" and set(out[0]) == {"id", "status", "thesis", "quote", "mechanism"}
    assert explicit.is_file() and not log.exists()


def test_bad_input_exit_2(pg_root, log):
    assert ls.main(["x", "--pg-root", str(pg_root)]) == 2, "missing ledger"
    write_ledger(pg_root, [rec("a", "x")])
    assert ls.main(["--pg-root", str(pg_root)]) == 2, "no query"
    assert not log.exists()


def test_unused_lists_unreturned_untriggered_w(pg_root, log, capsys):
    now = datetime.now(timezone.utc)
    old = (now - timedelta(days=40)).strftime("%Y-%m-%dT%H:%M:%SZ")
    fresh = (now - timedelta(days=1)).strftime("%Y-%m-%dT%H:%M:%SZ")
    records = [
        rec("returned", "t"), rec("expired", "t"), rec("never", "t"), rec("wired", "t", trigger="hooks/guard.js"),
        rec("dup", "t", duplicate_of="never"), rec("nd", "t", status="NIE DOTYCZY"), rec("s", "t", weight="Ś"),
    ]
    log.parent.mkdir(parents=True)
    log.write_text(
        json.dumps({"ts": fresh, "query": "q", "n_results": 1, "ids": ["returned"]}) + "\n"
        + json.dumps({"ts": old, "query": "q", "n_results": 1, "ids": ["expired"]}) + "\nnot json\n",
        encoding="utf-8")
    before = log.read_text(encoding="utf-8")
    cand = ls.unused(records, log, 28, now)
    assert ids(cand) == ["expired", "never"]
    write_ledger(pg_root, records)
    assert ls.main(["--unused", "--window-days", "28", "--pg-root", str(pg_root)]) == 0
    assert "candidates (W, not returned in 28 days, no trigger): 2" in capsys.readouterr().out
    assert log.read_text(encoding="utf-8") == before, "--unused must not write a log line"


def test_unused_without_log_returns_all_untriggered(pg_root, log):
    assert ids(ls.unused([rec("a", "t"), rec("b", "t", trigger="x")], log, 28, datetime.now(timezone.utc))) == ["a"]

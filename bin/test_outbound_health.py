#!/usr/bin/env python3
"""Testy hooks/outbound_health.py (zywotnosc outbound-observe w guard_health, audyt 2026-11-03).
Uruchom: python3 ~/.claude/bin/test_outbound_health.py"""
import importlib.util
import json
import os
import pathlib
import subprocess
import sys
import tempfile
from datetime import datetime, timedelta, timezone

ROOT = pathlib.Path(__file__).resolve().parent.parent
_spec = importlib.util.spec_from_file_location("outbound_health", ROOT / "hooks" / "outbound_health.py")
assert _spec is not None and _spec.loader is not None, "brak hooks/outbound_health.py"
oh = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(oh)
SUFFIX = subprocess.run(["node", "-e", "process.stdout.write(require(process.argv[1]).OUTBOUND_SUFFIX)",
                         str(ROOT / "hooks" / "outbound-observe.js")], capture_output=True, text=True, check=True).stdout
fails = []


def check(name, ok, detail=""):
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else f" :: {detail}"))
    if not ok:
        fails.append(name)


def line(ts, *names):
    return json.dumps({"timestamp": ts.isoformat().replace("+00:00", "Z"), "type": "assistant",
                       "message": {"content": [{"type": "tool_use", "name": n, "input": {}} for n in names]}})


now = datetime.now(timezone.utc)
wired = now - timedelta(hours=10)
with tempfile.TemporaryDirectory() as d:
    proj = pathlib.Path(d)
    (proj / "a").mkdir()
    (proj / "a" / "sub").mkdir()
    # sesja po wpieciu: 2 wysylki (gmail + zoho snake_case), 1 odczyt, wysylka w tekscie (nie tool_use) sie nie liczy
    (proj / "a" / "s1.jsonl").write_text("\n".join([
        line(now - timedelta(hours=2), "mcp__gmail-multi__gmail_send_email", "mcp__zoho-mail__ZohoMail_get_mail"),
        line(now - timedelta(hours=1), "mcp__zoho-mail__ZohoMail_send_mail"),
        json.dumps({"timestamp": now.isoformat(), "type": "user", "message": {"content": 'tekst "name":"mcp__x__send_message"'}}),
    ]) + "\n", encoding="utf-8")
    # sesja sprzed wpiecia: wysylka po wpieciu liczy sie (hooki przeladowane w biegu), wysylka sprzed wpiecia nie
    (proj / "a" / "s0.jsonl").write_text("\n".join([line(now - timedelta(hours=20), "mcp__github__push_files"),
                                                    line(now - timedelta(hours=1), "mcp__github__merge_pull_request")]) + "\n", encoding="utf-8")
    # subagent (podkatalog) po wpieciu: 1 wysylka
    (proj / "a" / "sub" / "agent.jsonl").write_text(line(now - timedelta(minutes=5), "mcp__ccd_pr__set_auto_merge") + "\n", encoding="utf-8")
    n, last, mcp_calls, _files = oh.count_sends(proj, SUFFIX, wired)
    check("count_sends: 4 wysylki po wpieciu (2 sesje + subagent), bez wysylki sprzed wpiecia i bez tekstu", n == 4, n)
    check("count_sends: czas ostatniej wysylki = subagent (now-5 min)", abs((last - (now - timedelta(minutes=5))).total_seconds()) < 1, last)
    check("count_sends: kanarek liczy wszystkie wywolania MCP (5 = 4 wysylki + get_mail)", mcp_calls == 5, mcp_calls)
    (proj / "a" / "list.jsonl").write_text(json.dumps([1, 2]) + "\n" + json.dumps({"timestamp": None, "x": '"name":"mcp__a__send_x"'}) + "\n", encoding="utf-8")
    check("count_sends: linia JSON nie-dict / bez timestamp nie wywraca pomiaru", oh.count_sends(proj, SUFFIX, wired)[0] == 4)
    # rg dostaje plik, ktory zniknal (wyscig z zywa sesja): rc=2, ale trafienia z reszty paczki sie licza
    gone = proj / "a" / "gone.jsonl"
    gone.write_text(line(now, "mcp__x__send_message") + "\n", encoding="utf-8")
    n_gone = oh.scan_files([gone, proj / "a" / "znikniety.jsonl"], SUFFIX, wired)
    check("scan_files: rc=2 przez znikniety plik nie wylacza pomiaru", n_gone is not None and n_gone[0] == 1, str(n_gone))
    gone.unlink()
    try:
        oh.count_sends(proj, SUFFIX, wired, rg="/nonexistent/rg")
        no_rg = False
    except FileNotFoundError:
        no_rg = True
    check("count_sends: brak binarki rg = wyjatek (guard_health RED), nie cicha zielen", no_rg)
    bad = pathlib.Path(d) / "bad-rg.sh"
    bad.write_text("#!/bin/sh\necho 'regex parse error' >&2\nexit 2\n", encoding="utf-8")
    bad.chmod(0o755)
    try:
        oh.count_sends(proj, SUFFIX, wired, rg=str(bad))
        raised = False
    except RuntimeError:
        raised = True
    check("count_sends: inny blad rg = wyjatek (guard_health RED), nie cicha zielen", raised)
    mute = pathlib.Path(d) / "mute-rg.sh"
    mute.write_text("#!/bin/sh\nexit 2\n", encoding="utf-8")
    mute.chmod(0o755)
    try:
        oh.scan_files([proj / "a" / "s1.jsonl"], SUFFIX, wired, rg=str(mute))
        raised = False
    except RuntimeError:
        raised = True
    check("scan_files: rc=2 bez stderr = wyjatek (nie wyscig), nie cicha zielen", raised)
    old = proj / "a" / "old.jsonl"
    old.write_text(line(now - timedelta(days=9), "mcp__gmail-multi__gmail_send_email") + "\n", encoding="utf-8")
    t = (now - timedelta(days=9)).timestamp()
    os.utime(old, (t, t))
    check("count_sends: plik sprzed okna pominiety", oh.count_sends(proj, SUFFIX, wired)[0] == 4)


def ev(minutes_ago, event="ran"):
    return {"gate": "OUTBOUND", "event": event, "ts": (now - timedelta(minutes=minutes_ago)).isoformat().replace("+00:00", "Z")}


last = now - timedelta(minutes=5)
ok, txt = oh.verdict(oh.Scan(3, last, 9, 3), [], wired)
check("verdict: wysylki bez wpisu OUTBOUND = RED", ok is False and "wysylki MCP w transkryptach=3" in txt, txt)
ok, txt = oh.verdict(oh.Scan(3, last, 9, 3), [ev(4), ev(30), ev(60, "skipped")], wired)
check("verdict: wpis po ostatniej wysylce (nawet skipped w serii) = hook zyje", ok is True and "skipped=1" in txt, txt)
ok, txt = oh.verdict(oh.Scan(3, last, 9, 3), [ev(300), ev(301), ev(302)], wired)
check("verdict: hook umarl w polowie okna (ostatni wpis 5 h przed ostatnia wysylka) = RED", ok is False and "ostatni wpis" in txt, txt)
ok, txt = oh.verdict(oh.Scan(10, last, 30, 3), [ev(4), ev(20)], wired)
check("verdict: wpisow < polowy wysylek = RED (nazwy poza matcherem)", ok is False and "polowy" in txt, txt)
ok, txt = oh.verdict(oh.Scan(1, last, 9, 3), [ev(60 * 24 * 3)], wired)
check("verdict: wpis sprzed wpiecia nie liczy sie", ok is False, txt)
ok, txt = oh.verdict(oh.Scan(0, None, 40, 30), [], wired)
check("verdict: brak wysylek przy zywym skanie = OK (brak okazji, nie dowod awarii)", ok is True, txt)
ok, txt = oh.verdict(oh.Scan(0, None, 0, 30), [], wired)
check("verdict: 30 transkryptow i 0 wywolan MCP = RED (skan slepy)", ok is False and "nie widzi" in txt, txt)
ok, txt = oh.verdict(oh.Scan(0, None, 0, 2), [], wired)
check("verdict: malo transkryptow i 0 MCP = OK (cichy okres)", ok is True, txt)
# Wpiecie w guard_health: prawdziwy hook i git tego repo (lista z OUTBOUND_SUFFIX, start = commit dodania hooka albo okno).
with tempfile.TemporaryDirectory() as empty:  # hermetycznie: bez skanu prawdziwych transkryptow (ops review r4)
    ok, txt = oh.liveness(ROOT, now - timedelta(days=7), [], projects_dir=pathlib.Path(empty))
check("liveness: hook i git tego repo, pusty katalog transkryptow = OK z linia startu", ok is True and txt.startswith("outbound-observe od 20")
      and "w 0 transkryptach" in txt, txt)
try:
    oh.scan_files([ROOT / "README.md"], SUFFIX, wired, budget_s=0)
    over = False
except TimeoutError:
    over = True
check("scan_files: przekroczony budzet skanu = TimeoutError (guard_health RED)", over)
print("TESTY outbound_health: " + (f"{len(fails)} FAIL" if fails else "wszystkie OK"))
sys.exit(1 if fails else 0)

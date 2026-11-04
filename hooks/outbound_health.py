"""Zywotnosc hooka outbound-observe (audyt 2026-11-03) — funkcje wolane z guard_health.py (jak lang_gap_health).

Hook observe, ktory nic nie loguje, wyglada tak samo jak „brak wysylek": nie zaladowal sie (blad require = exit 1 bez
wpisu), matcher sie rozjechal albo Claude Code przestal go wolac. Dowod wysylek = wywolania MCP pasujace do
OUTBOUND_SUFFIX (wlasciciel listy: hooks/outbound-observe.js) wywolane PO wpieciu hooka. Wysylki sa, a wpisow
gate=OUTBOUND brak = RED. Liczone tez sesje starsze niz wpiecie: wpis observe-channel z 2026-11-03 15:39Z przyszedl
z sesji sprzed zmiany matchera bash-guard (4d059e3), wiec Claude Code przeladowal hooki w biegu. Gdyby kiedys nie
przeladowal, RED wskaze to wprost. Test: bin/test_outbound_health.py.
"""
import json
import re
import subprocess
import time
from collections import Counter, namedtuple
from datetime import datetime, timedelta

MCP_ANY = re.compile(r".+")  # outbound_names z tym wzorcem = kazde wywolanie mcp__* (kanarek)
RG_PATTERN = r'"name":\s*"mcp__'  # transkrypty CC sa kompaktowe; spacja dopuszczona (inny zapis JSON)
RG_BATCH = 200  # plikow na jedno wywolanie rg (limit dlugosci argv)
SCAN_BUDGET_S = 300  # sufit calego skanu (zimny cache); przekroczenie = wyjatek -> RED, nie cicha zielen
LAG = timedelta(minutes=15)  # wpis hooka powstaje przed wykonaniem narzedzia; zapas na zegar i zapis transkryptu
MIN_SENDS_FOR_RATIO = 4
MIN_FILES_FOR_CANARY = 20  # tyle transkryptow w oknie, a 0 wywolan MCP = skan slepy (zmiana formatu), nie cichy tydzien
# sends/last = wysylki; mcp_calls = WSZYSTKIE wywolania MCP (kanarek: czy skan w ogole widzi tool_use); files = przeskanowane
Scan = namedtuple("Scan", "sends last mcp_calls files")


def _ts(value):
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


def outbound_names(line, suffix_rx):
    """Nazwy wywolan wysylki MCP (tool_use) w jednej linii transkryptu."""
    try:
        entry = json.loads(line)
    except ValueError:
        return []
    content = ((entry or {}).get("message") or {}).get("content") or []
    if not isinstance(content, list):
        return []
    return [b.get("name") for b in content
            if isinstance(b, dict) and b.get("type") == "tool_use" and str(b.get("name", "")).startswith("mcp__")
            and suffix_rx.fullmatch(str(b.get("name")).split("__")[-1])]


def count_sends(projects_dir, suffix, start, rg="rg"):
    """Scan(sends, last, mcp_calls, files): liczba i czas ostatniej wysylki MCP wywolanej >= start, wszystkie wywolania MCP
    (kanarek) i liczba skanowanych plikow (transkrypty z mtime >= start, takze subagenci).
    Brak rg, blad rg, timeout = wyjatek -> guard_health RED: pomiar, ktory nie przebiegl, nie moze wygladac na zdrowy
    hook (code+ops review r2 2026-11-03). rc=2 tylko z „No such file” = plik zniknal miedzy rglob a rg (zywe sesje):
    trafienia z reszty paczki sie licza."""
    files = []
    for p in projects_dir.rglob("*.jsonl"):
        try:
            if p.stat().st_mtime >= start.timestamp():
                files.append(p)
        except OSError:  # transkrypt usuniety miedzy rglob a stat (zywe sesje)
            continue
    return scan_files(files, suffix, start, rg)


def scan_files(files, suffix, start, rg="rg", budget_s=SCAN_BUDGET_S):
    """count_sends dla gotowej listy plikow (wydzielone dla testu sciezek bledu rg)."""
    suffix_rx = re.compile(suffix)
    sends, last, mcp_calls = 0, None, 0
    deadline = time.monotonic() + budget_s
    for i in range(0, len(files), RG_BATCH):
        left = deadline - time.monotonic()
        if left <= 0:
            raise TimeoutError(f"skan transkryptow > {budget_s} s")
        res = subprocess.run([rg, "--null", "-N", "-H", "--no-heading", "-e", RG_PATTERN, *map(str, files[i:i + RG_BATCH])],
                             capture_output=True, text=True, timeout=min(120, left), check=False)
        lines = [ln for ln in res.stderr.splitlines() if ln.strip()]
        errors = [ln for ln in lines if "No such file or directory" not in ln]
        # tolerowany jest TYLKO rc=2 z co najmniej jedna linia „No such file” i niczym innym (code review r3: cichy rc=2 = zielen)
        if res.returncode not in (0, 1) and (errors or res.returncode != 2 or not lines):
            raise RuntimeError(f"rg rc={res.returncode}: {(errors or [''])[0][:160]}")
        for row in res.stdout.splitlines():
            line = row.split("\0", 1)[-1]
            try:
                entry = json.loads(line)
            except ValueError:
                continue
            ts = _ts(entry.get("timestamp")) if isinstance(entry, dict) else None
            if ts is None or ts < start:
                continue
            mcp_calls += len(outbound_names(line, MCP_ANY))
            found = len(outbound_names(line, suffix_rx))
            if found:
                sends += found
                last = ts if last is None else max(last, ts)
    return Scan(sends, last, mcp_calls, len(files))


def verdict(scan, window_events, start):
    """(ok, linia) dla guard_health. Hook loguje 1 wpis na wysylke, wiec martwy hook = (a) wysylki bez wpisow,
    (b) ostatnia wysylka pozniej niz ostatni wpis o > LAG (umarl w polowie okna), (c) wpisow < polowy wysylek (czesc
    nazw nie przechodzi matchera). Jeden stary wpis nie wystarcza na zielen (code+product review 2026-11-03)."""
    ev = [e for e in window_events if e.get("gate") == "OUTBOUND" and (_ts(e.get("ts")) or start) >= start]
    by_event = Counter(e.get("event") for e in ev)
    head = f"outbound-observe od {start.isoformat()[:16]}Z: wysylki MCP w transkryptach="
    tail = f" | log OUTBOUND ran={by_event['ran']} would_block={by_event['would_block']} skipped={by_event['skipped']}"
    sends, last_send = scan.sends, scan.last
    line = head + str(sends) + tail + f" | wywolan MCP={scan.mcp_calls} w {scan.files} transkryptach"
    if scan.files >= MIN_FILES_FOR_CANARY and scan.mcp_calls == 0:
        return False, line + " — skan nie widzi zadnego wywolania MCP (format transkryptu albo RG_PATTERN?)"
    last_entry = max((ts for ts in (_ts(e.get("ts")) for e in ev) if ts), default=None)
    if sends and not ev:
        return False, line + " — wysylki bez zadnego wpisu"
    if last_send and (last_entry is None or last_send - last_entry > LAG):
        return False, line + f" — ostatnia wysylka {last_send.isoformat()[:16]}Z, ostatni wpis {last_entry.isoformat()[:16] if last_entry else '-'}Z"
    if sends >= MIN_SENDS_FOR_RATIO and len(ev) < sends / 2:
        return False, line + " — wpisow < polowy wysylek (czesc nazw poza matcherem?)"
    return True, line


def liveness(claude_dir, since, window_events, projects_dir=None):
    """Pomiar dla guard_health: lista wysylek (OUTBOUND_SUFFIX z hooka), start = max(okno, commit DODANIA pliku hooka —
    przyblizenie wpiecia: hook i wpis w settings weszly tym samym wdrozeniem 2026-11-03; pozniejsze wpiecie = mozliwy RED)."""
    hook = claude_dir / "hooks" / "outbound-observe.js"
    suffix = subprocess.run(["node", "-e", "process.stdout.write(require(process.argv[1]).OUTBOUND_SUFFIX)", str(hook)],
                            capture_output=True, text=True, timeout=20, check=False).stdout
    added = subprocess.run(["git", "-C", str(claude_dir), "log", "--diff-filter=A", "--format=%cI", "--", "hooks/outbound-observe.js"],
                           capture_output=True, text=True, timeout=20, check=False).stdout.split()
    if not suffix:
        raise RuntimeError("node nie zwrocil OUTBOUND_SUFFIX z hooks/outbound-observe.js")
    start = max(since, datetime.fromisoformat(added[-1])) if added else since
    return verdict(count_sends(projects_dir or claude_dir / "projects", suffix, start), window_events, start)

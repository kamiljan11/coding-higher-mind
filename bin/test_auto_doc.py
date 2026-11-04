#!/usr/bin/env python3
"""Testy hooka hooks/auto-doc.py (SessionEnd -> notatka w Obsidianie). Uruchom: python3 ~/.claude/bin/test_auto_doc.py"""
import importlib.util  # modul hooka ma myslnik w nazwie -> ladowanie po sciezce
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

HOOK = Path(__file__).resolve().parents[1] / 'hooks' / 'auto-doc.py'
BLEDY: list[str] = []


def sprawdz(nazwa: str, warunek: bool, detal: str = '') -> None:
    print(('ok   ' if warunek else 'FAIL ') + nazwa + ('' if warunek else f'  -> {detal}'))
    if not warunek:
        BLEDY.append(nazwa)


def uruchom(transkrypt: list[dict], cwd: str, out: str, sesja: str = 'abcdef123456') -> tuple[int, list[Path]]:
    with tempfile.NamedTemporaryFile('w', suffix='.jsonl', delete=False) as f:
        f.write('\n'.join(json.dumps(e) for e in transkrypt) + '\n')
    wejscie = json.dumps({'session_id': sesja, 'transcript_path': f.name, 'cwd': cwd, 'reason': 'logout'})
    r = subprocess.run([sys.executable, str(HOOK)], input=wejscie, text=True, capture_output=True,
                       env={**os.environ, 'AUTO_DOC_DIR': out}, timeout=30, check=False)
    return r.returncode, sorted(Path(out).glob('*.md'))


def git(repo: Path, *args: str) -> None:
    subprocess.run(['git', '-C', str(repo), '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'core.hooksPath=/dev/null', *args],
                   check=True, capture_output=True)


CACHE = Path.home() / '.cache'  # nie /tmp: hook pomija pliki tymczasowe z /tmp
CACHE.mkdir(exist_ok=True)
with tempfile.TemporaryDirectory(dir=CACHE) as tmp:
    repo = Path(tmp, 'moj-projekt')
    repo.mkdir()
    git(repo, 'init', '-q')
    (repo / 'app.py').write_text('x = 1\n')
    git(repo, 'add', '.')
    git(repo, 'commit', '-qm', 'feat: pierwsza funkcja')
    out = str(Path(tmp, 'vault'))
    ckpt, prec = Path(tmp, 'Checkpoints'), Path(tmp, 'precompact')  # kompakcja L5: linki do pamieci sesji
    ckpt.mkdir()
    prec.mkdir()
    (ckpt / '2026-11-02 abcdef12 moj-projekt.md').write_text('# checkpoint')
    (ckpt / '2026-11-02 99999999 inny.md').write_text('# cudzy')
    (ckpt / '2026-11-02 11111111 abcdef12-projekt.md').write_text('# sid8 tylko w nazwie projektu')
    (prec / 'abcdef123456.index.md').write_text('indeks')
    (prec / 'abcdef123456.summary.md').write_text('streszczenie')
    os.environ['AUTO_DOC_CHECKPOINT_DIR'] = str(ckpt)
    os.environ['AUTO_DOC_PRECOMPACT_DIR'] = str(prec)
    TS = '2000-01-01T00:00:00Z'
    transkrypt = [
        {'type': 'user', 'timestamp': TS, 'message': {'role': 'user', 'content': '<system-reminder>wstrzykniete</system-reminder>'}},
        {'type': 'user', 'timestamp': TS, 'message': {'role': 'user', 'content': 'pozwol ALLOW_CONTROL_PLANE'}},
        {'type': 'user', 'timestamp': TS, 'message': {'role': 'user', 'content': 'dodaj funkcje logowania, token ' + 'ghp' + '_' + 'X' * 20}},  # sklejany: skaner sekretow
        {'type': 'assistant', 'timestamp': TS, 'message': {'content': [
            {'type': 'tool_use', 'id': 't1', 'name': 'Edit', 'input': {'file_path': str(repo / 'app.py')}},
            {'type': 'tool_use', 'id': 't2', 'name': 'Write', 'input': {'file_path': '/tmp/smiec.txt'}},
            {'type': 'text', 'text': 'Gotowe: dodalem logowanie.'}]}},
        {'type': 'user', 'timestamp': TS, 'message': {'role': 'user', 'content': [{'type': 'tool_result', 'tool_use_id': 't1', 'content': 'ok'}]}},
        {'type': 'user', 'timestamp': TS, 'isMeta': True, 'message': {'role': 'user', 'content': 'meta'}},
    ]
    rc, pliki = uruchom(transkrypt, str(repo), out)
    tresc = pliki[0].read_text() if pliki else ''
    sprawdz('exit 0', rc == 0, str(rc))
    sprawdz('notatka nazwana projektem z repo git', len(pliki) == 1 and 'Claude Code - moj-projekt' in pliki[0].name, str(pliki))
    sprawdz('pierwsze polecenie czlowieka (nie system-reminder)', 'dodaj funkcje logowania' in tresc and 'wstrzykniete' not in tresc, tresc[:300])
    sprawdz('token zredagowany', 'ghp_' not in tresc and '[REDACTED]' in tresc, tresc[:300])
    sprawdz('zmieniony plik na liscie', 'app.py' in tresc, tresc)
    sprawdz('pliki tymczasowe (/tmp) pominiete', '/tmp/smiec.txt' not in tresc, tresc)
    sprawdz('fraza zgody nie jest zadaniem', 'pozwol ALLOW' not in tresc, tresc[:300])
    sprawdz('commit repo w notatce', 'feat: pierwsza funkcja' in tresc, tresc)
    sprawdz('ostatnia odpowiedz w notatce', 'Gotowe: dodalem logowanie.' in tresc, tresc)
    sprawdz('liczba polecen = 1 (bez tool_result i meta)', '**Polecen uzytkownika:** 1' in tresc, tresc)
    sprawdz('L5: wikilink do checkpointu tej sesji (sid8), bez cudzego',
            '[[Claude Memory/Checkpoints/2026-11-02 abcdef12 moj-projekt]]' in tresc and '99999999' not in tresc
            and '11111111' not in tresc, tresc)
    sprawdz('L5: indeks artefaktow i streszczenia kompakcji; brak migawki = brak linku',
            'indeks artefaktow:' in tresc and 'abcdef123456.summary.md' in tresc and 'migawka sprzed' not in tresc, tresc)

    rc2, pliki2 = uruchom(transkrypt, str(repo), out, sesja='fedcba987654')  # poprawny sid bez plikow pamieci
    tresc2 = pliki2[0].read_text() if pliki2 else ''
    sprawdz('druga sesja dopisuje do tego samego pliku dnia', len(pliki2) == 1 and tresc2.count('## ') == 2, str(pliki2))
    sprawdz('L5: sesja bez plikow pamieci = brak sekcji (1 sekcja na 2 wpisy)', tresc2.count('**Pamiec sesji:**') == 1, tresc2)

    pusty = str(Path(tmp, 'vault-pusty'))
    rc3, pliki3 = uruchom([{'type': 'user', 'timestamp': TS, 'message': {'content': '<command-name>/clear</command-name>'}}], tmp, pusty)
    sprawdz('sesja bez polecenia czlowieka = brak notatki', rc3 == 0 and not pliki3, str(pliki3))

    r = subprocess.run([sys.executable, str(HOOK)], input='{"transcript_path": "/nie/istnieje.jsonl"}', text=True,
                       capture_output=True, env={**os.environ, 'AUTO_DOC_DIR': pusty, 'HOME': tmp}, timeout=30, check=False)
    log = Path(tmp, '.claude/logs/auto-doc.log')
    wpisy = log.read_text().splitlines() if log.is_file() else []
    sprawdz('brak transkryptu = exit 0 + wpis SKIP (nie blad, guard_health go nie liczy)',
            r.returncode == 0 and len(wpisy) == 1 and wpisy[0].split(' ', 2)[1] == 'SKIP', f'rc={r.returncode} {wpisy}')
    r = subprocess.run([sys.executable, str(HOOK)], input='{zly json', text=True,
                       capture_output=True, env={**os.environ, 'AUTO_DOC_DIR': pusty, 'HOME': tmp}, timeout=30, check=False)
    wpisy = log.read_text().splitlines() if log.is_file() else []
    sprawdz('blad hooka (zly JSON) = exit 0 + wpis bez SKIP (guard_health = RED)',
            r.returncode == 0 and len(wpisy) == 2 and wpisy[1].split(' ', 2)[1] != 'SKIP', f'rc={r.returncode} {wpisy}')

_spec = importlib.util.spec_from_file_location('auto_doc', HOOK)
assert _spec and _spec.loader
_ad = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_ad)
for zly in ['../../etc/passwd', 'abcdef12/../x', 'abcdef123456\n', None, '']:
    sprawdz(f'L5: zly session_id {zly!r} = brak linkow', _ad.memory_links(zly) == [], str(_ad.memory_links(zly)))
for probka in ['Bearer ' + 'abcdefghijklmnop12345', 'eyJ' + 'hbGciOiJIUzI1NiJ9' + '.' + 'eyJzdWIiOiIxMjM0NTY3ODkwIn0' + '.' + 'sig_abc',
               'sk' + '-proj-' + 'A' * 20, 'sk' + '_live_' + 'B' * 20, 'EAA' + 'C' * 30, 'AC' + 'f' * 32, 'password=' + 'Hunter2xyz',
               'api_key: ' + 'zzzzzzzzzz', 'mail jan@firma' + '.is', 'kt 010190' + '-2399']:
    sprawdz(f'redakcja: {probka[:12]}...', '[REDACTED]' in _ad.redact(probka) and probka[-6:] not in _ad.redact(probka), _ad.redact(probka))
dlugi = 'a' * 392 + ' ghp' + '_' + 'Z' * 30
sprawdz('redakcja przed ucieciem (token na granicy 400 zn.)', 'ghp' + '_' not in _ad.redact(dlugi)[:400], _ad.redact(dlugi)[-40:])

print('TESTY auto-doc: ' + ('wszystkie OK' if not BLEDY else f'{len(BLEDY)} FAIL'))
sys.exit(1 if BLEDY else 0)

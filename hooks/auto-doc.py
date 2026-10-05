#!/usr/bin/env python3
"""auto-doc — notatka z sesji Claude Code do katalogu notatek (hook SessionEnd).

Wejscie (stdin, JSON Claude Code): session_id, transcript_path (JSONL), cwd, reason.
Wyjscie: dopisany wpis w `<AUTO_DOC_DIR>/<data> - Claude Code - <projekt>.md` (domyslny katalog: OUT_DIR nizej):
pierwsze polecenie uzytkownika, zmienione pliki, commity repo w czasie sesji, ostatnia odpowiedz (skrot).
Nigdy nie blokuje: kazdy blad -> wpis w logs/auto-doc.log, exit 0. Sekrety (ghp_/sk-ant-/sbp_/AKIA...) redagowane.
Zastepuje auto_doc.py z Windows (czytal nieistniejace pole `transcript` i pisal na <backup-drive>:, nie dzialal od migracji).
"""
import json
import os
import re
import subprocess
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

HOME = Path.home()
OUT_DIR = Path(os.environ.get('AUTO_DOC_DIR') or HOME / '.claude' / 'session-notes')
ERR_LOG = HOME / '.claude' / 'logs' / 'auto-doc.log'
EDIT_TOOLS = {'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'mcp__desktop-commander__write_file',
              'mcp__desktop-commander__edit_block'}
SECRET_RX = re.compile(
    r'(ghp_|gho_|github_pat_|sk-ant-|sk-proj-|sk_live_|sk_test_|rk_live_|sbp_|AKIA|xox[bp]-|EAA)[A-Za-z0-9_\-]{8,}'
    r'|eyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]+'          # JWT (Supabase anon/service, Bearer)
    r'|\bAC[0-9a-f]{32}\b'                           # Twilio SID
    r'|(?i:\bbearer\s+)\S{12,}'
    r'|(?i:\b(?:password|passwd|pwd|secret|token|api[_-]?key)\s*[=:]\s*)\S+'
    r'|\b[\w.+-]+@[\w-]+\.[\w.-]+\b'                 # e-mail (PII)
    r'|\b[0-3]\d[01]\d\d{2}-?\d{4}\b')              # kennitala (PII)
MAX_FILES = 25
MAX_COMMITS = 15
MAX_ROOT_LOOKUPS = 60  # katalogi, nie pliki: git_root kosztuje do 5 s, hook ma 30 s
PHRASE_RX = re.compile(r'^\s*(pozwol\s+ALLOW_\w+|ok|tak|nie|dalej|continue|try again)\s*$', re.IGNORECASE)
SCRATCH_RX = re.compile(r'^/tmp/|/scratch-workspaces/|/scratchpad/')


def redact(text: str) -> str:
    return SECRET_RX.sub('[REDACTED]', text)


def user_text(entry: dict) -> str:
    """Tekst polecenia czlowieka; '' dla wstrzyknietych blokow (system-reminder, wyniki narzedzi, komendy)."""
    if entry.get('type') != 'user' or entry.get('isMeta'):
        return ''
    content = (entry.get('message') or {}).get('content')
    if isinstance(content, list):
        if any(isinstance(b, dict) and b.get('type') == 'tool_result' for b in content):
            return ''
        content = ' '.join(b.get('text', '') for b in content if isinstance(b, dict) and b.get('type') == 'text')
    text = str(content or '').strip()
    return '' if not text or text.startswith(('<', '[Request interrupted')) else text


def parse_transcript(path: Path) -> dict:
    prompts, files, last_text, first_ts = [], [], '', ''
    for line in path.read_text(encoding='utf-8', errors='replace').splitlines():
        try:
            entry = json.loads(line)
        except ValueError:
            continue
        if not first_ts and entry.get('timestamp'):
            first_ts = entry['timestamp']
        text = user_text(entry)
        if text and not PHRASE_RX.match(text):  # frazy zgody i jednowyrazowe potwierdzenia nie sa „zadaniem”
            prompts.append(text)
        if entry.get('type') != 'assistant':
            continue
        for block in (entry.get('message') or {}).get('content') or []:
            if not isinstance(block, dict):
                continue
            if block.get('type') == 'tool_use' and block.get('name') in EDIT_TOOLS:
                target = (block.get('input') or {}).get('file_path') or (block.get('input') or {}).get('path')
                if target and target not in files and not SCRATCH_RX.search(str(target)):
                    files.append(str(target))
            elif block.get('type') == 'text' and block.get('text', '').strip():
                last_text = block['text'].strip()
    return {'prompts': prompts, 'files': files, 'last_text': last_text, 'first_ts': first_ts}


def git_root(path: str) -> str:
    folder = path if os.path.isdir(path) else os.path.dirname(path)
    try:
        r = subprocess.run(['git', '-C', folder, 'rev-parse', '--show-toplevel'], capture_output=True, text=True, timeout=5,
                           check=False)
    except (OSError, subprocess.TimeoutExpired):
        return ''
    return r.stdout.strip() if r.returncode == 0 else ''


def repo_commits(root: str, since: str) -> list[str]:
    try:
        r = subprocess.run(['git', '-C', root, 'log', f'--since={since}', f'-n{MAX_COMMITS}', '--format=%h %s'],
                           capture_output=True, text=True, timeout=10, check=False)
    except (OSError, subprocess.TimeoutExpired):
        return []
    return [line for line in r.stdout.splitlines() if line.strip()] if r.returncode == 0 else []


def project_name(roots: list[str], cwd: str) -> str:
    if roots:
        root = Counter(roots).most_common(1)[0][0]
        return 'PG (.claude)' if os.path.realpath(root) == os.path.realpath(HOME / '.claude') else os.path.basename(root)
    if 'scratch-workspaces' in cwd or not cwd:
        return 'bez projektu'
    return os.path.basename(cwd.rstrip('/')) or 'bez projektu'


def build_entry(data: dict, parsed: dict) -> tuple[str, str]:
    folders = list(dict.fromkeys(f if os.path.isdir(f) else os.path.dirname(f) for f in parsed['files']))[:MAX_ROOT_LOOKUPS]
    root_of = {d: git_root(d) for d in folders}
    roots = [root_of[f if os.path.isdir(f) else os.path.dirname(f)] for f in parsed['files']
             if root_of.get(f if os.path.isdir(f) else os.path.dirname(f))]
    cwd_root = git_root(data.get('cwd') or '') if data.get('cwd') else ''
    project = project_name(roots or ([cwd_root] if cwd_root else []), data.get('cwd') or '')
    commits = []
    for root in dict.fromkeys(roots or ([cwd_root] if cwd_root else [])):
        commits += [f'{os.path.basename(root)}: {c}' for c in repo_commits(root, parsed['first_ts'] or '1 day ago')]
    now = datetime.now(timezone.utc)
    files = '\n'.join(f'  - `{f.replace(str(HOME), "~")}`' for f in parsed['files'][:MAX_FILES]) or '  - (brak)'
    if len(parsed['files']) > MAX_FILES:
        files += f'\n  - ... (+{len(parsed["files"]) - MAX_FILES})'
    entry = (
        f"## {now:%H:%M} UTC — sesja `{str(data.get('session_id', '?'))[:8]}` ({data.get('reason', 'koniec')})\n\n"
        f"**Task:** {redact(parsed['prompts'][0])[:400]}\n\n"
        + (f"**Ostatnie polecenie:** {redact(parsed['prompts'][-1])[:300]}\n\n" if len(parsed['prompts']) > 1 else '') +
        f"**Polecen uzytkownika:** {len(parsed['prompts'])}\n\n"
        f"**Zmienione pliki:**\n{files}\n\n"
        f"**Commity w repo od startu sesji** (moga zawierac commity rownoleglych sesji):\n"
        + ('\n'.join(f'  - {redact(c)}' for c in commits) or '  - (brak)') + '\n\n'
        f"**Ostatnia odpowiedz (skrot):** {redact(parsed['last_text'])[:600]}\n\n---\n\n")
    return project, entry


def write_entry(project: str, entry: str) -> Path:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    date = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    safe = re.sub(r'[\\/:*?"<>|]', '-', project)
    target = OUT_DIR / f'{date} - Claude Code - {safe}.md'
    header = '' if target.exists() else f'---\ndate: {date}\nprovenance: ai\ntags: [session, auto-doc]\n---\n# Sesje Claude Code — {date} ({project})\n\n'
    with target.open('a', encoding='utf-8') as f:
        f.write(header + entry)
    return target


def log_error(message: str) -> None:
    try:
        ERR_LOG.parent.mkdir(parents=True, exist_ok=True)
        with ERR_LOG.open('a', encoding='utf-8') as f:
            f.write(f'{datetime.now(timezone.utc).isoformat()} {message}\n')
    except OSError:
        pass
    print(f'[auto-doc] {message}', file=sys.stderr)


def main() -> int:
    try:
        data = json.loads(sys.stdin.read() or '{}')
        path = Path(str(data.get('transcript_path') or ''))
        if not path.is_file():
            log_error(f'brak transkryptu: {path}')
            return 0
        parsed = parse_transcript(path)
        if not parsed['prompts']:
            return 0  # sesja bez polecenia czlowieka (np. otwarta i zamknieta) — nic do dokumentowania
        project, entry = build_entry(data, parsed)
        target = write_entry(project, entry)
        print(f'[auto-doc] zapisano: {target.name}', file=sys.stderr)
    except (OSError, ValueError, TypeError, KeyError, AttributeError, subprocess.SubprocessError) as e:
        # hook nigdy nie blokuje konca sesji; blad trafia do logu z typem i trescia
        log_error(f'{type(e).__name__}: {e}')
    return 0


if __name__ == '__main__':
    sys.exit(main())

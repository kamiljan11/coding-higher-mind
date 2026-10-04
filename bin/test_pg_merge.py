#!/usr/bin/env python3
"""Testy rdzenia decyzji pg-merge-bezpieczny.py (bez sieci). Uruchom: python ~/.claude/bin/test_pg_merge.py"""
import base64
import hashlib
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

spec = importlib.util.spec_from_file_location('pgm', Path(__file__).with_name('pg-merge-bezpieczny.py'))
assert spec and spec.loader
pgm: Any = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pgm)

REPO = '<github-owner>/shop-app'
PR = {'state': 'open', 'merged': False, 'mergeable_state': 'clean', 'head': {'sha': 'abc', 'repo': {'full_name': REPO}}}
ZIELONE = [{'id': 1, 'name': 'quality', 'status': 'completed', 'conclusion': 'success'}]
T1 = {'tier': 'T1', 'reasons': []}
T2 = {'tier': 'T2', 'reasons': ['T2: 200 linii > 150']}
DIFF = 'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-stare\n+nowe\n'
AGREGAT = {'verdict': 'APPROVE', 'incomplete': [], 'needs_verification': [], 'required_roles': ['code', 'ops'], 'roles': ['code', 'ops']}
bledy: list[str] = []


def plik(nazwa: str, patch: str = '@@ -1 +1 @@\n-a\n+b', poprzednia: str | None = None) -> dict:
    p = {'filename': nazwa, 'patch': patch, 'changes': 2, 'additions': 1, 'deletions': 1}
    if poprzednia:
        p['previous_filename'] = poprzednia
    return p


def sprawdz(nazwa: str, powody: list[str], oczekuj_odmowy: bool, fragment: str = '') -> None:
    ok = bool(powody) == oczekuj_odmowy and (not fragment or any(fragment in p for p in powody))
    print(('ok   ' if ok else 'FAIL ') + nazwa + ('' if ok else f'  -> {powody}'))
    if not ok:
        bledy.append(nazwa)


def ocen(pliki: list[dict], tier: dict = T1, checki: list[dict] = ZIELONE, pr: dict = PR,
         tresc: str | None = None, recenzja: str | None = None) -> list[str]:
    return pgm.ocen(pr, REPO, checki, pliki, tier, tresc, recenzja)


sprawdz('T1 z recenzja + zielone CI = scala', ocen([plik('src/components/Footer.tsx')]), False)
sprawdz('T1 BEZ recenzji = odmowa (v3)', ocen([plik('src/components/Footer.tsx')], recenzja='T1 bez dowodu recenzji'), True, 'recenzji')
sprawdz('T0 bez recenzji = scala', ocen([plik('docs/x.md')], tier={'tier': 'T0', 'reasons': []}, recenzja='brak'), False)
sprawdz('plik o nazwie --lines = odmowa', ocen([plik('--lines')]), True, 'podejrzana')
sprawdz('rename z access/ do src/ = odmowa', ocen([plik('src/lib/x.ts', poprzednia='src/access/admin.ts')]), True, 'access')
sprawdz('rename z .github/ = odmowa', ocen([plik('ci/q.yml', poprzednia='.github/workflows/q.yml')]), True, '.github')
for nazwa in ['vercel.json', '.npmrc', 'bun.lockb', 'uv.lock', 'Pipfile.lock', 'go.mod', 'Cargo.toml', '.husky/pre-commit',
              'supabase/config.toml', 'package.json']:
    sprawdz(f'{nazwa} = odmowa (lancuch/deploy)', ocen([plik(nazwa)]), True, 'zaleznosci')
for nazwa in ['src/proxy.ts', 'auth.ts', 'src/lib/auth-helpers.ts', 'src/collections/Users.ts', 'src/middleware.ts',
              'src/migrations/2026_x.ts', 'supabase/functions/x/index.ts', 'vitest.config.ts', 'eslint.config.mjs',
              'tsconfig.json', '.env.example', 'next.config.mjs']:
    sprawdz(f'{nazwa} = odmowa (wrazliwe)', ocen([plik(nazwa)]), True, 'wrazliwy')
sprawdz('tresc service_role = odmowa', ocen([plik('src/lib/x.ts')], tresc='service_role'), True, 'tresc T3')
sprawdz('tier T3 = odmowa', ocen([plik('src/x.ts')], tier={'tier': 'T3', 'reasons': ['T3: platnosci']}), True, 'tier T3')
sprawdz('T2 bez recenzji = odmowa', ocen([plik('src/x.ts')], tier=T2, recenzja='T2 bez dowodu recenzji'), True, 'recenzji')
sprawdz('T2 z recenzja = scala', ocen([plik('src/x.ts')], tier=T2, recenzja=None), False)
sprawdz('plik bez patcha = odmowa', ocen([plik('public/logo.png', patch='')]), True, 'bez patcha')
sprawdz('fork = odmowa', ocen([plik('src/x.ts')], pr={**PR, 'head': {'sha': 'a', 'repo': {'full_name': 'obcy/fork'}}}), True, 'fork')
sprawdz('checki w toku = osobny komunikat', ocen([plik('src/x.ts')], checki=[{'id': 1, 'name': 'q', 'status': 'in_progress'}]), True, 'w toku')
sprawdz('rerun po porazce = liczy najnowszy', ocen([plik('src/x.ts')], checki=[
    {'id': 1, 'name': 'q', 'status': 'completed', 'conclusion': 'failure'},
    {'id': 2, 'name': 'q', 'status': 'completed', 'conclusion': 'success'}]), False)
sprawdz('nowa porazka po starym sukcesie = odmowa', ocen([plik('src/x.ts')], checki=[
    {'id': 2, 'name': 'q', 'status': 'completed', 'conclusion': 'failure'},
    {'id': 1, 'name': 'q', 'status': 'completed', 'conclusion': 'success'}]), True, 'CI nie jest zielone')
sprawdz('same skipped = odmowa', ocen([plik('src/x.ts')], checki=[{'id': 1, 'name': 'q', 'status': 'completed', 'conclusion': 'skipped'}]), True, 'sukcesem')
sprawdz('commit status failure (Vercel) = odmowa', pgm.ocen(PR, REPO, ZIELONE, [plik('src/x.ts')], T1, None, None, False,
        {'state': 'failure', 'total_count': 1, 'statuses': [{'context': 'Vercel', 'state': 'failure'}]}), True, 'commit status czerwony')
sprawdz('commit status pending bez statusow = scala', pgm.ocen(PR, REPO, ZIELONE, [plik('src/x.ts')], T1, None, None, False,
        {'state': 'pending', 'total_count': 0, 'statuses': []}), False)
sprawdz('commit status pending z deployem = odmowa', pgm.ocen(PR, REPO, ZIELONE, [plik('src/x.ts')], T1, None, None, False,
        {'state': 'pending', 'total_count': 1, 'statuses': [{'context': 'Vercel', 'state': 'pending'}]}), True, 'w toku')
sprawdz('konflikt = odmowa', ocen([plik('src/x.ts')], pr={**PR, 'mergeable_state': 'dirty'}), True, 'mergeable_state')

sprawdz('recenzja APPROVE na ten diff = waznA', [r for r in [pgm.ocena_recenzji(AGREGAT, DIFF, DIFF.replace('diff --git', 'diff --git ')) ] if r], False)
sprawdz('recenzja na inny diff = odmowa', [r for r in [pgm.ocena_recenzji(AGREGAT, DIFF, DIFF.replace('+nowe', '+inne'))] if r], True, 'innej zmiany')
sprawdz('recenzja REQUEST CHANGES = odmowa', [r for r in [pgm.ocena_recenzji({**AGREGAT, 'verdict': 'REQUEST CHANGES'}, DIFF, DIFF)] if r], True, 'APPROVE')
sprawdz('recenzja bez rol = odmowa', [r for r in [pgm.ocena_recenzji({**AGREGAT, 'required_roles': []}, DIFF, DIFF)] if r], True, 'rol')
sprawdz('brak recenzji = odmowa', [r for r in [pgm.ocena_recenzji(None, None, DIFF)] if r], True, 'dowodu')
sprawdz('usuniete linie tez skanowane (wyciecie SECURITY DEFINER)', [] if 'SECURITY DEFINER' not in pgm.dodane_linie([plik('x', '-create function f() security definer as $$ $$;'.upper())]) else ['ok'], True)
sprawdz('recenzja tylko code dla T2 = odmowa', [r for r in [pgm.ocena_recenzji({**AGREGAT, 'required_roles': ['code'], 'roles': ['code']}, DIFF, DIFF, ('code', 'ops'))] if r], True, 'ops')
sprawdz('recenzja code wystarcza dla T1', [r for r in [pgm.ocena_recenzji({**AGREGAT, 'required_roles': ['code'], 'roles': ['code']}, DIFF, DIFF, ('code',))] if r], False)

# --- v3: odcisk z naglowkami plikow, tresc `+++` w hunku (code-review v3) ---
INNY_PLIK = DIFF.replace('a/x b/x', 'a/y b/y').replace('--- a/x\n+++ b/x', '--- a/y\n+++ b/y')
sprawdz('ten sam diff w innym pliku = inny odcisk', [] if pgm.odcisk_zmian(DIFF) != pgm.odcisk_zmian(INNY_PLIK) else ['kolizja'], False)
sprawdz('linia +++ w hunku liczy sie do odcisku', [] if pgm.odcisk_zmian(DIFF) != pgm.odcisk_zmian(DIFF + '+++EVIL()\n') else ['kolizja'], False)
sprawdz('index/numery hunkow nie zmieniaja odcisku', [] if pgm.odcisk_zmian(DIFF) == pgm.odcisk_zmian(
    DIFF.replace('+++ b/x\n', '+++ b/x\n').replace('diff --git a/x b/x\n', 'diff --git a/x b/x\nindex 1234567..89abcde 100644\n')
    .replace('@@ -1 +1 @@', '@@ -1,1 +1,1 @@ def f():')) else ['rozjazd'], False)

# --- v3: dowod recenzji = transkrypty subagentow po diff.patch + findings z ich rule_id (code+security review v3) ---
TERAZ = 10_000_000.0
SHA = 'a' * 64
T_CODE = {'role': 'code', 'reviewedAt': TERAZ - 10, 'sid': 's1', 'ruleIds': ['R1'], 'bound': True}
T_OPS = {'role': 'ops', 'reviewedAt': TERAZ - 5, 'sid': 's1', 'ruleIds': [], 'bound': True}
DOWOD = {'transcripts': [T_CODE, T_OPS], 'findings_ids': {'code': ['R1'], 'ops': []}, 'verdicts_mtime': None, 'diff_sha256': SHA}


def dowod(zmiany: dict, wymagane: tuple = ('code', 'ops'), patch: float = TERAZ - 100, sha: str = SHA) -> list[str]:
    return [r for r in [pgm.ocena_dowodu({**DOWOD, **zmiany}, wymagane, patch, TERAZ, sha)] if r]


sprawdz('recenzent z innym diffem w prompcie = odmowa', dowod({'transcripts': [{**T_CODE, 'bound': False}, T_OPS]}), True, 'diff_sha256')
sprawdz('diff.patch podmieniony w trakcie oceny = odmowa', dowod({}, sha='b' * 64), True, 'zmienil')
sprawdz('transkrypt starszy niz 2 h = odmowa', dowod({'transcripts': [{**T_CODE, 'reviewedAt': TERAZ - 3 * 3600 * 1000}, T_OPS]},
        patch=TERAZ - 4 * 3600 * 1000 + 1), True)


sprawdz('transkrypty code+ops po diff.patch = dowod', dowod({}), False)
sprawdz('brak transkryptu = odmowa (pliki napisane recznie)', dowod({'transcripts': []}), True, 'transkryptu')
sprawdz('brak findings roli = odmowa', dowod({'findings_ids': {'code': ['R1']}}), True, 'ops')
sprawdz('transkrypt sprzed diff.patch = odmowa', dowod({'transcripts': [{**T_CODE, 'reviewedAt': TERAZ - 500}, T_OPS]}), True, 'transkryptu')
sprawdz('findings bez rule_id recenzenta = odmowa (podmiana)', dowod({'findings_ids': {'code': [], 'ops': []}}), True, 'podmiana')
sprawdz('recenzenci z roznych sesji = odmowa', dowod({'transcripts': [T_CODE, {**T_OPS, 'sid': 's2'}]}), True, 'sesji')
sprawdz('verdicts.json bez weryfikatora = odmowa', dowod({'verdicts_mtime': TERAZ - 1}), True, 'verifier')
sprawdz('verdicts.json z weryfikatorem = dowod', dowod({'verdicts_mtime': TERAZ - 50, 'transcripts': [
    T_CODE, T_OPS, {'role': 'verifier', 'reviewedAt': TERAZ - 20, 'sid': 's1'}]}), False)
sprawdz('recenzja starsza niz 2 h = odmowa', dowod({}, patch=TERAZ - 3 * 3600 * 1000), True, '2 h')
sprawdz('T1 wymaga code, T2 code+ops', [] if pgm.WYMAGANE_ROLE == {'T1': ('code',), 'T2': ('code', 'ops')} else ['zmiana rol'], False)

# --- v3: T0 tylko czysty tekst, instrukcje agentow, service role, pliki binarne (security-review v3) ---
sprawdz('T0 docs/route.ts -> wymaga recenzji (T1)', [] if pgm.tier_efektywny({'tier': 'T0'}, ['src/app/docs/x/route.ts']) == 'T1' else ['T0'], False)
sprawdz('T0 .mdx/.svg -> T1', [] if pgm.tier_efektywny({'tier': 'T0'}, ['docs/a.mdx', 'docs/b.svg']) == 'T1' else ['T0'], False)
sprawdz('T0 same .md/.txt zostaje T0', [] if pgm.tier_efektywny({'tier': 'T0'}, ['docs/a.md', 'NOTES.txt']) == 'T0' else ['podniesione'], False)
for nazwa in ['CLAUDE.md', 'sub/AGENTS.md', '.claude/settings.json', '.cursorrules', '.github/copilot-instructions.md']:
    sprawdz(f'{nazwa} = zawsze fraza', ocen([plik(nazwa)], tier={'tier': 'T0', 'reasons': []}), True)
sprawdz('SUPABASE_SERVICE_ROLE_KEY lapany lokalnie', [] if pgm.tresc_lokalna('+const k = process.env.SUPABASE_SERVICE_ROLE_KEY') else ['przeoczone'], False)
sprawdz('plik binarny changes=0 bez patcha = odmowa', ocen([{**plik('public/a.png', patch=''), 'changes': 0}]), True, 'bez patcha')

# --- v3: lista plikow obcieta przez API (ops-review v3) ---
sprawdz('changed_files > pobrane = odmowa', ocen([plik('src/x.ts')], pr={**PR, 'changed_files': 3001}), True, 'niepelna')
sprawdz('changed_files zgodne = scala', ocen([plik('src/x.ts')], pr={**PR, 'changed_files': 1}), False)

# --- v3: tier_ryzyka na prawdziwym risk-tier.js (poprawki v2 bez testu — code-review v3) ---
sprawdz('api/billing.ts w korzeniu = T3', [] if pgm.tier_ryzyka(['api/billing.ts'], 5, '')['tier'] == 'T3' else ['nie T3'], False)
sprawdz('plik --lines nie wstrzykuje flagi (5000 linii = T3)',
        [] if pgm.tier_ryzyka(['--lines', 'docs/a.md'], 5000, '')['tier'] == 'T3' else ['wstrzykniecie'], False)
sprawdz('podloga T2 z galezi bazowej podnosi docs', [] if pgm.tier_ryzyka(['docs/a.md'], 3, '', 'T2')['tier'] == 'T2' else ['bez podlogi'], False)
sprawdz('podloga T2 nie obniza T3', [] if pgm.tier_ryzyka(['api/billing.ts'], 3, '', 'T2')['tier'] == 'T3' else ['obnizone'], False)
sprawdz('podloga_tieru czyta pg.tier_floor', [] if (pgm.podloga_tieru('x\npg.tier_floor: T2\n'), pgm.podloga_tieru('nic')) == ('T2', None) else ['zle'], False)


def main_z_atrapa(odpowiedzi: dict[str, Any], put: tuple, tier: str = 'T0', wylacznik: bool = False,
                  recenzja: dict | None = None, flaga: bool = False) -> int:
    """main() bez sieci: api podmienione, log do pliku tymczasowego, tier wymuszony."""
    stare = (pgm.api, pgm.GATE_LOG, pgm.tier_ryzyka, sys.argv, pgm.WYLACZNIK, pgm.dowod_z_przebiegu, pgm.WYLACZONY)
    proby_put = iter([put])

    def api(metoda: str, sciezka: str, cialo: dict | None = None, akceptuj: str = '') -> tuple:
        del cialo
        if akceptuj.endswith('diff'):
            return 200, DIFF
        if metoda == 'PUT':
            return next(proby_put)
        for klucz, wynik in odpowiedzi.items():
            if klucz in sciezka:
                odp: Any = wynik() if callable(wynik) else wynik
                return odp
        return 404, {}

    with tempfile.TemporaryDirectory() as tmp:
        pgm.api, pgm.GATE_LOG, pgm.WYLACZNIK = api, Path(tmp) / 'gates.jsonl', Path(tmp) / 'wylacznik.off'
        if wylacznik:
            pgm.WYLACZNIK.write_text('')
        pgm.tier_ryzyka = lambda *a: {'tier': tier, 'reasons': []}
        pgm.WYLACZONY = flaga
        sys.argv = ['x', REPO, '7', '--repo-path', tmp]
        if recenzja is not None:
            (Path(tmp) / 'diff.patch').write_text(DIFF, encoding='utf-8')
            sha = hashlib.sha256(DIFF.encode('utf-8')).hexdigest()
            pgm.dowod_z_przebiegu = lambda *a: {**recenzja, 'diff_sha256': sha}
            sys.argv += ['--recenzja', tmp]
        try:
            return pgm.main()
        finally:
            pgm.api, pgm.GATE_LOG, pgm.tier_ryzyka, sys.argv, pgm.WYLACZNIK, pgm.dowod_z_przebiegu, pgm.WYLACZONY = stare


ODP = {'/check-runs': (200, {'check_runs': ZIELONE}), '/files': (200, [plik('docs/a.md')]),
       '/status': (200, {'state': 'success', 'total_count': 0, 'statuses': []}), '/contents/': (404, {})}
stan_pr = {'n': 0}


def pr_po_put() -> tuple:
    stan_pr['n'] += 1
    return 200, ({**PR, 'base': {'ref': 'main'}} if stan_pr['n'] == 1 else {**PR, 'merged': True, 'merge_commit_sha': 'm1'})


sprawdz('main: T0 zielone, PUT ok = exit 0', [] if main_z_atrapa({**ODP, '/pulls/7': (200, {**PR, 'base': {'ref': 'main'}})},
        (200, {'merged': True, 'sha': 'm0'})) == 0 else ['exit != 0'], False)
sprawdz('main: PUT zerwany, PR jednak scalony = exit 0', [] if main_z_atrapa({**ODP, '/pulls/7': pr_po_put},
        (-1, {'message': 'blad sieci'})) == 0 else ['exit != 0'], False)
stan_pr['n'] = -10
sprawdz('main: PUT zerwany, PR nie scalony = exit 3 (niepewny)', [] if main_z_atrapa({**ODP, '/pulls/7': (200, {**PR, 'base': {'ref': 'main'}})},
        (-1, {'message': 'blad sieci'})) == 3 else ['exit != 3'], False)
sprawdz('main: T1 bez --recenzja = odmowa exit 1', [] if main_z_atrapa({**ODP, '/pulls/7': (200, {**PR, 'base': {'ref': 'main'}})},
        (200, {'merged': True}), tier='T1') == 1 else ['scalil bez recenzji'], False)
PR_OK = (200, {**PR, 'base': {'ref': 'main', 'repo': {'default_branch': 'main'}}})
sprawdz('main: flaga WYLACZONY = exit 1', [] if main_z_atrapa({}, (200, {'merged': True}), flaga=True) == 1
        else ['scalil mimo flagi'], False)
sprawdz('main: wylacznik istnieje = exit 1 bez wywolan', [] if main_z_atrapa({}, (200, {'merged': True}), wylacznik=True) == 1
        else ['scalil mimo wylacznika'], False)
dowod_ok = {'agg': {**AGREGAT, 'required_roles': ['code'], 'roles': ['code'], 'incomplete': []},
            'transcripts': [{**T_CODE, 'reviewedAt': time.time() * 1000 + 30_000, 'ruleIds': []}], 'findings_ids': {'code': []},
            'verdicts_mtime': None}
ODP_T1 = {**ODP, '/files': (200, [plik('x', patch='@@ -1 +1 @@\n-stare\n+nowe')]), '/pulls/7': PR_OK}

sprawdz('main: T1 z waznym dowodem recenzji = exit 0', [] if main_z_atrapa(
    {**ODP_T1, '/pulls/7': lambda: PR_OK}, (200, {'merged': True, 'sha': 'm2'}), tier='T1', recenzja=dowod_ok) == 0
    else ['blad'], False)
sprawdz('main: head zmienil sie w trakcie oceny = exit 1', [] if main_z_atrapa(
    {**ODP, '/pulls/7': iter([PR_OK, (200, {**PR, 'head': {'sha': 'NOWY', 'repo': {'full_name': REPO}}})]).__next__},
    (200, {'merged': True}), tier='T0') == 1 else ['scalil po zmianie head'], False)
sprawdz('PR do galezi innej niz domyslna = odmowa', ocen([plik('docs/a.md')], tier={'tier': 'T0', 'reasons': []},
        pr={**PR, 'base': {'ref': 'release', 'repo': {'default_branch': 'main'}}}), True, 'galezi')
for nazwa in ['.mcp.json', '.vscode/tasks.json', '.gitmodules', 'bunfig.toml', '.clinerules', '.windsurfrules']:
    sprawdz(f'{nazwa} = zawsze fraza', ocen([plik(nazwa)], tier={'tier': 'T0', 'reasons': []}), True)


def podloga_z_atrapa(kod: int, dane: Any) -> Any:
    stare_api = pgm.api
    pgm.api = lambda *a, **k: (kod, dane)
    try:
        return pgm.podloga_z_bazy(REPO, 'main')
    finally:
        pgm.api = stare_api


sprawdz('podloga_z_bazy: CLAUDE.md z T2', [] if podloga_z_atrapa(200, {'content': base64.b64encode(b'pg.tier_floor: T2').decode()}) == 'T2'
        else ['zle'], False)
sprawdz('podloga_z_bazy: 404 = brak podlogi', [] if podloga_z_atrapa(404, {}) is None else ['zle'], False)
sprawdz('podloga_z_bazy: 500 = T3 (fail-closed)', [] if podloga_z_atrapa(500, {}) == 'T3' else ['zle'], False)

# --- pg-merge-dowod.js na prawdziwym node: findings bez evidence, granica nazwy katalogu, sha w prompcie ---


def dowod_node() -> dict:
    with tempfile.TemporaryDirectory() as tmp:
        run = Path(tmp) / 'pg-review-1'
        run.mkdir()
        (run / 'diff.patch').write_text(DIFF, encoding='utf-8')
        sha = hashlib.sha256(DIFF.encode('utf-8')).hexdigest()
        wazny = {'rule_id': 'R-OK', 'severity': 'minor', 'file': 'x', 'evidence': 'e', 'repro_cmd': 'c', 'claim': 'c',
                 'summary': 's', 'line_range': [1, 1], 'confidence': 0.9}
        (run / 'findings.code.json').write_text(json.dumps({'findings': [wazny, {**wazny, 'rule_id': 'R-STRIP', 'evidence': ''}]}))
        sub = Path(tmp) / 'projects' / 'p' / 'sess' / 'subagents'
        sub.mkdir(parents=True)
        teraz = time.strftime('%Y-%m-%dT%H:%M:%S.000Z', time.gmtime())
        for nazwa, prompt in [('a', f'Diff: {run}/diff.patch diff_sha256={sha}'), ('b', f'Diff: {run}-r2/diff.patch diff_sha256={sha}'),
                              ('c', f'Diff: {run}/diff.patch diff_sha256={"0" * 64}'),
                              ('d', f'Diff: {tmp}/inny.patch diff_sha256={sha} findings do {run}/')]:
            (sub / f'{nazwa}.meta.json').write_text(json.dumps({'agentType': 'code-reviewer'}))
            linie = [{'type': 'user', 'message': {'content': prompt}, 'timestamp': teraz},
                     {'type': 'assistant', 'timestamp': teraz, 'message': {'content': [{'type': 'text', 'text': '"rule_id": "R-STRIP"'}]}}]
            (sub / f'{nazwa}.jsonl').write_text('\n'.join(json.dumps(x, separators=(',', ':')) for x in linie))  # jak harness
        wynik = subprocess.run(['node', str(pgm.DOWOD), str(run), 'code'], capture_output=True, encoding='utf-8', timeout=60,
                               check=False, env={**os.environ, 'PG_PROJECTS_DIR': str(Path(tmp) / 'projects')})
        return json.loads(wynik.stdout or '{}')


D = dowod_node()
sprawdz('node: transkrypt przebiegu -r2 nie liczy sie dla pg-review-1', [] if len(D.get('transcripts', [])) == 3 else [str(D)[:200]], False)
sprawdz('node: przypiety tylko prompt z diff.patch przebiegu I jego sha', [] if sorted(t['bound'] for t in D.get('transcripts', []))
        == [False, False, True]
        else [str(D)[:200]], False)
sprawdz('node: finding bez evidence nie liczy sie jako zachowany', [] if D.get('findings_ids') == {'code': ['R-OK']} else [str(D)[:200]], False)
sprawdz('node: verdicts.json ignorowany (auto-merge tylko przy czystej recenzji)',
        [] if D.get('verdicts_mtime') is None else ['verdicts liczone'], False)
sprawdz('ocena: wyczyszczone evidence = odmowa (podmiana)', [r for r in [pgm.ocena_dowodu(
    {**D, 'transcripts': [t for t in D.get('transcripts', []) if t['bound']]}, ('code',), time.time() * 1000 - 60_000, time.time() * 1000,
    D.get('diff_sha256', ''))]
    if r], True, 'R-STRIP')



def test_decyzje_pg_merge() -> None:
    """Wejscie dla pytest (stop-gate zbiera bin/test_*.py): sprawdzenia wykonuja sie przy imporcie modulu."""
    assert not bledy, bledy


if __name__ == '__main__':
    print('TESTY pg-merge: ' + ('wszystkie OK' if not bledy else f'{len(bledy)} FAIL'))
    sys.exit(1 if bledy else 0)

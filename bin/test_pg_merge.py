#!/usr/bin/env python3
"""Testy rdzenia decyzji pg-merge-bezpieczny.py (bez sieci). Uruchom: python ~/.claude/bin/test_pg_merge.py"""
import base64
import contextlib
import hashlib
import importlib.util
import io
import json
import os
import re
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
RUN_OK = {'id': 77, 'path': '.github/workflows/pg-review.yml', 'run_attempt': 1, 'pull_requests': [{'number': 7}]}
JOB_OK = {'name': 'pg-review', 'status': 'completed', 'conclusion': 'success', 'check_run_url': 'https://api.github.com/repos/o/r/check-runs/9'}


def ci_w(werdykty: list) -> list:
    return [r for r in [pgm.ocena_ci([CI_OK], True, [RUN_OK], {77: [JOB_OK]}, 7,
                                     [(i, w, s if s == '-' or len(s) == 64 else s * 32) for i, w, s in werdykty])] if r]


def ci(checki: list | None = None, wf: bool | None = True, runy: list | None = None, joby: dict | None = None, nr: int = 7) -> list:
    return [r for r in [pgm.ocena_ci([CI_OK] if checki is None else checki, wf, [RUN_OK] if runy is None else runy,
                                     {77: [JOB_OK]} if joby is None else joby, nr, [(77, 'APPROVE', 'a' * 64)])] if r]


GH = {'slug': 'github-actions'}
CI_OK = {'id': 9, 'name': 'pg-review', 'status': 'completed', 'conclusion': 'success', 'app': GH}


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

sprawdz('recenzja APPROVE na ten diff = waznA', [r for r in [pgm.ocena_recenzji(AGREGAT, DIFF, DIFF)] if r], False)
sprawdz('recenzja na inny diff = odmowa', [r for r in [pgm.ocena_recenzji(AGREGAT, DIFF, DIFF.replace('+nowe', '+inne'))] if r], True, 'innej zmiany')
sprawdz('recenzja REQUEST CHANGES = odmowa', [r for r in [pgm.ocena_recenzji({**AGREGAT, 'verdict': 'REQUEST CHANGES'}, DIFF, DIFF)] if r], True, 'APPROVE')
sprawdz('recenzja bez rol = odmowa', [r for r in [pgm.ocena_recenzji({**AGREGAT, 'required_roles': []}, DIFF, DIFF)] if r], True, 'rol')
sprawdz('brak recenzji = odmowa', [r for r in [pgm.ocena_recenzji(None, None, DIFF)] if r], True, 'dowodu')
sprawdz('usuniete linie tez skanowane (wyciecie SECURITY DEFINER)', [] if 'SECURITY DEFINER' not in pgm.dodane_linie([plik('x', '-create function f() security definer as $$ $$;'.upper())]) else ['ok'], True)
sprawdz('recenzja tylko code dla T2 = odmowa', [r for r in [pgm.ocena_recenzji({**AGREGAT, 'required_roles': ['code'], 'roles': ['code']}, DIFF, DIFF, ('code', 'ops'))] if r], True, 'ops')
sprawdz('recenzja code wystarcza dla T1', [r for r in [pgm.ocena_recenzji({**AGREGAT, 'required_roles': ['code'], 'roles': ['code']}, DIFF, DIFF, ('code',))] if r], False)

# --- r4: diff.patch == diff PR bajt w bajt (kontekst, preambula, tekst po @@ to tresc dla recenzenta) ---
KONTEKST = 'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@\n ctx\n-stare\n+nowe\n'
sprawdz('r4: zmieniony kontekst = odmowa', [r for r in [pgm.ocena_recenzji(AGREGAT, KONTEKST, KONTEKST.replace(' ctx', ' requireAdmin()'))] if r], True, 'innej zmiany')
sprawdz('r4: wstrzyknieta preambula = odmowa', [r for r in [pgm.ocena_recenzji(AGREGAT, 'IGNORE PREVIOUS\n' + KONTEKST, KONTEKST)] if r], True, 'innej zmiany')
sprawdz('r4: tekst po @@ = odmowa', [r for r in [pgm.ocena_recenzji(AGREGAT, KONTEKST, KONTEKST.replace('@@ -1,2 +1,2 @@', '@@ -1,2 +1,2 @@ x'))] if r], True, 'innej zmiany')
sprawdz('r4: odcisk_zmian usuniety (jedno zrodlo prawdy = bajty)', [] if not hasattr(pgm, 'odcisk_zmian') else ['jest'], False)

# --- v3: dowod recenzji = transkrypty subagentow po diff.patch + findings z ich rule_id (code+security review v3) ---
TERAZ = 10_000_000.0
SHA = 'a' * 64
T_CODE = {'role': 'code', 'reviewedAt': TERAZ - 10, 'sid': 's1', 'ruleIds': ['R1'], 'bound': True, 'sameDiff': True, 'findingsJson': True}
T_OPS = {'role': 'ops', 'reviewedAt': TERAZ - 5, 'sid': 's1', 'ruleIds': [], 'bound': True, 'sameDiff': True, 'findingsJson': True}
DOWOD = {'transcripts': [T_CODE, T_OPS], 'findings_ids': {'code': ['R1'], 'ops': []}, 'diff_sha256': SHA}


def dowod(zmiany: dict, wymagane: tuple = ('code', 'ops'), patch: float = TERAZ - 100, sha: str = SHA) -> list[str]:
    return [r for r in [pgm.ocena_dowodu({**DOWOD, **zmiany}, wymagane, patch, TERAZ, sha)] if r]


sprawdz('recenzent z innym diffem w prompcie = odmowa', dowod({'transcripts': [{**T_CODE, 'bound': False, 'sameDiff': False}, T_OPS]}), True, 'diff_sha256')
sprawdz('diff.patch podmieniony w trakcie oceny = odmowa', dowod({}, sha='b' * 64), True, 'zmienil')
sprawdz('transkrypt starszy niz 2 h = odmowa', dowod({'transcripts': [{**T_CODE, 'reviewedAt': TERAZ - 3 * 3600 * 1000}, T_OPS]},
        patch=TERAZ - 4 * 3600 * 1000 + 1), True)


sprawdz('transkrypty code+ops po diff.patch = dowod', dowod({}), False)
sprawdz('brak transkryptu = odmowa (pliki napisane recznie)', dowod({'transcripts': []}), True, 'transkryptu')
sprawdz('brak findings roli = odmowa', dowod({'findings_ids': {'code': ['R1']}}), True, 'ops')
sprawdz('r4: transkrypt sprzed mtime diff.patch, ten sam sha = dowod (touch nic nie zmienia)', dowod({'transcripts': [{**T_CODE, 'reviewedAt': TERAZ - 500}, T_OPS]}), False)
sprawdz('r4: ten sam diff tylko z innego RUN (nie bound) = odmowa', dowod({'transcripts': [{**T_CODE, 'bound': False}, T_OPS]}), True, 'swiezego')
sprawdz('r4: stara recenzja tego diffu z blockerem (resampling) = odmowa', dowod({'transcripts': [T_CODE, T_OPS, {**T_CODE, 'sid': 's0', 'bound': False, 'reviewedAt': TERAZ - 5 * 3600 * 1000, 'ruleIds': ['R-OLD']}]}), True, 'ponowne losowanie')
sprawdz('r4: rola opcjonalna z findings usunietymi = odmowa', dowod({'transcripts': [T_CODE, T_OPS, {**T_OPS, 'role': 'security', 'ruleIds': ['S1']}]}), True, 'usuniete findings')
sprawdz('r4: recenzent bez JSON findings = odmowa', dowod({'transcripts': [{**T_CODE, 'findingsJson': False}, T_OPS]}), True, 'JSON')
sprawdz('r5: dwa findingi z jednym rule_id, w findings jeden = odmowa', dowod({'transcripts': [{**T_CODE, 'ruleIds': ['R1'], 'findingKeys': ['R1|a.js', 'R1|b.js']}, T_OPS],
        'findings_ids': {'code': ['R1|b.js'], 'ops': []}}), True, 'R1|a.js')
sprawdz('r5: multizbior zgodny = dowod', dowod({'transcripts': [{**T_CODE, 'ruleIds': ['R1'], 'findingKeys': ['R1|a.js', 'R1|b.js']}, T_OPS],
        'findings_ids': {'code': ['R1|a.js', 'R1|b.js'], 'ops': []}}), False)
sprawdz('r5: przerwany recenzent (bez wyniku i rule_id) starszy niz 2 h nie blokuje', dowod({'transcripts': [T_CODE, T_OPS, {**T_CODE, 'sid': 's0', 'bound': False,
        'findingsJson': False, 'completed': False, 'ruleIds': [], 'reviewedAt': TERAZ - 3 * 3600 * 1000}]}), False)
sprawdz('r6: blocker proza starszy niz 2 h nadal blokuje', dowod({'transcripts': [T_CODE, T_OPS, {**T_CODE, 'sid': 's0', 'bound': False,
        'findingsJson': False, 'completed': True, 'ruleIds': [], 'reviewedAt': TERAZ - 3 * 3600 * 1000}]}), True, 'JSON')
sprawdz('r5: swiezy recenzent bez JSON nadal blokuje', dowod({'transcripts': [T_CODE, T_OPS, {**T_CODE, 'sid': 's0', 'bound': False, 'findingsJson': False, 'ruleIds': []}]}), True, 'JSON')
sprawdz('r5: recenzja TEGO przebiegu bez sha = odmowa', dowod({'transcripts': [T_CODE, T_OPS, {**T_CODE, 'sameDiff': False, 'bound': False,
        'aboutRun': True, 'ruleIds': ['CODE-BLOCKER']}]}), True, 'bez diff_sha256')
sprawdz('r5: recenzent z definicji projektu = odmowa', dowod({'transcripts': [{**T_CODE, 'overridden': True}, T_OPS]}), True, 'definicji agenta')
sprawdz('r4: recenzja innego diffu nie przeszkadza', dowod({'transcripts': [T_CODE, T_OPS, {**T_OPS, 'role': 'security', 'sameDiff': False, 'bound': False, 'ruleIds': ['S1']}]}), False)
sprawdz('findings bez rule_id recenzenta = odmowa (podmiana)', dowod({'findings_ids': {'code': [], 'ops': []}}), True, 'podmiana')
sprawdz('recenzenci z roznych sesji = odmowa', dowod({'transcripts': [T_CODE, {**T_OPS, 'sid': 's2'}]}), True, 'sesji')
sprawdz('recenzja starsza niz 2 h = odmowa', dowod({}, patch=TERAZ - 3 * 3600 * 1000), True, '2 h')
sprawdz('T1 wymaga code, T2 code+ops', [] if pgm.WYMAGANE_ROLE == {'T1': ('code',), 'T2': ('code', 'ops')} else ['zmiana rol'], False)

with tempfile.TemporaryDirectory() as tmp_utf:
    (Path(tmp_utf) / 'diff.patch').write_bytes(b'diff --git a/x b/x\n+\xff\n')
    sprawdz('r5: diff.patch nie-UTF-8 = brak dowodu (strict)', [] if pgm.wczytaj_recenzje(tmp_utf)[0] is None else ['przyjety'], False)

# --- v3: T0 tylko czysty tekst, instrukcje agentow, service role, pliki binarne (security-review v3) ---
sprawdz('T0 docs/route.ts -> wymaga recenzji (T1)', [] if pgm.tier_efektywny({'tier': 'T0'}, ['src/app/docs/x/route.ts']) == 'T1' else ['T0'], False)
sprawdz('T0 .mdx/.svg -> T1', [] if pgm.tier_efektywny({'tier': 'T0'}, ['docs/a.mdx', 'docs/b.svg']) == 'T1' else ['T0'], False)
sprawdz('T0 same .md/.txt zostaje T0', [] if pgm.tier_efektywny({'tier': 'T0'}, ['docs/a.md', 'NOTES.txt']) == 'T0' else ['podniesione'], False)
for nazwa in ['CLAUDE.md', 'sub/AGENTS.md', '.claude/settings.json', '.cursorrules', '.github/copilot-instructions.md']:
    sprawdz(f'{nazwa} = zawsze fraza', ocen([plik(nazwa)], tier={'tier': 'T0', 'reasons': []}), True)
sprawdz('SUPABASE_SERVICE_ROLE_KEY lapany lokalnie', [] if pgm.tresc_lokalna('+const k = process.env.SUPABASE_SERVICE_ROLE_KEY') else ['przeoczone'], False)
sprawdz('gitleaks:allow w dodanej linii = fraza', [] if pgm.tresc_lokalna('+k = "abc"  # gitleaks:allow') else ['przeoczone'], False)
sprawdz('zwykla linia bez znacznika = brak eskalacji', [] if pgm.tresc_lokalna('+const x = 1') is None else ['falszywy alarm'], False)
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
            'transcripts': [{**T_CODE, 'reviewedAt': time.time() * 1000 + 30_000, 'ruleIds': []}], 'findings_ids': {'code': []}}
ODP_T1 = {**ODP, '/files': (200, [plik('x', patch='@@ -1 +1 @@\n-stare\n+nowe')]), '/pulls/7': PR_OK}

sprawdz('main: T1 z waznym dowodem recenzji = exit 0', [] if main_z_atrapa(
    {**ODP_T1, '/pulls/7': lambda: PR_OK}, (200, {'merged': True, 'sha': 'm2'}), tier='T1', recenzja=dowod_ok) == 0
    else ['blad'], False)
ODP_CI = {'/contents/.github/workflows/pg-review.yml': (200, {}),
          '/actions/runs/77/jobs': (200, {'jobs': [JOB_OK, {'name': 'pg-review-runner', 'conclusion': 'success', 'check_run_url': 'x/5'}]}),
          '/actions/workflows/pg-review.yml/runs': (200, {'workflow_runs': [RUN_OK]}), '/annotations': (200, [{'title': 'pg-review-verdict', 'message': 'APPROVE ' + 'a' * 64}]),
          **ODP_T1, '/check-runs': (200, {'check_runs': ZIELONE + [CI_OK]})}
sprawdz('main: T1 z zielonym pg-review w CI (bez --recenzja) = exit 0', [] if main_z_atrapa(
    {**ODP_CI, '/pulls/7': lambda: PR_OK}, (200, {'merged': True, 'sha': 'm3'}), tier='T1') == 0 else ['nie scalil'], False)
sprawdz('main: T1 z czerwonym pg-review = exit 1', [] if main_z_atrapa(
    {**ODP_CI, '/check-runs': (200, {'check_runs': ZIELONE + [{**CI_OK, 'conclusion': 'failure'}]}),
     '/actions/runs/77/jobs': (200, {'jobs': [{**JOB_OK, 'conclusion': 'failure'}]}), '/pulls/7': lambda: PR_OK},
    (200, {'merged': True}), tier='T1') == 1 else ['scalil mimo czerwonego'], False)
sprawdz('main: head zmienil sie w trakcie oceny = exit 1', [] if main_z_atrapa(
    {**ODP, '/pulls/7': iter([PR_OK, (200, {**PR, 'head': {'sha': 'NOWY', 'repo': {'full_name': REPO}}})]).__next__},
    (200, {'merged': True}), tier='T0') == 1 else ['scalil po zmianie head'], False)
sprawdz('PR do galezi innej niz domyslna = odmowa', ocen([plik('docs/a.md')], tier={'tier': 'T0', 'reasons': []},
        pr={**PR, 'base': {'ref': 'release', 'repo': {'default_branch': 'main'}}}), True, 'galezi')
for nazwa in ['.mcp.json', '.vscode/tasks.json', '.gitmodules', 'bunfig.toml', '.clinerules', '.windsurfrules']:
    sprawdz(f'{nazwa} = zawsze fraza', ocen([plik(nazwa)], tier={'tier': 'T0', 'reasons': []}), True)


with tempfile.TemporaryDirectory() as tmp_log:
    stary_log = pgm.GATE_LOG
    pgm.GATE_LOG = Path(tmp_log) / 'gates.jsonl'
    try:
        bufor = io.StringIO()
        with contextlib.redirect_stdout(bufor):
            pgm.odmowa('o/r#1', ['powod'], 'abc', 'T2', True)
            pgm.odmowa('o/r#2', ['powod'], 'abc', 'T1')
            pgm.odmowa('o/r#3', ['siec'], przejsciowe=True)
            pgm.odmowa('o/r#4', ['GitHub'], 'abc', 'T1', zalogowane=True)
        wpisy = [json.loads(x) for x in pgm.GATE_LOG.read_text().splitlines()]
        zdarzenia = [w['event'] for w in wpisy[:2]]
        wyjscie = bufor.getvalue()
    finally:
        pgm.GATE_LOG = stary_log
sprawdz('odmowa: --sprawdz logowany osobno od prawdziwej odmowy', [] if zdarzenia == ['auto-merge-ocena-odmowa', 'auto-merge-odmowa'] else [str(zdarzenia)], False)
sprawdz('odmowa GitHuba: bez drugiego wpisu w logu', [] if len(wpisy) == 3 else [str([w['event'] for w in wpisy])], False)
sprawdz('odmowa: tier w komunikacie i w logu', [] if '(tier T2)' in wyjscie and wpisy[0].get('tier') == 'T2' else [wyjscie[:200]], False)
sprawdz('odmowa: --sprawdz i blad przejsciowy maja wlasna podpowiedz', [] if 'wymagaloby frazy' in wyjscie and 'sprobuj ponownie' in wyjscie else [wyjscie[-200:]], False)


# --- recenzja w CI (check pg-review, 2026-10-04) ---
sprawdz('CI: zielony job pg-review z pg-review.yml = dowod', ci(), False)
sprawdz('CI: brak workflow w bazie = odmowa', ci(wf=False), True, 'galezi bazowej')
sprawdz('CI: blad sprawdzenia workflow = przejsciowy', ci(wf=None), True, 'sprobuj ponownie')
sprawdz('CI: brak przebiegow (blad API) = przejsciowy', [r for r in [pgm.ocena_ci([CI_OK], True, None, None, 7, None)] if r], True, 'sprobuj ponownie')
sprawdz('CI r6: check pg-review z INNEGO workflow (podrobka) = odmowa', ci(checki=[CI_OK, {**CI_OK, 'id': 99}]), True, 'podrobka')
sprawdz('CI r6: brak przebiegu pg-review.yml, sam check = odmowa', ci(runy=[{**RUN_OK, 'path': '.github/workflows/x.yml'}]), True, 'brak przebiegu')
sprawdz('CI r6: rerun (run_attempt 2) = odmowa', ci(runy=[{**RUN_OK, 'run_attempt': 2}]), True, 'rerun')
sprawdz('CI r6: przebieg innego PR = odmowa', ci(nr=8), True, 'nie nalezy')
sprawdz('CI r6: drugi przebieg tego sha czerwony = odmowa', ci(runy=[RUN_OK, {**RUN_OK, 'id': 78}], joby={77: [JOB_OK], 78: [{**JOB_OK, 'conclusion': 'failure'}]}), True, 'failure')
sprawdz('CI: job pg-review skipped (INFRA) = odmowa z podpowiedzia', ci(joby={77: []}), True, 'skipped')
sprawdz('CI: przebieg dla draftu pomijany, zielony po ready = dowod', ci(runy=[{**RUN_OK, 'id': 76}, RUN_OK],
        joby={76: [{'name': 'pg-review-runner', 'conclusion': 'skipped'}], 77: [JOB_OK]}), False)
sprawdz('CI: skipped check pg-review z przebiegu draftu nie jest podrobka', ci(checki=[CI_OK, {**CI_OK, 'id': 8, 'conclusion': 'skipped'}], runy=[{**RUN_OK, 'id': 76}, RUN_OK],
        joby={76: [{'name': 'pg-review-runner', 'conclusion': 'skipped'}, {**JOB_OK, 'conclusion': 'skipped', 'check_run_url': 'x/8'}], 77: [JOB_OK]}), False)
sprawdz('CI: same przebiegi draftu = odmowa z podpowiedzia', ci(joby={77: [{'name': 'pg-review-runner', 'conclusion': 'skipped'}]}), True, 'draftu')
sprawdz('CI: job pg-review skipped (INFRA, realny ksztalt API) = odmowa z podpowiedzia', ci(joby={77: [{**JOB_OK, 'conclusion': 'skipped'}]}), True, 'limit subskrypcji')
sprawdz('CI: przebieg anulowany (concurrency) pomijany', ci(runy=[{**RUN_OK, 'id': 75, 'conclusion': 'cancelled'}, RUN_OK], joby={75: [], 77: [JOB_OK]}), False)
sprawdz('CI r7: werdykt APPROVE w adnotacji, bez historii odrzucen = dowod', ci_w([(77, 'APPROVE', 'aa')]), False)
sprawdz('CI r7: ten sam diff dostal wczesniej REQUEST_CHANGES (pusty commit) = odmowa', ci_w([(70, 'REQUEST_CHANGES', 'aa'), (77, 'APPROVE', 'aa')]), True, 'ponowne losowanie')
sprawdz('CI r7: REQUEST_CHANGES na INNYM diffie innego PR = dowod (ten PR -> _PR odmawia)', ci_w([(70, 'REQUEST_CHANGES', 'bb'), (77, 'APPROVE', 'aa')]), False)
sprawdz('CI r7: brak adnotacji werdyktu dla head = odmowa', ci_w([(70, 'APPROVE', 'aa')]), True, 'adnotacji')
sprawdz('CI r7: blad pobrania historii = przejsciowy', ci_w([(0, 'BLAD', '-')]), True, 'sprobuj ponownie')


def werdykty_atrapa(biezace: list, historia: list, adnotacje: Any) -> list:
    stare = pgm.api
    def api(metoda: str, sciezka: str, cialo: Any = None, akceptuj: str = '') -> tuple:
        del metoda, cialo, akceptuj
        if '%3C' in sciezka:  # przebieg sprzed okna: brak (numeracja okna od #1)
            return 200, {'workflow_runs': []}
        if '/workflows/' in sciezka:  # stronicowanie jak API (bez niego stronicuj krecilby sie przy >= 100 przebiegach)
            nr_strony = re.search(r'[?&]page=(\d+)', sciezka)
            strona = int(nr_strony.group(1)) if nr_strony else 1
            return 200, {'workflow_runs': historia[(strona - 1) * 100:strona * 100],
                         'total_count': max([int(r.get('run_number') or 0) for r in historia] + [0])}
        if '/jobs' in sciezka:
            return 200, {'jobs': [{'name': 'pg-review-runner', 'check_run_url': 'x/5'}]} if 'page=1' in sciezka else (200, {'jobs': []})
        return adnotacje if 'page=1' in sciezka else (200, [])
    pgm.api = api
    try:
        return pgm.werdykty_repo('o/r', biezace)
    finally:
        pgm.api = stare


SHA_A = 'a' * 64
R_OK = {'id': 1, 'conclusion': 'success'}
sprawdz('werdykty_repo: adnotacja biezacego przebiegu', [] if werdykty_atrapa([R_OK], [], (200, [{'title': 'pg-review-verdict', 'message': f'APPROVE {SHA_A}'}]))
        == [(1, 'APPROVE', SHA_A)] else ['parse'], False)
sprawdz('werdykty_repo: odrzucony przebieg z INNEGO PR tez w historii', [] if [w for _, w, _ in werdykty_atrapa([], [{'id': 9, 'conclusion': 'failure'}],
        (200, [{'title': 'pg-review-verdict', 'message': f'REQUEST_CHANGES {SHA_A}'}]))] == ['REQUEST_CHANGES'] else ['brak'], False)
sprawdz('werdykty_repo r10: rerun (run_attempt 2, success) czytany z filter=all -> RC z proby 1 widoczny', [] if [w for _, w, _ in werdykty_atrapa([], [{'id': 9, 'conclusion': 'success', 'run_number': 1, 'run_attempt': 2}],
        (200, [{'title': 'pg-review-verdict', 'message': f'REQUEST_CHANGES {SHA_A}'}]))] == ['REQUEST_CHANGES'] else ['brak'], False)
sprawdz('werdykty_repo r10: >= 1000 przebiegow w oknie (obciecie API) -> LUKA', [] if [w for _, w, _ in werdykty_atrapa([],
        [{'id': i, 'conclusion': 'success', 'run_number': i} for i in range(1, 1001)], (200, []))] == ['LUKA'] else ['brak'], False)


def werdykty_pr_atrapa(nr: int, galaz: str) -> list:
    stare = pgm.api
    run = {'id': 9, 'conclusion': 'failure', 'run_number': 1, 'head_branch': 'feat', 'pull_requests': [{'number': 5}]}
    def api(metoda: str, sciezka: str, cialo: Any = None, akceptuj: str = '') -> tuple:
        del metoda, cialo, akceptuj
        if '%3C' in sciezka:
            return 200, {'workflow_runs': []}
        if '/workflows/' in sciezka:
            return 200, {'workflow_runs': [run], 'total_count': 1}
        if '/jobs' in sciezka:
            return (200, {'jobs': [{'name': 'pg-review-runner', 'check_run_url': 'x/5'}]}) if 'page=1' in sciezka else (200, {'jobs': []})
        return (200, [{'title': 'pg-review-verdict', 'message': f'REQUEST_CHANGES {SHA_A}'}]) if 'page=1' in sciezka else (200, [])
    pgm.api = api
    try:
        return [w for _, w, _ in pgm.werdykty_repo('o/r', [], nr, galaz)]
    finally:
        pgm.api = stare


sprawdz('werdykty_repo: REQUEST_CHANGES tego PR -> REQUEST_CHANGES_PR', [] if 'REQUEST_CHANGES_PR' in werdykty_pr_atrapa(5, 'x') else ['brak'], False)
sprawdz('werdykty_repo: REQUEST_CHANGES tej galezi -> REQUEST_CHANGES_PR', [] if 'REQUEST_CHANGES_PR' in werdykty_pr_atrapa(6, 'feat') else ['brak'], False)
sprawdz('werdykty_repo: REQUEST_CHANGES innego PR i galezi -> bez _PR', [] if 'REQUEST_CHANGES_PR' not in werdykty_pr_atrapa(6, 'inna') else ['jest'], False)
sprawdz('werdykty_repo: obca adnotacja (inny tytul) ignorowana', [] if werdykty_atrapa([R_OK], [], (200, [{'title': 'x', 'message': 'APPROVE 1'}])) == [] else ['obca'], False)
sprawdz('werdykty_repo: nieczytelna adnotacja werdyktu = NIECZYTELNA', [] if [w for _, w, _ in werdykty_atrapa([R_OK], [], (200, [{'title': 'pg-review-verdict', 'message': 'APPROVE x y'}]))]
        == ['NIECZYTELNA'] else ['parse'], False)
sprawdz('werdykty_repo: blad API = BLAD', [] if werdykty_atrapa([R_OK], [], (500, {})) == [(0, 'BLAD', '-')] else ['blad'], False)
sprawdz('CI r8: PR mial juz REQUEST_CHANGES (kosmetyczna zmiana diffu) = odmowa', ci_w([(70, 'REQUEST_CHANGES_PR', 'bb'), (77, 'APPROVE', 'aa')]), True, 'samo CI nie wystarcza')
def werdykty_granica(okno: list, poprzedni: list, kroki: Any = None) -> tuple:
    """Atrapa API: przebiegi w oknie, przebieg sprzed okna, kroki jobu -> (werdykty, czy pobrano adnotacje)."""
    stare = pgm.api
    pobrane = []
    def api(metoda: str, sciezka: str, cialo: Any = None, akceptuj: str = '') -> tuple:
        del metoda, cialo, akceptuj
        if '%3C' in sciezka:
            return 200, {'workflow_runs': poprzedni}
        if '/workflows/' in sciezka:
            return 200, {'workflow_runs': okno if 'page=1' in sciezka else []}
        if '/jobs' in sciezka:
            job = {'name': 'pg-review-runner', 'check_run_url': 'x/5', **({'steps': kroki} if kroki is not None else {})}
            return 200, {'jobs': [job] if 'page=1' in sciezka else []}
        pobrane.append(sciezka)
        return (200, [{'title': 'pg-review-verdict', 'message': f'REQUEST_CHANGES {SHA_A}'}]) if 'page=1' in sciezka else (200, [])
    pgm.api = api
    try:
        return [w for _, w, _ in pgm.werdykty_repo('o/r', [])], bool(pobrane)
    finally:
        pgm.api = stare


OKNO = [{'id': 9, 'run_number': 300, 'conclusion': 'failure'}]
sprawdz('werdykty_repo r11: usuniety przebieg na granicy okna (przed #300 jest #298) -> LUKA', [] if werdykty_granica(OKNO, [{'run_number': 298}])[0] == ['LUKA'] else ['brak'], False)
sprawdz('werdykty_repo r11: granica ciagla (#299) -> historia czytana, RC widoczny', [] if werdykty_granica(OKNO, [{'run_number': 299}])[0] == ['REQUEST_CHANGES'] else ['zle'], False)
sprawdz('werdykty_repo r11: brak przebiegow sprzed okna, okno od #300 -> LUKA', [] if werdykty_granica(OKNO, [])[0] == ['LUKA'] else ['brak'], False)
sprawdz('werdykty_repo r11: krok Werdykt anulowany -> bez wywolania adnotacji', [] if werdykty_granica(OKNO, [{'run_number': 299}], [{'name': 'Werdykt', 'status': 'completed', 'conclusion': 'skipped'}]) == ([], False) else ['pobrano'], False)
sprawdz('werdykty_repo r11: krok Werdykt wykonany -> adnotacje czytane', [] if werdykty_granica(OKNO, [{'run_number': 299}], [{'name': 'Werdykt', 'status': 'completed', 'conclusion': 'success'}])[1] else ['nie pobrano'], False)
sprawdz('werdykty_repo r11: brak kroku Werdykt w jobie (zmieniony workflow) -> adnotacje czytane (fail-closed)', [] if werdykty_granica(OKNO, [{'run_number': 299}], [{'name': 'Inny', 'status': 'completed', 'conclusion': 'success'}])[1] else ['nie pobrano'], False)
sprawdz('CI r9: nieczytelna adnotacja = odmowa trwala', ci_w([(5, 'NIECZYTELNA', 'przebieg #3'), (77, 'APPROVE', 'aa')]), True, 'nie ponawiaj')
sprawdz('CI r8: luka w numeracji przebiegow = odmowa', ci_w([(0, 'LUKA', '-'), (77, 'APPROVE', 'aa')]), True, 'luka')
sprawdz('werdykty_repo: luka w run_number = LUKA', [] if werdykty_atrapa([R_OK], [{'id': 3, 'run_number': 5, 'conclusion': 'success'}, {'id': 2, 'run_number': 3, 'conclusion': 'success'}], (200, []))
        == [(0, 'LUKA', 'brak #4')] else ['luka'], False)
sprawdz('CI: brak historii werdyktow (None) = odmowa, nie pominiecie', [r for r in [pgm.ocena_ci([CI_OK], True, [RUN_OK], {77: [JOB_OK]}, 7, None)] if r], True, 'sprobuj ponownie')
sprawdz('CI: job w toku = odmowa', ci(joby={77: [{**JOB_OK, 'status': 'in_progress', 'conclusion': None}]}), True, 'in_progress')


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
                     {'type': 'assistant', 'timestamp': teraz, 'message': {'content': [{'type': 'text', 'text': '{"findings": [{"rule_id": "R-STRIP"}]}'}]}}]
            (sub / f'{nazwa}.jsonl').write_text('\n'.join(json.dumps(x, separators=(',', ':')) for x in linie))  # jak harness
        wynik = subprocess.run(['node', str(pgm.DOWOD), str(run), 'code'], capture_output=True, encoding='utf-8', timeout=60,
                               check=False, env={**os.environ, 'PG_PROJECTS_DIR': str(Path(tmp) / 'projects')})
        return json.loads(wynik.stdout or '{}')


D = dowod_node()
sprawdz('node r4: recenzja -r2 z tym samym sha widoczna (sameDiff), ale nie bound', [] if len(D.get('transcripts', [])) == 4
        and sorted((t['sameDiff'], t['bound']) for t in D['transcripts']) == [(False, False), (True, False), (True, False), (True, True)]
        else [str(D)[:300]], False)
sprawdz('node: przypiety tylko prompt z diff.patch przebiegu I jego sha', [] if sorted(t['bound'] for t in D.get('transcripts', []))
        == [False, False, False, True]
        else [str(D)[:200]], False)
sprawdz('node: finding bez evidence nie liczy sie jako zachowany', [] if [k.split('|')[0] for k in D.get('findings_ids', {}).get('code', [])] == ['R-OK'] else [str(D)[:200]], False)
sprawdz('node r4: JSON findings recenzenta rozpoznany', [] if all(t.get('findingsJson') for t in D.get('transcripts', [])) else [str(D)[:200]], False)
sprawdz('ocena: wyczyszczone evidence = odmowa (podmiana)', [r for r in [pgm.ocena_dowodu(
    {**D, 'transcripts': [t for t in D.get('transcripts', []) if t['bound']]}, ('code',), time.time() * 1000 - 60_000, time.time() * 1000,
    D.get('diff_sha256', ''))]
    if r], True, 'R-STRIP')



def test_decyzje_pg_merge() -> None:
    """Wejscie dla pytest (stop-gate zbiera bin/test_*.py): sprawdzenia wykonuja sie przy imporcie modulu."""
    assert not bledy, bledy



def werdykt_workflow(wynik: Any, tury: Any = 3, cli: str = 'success') -> tuple:
    """Uruchamia python z kroku Werdykt szablonu pg-review.yml na atrapie out.json -> (werdykt, stdout)."""
    yml = (Path(__file__).parents[1] / 'templates/repo/.github/workflows/pg-review.yml').read_text()
    kod = yml.split("python3 - <<'PY'\n", 1)[1].split('\n          PY\n', 1)[0]
    kod = '\n'.join(linia[10:] for linia in kod.split('\n'))
    with tempfile.TemporaryDirectory() as d:
        diff = b'a\nb\nc\n'
        Path(d, 'diff.patch').write_bytes(diff)
        Path(d, 'diff.sha').write_text(hashlib.sha256(diff).hexdigest() + '\n')
        Path(d, 'out.json').write_text(json.dumps({'result': wynik, 'num_turns': tury}))
        env = {**os.environ, 'RUNNER_TEMP': d, 'GITHUB_OUTPUT': f'{d}/o', 'GITHUB_STEP_SUMMARY': f'{d}/s', 'CLI_OUTCOME': cli}
        r = subprocess.run([sys.executable, '-c', kod], env=env, capture_output=True, text=True, check=False)
        return Path(d, 'o').read_text().strip().removeprefix('verdict='), r.stdout


SHA_D = hashlib.sha256(b'a\nb\nc\n').hexdigest()
def ok_json(v: Any, linii: int, findings: Any = ()) -> str:
    return json.dumps({'verdict': v, 'diff_sha256': SHA_D, 'diff_lines_read': linii, 'findings': list(findings)})


for nazwa, wynik, tury, cli, oczekiwany in [
        ('proza z tokenem REQUEST_CHANGES', 'Verdict: REQUEST_CHANGES', 3, 'success', 'REQUEST_CHANGES'),
        ('proza "I would not reject this" (bez tokenu)', 'Looks fine. I would not reject this.', 3, 'success', 'INFRA'),
        ('JSON APPROVED (kompletny) = APPROVE', ok_json('APPROVED', 3), 3, 'success', 'APPROVE'),
        ('zdanie + blok ```json APPROVE (pilot) = APPROVE', 'Confirmed.\n```json\n' + ok_json('APPROVE', 3) + '\n```', 3, 'success', 'APPROVE'),
        ('zdanie + blok ```json REQUEST_CHANGES = RC', 'Done.\n```json\n' + ok_json('REQUEST_CHANGES', 3) + '\n```', 3, 'success', 'REQUEST_CHANGES'),
        ('JSON verdict null (kompletny) = INFRA', ok_json(None, 3), 3, 'success', 'INFRA'),
        ('JSON verdict null + blocker = RC (ops r11b)', ok_json(None, 3, [{'severity': 'blocker', 'file': 'a', 'evidence': 'e'}]), 3, 'success', 'REQUEST_CHANGES'),
        ('JSON verdict COMMENT + major = RC', ok_json('COMMENT', 3, [{'severity': 'major', 'file': 'a', 'evidence': 'e'}]), 3, 'success', 'REQUEST_CHANGES'),
        ('JSON verdict nieznany "COMMENT" = INFRA', ok_json('COMMENT', 3), 3, 'success', 'INFRA'),
        ('JSON CHANGES_REQUESTED = RC', ok_json('CHANGES_REQUESTED', 3), 3, 'success', 'REQUEST_CHANGES'),
        ('JSON verdict "request changes"', json.dumps({'verdict': 'request changes'}), 3, 'success', 'REQUEST_CHANGES'),
        ('JSON REJECT, 1 tura (RC przed kontrola tur)', json.dumps({'verdict': 'REJECT'}), 1, 'success', 'REQUEST_CHANGES'),
        ('proza bez odrzucenia', 'cannot review', 3, 'success', 'INFRA'),
        ('APPROVE kompletny', ok_json('APPROVE', 3), 3, 'success', 'APPROVE'),
        ('APPROVE niepelny odczyt', ok_json('APPROVE', 2), 3, 'success', 'INFRA'),
        ('APPROVE, claim z "request changes"', ok_json('APPROVE', 3, [{'severity': 'minor', 'file': 'a', 'evidence': 'e', 'claim': 'request changes?'}]), 3, 'success', 'APPROVE'),
        ('APPROVE z major', ok_json('APPROVE', 3, [{'severity': 'major', 'file': 'a', 'evidence': 'e'}]), 3, 'success', 'REQUEST_CHANGES'),
        ('instalacja CLI padla', ok_json('APPROVE', 3), 3, 'failure', 'INFRA'),
        ('num_turns nie-liczba (wyjatek parsera) = INFRA, nie czerwony job', ok_json('APPROVE', 3), 'abc', 'success', 'INFRA'),
        ('proza z {..} przed tokenem REQUEST_CHANGES = RC (ops r12)', 'Konfiguracja {"a": 1} ok, ale Verdict: REQUEST_CHANGES (blocker).', 3, 'success', 'REQUEST_CHANGES'),
        ('null + blocker + niepelny odczyt = RC (ops r12)', ok_json(None, 1, [{'severity': 'blocker', 'file': 'a', 'evidence': 'e'}]), 3, 'success', 'REQUEST_CHANGES'),
        ('APPROVE + major + 1 tura = RC (ops r12)', ok_json('APPROVE', 3, [{'severity': 'major', 'file': 'a', 'evidence': 'e'}]), 1, 'success', 'REQUEST_CHANGES'),
        ('APPROVE + tylko minor + niepelny odczyt = INFRA', ok_json('APPROVE', 1, [{'severity': 'minor', 'file': 'a', 'evidence': 'e'}]), 3, 'success', 'INFRA'),
        ('sprzecznosc: proza REQUEST_CHANGES + JSON APPROVE = RC (code r12)', 'Verdict: REQUEST_CHANGES\n```json\n' + ok_json('APPROVE', 3) + '\n```', 3, 'success', 'REQUEST_CHANGES'),
        ('JSON APPROVE z claim zawierajacym token w srodku obiektu = APPROVE', ok_json('APPROVE', 3, [{'severity': 'minor', 'file': 'a', 'evidence': 'e', 'claim': 'not REQUEST_CHANGES'}]), 3, 'success', 'APPROVE')]:
    w, _ = werdykt_workflow(wynik, tury, cli)
    sprawdz(f'workflow Werdykt: {nazwa} -> {oczekiwany}', [] if w == oczekiwany else [w], False)
_, wyjscie = werdykt_workflow(json.dumps({'verdict': 'APPROVE', 'diff_sha256': SHA_D, 'diff_lines_read': '1\n::error::pwn', 'findings': []}))
sprawdz('workflow Werdykt: test wstrzykniecia dochodzi do sciezki diff_lines_read (nie jest pusty)', [] if 'diff_lines_read nie jest liczba' in wyjscie else ['test pusty'], False)
_, wyjscie_rc = werdykt_workflow(json.dumps({'verdict': 'REQUEST_CHANGES', 'findings': [{'severity': 'major', 'rule_id': 'POWOD-X', 'file': 'a.py', 'line': 3, 'claim': 'zly\n::error::pwn'}]}))
sprawdz('workflow Werdykt: REQUEST_CHANGES pokazuje findings (powod) bez wstrzykniecia', [] if 'POWOD-X' in wyjscie_rc and not [x for x in wyjscie_rc.split('\n') if x.startswith('::') and 'pg-review-verdict' not in x] else ['brak powodu albo wstrzykniecie'], False)
_, wyjscie_tok = werdykt_workflow(json.dumps({'verdict': 'REQUEST_CHANGES', 'findings': [{'severity': 'major', 'rule_id': 'X', 'file': 'a', 'line': 1, 'claim': 'token sk-ant-oat01-abcDEF_123'}]}))
sprawdz('workflow Werdykt (pilot): token sk-ant-* zredagowany na stdout', [] if 'sk-ant-' not in wyjscie_tok and '[REDACTED]' in wyjscie_tok else ['wyciek'], False)
sprawdz('workflow Werdykt r10: tekst LLM bez wstrzykniecia komendy runnera na stdout',
        [linia for linia in wyjscie.split('\n') if linia.startswith('::') and 'pg-review-verdict' not in linia], False)

if __name__ == '__main__':
    print('TESTY pg-merge: ' + ('wszystkie OK' if not bledy else f'{len(bledy)} FAIL'))
    sys.exit(1 if bledy else 0)

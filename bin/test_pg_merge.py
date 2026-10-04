"""Testy rdzenia decyzji pg-merge-bezpieczny.py (bez sieci). Uruchom: python ~/.claude/bin/test_pg_merge.py"""
import importlib.util
import sys
from pathlib import Path

spec = importlib.util.spec_from_file_location('pgm', Path(__file__).with_name('pg-merge-bezpieczny.py'))
assert spec and spec.loader
pgm = importlib.util.module_from_spec(spec)
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



def test_decyzje_pg_merge() -> None:
    """Wejscie dla pytest (stop-gate zbiera bin/test_*.py): sprawdzenia wykonuja sie przy imporcie modulu."""
    assert not bledy, bledy


if __name__ == '__main__':
    print('TESTY pg-merge: ' + ('wszystkie OK' if not bledy else f'{len(bledy)} FAIL'))
    sys.exit(1 if bledy else 0)

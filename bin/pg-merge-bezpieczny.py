#!/usr/bin/env python3
"""Scalenie PR BEZ frazy uzytkownika — tylko gdy zmiana jest rutynowa i w pelni sprawdzona.

Decyzja uzytkownika 2026-10-01: „wylacz reczne wpisywanie, zeby bylo mniej" — rutynowe PR-y ida same; ryzykowne nadal
wymagaja `pozwol ALLOW_MERGE`. Skrypt lezy w warstwie kontrolnej (~/.claude/bin): agent nie zmieni jego warunkow
bez frazy ALLOW_CONTROL_PLANE. Wersja 2 (2026-10-01 wieczor) po pg-review code+ops+security wersji 1;
utwardzony 2026-10-04 w pg-review v3 (3 rundy); wlaczenie po rundzie 4 (poprawka blockera r3 bez recenzji).

Uruchomienie (token z menedzer sekretow (np. Infisical CLI), nigdy w argv):
    python3 ~/infisical/infisical run --env=dev --\
        python3 ~/.claude/bin/pg-merge-bezpieczny.py OWNER/REPO NR --repo-path CHECKOUT [--recenzja KATALOG_PG_REVIEW] [--sprawdz]

`--sprawdz` = tylko ocena (bez scalania; pomija warunek „otwarty/clean") — do testow na historycznych PR.

Scala (squash, przypiety do sprawdzonego SHA) WYLACZNIE gdy WSZYSTKO naraz:
  1. PR otwarty, z tego samego repo (nie fork), mergeable_state == clean,
  2. NAJNOWSZY przebieg kazdego checka zakonczony success/skipped/neutral, co najmniej jeden success,
  3. zadna sciezka (nowa ORAZ stara przy zmianie nazwy) nie jest: lancuchem dostaw/CI/konfiguracja deployu
     (LANCUCH_DOSTAW) ani kodem wrazliwym (ZAWSZE_FRAZA: migracje, dostep, auth, proxy/middleware, configi jakosci),
  4. kazdy plik ma patch (binarny/za duzy diff = nie da sie ocenic tresci -> fraza),
  5. tier z sciezek (risk-tier.js) <= T2 bez powodu T3 ORAZ tresc dodanych linii bez eskalacji T3
     (service_role, platnosci, DROP, GRANT, SECURITY DEFINER, auth.admin),
  6. T1 i T2 tylko z dowodem recenzji (T1: code, T2: code+ops; bez recenzji scala sie wylacznie T0): --recenzja wskazuje przebieg pg-review z verdict APPROVE (bez brakow i
     niezweryfikowanych) ORAZ jego diff.patch ma te same linie +/- co diff PR na GitHubie (recenzja dotyczyla TEJ zmiany).
Inaczej: odmowa z powodem, exit 1. Kazda decyzja trafia do logs/gates.jsonl; brak mozliwosci zapisu logu = odmowa.
Rdzen decyzji (`ocen`) jest czysty i testowany w bin/test_pg_merge.py.
"""
import base64
import hashlib
import json
import os
import random
import re
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

# WYLACZONE 2026-10-01 22:40 po pg-review v2 (security: 4 blockery — wstrzykniecie argv do risk-tier plikiem `--lines`,
# sciezki wzgledne omijaly kotwice T3, tier_floor/phase z checkoutu agenta, T1 bez recenzji); poprawki sa ponizej.
# 2026-10-04: poprawki v3 r1-r8 sa ponizej. WLACZONE 2026-10-04 ~17:15 UTC decyzja uzytkownika („przyjmuje ryzyko, sledze modele na biezaco")
# mimo werdyktu security r8: dowod z transkryptow agenta da sie podrobic (pg/known-limits.md). Wylacznik bez edycji: plik WYLACZNIK.
WYLACZONY = False

CLAUDE = Path.home() / '.claude'
RISK_TIER = CLAUDE / 'hooks' / 'lib' / 'risk-tier.js'
DOWOD = CLAUDE / 'bin' / 'pg-merge-dowod.js'
# Wylacznik bez edycji skryptu (ops-review v3): plik istnieje = kazdy merge znow wymaga frazy. W bin/ (warstwa kontrolna),
# bo w otwartym pg/ agent mogl go skasowac (security-review v3 r2); uzytkownik tworzy/usuwa go w swoim terminalu.
WYLACZNIK = CLAUDE / 'bin' / 'pg-merge-bezpieczny.off'
GATE_LOG = Path(os.environ.get('PG_GATE_LOG') or CLAUDE / 'logs' / 'gates.jsonl')
DOZWOLONE_KONKLUZJE = {'success', 'skipped', 'neutral'}
DOZWOLONE_TIERY = {'T0', 'T1', 'T2'}
# Zaleznosci, CI, hooki gita i konfiguracja deployu: zmiana tu dziala na produkcji bez wzgledu na tresc kodu.
LANCUCH_DOSTAW = re.compile(
    r'(^|/)(package\.json|[^/]*\.lockb?|package-lock\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|npm-shrinkwrap\.json|'
    r'\.npmrc|\.yarnrc[^/]*|\.pnpmfile\.c?js|requirements[^/]*\.(txt|in)|pyproject\.toml|Pipfile[^/]*|setup\.(py|cfg)|'
    r'go\.(mod|sum)|Cargo\.(toml|lock)|Gemfile[^/]*|Dockerfile[^/]*|docker-compose[^/]*\.ya?ml|\.dockerignore|'
    r'vercel\.json|netlify\.toml|wrangler\.toml|fly\.toml|render\.ya?ml|Procfile|\.gitlab-ci\.yml|\.gitattributes)$'
    r'|(^|/)(\.github|\.husky|\.devcontainer)/|(^|/)supabase/config\.toml$', re.IGNORECASE)
# Kod, ktorego bledy trafiaja w dostep/dane/serwer, oraz configi bramek jakosci (zielone CI po ich oslabieniu nic nie dowodzi).
ZAWSZE_FRAZA = re.compile(
    r'(^|/)(migrations?|access|supabase/functions)/|\.sql$|(^|/)(middleware|proxy|instrumentation)\.[cm]?[jt]sx?$'
    r'|(^|/)[^/]*auth[^/]*\.[cm]?[jt]sx?$|(^|/)collections/Users\.|(^|/)\.env[^/]*$'
    r'|(^|/)(payload|next|vite|vitest|playwright|jest|eslint|oxlint|biome|tsconfig|svelte|astro|nuxt)[^/]*\.(c?[jt]s|mjs|json[c5]?)$'
    r'|(^|/)\.oxlintrc[^/]*$|(^|/)\.eslintrc[^/]*$|(^|/)ruff\.toml$|(^|/)\.semgrep[^/]*$|(^|/)\.gitleaks[^/]*$'
    # Instrukcje agentow (security-review v3): CLAUDE.md z `pg.phase: prototype` obniza tier przyszlych zmian, a tresc
    # trafia do kontekstu kazdej sesji (trwaly prompt injection).
    r'|(^|/)(CLAUDE|AGENTS|GEMINI)[^/]*\.md$|(^|/)\.(claude|cursor|windsurf|vscode|idea)/|(^|/)\.(cursorrules|clinerules|windsurfrules)$'
    r'|copilot-instructions\.md$|(^|/)\.mcp\.json$|(^|/)\.gitmodules$|(^|/)bunfig\.toml$|(^|/)\.gemini/'
    r'|(^|/)\.pre-commit-config\.ya?ml$|(^|/)lefthook[^/]*\.ya?ml$|(^|/)(GNU)?[Mm]akefile$|(^|/)renovate\.json5?$',
    re.IGNORECASE)
# T0 bez recenzji tylko dla czystego tekstu (security-review v3: docs/ route.ts, .mdx, .svg dostawaly T0)
TEKST_T0 = re.compile(r'\.(md|txt|rst)$', re.IGNORECASE)
# Uzupelnienie contentEscalation risk-tier.js: `\bservice_role\b` nie lapie SUPABASE_SERVICE_ROLE_KEY (security-review v3).
TRESC_T3_LOKALNA = re.compile(r'service[_-]?role', re.IGNORECASE)


# ---------- czysty rdzen ----------

def sciezki(plik: dict) -> list[str]:
    """Nowa i (przy zmianie nazwy) stara sciezka — przeniesienie pliku z access/ nie moze wyprac wykluczenia."""
    return [s for s in (plik.get('filename'), plik.get('previous_filename')) if s]


def najnowsze_checki(checki: list[dict]) -> list[dict]:
    """Ostatni przebieg per nazwa (rerun po porazce nie blokuje; stary sukces nie maskuje nowej porazki)."""
    najnowsze: dict[str, dict] = {}
    for c in checki:
        stary = najnowsze.get(c.get('name', ''))
        if stary is None or (c.get('id') or 0) > (stary.get('id') or 0):
            najnowsze[c.get('name', '')] = c
    return list(najnowsze.values())


def dodane_linie(pliki: list[dict]) -> str:
    """Linie dodane ORAZ usuniete (wyciecie `SECURITY DEFINER`/weryfikacji tez eskaluje). Patch z API nie ma naglowkow ---/+++."""
    return '\n'.join('+' + l[1:] for p in pliki for l in str(p.get('patch') or '').splitlines() if l[:1] in '+-')


WYMAGANE_ROLE = {'T1': ('code',), 'T2': ('code', 'ops')}

CI_RECENZJA = 'pg-review'
CI_WORKFLOW = '.github/workflows/pg-review.yml'


def ocena_ci(checki: list[dict], workflow_w_bazie: bool | None, przebiegi: list[dict] | None,
             joby: dict | None, nr: int, werdykty: list[tuple[int, str, str]] | None) -> str | None:
    """Recenzja poza kontrola agenta (2026-10-04): zielony job `pg-review` z workflow `.github/workflows/pg-review.yml`
    (Actions API: sciezka przebiegu, numer PR, PIERWSZA proba). Kazdy check run o nazwie pg-review spoza tych jobow =
    odmowa (security-review: check run da sie utworzyc GITHUB_TOKEN-em z innego workflow). Wszystkie przebiegi tego
    workflow dla head musza byc zielone (rerun do skutku nie dziala). None = dowod jest; inaczej powod."""
    if workflow_w_bazie is None:
        return f'nie sprawdzono {CI_WORKFLOW} na galezi bazowej (blad sieci/GitHuba) — sprobuj ponownie'
    if not workflow_w_bazie:
        return f'brak {CI_WORKFLOW} na galezi bazowej (bin/mas-quality-init.sh)'
    if przebiegi is None or joby is None:
        return 'nie pobrano przebiegow Actions (blad sieci/GitHuba) — sprobuj ponownie'
    runy = [r for r in przebiegi if r.get('path') == CI_WORKFLOW]
    if not runy:
        return f'brak przebiegu {CI_WORKFLOW} dla head PR (sekret CLAUDE_CODE_OAUTH_TOKEN w repo? draft? sama dokumentacja?)'
    if any(int(r.get('run_attempt') or 1) != 1 for r in runy):
        return f'{CI_RECENZJA} uruchomiony ponownie (rerun) — recenzja nie jest jednorazowa; nowy commit albo fraza uzytkownika'
    if nr and any(nr not in [p.get('number') for p in r.get('pull_requests') or []] for r in runy):
        return f'przebieg {CI_WORKFLOW} nie nalezy do tego PR'
    # Przebieg dla draftu (runner skipped przez `draft == false`) nie jest recenzja — pomijany, nie blokuje (code-review).
    # + przebiegi anulowane przez concurrency (reopened/ready_for_review na tym samym sha) — tez bez dowodu i bez blokady.
    draft = {r.get('id') for r in runy if r.get('conclusion') == 'cancelled' or any(
        j.get('name') == 'pg-review-runner' and j.get('conclusion') == 'skipped' for j in joby.get(r.get('id')) or [])}
    nasze: set[str] = {str(j.get('check_run_url') or '').rstrip('/').rsplit('/', 1)[-1]   # checki naszego workflow (takze draft)
                        for r in runy for j in joby.get(r.get('id')) or [] if j.get('name') == CI_RECENZJA}
    runy = [r for r in runy if r.get('id') not in draft]
    if not runy:
        return f'{CI_RECENZJA}: tylko przebiegi dla draftu — oznacz PR jako gotowy (ready for review)'
    for r in runy:
        prj = [j for j in joby.get(r.get('id')) or [] if j.get('name') == CI_RECENZJA]
        if not prj:
            return (f'{CI_RECENZJA}: skipped w przebiegu {r.get("id")} (brak sekretu, limit subskrypcji albo diff > 1500 linii — '
                    'szczegoly w jobie pg-review-runner)')
        zle = [j for j in prj if j.get('status') != 'completed' or j.get('conclusion') != 'success']
        if zle and zle[0].get('conclusion') == 'skipped':
            return (f'{CI_RECENZJA}: skipped (brak sekretu, limit subskrypcji, timeout albo diff > 1500 linii — '
                    'szczegoly w jobie pg-review-runner; nowy commit uruchomi recenzje ponownie)')
        if zle:
            return f"check {CI_RECENZJA}: {zle[0].get('conclusion') or zle[0].get('status')}"
    # Historia PR (werdykty runnerow z adnotacji): REQUEST_CHANGES na TYM SAMYM diffie co biezacy APPROVE = losowanie
    # recenzji od nowa (pusty commit / reopen / usuniety przebieg) — odmowa (security-review 2026-10-04, best-of-N).
    for _, w, opis in werdykty or []:
        if w == 'LUKA':
            return (f'luka w historii {CI_WORKFLOW} ({opis}): usuniety przebieg albo obciecie API — dowod CI niewiarygodny; '
                    'stan trwaly (nie ponawiaj): --recenzja albo fraza uzytkownika')
        if w == 'NIECZYTELNA':
            return (f'nieczytelna adnotacja werdyktu ({opis}) — stan trwaly (nie ponawiaj): --recenzja albo fraza uzytkownika')
    if werdykty is not None and any(w == 'REQUEST_CHANGES_PR' for _, w, _ in werdykty):
        return ('ten PR dostal juz REQUEST_CHANGES od recenzenta CI — samo CI nie wystarcza (losowanie przez kosmetyczna zmiane); '
                'lokalna recenzja --recenzja albo fraza uzytkownika')
    if werdykty is None or any(w == 'BLAD' for _, w, _ in werdykty):
        return 'nie pobrano historii werdyktow PR (blad sieci/GitHuba) — sprobuj ponownie'
    teraz = {sha for rid, w, sha in werdykty or [] if rid in {r.get('id') for r in runy} and w == 'APPROVE'}
    if not teraz:
        return (f'brak adnotacji werdyktu w przebiegu {CI_WORKFLOW} dla head — dowod niepelny '
                '(stary workflow? zaktualizuj pg-review.yml z ~/.claude/templates/repo)')
    odrzucone = sorted({sha for _, w, sha in werdykty if w == 'REQUEST_CHANGES' and sha in teraz})
    if odrzucone:
        return (f'ten sam diff (sha256 {odrzucone[0][:12]}…) dostal juz REQUEST_CHANGES w historii repo — ponowne losowanie '
                'recenzji; popraw kod (nowy diff) albo fraza uzytkownika')
    obce = [c for c in checki if c.get('name') == CI_RECENZJA and str(c.get('id')) not in nasze]
    if obce:
        return f'check {CI_RECENZJA} spoza {CI_WORKFLOW} (id {obce[0].get("id")}) — mozliwa podrobka, scalenie tylko z fraza'
    return None


WERDYKT_RX = re.compile(r'^(APPROVE|REQUEST_CHANGES|INFRA) ([0-9a-f]{64}|-)$')


OKNO_HISTORII_DNI = 90


def werdykty_repo(repo: str, biezace: list[dict], nr: int = 0, galaz: str = '') -> list[tuple[int, str, str]]:
    """(id przebiegu, werdykt, sha diffu albo opis) z adnotacji `pg-review-verdict` jobu pg-review-runner. Historia z CALEGO
    repo (nowy PR z tym samym diffem nie zeruje odrzucen), WSZYSTKIE przebiegi z OKNO_HISTORII_DNI dni (security r9: okno
    100 ostatnich dalo sie zapchac pustymi commitami). Kosztowne (joby + adnotacje) tylko biezace + nie-success.
    Werdykty pseudo: LUKA (usuniety przebieg w oknie albo obciecie API), NIECZYTELNA (adnotacja spoza formatu), BLAD (siec/API)."""
    sciezka = f'/repos/{repo}/actions/workflows/{CI_WORKFLOW.rsplit("/", 1)[-1]}/runs'
    try:
        od = (datetime.now(timezone.utc) - timedelta(days=OKNO_HISTORII_DNI)).strftime('%Y-%m-%d')
        wszystkie = stronicuj(f'{sciezka}?created=%3E%3D{od}', 'workflow_runs')
        # Zapytanie z filtrem `created` GitHub obcina do 1000 wynikow (strona 11 = 200 z pusta lista; security/data r10) —
        # obcieta historia moze ukrywac REQUEST_CHANGES, wiec fail-closed.
        if len(wszystkie) >= 1000:
            return [(0, 'LUKA', f'ponad 1000 przebiegow w {OKNO_HISTORII_DNI} dni — historia obcieta przez API')]
        numery = sorted({int(r['run_number']) for r in wszystkie if r.get('run_number')})
        brak = sorted(set(range(numery[0], numery[-1] + 1)) - set(numery)) if numery else []
        if brak:
            return [(0, 'LUKA', 'brak #' + ', #'.join(map(str, brak[:5])))]
        # Usuniety przebieg na GRANICY okna (najstarszy w oknie): ostatni przebieg sprzed okna musi miec numer o 1 mniejszy.
        # Tylko okno, nie cala historia (data r10: globalny detektor = trwala LUKA po starym kasowaniu albo retencji GitHuba).
        # Zalozenie: workflow ma wylacznie trigger pull_request (inaczej numeracja ma dziury — known-limits).
        if numery:
            kod, dane = api('GET', f'{sciezka}?created=%3C{od}&per_page=1')
            if kod != 200 or not isinstance(dane, dict):
                return [(0, 'BLAD', '-')]
            poprzedni = int(((dane.get('workflow_runs') or [{}])[0]).get('run_number') or 0)
            if poprzedni != numery[0] - 1:
                return [(0, 'LUKA', f'granica okna: przed #{numery[0]} jest #{poprzedni or "brak"}')]
        # Rerun nadpisuje conclusion proby 1 (security r9): przebieg z run_attempt > 1 czytany zawsze, joby WSZYSTKICH prob
        # (`filter=all`) — adnotacja RC z proby 1 zostaje widoczna. Rerun po INFRA to zwykla operacja, nie powod do LUKA (code r10).
        odrzucone = [r for r in wszystkie if r.get('conclusion') not in ('success', 'skipped') or int(r.get('run_attempt') or 1) > 1]
        wynik: list[tuple[int, str, str]] = []
        for r in {r.get('id'): r for r in biezace + odrzucone}.values():
            for j in stronicuj(f"/repos/{repo}/actions/runs/{r.get('id')}/jobs?filter=all", 'jobs'):
                if j.get('name') != 'pg-review-runner':
                    continue
                # Adnotacja powstaje tylko w kroku Werdykt — gdy sie nie wykonal (anulowany przez concurrency), adnotacji brak,
                # wiec bez wywolania API (koszt, data r10). Brak kroku o tej nazwie (zmiana workflow) = pobierz (fail-closed).
                werdykty_kroku = [k for k in j.get('steps') or [] if k.get('name') == 'Werdykt']
                if werdykty_kroku and all(k.get('status') != 'completed' or k.get('conclusion') in ('skipped', 'cancelled')
                                          for k in werdykty_kroku):
                    continue
                cid = str(j.get('check_run_url') or '').rstrip('/').rsplit('/', 1)[-1]
                for a in stronicuj(f'/repos/{repo}/check-runs/{cid}/annotations') if cid else []:
                    if a.get('title') != 'pg-review-verdict':
                        continue
                    rid = int(r.get('id') or 0)
                    trafienie = WERDYKT_RX.match(str(a.get('message', '')).strip())
                    if not trafienie:
                        return [(rid, 'NIECZYTELNA', f"przebieg #{r.get('run_number')} (id {rid})")]  # fail-closed
                    wynik.append((rid, trafienie.group(1), trafienie.group(2)))
                    ten_pr = (nr and nr in [p.get('number') for p in r.get('pull_requests') or []]) or (galaz and r.get('head_branch') == galaz)
                    if trafienie.group(1) == 'REQUEST_CHANGES' and ten_pr:
                        wynik.append((rid, 'REQUEST_CHANGES_PR', trafienie.group(2)))
        return wynik
    except SystemExit:
        return [(0, 'BLAD', '-')]


def przebiegi_ci(repo: str, sha: str) -> tuple[list[dict] | None, dict | None]:
    """Przebiegi workflow pg-review dla head + ich joby (Actions API); (None, None) = blad przejsciowy."""
    # Endpoint workflow + stronicowanie (data-review: /actions/runs bez paginacji gubil przebiegi przy > 100 na sha).
    runy = [r for r in stronicuj(f'/repos/{repo}/actions/workflows/{CI_WORKFLOW.rsplit("/", 1)[-1]}/runs?head_sha={sha}&event=pull_request',
                                 'workflow_runs') if r.get('path') == CI_WORKFLOW]
    joby: dict = {}
    for r in runy:
        kj, dj = api('GET', f"/repos/{repo}/actions/runs/{r.get('id')}/jobs?per_page=100")
        if kj != 200 or not isinstance(dj, dict):
            return None, None
        joby[r.get('id')] = dj.get('jobs') or []
    return runy, joby


def workflow_w_bazie(repo: str, ref: str) -> bool | None:
    """True = jest, False = 404, None = blad przejsciowy (siec/5xx) — nie mylic z brakiem workflow (ops-review)."""
    kod, _ = api('GET', f'/repos/{repo}/contents/{CI_WORKFLOW}?ref={urllib.parse.quote(ref)}')
    return True if kod == 200 else False if kod == 404 else None


def ocena_recenzji(agregat: dict | None, diff_recenzji: str | None, diff_pr: str, wymagane: tuple[str, ...] = ('code', 'ops')) -> str | None:
    """None = recenzja wazna dla TEJ zmiany; inaczej powod odmowy."""
    if agregat is None or diff_recenzji is None:
        return 'brak dowodu recenzji (--recenzja KATALOG_PG_REVIEW: diff.patch + findings + transkrypty recenzentow)'
    if agregat.get('verdict') != 'APPROVE' or agregat.get('incomplete') or agregat.get('needs_verification'):
        return f"recenzja nie jest APPROVE (verdict={agregat.get('verdict')})"
    brak = sorted(set(wymagane) - set(agregat.get('required_roles') or []) | set(wymagane) - set(agregat.get('roles') or []))
    if brak:
        return f"recenzja bez wymaganych rol: {', '.join(brak)} (pg-aggregate --tier <tier> --final)"
    # Bajt w bajt (oba boki dekodowane STRICT utf-8): kontekst, preambula i tekst po `@@` tez sa trescia, ktora
    # widzial recenzent (security-review r4 AUTOMERGE-DIFF-CONTEXT-NOT-FINGERPRINTED). diff.patch = `gh pr diff NR`.
    if diff_recenzji != diff_pr:
        return 'recenzja dotyczyla innej zmiany niz obecny diff PR (diff.patch != `gh pr diff` bajt w bajt)'
    return None


MAX_WIEK_RECENZJI_MS = 2 * 3600 * 1000  # jak MAX_RUN_AGE_MS w pg-self-approve.js


def ocena_dowodu(dowod: dict, wymagane: tuple[str, ...], patch_mtime_ms: float, teraz_ms: float,
                 diff_sha256: str = '') -> str | None:
    """Lustro pg-self-approve.transcriptProblem (JS). None = dowod jest: kazda recenzja tego diffu (sha w prompcie, dowolny
    RUN i wiek) oddala JSON findings, a jej rule_id i multizbior `rule_id|plik` sa w findings przebiegu; kazda wymagana rola
    ma swiezy (< 2 h, z `timestamp` JSONL) transkrypt przypiety sha + sciezka diff.patch; recenzja TEGO przebiegu bez sha
    albo z definicji agenta w projekcie = odmowa. Werdykt liczy pg-aggregate od nowa (verdicts.json ignorowany).
    `diff_sha256` = sha diff.patch przeczytanego przez TEN skrypt (porownany bajtowo z diffem PR)."""
    if not diff_sha256 or dowod.get('diff_sha256') != diff_sha256:
        return 'diff.patch zmienil sie w trakcie oceny — powtorz'
    if teraz_ms - patch_mtime_ms > MAX_WIEK_RECENZJI_MS or patch_mtime_ms - teraz_ms > 60_000:
        return 'recenzja starsza niz 2 h (albo diff.patch z przyszlosci) — powtorz pg-review'
    transkrypty = dowod.get('transcripts') or []
    ids = dowod.get('findings_ids') or {}
    # Kazda recenzja TEGO diffu (dowolny katalog przebiegu, dowolny wiek): JSON findings + jej rule_id w findings przebiegu
    # (security-review r4: resampling w nowym RUN / `touch diff.patch`, usuniete findings roli opcjonalnej, wyjscie proza).
    for t in transkrypty:
        if not (t.get('sameDiff') or t.get('aboutRun')):
            continue
        if t.get('overridden'):
            return f'{t.get("role")} (sesja {t.get("sid")}) z definicji agenta w projekcie (.claude/agents poza ~/.claude) — recenzent musi byc z ~/.claude/agents'
        if t.get('role') != 'verifier' and not t.get('sameDiff'):
            return (f'{t.get("role")}-reviewer (sesja {t.get("sid")}) recenzowal ten przebieg bez diff_sha256 obecnego diff.patch — '
                    'nowy diff = nowy katalog RUN; recenzja bez sha nie znika z dowodu')
    recenzenci = [t for t in transkrypty if t.get('role') != 'verifier' and t.get('sameDiff')]
    for t in recenzenci:
        rola = str(t.get('role'))
        if not t.get('findingsJson'):
            # tylko naprawde przerwany (brak wyniku koncowego i rule_id), > 2 h, nie blokuje; proza blokuje (data-review r5/r6)
            if not t.get('completed') and not t.get('ruleIds') and teraz_ms - float(t.get('reviewedAt') or 0) > MAX_WIEK_RECENZJI_MS:
                continue
            return (f'{rola}-reviewer (sesja {t.get("sid")}) nie oddal JSON {{"findings": [...]}} dla tego diffu — wyjscie nieczytelne '
                    'nie jest dowodem; zmien diff albo poczekaj, az przerwany transkrypt bedzie starszy niz 2 h')
        if rola not in ids:
            return f'transkrypt {rola}-reviewer dla tego diffu bez findings.{rola}.json w przebiegu — usuniete findings'
        # multizbior kluczy `rule_id|plik` (data-review r5: dwa findingi z jednym rule_id, orkiestrator zostawial jeden)
        mam = Counter(ids[rola])
        zgubione = sorted(set(t.get('ruleIds') or []) - {str(k).split('|')[0] for k in ids[rola]})
        zgubione += sorted(k for k, n in Counter(t.get('findingKeys') or []).items() if mam[k] < n)
        if zgubione:
            return (f'findings.{rola}.json nie zawiera findings recenzenta ({", ".join(zgubione[:5])}) — podmiana albo '
                    'ponowne losowanie recenzji tego samego diffu')
    sesje: set[str] = set()
    for rola in wymagane:
        swieze = [t for t in recenzenci if t.get('role') == rola and t.get('bound')
                  and -60_000 <= teraz_ms - float(t.get('reviewedAt') or 0) <= MAX_WIEK_RECENZJI_MS]
        if not swieze:
            if any(t.get('role') == rola and not t.get('sameDiff') for t in transkrypty):
                return (f'prompt {rola}-reviewer nie zawiera diff_sha256={diff_sha256[:12]}… i sciezki diff.patch tego przebiegu — '
                        'recenzent dostal inny diff (pg-review: `diff_sha256=$(sha256sum diff.patch)` w prompt findera)')
            return f'brak swiezego (< 2 h) transkryptu subagenta {rola}-reviewer dla tego diffu — odpal recenzenta'
        sesje.update(str(t.get('sid')) for t in swieze)
    if len(sesje) != 1:
        return f'recenzenci z roznych sesji ({", ".join(sorted(sesje))})'
    return None


def tier_efektywny(tier: dict, nazwy: list[str]) -> str:
    """T0 scala sie bez recenzji tylko, gdy KAZDY plik to czysty tekst (.md/.txt/.rst); inaczej wymaga recenzji jak T1."""
    t = str(tier.get('tier'))
    return 'T1' if t == 'T0' and not all(TEKST_T0.search(n) for n in nazwy) else t


def tresc_lokalna(dodane: str) -> str | None:
    m = TRESC_T3_LOKALNA.search(dodane)
    return m.group(0) if m else None


def ocen(pr: dict, repo: str, checki: list[dict], pliki: list[dict], tier: dict, tresc_t3: str | None,
         powod_recenzji: str | None, tylko_ocena: bool = False, statusy: dict | None = None) -> list[str]:
    """Lista powodow odmowy; pusta = mozna scalic bez frazy."""
    powody: list[str] = []
    if not tylko_ocena and (pr.get('state') != 'open' or pr.get('merged')):
        powody.append('PR nie jest otwarty')
    if not tylko_ocena and pr.get('mergeable_state') != 'clean':
        powody.append(f"mergeable_state={pr.get('mergeable_state')} (konflikt, nieaktualny z main albo checki w toku)")
    if ((pr.get('head') or {}).get('repo') or {}).get('full_name', '').lower() != repo.lower():
        powody.append('PR z forka/innego repo')
    aktualne = najnowsze_checki(checki)
    if not aktualne:
        powody.append('brak checkow CI')
    w_toku = [c['name'] for c in aktualne if c.get('status') != 'completed']
    if w_toku:
        powody.append('checki w toku (sprobuj pozniej): ' + ', '.join(w_toku[:5]))
    zle = [f"{c['name']}={c.get('conclusion')}" for c in aktualne
           if c.get('status') == 'completed' and c.get('conclusion') not in DOZWOLONE_KONKLUZJE]
    if zle:
        powody.append('CI nie jest zielone: ' + ', '.join(zle[:5]))
    if aktualne and not any(c.get('conclusion') == 'success' for c in aktualne):
        powody.append('zaden check nie zakonczyl sie sukcesem')
    wszystkie = [s for p in pliki for s in sciezki(p)]
    if not wszystkie:
        powody.append('PR bez plikow')
    if pr.get('changed_files') is not None and len(pliki) != int(pr['changed_files']):
        powody.append(f"lista plikow niepelna ({len(pliki)} z {pr['changed_files']}; limit API) — tresci nie da sie ocenic")
    lancuch = sorted({s for s in wszystkie if LANCUCH_DOSTAW.search(s)})
    if lancuch:
        powody.append('zaleznosci/CI/deploy: ' + ', '.join(lancuch[:5]))
    wrazliwe = sorted({s for s in wszystkie if ZAWSZE_FRAZA.search(s)})
    if wrazliwe:
        powody.append('kod wrazliwy (dostep/auth/migracje/config): ' + ', '.join(wrazliwe[:5]))
    bez_patcha = [p['filename'] for p in pliki if not p.get('patch')]  # binarne maja changes=0 (security-review v3)
    if bez_patcha:
        powody.append('pliki bez patcha (binarne/za duze — tresci nie da sie ocenic): ' + ', '.join(bez_patcha[:5]))
    t3 = [r for r in tier.get('reasons', []) if str(r).startswith('T3')]
    if tier.get('tier') not in DOZWOLONE_TIERY or t3:
        powody.append(f"tier {tier.get('tier')}: " + '; '.join((t3 or tier.get('reasons', []))[:4]))
    if tresc_t3:
        powody.append(f'tresc T3 w dodanych liniach: {tresc_t3}')
    # Klasyczne commit statuses (np. deploy preview Vercela) obok check-runs (ops-review 2026-10-01).
    st = statusy or {}
    if st.get('state') in ('failure', 'error'):
        powody.append('commit status czerwony: ' + ', '.join(f"{s.get('context')}={s.get('state')}" for s in st.get('statuses', [])[:5]))
    elif st.get('state') == 'pending' and st.get('total_count', 0):
        powody.append('commit status w toku (sprobuj pozniej)')
    baza = pr.get('base') or {}
    domyslna = (baza.get('repo') or {}).get('default_branch')
    if domyslna and baza.get('ref') != domyslna:
        powody.append(f"PR do galezi {baza.get('ref')} (nie {domyslna}) — gałezie deployowe tylko z fraza")
    if any(s.startswith(('-', '/')) for s in wszystkie):
        powody.append('podejrzana nazwa pliku (zaczyna sie od - albo /)')
    # v3: T1 tez wymaga dowodu recenzji (stop-gate wymaga code-reviewera od T1); bez recenzji scala sie tylko T0.
    if tier.get('tier') in ('T1', 'T2') and powod_recenzji:
        powody.append(powod_recenzji)
    return powody


# ---------- powloka (siec, procesy, log) ----------

def api(metoda: str, sciezka: str, cialo: dict | None = None, akceptuj: str = 'application/vnd.github+json') -> tuple[int, Any]:
    token = os.environ.get('GITHUB_Token')
    if not token:
        raise SystemExit('Brak GITHUB_Token — uruchom przez most: infisical run --env=dev --')
    req = urllib.request.Request(
        f'https://api.github.com{sciezka}', method=metoda,
        data=json.dumps(cialo).encode() if cialo is not None else None,
        headers={'Accept': akceptuj, 'Authorization': f'Bearer {token}',
                 'User-Agent': 'pg-merge-bezpieczny', 'X-GitHub-Api-Version': '2022-11-28'})
    for proba in range(3):
        try:
            with urllib.request.urlopen(req, timeout=30) as odp:
                bajty = odp.read()
                if akceptuj.endswith('diff'):
                    try:  # STRICT: porownanie z diff.patch ma byc bajtowe (r4), zly UTF-8 = brak diffu (fail-closed)
                        return odp.status, bajty.decode('utf-8')
                    except UnicodeDecodeError:
                        return 0, None
                surowe = bajty.decode('utf-8', 'replace')
                try:
                    return odp.status, json.loads(surowe)
                except ValueError:  # 200 z HTML-em (proxy/awaria) — nie traceback; PUT bez JSON = wynik niepewny
                    return (-1 if metoda != 'GET' else 0), {'message': 'odpowiedz GitHuba nie jest JSON'}
        except urllib.error.HTTPError as e:
            limit = e.code == 403 and e.headers.get('retry-after') is not None  # secondary rate limit (ops-review v3)
            if (e.code in (429, 500, 502, 503, 504) or limit) and metoda == 'GET' and proba < 2:
                czekaj = str(e.headers.get('retry-after') or '')
                time.sleep(min(int(czekaj), 60) if czekaj.isdigit() else 2 ** proba * 3 + random.uniform(0, 2))
                continue
            try:
                return e.code, json.load(e)
            except ValueError:
                return e.code, {}
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            # Blad sieci: GET ponawiamy; PUT NIE (GitHub mogl juz scalic) — wynik niepewny, wolajacy sprawdza stan PR.
            if metoda == 'GET' and proba < 2:
                time.sleep(2 ** proba * 3 + random.uniform(0, 2))
                continue
            return -1, {'message': f'blad sieci: {e}'}
    return 0, {}


def stronicuj(sciezka: str, klucz: str | None = None) -> list:
    wynik, strona = [], 1
    while True:
        kod, dane = api('GET', f'{sciezka}{"&" if "?" in sciezka else "?"}per_page=100&page={strona}')
        if kod != 200:
            loguj('auto-merge-blad', f'GitHub {kod} dla {sciezka}', sciezka)
            raise SystemExit(f'GitHub {kod} dla {sciezka} (blad sieci/limitu — to nie jest ocena PR)')
        elementy = dane.get(klucz, []) if klucz else dane
        wynik.extend(elementy)
        if len(elementy) < 100:
            return wynik
        strona += 1


def loguj(zdarzenie: str, powod: str, cel: str, **dodatkowe: str) -> bool:
    wpis = {'ts': datetime.now(timezone.utc).isoformat(), 'hook': 'pg-merge-bezpieczny', 'event': zdarzenie,
            'reason': powod, 'target': cel, **dodatkowe}
    try:
        with GATE_LOG.open('a', encoding='utf-8') as f:
            f.write(json.dumps(wpis, ensure_ascii=False) + '\n')
        return True
    except OSError as e:
        print(f'UWAGA: nie zapisano logu bramek ({e})', file=sys.stderr)
        return False


def podloga_tieru(claude_md: str) -> str | None:
    """`pg.tier_floor: Tn` z CLAUDE.md GALEZI BAZOWEJ (deklaracja wlasciciela repo, nie checkout agenta)."""
    m = re.search(r'pg\.tier_floor:\s*(T[0-3])', claude_md)
    return m.group(1) if m else None


def tier_ryzyka(nazwy: list[str], linie: int, root: str, podloga: str | None = None) -> dict:
    # v3 (security-review v2): (a) sciezki z '/' na poczatku — kotwice T3_PATH_RX (`/api/`, `/billing/`) dzialaja tez w
    # korzeniu repo, a nazwa pliku `--lines` nie wstrzyknie flagi do argv; (b) root = pusty katalog tymczasowy, NIE checkout
    # agenta — jego CLAUDE.md (pg.phase prototype) obnizal tier. `root` z argv zostaje tylko dla zgodnosci wywolan.
    # (c) ops-review v3: podloga z galezi bazowej trafia do pustego katalogu jako JEDYNA linia CLAUDE.md (bez pg.phase).
    del root
    try:
        with tempfile.TemporaryDirectory() as pusty:
            if podloga:
                (Path(pusty) / 'CLAUDE.md').write_text(f'pg.tier_floor: {podloga}\n', encoding='utf-8')
            wynik = subprocess.run(['node', str(RISK_TIER), pusty, *['/' + n.lstrip('/') for n in nazwy], '--lines', str(linie)],
                                   capture_output=True, encoding='utf-8', timeout=60, check=False, cwd=pusty)
        return json.loads(wynik.stdout)
    except (OSError, ValueError, subprocess.TimeoutExpired) as e:
        return {'tier': 'T3', 'reasons': [f'T3: risk-tier nie odpowiedzial ({str(e)[:80]})']}


def tresc_eskalacja(dodane: str) -> str | None:
    skrypt = ("const rt=require(process.argv[1]);let s='';process.stdin.on('data',d=>s+=d)"
              ".on('end',()=>process.stdout.write(JSON.stringify(rt.contentEscalation(s))))")
    try:
        wynik = subprocess.run(['node', '-e', skrypt, str(RISK_TIER)], input=dodane, capture_output=True,
                               encoding='utf-8', timeout=60, check=False)
        return json.loads(wynik.stdout)
    except (OSError, ValueError, subprocess.TimeoutExpired):
        return 'risk-tier contentEscalation nie odpowiedzial'


def wczytaj_recenzje(katalog: str | None) -> tuple[str | None, float, str]:
    """diff.patch przebiegu + jego mtime. aggregated.json NIE jest czytany — werdykt liczy sie od nowa z findings."""
    if not katalog:
        return None, 0.0, ''
    try:
        patch = Path(katalog) / 'diff.patch'
        surowe = patch.read_bytes()
        return surowe.decode('utf-8'), patch.stat().st_mtime * 1000, hashlib.sha256(surowe).hexdigest()
    except (OSError, UnicodeDecodeError):  # STRICT utf-8 jak diff PR z api() — porownanie bajtowe (r4)
        return None, 0.0, ''


def dowod_z_przebiegu(katalog: str, wymagane: tuple[str, ...]) -> dict | None:
    """bin/pg-merge-dowod.js: agregacja od nowa z waznych findings + transkrypty przypiete do sha256 diff.patch."""
    try:
        wynik = subprocess.run(['node', str(DOWOD), str(Path(katalog).resolve()), ','.join(wymagane)],
                               capture_output=True, encoding='utf-8', timeout=120, check=False)
        dane = json.loads(wynik.stdout)
    except (OSError, ValueError, subprocess.TimeoutExpired) as e:
        print(f'UWAGA: dowod recenzji nieczytelny ({str(e)[:120]})', file=sys.stderr)
        return None
    return dane if isinstance(dane, dict) else None


def podloga_z_bazy(repo: str, ref: str) -> str | None:
    """CLAUDE.md z galezi bazowej przez API; brak pliku = brak podlogi, inny blad = T3 (fail-closed)."""
    kod, dane = api('GET', f'/repos/{repo}/contents/CLAUDE.md?ref={urllib.parse.quote(ref)}')
    if kod == 404:
        return None
    if kod != 200 or not isinstance(dane, dict):
        return 'T3'
    try:
        return podloga_tieru(base64.b64decode(dane.get('content', '')).decode('utf-8', 'replace'))
    except ValueError:
        return 'T3'


def odmowa(cel: str, powody: list[str], sha: str = '', tier: str = '', sprawdz: bool = False, przejsciowe: bool = False,
           zalogowane: bool = False) -> int:
    """`--sprawdz` loguje osobne zdarzenie (statystyki prawdziwych odmow nie rosna od testow); tier w komunikacie;
    blad przejsciowy (siec, head w ruchu, log) podpowiada ponowienie, nie fraze (ops-review 2026-10-04)."""
    zdarzenie = 'auto-merge-ocena-odmowa' if sprawdz else 'auto-merge-odmowa'
    if not zalogowane:  # odmowa GitHuba ma juz wlasny wpis auto-merge-github-odmowa — bez podwojnego liczenia
        loguj(zdarzenie, ' | '.join(powody), cel, head_sha=sha, tier=tier)
    if przejsciowe:
        dalej = 'Blad przejsciowy — sprobuj ponownie (fraza nie jest potrzebna).'
    elif sprawdz:
        dalej = 'Scalenie wymagaloby frazy uzytkownika: pozwol ALLOW_MERGE.'
    else:
        dalej = 'Ten PR wymaga frazy uzytkownika: pozwol ALLOW_MERGE.'
    print(f"NIE SCALAM {cel}{f' (tier {tier})' if tier else ''}:\n  - " + '\n  - '.join(powody) + '\n' + dalej)
    return 1


def argument(argumenty: list[str], nazwa: str) -> str | None:
    if nazwa not in argumenty:
        return None
    i = argumenty.index(nazwa)
    if i + 1 >= len(argumenty) or argumenty[i + 1].startswith('--'):
        raise SystemExit(f'{nazwa} wymaga wartosci')
    return argumenty[i + 1]


def main() -> int:
    argumenty = sys.argv[1:]
    if (WYLACZONY or WYLACZNIK.exists()) and '--sprawdz' not in argumenty:
        print(f'pg-merge-bezpieczny: WYLACZONY (flaga albo {WYLACZNIK}) — uzyj `pozwol ALLOW_MERGE`.')
        return 1
    if len(argumenty) < 2 or not re.fullmatch(r'[\w.-]+/[\w.-]+', argumenty[0]) or not argumenty[1].isdigit():
        print('Uzycie: pg-merge-bezpieczny.py OWNER/REPO NR --repo-path SCIEZKA [--recenzja KATALOG] [--sprawdz]')
        return 2
    repo, nr = argumenty[0], int(argumenty[1])
    root = argument(argumenty, '--repo-path') or str(Path.cwd())
    cel = f'{repo}#{nr}'
    tylko_ocena = '--sprawdz' in argumenty

    kod, pr = api('GET', f'/repos/{repo}/pulls/{nr}')
    if kod != 200:
        return odmowa(cel, [f'nie odczytano PR (HTTP {kod})'], sprawdz=tylko_ocena, przejsciowe=True)
    sha = pr['head']['sha']
    checki = stronicuj(f'/repos/{repo}/commits/{sha}/check-runs', 'check_runs')
    pliki = stronicuj(f'/repos/{repo}/pulls/{nr}/files')
    nazwy = sorted({s for p in pliki for s in sciezki(p)})
    linie = sum(int(p.get('additions', 0)) + int(p.get('deletions', 0)) for p in pliki)
    tier = tier_ryzyka(nazwy, linie, root, podloga_z_bazy(repo, (pr.get('base') or {}).get('ref', '')))
    tier = {**tier, 'tier': tier_efektywny(tier, nazwy)}
    powod_recenzji = None
    if tier.get('tier') in ('T1', 'T2'):
        katalog = argument(argumenty, '--recenzja')
        if not katalog:
            # Bez lokalnego przebiegu: dowodem moze byc tylko check pg-review z CI (swiezy checkout, poza kontrola agenta).
            wf = workflow_w_bazie(repo, (pr.get('base') or {}).get('ref', ''))
            przebiegi, joby = przebiegi_ci(repo, sha) if wf else (None, None)
            werdykty = werdykty_repo(repo, przebiegi, nr, str((pr.get('head') or {}).get('ref', ''))) if wf and przebiegi else None
            powod_ci = ocena_ci(checki, wf, przebiegi, joby, nr, werdykty)
            powod_recenzji = None if powod_ci is None else f'brak dowodu recenzji: {powod_ci} (albo --recenzja KATALOG_PG_REVIEW)'
        kod_diff, diff_pr = api('GET', f'/repos/{repo}/pulls/{nr}', akceptuj='application/vnd.github.v3.diff') if katalog else (0, None)
        diff_recenzji, patch_mtime, diff_sha = wczytaj_recenzje(katalog)
        wymagane = WYMAGANE_ROLE[tier['tier']]
        dowod = dowod_z_przebiegu(katalog, wymagane) if katalog and diff_recenzji is not None else None
        if not katalog:
            pass  # powod_recenzji ustalony wyzej z checku CI
        elif kod_diff == 0 and diff_pr is None:
            powod_recenzji = 'diff PR nie jest poprawnym UTF-8 — porownanie bajtowe z diff.patch niemozliwe'
        elif kod_diff != 200 or not isinstance(diff_pr, str):
            powod_recenzji = f'nie pobrano diffu PR (HTTP {kod_diff})'
        else:
            powod_recenzji = ocena_recenzji(dowod and dowod.get('agg'), diff_recenzji, diff_pr, wymagane)
        if powod_recenzji is None and dowod is not None:
            powod_recenzji = ocena_dowodu(dowod, wymagane, patch_mtime, time.time() * 1000, diff_sha)
    kod_st, statusy = api('GET', f'/repos/{repo}/commits/{sha}/status')
    if kod_st != 200:
        return odmowa(cel, [f'nie odczytano commit status (HTTP {kod_st})'], sha, str(tier.get('tier', '')), tylko_ocena, przejsciowe=True)
    dodane = dodane_linie(pliki)
    powody = ocen(pr, repo, checki, pliki, tier, tresc_eskalacja(dodane) or tresc_lokalna(dodane), powod_recenzji, tylko_ocena, statusy)
    if powody:
        return odmowa(cel, powody, sha, str(tier.get('tier', '')), tylko_ocena)

    if tylko_ocena:
        print(f"OCENA {cel}: MOZNA scalic bez frazy (tier {tier.get('tier')}, {len(nazwy)} plikow)")
        return 0
    # Lista plikow i checki dotycza `sha`; push w trakcie oceny = inna zmiana (security-review v3: ABA) — PUT i tak przypiety.
    kod_teraz, pr_teraz = api('GET', f'/repos/{repo}/pulls/{nr}')
    if kod_teraz != 200 or (pr_teraz.get('head') or {}).get('sha') != sha:
        return odmowa(cel, ['head PR zmienil sie w trakcie oceny — uruchom ponownie'], sha, str(tier.get('tier', '')), przejsciowe=True)
    if not loguj('auto-merge-start', f"tier {tier.get('tier')}", cel, head_sha=sha):
        return odmowa(cel, ['log bramek niezapisywalny — bez sladu nie scalam'], sha, str(tier.get('tier', '')), przejsciowe=True)
    kod, wynik = api('PUT', f'/repos/{repo}/pulls/{nr}/merge', {'merge_method': 'squash', 'sha': sha})
    if kod in (-1, 500, 502, 503, 504):  # zerwane polaczenie / 5xx przy PUT — GitHub mogl jednak scalic, sprawdz
        kod_stan, stan = api('GET', f'/repos/{repo}/pulls/{nr}')
        if kod_stan == 200 and stan.get('merged'):
            kod, wynik = 200, {'merged': True, 'sha': stan.get('merge_commit_sha', '')}
        else:
            loguj('auto-merge-niepewny', str(wynik.get('message', ''))[:120], cel, head_sha=sha)
            print(f'WYNIK NIEPEWNY {cel}: {wynik.get("message")}. Sprawdz recznie stan PR (guard_health pokaze RED).')
            return 3
    if kod != 200 or not wynik.get('merged'):
        loguj('auto-merge-github-odmowa', f"HTTP {kod}: {str(wynik.get('message', ''))[:120]}", cel, head_sha=sha)
        return odmowa(cel, [f"GitHub odmowil scalenia (HTTP {kod}): {str(wynik.get('message', ''))[:120]}"], sha, str(tier.get('tier', '')), zalogowane=True)
    merge_sha = str(wynik.get('sha', ''))
    loguj('auto-merge', f"tier {tier.get('tier')}, {len(nazwy)} plikow", cel, head_sha=sha, merge_sha=merge_sha)
    print(f"SCALONO {cel} (tier {tier.get('tier')}) merge={merge_sha[:7]}\n"
          f"Cofniecie: git revert {merge_sha[:7]} na main (nowy PR), nie force-push.")
    return 0


if __name__ == '__main__':
    sys.exit(main())

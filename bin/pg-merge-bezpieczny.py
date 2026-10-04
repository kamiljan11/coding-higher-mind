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
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# WYLACZONE 2026-10-01 22:40 po pg-review v2 (security: 4 blockery — wstrzykniecie argv do risk-tier plikiem `--lines`,
# sciezki wzgledne omijaly kotwice T3, tier_floor/phase z checkoutu agenta, T1 bez recenzji); poprawki sa ponizej.
# 2026-10-04: poprawki v3 r1-r3 sa ponizej; r3 znalazla blocker (verdicts.json) — naprawiony, czeka na runde 4. Do tego czasu fraza.
WYLACZONY = True

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


def odcisk_zmian(diff: str) -> str:
    """Odcisk: linie `diff --git` (ktore pliki) + linie +/- wewnatrz hunkow — porownywalny miedzy `git diff` a diffem
    z GitHuba (index/mode/numery hunkow pomijane). `---`/`+++` poza hunkiem = naglowek pliku, w hunku = tresc
    (code-review v3: linia `+++EVIL()` i inny plik z tymi samymi liniami nie moga dac tego samego odcisku)."""
    linie: list[str] = []
    w_hunku = False
    for surowa in diff.splitlines():
        linia = surowa.rstrip('\r')
        if linia.startswith('diff --git '):
            linie.append(' '.join(linia.split()))
            w_hunku = False
        elif linia.startswith('@@'):
            w_hunku = True
        elif w_hunku and linia[:1] in '+-':
            linie.append(linia)
    return hashlib.sha256('\n'.join(linie).encode('utf-8')).hexdigest()


WYMAGANE_ROLE = {'T1': ('code',), 'T2': ('code', 'ops')}


def ocena_recenzji(agregat: dict | None, diff_recenzji: str | None, diff_pr: str, wymagane: tuple[str, ...] = ('code', 'ops')) -> str | None:
    """None = recenzja wazna dla TEJ zmiany; inaczej powod odmowy."""
    if agregat is None or diff_recenzji is None:
        return 'brak dowodu recenzji (--recenzja KATALOG_PG_REVIEW: diff.patch + findings + transkrypty recenzentow)'
    if agregat.get('verdict') != 'APPROVE' or agregat.get('incomplete') or agregat.get('needs_verification'):
        return f"recenzja nie jest APPROVE (verdict={agregat.get('verdict')})"
    brak = sorted(set(wymagane) - set(agregat.get('required_roles') or []) | set(wymagane) - set(agregat.get('roles') or []))
    if brak:
        return f"recenzja bez wymaganych rol: {', '.join(brak)} (pg-aggregate --tier <tier> --final)"
    if odcisk_zmian(diff_recenzji) != odcisk_zmian(diff_pr):
        return 'recenzja dotyczyla innej zmiany niz obecny diff PR'
    return None


MAX_WIEK_RECENZJI_MS = 2 * 3600 * 1000  # jak MAX_RUN_AGE_MS w pg-self-approve.js


def ocena_dowodu(dowod: dict, wymagane: tuple[str, ...], patch_mtime_ms: float, teraz_ms: float,
                 diff_sha256: str = '') -> str | None:
    """Recenzje zrobili prawdziwi subagenci PO zapisaniu diff.patch, findings zawieraja wszystko, co zglosili, a werdykt
    jest policzony od nowa z findings (pg-aggregate), nie wziety z aggregated.json — te same reguly co
    pg-self-approve.evaluate (code+security review v3: dwa pliki napisane recznie nie sa dowodem). None = dowod jest.
    `dowod` = wynik bin/pg-merge-dowod.js; `diff_sha256` = sha diff.patch przeczytanego przez TEN skrypt (porownany z
    diffem PR) — musi byc tym, ktory dostali recenzenci w prompcie (security-review v3 r2: recenzja przypieta do tresci)."""
    if not diff_sha256 or dowod.get('diff_sha256') != diff_sha256:
        return 'diff.patch zmienil sie w trakcie oceny — powtorz'
    if teraz_ms - patch_mtime_ms > MAX_WIEK_RECENZJI_MS or patch_mtime_ms - teraz_ms > 60_000:
        return 'recenzja starsza niz 2 h (albo diff.patch z przyszlosci) — powtorz pg-review'
    transkrypty = dowod.get('transcripts') or []
    ids = dowod.get('findings_ids') or {}
    sesje: set[str] = set()
    for rola in wymagane:
        swieze = [t for t in transkrypty if t.get('role') == rola and float(t.get('reviewedAt') or 0) >= patch_mtime_ms
                  and teraz_ms - float(t.get('reviewedAt') or 0) <= MAX_WIEK_RECENZJI_MS]
        if not swieze or rola not in ids:
            return f'brak transkryptu subagenta {rola}-reviewer (albo findings.{rola}.json) dla tego przebiegu — odpal recenzenta'
        swieze = [t for t in swieze if t.get('bound')]
        if not swieze:
            return (f'prompt {rola}-reviewer nie zawiera diff_sha256={diff_sha256[:12]}… — recenzent dostal inny diff '
                    '(pg-review: wpisz `diff_sha256=$(sha256sum diff.patch)` w prompt findera)')
        zgubione = sorted({r for t in swieze for r in (t.get('ruleIds') or [])} - set(ids[rola]))
        if zgubione:
            return f'findings.{rola}.json nie zawiera findings recenzenta ({", ".join(zgubione[:5])}) — podmiana po recenzji'
        sesje.update(str(t.get('sid')) for t in swieze)
    if dowod.get('verdicts_mtime') is not None:
        wer = [t for t in transkrypty if t.get('role') == 'verifier'
               and float(t.get('reviewedAt') or 0) >= float(dowod['verdicts_mtime']) - 2000]
        if not wer:
            return 'verdicts.json bez transkryptu subagenta verifier — werdykty wydaje weryfikator, nie orkiestrator'
        sesje.update(str(t.get('sid')) for t in wer)
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
                surowe = odp.read().decode('utf-8', 'replace')
                if akceptuj.endswith('diff'):
                    return odp.status, surowe
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
        return surowe.decode('utf-8', 'replace'), patch.stat().st_mtime * 1000, hashlib.sha256(surowe).hexdigest()
    except OSError:
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


def odmowa(cel: str, powody: list[str], sha: str = '') -> int:
    loguj('auto-merge-odmowa', ' | '.join(powody), cel, head_sha=sha)
    print(f'NIE SCALAM {cel}:\n  - ' + '\n  - '.join(powody) + '\nTen PR wymaga frazy uzytkownika: pozwol ALLOW_MERGE.')
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
        return odmowa(cel, [f'nie odczytano PR (HTTP {kod})'])
    sha = pr['head']['sha']
    checki = stronicuj(f'/repos/{repo}/commits/{sha}/check-runs', 'check_runs')
    pliki = stronicuj(f'/repos/{repo}/pulls/{nr}/files')
    nazwy = sorted({s for p in pliki for s in sciezki(p)})
    linie = sum(int(p.get('additions', 0)) + int(p.get('deletions', 0)) for p in pliki)
    tier = tier_ryzyka(nazwy, linie, root, podloga_z_bazy(repo, (pr.get('base') or {}).get('ref', '')))
    tier = {**tier, 'tier': tier_efektywny(tier, nazwy)}
    powod_recenzji = None
    if tier.get('tier') in ('T1', 'T2'):
        kod_diff, diff_pr = api('GET', f'/repos/{repo}/pulls/{nr}', akceptuj='application/vnd.github.v3.diff')
        katalog = argument(argumenty, '--recenzja')
        diff_recenzji, patch_mtime, diff_sha = wczytaj_recenzje(katalog)
        wymagane = WYMAGANE_ROLE[tier['tier']]
        dowod = dowod_z_przebiegu(katalog, wymagane) if katalog and diff_recenzji is not None else None
        if kod_diff != 200 or not isinstance(diff_pr, str):
            powod_recenzji = f'nie pobrano diffu PR (HTTP {kod_diff})'
        else:
            powod_recenzji = ocena_recenzji(dowod and dowod.get('agg'), diff_recenzji, diff_pr, wymagane)
        if powod_recenzji is None and dowod is not None:
            powod_recenzji = ocena_dowodu(dowod, wymagane, patch_mtime, time.time() * 1000, diff_sha)
    kod_st, statusy = api('GET', f'/repos/{repo}/commits/{sha}/status')
    if kod_st != 200:
        return odmowa(cel, [f'nie odczytano commit status (HTTP {kod_st})'], sha)
    dodane = dodane_linie(pliki)
    powody = ocen(pr, repo, checki, pliki, tier, tresc_eskalacja(dodane) or tresc_lokalna(dodane), powod_recenzji, tylko_ocena, statusy)
    if powody:
        return odmowa(cel, powody, sha)

    if tylko_ocena:
        print(f"OCENA {cel}: MOZNA scalic bez frazy (tier {tier.get('tier')}, {len(nazwy)} plikow)")
        return 0
    # Lista plikow i checki dotycza `sha`; push w trakcie oceny = inna zmiana (security-review v3: ABA) — PUT i tak przypiety.
    kod_teraz, pr_teraz = api('GET', f'/repos/{repo}/pulls/{nr}')
    if kod_teraz != 200 or (pr_teraz.get('head') or {}).get('sha') != sha:
        return odmowa(cel, ['head PR zmienil sie w trakcie oceny — uruchom ponownie'], sha)
    if not loguj('auto-merge-start', f"tier {tier.get('tier')}", cel, head_sha=sha):
        return odmowa(cel, ['log bramek niezapisywalny — bez sladu nie scalam'], sha)
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
        return odmowa(cel, [f"GitHub odmowil scalenia (HTTP {kod}): {str(wynik.get('message', ''))[:120]}"], sha)
    merge_sha = str(wynik.get('sha', ''))
    loguj('auto-merge', f"tier {tier.get('tier')}, {len(nazwy)} plikow", cel, head_sha=sha, merge_sha=merge_sha)
    print(f"SCALONO {cel} (tier {tier.get('tier')}) merge={merge_sha[:7]}\n"
          f"Cofniecie: git revert {merge_sha[:7]} na main (nowy PR), nie force-push.")
    return 0


if __name__ == '__main__':
    sys.exit(main())

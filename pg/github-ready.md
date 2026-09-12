# PG · GITHUB-READY — standard „obcy wchodzi na repo i widzi, ze wiemy, co robimy" (2026-09-05)

Decyzja uzytkownika 2026-09-05: PG v3 wchodzi do ISTNIEJACYCH repo (uchylenie zasady „nie sprzatamy starego dlugu"
z 2026-08-09 dla tej akcji). Forma: WYLACZNIE PR-y na branchu `chore/pg-v3-github-ready` — zero pushy na main,
zero merge'y (merguje uzytkownik), zero przepisywania historii, zero sekretow, zero suppression-as-fix.
Miernik: `node ~/.claude/bin/repo-readiness.js --repo <sciezka>` (0 tokenow) PRZED i PO — wynik do opisu PR.

## Co widzi obcy w 90 sekund (checklista = punkty scorera)

| # | Element | Kryterium „senior" | how_to_check |
|---|---|---|---|
| R1 | README.md | co to jest (3 zdania, dla kogo, status: production / prototype / archived = `pg.phase`), **jak uruchomic w 15 min** (komendy, `.env.example`), stack z wersjami, jak testowac, jak deployowac (Lovable Publish vs Vercel push), link do ARCHITECTURE, badge CI, **gdzie zyja zadania i zakres** (link: Obsidian / issues / `docs/SCOPE.md` — pierwsze pytanie obcego wg slownika SH), srodowiska (dev/preview/prod z refami baz), koszty cykliczne (kto placi) | sekcje: `## `-naglowki; `rg -n "npm (i|ci|run dev)|pnpm" README.md`; `rg -n "Zadania i zakres|Srodowiska|Koszty" README.md` |
| R2 | Badge CI ZIELONY | czerwony badge = gorzej niz brak; CI red w 37–100 % runow floty (A3) | `python ~/.claude/bin/mas_ci_check.py` / Actions API; lokalnie: lint + tsc + test + build exit 0 |
| R3 | `docs/ARCHITECTURE.md` | 1 strona: moduly, przeplyw danych (mermaid), „gdzie jest X", tiery | plik istnieje, > 25 linii, ma ```mermaid |
| R4 | `docs/adr/` | >= 1 REALNY ADR (nie szablon) opisujacy decyzje juz podjete w repo (stack, hosting, auth, platnosci) z odrzucona alternatywa | `ls docs/adr \| grep -v 0000` >= 1 |
| R5 | `CHANGELOG.md` | `[Unreleased]` + wpisy nie starsze niz ostatni `feat` w `git log` | porownaj daty |
| R6 | `.github/` | `workflows/quality.yml` (tsc -b), `pull_request_template.md` | pliki istnieja |
| R7 | LICENSE + wlasnosc | jawna licencja (klient/komercyjne: `All rights reserved` + nazwa; OSS: MIT) — brak = niejasny status prawny; **`pg.ownership` w CLAUDE.md spojne z LICENSE** (client-transferred => nazwa klienta w LICENSE; mas-saas/client-licensed => PG; oss => MIT/Apache) — slownik SH: przeniesienie praw vs licencja to dwie rozne umowy | plik istnieje; `node ~/.claude/bin/repo-readiness.js --repo .` R7 |
| R8 | `.env.example` | kazda zmienna z komentarzem, bez wartosci | `rg -c "=" .env.example`; brak wartosci po `=` |
| R9 | Higiena | brak sekretow (gitleaks), brak `node_modules`/`dist`/`.env` w repo, `.gitignore` sensowny | `git ls-files \| rg "^(dist\|node_modules\|\.env$)"` = 0 |
| R10 | Kod | lint 0 bledow, `tsc -b`/`--noEmit` 0 bledow, testy przechodza i istnieja (nie tylko szablon), brak nowych `as any`/pustych `catch` | lib/lint-file; fleet-metrics |
| R11 | Struktura | katalogi wg domeny (`features/<x>`), brak plikow > 1000 linii (albo wpis w `docs/quality/BACKLOG.md` z planem podzialu) | fleet-metrics largeFiles |
| R12 | Commity | conventional od tego PR-a; opis PR wg szablonu (komenda + wynik) | `git log --oneline -20` |
| R13 | SQL (jesli sa migracje) | 0 nowych HIGH; stare HIGH wypisane w `docs/quality/BACKLOG.md` jako dlug T3 z decyzja | `node ~/.claude/bin/sql-migration-lint.js --repo . --min-severity high` |
| R14 | Status projektu | prototyp/archiwum ma to napisane w 1. linii README; nie udajemy produkcji; `pg.phase` w CLAUDE.md = to samo slowo (prototype/poc/mvp/production/maintenance/handoff) — rozjazd README vs CLAUDE.md = 0 pkt | README badge/status; `rg -n "pg.phase" CLAUDE.md` |

## Procedura per repo (agent-wykonawca; sonnet; read+write TYLKO w worktree)

0. **Worktree, nie checkout** (inne sesje pracuja na tych samych klonach — pamiec `parallel-sessions-shared-checkout`):
   `git -C <repo> fetch origin && git -C <repo> worktree add "<repo>/../_wt/<nazwa>-pg" -b chore/pg-v3-github-ready origin/<default>`
   Jesli remote brak → `git remote add origin https://github.com/<github-owner>/<repo>.git`.
1. `node ~/.claude/bin/repo-readiness.js --repo <wt> --json > /tmp/before.json` (baseline).
2. Bootstrap: `powershell -File "~/.claude/bin/mas-quality-init.ps1" -RepoPath <wt> -Tier <T1|T2|T3>` (create-only; workflows nadpisuje).
   Lovable repo (`lovable-tagger`): NIE dotykaj `vite.config`/`src/integrations/supabase`; CI tylko lint/tsc/test/build.
3. Dokumenty Z KODU, nie z glowy: README (przeczytaj `package.json`, `src/` strukture, `.env*`, README stary), ARCHITECTURE (mermaid z realnych modulow), GLOSSARY (nazwy encji z kodu/DB), >= 1 ADR o decyzji JUZ widocznej w repo (np. „Supabase + RLS jako backend", „Vercel zamiast Lovable", „Rapyd jako PSP") — z odrzucona alternatywa i konsekwencjami. Zero marketingu; zero wymyslonych liczb.
4. CI na zielono: uruchom lokalnie `npm ci`, `npm run lint`, `tsc -b`/`--noEmit`, `npm test -- --run`, `npm run build`. Napraw PRZYCZYNY (typy, importy, martwy kod). Semgrep: prawdziwe znalezisko = napraw; false positive = `// nosemgrep: <rule-id> — <powod w 1 zdaniu>` w tej samej linii (max 5 na repo; kazdy wypisz w PR). NIGDY: `eslint-disable` bez powodu, luzowanie tsconfig, kasowanie testow, `continue-on-error` na krokach jakosci.
5. Kod „senior polish" (max 25 plikow kodu / PR, malo a dobrze): (a) `as any` → realny typ, gdy typ jest znany z DB/API; (b) pusty `catch` → log z kontekstem + komunikat; (c) magic numbers w cenach/limitach → nazwane stale z jednostka; (d) martwy kod (knip) → usun; (e) test dla kazdej czystej funkcji domenowej, ktorej dotknales. NIE dziel plikow > 1000 linii w tym PR — wpisz plan do `docs/quality/BACKLOG.md` (co, na co, ryzyko).
6. `node ~/.claude/bin/fleet-metrics.js --repo <wt> --json` i `repo-readiness.js` PO → tabela przed/po do PR.
   Commitowany `docs/quality/baseline-metrics.json` generuj WYLACZNIE przez `node ~/.claude/bin/baseline-metrics.js <wt>` (sciezka ABSOLUTNA), NIGDY przez przekierowanie `fleet-metrics.js ... > plik` — PowerShell `>` pisze UTF-16 z BOM i wciaga lokalna sciezke w pole `repo`, a wzgledne `--repo` do 2026-09-06 po cichu spadalo na parser regex (funkcje 3-5x zanizone; 4 PR-y floty poprawiane recznie). Po zapisie sprawdz `"parser": "typescript"` i puste `warnings`.
7. Commity conventional (`docs(readme): ...`, `ci(quality): ...`, `fix(types): ...`, `test(price): ...`), male, po temacie.
   **Commituj PO KAZDYM KROKU (3, 4, 5) — nie trzymaj 20 brudnych plikow do konca.** Lekcja 2026-09-05: proces Claude Code
   padl z 11 agentami w toku; 9 worktree'ow mialo 9-29 niezacommitowanych plikow i zero commitow — robota do odtworzenia.
   Commit w worktree nic nie publikuje (push jest osobnym krokiem), wiec jest darmowym punktem kontrolnym.
7a. LICENSE / podmiot prawny: sprawdz stopke strony, impressum, `package.json:author`, README — nazwa firmy w LICENSE musi
   zgadzac sie z tym, co widzi klient (2026-09-05: „the company ehf." vs stopka „Example Company ehf."). Niezgodnosc lub
   brak zrodla -> uzyj nazwy ze stopki i oznacz w PR `[NIEPEWNE: podmiot]`.
7b. Przed pushem sprawdz vault: `curl -s -o /dev/null -w "%{http_code}" http://<secret-manager-url>/api/status` musi dac 200;
   inaczej push przez most pada TimeoutError. Retry co 90 s, max 4; potem raport „push pending" (commity sa bezpieczne).
7c. **Most przez lock, gdy pracuje wiecej niz 1 agent:** `python infisical (CLI) ...`
   (mutex w %TEMP%, czeka do 10 min). 2026-09-05: 13 rownoleglych wywolan mostu = wyczerpana pula Postgresa vaulta = padly
   WSZYSTKIE pushe floty. Jeden most naraz kosztuje sekundy; padniety vault kosztuje godziny.
8. Push branchu przez most: `cd <secret-manager> && git push  # token z menedzera sekretow (np. `infisical run -- git push`)"<wt>" --env dev`
9. PR przez API (most): `infisical run --env=dev -- python "~/.claude/bin/mas_open_pr.py" --repo <github-owner>/<repo> --head chore/pg-v3-github-ready --base <default> --title "chore(pg): PG v3 github-ready — <repo>" --body-file <plik.md>`
   Body: co zmieniono (lista), tabela readiness przed/po, komendy z exit code, lista `nosemgrep` z powodami, BACKLOG (co swiadomie odlozone), tier.
10. Raport do orkiestratora (<= 15 linii): PR URL, score przed/po, CI lokalnie zielone? (komendy), co odlozone, [NIEPEWNE].

## Czego NIE robic (twarde)
- Push na `main`/`master` (pre-push i tak zablokuje poza Lovable — dla Lovable TEZ branch, bo push na main = deploy klienta).
- Merge, rebase historii, force-push, kasowanie branchy, zmiana widocznosci repo, archiwizacja (to decyzje uzytkownika — wypisz propozycje).
- Zmiana logiki biznesowej (ceny, statusy, RLS) „przy okazji" — to osobne PR-y z pg-review T3.
- Deploy edge fn / migracji. Zmiany w `supabase/migrations` tylko jako NOWE pliki naprawiajace HIGH, opisane w PR jako „do deployu przez uzytkownika" — albo wcale (wpis w BACKLOG).
- Dane klientow w README/screenshotach; realne ceny zakupu; sekrety (bramki i tak zablokuja).

## Kolejnosc floty (widocznosc x wartosc)
A. Publiczne produkty/wizytowki: (lista repo floty usunieta z wersji publicznej).
B. Prywatne produkty (jakosc dla nas + przyszla decyzja o upublicznieniu): workshop-app, marketplace-app, shop-app, demo-site.
C. Publiczne strony klientow Lovable (iceland-*, demo-site, demo-site, demo-site, demo-site): README (co, stack, live URL, status „delivered <data>") + CI zielone albo usuniete.
D. Publiczne prototypy (demo-site, demo-site-crm, project-renew-spark, island-collective-shipments, art-stream-sync, marketplace-app-marketplace): 1. linia README = status `prototype (<data>)`, CI usuniete (czerwony badge na prototypie = szkoda); propozycja archiwizacji dla uzytkownika.
E. Duplikaty `*-<hash>` (prywatne, Lovable connect) + assets: propozycja archiwizacji, bez pracy.

## Rownoleglosc (lekcja 2026-09-05 — vault padl przez moj wlasny fan-out)
- **Max 4 agentow „ciezkich" (npm ci / tsc -b / build / vitest) naraz na jednej maszynie.** 11 rownoleglych = dysk zaglodzony,
  Docker/WSL I/O w stanie D, backend vaulta nie zdazyl wystartowac (`Plugin did not start in time`) -> wszystkie pushe padly.
- Kolejnosc partii: najpierw repo z kodem (ciezkie, max 4), potem docs-only (lekkie, moga isc szerzej).
- Vault health (200) sprawdzany PRZED startem partii, nie tylko przed pushem; most zawsze przez `bridge-lock.sh`.
- Agent docs-only nie robi `npm ci` bez potrzeby (README z kodu nie wymaga node_modules; `npm ci` tylko gdy CI ma byc zweryfikowane).
- **Agent-wykonawca NIE dotyka infrastruktury wspolnej**: zero `docker restart/compose/down/up` na vaulcie, zero zmian w <secret-manager>,
  zero zabijania procesow. Vault/Docker to warstwa uzytkownika/orkiestratora — agent zglasza „push pending" i konczy.
  (2026-09-05: agent repo zrobil `compose down/up` + „orphan cleanup" vaulta w trakcie, gdy orkiestrator juz go restartowal.)
- **Jedyne zrodlo tokena GitHub = menedzer sekretow (np. Infisical CLI).** ZAKAZ obchodzenia: `git credential fill`, Git Credential Manager, `gh auth`,
  `~/.git-credentials`, zmienne env z innych sesji, tokeny w remote URL. Gdy most nie dziala -> „push pending", koniec.
  (2026-09-05: agent przy padnietym vaulcie wypchnal PR przez GCM — bez wycieku, ale to obejscie bramki pod presja =
  infrastrukturalny odpowiednik suppression-as-fix. Bramka istnieje po to, zeby padniety vault ZATRZYMYWAL publikacje.)
- **Scratchpad jest WSPOLNY dla rownoleglych sesji/agentow** — pliki robocze (body PR, skrypty) nazywaj per repo
  (`body-<repo>.md`, `push-<repo>.sh`), nigdy generycznie (`pr_body.md`): 2026-09-05 agent shop-app nadpisal body agenta
  rental-site. Najlepiej: podkatalog `<scratchpad>/<repo>/`.
- **`npm ci` EPERM/ENOTEMPTY pod obciazeniem** — nie „naprawiaj" przez `npm install --force`; zglos w raporcie.
  SPROSTOWANIE 2026-09-06: `~\Desktop` NIE jest w OneDrive (KFM Desktop = sciezka lokalna, `$env:OneDrive`
  to osobny katalog) — premisa „OneDrive Desktop" z 2026-09-05 byla falszywa; EPERM = kontencja I/O 11 agentow / blokady
  plikow (antywirus, procesy node), nie sync. Przenoszenie klonow nic nie da; lek = max 4 ciezkie procesy naraz.
- **Krokow bezpieczenstwa w CI (npm audit, gitleaks, semgrep) NIE usuwa sie dla zielonego badge'a.** Czerwony audit = `npm audit fix`
  (patch/minor) albo zostaje czerwony z wpisem w BACKLOG i raportem. Zawezenie CI dotyczy WYLACZNIE lint/tsc przy defaultach
  Lovable (`strict: false`) i musi byc opisane. (2026-09-05: agent usunal krok audit w 7 repo klientow — cofniete.)
  Od 2026-09-05 pilnuje tego BRAMKA (globalny pre-commit): usunieta linia z audit/gitleaks/semgrep w `.github/workflows/` albo dodane `continue-on-error: true` = commit nie istnieje; skasowanie calego workflow tez. Swiadoma decyzja (np. archiwizacja prototypu): `ALLOW_CI_DOWNGRADE=1 git commit ...` i powod w tresci commita.

## Lekcje z rolloutu 2026-09-05 (wieczor) — dopisane do procedury
- **Przed otwarciem PR i po kazdym pushu na main innych sesji:** `git fetch origin <default> && git merge-tree --write-tree origin/<default> HEAD` musi byc czyste. Skonfliktowany PR = GitHub nie buduje merge-refa = ZERO runow `pull_request` — brak checkow wyglada jak "nic czerwonego". `mas_fleet_pr_status.py`: "no checks" w repo, ktore MA workflowy, to alarm, nie sukces.
- **Workflowy w repo z wlasnymi utwardzeniami NIE nadpisuje sie szablonem.** `mas-quality-init.ps1` jest teraz create-only (rozny plik = diff do reki; `-ForceWorkflows` tylko swiadomie). Regresja z workshop-app: `npm ci` -> `npm ci || npm install`, zgubiony job Deno.
- **Bramka pre-commit CI-downgrade** liczy usuniete vs dodane linie z narzedziem security per plik workflow: przesuniecie joba = OK, usuniecie/skasowanie pliku = blok (`ALLOW_CI_DOWNGRADE=1` = decyzja uzytkownika, powod w commicie).
- **Plik workflow moze byc niewazny mimo poprawnego YAML** (`secrets` w job-level `if`, zly klucz): GitHub robi run nazwany SCIEZKA pliku z 0 jobow, a dla `pull_request` nic — checki milcza. `mas_fleet_pr_status.py` pokazuje `INVALID WORKFLOW FILE`; warunki od sekretow liczymy w kroku (`env:` + `$GITHUB_OUTPUT`) i przekazujemy przez `needs.<job>.outputs`.

## Merge i po mergu (2026-09-06, 27 PR-ow floty)
- **Merge tylko narzedziem z bramkami:** `bin/mas_merge_prs.py --repos a,b --confirm` (wymaga `ALLOW_MERGE=1`; squash; odmawia przy `dirty/blocked/behind`, czerwonych/niepelnych checkach i przy 0 checkow mimo workflowow). Dry-run bez `--confirm`.
- **Kolejnosc:** najpierw repo bez auto-deployu (Lovable/manual, prototypy), potem Vercel; po mergu `scratchpad/wait_prod_multi.py repo=sha=url …` — deployment Production `success` + HTTP 200 na domenie = dowod, nie "zmergowane".
- **Blocked przez stale konteksty** (workflowy usuniete w PR): `PATCH branches/main/protection/required_status_checks {contexts: []}` przed mergem, potem archiwizacja.
- **Podmiot w LICENSE** = `Example Company ehf.` (marki w nawiasie); `bin/mas_fix_license_entity.py` normalizuje przez Contents API na galezi PR; repo osobiste i repo klienta z wlasnym podmiotem pomijane jawnie.

## Kategorie repo — czego wymagamy od czego (2026-09-06)

Standard R1–R14 byl pisany pod PRODUKT. Wymaganie `docs/ARCHITECTURE.md` i CI od repo z osmioma plikami `.pptx` to ceremonia, ktora uczy klikania „i tak dodam wypelniacz". Kategoria wynika z zawartosci, nie z checkboxa:

- **produkt** (kod aplikacji, ktory ktos uruchamia): pelny zestaw — README, LICENSE, quality.yml, ARCHITECTURE, GLOSSARY, CHANGELOG, docs/adr, PR template. Bez wyjatkow.
- **write-up** (repo bez kodu, opisuje projekt, ktorego zrodlo jest gdzie indziej): README, LICENSE, ARCHITECTURE (co to jest + gdzie mieszka kod), GLOSSARY, PR template. CI = brak, bo nie ma czego budowac.
- **asset-host** (grafiki, PDF-y, dane dla narzedzi zewnetrznych): README (co to jest, kontrakt URL, zasady co tu wolno) + LICENSE. ARCHITECTURE/CI/ADR = NIE.
- **scratch / cwiczenie** (dane z kursu, dziennik nauki): README ze statusem. LICENSE tylko gdy tresc jest NASZA — dla materialu z kursu wlasna licencja bylaby falszem (np. `webflyx`: cytaty z filmow z zadan boot.dev).

Scorer `bin/repo-readiness.js` liczy nadal pelny zestaw — przy repo innej kategorii braki opisujemy w raporcie zamiast je „zalatywac". Swiadome pominiecie z powodem > wypelniacz.

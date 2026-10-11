# ADR-0004: Bramki wdrożenia — podgląd, bake przed promocją, obserwacja z auto-rollbackiem

Data: 2026-10-11 | Status: przyjęte (uzytkownik: „CI/CD kompletne, bezpieczne i profesjonalne — w filmie jest prawidłowy approach jak w korporacjach”)

**Stan obecny (obowiązuje; sekcje „Aktualizacja v2–v6” niżej to historia decyzji z rund recenzji):**
- **PREVIEW** (`vercel.deployment.success`, nie-produkcja):
  - sondy bez nagłówka bypass → `pg/preview`;
  - chroniony podgląd (401/403) = zielony z opisem „sondy nie wykonane”;
  - pominięty build = zielony tylko dla PR z samą dokumentacją;
  - Playwright NIE tutaj (`quality.yml`).
- **BAKE** (`vercel.deployment.ready`, produkcja):
  - weryfikacja wdrożenia przez API Vercela (projekt, zespół, target=production, commit) jest wymagana;
  - sondy przez `BAKE_MINUTES` z wyjściem przy pierwszej czerwonej rundzie → `pg/bake` (failure / error = Vercel nie promuje).
- BAKE NIE ma skrótu dla zmian z samą dokumentacją (v7: skrót oceniał jeden commit, a Vercel buduje cały push — kod mógł przejść bez sond; koszt ~10 min przyjęty).
- **WATCH** (`vercel.deployment.promoted`): sondy `PROD_URL`, grupa `watch-prod` bez anulowania. Rollback, gdy ostatnie `failingStreak` (3) rund z rzędu są czerwone na sondach aplikacji.
  - Seria sondy zależności (`dependency: true`) albo nie-regresja (401/403/429/3xx w większości, sieć runnera) = exit 2, czyli alarm bez rollbacku.
  - Czerwony WATCH zawsze ustawia `pg/watch=failure` na sha.
- **Decyzja rollbacku** (`rollbackDecision`, kolejność):
  - `disabled` (vars) → `guard` (otwarte `deploy-rollback`) → `nosetup` → `norange` (nieznany sha na produkcji albo brak celu/zakresu) → `stale` → `migrations` / `backend`.
  - Cel: `pickRollbackTarget`, czyli ostatni build produkcji z `pg/bake=success` i bez `pg/watch=failure`. Zakres: od celu do czubka `main`.
  - Rollback: najpierw issue-bezpiecznik, potem REST `POST /v1/projects/{id}/rollback/{uid}` (3 próby) `[NIEPEWNE: POST nieprzećwiczony — drill WATCH]`.
- **Pozostałe:**
  - deadman co 3 h;
  - alarm przy awarii `plan`;
  - wyłączniki `PG_DEPLOY_GATE=off` / `PG_AUTO_ROLLBACK=off`;
  - triage Claude w Environment `deploy-gate`: tylko rc=1 i nowe issue, tylko `Read(./**)`, komentarz publikuje zaufany job.
- **Bezpieczeństwo:**
  - checkout gałęzi domyślnej;
  - payload walidowany w `deploy-probe.mjs --plan` (sha hex, przodek main dla BAKE/WATCH, host z allowlisty: dla BAKE/PREVIEW tylko wzorce wdrożeń);
  - sekrety w Environment `deploy-gate` (tylko gałąź domyślna);
  - zero `${{ }}` z payloadu w `run`;
  - zero `npx`.

**Kontekst:** Szablon miał etapy 1–2 z typowego pipeline'u (build + testy blokują merge: `quality.yml`, wymagane checki, merge tylko przez `pg-merge-bezpieczny`). Etapy 3–4 istniały tylko jako wiedza: karta `sd/07-infra.md` opisywała smoke po deployu i auto-rollback, ale żadne repo floty nie miało takiego workflow (`grep deployment_status ~/src/*/.github/workflows` = 0). Po złym deployu nic nie wycofywało wersji samo. Zespół Vercel = plan Pro (API 2026-10-11).

**Decyzja:** Szablon `templates/repo/.github/workflows/deploy-gate.yml` + `scripts/deploy-probe.mjs` (zero zależności) + `deploy/probes.json` (sondy i progi jako dane):
1. **PREVIEW** (`repository_dispatch: vercel.deployment.success`, nie-produkcja): sondy → status `pg/preview` (wymagany do merge po setupie).
2. **BAKE** (`vercel.deployment.ready`, produkcja): build produkcji czeka poza ruchem, bo Vercel Deployment Checks wymaga `pg/bake`. Sondy przez 10 min na niezmiennym URL-u wdrożenia. Czerwone = domena nigdy nie trafia na zły build.
3. **WATCH** (`vercel.deployment.promoted`): sondy domeny produkcji przez 15 min. Przekroczenie progów = rollback (od v5: REST `POST /v1/projects/{id}/rollback/{uid}` do ostatniego zielonego BAKE) + issue `deploy-gate`. Rollback wyłącza auto-przypisanie domen, więc linia stoi do świadomego `vercel promote`.
4. **TRIAGE**: przy czerwonym BAKE lub WATCH świeża instancja Claude (CLAUDE_CODE_OAUTH_TOKEN, subskrypcja) analizuje logi i diff i komentuje issue. Bez prawa edycji, PR, merge i deployu.

**Rozważone alternatywy:**
1. `deployment_status` + rollback po fakcie (stara karta): klient widzi zły build do czasu rollbacku. BAKE przed promocją jest tańszy w skutkach.
2. Rolling Releases (canary %) z metrykami Vercela: dostępne w Pro, ale przy naszym ruchu (dziesiątki użytkowników) próbka nie daje statystyki. Sygnał powrotu jest w karcie 07.
3. Zewnętrzny monitoring (Checkly itp.): abonament i vendor. Sondy w Actions są za darmo w limicie minut.
4. Auto-naprawa przez agenta (PR z fixem i merge): odrzucone. Agent w pętli produkcyjnej bez człowieka to za duże ryzyko, a triage ogranicza się do komentarza.

**Konsekwencje:** Każde repo Vercel po bootstrapie (`mas-quality-init.sh`) dostaje workflow i skrypt, a `probes.json` jest create-only. Setup jednorazowy (Deployment Checks, sekret obejścia ochrony, `VERCEL_TOKEN`, zmienne, branch protection, drill) to checklista w RUNBOOK › Pipeline wdrożenia i PRR P18. Lovable nie dotyczy.

**Koszt cykliczny:** minuty GitHub Actions, około 25–30 na produkcyjny deploy (BAKE 10 + WATCH 15 + narzut) plus deadman co 3 h (~240 min/mies. na repo z `PROD_URL`, minuty zaokrąglane w górę; v4: było co godzinę, ~720). Triage zużywa limit subskrypcji tylko przy czerwonej bramce. Płatnego API brak.

**Bezpieczeństwo:**
- Payload `repository_dispatch` może wysłać każdy z prawem zapisu. Dlatego wartości trafiają do skryptów tylko przez `env` i nigdy przez `${{ }}` w `run`, a `sha` jest walidowany jako hex.
- Host jest sprawdzany allowlistą `<projekt>-*-<zespół>.vercel.app` przed wysłaniem nagłówka `x-vercel-protection-bypass`. `*` obejmuje tylko `[a-z0-9]+`, bo z myślnikami przeszedłby obcy zespół o slugu `x-<zespół>`, a samo `*.vercel.app` jest odrzucane.
- Rollback działa tylko na projekcie z sekretów i zmiennych repo.
- Triage ma zawężone narzędzia, a prompt mówi, że logi to dane, nie polecenia.

**Aktualizacja v2 (2026-10-11, pg-review security/ops/code: 1 blocker, 11 major (security 1, code 4, ops 6)):**
- *Blocker pwn-request:* v1 robiła checkout commita z payloadu, więc skrypt i allowlista pochodziły z drzewa atakującego.
  - v2: każdy job z sekretem robi checkout gałęzi domyślnej.
  - `plan` (skrypt `--plan`, testowany) waliduje sha i host. BAKE/WATCH przyjmują tylko sha będący przodkiem main.
  - Sekret obejścia jest tylko w kroku sond.
  - Playwright (kod PR) w osobnym jobie bez sekretów (v2; w v4 usunięty z deploy-gate, patrz niżej).
  - `npx vercel` jest uruchamiany poza repo.
- *Rollback:* tylko przy exit 1 (przekroczone progi). Exit 2 (konfiguracja, WAF) i błędy infry nigdy nie cofają.
  - Bezpiecznik: otwarte issue `deploy-rollback` blokuje kolejny auto-rollback.
  - WATCH ma jedną grupę współbieżności z anulowaniem, więc nowsza promocja anuluje starszą obserwację.
  - WATCH zawsze sonduje `vars.PROD_URL`.
- *Fałszywe alarmy:* ponowienie pojedynczej sondy. WATCH cofa dopiero przy progu 5% i błędach w ≥2 rundach. 401/403/429 to „bramka niesprawna”, nie regresja.
- *Setup:* placeholdery w `probes.json` i brak `PROD_URL` dają issue „bramka niesprawna”, a BAKE dostaje `error` (Vercel nie promuje, fail-closed).
- *Pozostałe:*
  - pominięty lub nieudany podgląd ustawia `pg/preview`;
  - nazwy jobów różnią się od kontekstów statusów (kolizja check-run vs status);
  - triage nie ma `gh`, a `Read` jest ograniczony do workspace; komentarz publikuje zaufany krok z `execution_file`;
  - bootstrap dodaje bramki tylko repo na Vercelu, z pominięciem Lovable;
  - testy w `pg-selftest`.
- *Otwarte (drill na projekcie staging przed włączeniem na produkcji):*
  - czy Deployment Checks wybiera commit status `pg/bake` ustawiany przez API (a nie check-run);
  - zachowanie `vercel rollback` w CI;
  - format `client_payload.url`;
  - plan GitHub i limit minut `[NIEPEWNE]`.

**Aktualizacja v3 (2026-10-11, runda 2: security 1 blocker + 2 major, ops 6 major, code 3 major, data 2 major):**
- *Triage (blocker):* przy `id-token: write` akcja wymieniała OIDC na token App z prawem zapisu i wpisywała go w `.git/config`, a `Read(./**)` pozwalał go przeczytać i opublikować.
  - Teraz: `github_token` = GITHUB_TOKEN (`contents:read`), bez `id-token`, `Read(.git/**)` zabronione.
  - Redakcja wzorców tokenów; komentarz publikuje osobny job z `issues:write`.
- *Gałęzie:* checkout jawnie `default_branch`. Sekrety w GitHub Environment `deploy-gate` z polityką „tylko gałąź domyślna”. Token Vercela jest zespołowy, więc trzymany wyłącznie tam.
- *Podszycie nazwą projektu:* przed nagłówkiem bypass (BAKE/PREVIEW) `GET /v13/deployments/{host}` musi zwrócić nasz `projectId` i `ownerId`. Sprawdzone na żywo: własne wdrożenie → ok, inny projekt zespołu → mismatch. PREVIEW i Playwright dostają bypass tylko dla PR z tego repo.
- *WATCH = stan TERAZ:* rollback, gdy ostatnie 3 rundy z rzędu są czerwone, z wczesnym wyjściem (~1,5 min zamiast 15). Przejściowa awaria ani samo p95 nie cofają.
- *Nie-regresja (exit 2):* 3xx (apex→www), 401/403/429 oraz błąd sieci runnera potwierdzony sondą kontrolną `api.github.com`.
- *Migracje:* `rollbackDecision()` (testowana) wstrzymuje auto-rollback, gdy zakres od poprzedniej produkcji (GitHub Deployments) dotyka katalogów migracji albo zakres jest nieznany.
- *Bezpiecznik przed rollbackiem:* issue `deploy-rollback` powstaje PRZED `vercel rollback`, bo rollback emituje własne `promoted`. WATCH nie jest anulowany przez nowszą promocję.
- *Sonda bazy:* asercja `json` (`{"ok":true,"db":"ok"}`), bo podciąg `"ok"` przepuszczał `{"ok":false}`.
- *Szum i setup:*
  - deduplikacja issue po tytule; brak issue dla czerwonego PREVIEW (status blokuje merge);
  - błąd setupu ustawia `pg/bake` / `pg/preview` = `error`;
  - konfiguracja ładowana tylko dla zdarzeń z sondami;
  - `canceled` nie daje zielonego statusu; `ignored` daje zielony tylko, gdy PR nie zmienia `vercel.json`.
- *Znane granice (nie naprawiane teraz):*
  - brak sygnału, gdy Vercel w ogóle nie wyśle dispatcha (BAKE wtedy czeka, bo Deployment Checks nie promuje bez statusu);
  - BAKE nie pomija zmian docs-only (koszt ~10 min);
  - bootstrap wykrywa Vercel po `vercel.json` / `.vercel/project.json` (lokalny link);
  - aktor dispatcha dla `allowed_bots` `[NIEPEWNE]`.

**Aktualizacja v4 (2026-10-11, runda 3: security 0 blockerów i 4 major, ops 4 major, code 1 major, data 2 major):**
- Weryfikacja wdrożenia sprawdza też `target` (BAKE = production, PREVIEW ≠ production) i sha commita (`githubCommitSha`/`gitCommitSha`). Sprawdzone na żywo na staging radaru: dobry sha → ok, zły sha → mismatch.
- Triage bez Basha, bo `git log --output` zapisywał dowolny plik. Kontekst gita przygotowuje zaufany krok do plików.
- Playwright usunięty z deploy-gate (kod PR w kontekście main oznacza ryzyko zatrucia cache). E2E zostaje w `quality.yml`.
- Sondy `dependency: true` (baza): ich seria daje alarm, nie rollback. Odporność na awarię bazy i zalew `/api/health`.
- Wyłączniki: `vars.PG_DEPLOY_GATE=off` i `vars.PG_AUTO_ROLLBACK=off`. Deadman co godzinę zgłasza produkcyjny build bez `pg/bake` po >30 min.
- Przed rollbackiem sha na żywo z API Vercela musi być równy obserwowanemu (`stale`). Zmiany `supabase/functions` wstrzymują auto-rollback (`backend`).
- Migracje: każdy `.sql` albo segment `migrations/` gdziekolwiek w ścieżce; zakres od najstarszego z 5 ostatnich wdrożeń. p95 liczony dopiero od 20 próbek.
- Pominięty podgląd daje zielony status tylko dla PR z samą dokumentacją.
- Drill pozytywny i negatywny na stagingu PRZED produkcją.
- Ryzyko przyjęte:
  - zespołowy token Vercela w argv `npx vercel@60.1.1`, wersja przypięta i starsza niż 2 tygodnie;
  - zakres z GitHub Deployments może podrobić writer (poziom writera).

**Aktualizacja v5 (2026-10-11, runda 4: 0 blockerów; security 3 major, ops 1, code 2, data 2):**
- PREVIEW NIGDY nie dostaje bypassu: kod gałęzi PR jest niezrecenzowany, także z tego repo i od botów zależności. Chroniony podgląd (401/403) jest zielony z notatką, bo build produkcji i tak sprawdza BAKE.
- Rollback przez REST `POST /v1/projects/{id}/rollback/{deploymentId}` zamiast `npx vercel`, bez instalacji pakietów obok zespołowego tokenu.
  - Cel JAWNY: ostatnie wdrożenie produkcji z zielonym `pg/bake` (`pickRollbackTarget`, testowane). Lista kandydatów sprawdzona na żywo.
  - Zakres migracji liczony od sha tego celu, więc dokładnie to, do czego wracamy.
- Triage: tylko `Read(./**)` (bez Grep i Glob). Token subskrypcji jest sekretem Environment `deploy-gate`.
- Zależność ma pierwszeństwo nad serią błędów aplikacji: baza padła, strona też → alarm, nie rollback. Regex migracji obejmuje też `migration/`, `schema.prisma`, `db/migrate/`.
- Deadman co 3 h, pomija nieudane/anulowane wdrożenia (status deploymentu). Duplikat issue nie dostaje komentarzy. BAKE kończy się przy pierwszej czerwonej rundzie.
- Logika z YAML przeniesiona do testowanych funkcji: `docsOnly`, `stuckDeployments`, `pickRollbackTarget`.
- Przyjęte (poziom writera): statusy `pg/*` może ustawić każdy z prawem zapisu. Brak polityki Environment przy pierwszym użyciu (GitHub tworzy je bez ograniczeń) pilnuje checklista RUNBOOK, nie kod.

**Aktualizacja v6 (2026-10-11, runda 5: 0 blockerów; security 2 major, ops 4, code 2, data 1):**
- Bezpieczeństwo:
  - job `token` w Environment `deploy-gate` (sekret Environment), w RUNBOOK token Claude'a NIE jako sekret repo;
  - triage tylko przy rc=1 i nowym issue (limit subskrypcji);
  - BAKE wymaga udanej weryfikacji wdrożenia; BAKE i PREVIEW tylko na hostach wdrożeń, nie na domenie produkcji;
  - sanityzacja `P_ENV`/`ACTION` (bez komend `::` w logu); slug zespołu poza szablonem i testami, plus denylista eksportu.
- Niezawodność:
  - cel rollbacku pomija buildy wycofane wcześniej (`pg/watch=failure` ustawiany po rollbacku);
  - retry zapytań i POST rollbacku (idempotentny);
  - pojedynczy 429/403/3xx nie psuje bramki;
  - chroniony podgląd ma opis „sondy nie wykonane”;
  - alarm przy awarii `plan`; setup-alarm bez czerwonego runu; BAKE docs-only = 1 runda; literówka typu w `probes.json` = exit 2.
- Testowalność: pętla sond w `runRounds` z wstrzykiwanym zegarem (testy wczesnego wyjścia, wydłużenia, BAKE).
- Dokumentacja: RUNBOOK nie twierdzi już, że `sql-migration-lint` blokuje RENAME/NOT NULL (osobne zadanie: reguły w lincie); dodano kontrolę migracji przed ręcznym rollbackiem; drill WATCH jest wykonalny.
- Przyjęte / otwarte:
  - kanał alarmu tylko issue + e-mail (push/SMS z Active Systems to osobna decyzja);
  - wypadanie pośredniego WATCH z kolejki przy 3 promocjach w 15 min;
  - wykrywanie Vercela po `vercel.json` / `.vercel`;
  - `mas-quality-init.ps1` bez deploy-gate (laptop = Linux, `.sh`).

**Aktualizacja v7–v8 (2026-10-11):** runda 6 (pełna): 0 blockerów, 8 major (security 1, ops 3, code 2, data 2). Kontrole samych poprawek:
- r7: code 1 blocker (reguła fail-closed bez testu) i ops 1 major;
- r8: code 1 major (znacznik `pg/watch` przy nieznanym `LIVE_SHA`), ops 0 major.

Wszystko naprawione; zmiany opisuje sekcja „Stan obecny”. Łącznie 6 pełnych rund (4 działy) i 2 kontrole poprawek (code + ops).

**Pułapki dla przyszłego siebie:**
- (v1–v4) `vercel rollback` z CLI; od v5 REST z jawnym celem. Do drillu: czy `GET /v13/deployments/{domena}` rozpoznaje WŁASNĄ domenę (nie tylko `*.vercel.app`) — inaczej LIVE_SHA puste = `norange` i auto-rollback nigdy nie zadziała `[NIEPEWNE]`.
- Rollback NIE cofa bazy, więc migracje muszą iść zasadą expand/contract.
- Zmiana nazwy statusu `pg/bake` wymaga zmiany w ustawieniach Deployment Checks.
- Zdarzenia `repository_dispatch` działają tylko z workflow na gałęzi domyślnej.
- Format `client_payload.url` nie jest udokumentowany, dlatego skrypt normalizuje go do https.

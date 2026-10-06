# 07 · Infrastruktura i wdrażanie — granice usług, platforma, kontenery, CI/CD, środowiska, koszt

Konwencje (`~`, `[NIEPEWNE]`, zmienne ścieżek, odsyłacze `NN › Karta`) — w `README.md`.

---

### Monolit modularny vs usługi

**Problem.** Czy dzielić system na osobno wdrażane części. Przedwczesny podział jest najczęstszym błędem architektonicznym w małych zespołach: każda granica sieciowa dokłada tryby awarii (timeout, retry, idempotencja, częściowa porażka), tracing, kolejne pipeline'y i sekrety. Sygnały w diffie: nowy katalog z własnym `package.json`/`Dockerfile`, nowa edge function wołająca inną, nowy serwis w Compose, nowe repo, „osobna usługa do X".

**Domyślnie u nas.** Modularny monolit: jedna aplikacja, moduły = katalogi z jednym wejściem i regułą importów (bramka `~/.claude/bin/module-boundaries.js`, warstwy w bloku JSON w `docs/ARCHITECTURE.md`); logika domenowa jako czyste funkcje (→ `pg/paradigm.md`). Osobno wdrażane jest tylko to, co ma własny rytm: webhooki (edge function), zadania cykliczne/robocze, n8n jako klej. Produkty floty to jedna aplikacja + funkcje Supabase — „monolit serverless"; to wystarcza. Podział zapisujemy w ADR z nazwaną, OBECNĄ przyczyną i sygnałem powrotu.
**Kiedy podział się opłaca (nazwana przyczyna musi istnieć dziś):** niezależne zespoły wdrażające we własnym tempie, wyraźnie inny profil skalowania/kosztu (np. wsadowe generowanie PDF/obrazów/LLM), wymóg izolacji (płatności), inny runtime (Deno vs Node).

| Wariant | Koszt operacyjny | Finansowy | Poznawczy |
|---|---|---|---|
| modularny monolit | dyscyplina granic w jednym repo | zero | niski |
| monolit + kilka funkcji brzegowych | kilka deployów do pilnowania | zero–niski | niski–średni |
| mikroserwisy | tracing, sagi, N pipeline'ów, N dyżurów | rośnie liniowo | wysoki — nie |

**Awarie i detekcja.**
- *deployable'i liczniejsze niż osoby utrzymujące* — `ls -d supabase/functions/*/ | wc -l`; `ls Dockerfile* docker-compose*.yml wrangler.* vercel.json 2>/dev/null`
- *ukryty rozproszony system: funkcja woła funkcję* — `rg -n "functions\.invoke|/functions/v1/" supabase/functions`
- *import w głąb cudzego modułu / cykle* — `node ~/.claude/bin/module-boundaries.js --help` (uruchom na repo); `rg -n "from ['\"]\.\./\.\./[a-z-]+/(internal|lib)" src`
- *wspólny kod kopiowany między funkcjami* — `ls supabase/functions/_shared 2>/dev/null; rg -n "^import .* from ['\"]\.\./[a-z-]+/" supabase/functions`
- *jedna zmiana biznesowa dotyka wielu katalogów (change amplification)* — `git log -n 20 --name-only --pretty=format: | sort | uniq -c | sort -rn | head`

**Audyt „czy się trzymamy".**
1. Czy liczba deployable'i nie przekracza liczby osób, które je utrzymują? → pierwsza komenda.
2. Czy moduły mają granice i brak cykli? → `module-boundaries.js`.
3. Czy wywołania między funkcjami/usługami mają timeout, retry i idempotencję? → 05 › Zależności zewnętrzne.
4. Czy podział/wydzielenie ma ADR z obecną przyczyną i sygnałem powrotu? → `rg -n -i "revisit|sygnał powrotu|wróć gdy" docs/adr`.
5. Czy operacje obejmujące kilka usług mają kompensację zamiast zakładać ACID? → odczyt przepływu.

**Nie potrzebujesz jeszcze.** Mikroserwisów, service mesh, API gateway, magistrali zdarzeń, taktycznych wzorców DDD (agregaty, CQRS).

---

### Platforma i ścieżka wdrożenia

**Problem.** Ścieżka deployu decyduje, co faktycznie trafia na produkcję po `git push`. Pomyłka tu ma twarz „kod jest w gicie, a produkcja go nie ma". Sygnały w diffie: zmiana `vercel.json`/`next.config.ts`/`supabase/config.toml`, nowa edge function, nowa zmienna środowiskowa, zmiana hostingu.

**Wzorce spotykane we flocie (zweryfikowane z `package.json`, `vercel.json` i `docs/ARCHITECTURE.md` na gałęzi domyślnej, 2026-10-05; repo i dowody per projekt: `prywatne notatki floty (poza eksportem)`):**

| Wzorzec | Frontend / hosting | Backend / dane | Na co uważać |
|---|---|---|---|
| SaaS multi-tenant | SPA (Vite+React) na Vercelu (`vercel.json`) | Supabase: Postgres, Auth, RLS, Storage, Edge Functions (Deno) | edge functions NIE deployują się z gita (ręcznie `supabase functions deploy`); sprawdź, czy repo nie ma `lovable-tagger` |
| Sklep / panel treści | Next + Payload na Vercelu (brak `vercel.json` oznacza konfigurację po stronie panelu `[niezweryfikowane po stronie Vercel]`) | Postgres (Supabase) przez `@payloadcms/db-postgres`; Storage przez adapter | migracje Payloada uruchamiane przed `next build`; martwe ścieżki szablonu (nieużywany dostawca płatności) |
| Aplikacja po migracji z Lovable | `vercel.json` na `main`, a dokumentacja nadal mówi „Lovable" (rozjazd dokumentacji; ADR opisuje wyjście) | Supabase + edge functions | brak `lovable-tagger` w `package.json`; bramki AI do wycofania; schemat żywej bazy może nie być w repo |
| Single-tenant (jeden operator) | Next na Vercelu | Supabase przez `service_role` za bramką sesji aplikacji | cała autoryzacja w kodzie; zamknięty/referencyjny projekt = niski priorytet |
| Strona marki z funkcją AI | TanStack Start/Next na Vercelu; `wrangler.jsonc` i wtyczka Cloudflare mogą być pozostałością scaffoldu | brak bazy; Vercel AI SDK + model; poczta przez `fetch` | zależność `@lovable.dev/*` = pochodzenie scaffoldu, nie `lovable-tagger` |

**Domyślnie u nas.** Vercel dla frontu/aplikacji (push na `main` = deploy, podgląd per PR), Supabase dla danych i funkcji brzegowych, Payload+Next, gdy klient potrzebuje panelu treści/sklepu, Lovable tylko dla starych lub prostych stron klientów — wykrywane `rg -n "lovable-tagger" package.json` (nie jest to dowód dla repo, których nie sprawdzono). Cloudflare Workers/Pages: w żadnym ze sprawdzonych repo nie jest hostem. Edge functions Supabase deployujemy osobno (CLI lub CI) i sprawdzamy rozjazd repo vs projekt. Reguła z `pg/prr.md` P1: przed obietnicą „wdrożone" potwierdź ścieżkę deployu.
**Kiedy NIE zmieniać platformy:** bez nazwanej przyczyny (koszt, limit, wymóg klienta) — migracja platformy to jedna z droższych operacji (przykład: ADR opisujący wyjście z Lovable na Vercel).

| Wariant | Koszt operacyjny | Finansowy | Poznawczy |
|---|---|---|---|
| Vercel + Supabase | funkcje brzegowe deployowane osobno | wg planów `[NIEPEWNE]` | niski |
| Lovable (hosting + zarządzany Supabase) | `git push` NIE publikuje frontu ani nie deployuje edge functions: Publish jest ręczny w UI Lovable (→ `~/.claude/pg/prr.md` P1); rozjazd schematu żywej bazy z repo | wg planu | niski dziś, wysoki przy wyjściu |
| własny VPS/Compose | patche, backup, certyfikaty | stały abonament | wysoki |

**Awarie i detekcja.**
- *funkcje w repo ≠ funkcje na projekcie* — `ls supabase/functions | rg -v "^_" | sort` vs `supabase functions list --project-ref <ref>` (wymaga CLI i tokenu z menedzer sekretow (np. Infisical CLI))
- *dokumentacja mówi inaczej niż repo (hosting, liczba funkcji)* — `rg -n -i "hosting|lovable|vercel" docs/ARCHITECTURE.md` vs `ls vercel.json wrangler.* 2>/dev/null`; `ls -d supabase/functions/*/ | wc -l`
- *sprzężenie z dostawcą narzędzi (Lovable)* — `rg -n "lovable" package.json vite.config.* src supabase | head`
- *migracja w kroku build przed nowym kodem* — `rg -n "migrat" package.json scripts`
- *zmienne środowiskowe rozjechane z `.env.example`* — `diff <(rg -o "^[A-Z0-9_]+" .env.example | sort) <(vercel env ls 2>/dev/null | rg -o "^[A-Z0-9_]+" | sort)` (jeśli CLI zalogowane)

**Audyt „czy się trzymamy".**
1. Czy README opisuje, co robi `git push` (front, funkcje, migracje)? → `rg -n -i "deploy" README.md docs/RUNBOOK.md`.
2. Czy funkcje na projekcie = funkcje w repo? → porównanie z awarii.
3. Czy `docs/ARCHITECTURE.md` zgadza się z faktycznym hostingiem i stackiem? → trzecia komenda.
4. Czy zależności od dostawcy narzędzi mają plan wyjścia? → `rg -n -i "exit|wyjście" docs/adr`.
5. Czy `pg.phase` w `CLAUDE.md` odpowiada faktycznej fazie (prototyp ≠ produkt)? → `rg -n "pg.phase" CLAUDE.md`.

**Nie potrzebujesz jeszcze.** Własnego hostingu klientów, multi-cloud, platformy kontenerowej, przenoszenia hostingu bez nazwanej przyczyny.

---

### Kontenery i orkiestracja

**Problem.** Kontenery używamy do własnych narzędzi (menedżer sekretów, lokalna baza deweloperska, podglądy), nie do produkcji klientów (ta stoi na platformach). Orkiestratory (Kubernetes) rozwiązują problemy floty usług i zespołu ops, których nie mamy. Sygnały w diffie: nowy `Dockerfile`/Compose, manifest `kind: Deployment`, `helm`, obraz `:latest`, sekret w `ENV`.

**Domyślnie u nas.** Compose na laptopie: `restart: unless-stopped`, named volumes na dane, obrazy oficjalne z przypiętym tagiem (np. `postgres:17-alpine`), healthcheck, użytkownik nie-root, sekrety przez `env_file`/mostek Infisical, nie w obrazie; dane w kontenerze bez wolumenu znikają. „Napraw" przez `docker system prune`/factory reset kasuje wolumeny (`pg/cases.md` DOCKER-RESET-DESTROYS-VOLUME). Skan podatności obrazów w ramach `fleet-cve-watch`.
**Kiedy NIE:** produkcja klienta na własnym kontenerze bez monitoringu i backupu; Kubernetes — przy 1–5 usługach i jednym maintainerze nigdy.

| Wariant | Koszt operacyjny | Finansowy | Poznawczy |
|---|---|---|---|
| Compose, jeden host | ręczne aktualizacje, backup woluminów | zero | niski |
| serverless containers (Cloud Run itp.) | konfiguracja i monitoring | wg użycia | średni |
| Kubernetes | klaster, sieć, RBAC, upgrade | wysoki | bardzo wysoki — nie |

**Awarie i detekcja.**
- *tag `latest`/nieprzypięty* — `rg -n ":latest|^FROM [^@ ]+$" Dockerfile* docker-compose*.yml`
- *stan bez volume* — `rg -n "volumes:" docker-compose*.yml`; `docker inspect -f '{{.Name}} {{range .Mounts}}{{.Name}} {{end}}' $(docker ps -q)`
- *sekret w obrazie/Dockerfile* — `rg -n "^(ENV|ARG) .*(KEY|TOKEN|PASSWORD|SECRET)" Dockerfile*`
- *root/brak healthchecka/restartu* — `docker inspect -f '{{.Name}} user={{.Config.User}} restart={{.HostConfig.RestartPolicy.Name}} health={{if .State.Health}}{{.State.Health.Status}}{{else}}brak{{end}}' $(docker ps -q)`
- *manifesty K8s w repo bez zespołu ops* — `rg -n "kind: Deployment|apiVersion: apps/v1|Chart.yaml" .`
- *podatności obrazów* — `docker scout cves <obraz>` lub `trivy image <obraz>` jeśli zainstalowane `[NIEPEWNE: narzędzie niezweryfikowane na hoście]`

**Audyt „czy się trzymamy".**
1. Czy stan siedzi w named volume z kopią? → `docker volume ls`; `rg -n "volumes:" docker-compose*.yml`.
2. Czy obrazy mają przypięte tagi? → komenda `latest`.
3. Czy w obrazach nie ma sekretów? → komenda ENV.
4. Czy kontenery działają jako nie-root, z healthcheckiem i polityką restartu? → `docker inspect` z awarii.
5. Czy nie ma manifestów K8s bez ADR? → komenda K8s.

**Nie potrzebujesz jeszcze.** Kubernetesa, Swarm/Nomad, własnego rejestru obrazów, service mesh, wielohostowego klastra.

---

### CI/CD i wydania

**Problem.** Pipeline jest bramką jakości i ścieżką wdrożenia; zielone CI z pominiętymi krokami jest gorsze niż czerwone. Flota ma w repo `quality.yml`, `claude-review.yml`, `release.yml` (a w części repo `mutation.yml`, `pg-review.yml`). Sygnały w diffie: zmiany w `.github/workflows`, `package.json` scripts, nowa migracja, tag/release.

**Domyślnie u nas.** PR → `quality.yml` (lint, `tsc -b`, testy, audyt zależności, licencje) → podgląd Vercel → recenzja → merge → automatyczny deploy; main chroniony wymaganymi checkami; nigdy `--no-verify`. Migracje: expand → deploy kodu → contract; funkcje Supabase deployowane osobno i w tej samej kolejności co migracje. Rollback: poprzedni deployment Vercel (promote) w minutach `[NIEPEWNE: limity planu]`; funkcje — redeploy poprzedniej wersji z gita; migracje nieodwracalne naprawiamy „do przodu" (stąd dwuetapowość). Wydania: SemVer, CHANGELOG `[Unreleased]` → wersja, tag `vX.Y.Z`. Kroki informacyjne (`continue-on-error`) są dopuszczalne tylko, gdy jawnie informacyjne (np. jscpd/knip); krok gatingowy nie może być opcjonalny (`--if-present` przy `test:coverage` oznacza, że krok się nie wykona bez skryptu — sprawdź, czy to zamierzone).
**Kiedy NIE:** continuous deployment bez testów, monitoringu i rollbacku; canary/blue-green przy tej skali.

| Wariant | Koszt operacyjny | Finansowy | Poznawczy |
|---|---|---|---|
| CI + deploy po merge do main | utrzymanie workflowów i testów | minuty CI wg planu | niski |
| mutation testing na zmienionych plikach | dłuższe CI | minuty CI | średni; wykrywa puste testy |
| GitOps/ArgoCD, canary | klaster, narzędzia | wysoki | wysoki — nie |

**Awarie i detekcja.**
- *zielone CI z pominiętymi/opcjonalnymi krokami* — `rg -n "if-present|continue-on-error|\|\| true|--passWithNoTests" .github/workflows package.json`
- *typecheck ślepy (`tsc --noEmit` przy project references)* — `rg -n "tsc" package.json .github/workflows` (ma być `tsc -b`)
- *ostatnie przebiegi i ich wynik* — `gh run list --limit 15 --json name,conclusion,createdAt --jq '.[] | "\(.createdAt) \(.name) \(.conclusion)"'`
- *main bez wymaganych checków* — `gh api repos/<owner>/<repo>/branches/main/protection --jq '.required_status_checks.contexts'`
- *flaky testy ukrywane retry* — `rg -n -i "retries|retry" vitest.config.* playwright.config.* .github/workflows`
- *niepinowane akcje (łańcuch dostaw)* — `rg -n "uses: [^@]+@(main|master|v[0-9]+)$" .github/workflows`
- *wersja bez wpisu w CHANGELOG* — `git describe --tags --abbrev=0; rg -n "^## " CHANGELOG.md | head -3`

**Audyt „czy się trzymamy".**
1. Czy wszystkie kroki bramkujące faktycznie się wykonują? → pierwsza komenda; przejrzyj log ostatniego przebiegu.
2. Czy `tsc -b` jest w CI i w pre-commit? → komenda typecheck.
3. Czy main ma wymagane checki i czas CI jest znany? → `gh api` + `gh run list`.
4. Czy RUNBOOK opisuje rollback frontu, funkcji i migracji? → `rg -n -i "rollback|cofnij" docs/RUNBOOK.md`.
5. Czy migracja jest wstecznie kompatybilna na czas jednego deployu? → 02 › Model danych.
6. Czy testy niestabilne są śledzone, nie „retry all"? → komenda retry.

**Nie potrzebujesz jeszcze.** GitOps, canary/blue-green jako własnej maszynerii (co daje platforma → 07 › Strategie wdrożeń), platformy feature flag (flaga = kolumna/zmienna), narzędzi monorepo (nx/turbo), wielu środowisk poza prod + staging.

---

### Strategie wdrożeń i rollback

**Problem.** Każdy deploy to ryzyko. Pytanie brzmi, jak zmniejszyć zasięg błędu (ilu klientów go zobaczy) i czas powrotu (ile minut do poprzedniej wersji). Kurs wymienia rolling, canary, blue/green, feature flags i automatyczny rollback. Sygnały w diffie: zmiana w płatnościach, auth albo migracja; duży refaktor; podbicie głównej zależności (Next, supabase-js); funkcja dla części klientów; zmiana workflowu deployu.

**Domyślnie u nas.**
- **Blue/green za darmo:** każdy deploy Vercela jest niezmiennym URL-em, a produkcja to alias. Poprzednia wersja dalej żyje, więc rollback to przepięcie aliasu (Instant Rollback w panelu, `vercel rollback` / `vercel promote <url-poprzedniego>`) w ~minutę `[~]` `[NIEPEWNE: ograniczenia planu Hobby i to, że po rollbacku nowe deploye nie trafiają same na produkcję do ręcznego promote — sprawdź w docs]`.
- **Smoke po deployu + automatyczny rollback:** workflow `on: deployment_status` (stan `success`, środowisko Production) uruchamia 3–5 żądań ścieżek krytycznych (strona główna, logowanie, kluczowe API, `/health` z bazą → 03 › Health checki). Czerwony smoke → `vercel rollback` z tokenem z menedżera sekretów + alert do człowieka. To nasz „auto-rollback". Rollback na metrykach (error rate, p95) ma sens dopiero przy ruchu, który daje statystykę (~setki żądań/min `[~]`); do tego czasu wystarczą alerty Sentry i ręczny promote.
- **Feature flags (deploy ≠ release):** tabela `feature_flags(key, org_id null, enabled, owner, remove_by)` albo kolumna ustawień org. Ryzykowną funkcję włączasz najpierw dla jednej organizacji (wewnętrznej lub testowej klienta), potem dla wszystkich. Flagę sprawdza serwer (API, RLS/RPC), nie tylko UI. Każda flaga ma właściciela i datę usunięcia. To nasz „canary": po organizacjach, nie po procentach ruchu.
- **Canary procentowy i rolling:** rolling (podmiana instancji partiami) robi platforma; w serverless ten problem nie istnieje. Canary po % ruchu to Vercel Rolling Releases `[NIEPEWNE: dostępność w planie floty i koszt]` — nie domyślnie.
- **Supabase Edge Functions i migracje:** deploy funkcji podmienia ją w całości, bez canary. Ryzykowną zmianę funkcji chowaj za flagą albo wdrażaj jako nową funkcję `-v2` i przełączaj klienta. Warunkiem każdego rollbacku kodu jest migracja expand → contract: stary kod musi działać na nowym schemacie (→ 02 › Model danych).
**Kiedy NIE upraszczać:** zmiana płatności, auth albo uprawnień dla wszystkich klientów naraz — flaga per org i smoke obowiązkowe.

| Wariant | Koszt operacyjny | Finansowy | Poznawczy |
|---|---|---|---|
| recreate (wyłącz stare, włącz nowe) | przestój | zero | niski — nie dotyczy Vercela |
| rolling | platforma robi | zero | zero |
| blue/green (alias Vercela) | rollback = przepięcie aliasu | zero | niski |
| feature flag w tabeli | flagi do sprzątania, dwie ścieżki kodu | zero | niski–średni |
| smoke po deployu + auto-rollback | workflow, token Vercela w CI | minuty CI | niski |
| canary % (Rolling Releases) | konfiguracja, analiza metryk | plan `[NIEPEWNE]` | średni |
| platforma flag (LaunchDarkly itp.) | vendor, SDK | abonament | średni — nie |
| auto-rollback na metrykach (Argo Rollouts, mesh) | klaster, metryki | wysoki | wysoki — nie |

**Awarie i detekcja.**
- *brak smoke po deployu produkcji* — `rg -n -i "deployment_status|smoke|environment_url" .github/workflows`
- *rollback nieopisany lub nieprzećwiczony* — `rg -n -i "vercel (rollback|promote)|instant rollback" docs/RUNBOOK.md`
- *rollback kodu łamie się na nowym schemacie* — `node ~/.claude/bin/sql-migration-lint.js --repo . --strict --json` (DROP/RENAME/NOT NULL w tym samym PR co kod)
- *flaga sprawdzana tylko w UI* — `rg -n "<klucz-flagi>" src/app/api supabase/functions supabase/migrations` (0 trafień poza komponentami = finding)
- *flagi wieczne* — `select key, owner, remove_by from feature_flags where remove_by < now();` (jeśli tabela istnieje); `rg -c -i "isEnabled\(|featureFlag|flags\." src | awk -F: '{s+=$2} END {print s}'`
- *ostatnie deploye produkcji i ich SHA* — `gh api "repos/<owner>/<repo>/deployments?environment=Production&per_page=5" --jq '.[] | "\(.created_at) \(.sha[0:7])"'`

**Audyt „czy się trzymamy".**
1. Czy produkcja ma smoke po deployu z akcją przy porażce (rollback lub alert)? → pierwsza komenda.
2. Czy RUNBOOK opisuje rollback frontu (promote), funkcji (redeploy z gita) i migracji (do przodu), a krok przećwiczono? → druga komenda + data ćwiczenia.
3. Czy migracje z PR-a są kompatybilne ze starym kodem? → `sql-migration-lint`.
4. Czy ryzykowne funkcje idą za flagą per org sprawdzaną po stronie serwera? → komenda flagi.
5. Czy flagi mają właściciela i datę usunięcia? → komenda flag wiecznych.

**Nie potrzebujesz jeszcze** (wariant → sygnał powrotu):
- canary procentowy (Rolling Releases) → ~>1000 aktywnych dziennie i incydent, którego nie złapał smoke ani flaga per org.
- auto-rollback na metrykach → ruch ~setek żądań/min daje wiarygodny error rate, a ręczny rollback trwał ~>15 min w incydencie.
- platforma feature flag → ~>20 aktywnych flag, targetowanie po atrybutach albo eksperymenty A/B z analizą.
- Argo Rollouts, service mesh, shadow traffic → własny klaster (→ 07 › Kontenery), czyli nie przy tej skali.

---

### Środowiska, konfiguracja i sekrety

**Problem.** Testy na produkcyjnej bazie, sekret w repo, klucz publiczny użyty jako tajny, flaga `TEST_MODE` maskująca prawdziwą ścieżkę — to najczęstsze incydenty procesowe floty. Sygnały w diffie: nowy plik `.env*`, nowa zmienna, `VITE_*`/`NEXT_PUBLIC_*`, zmiana `supabase/config.toml`, flaga środowiskowa.

**Domyślnie u nas.** Prod i staging z własnymi bazami (drugi projekt Supabase lub branching) od dnia 0; `.env.local` nigdy na referencji produkcyjnej (`node ~/.claude/bin/env-ref-gate.js --repo .`); `.env.example` bez wartości i zawsze aktualny (w repo śledzony jest tylko `.env.example`). Sekrety: menedżer sekretów → zmienne Vercel/sekrety funkcji Supabase; zmienne z prefiksem `VITE_`/`NEXT_PUBLIC_` są publiczne z założenia — nigdy sekret. Flagi `*_TEST_MODE` sprawdzane jawnie przed wdrożeniem (`pg/cases.md` TEST-MODE-MASKS-PROD). Konfiguracja biznesowa (przelicznik FX, narzuty, stawki, progi) jako dane w bazie/panelu, nie zmienne środowiskowe (wzór: ustawienia w shop-app).
**Kiedy NIE:** prototyp bez użytkowników może mieć jedno środowisko (`pg.single_env: true`) — jawnie.

| Wariant | Koszt operacyjny | Finansowy | Poznawczy |
|---|---|---|---|
| prod + staging (2 projekty) | dwie bazy do migracji | ~drugi plan `[NIEPEWNE]` | niski |
| jedno środowisko | testy na żywych danych | zero | niski i ryzykowny |
| Infisical → zmienne platformy | ręczna/skryptowa synchronizacja | zero | niski |

**Awarie i detekcja.**
- *`.env` śledzony w repo* — `git ls-files | rg "^\.env"` (dozwolone tylko `.env.example`)
- *sekret w kodzie/historii* — `rg -n "ghp_|sk-ant-|sbp_|AKIA|-----BEGIN [A-Z ]*PRIVATE KEY" -g '!node_modules' -g '!*.lock' .`; `gitleaks detect --source . ` jeśli zainstalowane `[NIEPEWNE: niezweryfikowane na hoście]`
- *klucz tajny w zmiennej publicznej* — `rg -n "VITE_.*(SECRET|SERVICE|PRIVATE|TOKEN)|NEXT_PUBLIC_.*(SECRET|SERVICE|PRIVATE|TOKEN)" .env* src`
- *lokalne środowisko wskazuje produkcję* — `node ~/.claude/bin/env-ref-gate.js --repo .`
- *flaga testowa włączona na produkcji* — `rg -n "TEST_MODE|SANDBOX" src .env.example`
- *konfiguracja biznesowa w env* — `rg -n "process\.env\.(RATE|MARGIN|VAT|FX|CENA)|import\.meta\.env\.(RATE|MARGIN|VAT)" src`

**Audyt „czy się trzymamy".**
1. Czy prod i staging mają własne bazy, a lokalne `.env` nie wskazują prod? → `env-ref-gate.js`.
2. Czy w repo jest tylko `.env.example`? → komenda `git ls-files`.
3. Czy w kodzie/historii nie ma sekretów? → skan `rg` (+ gitleaks).
4. Czy zmienne publiczne nie zawierają sekretów? → komenda prefiksów.
5. Czy flagi testowe są wyłączone na produkcji, a ścieżka produkcyjna przetestowana? → `rg` flagi + smoke po wdrożeniu.
6. Czy konfiguracja biznesowa jest danymi? → ostatnia komenda.

**Nie potrzebujesz jeszcze.** HashiCorp Vault, automatycznej rotacji sekretów, osobnej usługi konfiguracji, platformy feature flag, więcej niż dwóch środowisk.

---

### Izolacja sieciowa bazy i najmniejsze uprawnienia

**Problem.** Baza projektu Supabase jest domyślnie osiągalna z internetu (host bazy i pooler), więc hasło bywa jedyną barierą. Narzędzie BI albo raport „na szybko" dostaje hasło `postgres` (superuser, omija RLS). Konto Vercel, Supabase albo GitHub bez MFA to klucz do kodu, sekretów i danych wszystkich klientów naraz. Kurs mówi tu o VPC, prywatnych podsieciach, security groups i IAM least privilege; na platformach zarządzanych odpowiednikami są ograniczenia sieci, wymuszone SSL, role bazy i role w zespołach platform. Sygnały w diffie i w procesie: nowy connection string (`postgres://`, `sslmode`), integracja BI/raportowa, skrypt łączący się bezpośrednio z bazą, nowy członek zespołu albo podwykonawca, nowy token API platformy.

**Domyślnie u nas.**
- **Sieć bazy:** aplikacja rozmawia z bazą przez API (PostgREST z RLS) albo przez pooler z kodu serwerowego. Bezpośrednie połączenia Postgres (ludzie, BI, skrypty) tylko z allowlisty adresów: Network Restrictions projektu Supabase. Do tego wymuszone SSL (Enforce SSL) i `sslmode=verify-full` z certyfikatem CA projektu po stronie klienta `[NIEPEWNE: nazwy opcji w panelu, dostępność per plan i to, czy ograniczenia obejmują pooler — sprawdź w docs „Network Restrictions" / „SSL Enforcement"]`. Ograniczenia sieci nie dotyczą API HTTPS (supabase-js), więc nie psują aplikacji. Funkcje Vercela nie mają stałych IP `[NIEPEWNE: płatny dodatek static IPs]`; jeśli łączą się bezpośrednio z Postgresem, allowlista ich nie obejmie, i to jest argument za API lub poolerem z mocnym hasłem.
- **Role bazy (least privilege):** raporty i BI dostają osobną rolę tylko do odczytu, z limitem połączeń i czasu, na schemacie `reporting` z widokami bez PII. Schemat NIE jest wystawiony w API (Settings → API → exposed schemas). Wzór (migracja w repo BEZ hasła; hasło ustawia człowiek przez `\password report_ro` w psql i od razu zapisuje je w menedżerze sekretów):
  `create role report_ro login connection limit 3; alter role report_ro set default_transaction_read_only = on; alter role report_ro set statement_timeout = '15s'; grant usage on schema reporting to report_ro; grant select on all tables in schema reporting to report_ro; alter default privileges in schema reporting grant select on tables to report_ro;`
  Bez `alter default privileges` widok dodany później daje `permission denied` (sprawdzone na PG 17). `default_transaction_read_only` to pas, nie bariera: rola sama go wyłącza (`set default_transaction_read_only = off`). Barierą są granty, a dziurą funkcje `SECURITY DEFINER` z `EXECUTE` dla `PUBLIC` (domyślnie) — `report_ro` może przez nie pisać (sprawdzone: zapis przeszedł). Takie funkcje: `revoke execute … from public` i grant tylko rolom, które ich potrzebują.
  Uwaga: widoki w `reporting` należą do właściciela schematu i domyślnie omijają RLS tabel źródłowych. To świadoma decyzja, więc widok zawiera tylko agregaty i kolumny dozwolone dla odbiorcy (→ 05 › Dane osobowe). `service_role` wyłącznie w kodzie serwerowym; osobny klucz albo rola per integracja, żeby dało się ją odciąć bez rotacji wszystkiego.
- **Konta platform:** MFA obowiązkowe dla każdego członka organizacji GitHub (wymuszenie 2FA w ustawieniach org), zespołu Vercel i organizacji Supabase `[NIEPEWNE: wymuszanie MFA na poziomie zespołu w Vercel/Supabase zależy od planu]`. Role minimalne: podwykonawca jako Developer/Read-only, nie Owner; na GitHubie bez admina repo. Tokeny API platform: fine-grained, z zakresem do repo/projektu i datą wygaśnięcia, przechowywane w menedżerze sekretów. Offboarding (lista kont + rotacja kluczy, które osoba znała) jest w RUNBOOK.
**Kiedy NIE upraszczać:** baza z danymi osobowymi lub finansowymi klientów i więcej niż jedna osoba z dostępem — wszystkie trzy punkty obowiązkowe przed produkcją.

| Wariant | Koszt operacyjny | Finansowy | Poznawczy |
|---|---|---|---|
| baza otwarta + silne hasło | zero | zero | niski; jeden wyciek URL-a = pełna baza |
| ograniczenia sieci + wymuszone SSL | allowlista IP do utrzymania (zmienne IP ludzi) | zero `[NIEPEWNE: plan]` | niski |
| rola `report_ro` na schemacie `reporting` | widoki do utrzymania | zero | niski |
| MFA + role minimalne na platformach | onboarding/offboarding z listą | zero | niski |
| PrivateLink/VPC peering, bastion, VPN do bazy | sieć do utrzymania | wysoki | wysoki — nie |
| SSO/SCIM dla zespołu | IdP, mapowanie ról | abonament (plany Enterprise) | średni — nie przy ~<10 osobach |

**Awarie i detekcja.**
- *baza przyjmuje połączenia z dowolnej sieci* — z sieci spoza allowlisty: `timeout 5 bash -c '</dev/tcp/db.<ref>.supabase.co/5432' && echo OTWARTE || echo ZAMKNIĘTE` i to samo dla hosta poolera z connection stringa (porty 5432 i 6543). Bezpośredni host bywa tylko IPv6 `[NIEPEWNE: stan dodatku IPv4 w projekcie]`, więc z sieci bez IPv6 wyjdzie fałszywe „ZAMKNIĘTE”; sprawdź `getent ahosts db.<ref>.supabase.co`; konfiguracja: `supabase network-restrictions get --project-ref <ref> --experimental` `[NIEPEWNE: składnia CLI]`
- *połączenia bez SSL* — `select s.ssl, a.usename, count(*) from pg_stat_ssl s join pg_stat_activity a using (pid) where a.backend_type='client backend' group by 1,2;`; w kodzie: `rg -n "sslmode=(disable|allow|prefer)|ssl: ?false|rejectUnauthorized: ?false" src scripts .env.example`
- *BI/skrypt na superuserze* — `select usename, application_name, client_addr, count(*) from pg_stat_activity where backend_type='client backend' group by 1,2,3 order by 4 desc;` (nieznane `application_name` na `postgres` = finding)
- *role logowania z nadmiarem uprawnień* — `select rolname, rolsuper, rolbypassrls, rolcreaterole, rolconnlimit from pg_roles where rolcanlogin order by 1;` (porównaj z listą oczekiwanych ról)
- *rola raportowa może pisać* — `select grantee, table_schema, table_name, privilege_type from information_schema.role_table_grants where grantee='report_ro' and privilege_type <> 'SELECT';` oraz furtka przez funkcje: `select n.nspname, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where p.prosecdef and n.nspname not in ('pg_catalog','information_schema') and has_function_privilege('report_ro', p.oid, 'EXECUTE');` (każdy wiersz = możliwy zapis z roli raportowej)
- *schemat raportowy wystawiony w API* — `rg -n "schemas|extra_search_path" supabase/config.toml` (lokalnie) + panel Settings → API (produkcja)
- *członkowie GitHub bez 2FA / brak wymuszenia* — `gh api orgs/<org> --jq .two_factor_requirement_enabled`; `gh api "orgs/<org>/members?filter=2fa_disabled" --jq '.[].login'` (wymaga uprawnień właściciela org)
- *nadmiar Ownerów na platformach* — panel Vercel (Team → Members) i Supabase (Organization → Team); wynik wpisz do RUNBOOK z datą (brak sprawdzonej komendy CLI)

**Audyt „czy się trzymamy".**
1. Czy baza odrzuca połączenia spoza allowlisty i wymusza SSL? → komendy sieci i SSL.
2. Czy raporty/BI używają osobnej roli tylko do odczytu, z limitami, na widokach bez PII? → komendy ról i grantów.
3. Czy nikt poza kodem serwerowym nie używa `postgres`/`service_role`? → komenda `pg_stat_activity` + `rg -n "service_role|SERVICE_ROLE" src | rg -v "server|functions|api"`.
4. Czy MFA jest wymuszone na GitHub, Vercel i Supabase, a role są minimalne? → komendy `gh api` + przegląd paneli z datą w RUNBOOK.
5. Czy tokeny platform są fine-grained, z datą wygaśnięcia i w menedżerze sekretów? → przegląd tokenów + `rg -n "ghp_|vercel_|sbp_" -g '!node_modules' .`.
6. Czy RUNBOOK ma procedurę offboardingu z listą kont i kluczy? → `rg -n -i "offboard|odebra|dostęp" docs/RUNBOOK.md`.

**Nie potrzebujesz jeszcze** (wariant → sygnał powrotu):
- PrivateLink/VPC peering → wymóg umowny klienta (np. sektor regulowany) albo własna infrastruktura w chmurze łącząca się z bazą.
- bastion/VPN do bazy → więcej niż ~3 osoby potrzebują bezpośredniego SQL na produkcji i allowlista IP przestaje się dać utrzymać.
- SSO/SCIM → ~>10 osób z dostępem do platform albo wymóg audytu dostępu klienta.
- automatyczna rotacja haseł ról → wymóg zgodności albo wyciek, po którym ręczna rotacja trwała ~>1 dzień.

---

### Koszt, uzależnienie od dostawcy i region

**Problem.** Rachunek rośnie bokiem (egress plików, LLM, SMS, funkcje), a wyjście z platformy bywa droższe niż wejście. Przykład: stary projekt zarządzany miał obiekty i polityki istniejące tylko w żywej bazie, więc schemat nie odtwarzał się z repo. Sygnały w diffie: nowa płatna zależność, upload plików, nowe wywołanie LLM/SMS, zmiana planu/regionu, nowe API specyficzne dla platformy.

**Domyślnie u nas.** Dla każdej nowej płatnej zależności: cena, właściciel, plan wyjścia i cap w ADR; budżet per organizacja z alertem (→ 03 › Rate limiting); region EEA blisko użytkowników — porównaj RTT do kandydatów regionów zamiast zgadywać (różne projekty mogą mieć różne regiony — każda taka różnica to osobna decyzja do uzasadnienia w ADR); schemat zawsze odtwarzalny z migracji w repo (porównanie z żywą bazą jest elementem audytu); sprzężenie z platformą w cienkim adapterze w jednym miejscu, nie w całej aplikacji; plan Free nie hostuje produkcji klienta (brak PITR, wstrzymywanie projektów `[NIEPEWNE: sprawdź zasady planu]`).
**Kiedy NIE oszczędzać hostingiem własnym:** przy rachunku rzędu ~kilkuset USD miesięcznie `[~]` własna administracja kosztuje więcej niż abonament.

| Wariant | Koszt operacyjny | Finansowy | Poznawczy |
|---|---|---|---|
| zarządzane + cap + alerty | pilnowanie limitów | przewidywalny | niski |
| własny hosting dla oszczędności | patche, backupy, dyżur | niski rachunek, wysoki koszt czasu | wysoki |
| abstrakcyjna warstwa „na wypadek zmiany dostawcy" | utrzymanie warstwy | zero | wysoki, rzadko się zwraca |

**Awarie i detekcja.**
- *egress/transfer niezmierzony przy plikach* — `select bucket_id, count(*), pg_size_pretty(sum((metadata->>'size')::bigint)) from storage.objects group by 1;` + zużycie w panelu platformy `[NIEPEWNE: lokalizacja metryk]`
- *schemat żywej bazy ≠ migracje w repo* — `select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE';` vs liczba `create table` w migracjach (02 › Model danych); polityki: `select count(*) from pg_policies where schemaname in ('public','storage');`
- *sprzężenie z dostawcą rozsiane po kodzie* — `rg -n "lovable\.dev|gateway\.lovable|@lovable" src supabase package.json`
- *brak capa na płatne API* — 03 › Rate limiting, komenda capa
- *region poza EEA/nieudokumentowany* — `rg -n -i "region|eu-central|eu-north|us-east" README.md docs`
- *produkcja na planie Free* — panel projektu → Settings → Billing/Subscription (nie da się z repo; wpisz plan do RUNBOOK)

**Audyt „czy się trzymamy".**
1. Czy każda nowa płatna zależność ma cenę, właściciela, cap i plan wyjścia w ADR? → `rg -n -i "cena|koszt|exit|wyjście" docs/adr`.
2. Czy schemat da się odtworzyć z repo (liczby zgodne)? → porównanie z awarii.
3. Czy sprzężenie z platformą jest w adapterze, nie w całym kodzie? → komenda sprzężenia.
4. Czy region jest zapisany, uzasadniony pomiarem i leży w EEA? → komenda regionu + `curl -w` do kandydatów.
5. Czy plan platformy jest wpisany do RUNBOOK i spełnia RPO? → `rg -n -i "plan|Pro|Free" docs/RUNBOOK.md`.

**Nie potrzebujesz jeszcze.** Multi-cloud, własnego hostingu dla oszczędności, abstrakcyjnej warstwy dostawcy, FinOps jako osobnej praktyki.

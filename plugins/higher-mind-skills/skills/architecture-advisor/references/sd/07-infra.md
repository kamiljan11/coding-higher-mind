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

**Stan floty (zweryfikowany z `package.json`, `vercel.json` i `docs/ARCHITECTURE.md` na gałęzi domyślnej, 2026-10-05):**

| Repo | Frontend/app | Hosting (dowód) | Backend/dane | Uwagi |
|---|---|---|---|---|
| `workshop-app` | Vite 8 + React 19 SPA, TanStack Router | Vercel (`vercel.json` w repo) | Supabase: Postgres, Auth, RLS, Storage, pgvector, Edge Functions (Deno); baza w `eu-central-1` wg runbooka | Sentry tylko front; edge functions NIE deployują się z gita (ręcznie `supabase functions deploy`); brak `lovable-tagger` |
| `shop-app` | Next 16 + Payload 3.89 | Vercel wg `docs/ARCHITECTURE.md` (brak `vercel.json` — konfiguracja po stronie panelu `[niezweryfikowane po stronie Vercel]`) | Postgres (Supabase) przez `@payloadcms/db-postgres`; Storage Supabase (adapter własny); payment-gateway; Resend | migracje Payloada uruchamiane przed `next build`; Stripe = martwa ścieżka szablonu; brak Sentry w deps |
| `marketplace-app` | Vite 7 + React 18, react-router-dom 7 | `vercel.json` na `main`; `docs/ARCHITECTURE.md` nadal mówi „Lovable" (rozjazd dokumentacji; ADR-0002 opisuje wyjście) | Supabase (`eu-north-1` wg ADR-0002), ~26+ edge functions, payment-gateway, eID | brak `lovable-tagger` w `package.json`; czat AI przez bramkę Lovable do wycofania `[stan w kodzie niezweryfikowany]` |
| `rental-site` (rental-app) | Next 16 (`--webpack`), React 19 | Vercel wg docs | Supabase przez `service_role` za sesją aplikacji; Resend; `pdf-lib` | status: zamknięty/referencyjny; single-tenant |
| `demo-site` (kamiljan.com) | TanStack Start + React 19 + Vite 7 | Vercel wg `docs/ARCHITECTURE.md` (nagłówek `Server: Vercel` opisany tam); `wrangler.jsonc` i wtyczka Cloudflare to pozostałość scaffoldu | brak bazy; AI: Vercel AI SDK + Anthropic; Resend przez `fetch` | zależność `@lovable.dev/vite-tanstack-config` = pochodzenie ze scaffoldu Lovable, nie `lovable-tagger` |

**Domyślnie u nas.** Vercel dla frontu/aplikacji (push na `main` = deploy, podgląd per PR), Supabase dla danych i funkcji brzegowych, Payload+Next, gdy klient potrzebuje panelu treści/sklepu, Lovable tylko dla starych lub prostych stron klientów — wykrywane `rg -n "lovable-tagger" package.json` (w 5 sprawdzonych repo go nie ma; to nie dowód dla pozostałych repo floty). Cloudflare Workers/Pages: w żadnym ze sprawdzonych repo nie jest hostem. Edge functions Supabase deployujemy osobno (CLI lub CI) i sprawdzamy rozjazd repo vs projekt. Reguła z `pg/prr.md` P1: przed obietnicą „wdrożone" potwierdź ścieżkę deployu.
**Kiedy NIE zmieniać platformy:** bez nazwanej przyczyny (koszt, limit, wymóg klienta) — migracja platformy to jedna z droższych operacji (marketplace-app ADR-0002).

| Wariant | Koszt operacyjny | Finansowy | Poznawczy |
|---|---|---|---|
| Vercel + Supabase | funkcje brzegowe deployowane osobno | wg planów `[NIEPEWNE]` | niski |
| Lovable (hosting + zarządzany Supabase) | `push` publikuje front, nie funkcje; rozjazd schematu żywej bazy z repo | wg planu | niski dziś, wysoki przy wyjściu |
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

**Problem.** Kontenery używamy do własnych narzędzi (Infisical, lokalny Postgres shop-app, podglądy), nie do produkcji klientów (ta stoi na platformach). Orkiestratory (Kubernetes) rozwiązują problemy floty usług i zespołu ops, których nie mamy. Sygnały w diffie: nowy `Dockerfile`/Compose, manifest `kind: Deployment`, `helm`, obraz `:latest`, sekret w `ENV`.

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

**Problem.** Pipeline jest bramką jakości i ścieżką wdrożenia; zielone CI z pominiętymi krokami jest gorsze niż czerwone. Flota ma w repo `quality.yml`, `claude-review.yml`, `release.yml` (a w części repo `mutation.yml`, w workshop-app `pg-review.yml`). Sygnały w diffie: zmiany w `.github/workflows`, `package.json` scripts, nowa migracja, tag/release.

**Domyślnie u nas.** PR → `quality.yml` (lint, `tsc -b`, testy, audyt zależności, licencje) → podgląd Vercel → recenzja → merge → automatyczny deploy; main chroniony wymaganymi checkami; nigdy `--no-verify`. Migracje: expand → deploy kodu → contract; funkcje Supabase deployowane osobno i w tej samej kolejności co migracje. Rollback: poprzedni deployment Vercel (promote) w minutach `[NIEPEWNE: limity planu]`; funkcje — redeploy poprzedniej wersji z gita; migracje nieodwracalne naprawiamy „do przodu" (stąd dwuetapowość). Wydania: SemVer, CHANGELOG `[Unreleased]` → wersja, tag `vX.Y.Z`. Kroki informacyjne (`continue-on-error`) są dopuszczalne tylko, gdy jawnie informacyjne (np. jscpd/knip w shop-app); krok gatingowy nie może być opcjonalny (`--if-present` przy `test:coverage` w shop-app oznacza, że krok się nie wykona bez skryptu — sprawdź, czy to zamierzone).
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

**Nie potrzebujesz jeszcze.** GitOps, canary/blue-green, platformy feature flag (flaga = kolumna/zmienna), narzędzi monorepo (nx/turbo), wielu środowisk poza prod + staging.

---

### Środowiska, konfiguracja i sekrety

**Problem.** Testy na produkcyjnej bazie, sekret w repo, klucz publiczny użyty jako tajny, flaga `TEST_MODE` maskująca prawdziwą ścieżkę — to najczęstsze incydenty procesowe floty. Sygnały w diffie: nowy plik `.env*`, nowa zmienna, `VITE_*`/`NEXT_PUBLIC_*`, zmiana `supabase/config.toml`, flaga środowiskowa.

**Domyślnie u nas.** Prod i staging z własnymi bazami (drugi projekt Supabase lub branching) od dnia 0; `.env.local` nigdy na referencji produkcyjnej (`node ~/.claude/bin/env-ref-gate.js --repo .`); `.env.example` bez wartości i zawsze aktualny (stan bieżący: w 4 repo śledzony jest tylko `.env.example`). Sekrety: Infisical na laptopie (most `infisical (CLI)`) → zmienne Vercel/sekrety funkcji Supabase; zmienne z prefiksem `VITE_`/`NEXT_PUBLIC_` są publiczne z założenia — nigdy sekret. Flagi `*_TEST_MODE` sprawdzane jawnie przed wdrożeniem (`pg/cases.md` TEST-MODE-MASKS-PROD). Konfiguracja biznesowa (przelicznik FX, narzuty, stawki, progi) jako dane w bazie/panelu, nie zmienne środowiskowe (wzór: ustawienia w shop-app).
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

### Koszt, uzależnienie od dostawcy i region

**Problem.** Rachunek rośnie bokiem (egress plików, LLM, SMS, funkcje), a wyjście z platformy bywa droższe niż wejście. marketplace-app ADR-0002 to gotowy przykład: stary projekt zarządzany miał obiekty i polityki istniejące tylko w żywej bazie, więc schemat nie odtwarzał się z repo. Sygnały w diffie: nowa płatna zależność, upload plików, nowe wywołanie LLM/SMS, zmiana planu/regionu, nowe API specyficzne dla platformy.

**Domyślnie u nas.** Dla każdej nowej płatnej zależności: cena, właściciel, plan wyjścia i cap w ADR; budżet per organizacja z alertem (→ 03 › Rate limiting); region EEA blisko użytkowników — porównaj RTT do kandydatów regionów zamiast zgadywać (workshop-app: `eu-central-1`, marketplace-app: `eu-north-1` — to dwie różne decyzje do uzasadnienia); schemat zawsze odtwarzalny z migracji w repo (porównanie z żywą bazą jest elementem audytu); sprzężenie z platformą w cienkim adapterze w jednym miejscu, nie w całej aplikacji; plan Free nie hostuje produkcji klienta (brak PITR, wstrzymywanie projektów `[NIEPEWNE: sprawdź zasady planu]`).
**Kiedy NIE oszczędzać hostingiem własnym:** przy rachunku rzędu ~kilkuset USD miesięcznie `[~]` własna administracja kosztuje więcej niż abonament.

| Wariant | Koszt operacyjny | Finansowy | Poznawczy |
|---|---|---|---|
| zarządzane + cap + alerty | pilnowanie limitów | przewidywalny | niski |
| własny hosting dla oszczędności | patche, backupy, dyżur | niski rachunek, wysoki koszt czasu | wysoki |
| abstrakcyjna warstwa „na wypadek zmiany dostawcy" | utrzymanie warstwy | zero | wysoki, rzadko się zwraca |

**Awarie i detekcja.**
- *egress/transfer niezmierzony przy plikach* — `select bucket_id, count(*), pg_size_pretty(sum((metadata->>'size')::bigint)) from storage.objects group by 1;` + zużycie w panelu platformy `[NIEPEWNE: lokalizacja metryk]`
- *schemat żywej bazy ≠ migracje w repo* — `select count(*) from information_schema.tables where table_schema='public';` vs liczba `create table` w migracjach (02 › Model danych); polityki: `select count(*) from pg_policies where schemaname in ('public','storage');`
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

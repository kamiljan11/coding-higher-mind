# 05 · Niezawodność, poprawność i bezpieczeństwo

Konwencje (`~`, `[NIEPEWNE]`, zmienne ścieżek, odsyłacze `NN › Karta`) — w `README.md`.
Tu bolą pieniądze i dane: duplikaty płatności, nadsprzedaż, wyciek między tenantami, brak kopii, „nie wiedzieliśmy". Wszystkie karty tego pliku są pierwszym wyborem przy audycie istniejącego repo.

---

### Idempotentność i deduplikacja

**Problem.** Każdy zapis, który może przyjść więcej niż raz (webhook, zadanie z kolejki, retry klienta, ponowienie n8n, dwukrotne kliknięcie), musi dać jeden efekt. Duplikat płatności lub maila to najdroższy rodzaj błędu. Sygnały w diffie: nowy handler webhooka/zadania, retry w kliencie, `insert` zamówienia/płatności/powiadomienia, zapis względny (`qty - n`, `increment`).

**Domyślnie u nas.** Tabela deduplikacji `processed_events(provider, event_id, received_at, PRIMARY KEY(provider, event_id))`; `insert … on conflict do nothing returning 1` — brak zwróconego wiersza = duplikat → 2xx bez efektu. Efekt i wpis dedup w jednej transakcji (funkcja SQL/RPC). Przejęcie stanu atomowym `UPDATE … WHERE status='pending' RETURNING *` (wzór w shop-app: `claimTransactionForConfirm` — pojedynczy `UPDATE … WHERE confirm_claimed_at IS NULL`, bo `payload.update` w adapterze Postgres to SELECT + UPDATE, czyli dwa zapytania, nie blokada). Zapisy absolutne (`set qty = $x`) zamiast względnych tam, gdzie to możliwe. Mutacje wywoływane przez klienta: nagłówek `Idempotency-Key`, tabela `(key, request_hash, response)` z TTL ~24 h `[~]`; ten sam klucz z innym body = 422. Efekty zewnętrzne, których nie cofniesz (mail, SMS, obciążenie karty), deduplikuj PRZED wysyłką (outbox z `UNIQUE`). Test w tej samej zmianie: to samo zdarzenie 2× → jeden efekt.
**Kiedy NIE:** operacje czysto odczytowe i naturalnie idempotentne (`PUT` całego zasobu, `set` absolutny) — wystarczy ich świadomość.

| Wariant | Koszt operacyjny | Finansowy | Poznawczy |
|---|---|---|---|
| UNIQUE + `on conflict` w transakcji | rosnąca tabela dedup, czyszczenie | zero | niski |
| atomowy `UPDATE … WHERE status` (claim) | jedna ścieżka przejścia stanu | zero | niski |
| klucz idempotencji klienta | tabela odpowiedzi, TTL | zero | średni |
| „exactly-once" platformy | vendor, ograniczenia | wysoki | wysoki — to i tak at-least-once + dedup |

**Awarie i detekcja.**
- *handler webhooka bez dedup/atomowego warunku* — `rg -n -l -i "webhook" src supabase/functions` → `rg -n -i "event_id|on conflict|processed_events|idempot|claim" <te pliki>` (brak = finding najwyższej wagi)
- *zapis względny w ścieżce pieniędzy/stanu* — `rg -n "(qty|quantity|balance|credits|stock|count)[^=\n]*[:=][^=\n]*[+-] ?[a-zA-Z0-9_]|\.increment\(|\.rpc\('(increment|decrement)" src supabase`
- *`payload.update`/`find` + `update` jako „lock"* — `rg -n -B3 -A8 "payload\.update\(" src | rg -i "status|claim|confirm|paid"`
- *brak UNIQUE na id zdarzenia* — `select indexrelid::regclass from pg_index where indisunique and indrelid::regclass::text ~ 'event|webhook|idempot|notification';`
- *efekt zewnętrzny bez dedup (mail/SMS w pętli lub w retry)* — `rg -n -i "resend|sendMail|sendSms|twilio" src supabase/functions -l` i w nich szukaj outboxu/UNIQUE

**Audyt „czy się trzymamy".**
1. Czy każdy handler zewnętrznego zdarzenia ma UNIQUE na id i zapis przed lub razem z efektem? → komendy powyżej.
2. Czy odpowiada 2xx przed wolną pracą? → odczyt handlera i `curl -w "%{time_total}"`.
3. Czy zapisy względne w pieniądzach/stanie są chronione kluczem lub warunkiem? → komenda zapisu względnego.
4. Czy przejście statusu płatności idzie jednym atomowym UPDATE-em? → `rg -n "claim|where .*status" src/lib/orders supabase/functions`.
5. Czy konsument zadań dedupuje po stabilnym id? → `rg -n "attempts|idempot" <worker>`.
6. Czy jest test „to samo zdarzenie 2×"? → `rg -ln -i "twice|duplicate|replay|2x|dwa razy" tests e2e supabase`.

**Nie potrzebujesz jeszcze.** Transakcji Kafki, rozproszonego cache dedup, CDC/outboxa strumieniowego.

---

### Współbieżność i wyścigi

**Problem.** Dwa żądania mogą zmienić to samo: stan magazynu, rezerwacja terminu, saldo/limit, numeracja, zadanie „tylko raz", cron odpalony dwa razy. Odczyt w JS, decyzja, zapis później = nadsprzedaż (TOCTOU). Sygnały w diffie: `select` → `if` → `update`, zapis stanu zależny od odczytu, nowy cron/zadanie cykliczne, rezerwacje/terminy.

**Domyślnie u nas.** Niezmienniki w bazie: `UNIQUE`, `CHECK (qty >= 0)`, `EXCLUDE USING gist` dla nakładających się rezerwacji (wymaga `btree_gist`); atomowe `update … set qty = qty - $n where id = $1 and qty >= $n returning qty`; blokada wiersza w funkcji SQL (`select … for update`) zawsze w tej samej kolejności; optymistycznie `where id = $1 and version = $2` dla edycji formularzy; izolacja domyślna (read committed), `serializable` tylko z pętlą retry. Jeden wykonawca zadania cyklicznego: `pg_try_advisory_xact_lock(key)` albo wiersz-lease w tabeli (advisory lock na poziomie sesji i transakcyjny pooler nie żyją w zgodzie `[NIEPEWNE: sprawdź tryb poolera]`). Transakcja krótka, bez wywołań sieciowych w środku (nie wołaj dostawcy płatności z otwartą blokadą). Test w tej samej zmianie: dwa równoległe żądania na ostatnią sztukę/termin → dokładnie jeden sukces.
**Kiedy NIE:** pojedynczy użytkownik edytuje własny rekord — wystarczy `updated_at` w warunku.

| Wariant | Koszt operacyjny | Finansowy | Poznawczy |
|---|---|---|---|
| constraint/atomowy UPDATE | zero (baza pilnuje) | zero | niski |
| `for update` w funkcji SQL | zakleszczenia przy złej kolejności | zero | średni |
| optymistyczna wersja | retry przy konflikcie | zero | niski |
| blokada rozproszona (Redis/etcd) | TTL, fencing, awarie | wysoki | wysoki — nie |

**Awarie i detekcja.**
- *TOCTOU: odczyt → decyzja → zapis* — `rg -n -U "\.select\([\s\S]{0,300}if \([\s\S]{0,200}\.(update|insert)\(" src supabase/functions` oraz `rg -n "(balance|credits|slots|available|stock)[^\n]{0,40}(>=|<=|>|<)" src supabase/functions`
- *niezmiennik tylko w kodzie* — `rg -n "UNIQUE|CHECK \(|EXCLUDE" supabase/migrations src/migrations | wc -l` vs reguły biznesowe z opisu
- *długie transakcje / połączenia „idle in transaction"* — `select pid, now()-xact_start as age, left(query,60) from pg_stat_activity where state like 'idle in transaction%';`
- *zakleszczenia i oczekiwanie na locki* — `select pid, wait_event_type, wait_event, left(query,60) from pg_stat_activity where wait_event_type='Lock';` oraz logi: `rg -n "deadlock detected" <logi>`
- *cron odpalony dwa razy* — `select jobname, schedule from cron.job;` i sprawdź ochronę w treści zadania (advisory lock/lease)
- *sieć w środku transakcji* — `rg -n -B6 "await fetch\(|\.invoke\(" src supabase/functions | rg -i "begin|transaction|for update"`

**Audyt „czy się trzymamy".**
1. Czy zmiana stanu zależna od odczytu jest jednym atomowym UPDATE-em/RPC albo ma `for update`? → pierwsza komenda.
2. Czy niezmienniki są constraintami? → `select conrelid::regclass, conname, contype from pg_constraint where connamespace='public'::regnamespace and contype in ('u','c','x');`.
3. Czy rezerwacje mają `EXCLUDE` na nakładanie się? → `rg -n -i "exclude using|tstzrange|daterange" supabase/migrations`.
4. Czy cron/zadania cykliczne są chronione przed równoległym wykonaniem? → treść zadania + `rg -n "advisory|skip locked" supabase`.
5. Czy transakcje są krótkie i bez sieci w środku? → ostatnia komenda.
6. Czy jest test wyścigu? → `rg -ln -i "race|concurrent|Promise\.all" tests e2e | head`.

**Nie potrzebujesz jeszcze.** Rozproszonych blokad, etcd/ZooKeeper/Redlock, konsensusu Raft, `serializable` jako domyślnego poziomu, sag (to temat wielu usług).

---

### Zależności zewnętrzne: timeout, retry, wyłącznik

**Problem.** Każde wywołanie poza naszym procesem (dostawca płatności, SMS, poczty, model LLM, embeddingi, Supabase, API sklepów) jest tym, co się zawiesi w najgorszym momencie. Bez timeoutu funkcja czeka do limitu platformy, a użytkownik widzi biały ekran lub niespójny stan. Sygnały w diffie: nowy `fetch`/SDK, nowa integracja, retry w pętli, nowa zmienna `*_API_KEY`.

**Domyślnie u nas.** Cienki klient na dostawcę w jednym miejscu: `AbortSignal.timeout(ms)` dobrany do p99 dostawcy (zewnętrzne API ~5–10 s `[~]`; LLM dłużej, najlepiej streaming), `User-Agent`, obsługa 429/5xx z `Retry-After`; retry maks. 3×, backoff wykładniczy z jitterem, TYLKO dla operacji idempotentnych (GET, PUT, POST z kluczem idempotencji); komunikat/fallback dla użytkownika; wyłącznik awaryjny (flaga w tabeli ustawień/env) zamiast biblioteki circuit breaker. Tabela zależności w `docs/RUNBOOK.md`: dostawca | co się psuje | fallback | wyłącznik | kontakt. Budżet czasu: limit użytkownika > suma timeoutów wewnętrznych. Brak timeoutu jest znaną blizną floty (`pg/cases.md` NO-TIMEOUT-EXTERNAL; find-part ~7 s w `pg/prr.md` P5).
**Kiedy NIE retry:** operacje nieidempotentne bez klucza (obciążenie karty, wysyłka SMS) — najpierw klucz/dedup, potem retry.

| Wariant | Koszt operacyjny | Finansowy | Poznawczy |
|---|---|---|---|
| timeout + retry + flaga | stały wzorzec w kliencie | zero | niski |
| circuit breaker (biblioteka) | stan, strojenie, ukrywa problemy | zero | średni |
| bulkhead/hedging | osobne pule, podwojone zapytania | wyższy | wysoki — nie |
| kolejka wokół integracji | worker, stan | zero | średni — dla wolnych/zawodnych kroków |

**Awarie i detekcja.**
- *brak timeoutu* — `rg -n "fetch\(" src supabase/functions -A6 | rg -v "signal|timeout|AbortSignal"` (heurystyka: przejrzyj trafienia `fetch(` bez `signal` w oknie)
- *retry bez backoffu/limitu lub na nieidempotentnych* — `rg -n -i "retry|retries|backoff|attempt" src supabase/functions`
- *brak `User-Agent` (403/1010 za Cloudflare)* — `rg -n -i "user-agent" src supabase/functions | wc -l` vs liczba klientów API
- *429/5xx nieobsłużone* — `rg -n "status === 429|status >= 500|Retry-After|retry-after" src supabase/functions`
- *brak wyłącznika i opisu w runbooku* — `rg -n -i "kill switch|wyłącznik|feature flag" docs/RUNBOOK.md`
- *zależność bez klucza w env.example* — `rg -n "_API_KEY|_TOKEN|_SECRET" .env.example | wc -l`

**Audyt „czy się trzymamy".**
1. Czy każdy `fetch`/klient SDK ma timeout? → pierwsza komenda.
2. Czy retry ma backoff + jitter + limit prób i dotyczy tylko idempotentnych operacji? → `rg` z awarii + odczyt.
3. Czy użytkownik dostaje komunikat/fallback, gdy zależność padnie? → `rg -n -i "unavailable|spróbuj ponownie|try again" src`.
4. Czy jest wyłącznik i wpis w runbooku? → komenda runbook.
5. Czy 429/5xx (w tym `Retry-After`) są obsłużone? → komenda z awarii.
6. Czy tabela zależności w runbooku obejmuje nową integrację? → `rg -n -i "<dostawca>" docs/RUNBOOK.md`.

**Nie potrzebujesz jeszcze.** Bibliotek circuit breaker, bulkheadów, hedged requests, service mesh, chaos engineeringu.

---

### Tożsamość i autoryzacja

**Problem.** Uwierzytelnianie (kim jesteś) i autoryzacja (co wolno) to dwa systemy; błędy siedzą głównie w autoryzacji. Flota używa wzorców: Supabase Auth + RLS, Payload Users + `access`, własna sesja HMAC dla jednego operatora oraz eID przez zewnętrznego dostawcę (które repo ma który wzorzec: `prywatne notatki floty (poza eksportem)`). Sygnały w diffie: nowy endpoint/RPC/kolekcja/tabela, zmiana ról, `service_role`, `verify_jwt`, `user_metadata`, nowe `access`.

**Domyślnie u nas.** Authn: gotowa usługa (Supabase Auth, Payload Users); eID tylko przez dostawców; własna sesja tylko dla jednego zaufanego operatora i z odmową przy braku sekretu w produkcji. Authz: w bazie jako RLS (`(select auth.uid())` + członkostwo w org) w jednym miejscu, albo w Payload jako `access` per kolekcja i pole. Pułapka Payload: Local API (`payload.find/update/…`) domyślnie omija kontrolę dostępu — przy wywołaniu w imieniu użytkownika podaj `user` i `overrideAccess: false`. Rola w tabeli `user_roles` + funkcja `has_role()` (wzorzec), nie w `user_metadata` (edytowalne przez użytkownika; `app_metadata` nie `[NIEPEWNE: potwierdź w docs]`). `service_role` tylko po stronie serwera, nigdy w zmiennej `VITE_*`/`NEXT_PUBLIC_*`. Funkcje SECURITY DEFINER: `set search_path = ''`, `revoke execute … from public, anon`, sprawdzenie `auth.uid()`/org w ciele. JWT krótkożyjący — decyzje wrażliwe (zmiana roli, płatności) czytają uprawnienia z bazy. MFA dla adminów. Funkcje edge z `verify_jwt = false` (webhooki) weryfikują podpis same.
**Kiedy NIE budować:** własnego logowania, własnego eID, własnego silnika polityk.

| Wariant | Koszt operacyjny | Finansowy | Poznawczy |
|---|---|---|---|
| Supabase Auth + RLS | polityki + testy per tabela | w cenie planu | średni |
| Payload `access` | funkcje dostępu per kolekcja/pole | zero | średni; Local API omija domyślnie |
| `service_role` za sesją aplikacji | jedna warstwa w kodzie, błąd = pełny dostęp | zero | niski |
| ReBAC/OPA/Keycloak | osobny serwis | wysoki | wysoki — nie |

**Awarie i detekcja.**
- *tabele/polityki/funkcje/widoki* — zapytania z karty „Multi-tenancy w danych" (02) oraz `node ~/.claude/bin/sql-migration-lint.js --repo . --strict --json`
- *`service_role` w kodzie klienta* — `rg -n "service_role|SERVICE_ROLE" src | rg -v "server|functions|api"`; `rg -n "VITE_.*(SECRET|SERVICE|PRIVATE)|NEXT_PUBLIC_.*(SECRET|SERVICE|PRIVATE)" .env* src`
- *rola z `user_metadata`* — `rg -n "user_metadata" src supabase`
- *Payload Local API bez kontroli dostępu* — `rg -n "payload\.(find|findByID|create|update|delete|count)\(" src | rg -v "overrideAccess"` (każdy wynik: czy to zaufany kod serwera, czy handler w imieniu użytkownika?)
- *kolekcja bez `access`* — `rg --files-without-match "access:" src/collections --glob '*.ts'`
- *endpoint bez uwierzytelnienia* — `rg -n "verify_jwt" supabase/config.toml`; `rg -n "export (async )?function (GET|POST|PUT|PATCH|DELETE)" src/app/api` zestawione z `rg -n "<bramka sesji>|getUser|auth\(" src/app/api` (nazwa bramki: `prywatne notatki floty (poza eksportem)`)
- *IDOR: zapytanie po `id` bez filtra org* — `rg -n "\.eq\(['\"]id['\"]" src | rg -v "org"`
- *token w logach/URL* — `rg -n -i "console\.(log|error)\(.*(token|authorization|secret)" src supabase/functions`

**Audyt „czy się trzymamy".**
1. Czy każda tabela tenantowa ma RLS z `USING` i `WITH CHECK` oraz test cross-tenant? → zapytania RLS + `rg -ln -i "cross.?tenant|other.?org" tests`.
2. Czy `service_role` występuje wyłącznie w kodzie serwerowym? → komenda z awarii (wynik = 0 poza serwerem).
3. Czy każde zapytanie po `id` ma filtr org/user albo RLS? → komenda IDOR.
4. Czy zmiana roli działa w akceptowalnym czasie? → `rg -n "jwt_expiry|expiresIn" supabase/config.toml src`.
5. Czy autoryzacja jest w jednym miejscu (policy/helper), nie kopiowana per endpoint? → `rg -c "has_role|<bramka sesji>|access:" src supabase | head`.
6. Czy admin ma MFA? → ustawienie Auth w panelu/`config.toml` `rg -n -i "mfa" supabase/config.toml`.
7. Czy Payload Local API wywoływane w imieniu użytkownika przekazuje `user` i `overrideAccess: false`? → komenda Local API.

**Nie potrzebujesz jeszcze.** ReBAC/Zanzibar/OpenFGA, OPA, własnego IdP/Keycloak, SSO/SAML (dopóki klient tego nie wymaga), własnych passkeys.

---

### Obserwowalność i alerty

**Problem.** Bez monitoringu o awarii dowiaduje się pierwszy klient. Typowy stan do sprawdzenia w repo: tylko część projektów ma error tracking w `package.json` (`rg -n "sentry" package.json`), a runbooki bywają z placeholderem `[link do projektu]` zamiast skonfigurowanego monitoringu (`rg -n "\[link" docs/RUNBOOK.md`). Stan per repo: `prywatne notatki floty (poza eksportem)`. Sygnały w diffie: nowy `catch`, nowa ścieżka krytyczna, nowa funkcja, nowy alert w runbooku.

**Domyślnie u nas.** Sentry (front i serwer) dla każdego repo produkcyjnego; logi strukturalne (`level`, `msg`, `request_id`, `org_id`, id encji, powód); `request_id` generowany na wejściu i zwracany w błędzie; jeden kanał alertów (mail) z przetestowanym zdarzeniem i datą testu w runbooku; zewnętrzny monitor dostępności; metryki biznesowe jako zapytania + alert (zamówienia `pending` > 1 h, zadania `dead`, najstarsze zadanie w kolejce); `catch` loguje z kontekstem lub rzuca dalej; zero PII i tokenów w logach.
**Kiedy NIE:** prototypy bez użytkowników — wystarczą logi platformy.

| Wariant | Koszt operacyjny | Finansowy | Poznawczy |
|---|---|---|---|
| Sentry + logi platformy | konfiguracja i alerty | ~plan darmowy do małej skali `[NIEPEWNE: limity planu]` | niski |
| logi strukturalne + `request_id` | dyscyplina w kodzie | zero | niski |
| OpenTelemetry/Grafana | utrzymanie stosu | wysoki | wysoki — nie |

**Awarie i detekcja.**
- *brak error trackingu* — `rg -n "captureException|@sentry|Sentry\.init" package.json src supabase/functions` (0 trafień w repo produkcyjnym = finding)
- *placeholder w runbooku zamiast alertu* — `rg -n "\[link|\[URL|\[do uzupełnienia|TODO" docs/RUNBOOK.md`
- *połknięty błąd* — `rg -n "catch\s*(\([^)]*\))?\s*\{\s*\}" src supabase/functions`
- *PII/tokeny w logach* — `rg -n -i "console\.(log|error|warn)\(.*(email|phone|kennitala|pesel|token|password)" src supabase/functions`
- *brak `request_id`* — `rg -n "request_id|requestId|x-request-id" src supabase/functions | wc -l`
- *alert bez odbiorcy lub nieprzetestowany* — `rg -n -i "alert|testowy event|ostatni test" docs/RUNBOOK.md`
- *metryka biznesowa niepilnowana (nazwa tabeli i statusu wg schematu repo)* — `select count(*) from orders where status='pending' and created_at < now() - interval '1 hour';`

**Audyt „czy się trzymamy".**
1. Czy ścieżka krytyczna ma `captureException`/`logger.error` w `catch`? → pierwsza komenda.
2. Czy `request_id` trafia do logów i odpowiedzi błędu? → szósta komenda.
3. Czy runbook wskazuje kanał alertu i datę testowego zdarzenia (nie placeholder)? → druga komenda.
4. Czy w logach nie ma PII/tokenów? → czwarta komenda.
5. Czy istnieją alerty na metryki biznesowe (zawieszone płatności, kolejka)? → `rg -n -i "pending|dead|backlog" docs/RUNBOOK.md`.
6. Czy logi mają retencję i poziomy? → ustawienia platformy/`RUNBOOK`.

**Nie potrzebujesz jeszcze.** Prometheusa, Grafany, OpenTelemetry, Datadoga, tracingu rozproszonego, SLO z burn-rate.

---

### Kopie zapasowe i odtwarzanie

**Problem.** Kopia nieodtworzona próbnie nie jest kopią. Dotyczy bazy (Supabase/Postgres), plików (Storage) i własnych usług (menedżer sekretów, n8n). Sygnały w diffie: migracja destrukcyjna, zmiana planu/projektu Supabase, nowy magazyn, zmiana RUNBOOK, wyjście z platformy (zdarza się, że obiekty i polityki istnieją tylko w żywej bazie).

**Domyślnie u nas.** RPO i RTO zapisane w `docs/RUNBOOK.md` i uzgodnione z klientem; plan Supabase dobrany do wymaganego RPO (kopie dobowe od planu Pro; PITR to osobna opcja `[NIEPEWNE: sprawdź w panelu]`; plan Free nie ma PITR — `pg/prr.md` P16); `pg_dump` cron jako druga linia; próbny restore z datą w runbooku (`python3 ~/.claude/bin/backup-drill.py`). Replika to nie kopia — usunięcie replikuje się. Pliki: [NIEPEWNE: według dokumentacji Supabase kopie bazy mogą nie zawierać obiektów Storage (tylko metadane); runbook może twierdzić, że są objęte — zweryfikuj i, jeśli nie są, dodaj osobny eksport]. Własne usługi (np. menedżer sekretów): szyfrowane kopie i skrypt testu odtwarzania (ścieżki i komendy: `prywatne notatki floty (poza eksportem)`); klucz szyfrujący przechowywany osobno od kopii.
**Kiedy NIE:** brak — ale „multi-region/hot standby" to osobna decyzja kosztowa, nie domyślna.

| Wariant | Koszt operacyjny | Finansowy | Poznawczy |
|---|---|---|---|
| dobowe kopie platformy | restore = ostatni snapshot (RPO do ~24 h) | w planie Pro `[NIEPEWNE]` | niski |
| PITR | restore do punktu w czasie | dodatek płatny `[NIEPEWNE]` | niski |
| `pg_dump` + storage na zewnątrz | cron, miejsce, szyfrowanie | niski | średni |
| replika/standby | failover do przećwiczenia | drugi serwer | wysoki — nie przy tej skali |

**Awarie i detekcja.**
- *restore nigdy niewykonany* — `rg -n "Ostatni test restore: [0-9]{4}" docs/RUNBOOK.md` (brak = finding; data starsza niż ~kwartał = przeterminowana)
- *plan bez PITR przy wymaganym RPO < doba* — panel projektu → Database → Backups; w repo: `rg -n -i "RPO|RTO|PITR" docs/RUNBOOK.md`
- *pliki bez kopii* — `select bucket_id, count(*), pg_size_pretty(sum((metadata->>'size')::bigint)) from storage.objects group by 1;` i sprawdź, czy istnieje eksport
- *migracja destrukcyjna bez świeżej kopii* — `rg -n -i "drop (table|column)|truncate|delete from" supabase/migrations | tail -20` zestawione z datą ostatniego restore/backupu
- *kopie na tym samym dysku/koncie co źródło* — `ls -la <katalog kopii>; df -h <katalog kopii> /` (jedno urządzenie = jedna awaria; ścieżki: `prywatne notatki floty (poza eksportem)`)
- *rozmiar rośnie bez planu* — `select pg_size_pretty(pg_database_size(current_database()));`

**Audyt „czy się trzymamy".**
1. Czy RPO/RTO są zapisane i zgodne z planem platformy? → `rg -n -i "RPO|RTO" docs/RUNBOOK.md`.
2. Czy restore był przećwiczony, z datą? → pierwsza komenda; nowy drill: `python3 ~/.claude/bin/backup-drill.py --help`.
3. Czy pliki Storage mają osobną kopię lub potwierdzone pokrycie? → zapytanie o storage + dokumentacja Supabase.
4. Czy migracja T3 miała świeżą kopię i plan rollbacku? → opis PR + data kopii.
5. Czy kopie własnych usług (Infisical) są szyfrowane i testowane? → lista katalogu kopii (`ls <katalog kopii> | tail`) oraz skrypt testu odtwarzania, jeśli istnieje — sprawdź jego docstring, bo tryby różnią się skutkami (np. `--selftest` robi świeży backup żywej usługi, więc nie jest czystym odczytem; wywołanie bez argumentów kończy się błędem). Konkretna komenda: `prywatne notatki floty (poza eksportem)`.
6. Czy plan Free nie hostuje produkcji klienta? → panel projektu / `RUNBOOK`.

**Nie potrzebujesz jeszcze.** Replik międzyregionowych, hot standby, własnego archiwum WAL, strony DR.

---

### Dane osobowe, retencja i prywatność

**Problem.** Flota przechowuje dane osobowe klientów i pracowników (imię, telefon, e-mail, adres, kennitala, zdjęcia pojazdów z tablicami, ewentualnie lokalizacja) i wysyła fragmenty do dostawców (poczta, SMS, LLM, embeddingi, płatności). Sygnały w diffie: nowa kolumna z danymi osobowymi, nowy log, nowa integracja wysyłająca dane na zewnątrz, nowy eksport CSV, prompt LLM zawierający dane klienta.

**Domyślnie u nas.** `docs/PRIVACY.md` w repo: co, po co, jak długo, kto ma dostęp, kto jest podprocesorem. Dane osobowe w jednym miejscu (profil), reszta przez id. Kennitala i podobne identyfikatory: nigdy w logach/URL, ograniczony dostęp, rozważ szyfrowanie kolumny `[NIEPEWNE: wymogi prawne — zweryfikuj z klientem]`. Retencja jako zadanie cykliczne z testem; procedura usunięcia/anonimizacji na żądanie w runbooku; zgody (marketing) zapisane z datą i źródłem; fixtury i zrzuty ekranu bez realnych danych (`pg/prr.md` P13); region EEA; do LLM wysyłaj minimum danych i sprawdź warunki retencji dostawcy `[NIEPEWNE]`.
**Kiedy NIE:** brak danych osobowych (portfolio) — wystarczy lista tego, co zbiera formularz kontaktowy.

| Wariant | Koszt operacyjny | Finansowy | Poznawczy |
|---|---|---|---|
| minimalizacja + retencja + dokument | cykliczny job, test | zero | niski |
| szyfrowanie kolumn | klucze, brak wyszukiwania po wartości | niski | średni |
| anonimizacja/pseudonimizacja | procedury, utrata danych analitycznych | zero | średni |

**Awarie i detekcja.**
- *kolumny z danymi osobowymi (inwentarz)* — `select table_name, column_name from information_schema.columns where table_schema='public' and column_name ~* '(email|phone|telefon|kennitala|pesel|address|adres|birth|ssn|plate|rejestr)';`
- *PII w logach* — `rg -n -i "console\.(log|error|warn)\(.*(email|phone|telefon|kennitala|pesel)" src supabase/functions`
- *brak dokumentu prywatności* — `ls docs/PRIVACY.md; rg -n -i "retencj|retention" docs/PRIVACY.md`
- *dane w fixturach* — `rg -n "@[a-z0-9-]+\.(is|pl|com)|kennitala|[0-9]{6}-?[0-9]{4}" tests fixtures e2e`
- *PII w promptach LLM* — `rg -n -i "email|phone|telefon|address" src supabase/functions | rg -i "prompt|messages|generateText|streamText"`
- *brak retencji* — `rg -n -i "delete from .* where .*(created_at|expires)" supabase scripts src | head`

**Audyt „czy się trzymamy".**
1. Czy jest aktualny `docs/PRIVACY.md` z celem i retencją? → komenda z awarii.
2. Czy nowa kolumna z danymi osobowymi jest w inwentarzu i ma politykę dostępu? → zapytanie inwentarza.
3. Czy logi nie zawierają PII/tokenów? → komenda logi.
4. Czy retencja działa (job + test)? → `rg -n -i "retention|retencj" supabase scripts`.
5. Czy do LLM/SMS/mail idzie minimum danych, a podprocesor jest wymieniony? → komenda promptów + `docs/PRIVACY.md`.
6. Czy jest procedura usunięcia na żądanie? → `rg -n -i "usunięc|erasure|delete account" docs`.

**Nie potrzebujesz jeszcze.** Narzędzi DPO, katalogu danych, tokenizacji, pseudonimizacji kluczem w HSM.

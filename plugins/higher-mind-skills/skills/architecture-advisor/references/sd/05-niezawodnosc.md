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

**Nie potrzebujesz jeszcze** (wariant → sygnał powrotu):
- transakcje Kafki → nie używamy Kafki; sygnał na Kafkę: → 04 › Zdarzenia.
- rozproszony cache dedup → tabela dedup ~>dziesiątki mln wierszy i `insert on conflict` widoczny w `pg_stat_statements` w top 5.
- CDC / outbox strumieniowy → ≥2 systemy konsumują te same zdarzenia w czasie ~sekund; do tego czasu outbox w tabeli + worker.

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
- *gorący wiersz (hot row)* — wielu piszących aktualizuje TEN SAM wiersz (licznik, saldo firmy, „ostatni numer") → zapisy ustawiają się w kolejce na locku i rośnie p95. Obejścia zależą od niezmiennika: **licznik przemienny bez niezmiennika** (odsłony, polubienia) → INSERT-only (dziennik) + agregat albo liczniki shardowane (N wierszy, suma przy odczycie); **saldo z warunkiem ≥ 0 i numeracja bez luk** (faktury PL/IS) → NIE shardować, zostaje serializacja jednego wiersza: `UPDATE … SET n = n + 1 … RETURNING n` / `UPDATE … WHERE balance >= x`, krótka transakcja. Limit czekania: `SET LOCAL lock_timeout = '3s'` w transakcji, `set_config('lock_timeout','3s', true)` w RPC albo `SET lock_timeout = '3s'` w definicji funkcji — goły `SET` sesyjny nie działa przez PostgREST/supabase-js i przecieka przez pooler transakcyjny. Detekcja: `select relname, n_tup_upd from pg_stat_user_tables order by n_tup_upd desc limit 5;` + oczekiwania na `Lock` (komenda wyżej) (2026-10-10, symulacje baz Arjaya)

**Audyt „czy się trzymamy".**
1. Czy zmiana stanu zależna od odczytu jest jednym atomowym UPDATE-em/RPC albo ma `for update`? → pierwsza komenda.
2. Czy niezmienniki są constraintami? → `select conrelid::regclass, conname, contype from pg_constraint where connamespace='public'::regnamespace and contype in ('u','c','x');`.
3. Czy rezerwacje mają `EXCLUDE` na nakładanie się? → `rg -n -i "exclude using|tstzrange|daterange" supabase/migrations`.
4. Czy cron/zadania cykliczne są chronione przed równoległym wykonaniem? → treść zadania + `rg -n "advisory|skip locked" supabase`.
5. Czy transakcje są krótkie i bez sieci w środku? → ostatnia komenda.
6. Czy jest test wyścigu? → `rg -ln -i "race|concurrent|Promise\.all" tests e2e | head`.

**Nie potrzebujesz jeszcze** (wariant → sygnał powrotu):
- rozproszone blokady / Redlock → wykonawcy bez wspólnej bazy; dopóki jest Postgres — advisory lock lub wiersz-lease.
- etcd/ZooKeeper/Raft → nigdy samodzielnie; przychodzą z K8s lub bazą rozproszoną.
- `serializable` domyślnie → ≥2 incydenty anomalii (write skew), których nie da się zamknąć constraintem ani `for update`.
- repeatable read → raport/eksport musi widzieć spójną migawkę wielu tabel (jedna transakcja `repeatable read read only`).
- kolejka dla gorącego wiersza → jeden wiersz (licznik, ostatnia sztuka) dostaje ~>50 równoległych zapisów/s i `wait_event_type='Lock'` dominuje.
- sagi → jak w 02 › Spójność per przepływ.

---

### Zależności zewnętrzne: timeout, retry, wyłącznik

**Problem.** Każde wywołanie poza naszym procesem (dostawca płatności, SMS, poczty, model LLM, embeddingi, Supabase, API sklepów) jest tym, co się zawiesi w najgorszym momencie. Bez timeoutu funkcja czeka do limitu platformy, a użytkownik widzi biały ekran lub niespójny stan. Sygnały w diffie: nowy `fetch`/SDK, nowa integracja, retry w pętli, nowa zmienna `*_API_KEY`.

**Domyślnie u nas.** Cienki klient na dostawcę w jednym miejscu: `AbortSignal.timeout(ms)` dobrany do p99 dostawcy (zewnętrzne API ~5–10 s `[~]`; LLM dłużej, najlepiej streaming), `User-Agent`, obsługa 429/5xx z `Retry-After`; retry maks. 3×, backoff wykładniczy z jitterem, TYLKO dla operacji idempotentnych (GET, PUT, POST z kluczem idempotencji); komunikat/fallback dla użytkownika; wyłącznik awaryjny (flaga w tabeli ustawień/env) zamiast biblioteki circuit breaker. Tabela zależności w `docs/RUNBOOK.md`: dostawca | co się psuje | fallback | wyłącznik | kontakt. Budżet czasu: limit użytkownika > suma timeoutów wewnętrznych. Brak timeoutu jest znaną blizną floty (`pg/cases.md` NO-TIMEOUT-EXTERNAL; find-part ~7 s w `pg/prr.md` P5). Burst żądań do wolnej/limitowanej zależności (LLM, SMS, mail) → limit współbieżności i szybkie 429/503 zamiast czekania do timeoutu (→ 03 › Backpressure i zrzucanie obciążenia).
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

**Nie potrzebujesz jeszcze** (wariant → sygnał powrotu):
- biblioteka circuit breaker → ≥3 zależności, których awaria kaskaduje, a ręczny wyłącznik nie zadziałał na czas (incydent).
- bulkhead → jedna wolna integracja wyczerpuje połączenia/współbieżność funkcji wspólną z ścieżką krytyczną.
- hedged requests → p99 dostawcy ~>5× p50, operacja idempotentna i tania do zdublowania.
- service mesh → jak w 03 › Health checki.
- chaos engineering → SLA umowne i przećwiczone runbooki; wcześniej wystarczy drill restore i test wyłącznika.

---

### Tożsamość i autoryzacja

**Problem.** Uwierzytelnianie (kim jesteś) i autoryzacja (co wolno) to dwa systemy; błędy siedzą głównie w autoryzacji. Flota używa wzorców: Supabase Auth + RLS, Payload Users + `access`, własna sesja HMAC dla jednego operatora oraz eID przez zewnętrznego dostawcę (które repo ma który wzorzec: `prywatne notatki floty (poza eksportem)`). Sygnały w diffie: nowy endpoint/RPC/kolekcja/tabela, zmiana ról, `service_role`, `verify_jwt`, `user_metadata`, nowe `access`.

**Domyślnie u nas.** Authn: gotowa usługa (Supabase Auth, Payload Users); eID tylko przez dostawców; własna sesja tylko dla jednego zaufanego operatora i z odmową przy braku sekretu w produkcji. Authz: w bazie jako RLS (`(select auth.uid())` + członkostwo w org) w jednym miejscu, albo w Payload jako `access` per kolekcja i pole. Pułapka Payload: Local API (`payload.find/update/…`) domyślnie omija kontrolę dostępu — przy wywołaniu w imieniu użytkownika podaj `user` i `overrideAccess: false`. Rola w tabeli `user_roles` + funkcja `has_role()` (wzorzec), nie w `user_metadata` (edytowalne przez użytkownika; `app_metadata` nie `[NIEPEWNE: potwierdź w docs]`). `service_role` tylko po stronie serwera, nigdy w zmiennej `VITE_*`/`NEXT_PUBLIC_*`. Funkcje SECURITY DEFINER: `set search_path = ''`, `revoke execute … from public, anon`, sprawdzenie `auth.uid()`/org w ciele. JWT krótkożyjący — decyzje wrażliwe (zmiana roli, płatności) czytają uprawnienia z bazy. MFA dla adminów. Funkcje edge z `verify_jwt = false` (webhooki) weryfikują podpis same. Integracje (OAuth/OIDC, usługa → usługa, unieważnianie tokenów, klucze partnerów) → karta niżej.
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

**Nie potrzebujesz jeszcze** (wariant → sygnał powrotu):
- ReBAC/Zanzibar/OpenFGA → jak w 02 › Multi-tenancy.
- ABAC (atrybuty: region, godzina, wartość zlecenia) → ≥3 reguły zależne od atrybutów zasobu, których role nie wyrażają; najpierw jako warunki w RLS.
- OPA → jak w 02 › Multi-tenancy.
- własny IdP/Keycloak → ≥3 aplikacje z jednym logowaniem dla tych samych użytkowników i wymóg federacji, którego Supabase Auth nie daje.
- SSO/SAML → klient korporacyjny wpisuje to w umowę `[NIEPEWNE: SAML w Supabase wg planu]`.
- własne passkeys → nigdy własne; WebAuthn przez usługę Auth, gdy ją wspiera.
- mTLS między usługami → usługi poza platformą w prywatnej sieci klienta lub wymóg umowny; wcześniej podpisany JWT/HMAC (karta niżej).

---

### Uwierzytelnianie integracji: OAuth/OIDC, usługi, tokeny, klucze partnerów

**Problem.** Poza logowaniem hasłem flota ma: logowanie Google/Microsoft (OAuth2/OIDC), wywołania usługa → usługa (edge function → edge function, n8n → nasze API, cron → API), odwołanie dostępu (zwolniony pracownik, wyciek tokenu) i partnerów B2B wołających nasze API. Każde ma inny model zaufania. Typowe błędy: implicit flow z tokenem w URL, wspólny sekret wklejony na stałe w węzeł n8n, `service_role` jako „hasło" między usługami, klucz partnera trzymany jawnie w bazie, „wylogowanie", które nie unieważnia wydanego tokenu. Sygnały w diffie: `signInWithOAuth`, `/auth/callback`, `exchangeCodeForSession`, nowy nagłówek `x-api-key`/`Authorization` w wywołaniu wewnętrznym, nowa tabela `api_keys`, `verify_jwt = false`, `signOut`.

**Domyślnie u nas.**
- **OAuth2/OIDC + PKCE (logowanie Google itp.):** przez Supabase Auth, flow PKCE (domyślny w `@supabase/ssr` `[NIEPEWNE: potwierdź w wersji z lockfile]`): `signInWithOAuth({ provider, options: { redirectTo } })` → trasa `/auth/callback` wymienia `code` na sesję (`exchangeCodeForSession`) po stronie serwera → cookie httpOnly. Nigdy implicit flow (token we fragmencie URL) w aplikacji SSR. Lista dozwolonych `redirectTo` w ustawieniach Auth bez wildcardów obejmujących cudze domeny (podglądy Vercel: wzorzec tylko dla własnego zespołu `[NIEPEWNE: składnia wildcard wg docs]`). Łączenie konta OIDC z istniejącym tylko po zweryfikowanym e-mailu. Client credentials (maszyna → maszyna bez użytkownika) tylko, gdy partner wymaga OAuth — wtedy jego IdP, nie nasz.
- **Usługa → usługa (edge fn ↔ edge fn, n8n → API, cron → API):** domyślnie wspólny sekret z menedżera sekretów (w n8n jako credential/zmienna, nie tekst w węźle) + allowlist operacji, które wolno wywołać; HMAC lub JWT od pierwszego wołającego spoza naszego zespołu. Edge fn działająca w imieniu użytkownika przekazuje dalej JWT użytkownika (RLS działa), nie `service_role`.

| Mechanizm usługa → usługa | Kiedy | Ryzyko / koszt |
|---|---|---|
| wspólny sekret (`Authorization: Bearer <sekret>`) | 1 wołający, 1 odbiorca, ten sam właściciel | wyciek = dostęp bez wygaśnięcia; porównanie `timingSafeEqual`; rotacja przez dwie ważne wartości naraz (`*_SECRET_CURRENT`, `*_SECRET_NEXT`) |
| HMAC treści + znacznik czasu (`X-Signature`, `X-Timestamp`, okno ~5 min) | wołający przez publiczny internet; ochrona przed replay i podmianą body | sekret nie leci w żądaniu; podpisuj surowe body |
| podpisany JWT (`exp` ~5 min, `iss`, `aud`, `scope`) | ≥2 wołających albo potrzebne zakresy i wygasanie | biblioteka JWT, zegary; klucz asymetryczny, gdy weryfikuje ktoś inny niż wystawca |
| `service_role` jako sekret | nigdy | omija RLS — wyciek z n8n = cała baza |

- **Unieważnianie tokenów:** access token Supabase to JWT ważny do `exp` (`jwt_expiry` w `supabase/config.toml` `[NIEPEWNE: wartość domyślna wg wersji]`); wylogowanie unieważnia refresh token, ale wydany access token działa do wygaśnięcia. Dlatego: krótki `exp` dla paneli z pieniędzmi (~5–15 min `[~]`), decyzje wrażliwe czytają stan z bazy (rola, `banned_until`, `revoked_at`), nie z claimów JWT; „wyloguj wszędzie" po zmianie hasła lub zwolnieniu (`signOut({ scope: 'global' })` `[NIEPEWNE: API w wersji klienta]`) + odebranie roli w bazie.
- **Klucze API partnerów:** prefiks + losowe ≥32 bajty (`mk_live_<8 znaków>_<sekret>`); w bazie TYLKO prefiks i `sha256` klucza, pokazany raz przy utworzeniu; kolumny `org_id`, `scopes text[]`, `expires_at`, `last_used_at`, `revoked_at`. Weryfikacja jednym zapytaniem (sprawdzone na PG 17): `update api_keys set last_used_at = now() where prefix = $1 and key_hash = encode(sha256(convert_to($2,'UTF8')),'hex') and revoked_at is null and (expires_at is null or expires_at > now()) returning org_id, scopes;` (0 wierszy = 401). Rotacja = nowy klucz + okres nakładania, potem `revoked_at`; rate limit per klucz (→ 03 › Rate limiting); audit log użycia (klucz, endpoint, kod, czas). Klucz w nagłówku, nigdy w query stringu (trafia do logów).
**Kiedy NIE:** jedno wewnętrzne wywołanie cron → funkcja w tym samym projekcie — sekret + allowlist; tabela kluczy dopiero przy pierwszym partnerze.

| Wariant | Koszt operacyjny | Finansowy | Poznawczy |
|---|---|---|---|
| OAuth/OIDC przez Supabase Auth (PKCE) | konfiguracja dostawcy, allowlist redirectów | w cenie planu | niski |
| wspólny sekret usługa → usługa | rotacja ręczna | zero | niski |
| HMAC / podpisany JWT | podpisywanie, zegar | zero | średni |
| klucze API partnerów (hash + scope + audit) | tabela, rotacja, audit | zero | średni |
| denylista tokenów / mTLS | stan sprawdzany per żądanie / PKI | niski–średni | wysoki — nie |

**Awarie i detekcja.**
- *implicit flow / token w URL* — `rg -n -i "flowType|implicit|#access_token|access_token=" src`
- *OAuth bez wymiany kodu na serwerze* — `rg -n "signInWithOAuth" src` vs `rg -n "exchangeCodeForSession" src` (pierwsze bez drugiego = finding)
- *redirecty z szerokim wildcardem* — `rg -n -A3 "additional_redirect_urls|site_url" supabase/config.toml`
- *`service_role` jako sekret między usługami* — `rg -n -i "SERVICE_ROLE" supabase/functions src | rg -i "fetch|invoke|authorization|headers"`
- *porównanie sekretu przez `===` (timing)* — `rg -n -i "(secret|token|signature|\bsig|api_?key)\w*\s*(===|!==|==)\s|(===|!==|==)\s*\S*(secret|token|signature|api_?key)" src supabase/functions` (obie strony porównania, np. `=== Deno.env.get('CRON_SECRET')`)
- *klucze/sekrety jawnie w kolumnach* — `select table_name, column_name from information_schema.columns where table_schema='public' and column_name ~* '(api_?key|secret|token)$' and column_name !~* '(hash|prefix)';` (sprawdzone na PG 17)
- *klucz w query stringu* — `rg -n -i "[?&](api_?key|token|key)=" src supabase/functions`
- *długo żyjący access token* — `rg -n "jwt_expiry" supabase/config.toml`

**Audyt „czy się trzymamy".**
1. Czy OAuth idzie PKCE z wymianą kodu na serwerze i allowlistą redirectów? → komendy 1–3.
2. Czy każde wywołanie usługa → usługa ma nazwany mechanizm (sekret/HMAC/JWT), a nie `service_role`? → komenda `SERVICE_ROLE` + odczyt.
3. Czy sekrety między usługami mają procedurę rotacji z dwiema ważnymi wartościami? → `rg -n -i "SECRET_NEXT|rotac|rotation" docs/RUNBOOK.md src supabase/functions`.
4. Czy zwolnienie/wyciek ma procedurę „wyloguj wszędzie + odbierz rolę w bazie"? → `rg -n -i "signOut|revoke|banned_until|wyloguj" docs/RUNBOOK.md src`.
5. Czy klucze partnerów są hashowane i mają scope, wygaśnięcie i audit? → zapytanie o kolumny + `rg -n -i "api_keys" supabase/migrations`.
6. Czy `jwt_expiry` pasuje do wrażliwości panelu? → ostatnia komenda.

**Nie potrzebujesz jeszcze** (wariant → sygnał powrotu):
- denylista `jti` → wymóg odcięcia dostępu w ~<1 min, którego krótki `exp` + odczyt uprawnień z bazy nie spełnia.
- mTLS → jak w karcie „Tożsamość i autoryzacja".
- własny serwer OAuth (bycie IdP dla partnerów) → ≥3 partnerów działających w imieniu NASZYCH użytkowników („zaloguj przez naszą aplikację").
- API gateway do kluczy → jak w 03 › Rate limiting.
- service discovery / auth przez mesh → ≥5 usług rozmawiających po sieci (→ 07 › Monolit modularny vs usługi).

---

### Obserwowalność i alerty

**Problem.** Bez monitoringu o awarii dowiaduje się pierwszy klient. Typowy stan do sprawdzenia w repo: tylko część projektów ma error tracking w `package.json` (`rg -n "sentry" package.json`), a runbooki bywają z placeholderem `[link do projektu]` zamiast skonfigurowanego monitoringu (`rg -n "\[link" docs/RUNBOOK.md`). Stan per repo: `prywatne notatki floty (poza eksportem)`. Sygnały w diffie: nowy `catch`, nowa ścieżka krytyczna, nowa funkcja, nowy alert w runbooku.

**Domyślnie u nas.** Sentry (front i serwer) dla każdego repo produkcyjnego; logi strukturalne (`level`, `msg`, `request_id`, `org_id`, id encji, powód); `request_id` generowany na wejściu i zwracany w błędzie; jeden kanał alertów (mail) z przetestowanym zdarzeniem i datą testu w runbooku; zewnętrzny monitor dostępności; metryki biznesowe jako zapytania + alert (zamówienia `pending` > 1 h, zadania `dead`, najstarsze zadanie w kolejce); `catch` loguje z kontekstem lub rzuca dalej; zero PII i tokenów w logach. Minimum SLO: każda ścieżka krytyczna ma SLI, cel i próg alertu (sekcja SLO „lite" niżej); sampling świadomy (sekcja „Sampling i koszt").
**Kiedy NIE:** prototypy bez użytkowników — wystarczą logi platformy.

| Wariant | Koszt operacyjny | Finansowy | Poznawczy |
|---|---|---|---|
| Sentry + logi platformy | konfiguracja i alerty | ~plan darmowy do małej skali `[NIEPEWNE: limity planu]` | niski |
| logi strukturalne + `request_id` | dyscyplina w kodzie | zero | niski |
| OpenTelemetry/Grafana | utrzymanie stosu | wysoki | wysoki — nie |

**SLO „lite" per ścieżka krytyczna.** SLO to liczba definiująca „nie działa", zanim zadzwoni klient. Dla każdej ścieżki krytycznej (lista z PRR / `CRITICAL-PATHS`) jedna linia w `docs/RUNBOOK.md` — przykłady `[~]`:

| Ścieżka | SLI (jak mierzysz) | Cel (30 dni) | Próg alertu |
|---|---|---|---|
| checkout / płatność | 5xx na trasach płatności + płatności `pending` > 15 min | ≥99,5 % | ≥3 błędy w 10 min albo 1 płatność zawieszona > 15 min |
| logowanie | nieudane logowania z powodu 5xx (nie złego hasła) | ≥99,5 % | ≥5 w 10 min |
| logowanie — atak (2026-10-10, security checklist P5) | nieudane logowania z powodu złego hasła + odmowy 401/403/429 per IP/konto (logi) | — (to nie SLO, to wykrycie) | skok ≥N w 5 min z jednego IP albo na jedno konto → mail do właściciela; N z `03 › Rate limiting i budżety kosztu` (login_failures) |
| czat AI | p95 czasu do pierwszego tokenu + odsetek błędów | p95 ≤5 s, błędy ≤2 % | p95 >10 s przez 15 min albo ≥10 błędów w 10 min |
| zapis zlecenia/formularza | 5xx na trasach zapisu | ≥99,5 % | ≥3 w 10 min |

Przy małym ruchu (setki żądań/dobę) próg liczbowy („≥N błędów w M min") zamiast procentu — procent z 20 żądań skacze i budzi bez powodu. Źródło SLI: Sentry (błędy, p95 transakcji) i zapytania SQL na metrykach biznesowych; alert w jednym kanale z przetestowanym zdarzeniem.

**Sampling i koszt.** Błędy: 100 %. Tracing wydajności: `tracesSampleRate` ~0,1–0,2 w produkcji `[~]` — 1.0 w produkcji szybko wyczerpuje limit planu. Session replay tylko przy błędzie (`replaysOnErrorSampleRate: 1.0`, `replaysSessionSampleRate: 0`) — odpowiada na „klient mówi, że nie działa" bez nagrywania wszystkich sesji; maskowanie tekstu i pól z PII włączone `[NIEPEWNE: domyślne ustawienia maskowania wg wersji SDK]`. Head sampling (decyzja na starcie żądania — to robi `tracesSampleRate`) jest tani, ale gubi rzadkie wolne żądania; tail sampling (decyzja po zakończeniu: zachowaj wolne i błędne) wymaga kolektora — nie teraz. Koszt rośnie z kardynalnością: wartości nieograniczone (`user_id`, URL z ID, e-mail) idą do kontekstu zdarzenia/logów, nie do tagów i etykiet metryk. Retencja: logi platformy i Sentry wg planu `[NIEPEWNE: limity planów]`; dłużej trzymamy tylko audit log w bazie.

**Awarie i detekcja.**
- *tracing 100 % w produkcji / replay wszystkich sesji* — `rg -n "tracesSampleRate|replaysSessionSampleRate|replaysOnErrorSampleRate|profilesSampleRate" src sentry.*.config.* instrumentation*.ts 2>/dev/null`
- *ścieżka krytyczna bez SLO i progu alertu* — `rg -n -i "SLO|SLI|próg alertu|alert threshold" docs/RUNBOOK.md`
- *tag o wysokiej kardynalności* — `rg -n "setTag\(['\"](user|userId|user_id|email|url)" src`
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
7. Czy każda ścieżka krytyczna ma SLI, cel i próg alertu w runbooku? → komenda SLO z awarii.
8. Czy sampling jest świadomy (błędy 100 %, tracing ułamek, replay przy błędzie) i bez tagów o wysokiej kardynalności? → komendy sampling i tag z awarii.

**Nie potrzebujesz jeszcze** (wariant → sygnał powrotu):
- Prometheus/Grafana/Loki → własny host z ≥3 usługami, dla których logi platformy i Sentry nie wystarczają.
- OpenTelemetry / tracing rozproszony → żądanie przechodzi przez ≥3 usługi/funkcje i debug „gdzie zginęło" trwa ~>godzinę; najpierw `request_id` w nagłówkach.
- Datadog/Honeycomb → budżet na obserwowalność i ≥1 osoba, która codziennie patrzy w dashboardy.
- SLO z wielookienkowym burn-rate → ruch ~>10 tys. żądań/dobę na ścieżce krytycznej; wcześniej progi liczbowe z sekcji SLO „lite" wyżej.
- metryki z wysoką kardynalnością (tag = `user_id`) → nigdy; użytkownik idzie do logów, nie do etykiet metryk.

---

### Analityka produktu i WWW

**Problem.** PRD-lite (`pg/design.md` A.4) każe nazwać metrykę sukcesu i event, ale bez narzędzia event nie powstaje i nikt nie wie, czy funkcja działa dla ludzi (lejek, retencja, odsłony). Odwrotny błąd: Google Analytics wrzucone „z rozpędu" = baner cookie i dane użytkowników u trzeciej strony bez decyzji. Sygnały w diffie: `gtag(`, `posthog`, `plausible`, `@vercel/analytics`, `track(`. (2026-10-10, luka z katalogu stacków)

**Domyślnie u nas.** Nic, dopóki PRD-lite nie nazwie metryki. Gdy nazwie: strona klienta → analityka WWW bez cookies (Plausible albo Vercel Analytics) — prostsze RODO; aplikacja z lejkiem/retencją → jedno narzędzie produktu (PostHog: analityka + nagrania sesji + feature flagi, hosting w EU) z eventem nazwanym w PRD. Dane osobowe do analityki tylko po wpisie procesora w `docs/PRIVACY.md` (rubryka security pkt 7).
**Kiedy NIE:** prototyp bez użytkowników; panel wewnętrzny dla 2-3 osób (zapytaj ich).

| Wariant | Koszt operacyjny | Finansowy | Poznawczy |
|---|---|---|---|
| brak + metryka z bazy (SQL na tabelach) | zero | zero | niski |
| Plausible / Vercel Analytics (WWW, bez cookies) | skrypt w layoucie | niski `[NIEPEWNE: cennik]` | niski |
| PostHog (produkt, EU) | eventy w kodzie, plan nazw eventów | darmowy próg `[NIEPEWNE: limity]` | średni |
| Google Analytics | baner zgody, RODO, transfer poza EU | zero w gotówce | średni (prawny) |

**Awarie i detekcja.**
- *metryka bez eventu* — PRD/ADR nazywa metrykę, a w kodzie brak: `rg -n "track\(|capture\(|posthog|plausible|gtag\(" src`
- *analityka bez zgody* — GA/piksele marketingowe bez banera: `rg -n "gtag\(|googletagmanager|fbq\(" src` + brak komponentu zgody
- *PII w eventach* — `rg -n "capture\(|track\(" src -A3 | rg -i "email|phone|kennitala|name"`

**Audyt „czy się trzymamy".**
1. Czy każda metryka z PRD-lite ma event albo zapytanie SQL? → pierwsza komenda.
2. Czy narzędzie z cookies ma zgodę, a procesor jest w `docs/PRIVACY.md`? → druga komenda + `rg -n -i "posthog|plausible|google" docs/PRIVACY.md`.
3. Czy eventy nie niosą danych osobowych? → trzecia komenda.

**Nie potrzebujesz jeszcze** (wariant → sygnał powrotu):
- Amplitude/Mixpanel → zespół analityków i ~>10 tys. aktywnych użytkowników miesięcznie.
- osobna platforma eksperymentów (Statsig) → ~>3 równoległe testy A/B naraz.
- hurtownia danych (BigQuery/ClickHouse) → zapytania analityczne zaczynają spowalniać produkcyjnego Postgresa.

---

### Kopie zapasowe i odtwarzanie

**Problem.** Kopia nieodtworzona próbnie nie jest kopią. Dotyczy bazy (Supabase/Postgres), plików (Storage) i własnych usług (menedżer sekretów, n8n). Sygnały w diffie: migracja destrukcyjna, zmiana planu/projektu Supabase, nowy magazyn, zmiana RUNBOOK, wyjście z platformy (zdarza się, że obiekty i polityki istnieją tylko w żywej bazie).

**Domyślnie u nas.** RPO i RTO zapisane w `docs/RUNBOOK.md` i uzgodnione z klientem; plan Supabase dobrany do wymaganego RPO (kopie dobowe od planu Pro; PITR to osobna opcja `[NIEPEWNE: sprawdź w panelu]`; plan Free nie ma PITR — `pg/prr.md` P16); `pg_dump` cron jako druga linia; próbny restore z datą w runbooku (`python3 ~/.claude/bin/backup-drill.py`). Replika to nie kopia — usunięcie replikuje się. Pliki: kopie bazy (dobowe i PITR) NIE obejmują obiektów Storage, tylko metadane w `storage.objects` — osobny eksport plików obowiązkowy, gdy pliki są danymi klienta (sekcja „Kopie plików Storage" niżej). Własne usługi (np. menedżer sekretów): szyfrowane kopie i skrypt testu odtwarzania (ścieżki i komendy: `prywatne notatki floty (poza eksportem)`); klucz szyfrujący przechowywany osobno od kopii.
**Kiedy NIE:** brak — ale „multi-region/hot standby" to osobna decyzja kosztowa, nie domyślna.

| Wariant | Koszt operacyjny | Finansowy | Poznawczy |
|---|---|---|---|
| dobowe kopie platformy | restore = ostatni snapshot (RPO do ~24 h) | w planie Pro `[NIEPEWNE]` | niski |
| PITR | restore do punktu w czasie | dodatek płatny `[NIEPEWNE]` | niski |
| `pg_dump` + storage na zewnątrz | cron, miejsce, szyfrowanie | niski | średni |
| replika/standby | failover do przećwiczenia | drugi serwer | wysoki — nie przy tej skali |

**RPO i RTO wprost.** **RPO** (Recovery Point Objective) = ile danych wolno stracić, mierzone czasem od ostatniej kopii (kopie dobowe → RPO do ~24 h; PITR → minuty). **RTO** (Recovery Time Objective) = jak długo wolno nie działać do przywrócenia usługi. Oba jako liczby w `docs/RUNBOOK.md`, osobno dla bazy, plików, sekretów i n8n; RTO potwierdzone czasem z drilla (`backup-drill.py`), nie zgadnięte. Typowy cel floty `[~]`: RPO ≤24 h (minuty dla płatności → PITR), RTO ≤4–8 h.

**Scenariusz „region dostawcy pada" (sekcja w RUNBOOK).** Projekt Supabase żyje w jednym regionie; funkcje Vercel w regionie z ustawień projektu `[NIEPEWNE: region funkcji wg ustawień]`, statyki na globalnym CDN. Awaria regionu Supabase = aplikacja nie działa, a kopie platformy mogą być w tym czasie niedostępne.
1. **Domyślnie: akceptujemy i komunikujemy** — link do strony statusu dostawcy w runbooku, gotowy komunikat do klienta, statyczna strona „przerwa techniczna"; RTO = czas dostawcy (godziny).
2. **Odtworzenie w innym regionie** — nowy projekt z `pg_dump` trzymanego POZA platformą (inne konto/dostawca) + eksport plików + migracje z repo + sekrety z menedżera; podmiana zmiennych w Vercel. RTO ~kilka godzin, RPO = wiek zewnętrznego dumpa. Warunek: dump i eksport plików poza Supabase istnieją i były odtworzone w drillu.
3. Replika w drugim regionie / active-passive — „Nie potrzebujesz jeszcze" z sygnałem.

**Kopie plików Storage.** Kopie bazy Supabase (dobowe i PITR) obejmują tylko metadane w `storage.objects`, nie same pliki (zweryfikowane w docs Supabase „Backups" 2026-10-06: „Database backups do not include objects you store via the Storage API"); odtworzenie bazy nie przywraca usuniętych plików. Dlatego eksport poza platformę zadaniem cyklicznym (np. `rclone sync` przez S3-kompatybilne API Storage `[NIEPEWNE: dostępność S3 API wg planu]` do bucketu u innego dostawcy z wersjonowaniem) + próbne odtworzenie kilku plików w drillu.

**Awarie i detekcja.**
- *RPO/RTO bez liczb* — `rg -i "RPO|RTO" docs/RUNBOOK.md | rg -v "[0-9]"` (linia bez liczby = deklaracja bez celu; bez `-n`, bo numer linii to cyfra i filtr niczego by nie pokazał)
- *brak scenariusza awarii regionu* — `rg -n -i "region|status\.supabase|vercel-status|awaria dostawcy" docs/RUNBOOK.md`
- *kopia tylko u tego samego dostawcy* — `rg -n -i "pg_dump|rclone|s3 sync|aws s3" scripts .github docs/RUNBOOK.md`
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
7. Czy RUNBOOK ma scenariusz „region dostawcy pada" z RTO i RPO dla wariantu odtworzenia? → komenda „region" z awarii.
8. Czy istnieje kopia bazy i plików POZA kontem dostawcy, odtworzona w drillu? → komenda „kopia" z awarii + data drilla.

**Nie potrzebujesz jeszcze** (wariant → sygnał powrotu):
- repliki międzyregionowe / active-passive → umowne RTO ~<4 h przy awarii całego regionu dostawcy `[~]`.
- hot standby → RTO ~<15 min przy awarii instancji i plan, który tego nie daje.
- własne archiwum WAL → RPO ~<doba bez PITR platformy (własny host).
- strona DR / drugi region aktywny → patrz replikacja niżej; przy tej skali nie.
- replikacja single-leader (lider + repliki) → już ją masz pośrednio (platforma); własna replika odczytu → 03 › Wąskie gardło.
- replikacja multi-leader → zapisy w ≥2 regionach z wymogiem niskiego opóźnienia zapisu lub tryb offline; koszt: rozwiązywanie konfliktów (LWW gubi dane, CRDT komplikuje model).
- replikacja bezliderowa (quorum, Dynamo/Cassandra) → ~>10 tys. zapisów/s z akceptowaną ostateczną spójnością (AP); poza zasięgiem floty.

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

**Nie potrzebujesz jeszcze** (wariant → sygnał powrotu):
- narzędzia DPO / katalog danych → ≥10 tabel z PII w ≥3 systemach albo żądania RODO ~>kilka na miesiąc.
- tokenizacja (PII zastąpione tokenem z sejfu) → dane kart płatniczych lub wymóg audytu; karty płatnicze i tak tylko u dostawcy płatności.
- pseudonimizacja kluczem w HSM → wymóg regulatora/umowy; wcześniej szyfrowanie kolumny z kluczem poza bazą.

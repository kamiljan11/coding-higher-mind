# 02 · Dane — magazyn, model, pieniądze i czas, tenanci, spójność, cache, pliki, ID

Konwencje (`~`, `[NIEPEWNE]`, zmienne ścieżek, odsyłacze `NN › Karta`) — w `README.md`.
Zapytania SQL poniżej działają na katalogach Postgresa (sprawdzone na PG 17); uruchamiaj je na bazie PRODUKCYJNEJ (ACL-e i polityki różnią się od lokalnych — `pg/cases.md` ACL-NULL-TOO-NARROW) wyłącznie w sesji read-only: `PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=15s' psql "$DB_URL" -c "<zapytanie>"` (szczegóły i zakaz wklejania URL-a z hasłem: `README.md`, tryb audytu). Recenzenci w CI nie mają dostępu do bazy; SQL uruchamia człowiek albo sesja główna w trybie audytu.

---

### Wybór magazynu danych

**Problem.** Czy dodać cokolwiek poza Postgresem (Redis, Pinecone, Elasticsearch, Mongo, kolejka, SQLite). Każdy dodatkowy magazyn to osobny backup, tryb awarii i granica spójności. Sygnały w diffie: nowa zależność w `package.json` (`redis`, `ioredis`, `@upstash/*`, `@pinecone-database/*`, `mongodb`, `@elastic/*`, `algoliasearch`), nowy kontener w Compose, nowa „tabela" poza bazą.

**Domyślnie u nas.** Postgres do wszystkiego. W repo Supabase: Supabase Postgres (Auth, Storage, RLS, pgvector, pg_cron). W repo Payload (shop-app): `@payloadcms/db-postgres` na Postgresie z migracjami Payloada. Rozszerzenia załatwiają typowe potrzeby: `pg_trgm` + `unaccent` (wyszukiwanie), `pgvector` (embeddingi), `PostGIS` (geo), `btree_gist` (EXCLUDE) — dostępność zależy od projektu i planu: `select name from pg_available_extensions where name in ('vector','postgis','pg_cron','pg_trgm','unaccent','btree_gist');` [NIEPEWNE: lista wg planu]. Drugi magazyn dopiero z: mierzalnym powodem, ADR, planem backupu i możliwością odbudowy ze źródła w Postgresie.
**Kiedy NIE zostawać przy samym Postgresie (progi ~, do zmierzenia):** wyszukiwanie z literówkami i facetami na ~>1 mln dokumentów, wektory ~>1–5 mln rekordów przy wymaganym niskim p95, strumień zapisów szeregów czasowych rzędu tysięcy/s.

| Wariant | Koszt operacyjny | Finansowy | Poznawczy |
|---|---|---|---|
| Postgres + rozszerzenia | jeden backup, jeden restore | w cenie planu | niski |
| JSONB jako elastyczny schemat | integralność ucieka do kodu | zero | rośnie z dryfem kształtu |
| Drugi magazyn (Redis/Pinecone/…) | własny backup, monitoring, sekrety | ~miesięczna opłata + egress | wysoki: dwie prawdy |
| SQLite/plik | brak współbieżności i backupu na platformie | zero | niski i kruchy |

**Awarie i detekcja.**
- *JSONB jako „worek na wszystko" — brak constraintów, dryf kształtu* — `select table_name, column_name from information_schema.columns where table_schema='public' and data_type='jsonb';` potem sprawdź walidację: `rg -n "safeParse|z\.object" src | rg -i <nazwa_kolumny>`
- *drugi magazyn bez właściciela i backupu* — `rg -n -i "redis|upstash|pinecone|mongodb|elasticsearch|algolia|typesense" package.json supabase/functions src`
- *indeks wektorowy/wyszukiwania jedynym źródłem prawdy* — brak tabeli źródłowej: `rg -n -i "upsert|namespace" src supabase/functions | rg -i "pinecone|vector"`
- *rozszerzenie włączone, ale nieużywane (powierzchnia ataku)* — `select extname from pg_extension;`

**Audyt „czy się trzymamy".**
1. Czy każdy magazyn poza Postgresem ma ADR z mierzalnym powodem? → `rg -n -i "redis|pinecone|elastic|mongo" docs/adr`.
2. Czy dane transakcyjne (zamówienia, płatności, stany) leżą w tabelach z constraintami? → `select conrelid::regclass as tabela, count(*) from pg_constraint where connamespace='public'::regnamespace and contype in ('u','c','f') group by conrelid::regclass order by 1;` (tabela krytyczna bez wiersza w wyniku = brak constraintów).
3. Czy każdy magazyn ma przećwiczony restore? → `rg -n "Ostatni test restore: [0-9]{4}" docs/RUNBOOK.md`.
4. Czy kolumny JSONB mają walidację na granicy (zod/CHECK)? → komenda z awarii.
5. Czy indeks pochodny da się odbudować jednym poleceniem ze źródła w Postgresie? → szukaj skryptu `reindex|rebuild|backfill` w `scripts/`.

**Nie potrzebujesz jeszcze.** Redisa, Mongo, Elasticsearcha, bazy grafowej, bazy szeregów czasowych, hurtowni danych (raporty = widoki/materialized view, `COPY` do CSV).

---

### Model danych, constrainty i migracje

**Problem.** Model danych to drzwi jednokierunkowe; niezmienniki mają żyć w bazie, nie w kodzie, a migracje zmieniają działające dane przy działającym kodzie. Sygnały w diffie: nowa tabela, zmiana typu/nazwy kolumny, `DROP`, `NOT NULL`, nowe FK, nowy status, nowy plik w `supabase/migrations/` lub `src/migrations/`.

**Domyślnie u nas.** Każda tabela ma PK; FK z jawnym `ON DELETE`; statusy jako enum/`CHECK` plus jawna maszyna stanów w kodzie (wzór: `src/lib/orders/statusTransitions.ts` w shop-app — niedozwolone przejścia rzucają błąd); `created_at`/`updated_at` jako `timestamptz`; audit log (kto/co/kiedy/przed→po) dla pieniędzy, uprawnień i stanów, niemodyfikowalny; soft delete tylko, gdy jest wymóg odtwarzania/audytu (wtedy filtr w polityce lub widoku, nie w każdym zapytaniu). Dokument wystawiony (faktura) jest niezmienny także dla INSERT pozycji (`pg/cases.md` IMMUTABLE-SKIPS-INSERT). Migracja dwuetapowa expand → deploy → contract: dodaj nullable → backfill partiami → `ADD CONSTRAINT … NOT VALID` → `VALIDATE CONSTRAINT` → `SET NOT NULL`; rename/drop nigdy w tym samym deployu, który zmienia kod z niego korzystający; duże indeksy `CREATE INDEX CONCURRENTLY` (poza transakcją migracji). Uwaga na kolejność: w shop-app `build` uruchamia `scripts/migracje-przed-buildem.mjs` przed `next build`, więc migracja leci PRZED nowym kodem — stary kod musi działać na nowym schemacie.
**Kiedy NIE:** soft delete „na wszelki wypadek", audit log dla tabel słownikowych, osobny model odczytu.

| Wariant | Koszt operacyjny | Finansowy | Poznawczy |
|---|---|---|---|
| Constrainty w bazie | migracje przy zmianie reguł | zero | niski; błąd wychodzi od razu |
| Walidacja tylko w kodzie | zero migracji, dryf danych | zero | niski dziś, wysoki przy sprzątaniu |
| Soft delete | filtr wszędzie, rosnące tabele | storage | średni |
| Event sourcing | replay, wersje zdarzeń | storage | bardzo wysoki — nie |

**Awarie i detekcja.**
- *tabele bez PK/UNIQUE → duplikaty* — `select c.relname from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='r' and not exists (select 1 from pg_constraint k where k.conrelid=c.oid and k.contype in ('p','u'));`
- *FK bez indeksu (wolne joiny i kasowanie; heurystyka dla pierwszej kolumny)* — `select c.conrelid::regclass as tbl, c.conname from pg_constraint c where c.contype='f' and c.connamespace='public'::regnamespace and not exists (select 1 from pg_index i where i.indrelid=c.conrelid and i.indkey[0]=c.conkey[1]);`
- *migracja niekompatybilna wstecznie (DROP/RENAME/NOT NULL bez DEFAULT)* — `rg -n -i "drop (table|column)|rename (to|column)|set not null|add column .* not null" supabase/migrations src/migrations -g '*.sql'` oraz `node ~/.claude/bin/sql-migration-lint.js --repo . --strict`
- *dziura w kolejności/rozjazd schematu repo vs baza* — `select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE';` (bez widoków) vs `rg -c -i "create table" supabase/migrations | awk -F: '{s+=$2} END {print s}'` (zdarza się, że bucket-y i polityki istnieją tylko w żywej bazie)
- *status zmieniany z pominięciem maszyny stanów* — `rg -n "status\s*[:=]" src | rg -v "statusTransitions|test"`

**Audyt „czy się trzymamy".**
1. Czy niezmienniki są constraintami? → `select conrelid::regclass, conname, contype from pg_constraint where connamespace='public'::regnamespace and contype in ('u','c','x');` dla tabeli z diffu.
2. Czy migracja jest dwuetapowa i kompatybilna z poprzednim kodem na czas jednego deployu? → komenda `rg` wyżej + opis w PR.
3. Czy migracja jest idempotentna (`IF [NOT] EXISTS`) i przechodzi `sql-migration-lint`? → `node ~/.claude/bin/sql-migration-lint.js --repo . --strict --json`.
4. Czy FK mają indeksy? → zapytanie FK bez indeksu.
5. Czy zmiana statusu idzie jedną ścieżką (maszyna stanów)? → `rg` z awarii.
6. Czy migracja T3 miała świeżą kopię i plan rollbacku? → `rg -n "Ostatni test restore" docs/RUNBOOK.md` + sekcja rollback w PR.

**Nie potrzebujesz jeszcze.** Event sourcingu, CQRS, tabel temporalnych, partycjonowania (~<10–50 mln wierszy na tabelę zwykle bez potrzeby), własnego DSL schematu, wersjonowania każdej encji.

---

### Pieniądze, czas i jednostki

**Problem.** Błędy tu kończą się reklamacją albo problemem prawnym i zwykle wychodzą dopiero u klienta. Sygnały w diffie: `float`/`Number` na kwotach, `toFixed`, `new Date()` z lokalną strefą, stała stawka VAT w kodzie, nowa waluta, wiele miejsc liczących sumę.

**Domyślnie u nas.** Kwoty jako liczby całkowite w najmniejszej jednostce razem z kolumną `currency` (ISK ma 0 miejsc po przecinku — 1 = 1 korona; PLN i EUR ×100); `numeric(p,s)` tylko gdy ułamki są konieczne; nigdy `float`/`real`. Jedna funkcja liczy cenę i jedna zaokrągla — czysta, z testami (wzór: `src/lib/pricing/calculatePrice.ts` w shop-app zwraca `ok` albo `unavailable` z powodem, nigdy cenę domyślną). Stawki VAT, przelicznik FX, narzuty jako DANE (ustawienia/tabela), nie stałe w kodzie. Kwoty zawsze liczone po stronie serwera z bazy, nie z żądania. Czas: `timestamptz` (UTC) w bazie; strefa wyświetlania z danych organizacji; zdarzenia „ścienne" (wizyta o 9:00 w warsztacie) zapisuj jako lokalną datę+godzinę + strefę (ADR-0004 w workshop-app dokładnie o tym). Islandia nie przechodzi na czas letni, Polska tak — para PL/IS jest gotowym testem błędów stref. Jednostki w nazwach: `amountIsk`, `timeoutMs`.
**Kiedy NIE:** system wielowalutowy z historycznymi przelicznikami i księgowaniem różnic walutowych to osobny projekt (decyzja przed budową, nie dodatek).

| Wariant | Koszt operacyjny | Finansowy | Poznawczy |
|---|---|---|---|
| integer w najmniejszej jednostce | konwersja przy wyświetlaniu | zero | niski |
| `numeric(p,s)` | wolniejsze niż integer, ale poprawne | zero | niski |
| `float` | cichy dryf, trudne do wykrycia | koszt reklamacji | niski i zdradliwy |
| biblioteka Money | zależność, własny typ | zero | średni; sens przy wielu walutach |

**Awarie i detekcja.**
- *kwota jako float* — `select table_name, column_name, data_type from information_schema.columns where table_schema='public' and data_type in ('real','double precision') and column_name ~* '(price|amount|total|cena|kwota|saldo|balance)';`
- *numeric bez skali* — `select table_name, column_name from information_schema.columns where table_schema='public' and data_type='numeric' and numeric_scale is null;`
- *czas bez strefy* — `select table_name, column_name from information_schema.columns where table_schema='public' and data_type='timestamp without time zone';`
- *arytmetyka na kwotach w JS* — `rg -n "toFixed\(|parseFloat\(|Math\.round\(.*(price|amount|cena|total)" src`
- *zależność od lokalnej strefy serwera/przeglądarki* — `rg -n "new Date\(\)\.(getHours|getDate|getDay)|toLocaleDateString\(\)|toLocaleTimeString\(\)" src`
- *VAT/stawka zaszyta w kodzie* — `rg -n "\* ?1\.2[0-9]|\* ?0\.2[0-9]|vat *= *[0-9]" src | rg -v test`

**Audyt „czy się trzymamy".**
1. Czy żadna kolumna kwoty nie jest float? → pierwsze zapytanie.
2. Czy suma/zaokrąglenie liczy się w jednym miejscu z testem na przypadkach brzegowych (grosze, rabat, VAT)? → `rg -ln "round|rozbijBrutto|calculatePrice" src/lib` + `rg -n "describe|it\(" <ten plik testowy>`.
3. Czy `timestamptz` jest wszędzie, a strefa pochodzi z danych? → drugie i trzecie zapytanie.
4. Czy stawki i przeliczniki są danymi? → ostatnia komenda; trafienia = stałe do wyniesienia.
5. Czy kwota z żądania nigdy nie jest używana do obciążenia? → `rg -n "amount" src/app/api supabase/functions | rg -i "body|req\.|request\."` — porównaj z kwotą wyliczoną z bazy.
6. Czy format kwot i dat jest jednym helperem per język (IS/PL/EN)? → `rg -n "Intl\.NumberFormat|toLocaleString" src | wc -l` (wiele miejsc = rozbieżność).

**Nie potrzebujesz jeszcze.** Silnika wielowalutowego, biblioteki Money (przy jednej walucie i jednej funkcji liczącej), tabel temporalnych, osobnej usługi cenowej.

---

### Multi-tenancy w danych

**Problem.** Kto widzi czyje wiersze. Spotykane modele: współdzielony schemat z `org_id` + RLS + trigger, pojedynczy operator z `service_role` zamkniętym za sesją aplikacji, sklep z panelem Payload bez tenantów (które repo ma który model: `prywatne notatki floty (poza eksportem)`). Sygnały w diffie: nowa tabela z FK do encji tenantowej, nowy widok, nowa funkcja RPC, nowa polityka, nowy bucket, zapytanie po samym `id`.

**Domyślnie u nas.** Model wybierany per produkt i zapisany w ADR. Współdzielony schemat: `org_id NOT NULL` + indeks + FK na każdej tabeli tenantowej; RLS z `USING` i `WITH CHECK` (bez jawnego `WITH CHECK` Postgres użyje `USING` dla UPDATE/ALL — jawny zapis i tak jest wymagany dla czytelności i dla przypadków, gdy zapis ma być węższy niż odczyt); tabela z FK do innej encji tenantowej dostaje trigger „same org" (RLS sprawdza własny `org_id`, nie `org_id` rekordu po drugiej stronie FK — to klasa błędu znajdowana powtarzalnie w audytach RLS); `org_id` pochodzi z członkostwa użytkownika, nigdy z ciała żądania; klucze unikalne razem z `org_id` (`UNIQUE (org_id, numer)`); widoki z `security_invoker = true`; test negatywny cross-tenant w tej samej zmianie. Single-tenant z `service_role`: dopuszczalny TYLKO przy jednym zaufanym operatorze, klient `server-only`, każda funkcja za bramką sesji, `anon` odebrany tabela po tabeli.
**Kiedy NIE multi-tenant:** jeden klient, jeden operator — `org_id` to koszt bez zysku.

| Wariant | Koszt operacyjny | Finansowy | Poznawczy |
|---|---|---|---|
| współdzielony schemat + RLS + trigger | polityki i testy na każdą tabelę | zero | średni, ale mechaniczny |
| `service_role` za sesją aplikacji | jedna warstwa autoryzacji w kodzie | zero | niski; błąd = pełny dostęp |
| schemat/baza per tenant | migracje ×N, backupy ×N | rośnie liniowo | wysoki — nie |

**Awarie i detekcja.**
- *tabela publiczna bez RLS* — `select tablename from pg_tables where schemaname='public' and not rowsecurity;` (w repo Payload bez PostgREST to norma, o ile `anon`/`authenticated` nie mają grantów: `select table_name, grantee from information_schema.role_table_grants where table_schema='public' and grantee in ('anon','authenticated');`)
- *polityka zapisu bez jawnego WITH CHECK* — `select tablename, policyname, cmd from pg_policies where schemaname='public' and cmd in ('UPDATE','ALL') and with_check is null;`
- *`USING (true)` na tabeli nie-publicznej* — `select tablename, policyname from pg_policies where schemaname='public' and (qual='true' or with_check='true');`
- *funkcja SECURITY DEFINER wykonywalna dla anon/PUBLIC* — `select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute');` (lokalnie bez roli `anon` użyj `'public'`)
- *widok omijający RLS* — `select c.relname, c.relkind from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('v','m') and not exists (select 1 from unnest(coalesce(c.reloptions,'{}')) o where o ~* '^security_invoker=(true|on|1|yes)$');` (opcja bywa zapisana jako `on`/`true`/`1`/`yes`; wiersz `relkind='m'` to widok zmaterializowany: nie ma RLS ani `security_invoker`, a PostgREST może go wystawiać — ogranicz dostęp przez `revoke` albo schowaj go w schemacie spoza API)
- *tabela z `org_id` bez indeksu na `org_id`* — `select c.table_name from information_schema.columns c where c.table_schema='public' and c.column_name='org_id' and not exists (select 1 from pg_index i join pg_class t on t.oid=i.indrelid join pg_attribute a on a.attrelid=t.oid and a.attnum=i.indkey[0] where t.relname=c.table_name and t.relnamespace='public'::regnamespace and a.attname='org_id');`
- *`service_role` w kodzie klienta* — `rg -n "service_role|SERVICE_ROLE" src | rg -v "server|functions"` oraz `rg -n "VITE_.*SERVICE|NEXT_PUBLIC_.*SERVICE" .env* src`
- *lint migracji* — `node ~/.claude/bin/sql-migration-lint.js --repo . --strict --json`

**Audyt „czy się trzymamy".**
1. Czy każda tabela tenantowa ma RLS z `USING` i `WITH CHECK`? → zapytania o RLS i polityki.
2. Czy FK między tabelami tenantowymi ma trigger same-org? → `select tgname, tgrelid::regclass from pg_trigger where not tgisinternal and tgname ilike '%same_org%';`
3. Czy jest test negatywny cross-tenant? → `rg -ln -i "cross.?tenant|other.?org|inna.?org" tests e2e supabase`.
4. Czy widoki mają `security_invoker`? → zapytanie o widoki.
5. Czy `org_id` nie przychodzi z body żądania? → `rg -n "org_id|orgId" src/app/api supabase/functions | rg -i "body|req\.json|request\.json"`.
6. Czy w modelu `service_role` każda funkcja dostępowa wywołuje bramkę sesji? → porównaj liczbę wywołań bramki sesji z liczbą eksportowanych funkcji dostępu do danych (`rg -c "<bramka>" <plik>` vs `rg -c "^export (async )?function" <plik>`; konkretny plik i bramka: `prywatne notatki floty (poza eksportem)`).

**Nie potrzebujesz jeszcze.** Bazy per tenant, shardingu per tenant, własnego silnika polityk (OPA/Cedar), ReBAC, delegowanych uprawnień na poziomie wiersza ponad rolami.

---

### Spójność per przepływ (C vs A)

**Problem.** Między zapisem a odczytem pojawia się coś asynchronicznego: cache, ISR, replika, indeks wyszukiwania, Realtime, kolejka, optimistic UI, workflow n8n. Wtedy „silna spójność za darmo" z jednego lidera Postgresa przestaje obowiązywać dla tego przepływu. Sygnały w diffie: `revalidate*`, `staleTime`, `refetchInterval`, `unstable_cache`, nowa replika/indeks, `optimistic`, nowy Realtime.

**Domyślnie u nas.** Decyzja per przepływ, zapisana w mini-designie jako tabela. C (czytaj z lidera, odmawiaj przy wątpliwości): płatności, saldo/limit, stan magazynu przy kasie, rezerwacja terminu, uprawnienia, reset hasła. A (stary odczyt dopuszczalny): katalog, listy, statystyki, dashboard, feed. Zasada: decyzja o stanie czyta z bazy, nigdy z cache/ISR; po mutacji UI odświeża własny zapis (invalidate/refetch); optimistic UI tylko z rollbackiem (wzór: `DataProvider` w rental-app — zmiana optymistyczna → wywołanie serwera → rollback + toast).

| Przepływ (przykład floty) | Klasa | Konsekwencja dla projektu |
|---|---|---|
| koszyk → checkout → kwota | C | kwota liczona na serwerze z bazy w chwili płatności |
| stan magazynu przy dodaniu do koszyka | C | walidacja z bazy (`validateCart`), nie z listy produktów |
| lista produktów/strona publiczna | A | ISR + `revalidate*` po zmianie w panelu |
| dashboard zleceń warsztatu | A | refetch co kilkadziesiąt sekund; własny zapis od razu |
| rola/uprawnienia użytkownika | C | wrażliwe decyzje czytają rolę z bazy, nie z JWT |

| Wariant | Koszt operacyjny | Finansowy | Poznawczy |
|---|---|---|---|
| wszystko z lidera | większe obciążenie bazy | zero | najniższy |
| A tam, gdzie wolno | strategia unieważniania | oszczędza zapytania | średni: trzeba opisać „co widzi użytkownik" |

**Awarie i detekcja.**
- *„zapisałem, nie widzę"* — brak invalidate po mutacji: `rg -n "invalidateQueries|router\.refresh|revalidatePath|revalidateTag" src` zestawione z plikami zawierającymi `insert|update|delete`
- *decyzja o stanie z cache* — `rg -n -i "cache|revalidate|staleTime|unstable_cache" src/lib/inventory src/lib/orders src/app/api src/features/billing 2>/dev/null`
- *nadsprzedaż z odczytu przed zapisem* — wzorzec select→if→update: `rg -n -U "\.select\([\s\S]{0,300}if \([\s\S]{0,200}\.update\(" src supabase/functions`
- *domyślny `staleTime` 0 vs długi staleTime tam, gdzie krytyczne* — `rg -n "staleTime|gcTime" src`

**Audyt „czy się trzymamy".**
1. Czy każdy nowy cache/replika/indeks ma opis „co widzi użytkownik przy nieświeżych danych"? → szukaj w PR/ADR.
2. Czy decyzje o saldzie/stanie/limicie czytają z bazy? → druga komenda.
3. Czy po mutacji jest invalidate/refetch? → pierwsza komenda.
4. Czy zmiana roli działa w akceptowalnym czasie (ile żyje token)? → `rg -n "jwt_expiry|expiresIn|maxAge" supabase/config.toml src`.
5. Czy optimistic UI ma rollback? → `rg -n "onError|rollback" <plik z optimistic>`.

**Nie potrzebujesz jeszcze.** Sag i 2PC (są dla wielu usług), CRDT, quorum, replik odczytu tylko po to, by „mieć HA".

---

### Cache i inwalidacja

**Problem.** Cache przyspiesza odczyty kosztem świeżości i nowej klasy błędów (stare dane, wyciek między użytkownikami). Sygnały w diffie: `Cache-Control`, `revalidate`, `unstable_cache`/`use cache`, TanStack Query `staleTime`, widoki materializowane, `Map` jako cache, nowa zależność z Redisem.

**Domyślnie u nas.** Najpierw zmierz (`EXPLAIN`) i dodaj indeks (→ 03 › Zapytania i indeksy); potem warstwy od najtańszej: CDN/nagłówki dla statyków i stron publicznych (→ 03 › CDN, nagłówki i brzeg); cache frameworka (ISR, `revalidatePath/Tag`; po stronie klienta TanStack Query z `staleTime` + `invalidateQueries`); widok zmaterializowany dla ciężkich raportów (`REFRESH MATERIALIZED VIEW CONCURRENTLY` wymaga unikalnego indeksu). Każdy cache ma: TTL, nazwanego „kto go unieważnia", opis tego, co widzi użytkownik przy starych danych, oraz scope uwierzytelnienia w kluczu. Model cache w Next zmieniał się między wersjami 14→15→16 — czytaj dokumentację wersji z lockfile, nie z pamięci (`pg/cases.md` VERSION-CONFUSION).
**Kiedy NIE:** dane per użytkownik, pieniądze, stany, małe tabele i szybkie zapytania.

| Wariant | Koszt operacyjny | Finansowy | Poznawczy |
|---|---|---|---|
| HTTP/CDN + ISR | purge/revalidate po zmianie | najtańszy | niski–średni |
| TanStack Query (klient) | pilnować kluczy zapytań | zero | niski |
| Materialized view | harmonogram odświeżania | zero | średni |
| Redis/Memcached | kolejny serwis, kolejny SPOF | miesięczny abonament | wysoki: dwa źródła prawdy |

**Awarie i detekcja.**
- *mutacja bez inwalidacji* — `rg -n -l "insert\(|update\(|delete\(|\.rpc\(" src | xargs rg --files-without-match "invalidateQueries|revalidate|router\.refresh"` (pliki z mutacją bez inwalidacji)
- *dane użytkownika w cache współdzielonym* — `rg -n "Cache-Control|unstable_cache|use cache|s-maxage|force-static" src/app`
- *thundering herd po wygaśnięciu/awarii* — brak coalescingu: `rg -n -i "stale-while-revalidate|coalesc|singleflight" src`
- *stale po publikacji* — `curl -sI <url> | rg -i "age|x-vercel-cache|cache-control"` po zmianie treści
- *widok zmaterializowany bez odświeżania* — `select matviewname from pg_matviews;` i `rg -n -i "refresh materialized" supabase/migrations`

**Audyt „czy się trzymamy".**
1. Czy każda mutacja ma inwalidację odpowiedniego cache? → pierwsza komenda.
2. Czy każdy cache ma TTL i właściciela inwalidacji? → opis w kodzie/ADR.
3. Czy dane zalogowanego mają scope w kluczu albo `private/no-store`? → druga komenda.
4. Czy zachowanie przy pustym cache (miss, zimny start) jest przetestowane? → `rg -n -i "cold|miss|empty cache" tests`.
5. Czy przed dodaniem cache zmierzono zapytanie? → `EXPLAIN` w PR.

**Nie potrzebujesz jeszcze.** Redisa, Memcached, własnej warstwy cache w aplikacji, automatyzacji purge, write-behind.

---

### Pliki i object storage

**Problem.** Pliki użytkowników (zdjęcia zleceń, załączniki, PDF, importy) nie należą do wierszy bazy ani do dysku funkcji. Flota: workshop-app — bucket zdjęć zleceń w Supabase Storage; shop-app — własny adapter Payload na Supabase Storage (ADR-0005, zamiast Vercel Blob). Sygnały w diffie: `createBucket`, `upload(`, `public: true`, `getPublicUrl`, `createSignedUrl`, nowy typ pliku, `multipart`.

**Domyślnie u nas.** Bucket prywatny; dostęp przez krótkoterminowe podpisane URL-e; upload bezpośrednio z klienta (podpisany URL lub polityka na `storage.objects`) zamiast przez funkcję; wiersz metadanych (`org_id`, właściciel, ścieżka, rozmiar, MIME); ścieżka z prefiksem `org_id/`; limit rozmiaru i dozwolone typy po stronie bucketu/polityki; sprzątanie osieroconych obiektów (job). Bucket publiczny tylko na rzeczywiście publiczne zasoby. Kompresja obrazów po stronie klienta przed uploadem — rozmiar zdjęć, nie QPS, jest zwykle największą pozycją kosztów (→ `capacity.md`).
**Kiedy NIE:** wideo/duże pliki z dużym ruchem (egress) — osobna decyzja o CDN i koszcie.

| Wariant | Koszt operacyjny | Finansowy | Poznawczy |
|---|---|---|---|
| Supabase Storage + signed URL | polityki per bucket | storage + egress wg planu | niski |
| Upload przez funkcję | timeouty, limity body | funkcje + transfer | średni |
| Bucket publiczny | zero | egress bez kontroli | niski; ryzyko wycieku |
| Zewnętrzny CDN/obrazy | integracja, purge | płatne | średni |

**Awarie i detekcja.**
- *bucket publiczny z danymi klientów* — `select id, public, file_size_limit, allowed_mime_types from storage.buckets;` [NIEPEWNE: kolumny wg wersji Storage]
- *brak polityk na obiektach* — `select policyname, cmd, qual from pg_policies where schemaname='storage' and tablename='objects';`
- *obiekty osierocone po usunięciu rekordu* — `select count(*) from storage.objects o where bucket_id='<bucket>' and not exists (select 1 from <tabela_metadanych> m where m.path = o.name);`
- *stały publiczny URL do prywatnych danych* — `rg -n "getPublicUrl|/object/public/" src supabase/functions`
- *upload bez limitu* — `rg -n "upload\(" src | rg -v "maxSize|size|limit"`

**Audyt „czy się trzymamy".**
1. Czy buckety z danymi użytkowników są prywatne? → pierwsze zapytanie.
2. Czy pliki idą przez podpisane URL-e z krótkim TTL? → `rg -n "createSignedUrl|expiresIn" src supabase/functions`.
3. Czy upload ma limit rozmiaru i listę MIME? → zapytanie o bucket + `rg -n "mimetype|allowedMime" src`.
4. Czy każdy plik ma wiersz metadanych z `org_id` i RLS? → `rg -n "org_id" <migracja tabeli metadanych>`.
5. Czy usunięcie rekordu usuwa obiekt? → zapytanie o osierocone.
6. Czy kopia obejmuje same pliki, nie tylko metadane? → [NIEPEWNE: według dokumentacji Supabase kopie bazy mogą nie zawierać obiektów Storage — sprawdź w docs „Backups"; runbook może zakładać, że są objęte] → patrz 05 › Kopie zapasowe i odtwarzanie.

**Nie potrzebujesz jeszcze.** Uploadu wznawialnego (przy plikach ~>6 MB `[NIEPEWNE: próg wg docs]`), przetwarzania obrazów po stronie serwera, klas przechowywania/lifecycle, transkodowania wideo.

---

### Identyfikatory

**Problem.** Typ ID to model danych: zmiana po starcie to dodatkowa kolumna, backfill i przepisanie referencji. Sygnały w diffie: `bigserial`/`serial`/`generated … as identity`, nowa tabela publiczna, trasa `[id]`, numeracja dokumentów, `idType` w konfiguracji Payload.

**Domyślnie u nas.** `uuid` jako PK (w Supabase `gen_random_uuid()` = v4; natywne `uuidv7()` od Postgresa 18 `[NIEPEWNE: sprawdź wersję projektu: select version();]`); w URL-ach i API ID nieprzezroczyste; dostęp do zasobu chroniony autoryzacją, nie niewiedzą o ID. Uwaga na Payload: adapter Postgres domyślnie używa liczb całkowitych (kolumny `id` typu `integer`) — enumeracja jest możliwa, więc każda kolekcja musi mieć poprawne `access` (→ 05 › Tożsamość i autoryzacja). Numery dokumentów wymagane prawem (faktury, zlecenia) = osobny licznik per organizacja w tej samej transakcji co dokument: `update counters set n = n + 1 where org_id = $1 returning n` — serializuje się na wierszu i daje ciągłość; sekwencje Postgresa mają luki po rollbacku `[NIEPEWNE: wymóg ciągłości numeracji zależy od kraju — sprawdź]`.
**Kiedy NIE v4:** duża tabela insert-heavy (~>miliony wierszy/rok) → sortowalny UUIDv7/ULID; wcześniej różnicy w praktyce nie zobaczysz.

| Wariant | Koszt operacyjny | Finansowy | Poznawczy |
|---|---|---|---|
| UUIDv4 | losowe wstawianie w indeksie przy dużej skali | zero | niski |
| UUIDv7 / ULID | wymaga wersji/biblioteki | zero | niski |
| serial/identity | enumerowalne, ujawnia tempo biznesu | zero | najniższy |
| licznik per org (dokumenty) | blokada wiersza przy równoległym wystawianiu | zero | średni |

**Awarie i detekcja.**
- *sekwencyjne ID w URL → enumeracja cudzych rekordów* — `select table_name, column_name from information_schema.columns where table_schema='public' and (column_default like 'nextval%' or is_identity='YES');` zestaw z trasami `rg -n "\[id\]|params\.id" src/app`; test ręczny: `curl -s -o /dev/null -w "%{http_code}\n" <url>/<id+1>` na koncie bez uprawnień
- *PK integer w tabelach eksponowanych publicznie* — `select table_name from information_schema.columns where table_schema='public' and column_name='id' and data_type in ('integer','bigint');`
- *luki/duplikaty numeracji dokumentów* — `rg -n -i "nextval|sequence" supabase/migrations src/migrations | rg -i "invoice|faktur|order|zlecen"`
- *ID kodujące dane biznesowe* — przegląd formatu: `rg -n "padStart|toString\(36\)" src/lib | rg -i "id|number|numer"`

**Audyt „czy się trzymamy".**
1. Czy publiczne URL-e/API używają nieprzezroczystych ID? → zapytanie o `nextval`/`identity` i trasy.
2. Czy numeracja wymagana prawnie ma licznik per org bez luk? → `rg -n -i "counter|licznik" supabase/migrations src/migrations`.
3. Czy zapytania po `id` mają filtr org/RLS? → `rg -n "\.eq\(['\"]id['\"]" src | rg -v "org"` — każdy wynik do sprawdzenia.
4. Czy PK dużej tabeli jest sortowalny po czasie albo uzasadniono v4? → `rg -n "uuid_generate_v4|gen_random_uuid|uuidv7" supabase/migrations`.
5. Czy w Payload kolekcje z liczbowym ID mają `access` ograniczone? → `rg -n "access:" src/collections | wc -l` vs liczba kolekcji.

**Nie potrzebujesz jeszcze.** Snowflake, własnych generatorów ID, hash-id dla UX, rozproszonego generatora numerów.

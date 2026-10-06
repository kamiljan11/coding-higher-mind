# 04 · Komunikacja i asynchroniczność — API, zadania w tle, webhooki, real-time, zdarzenia, n8n

Konwencje (`~`, `[NIEPEWNE]`, zmienne ścieżek, odsyłacze `NN › Karta`) — w `README.md`.

---

### Kontrakt API i granice

**Problem.** Każda granica (przeglądarka↔serwer, funkcja↔funkcja, my↔dostawca, my↔partner) jest kontraktem, który przeżywa kod. Sygnały w diffie: nowy endpoint/route handler/server action/RPC/edge function, zmiana kształtu odpowiedzi, nowe pole wejściowe, nowy `fetch` do zewnętrznego API.

**Domyślnie u nas.** Wewnętrzne wywołania własnego frontu: PostgREST/RPC (supabase-js), route handlery i server actions (Next), funkcje serwerowe TanStack Start (kamiljan.com: `src/lib/*.functions.ts`). Zewnętrzne API: REST/JSON + opis (OpenAPI) i wersja w ścieżce (`/v1`). Dane z zewnątrz (formularz, webhook, odpowiedź LLM, wiersz z bazy o niepewnym kształcie) przechodzą przez `zod` `safeParse` NA granicy i dalej są typowane. UWAGA na wersje: flota ma zod 3 i zod 4 w różnych repo — API różnią się; sprawdź lockfile przed napisaniem kodu. Błędy w stałym kształcie (`code`, `message`, `request_id`) i z poprawnym statusem HTTP; paginacja keyset; mutacje płatnicze z `Idempotency-Key`. Kwoty, statusy, role i `org_id` wyznacza serwer — nigdy żądanie.
**Kiedy NIE upraszczać:** API dla partnerów lub aplikacji mobilnej = kontrakt formalny, wersjonowany, z testem kompatybilności.

| Wariant | Koszt operacyjny | Finansowy | Poznawczy |
|---|---|---|---|
| REST/JSON + zod | debugowanie `curl`-em | zero | niski |
| RPC/server actions | przywiązanie do frameworka | zero | niski; łatwo przeoczyć, że to publiczny endpoint |
| GraphQL | limity głębokości, N+1 w resolverach | zero | wysoki — nie |
| gRPC/tRPC zewnętrznie | tooling, brak cache HTTP | zero | wysoki — nie |

**Awarie i detekcja.**
- *wejście bez parsowania* — `rg -n "req\.json\(\)|request\.json\(\)|await request\.formData" src supabase/functions` i w tych plikach `rg -n "safeParse|\.parse\("`
- *mass assignment (cały body do update/insert)* — `rg -n "\.(update|insert|upsert)\((body|req\.body|data|input|await req\.json)" src supabase/functions`
- *kwota/rola/org z żądania* — `rg -n "amount|price|role|org_?id" src/app/api supabase/functions | rg -i "body\.|req\.|request\.|input\."`
- *token/klucz w query stringu (trafia do logów i historii)* — `rg -n "searchParams\.get\(['\"](token|key|secret|apikey)" src`
- *błąd jako `200 {error}`* — `rg -n "status: ?200" src/app/api supabase/functions | rg -i "error"`
- *offset-paginacja na rosnącej liście* — `rg -n "\.range\(|offset" src`
- *zod 3 vs 4 w jednym repo/PR* — `rg -n "\"zod\"" package.json`; `rg -n "z\.string\(\)\.(email|uuid)\(\)|z\.email\(\)|z\.uuid\(\)" src`

**Audyt „czy się trzymamy".**
1. Czy każde wejście jest parsowane przed użyciem? → pierwsza komenda.
2. Czy mutujące endpointy płatnicze/zamówieniowe przyjmują `Idempotency-Key` lub mają naturalny klucz? → `rg -n -i "idempotency" src supabase/functions`.
3. Czy kwoty, statusy, role i `org_id` są wyznaczane po stronie serwera? → trzecia komenda.
4. Czy błędy mają stały kształt i `request_id`? → `rg -n "request_id|requestId" src supabase/functions | wc -l`.
5. Czy rosnące listy używają keyset? → `rg -n "\.range\(|offset" src`.
6. Czy zmiana pola nie psuje istniejącego klienta (nowe pole = opcjonalne)? → diff typów + testy kontraktowe `rg -ln "contract|schema" tests`.

**Nie potrzebujesz jeszcze.** GraphQL, gRPC, tRPC dla zewnętrznych, API gateway, wersjonowania nagłówkami, generowanych SDK.

---

### Zadania w tle i kolejki

**Problem.** Krok wolny, zawodny albo płatny (mail, SMS, PDF, LLM, import, webhook wychodzący) nie może blokować ani wywracać żądania użytkownika. Sygnały w diffie: `await` na zewnętrznym API w handlerze użytkownika, `setTimeout` jako „zadanie w tle", fire-and-forget bez zapisu, nowy cron, nowa pętla po rekordach w handlerze.

**Domyślnie u nas.** Tabela `jobs` w Postgresie + worker. Kolumny: `type`, `payload`, `status` (queued/running/done/failed/dead), `attempts`, `max_attempts`, `run_after`, `locked_until`, `last_error`. Pobieranie (odbiera też zadania z wygasłym lease po crashu workera, ale nie takie z wyczerpanymi próbami): `with c as (select id from jobs where ((status='queued' and run_after <= now()) or (status='running' and locked_until < now())) and attempts < max_attempts order by run_after limit 10 for update skip locked) update jobs set status='running', locked_until = now() + interval '5 minutes', attempts = attempts + 1 from c where jobs.id = c.id returning jobs.*;`. Osobny krok (cron/worker) przenosi wyczerpane do `dead`: `update jobs set status='dead', last_error = coalesce(last_error,'lease wygasł, max_attempts') where status='running' and locked_until < now() and attempts >= max_attempts;` (zweryfikowane na PG 17 w transakcji z ROLLBACK: wygasły lease wraca do puli, wyczerpany trafia do `dead`). Lease (`locked_until`) zamiast „running na zawsze"; backoff w `run_after`; limit prób i stan `dead` widoczny w panelu/alercie; konsument idempotentny (→ 05 › Idempotentność). Wyzwalanie: `pg_cron` → funkcja/worker, cron platformy albo n8n (wzorzec: `pg_cron` co kilka sekund przetwarza kolejkę maili). Użytkownik widzi stan („w toku", „nie udało się") zamiast czekać. Rozszerzenie kolejkowe `pgmq` istnieje w ekosystemie Supabase `[NIEPEWNE: dostępność/wersja]` — to ta sama idea, nie inny system.
**Kiedy NIE:** krok szybki (~<1–2 s) i niekrytyczny — rób inline. Zewnętrzna kolejka (SQS/Kafka) dopiero przy ~setkach zadań/s, fan-oucie do wielu konsumentów lub potrzebie odtwarzania strumienia.

| Wariant | Koszt operacyjny | Finansowy | Poznawczy |
|---|---|---|---|
| tabela `jobs` + `SKIP LOCKED` | worker, czyszczenie starych wierszy | zero | niski |
| zarządzany orkiestrator zadań | integracja, vendor | abonament | średni |
| SQS/RabbitMQ | serwis, DLQ, monitoring | miesięczny | wysoki |
| Kafka | klaster, partycje, schematy | wysoki | bardzo wysoki — nie |

**Awarie i detekcja.**
- *zadanie wisi w `running` po crashu workera* — `select count(*), min(locked_until) from jobs where status='running' and locked_until < now();`
- *kolejka rośnie szybciej niż jest opróżniana* — `select status, count(*), now()-min(created_at) as oldest from jobs group by status;`
- *„zatruta" wiadomość wywala konsumenta w kółko* — `select type, last_error, attempts from jobs where status in ('failed','dead') order by attempts desc limit 10;`
- *brak lease/limitu prób w nowej kolejce* — `rg -n -i "skip locked|locked_until|max_attempts|attempts" supabase/migrations src/migrations`
- *fire-and-forget bez śladu* — `rg -n "\.then\(\(\) => \{\}\)|void [a-z]+\(|setTimeout\(" src/app/api supabase/functions`
- *cron bez ochrony przed nakładaniem się* — `select jobname, schedule from cron.job;` (Supabase) i sprawdź, czy zadanie ma blokadę (→ 05 › Współbieżność)

**Audyt „czy się trzymamy".**
1. Czy zadanie w `running` ma lease i może być pobrane ponownie? → komenda z awarii.
2. Czy jest limit prób i stan końcowy widoczny dla człowieka? → `dead` count w panelu/alercie.
3. Czy konsument jest idempotentny — test „to samo zadanie 2×"? → `rg -ln "twice|duplicate|2x|dwa razy" tests`.
4. Czy wiek najstarszego zadania ma alert? → `rg -n -i "oldest|backlog|queue" docs/RUNBOOK.md`.
5. Czy żądanie zwraca id/status zamiast czekać, a UI ma stan „w toku"? → `rg -n -i "status|polling|refetchInterval" src/features/<modul>`.
6. Czy tabela zadań jest czyszczona (retencja)? → `rg -n -i "delete from jobs|retention" supabase`.

**Nie potrzebujesz jeszcze.** SQS, Kafki, RabbitMQ, Redisa/BullMQ, osobnego silnika workflow (do wieloetapowych długich procesów z retry per krok rozważ później, z ADR).

---

### Webhooki przychodzące i wychodzące

**Problem.** Webhook to publiczny endpoint przyjmujący zdarzenia o pieniądzach i stanach od dostawców (płatności, SMS, poczty), albo nasz kanał do cudzych systemów. Dostawcy ponawiają przy braku 2xx, więc duplikaty i opóźnienia są normą, a fałszywe zdarzenia — atakiem. Sygnały w diffie: nowa funkcja/route z `webhook` w nazwie, `verify_jwt = false`, nowy dostawca, zmiana obsługi statusu płatności.

**Domyślnie u nas.** Przychodzące: odczytaj SUROWE body → zweryfikuj podpis HMAC (porównanie w stałym czasie, np. `timingSafeEqual`; tolerancja znacznika czasu ~5 min przeciw powtórkom `[~]`) → zapisz zdarzenie z `UNIQUE(provider, event_id)` → odpowiedz 2xx szybko → przetwórz (inline, jeśli ~<1 s; inaczej job). Webhook jest sygnałem; dla pieniędzy dodaj okresową rekoncyliację z API dostawcy (zamówienie w `pending` starsze niż X) — inaczej zgubiony webhook = zamówienie zawieszone na zawsze. Wzorce: weryfikacja podpisu HMAC w osobnym module, atomowe przejęcie transakcji przed potwierdzeniem (`update … where status='pending' returning`), jeden webhook jako jedyne źródło prawdy o płatności (przykłady z floty: `prywatne notatki floty (poza eksportem)`). Wychodzące: podpis HMAC, timeout, retry z backoffem, log dostaw, możliwość ponowienia ręcznie.
**Kiedy NIE:** brak — każdy webhook ma podpis i deduplikację; różni się tylko to, czy przetwarzasz inline czy w jobie.

| Wariant | Koszt operacyjny | Finansowy | Poznawczy |
|---|---|---|---|
| inline po weryfikacji i dedup | ryzyko timeoutu przy wolnej pracy | zero | niski |
| zapis → job → przetwarzanie | worker, stan zdarzenia | zero | średni |
| zewnętrzna bramka webhooków | vendor, dodatkowy hop | abonament | średni |

**Awarie i detekcja.**
- *JSON sparsowany przed weryfikacją podpisu (zmienia bajty)* — `rg -n -l -i "webhook" src supabase/functions` → w każdym pliku `rg -n "req\.json\(\)|request\.json\(\)|req\.text\(\)|request\.text\(\)|rawBody"` (surowe body pierwsze)
- *brak weryfikacji lub porównanie `===`* — `rg -n "timingSafeEqual|constantTimeEqual|crypto\.subtle\.verify|hmac" <pliki webhooków>`
- *brak deduplikacji po id zdarzenia* — `rg -n -i "event_id|ON CONFLICT|processed_events|idempot" <pliki webhooków>`
- *handler wolny → retry dostawcy → duplikaty* — czas odpowiedzi: `curl -s -o /dev/null -w "%{time_total}\n" -X POST <url> -d '{}'` (odpowiedź 401 ma być szybka; mierz też ścieżkę poprawną w teście)
- *zamówienia zawieszone po zgubionym webhooku (nazwa tabeli i wartość statusu wg schematu repo — w Payload enum bywa inny)* — `select id, status, created_at from orders where status='pending' and created_at < now() - interval '1 hour';`
- *funkcje publiczne bez żadnej autoryzacji* — `rg -n "verify_jwt" supabase/config.toml`

**Audyt „czy się trzymamy".**
1. Czy podpis jest weryfikowany na surowym body i w stałym czasie? → komendy powyżej.
2. Czy zdarzenie ma UNIQUE na id i zapis razem/przed efektem? → `rg -n "ON CONFLICT" <plik>`; `select indexrelid::regclass from pg_index where indisunique and indrelid::regclass::text ~ 'event|webhook|idempot';`
3. Czy odpowiada 2xx przed wolną pracą? → odczyt handlera.
4. Czy istnieje rekoncyliacja zawieszonych płatności? → `rg -n -i "reconcil|rekoncyl|pending" src/lib scripts supabase/functions`.
5. Czy jest test „to samo zdarzenie 2× → jeden efekt"? → `rg -ln -i "webhook" tests | xargs rg -n -i "twice|duplicate|2x"`.
6. Czy webhooki wychodzące mają podpis, timeout i log dostaw? → `rg -n -i "hmac|x-signature|delivery" src supabase/functions`.

**Nie potrzebujesz jeszcze.** Bramki webhooków (Svix/Hookdeck), magistrali zdarzeń, własnego dispatchera dla wielu subskrybentów.

---

### Real-time

**Problem.** Użytkownik ma widzieć zmianę bez odświeżania (status zlecenia, czat, tablica). Większość „na żywo" w naszych produktach wystarcza jako odświeżanie co kilka–kilkadziesiąt sekund. Sygnały w diffie: `.channel(`, `.subscribe(`, `onSnapshot`, `EventSource`, `WebSocket`, `refetchInterval`, nowy komponent „live".

**Domyślnie u nas.** Drabina: (1) refetch po akcji + `refetchInterval` ~15–60 s `[~]` + refetch przy powrocie na kartę; (2) Supabase Realtime — Postgres Changes respektują RLS, Broadcast/Presence do efemerycznych sygnałów; kanały prywatne wymagają autoryzacji `[NIEPEWNE: szczegóły polityk na `realtime.messages` — sprawdź w docs]`; (3) SSE dla jednokierunkowego strumienia (streaming odpowiedzi LLM); (4) własne WebSockety — nie. Po każdym reconnect klient odświeża stan (zdarzenia mogły zginąć); obecność („online", „pisze…") poza główną tabelą. ADR uzasadnia, czemu nie wystarczył polling. Limity połączeń zależą od planu `[NIEPEWNE]`.
**Kiedy NIE:** statusy zmieniające się rzadziej niż co minutę.

**Transport, przepustowość i limity (kurs → u nas).**
- **Fallback, gdy WebSocket nie przechodzi.** Proxy korporacyjne i inspekcja TLS (biura, sieci warsztatów, hotele) potrafią zrywać albo blokować `wss://`. Klasyczny ratunek to long polling: serwer trzyma żądanie do zmiany albo ~25 s `[~]`. Na Vercelu każde trzymane żądanie to czas funkcji, więc u nas fallbackiem jest zwykły polling: po N (~3) kolejnych `CHANNEL_ERROR`/`TIMED_OUT` przełącz komponent na `refetchInterval` ~15–30 s `[~]`, a w tle dalej próbuj subskrypcji z backoffem. Czy klient `realtime-js` sam przełącza się na long polling, nie sprawdzono `[NIEPEWNE: sprawdź wersję realtime-js w lockfile i jej docs]`, więc nie zakładaj tego. Test: zablokuj w DevTools żądania do `*.supabase.co/realtime` i sprawdź, czy widok dalej się odświeża.
- **Backpressure wolnego klienta.** Telefon na słabym zasięgu albo karta w tle nie nadąża z obróbką zdarzeń. Nie aplikuj każdego zdarzenia osobno do stanu i renderu. Zbierz je (debounce ~250–1000 ms `[~]`), a przy burzy (np. >~50 zdarzeń w oknie) porzuć bufor i zrób jeden pełny refetch. Gdy karta jest ukryta (`visibilitychange`), odłącz kanał; po powrocie zrób refetch i subskrybuj ponownie. SSE/streaming LLM: generuj w tempie odbiorcy (`ReadableStream` z `pull`, nie `enqueue` całości) i przerwij generowanie, gdy klient się rozłączy (`request.signal` → `abortSignal` do SDK). Inaczej płacisz za tokeny dla zamkniętej karty.
- **Limity połączeń planu Supabase.** Plan ogranicza równoczesne połączenia Realtime i liczbę wiadomości na sekundę `[NIEPEWNE: wartości per plan z docs „Realtime Quotas" i panelu projektu — wpisz je do capacity.md]`. Serwetka: połączenia ≈ aktywni jednocześnie × karty na osobę × kanały na kartę. Przykład: 10 tys. użytkowników × ~5 % jednocześnie × 1,5 karty × 2 kanały ≈ 1500 `[~]`, czyli rząd limitów niższych planów. Dźwignie: jeden kanał na kartę z wieloma tematami zamiast kanału per komponent, odłączanie ukrytych kart, polling dla widoków drugorzędnych.
- **Batchowanie.** Import, cron albo `update` masowy na tabeli w publikacji `supabase_realtime` wysyła zdarzenie na każdy wiersz, więc 10 tys. wierszy oznacza 10 tys. wiadomości. To uderza w limit wiadomości na sekundę i zalewa klientów. Operacje masowe rób na tabeli spoza publikacji albo na końcu wyślij jeden Broadcast („odśwież listę X"). Powiadomienia do użytkownika (licznik, toast) agreguj, np. „5 nowych zleceń" zamiast 5 toastów (→ 06 › Powiadomienia).

| Wariant | Koszt operacyjny | Finansowy | Poznawczy |
|---|---|---|---|
| polling/refetch | więcej zapytań | zapytania i transfer | niski |
| Supabase Realtime | limity planu, polityki kanałów | wg planu | średni |
| Realtime + fallback na polling | dwie ścieżki odświeżania do testowania | jak wyżej | średni |
| long polling na funkcjach serverless | żądania trzymane do timeoutu funkcji | czas funkcji × połączenia | średni — nie na Vercelu |
| SSE | połączenia otwarte, limit czasu funkcji | funkcje | średni |
| własny WebSocket + pub/sub | stan, skalowanie, reconnect | serwer | wysoki — nie |

**Awarie i detekcja.**
- *luka zdarzeń po reconnect* — `rg -n -i "reconnect|CHANNEL_ERROR|TIMED_OUT|onclose|SUBSCRIBED" src`
- *wyciek subskrypcji (brak sprzątania)* — `rg -n "\.channel\(" src` zestawione z `rg -n "removeChannel|unsubscribe" src` (liczby powinny się zgadzać)
- *tabela wystawiona w Realtime bez RLS* — `select * from pg_publication_tables where pubname='supabase_realtime';` potem `select tablename, rowsecurity from pg_tables where schemaname='public' and tablename in (<lista>);`
- *wygasły token w trakcie sesji* — `rg -n -i "setAuth|onAuthStateChange|TOKEN_REFRESHED" src`
- *„real-time" tam, gdzie wystarczał polling* — liczba subskrypcji: `rg -c "\.subscribe\(" src | awk -F: '{s+=$2} END {print s}'`
- *brak fallbacku przy zablokowanym WebSocket (proxy)* — `rg -n -i "CHANNEL_ERROR|TIMED_OUT" src -A6 | rg -i "refetchInterval|polling|setInterval"` (puste = brak przełączenia)
- *burza refetchy (każde zdarzenie = zapytanie)* — `rg -l "postgres_changes" src | xargs -r rg --files-without-match -i "debounce|throttle"` (każdy wypisany plik = refetch per zdarzenie, do poprawy)
- *kanały otwarte w ukrytych kartach* — `rg -n "visibilitychange|document\.hidden" src` (0 trafień przy ≥1 `.channel(` = finding)
- *operacja masowa zalewa kanał* — `select schemaname, tablename from pg_publication_tables where pubname='supabase_realtime';` zestawione z tabelami importów/cronów: `rg -n -i "upsert|insert into|update " supabase/functions scripts | rg "<tabela z publikacji>"`
- *SSE/LLM generuje dalej po zamknięciu karty* — `rg -l "streamText|ReadableStream|text/event-stream" src supabase/functions | xargs -r rg --files-without-match "signal|abort"` (każdy wypisany plik = generuje dalej po zamknięciu karty, koszt tokenów)
- *zbliżanie się do limitu połączeń* — panel projektu → Realtime → raport/zużycie `[NIEPEWNE: lokalizacja metryk]`; serwetka z karty wpisana do `capacity.md`

**Audyt „czy się trzymamy".**
1. Czy klient po reconnect nadrabia stan (refetch)? → pierwsza komenda.
2. Czy publikowane tabele mają RLS i polityki chroniące zasięg tenanta? → zapytania z awarii.
3. Czy obecność nie ląduje w głównej tabeli? → `rg -n -i "presence|typing|online" supabase/migrations`.
4. Czy jest limit kanałów/subskrypcji na użytkownika i sprzątanie przy odmontowaniu? → komenda `removeChannel`.
5. Czy ADR mówi, czemu nie polling? → `rg -n -i "realtime|polling" docs/adr`.
6. Czy widok „na żywo" działa przy zablokowanym `wss://` (fallback na polling)? → komenda fallbacku + test w DevTools.
7. Czy zdarzenia są zbierane (debounce/refetch zbiorczy), a operacje masowe nie idą wierszami przez publikację? → komendy burzy i masowej operacji.
8. Czy liczba równoczesnych połączeń jest policzona i porównana z limitem planu? → `rg -n -i "realtime|połącze" docs/capacity* docs/adr capacity.md 2>/dev/null`.

**Nie potrzebujesz jeszcze** (wariant → sygnał powrotu):
- własny long polling/SSE jako fallback → zgłoszenia klientów „nie odświeża się" z sieci firmowych, których polling ~15–30 s nie rozwiązuje (wymagane opóźnienie <~5 s).
- Pusher/Ably/zewnętrzny push → zmierzone zbliżanie się do limitu połączeń lub wiadomości planu (~>70 % w szczycie) i wyższy plan droższy niż usługa.
- własne WebSockety/pub/sub → nigdy przy tej skali (wymagałyby stałego serwera i sticky/pub-sub backbone).
- kolejka/bufor zdarzeń po stronie serwera dla klientów → klienci regularnie gubią zdarzenia mimo refetchu po reconnect.
- CRDT/współedycja → produkt wymaga edycji tego samego dokumentu przez wiele osób naraz.

---

### Zdarzenia, dzienniki i raporty

**Problem.** Potrzeba odpowiedzi na „co się stało, kiedy, kto" i na „ile / jaki trend". Licznik bez historii nie da się wyjaśnić; raport liczony na żywo z tabel OLTP potrafi położyć bazę. Sygnały w diffie: nowa tabela logu/zdarzeń/ruchów, kolumna-licznik (`qty`, `balance`, `count`), nowy dashboard/raport/CSV, agregacja w żądaniu użytkownika.

**Domyślnie u nas.** Tabele append-only (ruchy magazynowe, dziennik zdarzeń, audit log): `occurred_at` (czas zdarzenia) osobno od `created_at`, klucz idempotencji z `UNIQUE`, `type` + wersja schematu walidowana zod, brak grantów UPDATE/DELETE. Stan bieżący = materializacja, którą da się przeliczyć ze zdarzeń (wzór: `stock-movements` w shop-app jest księgą, `przeliczStanProduktu` przelicza licznik). Raporty: widok/materialized view odświeżany cyklicznie (`REFRESH MATERIALIZED VIEW CONCURRENTLY`, wymaga unikalnego indeksu) albo zapytanie z limitem; eksport CSV jako zapytanie z limitem i bez PII, której odbiorca nie potrzebuje. Retencja surowych zdarzeń opisana (PII → 05 › Dane osobowe).
**Kiedy NIE:** tabele słownikowe i ustawienia — wystarczy `updated_at`; pełny event sourcing i CQRS.

| Wariant | Koszt operacyjny | Finansowy | Poznawczy |
|---|---|---|---|
| księga + licznik z triggera/funkcji | spójność licznika do pilnowania | storage | średni |
| tylko licznik | brak wyjaśnialności różnic | zero | niski dziś |
| materialized view | odświeżanie | zero | średni |
| hurtownia/strumienie | pipeline, vendor | wysoki | wysoki — nie |

**Awarie i detekcja.**
- *licznik bez księgi — nie da się uzgodnić* — `select table_name, column_name from information_schema.columns where table_schema='public' and column_name ~* '^(qty|quantity|balance|saldo|count|stock|inventory)$';` zestaw z tabelami ruchów
- *log z możliwością UPDATE/DELETE (nie jest dziennikiem)* — `select table_name, privilege_type, grantee from information_schema.role_table_grants where table_schema='public' and table_name ~* '(log|event|movement|audit)' and privilege_type in ('UPDATE','DELETE');`
- *agregacja po `created_at` zamiast `occurred_at`* — `rg -n "created_at" src/lib | rg -i "group|sum|count|report|raport"`
- *raport na żywo w ścieżce użytkownika* — `rg -n "count\(\*\)|sum\(|group by" src/app src/features | rg -v test`
- *matview bez odświeżania* — `select matviewname from pg_matviews;` i `rg -n -i "refresh materialized" supabase/migrations`
- *PII w logu* — `select column_name, table_name from information_schema.columns where table_schema='public' and table_name ~* '(log|event|audit)' and column_name ~* '(email|phone|kennitala|pesel|address)';`

**Audyt „czy się trzymamy".**
1. Czy tabela zdarzeń ma `occurred_at`, klucz idempotencji i wersję schematu? → `select column_name from information_schema.columns where table_name='<tabela>';` + `select indexrelid::regclass from pg_index where indisunique and indrelid='<tabela>'::regclass;`.
2. Czy agregaty finansowe dają się przeliczyć ze zdarzeń? → istnieje funkcja/skrypt przeliczający (`rg -n -i "przelicz|recalc|rebuild" src scripts`).
3. Czy dziennik jest niemodyfikowalny? → zapytanie o granty.
4. Czy raport ma limit i nie obciąża OLTP? → plan `EXPLAIN` + czas.
5. Czy retencja i PII są opisane? → `docs/PRIVACY.md`.

**Nie potrzebujesz jeszcze.** Kafki/Flinka, event sourcingu, CQRS, hurtowni danych, ClickHouse.

---

### Orkiestracja n8n i automatyzacje

**Problem.** n8n jest kleiem między API (trigger → wywołanie → zapis), a nie miejscem na logikę aplikacji. Faktyczny stan: n8n działa lokalnie jako usługa systemd użytkownika, nasłuchując tylko na loopbacku (adres, port i stan workflowów: `prywatne notatki floty (poza eksportem)`). Sygnały w diffie/PR: nowy workflow JSON, nowy webhook n8n, logika warunkowa w węzłach Code, credentials w eksporcie.

**Domyślnie u nas.** Mały workflow o jednym zadaniu; wołanie między workflowami przez sub-workflow lub webhook; logika, transformacje i testy → kod (Edge Function/skrypt), n8n tylko je woła; workflowy eksportowane do repo i recenzowane (skill `jack-n8n-reviewer`); sekrety w credentials n8n lub Infisical, nie w węzłach; webhook odpowiada szybko i jest idempotentny po id zdarzenia; błędy → workflow błędów + alert; adresy lokalne jako `127.0.0.1`, nie `localhost` (`pg/cases.md` LOCALHOST-IPV6). Webhooki dostawców dla klienta produkcyjnie NIE trafiają na laptop (→ 01 › Własny host).
**Kiedy NIE n8n:** logika z wieloma gałęziami, duże transformacje danych, wymagane testy jednostkowe, przepustowość.

| Wariant | Koszt operacyjny | Finansowy | Poznawczy |
|---|---|---|---|
| n8n małe workflowy | edycje w UI, mało testów | zero | niski |
| jeden duży workflow | kruchość, brak ponownego użycia | zero | rośnie szybko |
| kod w Edge Function + n8n jako wyzwalacz | deploy funkcji | zero | niski–średni |
| n8n w trybie kolejki/workerów | Redis, workery | wysoki | wysoki — nie |

**Awarie i detekcja.**
- *workflow-monolit* — `jq '.nodes | length' <workflow>.json` (~>30 węzłów = rozważ podział)
- *logika w węzłach Code zamiast w kodzie* — `jq '[.nodes[] | select(.type=="n8n-nodes-base.code")] | length' <workflow>.json`
- *sekrety w eksporcie* — `rg -n -i "api[_-]?key|bearer |token\"|secret" <workflow>.json`
- *usługa nie żyje / laptop uśpiony* — `systemctl --user is-active n8n; curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:<port>/healthz` (port: `prywatne notatki floty (poza eksportem)`)
- *webhook bez deduplikacji* — przegląd węzła Webhook → dalsze węzły; brak sprawdzenia `event_id`
- *brak alertu na nieudane wykonania* — workflow błędów istnieje? `jq -r '.settings.errorWorkflow // "BRAK"' <workflow>.json`

**Audyt „czy się trzymamy".**
1. Czy workflow robi jedną rzecz i ma ≤~15 węzłów? → `jq '.nodes | length'`.
2. Czy logika wykracza poza glue? → liczba węzłów Code.
3. Czy workflow jest w repo i przeszedł przegląd? → `git ls-files | rg -i "workflow.*json|n8n"`.
4. Czy sekretów nie ma w JSON? → komenda `rg` z awarii.
5. Czy błędy trafiają do alertu? → `errorWorkflow` ustawiony.
6. Czy nic klienckiego na produkcji nie zależy od n8n na laptopie? → lista webhooków i ich adresy.

**Nie potrzebujesz jeszcze.** Trybu kolejki n8n, hostingu HA, własnego serwera MCP, osobnego silnika workflow.

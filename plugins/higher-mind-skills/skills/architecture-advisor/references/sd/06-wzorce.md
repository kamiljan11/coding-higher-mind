# 06 · Wzorce produktowe — wyszukiwanie, geo, listy, powiadomienia, funkcje AI, dokumenty

Konwencje (`~`, `[NIEPEWNE]`, zmienne ścieżek, odsyłacze `NN › Karta`) — w `README.md`.

---

### Wyszukiwanie

**Problem.** Użytkownik szuka części po numerze, klienta po nazwisku/telefonie, produktu po opisie; do tego dochodzi wyszukiwanie semantyczne w asystencie AI. Sygnały w diffie: `ilike '%…%'`, `textSearch`, `.or(…ilike…)`, funkcja `match_*`/`similarity`, nowa zależność wyszukiwarki, nowa kolumna embeddingów.

**Domyślnie u nas.** Postgres: `pg_trgm` (literówki, fragmenty) + `tsvector` z indeksem GIN (pełny tekst) + `unaccent` (polskie i islandzkie znaki). Wbudowane konfiguracje tekstowe Postgresa NIE obejmują polskiego ani islandzkiego (sprawdzone na PG 17: `select cfgname from pg_ts_config;` — jest m.in. `danish`, `norwegian`, `swedish`, `simple`, brak `polish`/`icelandic`), więc stosuj `simple` + `unaccent` + trigramy zamiast stemmingu. Numery części/zamówień: kolumna znormalizowana (bez spacji, myślników, wielkości liter) z indeksem btree/trigram. Semantyka: pgvector w tej samej bazie — drabina: treść w prompcie → słowa kluczowe/FTS → pgvector (indeks HNSW) → dedykowany magazyn (→ 06 › Funkcje AI). W multi-tenant filtr `org_id` także w zapytaniach wektorowych. Limit wyników, limit częstotliwości (→ 03 › Rate limiting). Rozszerzenia dostępne w projekcie: `select name from pg_available_extensions where name in ('pg_trgm','unaccent','vector');`.
**Kiedy NIE zostać przy Postgresie (progi ~, zmierz):** relewancja/facety/literówki na ~>1 mln dokumentów, autocomplete z budżetem ~<50 ms przy dużym korpusie, potrzeba strojenia trafności z logów kliknięć.

| Wariant | Koszt operacyjny | Finansowy | Poznawczy |
|---|---|---|---|
| FTS + trgm w Postgresie | indeksy GIN, wolniejszy zapis | zero | niski–średni |
| pgvector (hybryda z FTS) | embeddingi do utrzymania i odświeżania | koszt API embeddingów | średni |
| Typesense/Meilisearch/Algolia | kopia danych, synchronizacja, lag | abonament | średni–wysoki |
| Elasticsearch/OpenSearch | klaster, mapowania | wysoki | wysoki — nie |

**Awarie i detekcja.**
- *`ilike '%x%'` bez indeksu → seq scan* — `rg -n -i "ilike|textSearch" src supabase` zestawione z `select indexdef from pg_indexes where indexdef ~* 'gin|gist|trgm|tsvector';`
- *wyszukiwanie bez filtra tenanta (także wektory)* — `rg -n -i "match_documents|similarity|rpc\('(search|match)" src supabase` i sprawdź `org_id` w funkcji SQL
- *indeks zewnętrzny rozjechany z bazą (lag, brak propagacji usunięć)* — `rg -n -i "algolia|typesense|meilisearch|elasticsearch" package.json src`
- *wyniki wektorowe niestabilne po zmianie modelu embeddingów* — `rg -n -i "embedding|voyage|text-embedding" src supabase/functions` (wersja modelu zapisana przy wektorze?)
- *brak limitu wyników* — `rg -n "\.limit\(|limit [0-9]" <kod wyszukiwania>`

**Audyt „czy się trzymamy".**
1. Czy zapytanie ma filtr org/RLS (także w wektorach)? → `rg` z awarii + odczyt funkcji.
2. Czy kolumny z `ilike`/FTS mają GIN/trigram? → `rg -n -i "ilike"` vs `select indexdef from pg_indexes where indexdef ~* 'gin'`.
3. Jeśli jest osobny indeks: jak trafiają do niego aktualizacje i usunięcia i jaki jest lag? → `rg -n -i "sync|reindex|webhook" <kod indeksu>`.
4. Czy udowodniono (pomiarem), że prosty FTS nie wystarcza, przed dodaniem silnika? → ADR + `EXPLAIN`.
5. Czy zapytania mają limit wyników i limit częstotliwości? → `rg -n "limit" <kod>`.

**Nie potrzebujesz jeszcze.** Elasticsearcha/OpenSearcha, osobnej usługi wyszukiwania (dopóki FTS+trgm mieści się w budżecie opóźnień), strojenia trafności z logów, autocomplete jako osobnego indeksu.

---

### Geo

**Problem.** „Najbliższy punkt", strefy dostaw, mapa z filtrami. Samo przechowywanie współrzędnych tego nie wymaga. Flota: rental-app ma stałą listę punktów odbioru w `src/lib/company.ts` — to dane, nie zapytania przestrzenne. Sygnały w diffie: kolumny `lat/lng`, `ST_*`, nowa zależność mapowa, śledzenie pozycji.

**Domyślnie u nas.** Stała lista punktów (kilkadziesiąt) → tabela + odległość policzona w kodzie, bez PostGIS. Zapytania „najbliższy/w promieniu/w strefie" → PostGIS: kolumna `geography(Point,4326)`, indeks GiST, `ST_DWithin` (używa indeksu) zamiast `ST_Distance` w `ORDER BY` po całej tabeli; kolejność `x = długość (lon), y = szerokość (lat)`. Pozycje użytkowników/pojazdów to dane osobowe: cel, retencja, dławienie zapisu (~co 1–5 s i tylko przy istotnej zmianie `[~]`). Dostępność PostGIS: `select name from pg_available_extensions where name='postgis';`.
**Kiedy NIE PostGIS:** ~<kilkaset punktów i brak zapytań „najbliższy" — zwykła tabela.

| Wariant | Koszt operacyjny | Finansowy | Poznawczy |
|---|---|---|---|
| tabela + obliczenie w kodzie | zero | zero | niski |
| PostGIS + GiST | rozszerzenie, migracje | zero | średni |
| geohash/H3/S2 | własna logika sąsiadów | zero | wysoki — nie |
| Redis GEO / zewnętrzna usługa | kolejny magazyn | abonament | wysoki — nie |

**Awarie i detekcja.**
- *seq scan na kolumnach geo* — `rg -n -i "geography\(|geometry\(" supabase/migrations` zestawione z `rg -n -i "using gist" supabase/migrations`
- *odległość liczona dla każdego wiersza* — `rg -n "ST_Distance" src supabase | rg -v "ST_DWithin"`
- *pomylona kolejność lon/lat* — `rg -n -i "ST_MakePoint|ST_Point|lat.*lng|lng.*lat" src supabase`
- *zapis pozycji bez dławienia* — `rg -n -i "watchPosition|geolocation|insert.*(lat|position)" src`
- *lokalizacje bez wpisu w dokumencie prywatności* — `rg -n -i "lokalizacj|location|geolocation" docs/PRIVACY.md`

**Audyt „czy się trzymamy".**
1. Czy kolumny geo mają GiST? → komendy z awarii.
2. Czy zapytania promieniowe używają `ST_DWithin`? → `rg -n "ST_Distance"`.
3. Czy kolejność lon/lat jest spójna i opisana? → komentarz/konwencja w repo.
4. Czy zapis pozycji jest ograniczony? → `rg` z awarii.
5. Czy lokalizacje mają wpis w `docs/PRIVACY.md` (cel, retencja)? → ostatnia komenda.

**Nie potrzebujesz jeszcze.** PostGIS dla stałej listy punktów, geohash/H3/S2, Redis GEO, własnego serwera kafelków.

---

### Listy, feed i paginacja

**Problem.** Każdy widok „lista zleceń/zamówień/aktywności" rośnie z czasem; offset-paginacja i niedeterministyczne sortowanie dają duplikaty i luki, a liczenie całości kosztuje. Sygnały w diffie: `.range(`, `offset`, `count: 'exact'`, `order by created_at` bez tiebreakera, nieskończone przewijanie, „N nowych".

**Domyślnie u nas.** Lista = zapytanie `order by created_at desc, id desc` z paginacją keyset (`where (created_at, id) < (…)`) i indeksem złożonym `(org_id, created_at desc, id desc)`; sortowanie zawsze z tiebreakerem `id`; całkowitą liczbę pokazuj tylko, gdy potrzebna, i wtedy szacunkową/odświeżaną osobno (`count: 'exact'` skanuje); „N nowych" jako licznik, treść po kliknięciu; usunięcie = soft delete z filtrem w zapytaniu/polityce; limit na zapytanie. Fan-out on write, ranking, cache feedu — nie.
**Kiedy NIE keyset:** małe, stałe listy (~<kilkaset elementów) — można pobrać całość.

| Wariant | Koszt operacyjny | Finansowy | Poznawczy |
|---|---|---|---|
| keyset | trzeba zwracać token kontynuacji (ostatni klucz) | zero | niski–średni |
| offset | wolniejszy głębiej, duplikaty/luki przy zmianach | zero | najniższy |
| fan-out on write | pamięć, backfill przy zmianach | wysoki | wysoki — nie |

**Awarie i detekcja.**
- *offset/range i exact count* — `rg -n "\.range\(|offset|count: ?'exact'" src`
- *sortowanie bez tiebreakera* — `rg -n "\.order\(" src | rg -v "id"`
- *brak indeksu pod zapytanie listy* — `select indexdef from pg_indexes where tablename='<tabela>';` i `EXPLAIN (ANALYZE, BUFFERS) <zapytanie listy>`
- *lista bez filtra tenanta* — `rg -n "\.from\(" src/features | rg -v "org"`
- *N+1 przy składaniu elementów* — `rg -n -A4 "\.map\(async|for \(" src | rg "\.from\(|fetch\("`
- *usunięte rekordy widoczne* — `rg -n -i "deleted_at|is_deleted" src supabase/migrations`

**Audyt „czy się trzymamy".**
1. Czy paginacja jest keysetem z tiebreakerem? → komendy z awarii.
2. Czy indeks `(org_id, created_at, id)` odpowiada zapytaniu? → `select indexdef from pg_indexes`.
3. Czy usuwanie ukrywa wpis, a zapytanie to filtruje? → `rg` deleted.
4. Czy lista ma limit i filtr org/RLS? → `rg -n "\.limit\(" src`.
5. Czy nie ma N+1 w składaniu widoku? → komenda N+1.

**Nie potrzebujesz jeszcze.** Fan-out on write, rankingu, cache początku feedu, Redis sorted sets.

---

### Powiadomienia

**Problem.** Mail, SMS i push to efekty nieodwracalne i płatne: duplikat lub zły adresat widoczny jest natychmiast, a SMS kosztuje. Flota ma Resend (poczta), Twilio (SMS/IVR), web push (workshop-app `send-push`, VAPID). Sygnały w diffie: nowe wywołanie Resend/Twilio/push, nowy szablon, nowe zdarzenie wyzwalające wiadomość, pętla po odbiorcach.

**Domyślnie u nas.** Zdarzenie → tabela `notifications` (outbox): `event_id`, `user_id`, `channel`, `status`, `attempts`, `UNIQUE (event_id, user_id, channel)` → worker (Edge Function/n8n) → adapter dostawcy; retry z backoffem i stan końcowy; SMS tylko dla zdarzeń o wysokiej wartości (2FA, bezpieczeństwo, termin) z cap kosztu per organizację i alertem; szablony po stronie serwera w IS/PL/EN, zmienne escapowane; preferencje i opt-out + zapis zgody (data, źródło); godziny ciszy z uwzględnieniem strefy odbiorcy (→ 02 › Pieniądze, czas); poczta transakcyjna oddzielona od marketingowej (inna domena/strumień); obsługa bounce/complaint z webhooków dostawcy; SPF/DKIM/DMARC skonfigurowane.
**Kiedy NIE budować własnego systemu:** pojedyncze maile transakcyjne bez preferencji — wystarczy outbox + Resend.

| Wariant | Koszt operacyjny | Finansowy | Poznawczy |
|---|---|---|---|
| outbox + worker | tabela, retry, czyszczenie | koszt SMS/maila | niski–średni |
| wysyłka inline w handlerze | zero, ale gubi i dubluje przy retry | zero | niski i ryzykowny |
| platforma powiadomień (Novu/Knock/OneSignal) | integracja, vendor | abonament | średni |

**Awarie i detekcja.**
- *brak deduplikacji (to samo zdarzenie 2× → dwie wiadomości)* — `rg -n -i "notification|outbox" supabase/migrations src/migrations` i `select indexrelid::regclass from pg_index where indisunique and indrelid::regclass::text ~ 'notification|outbox';`
- *wysyłka inline w pętli odbiorców* — `rg -n -B3 -A3 "resend\.|twilio|sendMail|sendSms" src supabase/functions | rg "for \(|\.map\(|forEach"`
- *wstrzyknięcie HTML w szablonie* — `rg -n "dangerouslySetInnerHTML|innerHTML|\{\{\{|escapeHtml" src supabase/functions`
- *brak opt-outu/zgody* — `rg -n -i "unsubscribe|opt.?out|consent|zgoda" src supabase/migrations`
- *martwe tokeny push / bounce'y* — `rg -n -i "bounce|complaint|410|invalid.*token" src supabase/functions`
- *brak SPF/DKIM/DMARC* — `dig +short TXT <domena>; dig +short TXT _dmarc.<domena>`
- *brak capa SMS* — `rg -n -i "twilio" src supabase/functions -l` i w nich `rg -n -i "cap|budget|limit|quota"`

**Audyt „czy się trzymamy".**
1. Czy wysyłka ma klucz dedup `(event, user, channel)` z UNIQUE? → komenda indeksu.
2. Czy kanały mają niezależny retry i stan końcowy? → `rg -n -i "attempts|status" <migracja notifications>`.
3. Czy zmienne użytkownika są escapowane w szablonach? → komenda HTML.
4. Czy istnieje opt-out/preferencje i zapis zgody? → komenda zgody + `docs/PRIVACY.md`.
5. Czy SMS/push mają cap i alert? → komenda capa.
6. Czy domena nadawcy ma poprawne SPF/DKIM/DMARC? → `dig`.

**Nie potrzebujesz jeszcze.** Platformy powiadomień (Novu/Knock/OneSignal), digestów i fallbacku kanałów, osobnych kolejek per kanał.

---

### Funkcje AI: LLM, embeddingi, RAG

**Problem.** Flota ma kilka funkcji AI: czat i brief leadu (Vercel AI SDK + `@ai-sdk/anthropic`, model przypięty w kodzie), asystent warsztatowy (routing Haiku/Sonnet + embeddingi + pgvector), czat wsparcia, który może nadal iść przez bramkę dostawcy scaffoldu (stan faktyczny sprawdź w kodzie funkcji; lista projektów: `../prywatne notatki floty (poza eksportem)`). LLM to zależność zewnętrzna (→ 05), kosztowna (→ 03 › Rate limiting), niedeterministyczna i podatna na wstrzyknięcia. Sygnały w diffie: `generateText/streamText/generateObject`, `anthropic(`, `model:`, nowy prompt, nowe narzędzie (tool use), nowa tabela embeddingów.

**Domyślnie u nas.** Dobór modelu per krok (skill `model-router`): klasyfikacja/ekstrakcja → najmniejszy model, reszta → średni, trudne rozumowanie → największy; identyfikator modelu przypięty (z wersją) i zapisany w jednym miejscu; plan dryfu modeli w `pg/models.md`. Retrieval po drabinie: treść w prompcie, jeśli się mieści → słowa kluczowe/FTS → pgvector → dedykowana baza wektorowa. Wyjście LLM to wejście niezaufane: strukturalne wyjście + `zod` `safeParse` na granicy. Dane użytkownika i dokumenty to dane, nie instrukcje (prompt injection): narzędzia z minimalnymi uprawnieniami, mutacje dopiero po potwierdzeniu użytkownika, zasięg tenanta egzekwowany w kodzie narzędzia, nie w prompcie. Cap kosztu per org/dzień + alert + wyłącznik (`pg/prr.md` P9), limit dla anonimów, timeout i streaming. Zestaw ~10–30 przypadków testowych `[~]` przed zmianą modelu lub promptu. Płatny klucz API tylko tam, gdzie produkt bez niego nie działa (reguła rozliczeń PG).
**Kiedy NIE RAG/pgvector:** korpus mieści się w kontekście (~<kilkaset stron) — wstaw go do promptu.

| Wariant | Koszt operacyjny | Finansowy | Poznawczy |
|---|---|---|---|
| treść w prompcie | brak pipeline'u | tokeny na każde wywołanie | niski |
| FTS → kontekst | indeksy | niski | niski |
| pgvector (embeddingi) | pipeline ingestii, odświeżanie przy zmianie treści | koszt embeddingów + storage | średni |
| dedykowana baza wektorowa | osobny magazyn | abonament | wysoki — nie przy tej skali |
| framework agentowy | trudne debugowanie, niedeterminizm | tokeny × kroki | wysoki |

**Awarie i detekcja.**
- *wyjście LLM użyte bez walidacji* — `rg -n "generateText|generateObject|streamText|messages\.create" src supabase/functions -l` → w plikach `rg -n "safeParse|\.parse\(|schema"`
- *model nieprzypięty/rozproszony po repo* — `rg -n "model: ?['\"]|claude-[a-z0-9-]+" src supabase/functions`
- *brak capa i limitu* — `rg -n -i "budget|cap|quota|daily|rateLimit" <pliki AI>`; zużycie: `select org_id, date(created_at), sum(tokens) from <ai_usage> group by 1,2 order by 3 desc limit 10;` (jeśli tabela istnieje)
- *prompt injection: narzędzie z mutacją bez potwierdzenia* — `rg -n -i "tools:|tool\(" src supabase/functions` i przejrzyj uprawnienia każdego narzędzia
- *PII w prompcie* — `rg -n -i "email|phone|telefon|address" <pliki AI>`
- *wektory bez filtra tenanta* — `rg -n -i "match_documents|similarity|<=>" src supabase`
- *zmiana modelu bez zestawu testowego* — `ls tests/ai* evals 2>/dev/null; rg -ln -i "eval|golden" tests`
- *stary klucz/bramka dostawcy* — `rg -n "ai\.gateway\.lovable|lovable\.dev" src supabase` (sprzężenie do wycofania)

**Audyt „czy się trzymamy".**
1. Czy wyjście LLM jest walidowane przed użyciem? → pierwsza komenda.
2. Czy model jest przypięty w jednym miejscu i dobrany do kroku? → druga komenda.
3. Czy jest cap kosztu per org, limit dla anonimów i wyłącznik? → trzecia komenda + `docs/RUNBOOK.md`.
4. Czy narzędzia mają minimalne uprawnienia, a mutacje potwierdzenie? → przegląd narzędzi.
5. Czy dane osobowe nie wychodzą do dostawcy bez potrzeby, a podprocesor jest wymieniony? → komenda PII + `docs/PRIVACY.md`.
6. Czy retrieval filtruje po tenancie? → komenda wektorów.
7. Czy istnieje zestaw przypadków testowych dla zmian promptu/modelu? → komenda eval.

**Nie potrzebujesz jeszcze.** Frameworków agentowych (LangChain itp.), fine-tuningu, osobnej bazy wektorowej, wieloagentowych architektur w produkcie, własnej platformy ewaluacji. Jakość samego wyszukiwania (chunking, model embeddingów, fuzja, recall ANN, ewaluacja) → 06 › RAG.

---

### RAG: chunking, embeddingi, fuzja i ewaluacja wyszukiwania

**Problem.** Zła odpowiedź asystenta zwykle bierze się ze złego kontekstu, a nie ze złego modelu. Typowe przyczyny: fragment pocięty w pół zdania, wektory z dwóch różnych modeli w jednej kolumnie, indeks ANN gubiący trafienia po filtrze tenanta, brak miary tego, czy właściwy fragment w ogóle trafił do kontekstu. Sygnały w diffie: tabela `documents`/`chunks`/`embeddings`, `vector(`, `<=>`, `hnsw`/`ivfflat`, funkcja `match_*`, `splitText`/`chunk`, zmiana modelu embeddingów, nowy reranker.

**Domyślnie u nas.**
- **Chunking:** tnij po strukturze (nagłówki, akapity, sekcje instrukcji, wiersze katalogu), nie co N znaków. Rozmiar ~300–800 tokenów, nakładanie ~10–15 % `[~]`. Krótki byt (karta części, wpis FAQ) to jeden chunk. Każdy chunk ma `document_id`, `chunk_index`, `content_hash` i ścieżkę nagłówków (kontekst doklejany do tekstu przed embeddingiem). Reingest obejmuje tylko dokumenty ze zmienionym hashem.
- **Wersjonowanie modelu embeddingów:** kolumna `embedding_model` (z wersją) przy wektorze, wymiar w typie `vector(N)`. Zapytanie embeduj TYM SAMYM modelem co korpus (u dostawców z `input_type` ustaw `query` dla zapytania i `document` dla korpusu). Zmiana modelu to expand → contract: nowa kolumna lub tabela, backfill w jobie (→ 04 › Zadania w tle), przełączenie odczytu flagą po ewaluacji, dopiero potem usunięcie starej. Wektorów z różnych modeli nigdy nie porównuj.
- **Fuzja hybrydowa + reranker:** FTS (`simple` + `unaccent`, → 06 › Wyszukiwanie) i wektor liczysz osobno i łączysz przez RRF (Reciprocal Rank Fusion: `score = Σ 1/(k + rank)`, k ~50–60 `[~]`). RRF łączy rangi, a nie surowe wyniki, więc nie trzeba normalizować skal. Wszystko w jednej funkcji SQL z filtrem `org_id` w obu gałęziach; kolumna `fts` budowana z `unaccent(content)`, a zapytanie też przez `unaccent` (bez tego „czesc" nie znajdzie „część" — sprawdzone na PG 17 z pgvector 0.8):
  `with f as (select id, row_number() over (order by s desc) r from (select id, ts_rank(fts, q) s from chunks, websearch_to_tsquery('simple', unaccent($1)) q where org_id=$2 and fts @@ q order by s desc limit 50) a), v as (select id, row_number() over (order by d) r from (select id, embedding <=> $3 d from chunks where org_id=$2 order by d limit 50) b) select id, sum(1.0/(60+r)) score from (select * from f union all select * from v) u group by id order by score desc limit 20;`
  Reranker (cross-encoder od dostawcy embeddingów) na top ~20–50 → top ~5 dodaje ~100–300 ms i koszt per zapytanie `[~]` `[NIEPEWNE: model i cena — sprawdź u dostawcy]`. Włączaj go dopiero wtedy, gdy ewaluacja pokaże zysk.
- **ANN ≠ 100 % recall:** HNSW/IVFFlat są przybliżone. `hnsw.ef_search` (domyślnie 40) wymienia recall na opóźnienie. Filtr `where org_id = …` działa PO przeszukaniu indeksu, więc mały tenant w dużej tabeli może dostać mniej niż `limit` wyników albo nic. Ratunek: iteracyjne skanowanie (`hnsw.iterative_scan` od pgvector 0.8 `[NIEPEWNE: wersja w projekcie — select extversion from pg_extension where extname='vector']`), większe `ef_search` albo indeks częściowy per duży tenant. Przy ~<50 tys. wektorów na tenanta `[~]` dokładny skan bez indeksu bywa wystarczająco szybki i daje 100 % recall. Zmierz to przed dodaniem HNSW.
- **Ewaluacja wyszukiwania (osobno od ewaluacji odpowiedzi):** ~30–100 par „pytanie → oczekiwany dokument/chunk" `[~]` z prawdziwych pytań klienta, metryki recall@k i MRR, skrypt w repo (`evals/retrieval.*`). Uruchamiaj przy każdej zmianie chunkingu, modelu, indeksu, fuzji lub rerankera; wynik zapisz w PR.
**Kiedy NIE:** korpus mieści się w prompcie (→ 06 › Funkcje AI); przy ~<kilkuset krótkich dokumentach wystarczy FTS + wstawienie całych dokumentów, bez wektorów.

| Wariant | Koszt operacyjny | Finansowy | Poznawczy |
|---|---|---|---|
| chunk stały co N znaków | zero | zero | niski; tnie w pół myśli, gorszy recall |
| chunk po strukturze + hash | parser formatu, reingest różnicowy | mniej embeddingów | średni |
| tylko wektor | pipeline embeddingów | embeddingi | średni; słabe na numerach części i nazwach własnych |
| hybryda FTS + wektor (RRF) | jedna funkcja SQL, dwa indeksy | zero ponad embeddingi | średni |
| + reranker | dodatkowe wywołanie API, timeout | per zapytanie | średni |
| dokładny skan vs HNSW | HNSW: pamięć, czas budowy, strojenie `ef_search` | zero | niski vs średni |

**Awarie i detekcja.**
- *wektory z różnych modeli w jednej kolumnie / brak wersji modelu* — `select embedding_model, count(*) from <chunks> group by 1;` (błąd „column does not exist" = finding); wymiar: `select format_type(atttypid, atttypmod) from pg_attribute where attrelid='<chunks>'::regclass and attname='embedding';`
- *zapytanie embedowane innym modelem/typem niż korpus* — `rg -n -i "embed\(|embeddings\.create|embedMany|input_?type|model: ?['\"].*(embed|voyage)" src supabase/functions`
- *duplikaty chunków, reingest wszystkiego* — `select document_id, count(*) n, count(distinct content_hash) u from <chunks> group by 1 having count(*) <> count(distinct content_hash) limit 10;`
- *chunki za duże/za małe* — `select percentile_cont(array[0.05,0.5,0.95]) within group (order by length(content)) from <chunks>;`
- *ANN gubi wyniki po filtrze tenanta* — porównaj id z zapytania wektorowego z wynikiem po `set enable_indexscan = off;` w tej samej sesji (różnica = utracony recall); `show hnsw.ef_search;`
- *brak fuzji (sam wektor na numerach i nazwach)* — `rg -n -i "rrf|reciprocal|ts_rank|websearch_to_tsquery" supabase/migrations src` (0 trafień przy istniejącym `<=>` = sam wektor)
- *brak ewaluacji wyszukiwania* — `ls evals 2>/dev/null; rg -ln -i "recall@|mrr|retrieval" tests evals 2>/dev/null`

**Audyt „czy się trzymamy".**
1. Czy każdy wektor ma zapisany model, a zapytanie używa tego samego modelu? → dwie pierwsze komendy.
2. Czy chunking jest strukturalny, ma `content_hash` i reingest różnicowy? → komenda duplikatów + odczyt kodu ingestii.
3. Czy wyszukiwanie łączy FTS i wektor (RRF) z filtrem `org_id` w obu gałęziach? → komenda fuzji + odczyt funkcji SQL.
4. Czy recall ANN po filtrze tenanta zmierzono (indeks vs dokładny skan)? → komenda ANN.
5. Czy istnieje zestaw ewaluacyjny wyszukiwania i wynik przy ostatniej zmianie? → komenda eval + opis PR.
6. Czy zmiana modelu embeddingów idzie przez expand → contract z backfillem w jobie? → `rg -n -i "embedding_model|backfill" supabase/migrations src`.

**Nie potrzebujesz jeszcze** (wariant → sygnał powrotu):
- reranker → ewaluacja pokazuje właściwy dokument w top-20, ale nie w top-5 (recall@20 wysoki, MRR niski).
- dedykowana baza wektorowa (Pinecone/Qdrant) → ~>kilka mln wektorów albo p95 wyszukiwania ~>200 ms po strojeniu HNSW i indeksach częściowych.
- przepisywanie zapytania LLM-em (query rewriting, HyDE) → ewaluacja pokazuje porażki na pytaniach potocznych, których nie naprawiła hybryda.
- GraphRAG, agentic retrieval, fine-tuning embeddingów → zmierzony sufit jakości po chunkingu, hybrydzie i rerankerze.
- osobny indeks per tenant → tenant z ~>10 % wektorów ma zmierzony zły recall mimo iteracyjnego skanu.

---

### Dokumenty, faktury i numeracja

**Problem.** Dokument wystawiony jest zapisem prawnym: musi być niezmienny, mieć ciągłą numerację i odtwarzalną treść z dnia wystawienia. Flota: faktury PDF w rental-app (`pdf-lib`) i marketplace-app (`generate-invoice-pdf`), faktura/VSK w shop-app, moduł KSeF w workshop-app (ADR-0003). Sygnały w diffie: nowa tabela faktur/umów/protokołów, `pdf-lib`/generator PDF, zmiana numeracji, zmiana stawek VAT, edycja wystawionego dokumentu.

**Domyślnie u nas.** Wystawienie = migawka danych (nabywca, adres, pozycje, stawki, kwoty) zapisana w dokumencie, nie referencje do mutowalnych rekordów; dokument i jego pozycje niezmienne (trigger blokujący UPDATE/DELETE także INSERT pozycji do wystawionego dokumentu); korekta = nowy dokument; numer z licznika per organizacja w transakcji wystawienia (→ 02 › Identyfikatory); PDF generowany deterministycznie z migawki (regenerowalny) albo zapisany w Storage jako wystawiony; kwoty i VAT jak w 02 › Pieniądze, czas; retencja prawna dokumentów zapisana `[NIEPEWNE: okres wg kraju — sprawdź]`. Standardowe fonty PDF (kodowanie WinAnsi) nie zawierają części polskich liter (ł, ą, ę…) — osadź font (rental-app używa `@pdf-lib/fontkit`). Integrację e-fakturowania (KSeF/inne) traktuj jak zależność zewnętrzną z kolejką i rekoncyliacją (→ 04, 05).
**Kiedy NIE:** wewnętrzne zestawienia i podglądy — mogą być regenerowane na żądanie, bez migawki i numeracji.

| Wariant | Koszt operacyjny | Finansowy | Poznawczy |
|---|---|---|---|
| `pdf-lib` z migawki danych | fonty, układ ręcznie | zero | średni |
| HTML → PDF (headless przeglądarka) | ciężki runtime, limity funkcji | płatny runtime | wysoki |
| zewnętrzny dostawca faktur/e-faktur | integracja, vendor | abonament/prowizja | średni — wygodny dla zgodności |

**Awarie i detekcja.**
- *edycja wystawionego dokumentu* — `select tgname, tgrelid::regclass from pg_trigger where not tgisinternal and tgrelid::regclass::text ~* 'invoice|faktur|document|contract' ;` (trigger niezmienności na dokumencie i na pozycjach)
- *luki/duplikaty numeracji* — `rg -n -i "nextval|sequence|counter|licznik" supabase/migrations src/migrations src/lib | rg -i "invoice|faktur|number"`
- *referencje zamiast migawki (zmiana nazwy klienta zmienia stary dokument)* — `rg -n "customer_id|client_id" supabase/migrations | rg -i "invoice|faktur"` i sprawdź, czy są kolumny z kopią nazwy/adresu
- *VAT/stawka w kodzie* — `rg -n "\* ?1\.2[0-9]|vat *= *[0-9]" src`
- *brak fontu z polskimi znakami* — `rg -n "StandardFonts|embedFont|fontkit" src`
- *brak kopii wystawionych PDF* — `rg -n -i "invoice.*storage|upload.*pdf|from\('invoices'\)" src supabase/functions`

**Audyt „czy się trzymamy".**
1. Czy wystawiony dokument i jego pozycje są niezmienne (UPDATE/DELETE/INSERT)? → trigger z awarii.
2. Czy numeracja jest ciągła per organizacja? → licznik i test dwóch równoległych wystawień.
3. Czy dokument przechowuje migawkę danych z dnia wystawienia? → przegląd schematu.
4. Czy korekta tworzy nowy dokument? → `rg -n -i "korekta|credit.?note|correction" src supabase`.
5. Czy PDF zawiera poprawne znaki PL/IS? → wygeneruj próbny dokument ze słowami „Łódź, Þórshöfn".
6. Czy retencja i odtwarzalność są opisane? → `docs/PRIVACY.md`/`RUNBOOK`.

**Nie potrzebujesz jeszcze.** Własnego silnika szablonów PDF z headless Chrome (dopóki `pdf-lib` wystarcza), archiwizacji PDF/A, podpisu kwalifikowanego, wielu walut/krajów w jednym dokumencie.

---

### Struktury probabilistyczne i konsensus — mapa na później

**Problem.** Kurs system design omawia Bloom filter, HyperLogLog, Count-Min Sketch i konsensus (Raft, Paxos, quorum, wybór lidera). To narzędzia na skalę miliardów zdarzeń i klastrów wielowęzłowych. U nas pojawiają się raczej jako pokusa („dodajmy Bloom filter") niż jako potrzeba. Karta istnieje, żeby decyzja „nie" była zapisana razem z sygnałem powrotu. Sygnały w diffie: zależność `bloom`/`hyperloglog`/moduł probabilistyczny Redisa, własna implementacja wyboru lidera, locka rozproszonego albo quorum.

**Domyślnie u nas.** Postgres robi to dokładnie i wystarczająco szybko przy 1–10 tys. użytkowników. „Czy już widzieliśmy X" → `UNIQUE` + `ON CONFLICT` (→ 05 › Idempotentność). „Ilu unikalnych" → `count(distinct …)` na widoku zmaterializowanym (→ 04 › Zdarzenia). „Top-K" → `group by … order by count(*) desc limit K` z indeksem. Percentyle → `percentile_cont`. Jeden lider albo jeden przebieg crona → `pg_try_advisory_lock` albo lease w tabeli (→ 05 › Współbieżność). Konsensus i replikację załatwia dostawca bazy zarządzanej; nie implementujemy ich i nie wybieramy NewSQL.
**Kiedy NIE (sygnały przejścia):** dopiero przy wolumenach, przy których dokładna odpowiedź jest za droga (lista niżej), i tylko gdy wynik przybliżony jest akceptowalny dla produktu.

| Wariant | Koszt operacyjny | Finansowy | Poznawczy |
|---|---|---|---|
| dokładnie w Postgresie (UNIQUE, count distinct, matview) | indeksy, odświeżanie widoków | zero | niski |
| HLL/Bloom jako rozszerzenie Postgresa | rozszerzenie do utrzymania `[NIEPEWNE: dostępność w Supabase]` | zero | średni |
| Redis z modułami probabilistycznymi | osobny magazyn | abonament | średni–wysoki |
| własny konsensus/lider (Raft, etcd, ZooKeeper) | klaster, quorum, split-brain | wysoki | bardzo wysoki — nie |

**Awarie i detekcja.**
- *ręczny lock/lider zamiast narzędzia bazy* — `rg -n -i "setnx|redlock|leader|election|zookeeper|etcd|raft" src supabase/functions package.json`
- *struktura probabilistyczna bez nazwanego problemu* — `rg -n -i "bloom|hyperloglog|hll|count-?min|cuckoo|minhash" package.json src`; brak ADR = finding (dział product)
- *dokładne zliczanie naprawdę wolne (sygnał powrotu)* — `select calls, mean_exec_time, query from pg_stat_statements where query ~* 'count\(distinct' order by mean_exec_time desc limit 5;`

**Audyt „czy się trzymamy".**
1. Czy każda struktura przybliżona albo mechanizm konsensusu ma ADR ze zmierzonym problemem? → druga komenda + `rg -n -i "bloom|hll|raft|consensus" docs/adr`.
2. Czy locki i liderzy idą przez Postgres (advisory lock, lease), a nie przez własny kod? → pierwsza komenda.
3. Czy wolne `count(distinct)` ma najpierw widok zmaterializowany lub indeks? → trzecia komenda + `EXPLAIN`.

**Nie potrzebujesz jeszcze** (wariant → sygnał powrotu):
- HyperLogLog → unikalni liczeni po ~>10 mln wierszy, `count(distinct)` na widoku nadal ~>1 s, a błąd ~1–2 % jest akceptowalny.
- Bloom/Cuckoo filter → sprawdzanie przynależności w ~>100 mln elementów albo filtr przed drogim zewnętrznym wywołaniem przy ~>100 zapytań/s.
- Count-Min Sketch / top-K Space-Saving → strumień zdarzeń, którego nie zapisujemy w całości (analityka ~>1000 zdarzeń/s).
- t-digest / HDR histogram → percentyle opóźnień liczone na żywo z ~>mln próbek (zwykle robi to Sentry/APM).
- MinHash/LSH → deduplikacja prawie identycznych dokumentów w ~>mln dokumentów (do tego czasu: `content_hash` + trigramy).
- Raft/etcd/ZooKeeper/NewSQL → własny klaster wielowęzłowy z silną spójnością między regionami; przy bazie zarządzanej — nigdy.

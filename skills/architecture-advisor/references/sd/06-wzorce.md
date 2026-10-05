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

**Problem.** Flota ma kilka funkcji AI: czat i brief leadu na kamiljan.com (Vercel AI SDK + `@ai-sdk/anthropic`, model przypięty w kodzie), asystent warsztatowy w workshop-app (routing Haiku/Sonnet + embeddingi Voyage + pgvector), czat wsparcia w marketplace-app (wg `docs/ARCHITECTURE.md` przez bramkę Lovable; ADR-0002 przewiduje odejście — stan faktyczny do sprawdzenia w kodzie funkcji `support-chat`). LLM to zależność zewnętrzna (→ 05), kosztowna (→ 03 › Rate limiting), niedeterministyczna i podatna na wstrzyknięcia. Sygnały w diffie: `generateText/streamText/generateObject`, `anthropic(`, `model:`, nowy prompt, nowe narzędzie (tool use), nowa tabela embeddingów.

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
- *stary klucz/bramka dostawcy* — `rg -n "ai\.gateway\.lovable|lovable\.dev" src supabase` (marketplace-app: sprzężenie do wycofania)

**Audyt „czy się trzymamy".**
1. Czy wyjście LLM jest walidowane przed użyciem? → pierwsza komenda.
2. Czy model jest przypięty w jednym miejscu i dobrany do kroku? → druga komenda.
3. Czy jest cap kosztu per org, limit dla anonimów i wyłącznik? → trzecia komenda + `docs/RUNBOOK.md`.
4. Czy narzędzia mają minimalne uprawnienia, a mutacje potwierdzenie? → przegląd narzędzi.
5. Czy dane osobowe nie wychodzą do dostawcy bez potrzeby, a podprocesor jest wymieniony? → komenda PII + `docs/PRIVACY.md`.
6. Czy retrieval filtruje po tenancie? → komenda wektorów.
7. Czy istnieje zestaw przypadków testowych dla zmian promptu/modelu? → komenda eval.

**Nie potrzebujesz jeszcze.** Frameworków agentowych (LangChain itp.), fine-tuningu, osobnej bazy wektorowej, wieloagentowych architektur w produkcie, własnej platformy ewaluacji.

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

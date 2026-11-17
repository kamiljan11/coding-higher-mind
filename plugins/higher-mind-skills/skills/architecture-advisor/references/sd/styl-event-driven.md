# Styl: architektura sterowana zdarzeniami (event-driven, EDA) — karta głęboka. U NAS: KOMPONENT („Postgres zamiast brokera”)

Źródła: kurs DevSteer lekcja 18 + notatka 38, style integracji (notatka 32), kwanty (notatka 29), analiza `98-M5`; martinfowler.com „What do you mean by Event-Driven?”, Microsoft Azure Architecture Center (event-driven, idempotent consumer, transactional outbox, saga, web-queue-worker), Richards „Software Architecture Patterns”. Parafraza; `[NIEPEWNE]` = brak otwartego źródła. Mechanika u nas: `04 › Zadania w tle i kolejki`, `04 › Webhooki przychodzące i wychodzące`, `04 › Zdarzenia, dzienniki i raporty`, `05 › Idempotentność i deduplikacja`.

## 1. Definicja i topologia
- System jako przepływ faktów biznesowych: producent publikuje, kanał przenosi, konsumenci reagują; producent nie zna odbiorców; push zamiast odpytywania.
- **Partycjonowanie: hybrydowe.** Topologia jest techniczna (kanały, kolejki, brokery), ale same zdarzenia są niemal zawsze domenowe (`ReservationConfirmed`). Przy dobrym modelowaniu domeny EDA daje korzyści bliższe podziałowi domenowemu, niż sugeruje etykieta w worksheecie (kurs T19). **Kwant:** asynchroniczność może rozdzielić kwanty, ale broker to zależność operacyjna, a wymóg „wynik przed następnym krokiem” przywraca oczekiwanie (N29).
- **Najpierw intencja:** KOMENDA (rozkaz do znanego wykonawcy, tryb rozkazujący, może zostać odrzucona) vs ZDARZENIE (fakt w czasie przeszłym, nieznani odbiorcy). Krok wymagany do ukończenia procesu pokazuj komendą albo stanem orkiestracji, nigdy ukrytym znaczeniem zdarzenia.
- **„Event-driven” to 4 różne rzeczy** (Fowler), każda wymaga osobnego uzasadnienia:
| Wzorzec | Co niesie | Koszt |
|---|---|---|
| event notification | id + minimum; odbiorca wraca po dane | niejawny przepływ logiki; zdarzenia jako zamaskowane komendy |
| event-carried state transfer | dane w zdarzeniu; odbiorca trzyma kopię | duplikacja danych, prywatność, kopie do utrzymania |
| event sourcing | zdarzenia = źródło prawdy, stan z replayu | ewolucja schematu, systemy zewnętrzne przy replayu — znacznie trudniejszy |
| CQRS | osobne modele zapisu i odczytu | złożoność; nie wymaga zdarzeń |
- Uzupełnienie ze slajdu lekcji 18: notification = dane minimalne, odbiorca **oddzwania** po resztę, złożoność niska; state transfer = dane pełne, bez oddzwaniania, średnia; event sourcing = dane pełne + historia, bez oddzwaniania, wysoka. Oddzwanianie to ukryte sprzężenie czasowe: przy notification producent musi być dostępny, gdy konsument przetwarza.
- **Topologia do celu** (produkt nie definiuje intencji): kolejka (jedna grupa dzieli pracę), pub-sub (każdy subskrybent dostaje kopię; klasyczny pub-sub nie przechowuje historii), trwały log / streaming (odbiorca kontroluje pozycję, replay; kolejność w partycji). **Broker** (rozgłaszanie, brak centralnego stanu procesu) vs **mediator** (centralny koordynator ze stanem i obsługą błędów, ryzyko wąskiego gardła) — Richards, MS.
- **Luźne sprzężenie ma 4 wymiary:** przestrzeń (czy producent zna adresata), czas (czy obie strony muszą działać naraz), liczność (dodasz odbiorcę bez zmiany producenta), **semantyka** (ile odbiorca musi wiedzieć o modelu i kolejności producenta). Można być luźnym przestrzennie i mocno sprzężonym semantycznie. Broker nie gwarantuje niezależności; najważniejszy kontrakt to **znaczenie faktu**.
- **Zdarzenie domenowe** (lokalne, bogate, wewnątrz modułu) vs **integracyjne** (stabilne, minimalne, dla odbiorców za granicą, publikowane po potwierdzeniu faktu). Nie publikuj zmiany wiersza: `ReservationRowUpdated` opisuje implementację, `ReservationConfirmed` opisuje fakt.

## 2. Kiedy TAK / kiedy NIE
**TAK (kurs T18, MS):** jedno zdarzenie dla wielu odbiorców; łatwe dokładanie reakcji (punkty lojalnościowe jako kolejny konsument); nierówne wolumeny i piki (kampania SMS/mail, promocja); integracja wielu niezależnych systemów; monitoring zmian stanu, IoT; efekt poboczny nie może blokować ścieżki użytkownika (przyjmij żądanie, resztę zrób w tle).
**NIE:** mała aplikacja, prosty CRUD, mało integracji, brak potrzeby reakcji w czasie zbliżonym do rzeczywistego (wykładowca nazywa to „formą nad treścią” i zaznacza, że to wniosek, nie reguła); wymagana silna spójność między częściami; zespół bez doświadczenia z asynchronicznością (MS).
**Koszty:** spójność ostateczna, kolejność, duplikaty, błędy w świecie async, trudna obserwowalność, logika nieliniowa, trudniejsze testy.
**Pytania wyboru (Messaging zamiast Direct Call, N32):** czy wołający potrzebuje wyniku od razu? jak stare dane są akceptowalne? co, gdy druga strona leży? czy potrzebna jedna transakcja? czy zespół utrzyma ten styl?
**Rachunek backlogu:** backlog rośnie o (napływ − przetwarzanie). 1000/s wejścia przy 700/s przetwarzania = +300/s, po 20 min ok. 360 tys. Mierz lag, wiek najstarszej wiadomości i biznesowy deadline wiadomości (kod 2FA po 10 min jest bezużyteczny). Autoscaling po długości kolejki bez limitu przeciąży bazę albo dostawcę.
**Heurystyka adopcji:** nie przenoś całego krytycznego procesu do choreografii. Zacznij od reakcji niekrytycznej (analityka, powiadomienie).

## 3. U nas (Supabase + Vercel) — EDA bez brokera
| Pojęcie | Odpowiednik we flocie |
|---|---|
| kolejka | tabela `background_jobs` + `FOR UPDATE SKIP LOCKED` + lease + `dead` (`04 › Zadania w tle i kolejki`) |
| outbox | insert do `background_jobs`/`notifications` w **tej samej RPC**, która zmienia stan (akapit „Dual write” w `04`) |
| inbox / idempotentny konsument | `processed_events` (PK `(provider, event_id)`, `insert … on conflict do nothing`), duplikat → 2xx bez efektu (`05 › Idempotentność i deduplikacja`) |
| pub-sub do UI | Supabase Realtime (`04 › Real-time`) — powiadomienie, nie źródło prawdy |
| zdarzenia z bazy | Database Webhooks / triggery + `pg_net` `[NIEPEWNE: gwarancje dostarczenia zależne od wersji]` — preferuj outbox w tabeli + worker |
| orkiestrator długiego procesu | maszyna stanów w tabeli + worker / n8n jako klej (`04 › Orkiestracja n8n i automatyzacje`), bez logiki domenowej w n8n |
| trwały log / Kafka / event sourcing | nie (audit log wystarcza; `04 › Zdarzenia, dzienniki i raporty`) |
Wzorzec domyślny: **krytyczny przepływ synchroniczny w jednej RPC, skutki poboczne zdarzeniowe** (mail, SMS, PDF, analityka, webhook do klienta).

Narzędzia nazywane na kursie (dla rozpoznania w cudzym repo, nie do wdrożenia u nas): pub-sub = AWS SNS, RabbitMQ fanout (bez historii); streaming = Kafka, Kinesis, Pulsar (trwały log, replay); outbox relay = worker albo CDC (Debezium); tracing = OpenTelemetry, Jaeger, Zipkin z jednym correlation id od wejścia (np. `POST /reservations`) przez wszystkie reakcje.

## 4. Reguły konstrukcyjne
1. **Gwarancje end-to-end na każdym przejściu:** publikacja (outbox) → transport → konsument → efekt → replay. „Exactly once” brokera nie obejmuje maila ani płatności. Semantyki: at-most-once (utrata), at-least-once (duplikaty), effectively-once = at-least-once + idempotencja.
2. **Outbox:** zmiana stanu i rekord z unikalnym `event_id` w jednej transakcji; osobny publisher wysyła i oznacza; ponowna publikacja jest możliwa, więc konsument zakłada at-least-once.
3. **Inbox:** webhook najpierw weryfikuje podpis dostawcy (HMAC na surowym body, porównanie `timingSafeEqual`, okno znacznika czasu ~5 min; `04 › Webhooki przychodzące i wychodzące`), dopiero potem zapis. W transakcji konsumenta zapis `(provider, event_id)` do `processed_events` z unikalnym ograniczeniem (klucz złożony: id zdarzenia jest unikalne tylko u jednego dostawcy); duplikat kończy się bez efektu; potwierdzenie (ack/2xx) po commicie. Klucz deduplikacji = `message_id`, nie `correlation_id`. TTL rekordów dłuższy niż okno ponowień (z ponownym wysłaniem z DLQ). Preferuj naturalną idempotencję (upsert, stan absolutny) — MS idempotent consumer.
4. **Efekt zewnętrzny** (płatność, mail, SMS) wymaga klucza idempotencji dostawcy albo jawnie przyjętych duplikatów i stanu wysyłki.
5. **Kolejność jest lokalna** (klucz podmiotu, np. rezerwacja). Retry i równoległość i tak ją zmieniają, więc handler zna **wersję encji**: zdarzenie starsze od stanu lokalnego pomija, z luką odkłada i dociąga stan. Przykład floty: webhook płatności `paid` przed `pending` nie może cofnąć statusu.
6. **Payload świadomie:** snapshot (łatwo naprawić lukę, kopiuje dane), delta (mała, wymaga kolejności), fakt z kontekstem (stabilne znaczenie). Prowizja = niezmienny fakt z kwotą z chwili decyzji; wyszukiwarka = aktualny snapshot. Do n8n/webhooka wysyłaj id + minimum (notification), chyba że odbiorca nie ma dostępu do źródła.
7. **Klasy błędów:** przejściowy → ograniczony retry z backoffem i jitterem; przeciążenie → backpressure; trwały kontraktowy → kwarantanna z przyczyną (nie kolejny retry); odmowa biznesowa → stan procesu; poison message → izolacja. **DLQ (u nas `dead`) ma właściciela, alert, instrukcję i kontrolowany replay.**
8. **Schemat ewoluuje expand → migrate → contract:** nowe pole opcjonalne; konsumenci tolerują obie postacie; usunięcie w jawnie nowej wersji. Nie zmieniaj po cichu jednostki, strefy czasu, waluty ani znaczenia pod tą samą nazwą. Minimalna koperta: `event_id`, `type` + wersja, id procesu, `correlation_id`, `causation_id`, czas wystąpienia, dane do samodzielnej interpretacji.
9. **Asynchroniczność widoczna w API/UX:** `202 Accepted` + id procesu + adres statusu (202 = przyjęte, nie sukces). Status biznesowy, nie techniczny: `accepted → processing → completed / rejected / compensation_required / manual_intervention`. Określ, kiedy wolno ponowić i co znaczy anulowanie w połowie.
10. **Długi proces = maszyna stanów z deadlinem i kompensacją;** kompensacja ≠ rollback. Orkiestracja ułatwia obserwację; choreografia łatwiej ukrywa cykle.
11. **Prywatność zdarzeń:** identyfikatory zamiast treści; retencja i miejsca powielenia (logi, retry, `dead`, projekcje); żadnych sekretów i danych wrażliwych w nagłówkach telemetrii (`05 › Dane osobowe, retencja i prywatność`).
12. **Karta kontraktu zdarzenia** (w `docs/ARCHITECTURE.md` przy pierwszym zdarzeniu integracyjnym): znaczenie faktu (kiedy zachodzi, czego dowodzi, czego nie obiecuje); producent i właściciel; id i unikalność; klucz kolejności; dane wymagane; dane wrażliwe i retencja; zgodność wersji; semantyka ponowienia; właściciel awarii i replayu.
13. **Correlation / causation / event id to trzy różne rzeczy:** grupuje przepływ / wskazuje bezpośrednią przyczynę / identyfikuje fakt.

## 5. Antywzorce → detekcja
| Antywzorzec | Komenda |
|---|---|
| dual write (stan i zdarzenie w dwóch wywołaniach) | `rg -n "from\('background_jobs'\)\|from\('notifications'\)" src supabase/functions` poza funkcją SQL |
| webhook bez weryfikacji podpisu (fałszywe zdarzenie płatności) | `rg -L "timingSafeEqual\|constructEvent\|verifySignature" -g '*webhook*' supabase/functions src/app/api` (plik na liście = finding; `04 › Webhooki`) |
| konsument bez idempotencji (podwójny mail, podwójne obciążenie) | `rg -n "processed_events\|idempotency" supabase/functions src/app/api`; webhook bez nich = finding |
| zdarzenie nazwane jak zmiana wiersza / komenda udająca zdarzenie | `rg -n "type:\s*['\"][A-Za-z]*(Updated\|Changed\|RowUpdated\|Do[A-Z]\|Send[A-Z])" src supabase` (przegląd trafień) |
| brak wersji encji przy złej kolejności | handler webhooka aktualizuje status bez warunku `where status in (...)`/`version <` — `rg -n "update\(\{ ?status" supabase/functions` |
| zdarzenie „zmiana statusu” zamiast faktu (`ReservationStatusChanged` — pojawia się nawet w przykładach kursu) | `rg -n "StatusChanged\|StateChanged" src supabase` → rozbij na fakty (`ReservationConfirmed`, `ReservationCancelled`) |
| `dead` bez właściciela i alertu | `select type, count(*), min(run_after), max(attempts) from background_jobs where status='dead' group by 1;` + czy jest alert |
| brak korelacji w logach | `rg -n "correlation_id\|request_id\|trace" supabase/functions \| wc -l` (0 = finding) |
| jeden wielki konsument sterujący wszystkim | worker z `switch (job.type)` > ~10 gałęzi z logiką domenową w środku |
| broker jako wolniejsze RPC | zdarzenie, na którego wynik producent czeka (polling statusu w tej samej żądanej ścieżce) |
| mylenie EDA z event sourcingiem | propozycja „przechowujmy wszystko jako zdarzenia” bez wymogu audytu/odtwarzania = „nie potrzebujesz jeszcze” |

## 6. Fitness functions i testy
- „To samo zdarzenie 2× → jeden efekt” (test istnieje w kartach PG; `05 › Idempotentność i deduplikacja`).
- Symulacja duplikatu, opóźnienia, złej kolejności (`paid` przed `pending`) i niedostępności workera.
- Metryki: nieopublikowane rekordy outboxa i ich wiek; wiek najstarszego `queued`; liczba prób na zadanie (czy retry maskuje problem); liczba `dead`; czas powstania rezultatu biznesowego.
- Ćwiczenie replayu z `dead` (dziś ćwiczony jest restore, nie replay).
- Pilotaż ma próg sukcesu zapisany przed startem: **rezultat przetrwał awarię**, a nie „mamy N kolejek”.

## 7. Ewolucja
- **Adopcja:** reakcja niekrytyczna → outbox + idempotentny konsument → symulacja duplikatu i awarii → wiek kolejki w panelu/alercie → ćwiczenie replayu → dopiero procesy drogie w błędach.
- **Sygnały:** efekt poboczny blokuje ścieżkę → kolejka; wielu odbiorców tego samego faktu → pub-sub (Realtime/fan-out w workerze); niewidoczny proces wieloetapowy → orkiestrator ze stanem i terminami; backlog > deadline biznesowy → backpressure i limit producenta.
- **Kombinacje:** modulith + asynchroniczne skutki poboczne = jedna spójna architektura (to nasz domyślny układ). Mikroserwisy + EDA to popularna kombinacja dla responsywności, ale u nas nie dotyczy.
- **Broker zewnętrzny** (SQS/Pub/Sub/Kafka) dopiero przy sygnale z `03 › Drabina skalowania (kiedy wejść piętro wyżej)`; tabela Postgresa wystarcza długo.

## 8. Worksheet — jak czytać ten styl
Mocny: responsywność (przyjmij i przetwarzaj w tle), skalowanie i elastyczność (kolejka jako bufor pików), ewolucyjność (nowy konsument bez zmiany producenta), poziom abstrakcji i interoperacyjność. Słaby: prostota (logika nieliniowa), testowalność (kolejność, opóźnienia, powtórzenia), koszt (broker, retry, duplikaty), utrzymywalność średnia (przepływ rozproszony po producentach i konsumentach). Odporność oznacza buforowanie, ponawianie i kontrolowaną degradację, nie niezniszczalność.

## 9. Stan w PG (zweryfikowany 2026-11-07)
- MAMY: kolejka w tabeli z lease, `dead`, backoff (`04`); dual write w jednej RPC (`04`, 2026-11-03); `processed_events` jako inbox (`04`, `agents/data-reviewer.md`); „exactly-once = at-least-once + dedup”; event sourcing/CQRS „nie potrzebujesz jeszcze”.
- CZĘŚCIOWO: statusy zadań techniczne (`queued/running/done/failed/dead`), bez statusu biznesowego i `manual_intervention`; alert na wiek kolejki tylko jako pytanie audytu.
- BRAK (kandydaci, ST8/ST9): konwencja nazw komenda/zdarzenie, karta kontraktu zdarzenia w szablonie `ARCHITECTURE.md`, `causation_id`, wersja encji przy złej kolejności jako reguła w `04 › Webhooki przychodzące i wychodzące`, rachunek backlogu przy kampaniach, `202` + adres statusu.

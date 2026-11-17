# Styl: mikroserwisy (microservices) — karta głęboka. U NAS: NIE (wartość audytowa)

Źródła: kurs DevSteer lekcja 17 + notatka 37, kwanty (notatka 29), analiza `98-M5`; martinfowler.com (Microservices 2014, MicroservicePremium, MicroservicePrerequisites, MonolithFirst, ConwaysLaw, StranglerFigApplication), Microsoft Azure Architecture Center (microservices, saga, BFF, strangler fig, idempotent consumer), microservices.io, Uber Engineering (DOMA), Segment/Twilio „Goodbye Microservices”, devclass o Prime Video (źródło wtórne). Parafraza; `[NIEPEWNE]` = brak otwartego źródła.

## 1. Definicja i topologia
- Wiele **niezależnie wdrażanych** jednostek, każda wokół zdolności biznesowej (zwykle bounded context), w osobnym procesie, z **własnymi danymi**; komunikacja siecią (HTTP/gRPC) lub asynchronicznie (Fowler/Lewis). Podział jest w deploymencie, nie tylko w kodzie.
- **Partycjonowanie: domenowe. Kwant: N** — ale tylko, gdy niezależność jest prawdziwa. Pięć usług z obowiązkowymi wywołaniami synchronicznymi to nadal jeden kwant (N29).
- Geneza: skalowanie **procesu wytwarzania** (setki/tysiące inżynierów), nie tylko instancji. Fowler: mikroserwisy to przede wszystkim narzędzie do strukturyzowania organizacji (prawo Conwaya).
- Elementy towarzyszące: API gateway (wejście, routing, polityki; **bez wiedzy domenowej**), BFF (API dla jednego klienta), service mesh (mechanika ruchu usługa-usługa), orkiestrator procesu (stan długiego procesu), platforma samoobsługowa („golden path”).

## 2. Test niezależności (7 warunków) — inaczej to rozproszony monolit
Usługa zasługuje na tę nazwę, gdy zespół: (1) zmienia i wydaje ją **bez wspólnego okna**, (2) utrzymuje kompatybilność kontraktu, (3) uruchamia i skaluje z własną konfiguracją, (4) **sam kontroluje zapis do swoich danych**, (5) odpowiada za SLO, (6) odpowiada za incydenty, (7) awaria ma ograniczony wpływ na inne zdolności. Wydanie A zawsze wymagające B i C = **rozproszony monolit**: granica sieciowa bez autonomii („monolit, tylko trudniejszy w debugowaniu”). Uber nazwał to „networked monoliths”.

## 3. Kiedy TAK / kiedy NIE
**TAK (kurs T17, Fowler, MS) — wszystkie warunki naraz:** wiele zespołów, które się wzajemnie blokują (okna wdrożeniowe, spotkania koordynacyjne, wydania raz na miesiąc); produkt zarabia i awarie kosztują; organizacja płaci za DevOps, chmurę, observability; wyraźnie różny profil skalowania części i potrzeba izolacji błędów; dojrzałe CD.
**Warunki wejścia Fowlera (prerequisites):** provisioning w godzinach, podstawowy monitoring, szybki pipeline. Brak = koszt budowy tych zdolności wchodzi w cenę decyzji.
**NIE:** brak product-market fit, nieznane granice, wymagania zmieniają się co tydzień; mały zespół, który spali energię na infrastrukturę; brak kultury DevOps; system po prostu prosty. Fowler („Microservice Premium”): stosuj tylko, gdy system jest zbyt złożony jako monolit, a domyślnie wybierz dobrze zmodularyzowany monolit.
**Każda korzyść ma warunek** (korzyść bez warunku = obietnica marketingowa): niezależne wdrożenia ← kompatybilne kontrakty i brak wspólnej bazy zapisu; niezależne skalowanie ← inny profil + pomiar; izolacja awarii ← brak obowiązkowych łańcuchów sync + grodzie; szybsza ewolucja ← małe kontrakty.
**Pytanie kontrolne:** nie „ile serwisów”, tylko „ile niezależnych produktów operacyjnych umiemy bezpiecznie posiadać”. Bezpiecznik floty: **liczba niezależnie wydawanych jednostek ≤ liczba osób, które je utrzymują** (`07 › Monolit modularny vs usługi`). Edge functions jednego repo, z jedną bazą i jednym potokiem wdrożenia, to części jednego kwantu ("monolit serverless"), nie osobne usługi. Bezpiecznik liczy jednostki z własnymi danymi albo własnym rytmem wydań. Wiele funkcji wdrażanych ręcznie to koszt operacyjny: napraw go automatycznym deployem w CI, nie scalaniem i nie podziałem. Przy 1–2 osobach + agentach temat jest zamknięty.
**Rachunek dostępności:** dostępności się mnożą, opóźnienia sumują. Cztery obowiązkowe hopy po 99,9% → ok. 99,6% ścieżki (kurs N37).

## 4. U nas (Supabase + Vercel) — gdzie to się naprawdę pojawia
Nie budujemy mikroserwisów. Ten styl pojawia się **przypadkiem** w repo klientów: wiele edge functions + flowy n8n + Vercel API, które piszą do tych samych tabel i wołają się nawzajem. To **mały rozproszony monolit**: koszty usług bez ich korzyści. Wartość tej karty jest audytowa (pkt 6).
| Element mikroserwisów | Co mamy zamiast |
|---|---|
| usługa z własną bazą | moduł `src/features/<x>` z właścicielem zapisu (`styl-modular-monolith.md`) |
| saga | RPC w jednej transakcji; proces wieloetapowy = maszyna stanów w tabeli + `background_jobs` |
| API gateway / BFF / mesh | Next.js route handlers / Server Actions — „nie potrzebujesz jeszcze” |
| osobny pipeline per usługa | jeden deploy Vercel + `supabase functions deploy` |

**Przykład z kursu (lekcja 17):** w Black Friday koszyk potrzebuje ok. 10 replik, wyszukiwarka kilku, a powiadomienia i raporty jednej — „płacisz za to, co przeciążone”. To argument dla skali z mierzonym, wyraźnie różnym profilem. Flota tego nie ma: Vercel i Supabase skalują żądania bez naszego udziału.
**System referencyjny kursu (demo C4, lekcja 24)** kończy się mikroserwisami: SPA → API gateway (Kong) → Keycloak, centralny serwis rezerwacji jako hub, każda integracja zewnętrzna za osobnym serwisem, wszystkie strzałki synchroniczne, bez brokera. Czytaj to jako ćwiczenie notacji, nie wzór: hub z synchronicznymi wywołaniami to dokładnie sygnał rozproszonego monolitu z pkt 6. Kurs dodaje, że mikroserwisy dają swobodę technologii per usługę, a monolit akceptuje wspólny cykl wydań (lekcja 27).

## 5. Reguły (gdy wydzielenie jednak zapada — ADR + `pozwol` na drzwi jednokierunkowe)
1. **Usługa = bounded context**, rozmiar mierzony zdolnością do samodzielnego życia, nie liczbą linii. Za drobny podział (Validator/Writer/Reader jako 3 deploye) jest równie zły jak `CoreService` ze wszystkim; sygnały: częste wywołania, wspólne wydania, transakcja rozcięta technicznie.
2. **Single writer:** tylko właściciel interpretuje i zmienia swój stan. Aktualna decyzja → sync API; częsty odczyt obcych danych → lokalna projekcja; zmiana w jednej granicy → lokalny ACID; proces przez wiele usług → saga z jawnymi stanami pośrednimi; raport przekrojowy → osobny model analityczny.
3. **Kompensacja nie cofa czasu:** zwrot to nowa operacja, która też może zawieść; proces trzyma stan i pozwala na ręczną naprawę (`manual_intervention`). Saga nie ma izolacji (lost update, dirty read), a kontrmiary to semantic lock, aktualizacje przemienne, ponowny odczyt (MS saga).
4. **Ścieżka synchroniczna z budżetem:** liczba obowiązkowych hopów, deadline całego żądania, budżet każdej zależności. Najlepsza odporność to często **usunięcie** zbędnego wywołania, nie kolejny retry.
5. **Niejednoznaczny wynik należy do API:** stany `accepted / rejected / pending / unknown` (timeout nie mówi, czy operacja się wykonała). Ważna komenda: stabilny klucz idempotencji (ten sam klucz z innymi parametrami = błąd), sprawdzenie wyniku po timeoucie, retry z backoffem i jitterem we **wspólnym budżecie**. Correlation id ≠ klucz idempotencji (pierwszy śledzi przepływ, drugi chroni efekt).
6. **Retry w jednej warstwie:** n8n retry węzła × klient 3× × ponowienia dostawcy = 27× ruchu. Ponawianie przypisz jednej warstwie (`05 › Zależności zewnętrzne: timeout, retry, wyłącznik`).
7. **Kontrakty przeżywają niezależne wdrożenia:** konsument toleruje nieznane pola; nowe pole najpierw opcjonalne; zmiana znaczenia = nowe pole; wycofanie z telemetrią użycia i terminem. Automat nie wykryje zmiany jednostki (grosze → złote).
8. **Awarie na granicy najpierw jako zachowanie biznesowe:** odrzucone przed wysłaniem (nie dotarło), timeout po wysłaniu (wynik nieznany), 429 (backoff), biznesowe 409 (nie ponawiać), częściowy sukces (saga/naprawa), duplikat (deduplikacja), usługa wolna przy zielonym health checku.
9. **Bezpieczeństwo:** tożsamość usługi i użytkownika (kto woła, w czyim imieniu), ponowna autoryzacja operacji wrażliwych, tokeny o minimalnym zakresie i krótkim życiu, prywatna sieć nie jest dowodem zaufania.
10. **Observability end-to-end:** SLI wyniku biznesowego obok SLO komponentów (każdy dashboard zielony, a klient nie kończy rezerwacji); p95/p99; stan sag i wiek najstarszego procesu; koszt na transakcję.
11. **Karta kandydata do wydzielenia:** problem nierozwiązywalny obecnie; zdolność i właściciel; kontrakty; dane do przeniesienia; transakcje przecinające granicę; konsumenci; profil obciążenia i SLO; tryby awarii; kto ma dyżur; koszt platformy i migracji; **mierzalna korzyść po 3 miesiącach**; plan wycofania lub ponownego scalenia.

## 6. Audyt „mały rozproszony monolit” (repo klienta) → detekcja
| Sygnał | Komenda |
|---|---|
| deployable'i więcej niż osób | `ls -d supabase/functions/*/ \| grep -v _shared \| wc -l`; `ls api/ app/api 2>/dev/null`; liczba aktywnych workflow n8n |
| funkcja woła funkcję | `rg -n "functions\.invoke\|/functions/v1/" supabase/functions src` (łańcuch >2 synchroniczne kroki = jedna jednostka awarii) |
| ≥2 funkcje/flowy piszą do tej samej tabeli | `rg -n -o "from\('([a-z_]+)'\)\.(insert\|update\|upsert\|delete)" supabase/functions \| awk -F"'" '{print $2}' \| sort \| uniq -c \| sort -rn` |
| wspólne wydania (release train) | `git log --since=90.days --name-only --format=%h -- supabase/functions \| awk -F/ '/functions\//{print $3}' \| sort -u` per commit: zawsze ≥2 funkcje naraz |
| kopiowany kod wspólny | `ls supabase/functions/_shared`; te same pliki w kilku funkcjach: `md5sum supabase/functions/*/*.ts \| sort \| uniq -w32 -d` |
| awaria jednej funkcji zatrzymuje ścieżkę | odczyt przepływu: czy ścieżka użytkownika ma ≥2 obowiązkowe wywołania sieciowe bez fallbacku |
| lokalne uruchomienie wymaga wszystkiego | `supabase functions serve` + n8n + Vercel naraz, żeby przetestować jedną funkcję |
Werdykt: im więcej sygnałów, tym mniej daje fizyczne rozproszenie. Naprawa zwykle = **scalenie** (funkcje w jedną, logika do RPC, kolejka zamiast łańcucha), nie dokładanie gatewaya.

## 7. Fitness functions (gdyby usługi istniały)
- Odsetek wdrożeń **bez** wydania innych jednostek; ostatnie 3 wdrożenia — wspólne czy nie (dowód niezależności kwantu, N29).
- Test kontraktowy konsumenta; budżet hopów jako test ścieżki krytycznej; fault injection (timeout, wolna odpowiedź, duplikat, brak odpowiedzi); chaos: wyłącz jedną usługę i patrz, co pada (MS).
- Brak wspólnego schematu zapisu między usługami.

## 8. Ewolucja
- **Do usług:** strangler fig — fasada kieruje część ruchu do nowej jednostki, stopniowo przejmuje funkcje, stara część jest wyłączana; uwaga na wspólne dane i fasadę jako SPOF (MS, Fowler). Kolejność: mierzalny problem → uporządkuj granice w monolicie → kontrakt i prawo zapisu → jeden konsument → małe kroki z dwiema wersjami → usuń stare ścieżki → porównaj lead time, awarie, koszt. Pierwszy kandydat: prosty i izolowany (powiadomienia, raporty).
- **Z usług z powrotem:** Segment scalił ponad 140 usług w jedną (narzut rósł liniowo z każdą integracją; wspólne biblioteki wymuszały deploy dziesiątek usług); świadomie przyjął słabszą izolację błędów. Prime Video (źródło wtórne) przeniósł narzędzie monitoringu z rozproszonych komponentów serverless do jednego procesu z redukcją kosztu infrastruktury o ponad 90%, ale komentatorzy zwracają uwagę, że to bardziej o cenniku Step Functions niż o stylu. Uber przy ok. 2200 usługach przeszedł do ok. 70 domen (DOMA), żeby odzyskać własność i tempo. To pojedyncze, retrospektywne przypadki, nie statystyka.
- **Macro first:** zacznij od większej granicy; łączenie jest tańsze niż rozplątywanie.

## 9. Worksheet — jak czytać ten styl
Mocny (przy dojrzałej implementacji): skalowanie i elastyczność dokładnie przeciążonego elementu, wdrażanie zmienionej usługi, ewolucyjność przy rosnącej liczbie zespołów, testowalność kontraktowa, interoperacyjność. Słaby: koszt (sieć, observability, wersjonowanie, bezpieczeństwo między usługami), prostota, **responsywność** (każdy synchroniczny hop to opóźnienie i ryzyko). Wysoka odporność zakłada circuit breakery, bulkheady, timeouty i ograniczenie sync; łańcuch A→B→C→D jest **mniej** odporny niż monolit. Usługa bywa tańsza dla sześciu zespołów, a droższa dla jednego.

## 10. Stan w PG (zweryfikowany 2026-11-07)
- MAMY: odrzucenie stylu z nazwaną przyczyną (`07 › Monolit modularny vs usługi`, one_way `microservices-monolith` w `pg/sd-areas.json`), komenda „funkcja woła funkcję” z werdyktem >2 kroków, timeout/retry/wyłącznik (`05`), klucz idempotencji i dedup (`05 › Idempotentność i deduplikacja`).
- CZĘŚCIOWO: karta kandydata = ADR z sygnałem powrotu (szablon ADR v2: TCO, odwracalność, fitness function), bez testu 7 warunków w audycie.
- BRAK: audyt „mały rozproszony monolit” jako procedura w trybie AUDIT (jest tylko tu, pkt 6 — ST6); stan `unknown` po timeoucie i reguła „ten sam klucz z innymi parametrami = błąd” w `05` (ST8); retry w jednej warstwie jako reguła (ST11).

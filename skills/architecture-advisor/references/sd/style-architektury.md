# Style architektury — mapa wyboru dla skali PG (słownik dla SELECT/EVOLVE/AUDIT)

**Problem.** Pytanie „jaka architektura?” zwykle zadajemy na poziomie komponentów (kolejka, cache, osobna funkcja). Pytanie o **styl** pada rzadziej: jaki kształt ma cały system, po czym go dzielimy i co ten kształt kupuje albo kosztuje. Bez nazwy stylu decyzje dryfują. Kilka edge functions wołających się nawzajem to przypadkowe mikroserwisy (rozproszony monolit), a `services/`, `controllers/` i `repositories/` to przypadkowy layered. Ten plik nazywa 8 stylów z worksheetu Richardsa/Forda (omówionego na kursie) plus pipeline, który u nas występuje naprawdę; cztery najczęstsze mają karty głębokie. Dla każdego mówi: co to jest, czy dotyczy floty i po czym go rozpoznać w repo.

Źródła: kurs DevSteer „Architekt Przyszłości” lekcje 15–19 (transkrypty 29/29 + każda **unikalna** klatka filmów obejrzana: 693 z 1999; pozostałe 1306 to duplikaty percepcyjne z nagrań ekranu dem, oznaczone `skip` z klatką źródłową; rejestr `~/Dane/devsteer-slajdy-v2/ledger.json`, `report` = KOMPLET, `--strict` = 1 przez te skipy), notatki 29/32/35–39 i analiza `98-M5` w `~/Obsidian/MAIN/Knowledge/DevSteer - Architekt Przyszłości/`; Microsoft Azure Architecture Center, martinfowler.com, microservices.io, Richards „Software Architecture Patterns”. Parafraza; `[NIEPEWNE]` = brak otwartego źródła. Atrybuty: `atrybuty-jakosci.md`. Decyzję o podziale na usługi podejmuje `07 › Monolit modularny vs usługi`, granice modułów `01 › Dekompozycja wewnątrz monolitu`. Ten plik ich nie dubluje.

## Karty głębokie (czytaj przed decyzją)
| Styl | Karta | Status u nas |
|---|---|---|
| layered | `styl-layered.md` | OK jako warstwy **wewnątrz** modułu; jako podział główny = antywzorzec |
| modular monolith | `styl-modular-monolith.md` | **DOMYŚLNY** |
| microservices | `styl-microservices.md` | **NIE**; wartość audytowa (mały rozproszony monolit w repo klientów) |
| event-driven | `styl-event-driven.md` | **KOMPONENT** („Postgres zamiast brokera”: outbox, `background_jobs`, `processed_events`) |
| pipeline | `styl-pipeline.md` | **W UŻYCIU** (n8n, wsady, `background_jobs` jako rura) |
| service-based | `styl-service-based.md` | **ŚCIEŻKA EWOLUCJI** (wejście tylko z nazwaną przyczyną z `07`) |
| microkernel | `styl-microkernel.md` | **NISZA** (jeden produkt, ≥ 3 klientów różniących się zachowaniem) |

Karty pipeline, service-based i microkernel (2026-11-07) powstały z researchu w sieci, nie z kursu: twierdzenia ze źródeł mają oznaczenie ([P] ≥ 2 źródła, [1] jedno), a nasze wnioski `[własny]`; werdykty w tabeli wyżej, mapowania „u nas” i stan PG to zawsze nasz wniosek.

Każda karta: definicja i topologia, warianty, kiedy TAK/NIE z progami, mapowanie na Supabase/Vercel, reguły konstrukcyjne, antywzorce z komendą detekcji, fitness functions, ewolucja, jak czytać worksheet, stan w PG. Krótkie sekcje wszystkich stylów są niżej; service-oriented i space-based mają tylko je (słabsze otwarte źródła, styl poza flotą).

## Dwie osie, zanim wybierzesz styl
1. **Partycjonowanie najwyższego poziomu.** *Techniczne* (katalogi = warstwy lub role: UI, logika, dane) albo *domenowe* (katalogi = obszary biznesu: zlecenia, klienci, faktury). Zmiana biznesowa w podziale technicznym dotyka każdej warstwy, w domenowym jednego katalogu. Heurystyka kursu (lekcja 6): następna typowa zmiana wymaga 1–2 modułów = dobre granice; 5+ = granice pracują przeciwko tobie.
2. **Kwant architektury.** Najmniejsza część systemu wdrażana niezależnie, z własnymi wymaganiami jakościowymi. Monolit z 20 modułami to jeden kwant. Kilka usług sprzężonych synchronicznie lub przez jedną bazę to nadal praktycznie jeden kwant, tylko z siecią w środku. Na diagramie kontenerów (C4) styl widać po liczbie kontenerów i schematów danych, nie modułów (lekcja 23). Liczba kwantów ≤ liczba osób utrzymujących (`07 › Monolit modularny vs usługi`).

## Partycjonowanie hybrydowe — tak budujemy (domenowo na zewnątrz, technicznie w środku)
- **Zewnętrzna granica = domena:** `src/features/<obszar>/` z jednym wejściem (`index.ts`), właścicielem zapisu i kartą modułu (`styl-modular-monolith.md`).
- **Wewnątrz modułu = role techniczne:** komponenty → akcja/przypadek użycia → czysta domena → adapter danych (`styl-layered.md`: warstwy jako szczegół modułu, nie podział główny).
- **Rzeczy przekrojowe = konwencja + bramka, nie moduł:** auth (RLS), logowanie, pieniądze/czas, i18n (`01 › Dekompozycja wewnątrz monolitu`).
- **Asynchroniczność = mechanizm techniczny niosący fakty domenowe:** kolejka w tabeli to technika, ale zdarzenie nazywa fakt biznesowy (`ReservationConfirmed`, nie `RowUpdated`). Kurs nazywa EDA wprost hybrydową: topologia techniczna, zdarzenia domenowe (lekcja 19).
- Weryfikacja: `node ~/.claude/bin/module-boundaries.js --repo . --report` (moduły domenowe vs techniczne, właściciele, wycieki wnętrza slice'a).

## Macierz

Kierunek ocen z **Architecture Styles Worksheet** (Richards/Ford), pokazanego i omówionego w lekcji 19 kursu (slajd obejrzany). Skala: `+` = 4–5 gwiazdek, `~` = 3, `−` = 1–2, `?` = nieczytelne na slajdzie (zasłonięte kamerą). Dokładne wartości są w prywatnej notatce kursu w Obsidianie, nie tutaj. **Oceny opisują typową implementację, nie dobrze utrzymany system.** To punkt wyjścia do rozmowy o kompromisach, nie wynik. Pipeline nie występuje na slajdzie kursu, więc jego wiersz to nasza ocena wariantu z rurą-kolejką (retry, DLQ: `~` zamiast `−`). Oceny pipeline ze streszczeń książki (elastyczność, skalowalność, odporność słabe) są w `styl-pipeline.md` › 9.

| Styl | Partycj. | Koszt | Prost. | Utrzym. | Test. | Wdraż. | Skal. | Elast. | Resp. | Odporn. | Ewol. | Abstr. | Interop. | Status u nas |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| layered | tech. | $ | + | − | − | − | − | − | ~ | − | − | − | − | warstwy w module: OK; podział główny: antywzorzec |
| modular monolith | dom. | $ | + | − | − | − | − | − | ~ | − | − | − | − | **DOMYŚLNY** (patrz korekta niżej) |
| microkernel | dom. | $ | + | ~ | ~ | ~ | − | − | ~ | − | ~ | ~ | ~ | **NISZA**: produkt dla wielu klientów z wariantami zachowania |
| microservices | dom. | $$$$$ | − | + | + | + | + | + | − | + | + | − | ~ | **NIE** |
| service-based | dom. | $$ | ~ | + | + | + | ~ | − | ~ | + | + | − | − | **ŚCIEŻKA EWOLUCJI** |
| service-oriented | tech. | $$$$ | − | − | − | − | ~ | ~ | − | ~ | − | + | + | **NIE** |
| event-driven | tech./hybr. | $$$ | − | ~ | − | ~ | + | ~ | + | + | + | ? | ? | **KOMPONENT** |
| space-based | tech. | $$$$ | − | ~ | − | ~ | + | + | + | ~ | ~ | ? | ? | **NIE** |
| pipeline (nasza ocena) | tech. | $ | + | ~ | + | ~ | ~ | ~ | ~ | ~ | ~ | ~ | ~ | **W UŻYCIU**: n8n, wsady, video-pipeline |

**Jak czytać (lekcja 19 + nasza skala):**
1. Kierunek, nie wynik: ocena mówi, gdzie styl **zwykle** jest mocny, a gdzie kosztowny. Przy każdej komórce pytaj „przy jakiej implementacji?”. Pięć gwiazdek odporności mikroserwisów zakłada timeouty, circuit breakery, bulkheady i fallbacki; łańcuch A→B→C→D jest mniej odporny niż monolit.
2. **Korekta modulithu:** wykładowca uważa jego oceny (utrzymywalność, testowalność, ewolucyjność) za zaniżone: brak problemów sieciowych i transakcji rozproszonych, prostsza diagnostyka, testy w jednym procesie bez contract testingu, kontrakty modułów dające dużą część ewolucyjności usług (opinia z kursu, nie pomiar). Warunek: dowody z `styl-modular-monolith.md` pkt 5.1. Bez nich ocena spada do layered.
3. **Koszt i prostotę płacisz codziennie, a plusy skalowalności dostajesz tylko przy skali,** której flota (1–10 tys. użytkowników, 1–2 maintainerów) nie ma. Dlatego kolumna „Status” różni się od najwyższej sumy gwiazdek. Etykiety kontekstu z kursu: layered = szybki start, modulith = kompromis (porządek domeny bez kosztu rozproszenia), mikroserwisy = wiele zespołów, EDA = reaktywność.
4. Myśl kombinacjami, nie jedną etykietą: modulith + asynchroniczne skutki poboczne = jedna spójna architektura (nasz domyślny układ). Kurs pokazuje też kombinację komendy sync → broker async → konsumenci + model odczytu aktualizowany zdarzeniami (CQRS) dla responsywności.
5. Pięć czynników kontekstu z kursu, zanim tabela coś rozstrzygnie: dojrzałość zespołu (doświadczenie ze stylem), cechy krytyczne biznesu, budżet (infra, narzędzia, czas), tempo zmian na produkcji, gotowość operacyjna (monitoring, CI/CD, incydenty).
6. Decyzję przesądzają scenariusze z liczbą (`atrybuty-jakosci.md`), serwetka (`capacity.md`), veto i profil wag z ADR (`templates/repo/docs/adr/0000-template.md`, krok 0; profile wag MVP / system finansowy: `templates/repo/docs/architecture/quality-attributes.md`).
7. Ten sam symptom (np. wolne wdrożenia) prowadzi przez skrzywienie „promonolitowe” albo „promikroserwisowe” do przeciwnych decyzji (lekcja 28). Najpierw nazwij swoje skrzywienie, potem czytaj tabelę.

## Style — co to, kiedy u nas, jak rozpoznać

### layered, modular monolith, microservices, event-driven
Karty głębokie w tabeli na górze. Szybkie rozpoznanie w repo:
- layered jako podział główny: `ls src | rg -x "controllers|services|repositories|models|dto|dao"`.
- modular monolith: `ls src/features` + `node ~/.claude/bin/module-boundaries.js --repo . --report`.
- przypadkowe mikroserwisy: `rg -n "functions\.invoke|/functions/v1/" supabase/functions` (łańcuch > 2 kroki = rozproszony monolit).
- event-driven: `rg -n "background_jobs|processed_events|pg_notify|\.channel\(|outbox" src supabase`.

### microkernel (rdzeń + pluginy)
Karta głęboka: `styl-microkernel.md`.
- **Co:** minimalny rdzeń (wspólny przepływ) plus niezależne pluginy z kontraktem rejestracji. Klasyczne przykłady: IDE, przeglądarki, silniki reguł.
- **Kiedy u nas:** jeden produkt sprzedawany wielu klientom, którzy różnią się regułami lub integracjami (np. warsztat A liczy VAT inaczej, warsztat B ma innego dostawcę części). **Najpierw dane, potem kod:** wariant, który klient edytuje sam, idzie do tabeli lub CMS (zasada „dane czy hardcode”). Plugin jako kod ma sens dopiero wtedy, gdy wariant to *zachowanie*, a nie *wartość*, i takich wariantów są co najmniej 3.
- **Rozpoznasz:** rejestr adapterów i jeden interfejs: `rg -n "register(Plugin|Adapter|Provider)|plugins?/|adapters?/" src`. Dobrze zrobiony = rdzeń nie importuje konkretnego pluginu (komenda dla układu `src/plugins/`: `styl-microkernel.md` › 6).
- **Pułapka:** system pluginów dla jednego wariantu („premature abstraction” w `SKILL.md`). Port/adapter dla dostawcy (płatności, SMS) to mini-microkernel i jest OK.

### pipeline (pipes & filters)
Karta głęboka: `styl-pipeline.md`.
- **Co:** sekwencja kroków (filtrów), każdy przyjmuje wejście i oddaje wyjście, bez wspólnego stanu.
- **Kiedy u nas:** automatyzacje n8n, przetwarzanie wsadowe (import CSV, generowanie PDF/wideo, ETL). Domyślny kształt dla przetwarzania danych.
- **Rozpoznasz:** kroki jako funkcje lub skrypty `01_*`, `02_*`, workflow n8n, `background_jobs` ze statusem kroku.
- **Pułapka:** krok bez idempotencji (restart w połowie dubluje efekt, `05 › Idempotentność i deduplikacja`) i logika biznesowa ukryta w węzłach n8n (`04 › Orkiestracja n8n i automatyzacje`).

### service-based (oparty na usługach)
Karta głęboka: `styl-service-based.md`.
- **Co:** kilka **gruboziarnistych** (literatura: 4–12, potwierdzone w `styl-service-based.md`; u nas 2–6) usług domenowych wdrażanych osobno, najczęściej **z jedną współdzieloną bazą** i jednym UI. Kompromis między monolitem a mikroserwisami. Daje izolację wdrożeń i awarii bez rozproszonych transakcji.
- **Kiedy u nas:** następny krok, gdy w monolicie pojawia się obszar z nazwaną przyczyną z `07 › Monolit modularny vs usługi` (inny profil skalowania lub kosztu, wymóg izolacji, inny runtime). Przykład: ciężkie generowanie (PDF/LLM/wideo) jako osobna usługa przy tej samej bazie Supabase. „Monolit + kilka funkcji brzegowych” w tym samym repo i potoku wdrożeń to nadal jeden kwant, a nie service-based (`styl-service-based.md` › 4). Service-based zaczyna się od pierwszej jednostki wdrażanej osobnym potokiem.
- **Rozpoznasz:** 2–6 jednostek wdrażanych osobnym potokiem, jedna baza, każda jednostka = jedna domena. `ls -d apps/*/ services/*/ 2>/dev/null` + osobne workflow deployu w `.github/workflows/`.
- **Pułapka:** wspólna baza bez właścicieli tabel, gdzie migracja jednej usługi psuje drugą. Każda tabela ma jednego właściciela i zmiany idą expand/contract (`02 › Model danych, constrainty i migracje`).

### service-oriented (SOA / ESB)
- **Co:** usługi korporacyjne wielokrotnego użytku, spięte szyną (ESB), która robi orkiestrację, transformacje i routing. Podział techniczny według roli usługi.
- **Kiedy u nas:** nigdy jako własny wybór. Spotkasz go u **klienta korporacyjnego** (integracja z jego szyną, SOAP, BizTalk, MuleSoft). Wtedy budujemy adapter na granicy (`05 › Uwierzytelnianie integracji`, `04 › Webhooki przychodzące i wychodzące`), a nie własną szynę.
- **Pułapka:** n8n jako „nasze ESB” z logiką biznesową w szynie (`04 › Orkiestracja n8n i automatyzacje`).

### space-based (oparty na przestrzeni danych)
- **Co:** wiele jednostek przetwarzania z replikowaną siatką danych w pamięci (data grid). Baza zapisywana asynchronicznie w tle. Cel: ekstremalne i nagłe skoki ruchu (bilety, aukcje, ticketing).
- **Kiedy u nas:** nie. Nagłe skoki ruchu obsługuje serverless + CDN + kolejka (`03 › Backpressure i zrzucanie obciążenia`, `03 › CDN, nagłówki i brzeg`). Do tego dochodzi „zapisuję, nie widzę” (spójność ostateczna) i drogi, trudny stos.
- **Pułapka:** brak, bo nie mamy go w ogóle. Sygnał powrotu: realny pik > ~100× średniego ruchu, którego CDN, cache i kolejka nie uniosą (pomiar, nie przeczucie).

## Ścieżka ewolucji floty (kolejność, nie cel)
1. **Modular monolith** (Lovable / Next + Supabase): domyślnie, z regułą importów od dnia 0.
2. **+ funkcje brzegowe i pipeline:** webhooki, cron, ciężkie zadania w `background_jobs`. Tu jest dziś większość floty.
3. **Microkernel w rdzeniu produktu**, gdy ten sam produkt idzie do ≥ 3 klientów z różnym *zachowaniem* (wartości → dane, zachowanie → adapter).
4. **Service-based**, gdy jedna domena ma nazwaną przyczynę wydzielenia (skalowanie, izolacja, runtime). Jedna baza, właściciele tabel, ADR z sygnałem powrotu.
5. **Microservices**: tylko przy kilku zespołach, każdy z własnym rytmem wdrożeń. Każdy krok wstecz jest tańszy niż każdy krok naprzód za wcześnie.

## Audyt „czy się trzymamy”
0. Najpierw automat (0 tokenów): `node ~/.claude/bin/arch-check.js --repo .` → sekcja „Sygnały zmiany stylu” (podział techniczny `src/`, łańcuch/cykl edge fn > 2 kroki, DECYZJA stylu bez mierzalnego sygnału) i liczba jednostek wdrażanych osobno. Ten sam skrót pokazuje się na starcie sesji jako `[ARCH-STYLE]`. Automat nie widzi danych spoza repo (liczba zespołów i klientów z wariantami, ruch produkcyjny): te progi z „Ścieżki ewolucji floty” sprawdzasz pytaniem albo metryką.
1. Czy styl repo jest nazwany? → `rg -n -i "modular monolith|monolit modularny|modularny monolit|monolit serverless|service-based|microkernel|pipeline|layered" docs/ARCHITECTURE.md docs/architecture/obszary.md docs/adr`. Kanoniczne miejsce = wiersz `microservices-monolith` w `obszary.md` (DECYZJA z sygnałem zmiany z liczbą). Brak trafień w tych trzech miejscach = styl przypadkowy.
2. Czy partycjonowanie najwyższego poziomu jest domenowe? → `ls src` (komenda z sekcji layered).
3. Czy liczba kwantów (jednostki z własnymi danymi albo własnym rytmem wydań; edge functions jednego repo i potoku = jeden kwant) ≤ liczba osób utrzymujących? → komenda z `07 › Monolit modularny vs usługi`.
4. Czy każde odejście od stylu domyślnego ma ADR z obecną przyczyną i sygnałem powrotu? → `rg -n -i "revisit|sygnał powrotu|wróć gdy" docs/adr`.
5. Czy system pluginów lub adapterów ma ≥ 3 realne warianty? → `rg -n "register(Plugin|Adapter|Provider)" src` i policz implementacje.

## Nie potrzebujesz jeszcze
Mikroserwisów, SOA/ESB, space-based i brokera zdarzeń jako stylu całości. Wróć do tej decyzji, gdy pojawi się drugi zespół z osobnym rytmem wdrożeń albo gdy zmierzony pik ruchu przekroczy to, co unosi serverless + CDN + kolejka.

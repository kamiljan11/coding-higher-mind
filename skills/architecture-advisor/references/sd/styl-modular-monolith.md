# Styl: monolit modularny (modular monolith / modulith) — karta głęboka. DOMYŚLNY STYL FLOTY

Źródła: kurs DevSteer lekcja 16 + notatka 36, kwanty (notatka 29), analiza `98-M5`; martinfowler.com (MonolithFirst, Microservices), microservices.io (monolithic), Shopify Engineering (Deconstructing the Monolith, Packwerk), Spring Modulith reference docs. Parafraza; `[NIEPEWNE]` = brak otwartego źródła. Karta decyzji podziału: `07 › Monolit modularny vs usługi`. Dekompozycja wewnątrz: `01 › Dekompozycja wewnątrz monolitu`.

## 1. Definicja i topologia
- **Jedna jednostka wdrożenia** (wiele instancji tego samego artefaktu nadal wydaje się razem), wewnątrz moduły ze spójną odpowiedzialnością, **małym publicznym API** i ukrytym wnętrzem. Operacyjnie jedna aplikacja, wewnętrznie zestaw komponentów.
- **Partycjonowanie: domenowe** (moduł = obszar biznesowy); warstwy techniczne wolno mieć dopiero w środku modułu. **Kwant: 1**: wiele modułów nadal tworzy jeden kwant (N29).
- Moduł opisują 4 wymiary, które muszą się wzmacniać: **semantyczny** (wspólny cel i język), **kodowy** (ukryte wnętrze, małe API), **danych** (jeden właściciel zapisu), **zmian** (typowa funkcja zmienia jeden moduł). Separacja kodu bez separacji danych jest pozorna.
- Shopify: celem jest, żeby programista „czuł, że pracuje w znacznie mniejszej aplikacji”. Moduły mogą być stanem docelowym na zawsze, nie tylko etapem przed usługami (kurs T16, N39).

## 2. Izolacja danych — skala (wybierz najniższy szczebel, który wystarcza)
| Szczebel | Co daje | Koszt / kiedy |
|---|---|---|
| wspólny schemat, konwencja „kto pisze” | zero konfiguracji, łatwe zapytania przekrojowe | łatwo rozmyć własność — **domyślnie u nas** + zapis właściciela w karcie modułu |
| schemat per moduł | widoczna granica w bazie | migracje i RLS per schemat; sygnał: >~30 tabel lub >~6 modułów `[NIEPEWNE: próg własny]` |
| rola/użytkownik bazy per moduł | twarda kontrola zapisu | PostgREST działa na rolach `anon`/`authenticated` — wymaga RPC `security definer` per moduł z pełną higieną (`set search_path = `, `revoke execute … from public, anon`, sprawdzenie `auth.uid()`/org w ciele); drogie |
| baza per moduł | pełna niezależność | to już krok ku usługom; u nas: nie |
„Jedna baza ≠ wspólne dane”: liczy się prawo do interpretacji i zapisu, nie obecność tabel w jednym silniku. Częste transakcje przekrojowe = sygnał złej granicy.

## 3. Kiedy TAK / kiedy NIE
**TAK (kurs T16, Fowler):** system przestaje być prosty i ma kilka wyraźnych obszarów biznesowych; mały/średni zespół bez budżetu na infrastrukturę rozproszoną; produkt intensywnie się zmienia i granice dopiero się kształtują (usługi utrwaliłyby błędy); potrzeba prostoty operacyjnej (jeden deploy, jeden monitoring, tanie testy integracyjne). Fowler: nie zaczynaj nowego projektu od mikroserwisów; „monolith first” działa tylko przy modularności i na poziomie API, i na poziomie danych.
**NIE / ograniczenia:** granice nie są wymuszone fizycznie (zależą od dyscypliny i bramek); skaluje się całość; wspólna baza rozmywa granice; łatwo o **pozór modularności**; moduł o skrajnie innym profilu zasobów (wsadowe PDF/LLM/wideo) — wtedy najpierw worker z kolejką, nie usługa.
**Zalecenie dla floty:** domyślny styl każdego nowego produktu. Wyjątki muszą mieć ADR (SKILL.md, tryb SELECT, krok „Name the architecture style before the stack”).

**Słabości z kursu (slajd lekcji 16), których nie widać w prozie:** współdzielony proces i zasoby, ryzyko ukrytych zależności, skalowanie całości, wspólne wdrożenie, **dłuższy czas buildów i testów** wraz ze wzrostem, **mniejsza niezależność zespołów**, **ograniczona swoboda technologiczna** (jeden runtime). Przy 1–2 maintainerach dwie ostatnie nie kosztują nic; pierwszą mierz (czas CI > ~10 min = sygnał do cache/podziału testów, nie do usług).

## 4. U nas (Supabase + Vercel)
| Pojęcie | Odpowiednik |
|---|---|
| moduł | `src/features/<obszar>/` (vertical slice), wejście = `index.ts` |
| publiczne API modułu | eksporty `index.ts`: komendy (Server Actions/RPC), zapytania zwracające **decyzje/widoki**, typy kontraktu |
| wnętrze | `features/<x>/{domain,internal,components}` — import z zewnątrz = naruszenie |
| właściciel zapisu | jedna RPC/akcja na tabelę modułu; inne moduły piszą tylko przez jego komendę |
| komunikacja „wynik potrzebny teraz” | bezpośrednie wywołanie publicznego API (in-process) |
| komunikacja „wiele niezależnych reakcji” | zdarzenie zapisane w tej samej transakcji: `background_jobs`/outbox (`04 › Zadania w tle i kolejki`) |
| rzeczy przekrojowe | `src/lib` (czyste funkcje), konwencja + bramki, nie moduł „shared” bez właściciela |
| osobno wdrażane | tylko to, co ma własny rytm: webhooki (edge fn), cron/worker, n8n jako klej |
Uwaga Supabase: każdy moduł widzi wszystkie tabele przez PostgREST, a RLS chroni per tenant, nie per moduł. Właściciela zapisu egzekwujemy konwencją + przeglądem (`code-reviewer`, `data-reviewer`), a twardo dopiero przy schemacie per moduł (tabela w pkt 2).

## 5. Reguły konstrukcyjne
1. **Minimalny test „czy to naprawdę modulith”** (6 dowodów, nie foldery): granice = odpowiedzialności (cel + właściciel); implementacja za kontraktem; graf zależności bez niedozwolonych krawędzi i cykli; do tabel modułu pisze tylko jego kod; jawny katalog kontraktów; reguły egzekwowane automatycznie. Brak dowodów = porządek plików, nie modularność.
2. **Trzy kontrakty:** komenda („zrób”, adresat może odmówić), zapytanie („podaj widok/decyzję”, nie ogólne `getCustomer`/`getAll`), zdarzenie („fakt zaszedł”, 0..n odbiorców). Nie wystawiaj encji domenowej. Dobre zapytanie zwraca **decyzję właściciela wiedzy** (np. `canBook: {allowed, reason}`), a nie surowe dane, które konsument zinterpretuje po swojemu i zdubluje regułę.
3. **Jeden publiczny kontrakt, reszta prywatna** (przykład kursu w C#: moduł `Orders/` z `Domain/ Application/ Infrastructure/ Api/`, wszystko `internal` poza jednym interfejsem `IOrdersModule`). Odpowiednik TS: jedyny eksport modułu to `features/orders/index.ts` (komendy, zapytania, typy kontraktu); TypeScript nie ma `internal`, więc prywatność egzekwuje `module-boundaries.js` (import wnętrza = wyciek), nie kompilator.
4. **Model per moduł:** „klient” w zamówieniach, płatnościach i powiadomieniach to różne modele; jeden wspólny puchnie i wiąże moduły. Ten sam termin w 2 modułach = 2 wpisy w `docs/GLOSSARY.md`. Kurs pokazuje, jak wspólny `User` puchnie z kilku pól do 50+ (dane płatności, wysyłki, lojalności, marketingu, uprawnień), z polami nullable i sprzecznymi walidacjami, aż staje się god objectem. Lekarstwo: każdy moduł ma lokalny model z tym, czego potrzebuje, a wspólny jest tylko identyfikator.
5. **Granice od decyzji, które muszą być spójne:** niezmienniki i transakcje razem; pliki zmieniane razem; jeden właściciel biznesowy; różne tempo i ryzyko (płatności vs raporty). Kandydata sprawdź na 3 scenariuszach: typowa zmiana, incydent, zmiana reguły biznesowej.
6. **Dostęp do cudzych danych:** bieżąca decyzja → zapytanie do właściciela; częsty odczyt przekrojowy → widok/projekcja **`create view … with (security_invoker = true)`** (bez tego widok działa z prawami właściciela i omija RLS tabel bazowych = odczyt cudzej organizacji; `02 › Multi-tenancy w danych`); analityka → osobny model; diagnostyka → odczyt audytowany. Kilka modułów piszących ten sam rekord → wskaż jednego właściciela.
7. **Transakcje lokalne to zaleta monolitu:** wynik drugiego modułu potrzebny przed decyzją → wywołanie w tej samej jednostce pracy (jedna RPC); reakcja dodatkowa → zdarzenie po zapisie; reakcja, która może zawieść → trwały outbox + osobna transakcja konsumenta. Zdarzenie in-process (EventEmitter) może zniknąć przy awarii, więc nie jest jedynym zabezpieczeniem ważnego efektu.
8. **Bez wewnętrznego HTTP „na zapas”**: sieć dodaje tryby awarii, a modelu nie wzmacnia. Edge function wołająca edge function = ukryty system rozproszony (`07 › Monolit modularny vs usługi`).
9. **Shared bez śmietnika:** stabilny kernel techniczny (Result, zegar, correlation id, formatowanie pieniędzy) vs pojęcia domenowe (mają właściciela, tłumaczy się je na granicy). Nie przenoś klasy do shared tylko dlatego, że użyły jej dwa moduły — jawna mała duplikacja bywa tańsza (kurs). Napięcie z regułą PG „ten sam bug w 2 miejscach → jeden util”: util tak, ale dla **technicznej** funkcji, nie dla pojęcia domenowego.
10. **Migracje expand → migrate → contract** z właścicielem modułu (`02 › Model danych, constrainty i migracje`).
11. **Grodzie we wspólnym procesie:** moduły dzielą CPU, pamięć i pulę połączeń, więc granica kodu nie izoluje awarii: limity współbieżności, kolejka dla drogich prac, budżety czasu, logi z nazwą modułu i przypadku użycia.
12. **Karta modułu** (w `docs/ARCHITECTURE.md`, tabela „Moduły i granice”): cel; czego NIE robi; publiczne komendy i zapytania; publikowane i konsumowane zdarzenia; tabele i **prawo zapisu**; dozwolone zależności; właściciel; testy granicy.

## 6. Antywzorce → detekcja
| Antywzorzec | Komenda |
|---|---|
| import wnętrza cudzego modułu | `node ~/.claude/bin/module-boundaries.js --repo . --report` (sekcja wycieków wnętrza slice'a); `rg -n "from ['\"]@/features/[a-z-]+/(internal\|domain\|components)/" src` |
| cykle między modułami | `module-boundaries.js` (nowy cykl = blokada pre-push) |
| zapis do cudzych tabel | `rg -n "from\('([a-z_]+)'\)\.(insert\|update\|upsert\|delete)" src/features -o \| sort \| uniq` → porównaj z kartą modułu (tabela ↔ właściciel) |
| shared jako magazyn | `ls src/shared src/common src/utils 2>/dev/null; rg -c "export" src/shared src/common 2>/dev/null` (rośnie bez właściciela = sygnał) |
| zmiana jednej funkcji dotyka wielu modułów | `module-boundaries.js --report` (Change amplification); `git log --name-only --since=90.days -- src/features \| awk -F/ '/features/{print $3}'` per commit |
| synchroniczny łańcuch modułów (zamówienia czekają na płatności, dostawę i powiadomienia) | przegląd Server Action: >2 wywołania innych modułów przed odpowiedzią = kandydat na zdarzenie |
| edge fn woła edge fn | `rg -n "functions\.invoke\|/functions/v1/" supabase/functions src` |
| fasada HTTP przed kodem na wspólnej bazie („wydzielenie” bez danych) | nowy katalog w `supabase/functions/` czytający te same tabele co `src/features/<x>` |

## 7. Fitness functions
- Test architektury na całym grafie (brak cykli, brak importów wnętrza, kierunek warstw): `module-boundaries.js`. Shopify robi to samo narzędziem Packwerk (zależności + prywatność + cykle, lista starych naruszeń „deprecated”: nowe blokuj, stare spłacaj). Spring Modulith ma `ApplicationModules.verify()`. Odpowiedniki JS: dependency-cruiser / eslint-plugin-boundaries `[NIEPEWNE: nie porównane z module-boundaries]`.
- Change amplification: typowa zmiana dotyka 1 modułu (raport `--report`).
- Nikt nie zapisuje cudzych danych: komenda z tabeli wyżej vs karta modułu.
- Piramida testów: model, przypadek użycia, **integracja modułu z prawdziwą bazą** (Supabase lokalnie), kontrakt producent-konsument, test architektury, kilka E2E. Mocki własnych repozytoriów = pozorna izolacja; test jednej reguły wymagający całej aplikacji = słaba granica.

## 8. Ewolucja
- **Do modulithu:** z layered (`styl-layered.md`, pkt 8), obszar po obszarze.
- **Z modulithu do usługi — tylko przy gotowości** (wszystko naraz): mały kontrakt zamiast wnętrza, jeden właściciel zapisu, znani konsumenci, brak częstych transakcji przez granicę, **mierzalnie** inny profil wdrożeń/skali/ryzyka, zespół przejmujący kod + dane + SLO + incydenty, plan migracji i powrotu. Wydzielaj **pionowo, z danymi** (strangler fig). Fasada HTTP przed kodem na wspólnej bazie dodaje hop i awarię, a niezależności nie daje. Fowler: dobry interfejs w procesie bywa złym interfejsem usługi.
- **Częstsza ścieżka u nas:** moduł o innym profilu zasobów → worker z kolejką (`background_jobs`), nie usługa.
- **Macro first:** przy słabych dowodach granicy wybierz większy moduł; łączenie jest tańsze niż rozplątywanie.

## 9. Worksheet — jak czytać ten styl
Mocny: prostota operacyjna, koszt, testowalność (testy w jednym procesie, bez contract testingu), wdrażanie (jeden pipeline). Słabszy: skalowanie i elastyczność (skaluje się całość), interoperacyjność. Wykładowca uważa typowe oceny ewolucyjności i utrzymywalności modulithu za zbyt pesymistyczne, bo kontrakty między modułami dają dużą część ewolucyjności usług (opinia, nie dane). Warunek wszystkich plusów: **pilnowane granice**. Bez nich ocena spada do layered.

## 10. Stan w PG (zweryfikowany 2026-11-07)
- MAMY: styl domyślny (SKILL.md, `07 › Monolit modularny vs usługi`), vertical slice + Parnas wewnątrz (`01 › Dekompozycja wewnątrz monolitu`), `module-boundaries.js` (cykle, warstwy, fan-in, wyciek wnętrza slice'a, `--report` z właścicielami), dual write w jednej RPC, `background_jobs` zamiast nowej usługi, expand→contract (R14).
- CZĘŚCIOWO: właściciel zapisu jako zasada jest w `01`, ale karta modułu w szablonie `ARCHITECTURE.md` nie ma kolumny „prawo zapisu” (ST5); reguła „zapytanie zwraca decyzję” tylko tutaj.
- BRAK: bramka „zapis do cudzej tabeli” (świadomie: observe → najpierw komenda audytu, blokada dopiero po incydencie).

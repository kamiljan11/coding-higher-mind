# Styl: service-based (oparty na usługach) — karta głęboka

Źródła (research 2026-11-07, parafraza; oreilly.com zwraca 403, więc treść książki znamy z fragmentów i notatek): Richards/Ford „Fundamentals of Software Architecture” rozdz. 13 (1. wyd.) / 14 (2. wyd.) przez notatki [the-evise.github.io](https://the-evise.github.io/fundamentals-of-software-architecture/chapter-14-service-based-architecture-style.html), [romerogabriel](https://romerogabriel.github.io/mastering-software-architecture/arch_styles/service_based_arch), [derekw](https://derekw.vercel.app/posts/architecture-service-based), [bagerbach](https://bagerbach.com/books/fundamentals-of-software-architecture/); Ford, InfoQ 2016 ([link](https://www.infoq.com/news/2016/10/service-based-architecture/)); Fowler „MonolithFirst” ([link](https://martinfowler.com/bliki/MonolithFirst.html)); Supabase [Secrets](https://supabase.com/docs/guides/functions/secrets) (sprawdzone 2026-11-07). Oznaczenia: **[P]** = potwierdzone w ≥ 2 niezależnych źródłach, **[1]** = jedno źródło, `[własny]` = nasz wniosek dla floty, bez źródła. Kurs DevSteer opisuje ten styl tylko w macierzy (lekcja 19, `style-architektury.md` › Macierz).

## 1. Definicja i topologia
- Styl **rozproszony, ale gruboziarnisty**: osobno wdrażane UI + kilka osobno wdrażanych usług domenowych + zwykle **jedna wspólna baza** [P]. Usługa = domena lub poddomena biznesowa (partycjonowanie domenowe) [P].
- Typowo **4–12 usług**, średnio ok. 7 [P dla zakresu, 1 dla średniej]. Ford (2016) mówi o 8–15 jednostkach na start migracji [1]. U nas: 2–6 `[własny]` (1–2 maintainerów; każda usługa = osobny pipeline, sekrety i monitoring).
- Usługa ma zwykle jedną instancję; więcej instancji dla skalowania lub odporności, wtedy load balancer UI → usługa [P]. Wewnątrz usługi: warstwy albo mały modulith [1].
- UI woła usługi zdalnie (REST/RPC/messaging), bezpośrednio albo przez opcjonalną warstwę API (gateway: bezpieczeństwo, metryki, audyt) [P]. Gateway nie zastępuje autoryzacji: **każda** usługa sama weryfikuje JWT użytkownika: tożsamość (`sub`) z tokenu, członkostwo w organizacji sprawdzone w bazie (claim w tokenie to tylko podpowiedź i bywa nieświeży), `org_id` nigdy z ciała żądania (`05 › Tożsamość i autoryzacja`) `[własny]`.
- **Baza — 3 warianty** [P]: (a) jedna wspólna; (b) wspólna, ale **logicznie podzielona** na partycje domenowe; (c) osobna baza na usługę. Wspólna baza daje joiny, prosty reporting i transakcje ACID, a kosztuje sprzężenie danych: zmiana schematu uderza w kilka usług [P].
- **Kwant:** 1 do wielu; wspólna baza ściąga usługi w jeden kwant na granicy danych [1]. U nas: wspólny Postgres Supabase + wspólne UI = realnie **1 kwant** z kilkoma jednostkami wdrożenia `[własny]` (zgodne z regułą kwantu w `07 › Monolit modularny vs usługi`).

## 2. Warianty
| Wariant | Co daje | Co kosztuje |
|---|---|---|
| jedno UI + wspólna baza (domyślny) [P] | najtańszy z rozproszonych, ACID w usłudze | sprzężenie przez schemat |
| wiele UI (web, mobile, admin) nad tymi samymi usługami [P] | osobne rytmy UI | kontrakty usług muszą obsłużyć kilku konsumentów |
| warstwa API / gateway [P] | jedno miejsce na auth, audyt, routing | kolejny element do utrzymania |
| baza podzielona na partycje + federacyjne biblioteki [P] | zmiana tabeli dotyka tylko usług tej partycji | dyscyplina własności tabel |
| hybryda: usługi domenowe + mikroserwis tam, gdzie domena naprawdę potrzebuje zwinności/odporności [1, Richards] | płacisz za mikroserwis tylko w jednym miejscu | dwa style do utrzymania |

## 3. Kiedy TAK / kiedy NIE
**TAK:**
- domena tnie się na **niewielki zbiór gruboziarnistych** obszarów i chcesz osobnych wdrożeń bez kosztu mikroserwisów [1];
- potrzebna spójność ACID w obrębie domeny [P];
- jeden obszar ma **nazwaną, obecną przyczynę** wydzielenia: inny profil zasobów lub kosztu (np. praca ponad limit funkcji, `04 › Zadania w tle i kolejki` › Twarde limity platform), wymóg izolacji, inny runtime, osobny rytm wdrożeń drugiego zespołu `[własny, zgodne z 07 › Monolit modularny vs usługi]`.
**NIE:**
- potrzebna wysoka elastyczność (elasticity: ocena 2/5) albo wysoka odporność każdej domeny [P];
- usługi musiałyby często się wołać (intensywne wywołania usługa → usługa = zły podział domen albo zły styl) [1];
- wspólna baza bez dyscypliny partycji [1];
- powód to „porządek w kodzie” — to rozwiązuje modulith, nie sieć `[własny]`.
**Koszt jednej usługi więcej** (lista bez liczb, źródła ich nie podają) `[własny]`: potok CI/CD, zestaw sekretów, health check z alertem, logi z nazwą usługi, wersjonowany kontrakt, rollback, aktualizacje zależności i CVE. Przy 1–2 maintainerach każda pozycja to stały czas co tydzień, stąd nasz limit 2–6.
**Fowler** zaleca start od monolitu i modularność API oraz danych od początku; jedną z dróg jest „kilka grubych usług, potem dzielenie” [1].
**Mierzalne sygnały:** liczba usług ≤ ~12 przy wspólnej bazie [P]; u nas wejście w styl = sygnał z `style-architektury.md` › Ścieżka ewolucji floty (2. zespół z osobnym rytmem wdrożeń albo moduł o innym profilu zasobów). Progi wielkości zespołu, tempa zmian schematu i liczby wywołań usługa → usługa: brak w źródłach.

## 4. U nas (Supabase + Vercel + n8n) `[własny]`
| Pojęcie | Odpowiednik we flocie |
|---|---|
| usługa domenowa | osobno wdrażany projekt: druga aplikacja Vercel, worker w kontenerze, osobny potok edge functions z własnym deployem |
| NIE jest usługą | kolejna edge function w tym samym repo i potoku (to ten sam kwant, `07`) |
| wspólna baza z partycjami | jeden projekt Supabase, **schemat Postgres na domenę** (`billing`, `booking`) jako granica własności; izolację tenantów i tak daje RLS (reguła 8) |
| federacyjne biblioteki encji | typy generowane per schemat (`supabase gen types --schema billing`), nie jeden `database.types.ts` dla wszystkich |
| orkiestracja | UI / route handler albo zdarzenie w `background_jobs`; nie usługa wołająca usługę |
| transakcja przez usługi | saga przez `background_jobs` + kompensacja (`styl-event-driven.md`) |

## 5. Reguły konstrukcyjne
1. **ACID w jednej usłudze, sagi między usługami** [P]. Proces wymagający transakcji przez 2 usługi = sygnał złej granicy; najpierw sprawdź, czy to nie jedna domena.
2. **Każda tabela ma jednego właściciela** (usługę); inne usługi czytają przez widok z `security_invoker = true` (bez tego widok działa z prawami właściciela i omija RLS, `02 › Multi-tenancy w danych`) lub przez API, nie piszą [P dla partycji, `[własny]` dla zakazu zapisu]. Zmiany schematu expand/contract (`02 › Model danych, constrainty i migracje`).
3. **Partycja `common`** (tabele wspólne, np. organizacje i użytkownicy) zmienia się tylko z koordynacją wszystkich usług [P].
4. **Jedna biblioteka encji dla wszystkich = najgorszy wariant** (zmiana tabeli wymusza redeploy wszystkich); biblioteki per partycja [P].
5. Usługi **nie wołają się nawzajem** albo robią to rzadko; orkiestracja w UI lub gatewayu [1]. U nas budżet hopów ten sam co dla funkcji: ≤ 2 (`styl-microservices.md`, arch-check `fn-chain`).
6. Kontrakt usługi wersjonowany; odpowiedź walidowana na granicy (zod, `pg/paradigm.md` › Parse, don't validate). Formalnych reguł kontraktów dla tego stylu źródła nie podają.
7. Każda usługa dostaje własne: pipeline, sekrety (`05 › Uwierzytelnianie integracji`), health check, logi z nazwą usługi, rollback (`07 › Strategie wdrożeń i rollback`). Bez tego to nie usługa, tylko kolejny ręczny deploy `[własny]`. Sekrety edge functions ustawia się na cały projekt Supabase, docs nie opisują zakresu per funkcja [1, Supabase docs › Secrets]. Osobne sekrety wymagają więc osobnej jednostki (Vercel, kontener) albo osobnego projektu. W repo Lovable push ≠ deploy edge functions.
8. **Schemat na domenę w Supabase** `[własny, zgodne z 02 i 07]`: przez API i tak działają role `anon`/`authenticated`/`service_role`, więc „grant dla roli domeny” niczego nie izoluje. RLS z `org_id` obejmuje każdą tabelę każdego schematu. Schemat wystawiasz w API tylko wtedy, gdy musi tam być, a wtedy grant dostaje `authenticated`, nigdy `anon`. Rola logowania domeny nie ma `BYPASSRLS` i nie jest właścicielem tabel (właściciel omija RLS bez `FORCE ROW LEVEL SECURITY`); dochodzi `alter default privileges`. `07 › Izolacja sieciowa bazy i najmniejsze uprawnienia` daje wzór grantów i `alter default privileges` dla roli tylko do odczytu; rola zapisu domeny dostaje analogicznie `insert/update/delete` tylko w swoim schemacie. Własność tabel poza grantami to konwencja pilnowana macierzą z pkt 6. Komendy detekcji z `02` mają na sztywno `public`, więc podmień w nich schemat.

## 6. Antywzorce → detekcja
| Antywzorzec | Komenda / heurystyka `[własny]` |
|---|---|
| gadatliwe usługi, ukryta orkiestracja [1] | `node ~/.claude/bin/arch-check.js --repo .` (sygnał `fn-chain`/`fn-cycle`) + `rg -n "functions/v1/\|fetch\(.*(https?://)?[a-z-]+\.(vercel\.app\|internal)" apps services supabase/functions` |
| wspólna baza bez partycji = ukryte sprzężenie [1] | macierz usługa × tabela: `for d in apps/* services/*; do echo "== $d"; rg -o --no-filename "from\(['\"][a-z_0-9]+['\"]\)\s*\.(insert\|update\|upsert\|delete)" "$d" 2>/dev/null \| sort -u; done` (tabela zapisywana przez > 1 usługę = naruszenie własności; łapie tylko zapis w jednej linii; łańcuch rozbity na linie (Prettier), `.schema().from()`, `rpc()` i surowy SQL sprawdzasz ręcznie albo przez `rg -U` z `\s*` między wywołaniami) |
| jedna biblioteka encji [P] | `rg -l "database\.types" apps services \| wc -l` przy jednym pliku typów dla wszystkich usług |
| pełzanie liczby usług [1] | `ls -d apps/*/ services/*/ 2>/dev/null \| wc -l` > 6 u nas (> ~12 w literaturze) |
| usługa bez przyczyny | ADR wydzielenia, którego sekcja „Kontekst” nie nazywa przyczyny z `07` (lista do przeglądu: `rg -l -i "wydziel\|usług" docs/adr`) |
| „mikroserwisy wszędzie” [1, Richards] | `styl-microservices.md` › Test niezależności |

## 7. Fitness functions `[własny]`
- Liczba jednostek wdrożenia ≤ 6 (test w CI na liście `apps/` i `services/`).
- Żadna usługa nie importuje z katalogu innej usługi: `module-boundaries.js` z blokiem JSON w `docs/ARCHITECTURE.md`.
- Macierz usługa × tabela vs plik własności w `docs/ARCHITECTURE.md`: zapis do cudzej tabeli = czerwone.
- Zmiana w schemacie `common` wymaga etykiety PR i przeglądu właścicieli wszystkich usług.
Źródła mówią tylko ogólnie: ograniczaj komunikację usługa → usługa, pilnuj sprzężenia bazy i wzrostu liczby usług [1].

## 8. Ewolucja
- **Modulith → service-based:** najpierw logiczna izolacja schematów i zakaz dostępu do cudzych tabel w monolicie, potem wydzielenie **jednej** domeny naraz, z nazwaną przyczyną [1, źródła wtórne] + ADR z polem `Przeglad` `[własny]`.
- **Service-based → mikroserwisy:** dopiero gdy konkretna domena potrzebuje niezależnego skalowania, odporności lub zwinności; domeny administracyjne zostają gruboziarniste [1, Richards]. Rozbicie wspólnego schematu to najtrudniejsza część tej drogi [1, Ford].
- Ford widzi ten styl jako **cel** migracji z monolitu, Richards jako **krok pośredni** [1 każdy]. Dla floty `[własny]`: to najdalszy krok ścieżki (`style-architektury.md` › Ścieżka ewolucji floty, „kolejność, nie cel”: nie idziemy tam bez sygnału), a dalej nie idziemy, bo mikroserwisy w regule = **NIE** (`style-architektury.md` › Macierz).

## 9. Worksheet — jak czytać ten styl (kierunek, nie wynik)
Oceny 1–5 ze źródeł wtórnych: wdrażalność 4, testowalność 4, odporność 4, koszt 4 (wysoka = tanio), prostota 3, skalowalność 3, elastyczność 2 [P]; ewolucyjność 3 (macierz kursu w `style-architektury.md` daje `+`: rozbieżność źródeł), modularność 4, wydajność 3, niezawodność 4 [1]. Oficjalnej tabeli z książki nie udało się pobrać (403); jedno słabe źródło podaje elastyczność 3. Czytaj: najtańszy i najprostszy z rozproszonych, dobry kompromis, ale **płacisz siecią i pipeline'ami**, czego przy 1–2 maintainerach nie odzyskasz bez nazwanej przyczyny.

## 10. Stan w PG (zweryfikowany 2026-11-07)
- MAMY: reguła wydzielenia z nazwaną przyczyną (`07 › Monolit modularny vs usługi`), sygnał wejścia w `style-architektury.md` › Ścieżka ewolucji floty i `style-eval.md` sc. 4, budżet hopów (arch-check `fn-chain`), expand/contract (`02`).
- CZĘŚCIOWO: własność tabel — tylko jako reguła w tej karcie; brak narzędzia macierzy usługa × tabela.
- BRAK (do rozważenia po pierwszym realnym wydzieleniu, nie blokada): fitness function liczby jednostek wdrożenia i własności tabel.

# Styl: architektura warstwowa (layered / n-tier) — karta głęboka

Źródła: kurs DevSteer „Architekt Przyszłości” lekcja 15 + notatka 35 (`~/Obsidian/MAIN/Knowledge/DevSteer - Architekt Przyszłości/`), analiza `98-M5`; Microsoft Azure Architecture Center (n-tier), Mark Richards „Software Architecture Patterns” (O'Reilly), InfoQ „Fitness functions”. Parafraza; `[NIEPEWNE]` = brak otwartego źródła. Indeks stylów i macierz: `style-architektury.md › Macierz`.

## 1. Definicja i topologia
- System dzielony **wg roli technicznej**, nie obszaru biznesowego: prezentacja → aplikacja (przypadki użycia) → domena → dane/infrastruktura. Wywołania idą w dół, wynik wraca tą samą drogą.
- **Layer ≠ tier.** Warstwa = granica logiczna w kodzie. Tier = granica fizyczna (proces, sieć, serwer). Każdy tier dokłada latencję, tryb awarii i wymagania bezpieczeństwa (MS n-tier, kurs N35). U nas: Next.js (Vercel) + Postgres (Supabase) to już 2 tiery. Edge function to kolejny.
- **Partycjonowanie: techniczne. Kwant: 1** (jeden deploy, jedna baza).
- Role warstw bez dogmatu: *presentation* (protokół, autoryzacja na brzegu, format wejścia), *application* (koordynacja przypadku użycia + **granica transakcji**), *domain* (pojęcia i niezmienniki bez HTTP/SQL), *infrastructure* (zapis, odczyt, integracje, bez decyzji biznesowych). Nie każda aplikacja potrzebuje wszystkich czterech. Nazwa katalogu nie dowodzi, co robi kod.

## 2. Warianty wewnątrz stylu
| Wariant | Co daje | Co kosztuje |
|---|---|---|
| warstwy **zamknięte** (wywołanie musi przejść przez następną) | izolacja zmian w warstwie, jedno miejsce egzekwowania reguł | „puste przekazywanie” (sinkhole) |
| warstwy **otwarte** (można ominąć) | krótsza ścieżka, mniej ceremonii | omijanie reguł; otwartą warstwę trzeba **oznaczyć**, inaczej każdy rozumie przepływ po swojemu |
| katalogi techniczne na górze (`controllers/ services/ repositories/`) | czytelny start | zmiana jednej funkcji biznesowej dotyka wszystkich katalogów |
| **moduły biznesowe na górze, warstwy w środku** | zasięg zmiany = jeden moduł | wymaga nazwania granic domenowych — to już krok ku `styl-modular-monolith.md` |

Fowler (cytowany w kursie): w większych systemach warstwy nie powinny być podziałem najwyższego poziomu.

## 3. Kiedy TAK / kiedy NIE
**TAK:** prosty lub średni system, mały zespół, panel admina / wewnętrzny CRUD, początek produktu, gdy domena jest nieznana (kurs T15). MS: wymagania jeszcze się zmieniają, mały próg wejścia. Richards: „solidny punkt startowy ogólnego przeznaczenia”.
**NIE / sygnały, że warstw jest za mało:**
- logika jednego obszaru rozrzucona po wielu katalogach (rezerwacje = kontroler + serwis + repo + model);
- „grube serwisy” zbierające całą logikę;
- różne obszary biznesowe mieszają się w tych samych serwisach i modelach;
- warstwy stają się formalnością (sinkhole);
- domena złożona z wieloma niezależnymi obszarami.
**Próg decyzji:** nie przechodź do usług, bo katalog `services/` urósł — rozproszenie zamienia niejasne odpowiedzialności w niejasne kontrakty sieciowe (N35). Najpierw sprawdź, czy problemem jest wdrożenie, brak modułów, czy za szerokie klasy.

**Priorytet sygnałów (slajd lekcji 15):** kluczowe = organizacja wg techniki i rozproszony kod domenowy; pułapka = przeładowana warstwa serwisów; ryzyko = słabe granice biznesowe; skutek przy skali = utrudniona ewolucja. W audycie zaczynaj od pierwszych dwóch.
**Przeskakiwanie warstw** (kontroler woła repozytorium z pominięciem serwisu) kurs pokazuje jako błąd w warstwach zamkniętych. U nas wyjątek jest jawny i jeden: ścieżka **odczytu** (pkt 5.3). Zapis zawsze przez przypadek użycia.

## 4. U nas (Supabase + Vercel / Lovable)
| Pojęcie kursu | Odpowiednik we flocie |
|---|---|
| presentation | `src/routes`/`app/` (Next.js), komponenty, Server Actions jako adapter wejścia |
| application + granica transakcji | Server Action / route handler wołający **jedną RPC** (transakcja w Postgresie, nie w kodzie JS) |
| domain | czyste funkcje w `src/lib` / `features/<x>/domain` (functional core, `pg/paradigm.md`) |
| autoryzacja | RLS + JWT użytkownika, nie osobna warstwa (karta `01 › Dekompozycja wewnątrz monolitu`) |
| infrastructure | klient Supabase, adaptery dostawców (`port + adapter`) |
Projekty Lovable to zwykle layered/feature-folders z `src/integrations/supabase/` — to akceptowalny start. PG robi warstwy lżej niż kurs (functional core zamiast portów wszędzie, RLS zamiast warstwy autoryzacji, RPC jako granica transakcji) i przy skali floty to dobry wybór (M5).

## 5. Reguły konstrukcyjne
1. Jedna rola na warstwę: kontroler bez reguł biznesowych, repozytorium nie steruje przypadkiem użycia, warstwa danych nie decyduje o procesie.
2. **Test sinkhole** dla każdego przejścia: jaką odpowiedzialność realizuje, jaką zmianę izoluje, jaką regułę egzekwuje? Odpowiedź „żadną” = nie twórz klasy dla wyglądu diagramu. Heurystyka Richardsa: ok. 20% żądań czysto przelotowych jest normalne, odwrotna proporcja = otwórz warstwy.
3. **Ścieżka odczytu może być otwarta** („mini-CQRS bez brokera”): lista = jedno zapytanie mapowane na model odpowiedzi, z autoryzacją (RLS), bez encji persystencji na zewnątrz. Przepychanie odczytu przez model domeny dla symetrii = sinkhole.
4. **Walidacja ma właścicieli:** składnia → adapter; kontrakt → granica API (zod); autoryzacja → RLS/polityka; niezmiennik → domena; reguła przekrojowa (np. max 3 rezerwacje) → przypadek użycia; unikalność → domena + constraint w bazie jako ostatnia obrona. Powtórzenie na dwóch poziomach bywa OK; dwie **niezależne interpretacje** tej samej reguły to błąd.
5. **Granica transakcji należy do przypadku użycia:** pobierz minimalny stan → reguły → zapis + zamiar publikacji (outbox) w tej samej transakcji → commit → **dopiero potem** efekty zewnętrzne. Nigdy transakcja trzymana na czas płatności/maila (`04 › Zadania w tle i kolejki`, akapit „Dual write”).
6. **Trzy kierunki „zależności”** zapisuj osobno: sterowanie (kto woła), kod (kto importuje czyje typy), dane/błędy. Odwrócenie zależności (port w domenie, adapter w infrastrukturze) nie łamie warstw.
7. Model domeny nie jest projektowany pod ORM ani wygenerowane typy Supabase.

## 6. Antywzorce → detekcja
| Antywzorzec | Komenda |
|---|---|
| logika biznesowa w handlerze/komponencie | `rg -n "supabase\.from\(.*\)\.(insert\|update\|delete)" src/app src/components src/routes` |
| gruby serwis „ze wszystkim” | `find src \( -name "*service*" -o -name "*Service*" \) -print0 \| xargs -0 wc -l \| sort -n \| tail` (>400 linii = kandydat) |
| warstwa niższa importuje wyższą | `node ~/.claude/bin/module-boundaries.js --repo .` (warstwy z bloku JSON w `docs/ARCHITECTURE.md`) |
| sinkhole: metoda tylko przekazuje wywołanie | `rg -n -U "async \w+\([^)]*\) \{\s*return (await )?this\.\w+\.\w+\([^)]*\);?\s*\}" src` (ręczny przegląd trafień) |
| transakcja na czas I/O | `rg -n "fetch\(\|stripe\.\|resend\." supabase/migrations` + przegląd RPC wołających `net.http_*` |
| typy infrastruktury wyciekają do domeny | `rg -n "@supabase/supabase-js\|Database\['public'\]" src/lib src/features/*/domain` |
| „idealnie nazwane katalogi i zły system” | change amplification: `node ~/.claude/bin/module-boundaries.js --repo . --report` |

## 7. Fitness functions (stała kontrola decyzji)
- Kierunek zależności i brak cykli: `module-boundaries.js` (pre-push; w CI szablonu `templates/repo` gdy repo ma blok JSON).
- Domena bez frameworka: ostatnia komenda z tabeli wyżej = 0 trafień.
- Testy: domena (niezmienniki), przypadek użycia (uprawnienia + transakcja na prawdziwej bazie), adapter wejścia (409 nie jako 500), jedna ścieżka krytyczna E2E. Same mocki warstw dowodzą tylko kolejności wywołań.

## 8. Ewolucja
- **Layered → modular monolith:** przestaw układ na moduły biznesowe z warstwami w środku, dodaj wejście modułu (`index.ts`) i regułę importów. Bez wielkiego przepisywania: jeden obszar na raz.
- **Layered → usługi bezpośrednio:** nie (patrz próg w pkt 3).
- Ścieżka floty: warstwy → moduły domenowe → modulith z właścicielem zapisu → (rzadko) wydzielenie zdolności z danymi. To nie obowiązkowa drabina.

## 9. Worksheet — jak czytać ten styl (kierunek, nie wynik)
Mocny: koszt, prostota, niski próg wejścia. Słaby: zwinność i ewolucyjność (zmiana procesu dotyka kontrolera, serwisu i repozytorium naraz), skalowanie i elastyczność (skaluje się całość), odporność (awaria istotnego elementu = całość). Po latach grozi „big ball of mud rozłożony na warstwy”. Oceny dotyczą przeciętnej implementacji, nie dobrze utrzymanej.

## 10. Stan w PG (zweryfikowany 2026-11-07)
- MAMY: koszt tieru i „funkcja woła funkcję” (`07 › Monolit modularny vs usługi`), granica transakcji w RPC, functional core (`pg/paradigm.md`), kierunek warstw w `module-boundaries.js`.
- CZĘŚCIOWO: closed/open — bramka zna tylko kierunek „w dół” (wszystkie warstwy de facto otwarte); tabela „kto co waliduje” tylko w tej karcie.
- BRAK (do rozważenia, nie blokada): bramka sinkhole (tylko komenda z pkt 6), szablon śladu przypadku użycia w `ARCHITECTURE.md` (ST12).

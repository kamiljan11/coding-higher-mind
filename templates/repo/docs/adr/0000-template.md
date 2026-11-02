# ADR-NNNN — [tytul decyzji]

Data: RRRR-MM-DD | Status: proponowane / przyjete / odrzucone / przestarzale / zastapione [czesciowo] przez ADR-XXXX | Zastepuje: ADR-YYYY [› czesc] (opcjonalnie) | Drzwi: jednokierunkowe / dwukierunkowe | Przeglad: RRRR-MM-DD

<!-- Kolejnosc = proces swiadomej decyzji: kontekst -> kryteria -> opcje -> wagi -> ryzyka -> decyzja -> wykonanie -> powrot do zalozen.
     1 ADR = 1 decyzja: dwa niezalezne wybory (np. baza + styl komunikacji) = dwa pliki. Cykl zycia: proponowane -> przyjete
     (zmien status w PR, ktory wdraza decyzje) albo odrzucone (plik zostaje z powodem); przestarzale = juz nie obowiazuje bez
     nastepcy; zastapione = link w obie strony (tu „zastapione przez”, u nastepcy „Zastepuje”); stary ADR-pakiet kilku decyzji:
     „zastapione czesciowo przez ADR-X” + u nastepcy „Zastepuje: ADR-Y › <ktora decyzja>”. Stary ADR nigdy nie znika z repo. -->

**Kontekst:** Jaki problem rozwiazujemy? Co istnialo wczesniej? Liczby z `docs/architecture/capacity.md`, jesli dotyczy.
Kontekst powstania (1 linia, zeby pozniej oceniac decyzje w tamtych warunkach): faza [prototype / mvp / produkcja] · zespol · ruch · priorytet.

**Kryteria:** 2-4 sily, ktore naprawde decyduja (np. "jedna osoba utrzymuje", "platnosci ISK"). Kazde kryterium = scenariusz
z liczba z `docs/architecture/quality-attributes.md` (nr), nie ogolnik.

**Macierz** (obowiazkowa dla drzwi jednokierunkowych i dla kazdej decyzji z >= 2 realnymi opcjami). Kroki: warianty (zawsze tez
"nic nie zmieniamy") -> kryteria z driverow (zostaw tylko te, ktore roznicuja opcje; kazde = scenariusz QA z liczba, gdy jest) ->
wagi w % (suma 100; zaleza od kontekstu — profil z `docs/architecture/quality-attributes.md`; wpisz je ZANIM ocenisz opcje, inaczej
wagi dopasowuja sie do faworyta) -> ocena 1-5, w KAZDEJ komorce z powodem (`4: retry juz sa, zespol zna technologie, infra dziala`; liczba bez powodu = komorka
pusta, ocena wymyslona) -> komentarze i ryzyka. Koszt = osobny wiersz, nie ukryty w sumie. Kryterium z waga 0 % usun z tabeli.

Profil wag: [MVP / regulowany (finanse, dane osobowe) / wlasny — 1 zdanie dlaczego]

| Kryterium (waga %) | A: nic nie zmieniamy | B: [nudny domyslny] | C: [...] | komentarz / ryzyko |
|---|---|---|---|---|
| Time-to-market ( %) | | | | |
| Prostota implementacji ( %) | | | | |
| Kompetencje zespolu (czy utrzymamy) ( %) | | | | |
| Skalowalnosc [QA nr] ( %) | | | | |
| Niezawodnosc [QA nr] ( %) | | | | |
| Spojnosc danych ( %) | | | | |
| Bezpieczenstwo ( %) | | | | |
| Zgodnosc regulacyjna / audytowalnosc ( %) | | | | |
| Koszt operacyjny (zl/mies + lock-in) ( %) | | | | |
| **Suma wazona (ocena x waga / 100, max 5)** | | | | |

**Ryzyka:** Co moze pojsc zle przy wybranej opcji i po czym to poznamy — ID w `docs/architecture/risks.md`.

**Decyzja:** Jedno zdanie bez „rozwazamy” / „byc moze”: „Uzywamy X do Y”. Co wybralismy? Ktoremu priorytetowi z `docs/ARCHITECTURE.md › Cel architektury` sluzy (nr) i czego kosztem?

**Rozwazone alternatywy:** Czemu odpada kazda odrzucona opcja z macierzy (1 zdanie na opcje)?

**Wykonanie:** najtanszy krok, ktory odpowiada na najwieksze ryzyko — spike (czy kierunek ma sens) / proof of concept (z kryterium
sukcesu) / kontrolowane obciazenie (realistyczne dane pod nadzorem) / canary (ograniczony ruch, szybki rollback, metryki). Rollback: jak cofnac.

**Konsekwencje:** Co to ulatwia? Jaki dlug wprowadza (wiersz w `docs/quality/BACKLOG.md`)?

**Koszt cykliczny:** [0 / kwota per miesiac + kto placi; nowa usluga chmurowa bez tej linii = ADR niekompletny, PRR P9]

**Pulapki dla przyszlego siebie:** 1-2 rzeczy, ktore maintainer musi wiedziec.

**Powrot do zalozen:**
- Sygnal powrotu: [mierzalny prog albo zdarzenie, po ktorym ta decyzja przestaje obowiazywac]; odroczone rzeczy -> `docs/architecture/roadmap.md › Jeszcze nie`.
- Przeglad skutkow (data w naglowku): latencja [cel], error rate [cel], koszt [cel], czy utrzymujemy to bez wysilku [tak/nie]. Wynik dopisz tutaj.

<!-- Drzwi dwukierunkowe: max ~20 linii, macierz tylko gdy sa >= 2 realne opcje. Drzwi jednokierunkowe (model danych, baza, auth,
     publiczne API, platnosci): pelna macierz, bez limitu linii. Usun wiersze-przyklady; pusta macierz = ADR niekompletny.
     Kopia idzie do Obsidian (Claude Memory). -->

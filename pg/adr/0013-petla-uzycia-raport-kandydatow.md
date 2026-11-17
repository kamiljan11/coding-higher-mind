# ADR-0013: Petla uzycia — tygodniowy raport kandydatow do zmiany regul

Data: 2026-11-15 | Status: proponowane (scalone w `feat/pg-integration` 2026-11-15; wejscie do `~/.claude` tylko za fraza uzytkownika dla pracy nad PG) | Przeglad: 2026-12-13

**Kontekst:** uzytkownik (2026-11-15): po domknieciu materialow z kursow system ma poprawiac sie z uzycia, nie z kolejnych
rund zbierania wiedzy, i ma byc tani w uzyciu. PG zapisuje juz dane o uzyciu (`logs/gates.jsonl`,
`logs/review-outcomes.jsonl`), ale nikt ich cyklicznie nie czyta pod katem „co usunac, co poluzowac, co zautomatyzowac”.
Log bramek rotuje po ok. 11 dniach, wiec okna 6 tygodni nie da sie policzyc bez wlasnej historii.

**Decyzja:**

| Problem | Mechanizm | Koszt uzycia | Odrzucona alternatywa (dlaczego) |
|---|---|---|---|
| Nikt nie czyta danych o uzyciu pod katem zmiany regul | sekcja „PETLA UZYCIA” w `hooks/guard_health.py` (istniejacy skrypt zdrowia; harmonogram: patrz „Warunek dzialania”), logika w `hooks/usage_loop.py`; najwyzej 5 kandydatow, kazdy z liczba i komenda dowodu | 0 tokenow, 0,03 s na 21 tys. zdarzen (pomiar 2026-11-15) | nowe zadanie cykliczne albo model w petli (koszt bez potrzeby: liczenie robi skrypt) |
| Progi beda korygowane po pierwszych tygodniach | `pg/usage-loop.json`: 10 liczb i lista bezpiecznikow jako dane (kod ma wartosci domyslne tylko na brak pliku albo zly wpis); zly wpis = wartosc domyslna + ostrzezenie w raporcie | 0 | progi w kodzie (kazda korekta = zmiana kodu i recenzja) |
| Okno 6 tygodni przy logu, ktory siega 11 dni | `logs/usage-loop.jsonl`: jedna migawka na tydzien (odpalenia per klucz reguly, dni z aktywnoscia) | ok. 3 KB na tydzien | wydluzenie retencji `gates.jsonl` (5 MB na ok. 11 dni; 6 tygodni = ok. 20 MB czytane przy kazdym przebiegu) |
| Nie widac, czy raport prowadzi do decyzji; ta sama propozycja wraca | `decisions` w `pg/usage-loop.json`: `{"<id kandydata>": "accepted\|rejected <data>: co zrobiono"}`; kandydat z decyzja znika, raport liczy przyjete / odrzucone; kandydat bez decyzji wraca co tydzien | 1 linia JSON na decyzje | wygaszanie po 2 raportach z pamiecia 12 migawek (zbudowane i usuniete po recenzji r3: nadmiar przy 0-5 pozycjach tygodniowo; `rejected` robi to samo jedna linia) |

Trzy ruchy: martwa regula (0 odpalen w 6 migawkach przy >= 20 dniach aktywnosci; bezpieczniki pominiete), glosna
bramka (git-hook obchodzony po blokadzie > 50 % przy n >= 10; recenzent z > 30 % nieprzydatnych przy n >= 10),
powtarzajacy sie finding (to samo `rule_id` naprawione >= 10 razy w 28 dni w >= 2 repo -> kandydat do `bin/pg-prechecks.js`).
Sekcja niczego nie blokuje, nie usuwa i nie zmienia RED/GREEN `guard_health`.

**Warunek dzialania (stan 2026-11-15):** zaplanowane zadanie `guard-health` jest wylaczone (ostatni przebieg 2026-10-14),
a zaden timer ani hook nie uruchamia `hooks/guard_health.py`. Bez cyklicznego uruchomienia migawki nie powstaja i raport
widzi tylko ten, kto odpali skrypt recznie. Decyzja wlasciciela (2026-11-15): cykliczne uruchamianie wlaczamy zaraz po
scaleniu tej galezi, razem z przegladem zadan tygodniowych; domyslnie timer systemd uzytkownika raz w tygodniu
(`python3 ~/.claude/hooks/guard_health.py`, 0 tokenow), a zadanie z sesja modelu tylko, gdy raport ma ktos opisac.
Sama galaz niczego nie wlacza; bez tego kroku miara z przegladu 2026-12-13 nie ma danych.

**Zapis decyzji:** w `pg/usage-loop.json`, klucz `decisions`: `"<id kandydata z raportu>": "accepted 2026-11-20: usunieto X"`;
pierwsze slowo to `accepted` albo `rejected`. Inne slowo = ostrzezenie w raporcie, wpisy `decisions` pominiete.

**Swiadome uproszczenia wzgledem projektu (`loop-design.md`):**
- prog „>= 20 sesji” liczony jako dni z aktywnoscia: `gates.jsonl` nie ma identyfikatora sesji poza wpisami prompt-guard;
- regula, ktora nigdy sie nie odpalila, nie ma klucza w logu i nie trafi na liste martwych (te pokrywa `bin/pg-eval.js`);
- ruch „incydent -> blizna” zostaje w `bin/pg-cases.js --stats`, bez duplikatu tutaj;
- licznik uzycia skilli (`bin/skill-usage.py`, ADR-0012) jest w repo od scalenia 2026-11-15, ale nie jest wolany z raportu (uruchamiany recznie; decyzja „wpiac albo usunac” na przegladzie 2026-12-13, ADR-0012);
  wpiecie po merge obu galezi, osobna mala zmiana.

**Pierwszy przebieg na realnych logach (2026-11-15, bez zapisu historii):** 8 kandydatow, pokazanych 5: bramka `LARGE_DIFF`
obchodzona po blokadzie 13/13; findings `FAILURE-PATH-UNTESTED` 36x w 14 repo, `SILENT-FALLBACK` 22x w 9, `ADR-NOT-WRITTEN`
21x w 9, `DATA-HARDCODED` 12x w 8. Martwe reguly: „za malo danych” do 7. migawki (ok. 2027-01-03).

**Koszt cykliczny:** <1 s i 0 tokenow na przebieg `guard_health`; czlowiek: do 5 pozycji tygodniowo. Utrzymanie: kontrakt z
formatem dwoch logow (test `bin/test_usage_loop.py` na fiksturach; zmiana formatu logu da puste listy, nie blad).

**Miara (przeglad 2026-12-13), liczona z linii „decyzje wlasciciela” raportu:** po 4 tygodniach co najmniej 1 wpis
`accepted` (regula usunieta, poluzowana albo awansowana do skryptu). 0 wpisow w `decisions` -> usunac sekcje. Udzial `rejected`
> 50 % przy n >= 6 decyzji -> korekta progow w `pg/usage-loop.json`. Martwe reguly wymagaja ciaglych migawek: dziura
ponad 10 dni miedzy migawkami (laptop wylaczony) daje „za malo danych”, nie liste.

**Wycofanie:** `git revert` commita; plik `logs/usage-loop.jsonl` mozna zostawic albo skasowac, nic go nie czyta poza ta sekcja.

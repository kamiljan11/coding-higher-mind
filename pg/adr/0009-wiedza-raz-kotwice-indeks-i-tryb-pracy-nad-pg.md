# ADR-0009: Wiedza raz w samym PG — kotwice liczb, generowany indeks właścicieli, pg-self-check

Data: 2026-10-19 | Status: przyjęte (uzytkownik 2026-10-19: „zbuduj system pracy z samym PG… żeby nie produkować krzaków”; „czy jesteś w stanie świadomie i autonomicznie zdecydować dla dobra całości procesu”)

**Kontekst:** PG wymagał od repo klientów Parnasa i „wiedzy raz”, ale sam to łamał. Przykłady z sesji 2026-10-18/19:
- reguła T3 `service_role` miała kopię w `bin/pg-merge-bezpieczny.py`;
- `CLAUDE.md:71` zgubił „200 użyć”;
- próg amplifikacji był sparafrazowany na 3 sposoby;
- zmiana nazwy `jobs` → `background_jobs` przeszła tylko przez część plików.

Wspólna przyczyna: decyzje zapadały na podstawie ręcznych streszczeń (CLAUDE.md, ref-*.md, migawka po kompakcji), a nie na podstawie źródła.
Recenzje r6–r9 tej zmiany znalazły kolejno 2 blokery i kilka must_fix. Recenzja r10 znalazła 0 blokerów.

**Decyzja:**

| Problem | Mechanizm | Odrzucona alternatywa (dlaczego) |
|---|---|---|
| Liczba w streszczeniu rozjeżdża się ze źródłem | kotwica `(src: ścieżka[#KLUCZ])` per twierdzenie + `bin/claims-check.py` (guard_health: `--min-anchors 3`) | usunąć liczby ze streszczeń (agent i tak potrzebuje ich w kontekście); dodać kotwice hurtem do 131 linii (duży diff bez incydentu; kotwice dokładamy przy edycji linii) |
| „Kto jest właścicielem tematu” z pamięci | `pg/INDEX.md` generowany przez `bin/pg-map.py` (wskaźnik, nie parafraza) | ręczny indeks (dryfuje tak samo jak streszczenia); biblioteka streszczeń (to drugi model, który overgeneralizuje) |
| Kontekst ginie przy kompakcji | migawka precompact: pliki PG z sesji z sha12 → przeczytaj ponownie | streszczenie treści plików w migawce (to znowu parafraza) |
| Poprawka u konsumenta, niepełna zmiana nazwy, test tylko z jednego cwd | `bin/pg-self-check.py` (exit 0/1/2), ręcznie przed commitem | hook pre-commit, który blokuje (zasada proporcjonalności: blokada dopiero po incydencie, ADR-0008 krok 7) |
| Agent nie wie, że pracuje nad PG | skill `pg-maintain` + trasa w prompt-guard (tylko podpowiedź) | bramka (fałszywe trafienia na „PG” = Postgres byłyby blokadą) |

**Świadomie przyjęte koszty:**
- `service[_-]?role` bez granicy słowa eskaluje też `microservice_roles` do T3. Wersja z lookbehindem gubiła `supabaseServiceRoleKey`, a było to w r7 jedynym blokerem bezpieczeństwa. Wolimy fałszywe T3 niż przepuszczony klucz.
- Eksport publiczny dostaje `pg/INDEX.md` przefiltrowany do wierszy plików, które są w eksporcie (`public_index`), oraz skill `pg-maintain`. Dzięki temu odsyłacze w GLOSSARY i prompt-guard nie są martwe. Zamknięto uwagę r10 ops.
- Liczniki w publicznym README (pliki, blizny, skille, rutyny) wpisuje sam eksport (`fill_counters`). Problemem jest tylko brak źródła liczby. Wcześniej był to ręczny wpis sprawdzany przez eksport: każda sesja, która dopisała bliznę w `pg/cases.md`, blokowała wydanie (r9–r11). Liczby nieliczone (linie, narzędzia, hooki) są jawnie opisane jako migawka 1.4.0.
- Router ma wyjątki dla Postgresa (`PG Admin`, `PG pool`/`PG-pool`, `PG bouncer`, `PG (Postgres`, `PG w .env`), każdy z testem negatywnym; `PG-owe`, `PG (hooki)`, `PG - …` mają testy pozytywne. Fraza „PG” bez kontekstu nadal trafia do `pg-maintain`. To świadomy wybór: pominięcie skilla przy pracy nad PG kosztuje więcej niż zbędna podpowiedź.

**Miara (pomiar 2026-11-03: kryterium 1 niepoliczalne, termin przeniesiony; nastepny przeglad 2026-12-01):**
1. Liczba blocker + must_fix w `pg-review` na commitach PG. Bazą jest seria r6–r9 (≥ 2 blokery) wobec r10 (0).
2. Liczba nowych wierszy w katalogu błędów `skills/pg-maintain`, których `pg-self-check` nie złapał.

Jeśli (1) nie spadnie, `pg-self-check` przechodzi do guard_health jako pomiar observe.

**Wynik pomiaru 2026-11-03 (decyzja agenta w ramach delegacji uzytkownika „decyduj autonomicznie dla dobra calosci systemu”; uzytkownik moze ja odwrocic):**
1. Kryterium (1) NIE jest policzalne: `logs/review-outcomes.jsonl` istnieje od 2026-11-01 (8d753bb), a baza r6–r10 jest z 2026-10-19.
   Klauzula eskalacji nie zostala ani wyzwolona, ani obalona. Dane po ADR: repo `.claude` = 5 przebiegow, 0 blocker/must_fix
   na poziomie decyzji (2 blokery findera przy agreement 1, oba `fixed`). Ale te same recenzje PG sa zapisane tez pod nazwami
   klonow: `pg-claude` (11 przebiegow, 26 must_fix) i `claude` (19 przebiegow, 11 must_fix). Filtr po samym `.claude` zaniza wynik.
2. Kryterium (2): 3 nowe wiersze katalogu od 2026-10-19 (0bb34f1 telemetria do klonu, 86f2d90/d281b40 prywatna sciezka w eksporcie,
   f2c0b48 regula pod jeden incydent). Zaden nie zostal zlapany przez `pg-self-check` przed wejsciem; 1 (eksport) zamieniony tego
   samego dnia na detektor w `pg-self-check`.
3. Decyzja: `pg-self-check` zostaje reczny (brak danych za eskalacja). Nastepny pomiar liczy (1) z `review-outcomes.jsonl` dla
   repo {`.claude`, `claude`, `pg-claude`} razem, z deduplikacja po `run` (ta sama recenzja zapisana pod kilkoma nazwami liczy sie raz),
   okno 2026-11-01 .. 2026-12-01, porownanie miesiac do miesiaca. Prog dla (2): >= 2 nowe wiersze katalogu w miesiacu, ktorych
   `pg-self-check` nie zlapal -> `pg-self-check` przechodzi do guard_health jako pomiar observe (klauzula wyzej).
   Nastepny przeglad 2026-12-01.

**Aktualizacja 2026-10-24 (1 ADR = 1 decyzja):** ten ADR to PAKIET 5 decyzji z jednej retro, spisany przed regula z szablonu (`templates/repo/docs/adr/0000-template.md`). Nie rozbijamy go wstecz (historia i odsylacze zostaja). Zmiana albo wycofanie ktoregokolwiek mechanizmu = NOWY ADR z linia `Zastepuje: ADR-0009 › <mechanizm>`, a tu dopisek `zastapione czesciowo przez ADR-XXXX`.

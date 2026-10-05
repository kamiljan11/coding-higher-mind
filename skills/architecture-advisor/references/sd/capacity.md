# Pojemność i opóźnienia „na serwetce"

Cel: w ~10 minut, przed budową, odpowiedzieć „czy to w ogóle będzie boleć i gdzie najpierw". Wynik trafia do mini-designu (`pg/design.md` B+, punkt „Pojemność"). Uczciwość liczb: wejścia są ZAŁOŻENIAMI (nazwane, do korekty przez klienta); stałe z tabeli to rzędy wielkości (`~`), nie benchmarki; limity konkretnych planów platform to `[NIEPEWNE]` do sprawdzenia w panelu/docs. Liczba bez źródła w wyniku = oznacz.

## 1. Rzędy wielkości opóźnień (do oceny, mierz u siebie)

| Operacja | ~Czas | Wniosek |
|---|---|---|
| odczyt z pamięci procesu | ~100 ns | cache w procesie jest o rzędy tańszy niż skok sieciowy |
| losowy odczyt z SSD | ~100 µs | dysk nie jest wąskim gardłem prostych zapytań |
| round trip w jednym centrum danych | ~0,5 ms | koszt każdego wywołania funkcja→baza w tym samym regionie |
| nowe połączenie TCP + TLS 1.3 | ~2 round tripy | reużywaj połączenia (pooler, keep-alive) |
| round trip między regionami w Europie | ~10–50 ms `[zmierz]` | sekwencyjne wywołania sumują się |
| round trip przez ocean | ~100–150 ms | zapis synchroniczny przez ocean to 100+ ms za każdym razem |
| zapytanie po indeksie (mała/średnia tabela) | ~1 ms + RTT | zapytanie bez indeksu rośnie liniowo z tabelą |

Wniosek stały: w naszych aplikacjach liczy się liczba SEKWENCYJNYCH round tripów, nie moc obliczeniowa. Dla użytkownika w Islandii i bazy w regionie kontynentalnym każdy skok przeglądarka→baza kosztuje dziesiątki ms — przykład w §3.

## 2. Procedura (6 kroków)

1. **Zakres i założenia.** Użytkownicy rejestrowani → DAU (aktywni dziennie) → akcje na DAU na dzień → które to zapisy, które odczyty. Kto płaci rachunek za wzrost? Każde założenie nazwane „ZAŁOŻENIE" z prośbą o korektę klienta.
2. **QPS.** Średni = żądania na dobę / 86 400. Szczyt = średni × mnożnik szczytu (ZAŁOŻENIE z uzasadnieniem, np. godziny pracy warsztatu: ~10–20× `[~]`). Rozdziel odczyty i zapisy; policz zapytania do bazy na żądanie (to jest często 3–10).
3. **Współbieżność (wzór Little'a).** Równoległe żądania ≈ QPS szczytowy × średni czas obsługi (s). To liczba do porównania z limitem połączeń do bazy i poolera.
4. **Storage.** rozmiar rekordu × rekordów/dzień × 365 (× lata); pliki/media osobno (Storage, nie wiersze); narzut indeksów zmierz po pierwszych realnych danych `[NIEPEWNE: mnożnik]`. Rosnące tabele zdarzeń: retencja albo partycjonowanie dopiero po pomiarze.
5. **Transfer.** odpowiedzi API × QPS; strony × waga; pliki × liczba odsłon. Egress jest płatny i bywa największą pozycją przy zdjęciach/wideo — sprawdź pakiet planu `[NIEPEWNE]`.
6. **Koszt zmienny.** wywołania LLM × tokeny × cena, SMS × cena, maile × cena — w skali miesiąca i w scenariuszu nadużycia (bez capa). Ceny dostawców `[NIEPEWNE: sprawdź cennik]`.
Werdykt: (a) najwęższe gardło, (b) JEDEN sygnał „zaczyna boleć" (metryka + próg), (c) lista „nie potrzebujesz jeszcze" z sygnałem powrotu → wpis do ADR.

Sanity-check rzędu wielkości (nie gwarancje): jedna zwykła instancja Postgresa obsłuży ~setki–tysiące prostych zapytań/s; instancja aplikacji ~setki żądań/s przy prostych handlerach. Przy ~<50 req/s szczytu ruch nie jest powodem do żadnej z maszynerii z `README.md › „Nie potrzebujesz jeszcze"`.

## 3. Przykład policzony: SaaS dla warsztatów (założenia do uzgodnienia)

Założenia: 60 warsztatów × 6 osób = 360 użytkowników; 50 % DAU = 180; 200 żądań na DAU na dzień (SPA z odświeżaniem); szczyt ×15 (poranek); 4 zapytania do bazy na żądanie; 25 zleceń/warsztat/dzień; 4 zdjęcia/zlecenie po ~1 MB (po kompresji u klienta); zlecenie ~4 KB; zdjęcie oglądane średnio 3×; baza w regionie kontynentalnym, użytkownicy w Islandii (RTT ~50 ms `[zmierz]`).

| Krok | Wyliczenie | Wynik |
|---|---|---|
| Żądania | 180 × 200 | 36 000/dobę |
| QPS | 36 000 / 86 400 | ~0,42 req/s średnio; szczyt ×15 ≈ 6,3 req/s |
| Zapytania do bazy | 6,3 × 4 | ~25 zapytań/s szczytu |
| Współbieżność | 6,3 req/s × 0,25 s | ~1,6 równoległego żądania — limit połączeń nie jest problemem, o ile klient DB jest współdzielony |
| Zlecenia (dane) | 60 × 25 × 4 KB | 1 500/dobę ≈ 6 MB/dobę ≈ 2,2 GB/rok — baza to nie problem |
| Zdjęcia (storage) | 1 500 × 4 × 1 MB | ≈ 6 GB/dobę ≈ 2,2 TB/rok — TO jest największa pozycja |
| Egress zdjęć | 6 GB × 3 odsłony | ≈ 18 GB/dobę ≈ 540 GB/mies. — porównaj z pakietem planu `[NIEPEWNE]` |
| Opóźnienie widoku | 6 sekwencyjnych wywołań × ~50 ms | ≈ 300 ms samego RTT; po `Promise.all` ≈ 50 ms |

Wnioski przykładu: (1) QPS i rozmiar danych nie uzasadniają kolejki, cache, replik ani shardingu; (2) ryzyka to **zdjęcia (storage i egress)**, **sekwencyjne round tripy przez region** i **brak indeksów na `org_id`**; (3) sygnał „zaczyna boleć": egress/mies. > ~70 % pakietu planu albo p95 ładowania widoku > ~1 s; (4) kompresja zdjęć u klienta i podpisane URL-e są zmianą o największym zwrocie; (5) ADR: „nie potrzebujemy jeszcze: kolejka zewnętrzna, Redis, replika, shard" + sygnał powrotu.

## 4. Progi „zaczyna boleć" — co mierzyć

| Warstwa | Sygnał | Liczba/limit | Pomiar i reakcja |
|---|---|---|---|
| Postgres — zapisy | opóźnienia zapisu rosną, CPU trwale wysokie | `[NIEPEWNE: wg instancji]` | `pg_stat_statements`, `EXPLAIN`; najpierw indeksy i krótsze transakcje, potem większa instancja |
| Postgres — odczyty | raporty spowalniają OLTP | `[NIEPEWNE]` | `select … from pg_stat_activity`; materialized view, potem replika |
| Postgres — połączenia | błędy „too many clients"/„remaining slots" | `[NIEPEWNE: limit wg planu i poolera]` | `select state, count(*) from pg_stat_activity group by 1;` pooler transakcyjny, jeden klient na moduł |
| Postgres — dysk | rozmiar blisko limitu planu | `[NIEPEWNE: limit wg planu]` | `select pg_size_pretty(pg_database_size(current_database()));` retencja, pliki do Storage |
| Funkcje (Vercel/Edge) | timeouty, zimne starty, łańcuchy wywołań | `[NIEPEWNE: limity czasu/pamięci wg planu]` | logi platformy; równoległe `await`, ciężką pracę do zadań w tle |
| Transfer | egress blisko pakietu | `[NIEPEWNE: pakiet planu]` | nagłówki cache, kompresja, podpisane URL-e |
| n8n | webhook z wolną pracą, workflow >~30 węzłów | `[NIEPEWNE]` | odpowiadaj 2xx szybko, logikę do kodu (04 › Orkiestracja n8n) |
| LLM/SMS | koszt dzienny per organizacja | cap wg ADR | cap + alert (03 › Rate limiting) |

## 5. Szablon do wklejenia w mini-design (10 linii)

```
POJEMNOŚĆ (założenia): użytkownicy=…, DAU=…, żądań/DAU/dobę=…, mnożnik szczytu=… (powód)
QPS średni=…, szczyt=…; zapytań DB na żądanie=…; współbieżność≈…
Dane: rekord=… KB × …/dobę → …/rok; pliki: … MB/dobę → …/rok; egress=…/mies. (plan: [NIEPEWNE])
Ścieżka krytyczna: round tripy sekwencyjne=… × RTT=… → …ms (cel …ms)
Koszt zmienny: LLM=…, SMS=…, mail=… (cap=…)
Najwęższe gardło: …
Sygnał „zaczyna boleć": <metryka> > <próg>
Nie potrzebujemy jeszcze: … (sygnał powrotu: …)
```

## 6. Czego nie robić
- Nie wpisywać do mini-designu liczb z pamięci („Postgres wytrzyma X") — pomiar albo `[NIEPEWNE]`.
- Nie optymalizować przed pomiarem: `EXPLAIN` i logi przed cache; indeks przed repliką.
- Nie traktować rzędów wielkości jako gwarancji dostawcy; limity planów czytać w panelu.
- Nie pomijać kosztu zmiennego: rachunek (egress, LLM, SMS) zwykle zaboli wcześniej niż QPS.

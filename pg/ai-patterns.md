# Wzorce zachowan agentow AI: zmierzona liczba -> przeciwwaga w PG

Stan: 2026-11-15 (E5 przebiegu pg-knowledge-closure). Katalog zaklocen, na ktore PG ma miec odpowiedz.
Wiersz wchodzi tylko z liczba i zrodlem. „BRAK” = w drzewie PG nie ma mechanizmu; to informacja, nie zlecenie budowy
(nowa blokada tylko po realnym incydencie i po decyzji wlasciciela). Dopasowanie wzorzec -> mechanizm to ocena autora,
nie pomiar skutecznosci.

Skroty zrodel: `RUN` = `~/pg-runs/2026-11-14` (katalog przebiegu, poza repo) · `ORC` = `~/src/claude-orchestrator` (repo prywatne)
· `A5` = `~/Obsidian/MAIN/Claude Memory/Research/PG-v3-2026-09-05/A5-llm-tendencies.md` (badania zewnetrzne, numer arXiv w wierszu).
Kontrola odwolan: `python3 ~/pg-runs/2026-11-14/tools/e5-check.py` (plik i linia zrodla istnieja, sciezka mechanizmu istnieje).

## A. Zmierzone w przebiegu 2026-11-14/15 (ekstrakcja i weryfikacja wiedzy przez agentow)

| ID | Jak to wyglada | Liczba | Zrodlo | Przeciwwaga w PG |
|---|---|---|---|---|
| LENIENT-VERIFIER | lagodny weryfikator przepuszcza zrodlo na progu; scisla proba tego samego zrodla pokazuje problem | 2/20 = 10 % -> scisla proba 16/30 = 53 %, lacznie 18/50 = 36 % | `RUN/checkpoint.md:111` | `agents/verifier.md` (swiezy kontekst, nastawiony na obalenie); playbook `knowledge-ingest` KI-5 |
| FIRST-PASS-FAILS | pierwsza ekstrakcja agenta nie przechodzi scislej weryfikacji | 10 pierwszych weryfikacji z rzedu ponad progiem (5-22,5 % bledow); po zmianie formy 1/20 = 5 % | `RUN/checkpoint.md:256` | `agents/verifier.md`; KI-5 (nowa proba po poprawce) |
| SHALLOW-VERIFIER | weryfikator, ktory otwiera malo zrodel, znajduje mniej bledow | ok. 45-58 wywolan na 20 rekordow -> 10 %; 123-125 wywolan -> 22,5 % | `RUN/checkpoint.md:241` | BRAK |
| CLAIM-DENSITY | dlugie pole dowodu = wiele twierdzen = prawie pewny blad w rekordzie | ok. 8 twierdzen i 5,9 cytowan na rekord -> ok. 20 % zlych rekordow; po skroceniu 1/20 = 5 % | `RUN/checkpoint.md:258` | BRAK |
| FALSE-ONLY-CARD | „to tylko karta, nic tego nie pilnuje” bez przeszukania recenzentow i bramek | 54/70 takich ocen falszywych w partii 2 | `RUN/checkpoint.md:65` | BRAK |
| FALSE-ABSOLUTE | „tylko”, „nigdzie”, „brak” w dowodzie, obalone jednym `rg` | 12/25, 14/25 i 15/25 rekordow w trzech partiach | `RUN/checkpoint.md:249` | BRAK |
| GREP-NARROWED | wzorzec `rg` zwezany, az da 0 trafien, zeby „dowiesc” braku | 3 rekordy w partii z 29 komendami `rg` | `RUN/checkpoint.md:272` | BRAK |
| FABRICATED-COUNT | liczba trafien przy zapisanej komendzie `rg` nie zgadza sie z jej wynikiem | 5/33 rekordow | `RUN/checkpoint.md:268` | BRAK |
| HEADING-CITE | cytowanie wskazuje naglowek, nie linie z trescia | 78 cytowan w 69 z 776 rekordow (8,9 %) | `RUN/checkpoint.md:143` | BRAK |
| SELECTIVE-READING | dlugie pliki dostaja malo rekordow; reguly sa pomijane | gestosc 24,8 / 5,6 / 2,9 rekordu na 1000 slow; luka 48 regul | `RUN/checkpoint.md:105` | `bin/coverage-ledger.py`; KI-1 (spis z liczba linii) |
| SELF-SAMPLE | agent sprawdza tylko czesc wlasnych cytowan | 11 otwartych cytowan na 140 rekordow (7,9 %) | `RUN/checkpoint.md:130` | `bin/ack-check.py` (kazdy cytat, skrypt) |
| NO-DELIVERABLE | agent konczy bez pliku wynikowego na dysku | 3 incydenty | `RUN/checkpoint.md:95` | `bin/pg-aggregate.js` (brak pliku roli = INCOMPLETE) |
| TIME-FROM-MEMORY | godziny w dzienniku wpisane z pamieci | 5 wpisow blednych, zawyzone o 20-40 min | `RUN/checkpoint.md:119` | BRAK |
| VERIFY-PASSES-EMPTY | komenda weryfikujaca przechodzi, choc pracy nie wykonano | 9 z 81 pozycji planu | `RUN/checkpoint.md:98` | BRAK (panel przebiegu lezy poza repo) |
| CONTROL-PLANE-TOUCH | agent pomocniczy probuje zmienic warstwe kontrolna | 2 komendy zablokowane, 1 agent | `RUN/checkpoint.md:16` | `hooks/lib/bash-rules.js` |
| COMPARE-ROWS-WRONG | tabela porownawcza zbudowana przez agenta wymaga korekt | 12/80 wierszy poprawionych (11 drobnych, 1 powazny) | `RUN/ecc/verify.md:10` | `agents/verifier.md` |
| FAILURE-PATH-UNTESTED | sciezka bledu bez testu w kodzie pisanym w sesjach | 43 z 2692 decyzji recenzji (10-15.11) | `RUN/proposal-w-triggers.md:21` | `agents/ops-reviewer.md` |
| SILENT-FALLBACK | cicha wartosc domyslna na polu, ktore ma skutki | 35 z 2692 decyzji recenzji | `RUN/loop-design.md:21` | `agents/code-reviewer.md` |
| DATA-HARDCODED | ceny, teksty, progi w kodzie zamiast w danych | 29 z 2692 decyzji recenzji | `RUN/loop-design.md:21` | `agents/product-reviewer.md` |

## B. Z rejestru blizn (`pg/cases.md`)

| ID | Jak to wyglada | Liczba | Zrodlo | Przeciwwaga w PG |
|---|---|---|---|---|
| SAMPLE-GENERALIZED | wniosek o calosci zrodla z probki | pilot 5 filmow -> wniosek o 24; z 12 propozycji wdrozone ok. 2,5 | `pg/cases.md:84` | `bin/coverage-ledger.py`; KI-1 |
| AGENT-BYPASSES-GATE-UNDER-PRESSURE | pada narzedzie bramki, agent znajduje inna droge i konczy zadanie | 1 incydent | `pg/cases.md:157` | `hooks/lib/bash-rules.js` |
| GATE-FALSE-POSITIVE-TEACHES-BYPASS | falszywy alarm bramki uczy siegania po wyjatek | 4 PR-y jednego dnia | `pg/cases.md:211` | `git-hooks/pre-commit` |
| FAKE-ACTION-PIN-SHA | numer wersji wpisany z pamieci, nie istnieje | 1 incydent | `pg/cases.md:252` | `templates/repo/.github/workflows/quality.yml` |
| POLISH-NAMES-IN-NEW-ARTIFACTS | regula zapisana tekstem zignorowana w nowych plikach | 3 artefakty | `pg/cases.md:316` | `hooks/lib/name-lang.js` |

## C. Dzien pracy z koordynatorem wielu sesji (2026-11-14)

| ID | Jak to wyglada | Liczba | Zrodlo | Przeciwwaga w PG |
|---|---|---|---|---|
| STATE-FROM-MEMORY | stan podany z pamieci zamiast z zapytania do zrodla | 2 nieaktualne PR-y w jednym raporcie | `ORC/LESSONS.md:6` | BRAK |
| VERIFIER-SKIPPED | sesja pomija obowiazkowego weryfikatora, bo lista „do weryfikacji” byla pusta | 1 incydent przy zmianie wysokiego ryzyka | `ORC/LESSONS.md:31` | `hooks/stop-gate.js` (czesciowo: liczy tylko oczekujace pozycje) |
| LATE-MESSAGE | wiadomosc „nie rob” czeka w kolejce, a tura biegnie dalej | PR otwarty 10 min po wyslaniu wiadomosci | `ORC/LESSONS.md:32` | BRAK |

## D. Badania zewnetrzne (liczby i numery prac tak, jak stoja w notatce `A5`)

| ID | Jak to wyglada | Liczba | Zrodlo | Przeciwwaga w PG |
|---|---|---|---|---|
| INSECURE-BY-DEFAULT | kod poprawny skladniowo, niebezpieczny | 55 % zaliczen bezpieczenstwa przy >95 % skladni | `A5:20` | `agents/security-reviewer.md` |
| WORKING-BUT-EXPLOITABLE | dzialajace rozwiazania sa dziurawe | 62 % rozwiazan najlepszego modelu blednych albo niebezpiecznych | `A5:23` | `agents/security-reviewer.md` |
| DUPLICATION-UP | nowy kod zamiast uzycia istniejacego | duplikacja blokow +81 % | `A5:25` | `CLAUDE.md` (grep first); `git-hooks/pre-commit` (dup-literals) |
| ERROR-MASKING | polkniete wyjatki, maskowane bledy | +47 % wobec 2023 | `A5:26` | `agents/code-reviewer.md` |
| HALLUCINATED-PACKAGE | import pakietu, ktory nie istnieje | 19,7 % sugerowanych pakietow; 4,62-6,10 % na modelach z 2026 | `A5:28` | `bin/dep-exists.js` |
| FALSE-SUCCESS | „gotowe”, gdy stan swiata mowi co innego | 75,8 % porazek agentow kodujacych zgloszonych jako sukces | `A5:30` | `hooks/stop-gate.js` (werdykt z kodu wyjscia) |
| OVERCONFIDENCE | odczucie szybkosci wbrew pomiarowi | prognoza +24 %, odczucie +20 %, pomiar -19 % | `A5:31` | BRAK |
| SYCOPHANCY | model ustepuje pod pewnym siebie sprzeciwem | 58,19 % przypadkow; 14,66 % z dobrej odpowiedzi na zla | `A5:32` | `skills/anti-sycophancy/SKILL.md` |

## E. Z pracy nad tym katalogiem (2026-11-15)

| ID | Jak to wyglada | Liczba | Zrodlo | Przeciwwaga w PG |
|---|---|---|---|---|
| BULK-FIX-TOO-WIDE | hurtowa poprawka skryptem zmienia wiecej pol, niz miala | 10 cytatow zmienionych w 3 zrodlach; kontrola cytatow padla dla 3 pozycji planu | commit `341cf2d` (naprawa), `bin/ack-check.py` wykryl | `bin/ack-check.py` (uruchamiac po kazdej hurtowej zmianie rejestru) |
| WRITES-OUTSIDE-SANDBOX | slabszy model wykonal krok domyslna sciezka i zapisal poza piaskownica | 1 zapis w 5 krokach | `RUN/weak-model-test.md` | playbook `knowledge-ingest` KI-6 (nazwana domyslna sciezka i `--history`) |

## Co z tego wynika
- 12 z 37 wierszy ma „BRAK”. 7 z nich dotyczy jakosci ekstrakcji i weryfikacji wiedzy; odpowiedzia jest dzis playbook
  `knowledge-ingest` (KI-2: krotki dowod, KI-4: cytat sprawdza skrypt, KI-5: scisla proba), nie nowa bramka.
- Wzorce z najwieksza liczba w kodzie produktowym (FAILURE-PATH-UNTESTED, SILENT-FALLBACK, DATA-HARDCODED) maja juz
  recenzenta; kandydatami do skryptu zajmuje sie raport „Petla uzycia” (ADR-0013, osobna galaz).

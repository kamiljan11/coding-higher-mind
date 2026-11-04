# Design: P10 — blizny dostarczane dzialom po tagu, nie po pozycji w pliku

Tier: T2 · Data: 2026-11-02 · Autor: Claude (sesja 17b0e4, decyzja uzytkownika „dzialaj dalej”) · Status: szkic

## 1. Problem
Recenzenci dzialowi czytaja tylko „swoja sekcje” `pg/cases.md` (`agents/data-reviewer.md:17`, `agents/ops-reviewer.md:17`,
`agents/security-reviewer.md:17`), a od wiersza ~90 plik rosnie chronologicznie (sekcje per sesja). Skan 2026-11-02
(184 wiersze tabel, 20 sekcji `##`): 17 wierszy o danych/SQL/RLS lezy poza sekcja DATA/RLS, np. POSTGREST-AMBIGUOUS-EMBED
(`pg/cases.md:298`, sekcja „PG-REVIEW / DESKTOP-SAFETY-GATE”), MIGRATION-VERSION-COLLISION-AFTER-MERGE (`pg/cases.md:170`,
sekcja „OPS — 2026-09-05”). data-reviewer ich nie widzi. Status nie ma zamknietej listy (15 wariantow `G (...)`), tabele maja
od 2 do 9 kolumn. Analiza: Obsidian `Knowledge/PG - blizny kategoryzacja i kompakcja 2026-11-01.md`.

## 2. Cele i kryteria akceptacji
- **G1:** dzial dostaje wszystkie swoje blizny jednym poleceniem `node ~/.claude/bin/pg-cases.js --dept <dzial>`: wiersze
  z sekcji przypisanej dzialowi + wiersze oznaczone tagiem `dept:<dzial>` w dowolnej sekcji. Sprawdzenie: test na fixture
  (wiersz z tagiem w obcej sekcji trafia do `--dept data`) + na zywym pliku POSTGREST-AMBIGUOUS-EMBED jest w `--dept data`.
- **G2:** `--lint`: zduplikowany `rule_id` albo wiersz tabeli z inna liczba kolumn niz naglowek = exit 1; status spoza
  zamknietej listy = ostrzezenie (observe, exit 0). Sprawdzenie: testy na fixture; `--lint` na zywym pliku = exit 0.
- **G3:** `--stats`: liczba wierszy, % ze statusem `—` (dlug bramkowy), % z golden case (`rule_id` w `pg/eval/cases.json`
  albo katalog w `pg/eval/cases/`), liczba wierszy z tagiem `dept:` spoza sekcji swojego dzialu. Sprawdzenie: test liczb na fixture.
- **G4:** recenzenci data/security/ops/code w `agents/*.md` czytaja wynik `pg-cases.js --dept`, nie „sekcje”.

Metryka sukcesu: liczba blizn danych widocznych dla data-reviewer: dzis 11 (sekcja DATA/RLS) -> po zmianie 11 + otagowane.
Pomiar: `pg-cases.js --dept data --count` przed i po.

## 3. Non-goals
- Kompakcja (wiersz-wzorzec + incydenty-dzieci, archiwum) — wymaga oceny uzytkownika, ktore blizny to ten sam rdzen; osobny krok.
- Przepisanie 184 wierszy do jednego schematu kolumn — za duzy diff (71 KB) jak na zysk; parser czyta naglowek kazdej tabeli.
- Zamkniecie listy statusow jako blokada — tylko ostrzezenie (ADR-0008: blokada po incydencie).
- Golden case dla kazdej reguly (dzis 13/176) — metryka to pokaze, uzupelnianie osobno.

## 4. Sciezka uzytkownika (CUJ)
Nie dotyczy UI. Uzytkownik = finder pg-review: dostaje w rubryce polecenie `pg-cases.js --dept <rola>`, czyta liste
(sekcja, linia, rule_id, wzorzec, detekcja, status). Blad pliku (brak, nieparsowalny) = exit 2 z komunikatem, finder czyta caly plik.

## 5. Plan per plik
| Plik | Zmiana (co, nie jak) |
|---|---|
| `bin/pg-cases.js` (nowy) | parser tabel `pg/cases.md` (naglowek per tabela), mapa sekcja -> dzial, tag `dept:` w komorce, tryby `--dept`, `--lint`, `--stats`, `--count`; exit 0/1/2 wg kontraktu (pg-maintain krok 4) |
| `bin/test_pg_cases.js` (nowy) | fixture w tmpdir: sekcje, tag w obcej sekcji, duplikat, zla liczba kolumn, status spoza listy, liczby stats |
| `pg/cases.md` | „Jak dopisywac”: tag `dept:` dla wiersza spoza sekcji dzialu + lista statusow; tagi `dept:` dopisane do wierszy danych z §1 (po przejrzeniu kazdego) |
| `agents/data-reviewer.md`, `agents/security-reviewer.md`, `agents/ops-reviewer.md`, `agents/code-reviewer.md` | `<inputs>`: wynik `node ~/.claude/bin/pg-cases.js --dept <rola>` zamiast „sekcja X w cases.md” |
| `bin/README.md`, `pg/INDEX.md` | regeneracja `pg-map.py` |

## 6. Alternatywy (odrzucone)
- **Nic nie zmieniamy:** blizny danych dalej niewidoczne dla data-reviewer (dowod §1) — to jest problem, ktory ten plan rozwiazuje.
- **Przeniesienie wierszy do sekcji dzialow:** gubi kontekst sesji (sekcje chronologiczne opisuja incydent), duzy diff, a nowe wpisy znow trafia na dol.
- **Plik boczny `cases-tags.json`:** druga kopia `rule_id` = rozjazd przy dopisywaniu (pg-maintain krok 3 „wiedza raz”).
- **Kolumna `Dzial` w kazdej tabeli:** przepisanie 184 wierszy w 20 tabelach o roznych schematach; tag w komorce daje to samo.

## 7. Zalozenia, ktore ta zmiana uniewaznia
| Zalozenie | `rg` | Trafienia do zmiany |
|---|---|---|
| „dzial czyta swoja sekcje cases.md” | `rg -n "sekcj\w* .*cases.md\|cases.md.*sekcj" agents skills pg` | `agents/data-reviewer.md:17`, `agents/ops-reviewer.md:17`, `agents/security-reviewer.md:17`, `pg/cases.md:3` |

## 8. Ryzyka
- Tag `dept:` psuje eksport publiczny (`bin/pg-export-public.py` czyta `pg/cases.md`) — sprawdzenie: test eksportu po zmianie.
- Parser myli tabele (komorka z `|` w kodzie) — tryb `--lint` raportuje liczbe kolumn; finder przy exit 2 czyta caly plik.
- Mapa sekcja -> dzial zle przypisze sekcje chronologiczna — mapa jawna w skrypcie, sekcje bez dopasowania = dzial `misc`
  widoczny w `--stats`, nie cicho pominiete.

## 9. Niezmienniki
`pg/cases.md` dalej tylko dopisywany (Plot Chestertona, `pg/cases.md:3-4`): zmiana dodaje tagi, nie kasuje wierszy.

## 10. Weryfikacja
`node bin/test_pg_cases.js`; `node bin/pg-cases.js --lint` (exit 0); `node bin/pg-cases.js --dept data | rg POSTGREST-AMBIGUOUS-EMBED`;
`node bin/pg-cases.js --dept data --count` przed/po; `python3 bin/test_pg_export.py`; `python3 bin/pg-self-check.py`.

## 11. Wdrozenie i rollback
Klon `pgnight/home/.claude` (galaz fala-1-2) -> pg-review (code + ops) -> fraza `pozwol ALLOW_CONTROL_PLANE` -> `git pull --ff-only`
do `~/.claude`, pieczec, pg-sync. Rollback: `git revert` commita w `~/.claude`; agenci wracaja do czytania sekcji.

## Status recenzji
| Kiedy | Kto (dzial / rubryka) | Werdykt | Otwarte punkty |
|---|---|---|---|

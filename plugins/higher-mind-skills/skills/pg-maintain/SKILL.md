---
name: pg-maintain
description: |
  Tryb pracy NAD SAMYM PG (~/.claude: hooks, git-hooks, bin, agents, skills, pg/, templates, CLAUDE.md). Uzyj ZAWSZE,
  gdy zmiana dotyczy systemu jakosci, nie projektu klienta: nowa bramka/regula, poprawka hooka, rubryka recenzenta,
  karta sd, szablon repo, ADR PG. Trigger: "PG", "popraw PG", "bramka PG", "hook PG", "rubryka recenzenta", "pg-review nie dziala",
  "dlaczego PG zablokowal", "ulepsz system jakosci". NIE dla bramek platnosci/SMS ani hookow w repo klienta. Procedura: orientacja przez indeks -> zmiana u wlasciciela ->
  bin/pg-self-check.py -> pg-review -> pieczec -> commit -> pg-sync. Katalog bledow z realnych sesji ponizej.
---

# pg-maintain — jak pracowac nad PG, zeby nie produkowac krzakow

PG to kod, ktory pilnuje innego kodu, wiec jego blad nie wychodzi w testach klienta. Tylko zly werdykt, cisza albo
falszywa blokada. Dlatego kazdy krok ponizej jest mechaniczny (komenda), a nie „pamietam, jak to dziala".

## Zakres

Tylko `~/.claude` na laptopie. Repo floty sa tylko do odczytu (ZAKRES w CLAUDE.md). Narzedzia uruchamiane recznie na repo
floty nie dostaja `--from` (inaczej telemetria `gates.jsonl` miesza audyt z pushami; przypadek 2026-10-18: 10 wpisow).

## Procedura

1. **Orientacja z indeksu, decyzja ze zrodla.** `pg/INDEX.md` (hooki, lib, agenci, doktryna, ADR) i `bin/README.md`
   (narzedzia) mowia, KTO jest wlascicielem tematu. Otworz wlasciciela w calosci, zanim cokolwiek stwierdzisz.
   Po kompakcji: migawka ma sekcje „Pliki PG z tej sesji" z sha12. Te pliki czytasz ponownie, a inny sha oznacza, ze zmienil je ktos inny.
2. **Zmiana u wlasciciela.** Luka w regule = poprawka w pliku, ktory regule posiada. Kopia u konsumenta jest niedopuszczalna. `pg-self-check`
   wypisuje konsumentow zmienionego pliku. Sprawdz ich, ale nie przepisuj im reguly.
3. **Wiedza raz.** Prog, lista, liczba i nazwa tabeli zyja w jednym pliku. Inne miejsca odsylaja. Liczba w `CLAUDE.md` / `pg/ref-*.md`
   niesie kotwice `(src: sciezka)`, a `bin/claims-check.py` sprawdza, ze ta liczba nadal jest w zrodle.
4. **Kontrakt narzedzia bramki:** exit 0 = OK, 1 = werdykt, 2 = blad narzedzia. Hook loguje `skipped "<narzedzie>: blad narzedzia
   (exit N)"` (ADR-0008). Blad narzedzia nigdy nie udaje werdyktu.
5. **Nowa regula idzie sciezka ADR-0008:** deklaracja -> pomiar -> observe -> recenzent -> telemetria -> zdrowie -> blokada
   dopiero po incydencie (`pg/cases.md`).
6. **Weryfikacja:** `python3 ~/.claude/bin/pg-self-check.py` ma byc ZIELONE. Potem `pg-review` (tier z diffu), po APPROVE
   `ALLOW_CONTROL_PLANE=1 node ~/.claude/bin/pg-seal.js`, commit, a na koniec
   `infisical run --env=dev -- node ~/.claude/bin/pg-sync.js push`.
7. **Zapis do warstwy kontrolnej** robisz w oknie frazy, komenda z prefiksem `ALLOW_CONTROL_PLANE=1` (slad w `gates.jsonl`).
   Skrypt edycyjny w scratchpadzie, ktorego sciezki bash-guard nie widzi, to obejscie bramki. Lapie je tylko pieczec, wiec nie rob tego.

## Katalog bledow (realne przypadki -> detekcja)

| Blad podejscia | Przypadek | Detekcja |
|---|---|---|
| Decyzja ze streszczenia, nie ze zrodla | `CLAUDE.md:71` gubil „200 uzyc"; prog amplifikacji sparafrazowany 3 sposobami | `claims-check`, krok 1, `pg/INDEX.md` |
| Poprawka u konsumenta | service_role: kopia regexu w `pg-merge-bezpieczny.py` zamiast w `risk-tier.js` | `pg-self-check` -> konsumenci; krok 2 |
| Niepelna zmiana nazwy | `jobs` -> `background_jobs` w 6 plikach, karta public `CUSTOMIZE.md` znaleziona dopiero audytem | `pg-self-check` -> „stare odwolanie?" |
| Blad narzedzia = werdykt | pre-push traktowal exit 2 jak „nowy cykl" i blokowal | kontrakt exit (krok 4), testy rc w `test_module_boundaries.js` |
| Zatruta telemetria | reczne `--report` na flocie pisaly `would_block` | telemetria tylko z `--from` (zakres) |
| Diagnoza bez repro | „pg-sync offline", a naprawde brak tokenu | przed twierdzeniem o przyczynie: dokladny blad z komendy (systematic-debugging) |
| Praca poza zakresem | przebiegi na repo floty w sesji o PG | zakres; uzytkownik: „pracujemy nad PG" |
| Test zmieniony razem z kodem | asercja kolejnosci pol JSON poprawiona w tym samym commicie | dozwolone tylko przy przeniesieniu odpowiedzialnosci i bez oslabienia asercji; powod w commicie |
| Lawina zmian jednej reguly | ADR-0008 = 30 plikow w 12 katalogach | krok 3 (odsylacz zamiast kopii); `git diff --stat` w raporcie |
| Testy zielone tylko z jednego cwd | `precompact-snapshot`: `path.resolve('C:/proj/a.ts')` przy cwd = `~/.claude` dawal „plik PG" (2026-10-19) | `pg-self-check` odpala testy z cwd = `~/.claude`, nie z katalogu testu |
| Regula pod jeden incydent (prompt, rubryka, CLAUDE.md) | rubryki rosna o rule_id z kazdego incydentu; ta sama wada kodu: UNTRUSTED-GIT-CONFIG-WHACK-A-MOLE (`pg/cases.md`) | `pg/postmortem.md` › Naprawa instrukcji agenta: klasa + 2-3 warianty, pozytyw + bliski negatyw, po edycji rubryki przebieg roli na golden diffach (`pg-eval.js` = tylko bramki 0-tokenowe) |
| Obejscie bash-guard skryptem | `edit_*.py` w scratchpadzie zapisywaly do `bin/` | krok 7; pieczec (`pg-seal --check`) |
| Prywatna sciezka w pliku eksportu wykryta po commicie | a2e0118, bfb2e7e (`/home/<litera>/` w przykladzie) | `pg-self-check` -> `pg-export-public --check-only` (drzewo robocze, 2026-11-03) |
| Telemetria zapisana do klonu | testy klonu z `HOME=<klon>/..`, a `pg-outcome.js` w tej samej powloce pisal `logs/review-outcomes.jsonl` klonu (A30/A31, 4 wiersze, 2026-11-02; `logs/` jest w .gitignore, wiec pull ich nie przenosi) | `pg-outcome`/`pg-aggregate` zawsze bez nadpisanego `HOME`; sciezka zapisu w wyniku `pg-outcome` = `~/.claude/logs/...` |

Incydent (co sie stalo, dowod, data) idzie do `pg/cases.md`, bo to jedyny rejestr blizn. Tutaj dopisz tylko wiersz WZORCA podejscia
z odsylaczem do blizny, a gdy da sie go zlapac komenda, dodaj test do `pg-self-check`.

**Czego NIE pokrywa (stan 2026-10-19):** `claims-check` sprawdza tylko linie z kotwica (3), a 131 linii z liczbami w `CLAUDE.md`/`pg/ref-*.md`
jest bez kotwicy. Kotwice dokladamy przy okazji edycji tej linii. Do tego czasu liczba bez `(src:)` to trop, nie dowod (krok 1).
`pg-self-check` nie jest wpiety w hook; uruchamiasz go recznie przed commitem (proporcjonalnosc: blokada dopiero po incydencie).

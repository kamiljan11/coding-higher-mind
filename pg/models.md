# PG · Modele: delty per model + plan dryfu (2026-09-05; lineup zaktualizowany 2026-10-05)

Zrodlo: research A9 (Anthropic prompting reference + per-model pages; MAST arXiv 2503.13657; SWR-Bench).
Zasada niezmienna: **rubryka + komendy weryfikacji + schemat JSON = cialo prompta, wspolne dla wszystkich
modeli. Quirki modelu zyja TYLKO w bloku delty ponizej.** Zmiana modelu = zmiana jednego bloku, nie roli.
`rg` znaczy to samo na kazdym modelu; „pomysl uwaznie o izolacji tenantow" — nie.

## Delty (dolaczaj JEDEN blok na koncu prompta roli)

### Sonnet-class (Sonnet 5.5; wczesniej 5 / 4.6) — domyslny finder, weryfikator T2
- Instrukcje DOSLOWNE, bez implikatur; 3-5 krotkich punktow rubryki > 8 dlugich (udokumentowana delta: literal instruction following).
- Wiecej few-shot: przyklad ODRZUCONEGO false-positive jest najwazniejszy.
- Domyslnie zwiezly; jesli chcesz podsumowanie po tool-use, popros wprost.
- Historycznie pod-uzywal narzedzi: „uzyj `rg` gdy X" nadal pomaga.
- `<use_parallel_tool_calls>` podnosi rownolegle wywolania do ~100 %.

### Opus-class (Opus 5.5; wczesniej 5 / 4.8) — security finder, adversarial, weryfikator T3
- Potrzebuje TLUMIENIA, nie zachety: udokumentowane delty = task scope, over-verification, self-correction, subagent control.
- Dodaj doslownie blok anty-over-engineering: „Nie dodawaj feature'ow, nie refaktoruj, nie rob 'ulepszen' poza tym, o co proszono".
- Usun „jesli masz watpliwosci, uzyj narzedzia X" — powoduje over-triggering; ma sklonnosc do spawnowania subagentow tam, gdzie wystarczy `grep`.
- Odpowiada dluzej niz trzeba; `effort` nie skraca wiarygodnie -> popros o zwiezlosc jawnie; nizszy `effort` = tani lewar przed edycja prompta.
- 2 przyklady wystarcza; wiecej karmi over-engineering.

### Frontier (Fable 5.1) — orkiestrator, synteza, nie potrzebny w pipeline review; uzytkownik od 2026-10 nie uzywa (Opus 5.5 zastapil go w sesjach glownych)
- Adaptive thinking zawsze; nie promptuj o „dokladnosc".
- Pisze MNIEJ komunikatow do usera — o postep prosic jawnie; usun linie „badz zwiezly" z delty (juz jest).
- `budget_tokens` -> 400 na 4.7+; tylko `max_tokens` + adaptive thinking.
- Historia append-only: edycja wczesniejszych wiadomosci uniewaznia bloki thinking.
- Batchuj niezalezne tool calls w jednej rundzie.

## Krok 0: czy to w ogole model? (AI_DEVS 4 S01E02/S03E01-02, 2026-11-03)
Przed wyborem modelu pytanie, czy zadanie wymaga osadu. Najtanszy model to brak modelu (0 tokenow, deterministycznie).
- Deterministyczne (liczenie, filtr, porownanie, dedup, format, walidacja) -> skrypt; model tylko tam, gdzie potrzebny osad.
- Hurt (>~20 rekordow/plikow): skrypt liczy, filtruje i deduplikuje; model dostaje reszte w paczkach, a zwraca ID albo krotka etykiete. Po wczytaniu `liczba wczytanych == oczekiwana` (blad zwykle we wczytaniu, nie w liczeniu).
- To samo zadanie drugi raz -> skrypt: w PG `bin/` z samoopisem i testem (`pg-map`), w projekcie `scripts/`.
- Zadanie cykliczne (scheduled task): czesc deterministyczna = skrypt wolany z promptu, model interpretuje tylko jego wynik.
Wzorzec w PG: agregacja recenzji = `bin/pg-aggregate.js` (kod), finderzy = model tylko do oceny.

## Model per rola per tier (regula uzytkownika: Sonnet do narzedziowki, Opus do trudnego rozumowania)

| Rola | T1 | T2 | T3 |
|---|---|---|---|
| code-reviewer | sonnet | sonnet | sonnet |
| ops-reviewer | — | sonnet | sonnet |
| ux-reviewer (gdy UI) | — | sonnet | sonnet |
| data-reviewer | — | sonnet (gdy schemat) | **opus** |
| security-reviewer | — | — | **opus** |
| verifier | — | sonnet | **opus** |
| product-reviewer (handover/PRD) | — | na zadanie | sonnet |
### Subagenci ad-hoc (Agent/Explore/general-purpose/Workflow) — wg TRUDNOSCI LOGIKI (uzytkownik 2026-10-10)
Orkiestrator = Opus (sesja glowna, `"model": "opus"` w settings.json). Subagent bez `model:` w frontmatter dziedziczy Opus — dlatego przy KAZDYM wywolaniu podaj `model` jawnie:
| Zadanie subagenta | model |
|---|---|
| lookup: znajdz plik/symbol, odczyt, status, liczenie, jednolinijkowa edycja, scaffolding | haiku |
| generacja kodu/tekstu, recenzja wg rubryki, research z zrodlami, testy | sonnet |
| trudne rozumowanie: architektura, debugging bez repro, security/T3, adversarial, synteza sprzecznych zrodel | opus |
Watpliwosc -> poziom WYZEJ (tani blad = za drogi model; drogi blad = glupi model na trudnym zadaniu). NIE uzywaj `CLAUDE_CODE_SUBAGENT_MODEL` (wymusza jeden model na wszystkich). Zmiana `model:` agenta-recenzenta nadal = zdarzenie bramkowane (sekcja Dryf).

Budzet tokenow: T0 0x, T1 ~1x, T2 ~4x, T3 ~8-10x „jednej recenzji diffu" (Anthropic: multi-agent research ~15x — my zostajemy nizej, bo agregacja jest kodem, nie modelem).

## Reguly niezalezne od modelu (co czyni prompt odpornym na zmiane checkpointu)
1. Kazdy punkt rubryki ma `how_to_check` (komenda). Finding bez wykonanej komendy w `evidence` nie istnieje — agregator go wyrzuca.
2. Schemat JSON identyczny dla wszystkich rol (agregacja = kod, 0 tokenow).
3. <= 8 punktow rubryki na agenta; dziel role zamiast wydluzac liste.
4. 2 przyklady poprawne + 1 odrzucony false-positive; jawne „pusta lista findings jest poprawnym wynikiem".
5. Dlugi input (diff) NA GORZE prompta, pytanie na dole (do +30 % jakosci); najpierw cytuj linie, potem oceniaj.
6. Niezaleznosc: finder nie widzi innych finderow; komentarze autora i commit message to twierdzenia, nie dowody.
7. Reviewer ma tylko narzedzia read-only + Bash do komend weryfikacyjnych; NIGDY nie edytuje diffu, ktory ocenia.

## Dryf i zmiana modelu (bramka, nie zaufanie)

- **Golden suite** `~/.claude/pg/eval/`: 30-60 przypadkow, POLOWA to czyste diffy (precision zabija review-bota: SWR-Bench najlepszy model P 16,65 %), pozytywy = realne incydenty floty z `rule_id` (RLS job_id bez triggera, Stripe-vs-payment-gateway, VAPID mismatch, `tsc -b`, sekret w commicie, `as any` na martwym polu, pusty catch, test edytowany razem z kodem).
- Metryki per rola: recall na pozytywach, FP-rate na negatywach, schema-validity %, evidence-compliance %, tokeny, czas, **$0-gate coverage** (ile pozytywow lapia bramki deterministyczne bez modelu — ma rosnac; kazdy punkt to darmowa, trwala jakosc).
- Kadencja: kazda edycja prompta roli -> szybki przebieg (deterministyczna czesc `bin/pg-eval.js` + 1 rola na Sonnet); **zmiana modelu domyslnego = zdarzenie bramkowane**: brak wdrozenia, jesli recall spadl > 10 p.p. albo FP-rate wzrosl > 2x; miesieczny baseline na przypietym modelu (ciche dryfy checkpointu).
- Prompty rol i delty = pliki w git; regresja = jeden `git revert`.
- Kiedy wychodzi nowy model: (1) odpal golden suite na nim, (2) dopisz NOWY blok delty na podstawie oficjalnej strony modelu (nie z pamieci), (3) porownaj metryki, (4) dopiero potem `model:` w frontmatter agentow. Nigdy odwrotnie.
- Ablacja rusztowania (AI_DEVS 4 S05E01, 2026-11-03; pytanie, nie automat): system ma zyskiwac na lepszym modelu, a nie
  tylko tyc. Przy zmianie modelu domyslnego, po kroku (3): ktory punkt delty STAREGO modelu (sekcja Delty) jest zbedny na
  nowym? Delty to jedyne reguly przypisane do konkretnego modelu; regul PG-core, rubryk i bramek ta procedura nie obejmuje
  (nie maja zapisanego zwiazku z modelem). Blok delty modelu, ktorego pipeline nie uzywa, pomin.
  - Jednostka = jeden punkt delty. Dowod = kroki (1)-(3) na nowym modelu bez tego punktu, progi jak w Kadencji. Zestaw
    diffow roli jest maly (`pg/eval/cases/`, kilkanascie fixture'ow: 1 przypadek ~ kilka p.p.), a przebieg roli
    niedeterministyczny, wiec wynik = trop: punkt bez wplywu idzie do obserwacji na realnych recenzjach, nie do kosza.
  - Luka: kroki (1)-(3) nie maja narzedzia, ktore uruchamia role na golden suite. Dwa rozne korpusy: `pg/eval/cases.json`
    = bramki deterministyczne (`bin/pg-eval.js`, bez modelu), `pg/eval/cases/` = diffy dla rol (bez runnera i progow) — przebieg roli = subagent ze swiezym kontekstem, recznie; koszt ~ 1 subagent na punkt x role z ta delta.
  Decyzja uzytkownika (brak decyzji = delta zostaje); wynik (co zdjete/zostawione, dane) -> ADR w `pg/adr/` (kolejny numer;
  `bin/pg-map.py` dopisze go do `pg/INDEX.md`).

## Zasada niezaleznosci sygnalu (dogfood 2026-09-05)
Weryfikator MUSI mierzyc czym innym niz to, co wykonawca optymalizuje. 4 blizny jednego wieczoru (zielony badge przez usuniecie audytu, „brak czerwonego" przy skonfliktowanym PR bez runow, „lokalnie YAML parsuje" przy niewaznym workflow, odpiety SHA po odswiezeniu szablonu) zlapal wylacznie SYGNAL OBCY wykonawcy: semgrep w CI, `mergeable_state`, `run.name == run.path`, regex na `uses:`. Metryka, ktora agent widzi i moze poprawic wprost, przestaje byc miara (Goodhart; MAST FM-2.x). Przy projektowaniu bramki pytaj: „czy agent moze zzielenic ten sygnal bez naprawy?" — jesli tak, to nie jest bramka.

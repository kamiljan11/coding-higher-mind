# ADR-0012: Adopcje z everything-claude-code (ECC) po porownaniu 2026-11

Data: 2026-11-15 | Status: proponowane (scalone w `feat/pg-integration` 2026-11-15; merge do `~/.claude` tylko za fraza uzytkownika `pozwol ALLOW_CONTROL_PLANE`) | Przeglad: 2026-12-13

**Kontekst:** uzytkownik zlecil (2026-11-08) porownanie PG z repo everything-claude-code (upstream `affaan-m/everything-claude-code`
@d2ef2680, wersja 2.2.3, MIT, Copyright (c) 2026 Affaan Mustafa; migawka `worldflowai` bez licencji = tylko pomysly) oraz
dopisanie nieprzyjetych pozycji z `google/elephant-goldfish-model` (porownane 2026-11-01). Kryteria uzytkownika z 2026-11-15:
system ma byc tani w uzyciu (tekst zawsze w kontekscie kosztuje w kazdej turze, skrypt kosztuje 0 tokenow) i ma poprawiac
sie z uzycia, nie z kolejnych materialow. Ocenione: 383 jednostki ECC + 25 pozycji EGM; decyzje: ODRZUC 186, PG LEPSZY 162,
ADAPTUJ 35, PRZEJMIJ 0. Weryfikacja adwersaryjna 80 wierszy (4 swiezych agentow): 68 sie broni, 12 poprawek, 1 istotna.
Lista jest pelna: wszystkie 10 grup porownania wrocilo przed decyzja (`ecc/tools/build_compare.py`: luk 0).
Tresc repo traktowana jako dane niezaufane: nic z niego nie uruchomiono ani nie zainstalowano, kodu nie kopiowano.

**Decyzja:**

| Problem | Mechanizm (ta galaz) | Koszt uzycia | Odrzucona alternatywa (dlaczego) |
|---|---|---|---|
| Nikt nie liczy, ktore skille i karty `pg/*.md` sa realnie uzywane (2566 tez rejestru wiedzy „niezmierzone”) | `bin/skill-usage.py`: licznik z transkryptow, okno 7/30 dni, lista skilli bez uzycia; tylko raport | 0 tokenow, ok. 19 s na 30 dni (8025 plikow z subagentami) | hooki ECC `observe-runner.js` / `skill-run-tracker.js`: druga kopia danych, ktore transkrypty juz maja, plus proces przy kazdym wywolaniu narzedzia |
| Polisa RLS z golym `auth.uid()` liczy funkcje dla kazdego wiersza | `bin/sql-migration-lint.js` R15, tylko INFO | 0 tokenow, <1 s | poziom HIGH/MEDIUM: ok. 93 % istniejacych polis w `~/src` pasuje do wzorca (pomiar weryfikatora), wiec blokada bylaby sprzataniem dlugu |
| `key={index}` i `target="_blank"` bez `rel` widzi tylko recenzent, jesli zauwazy | 2 reguly w `bin/pg-prechecks.js` (dowod dla recenzenta, bez blokady) | 0 tokenow | plik regul React ECC ladowany do kontekstu (ok. 1,8 tys. tokenow przy kazdym pliku .tsx) |

**Nie przyjete, choc ocenione wysoko (z powodem):** instynkty `continuous-learning-v2` (regula powstaje bez zgody czlowieka po
3 wystapieniach, trafia do kontekstu kazdej sesji, nic jej nie usuwa); `mcp-dependency-review` (9 serwerow MCP, zaden przez
`npx`/`@latest`; `bin/mas_ioc_scan.py` juz wypisuje komendy MCP); `context-prompt-suggestions` (150-250 tokenow na pasujacy
prompt); `skill-comply` (platne przebiegi syntetyczne). Odlozone do osobnej decyzji: EGM P8 „chudy finder” (pole
`omitClaudeMd` niepotwierdzone w dokumentacji), twarda walidacja dowodu odrzucenia, weryfikacja uruchomienia finderow z
transkryptu. Pelna tabela i weryfikacja: notatka w vaulcie `Knowledge/PG - porównanie z everything-claude-code (2026-11).md`.

**Koszt cykliczny:** `skill-usage.py` ok. 19 s na przebieg przy oknie 30 dni (8025 plikow: 136 sesji + transkrypty
subagentow, pomiar 2026-11-15; rosnie z liczba sesji w oknie), 0 tokenow; wynik czyta uzytkownik w raporcie tygodniowym po
wpieciu (do tego czasu nikt). R15 i dwie reguly prechecks: <1 s w istniejacych przebiegach lintu i pg-review.
Utrzymanie: 3 wzorce i jeden format transkryptu. Zmiana formatu przez Claude Code = liczniki spadaja do zera; skrypt
wtedy ostrzega (pole `warnings`, stderr, `uwagi=` w linii podsumowania), ale nie wykryje spadku czesciowego.

**Pierwszy pomiar (2026-11-15, okno 30 dni):** 14 skilli uzytych, 104 ze 110 zainstalowanych lokalnie bez uzycia, 10 kart
`pg/*.md` czytanych (z subagentami; bez nich 8: `known-limits.md` 13, `cases.md` 6, `design.md` 4).

**Miara (przeglad 2026-12-13):**
1. `skill-usage.py` NIE jest na tej galezi nigdzie wpiety: nic go nie uruchamia cyklicznie. Wpiecie w istniejace zadanie
   tygodniowe `guard-health` to czesc projektu petli uzycia, ktory czeka na akceptacje uzytkownika (osobna zmiana, osobny ADR).
   Dlatego miara liczy sie od dnia wpiecia: 4 tygodnie pozniej lista bez uzycia doprowadzila do co najmniej jednej decyzji
   uzytkownika (wycofanie skilla albo zostawienie z powodem); 0 decyzji -> usunac skrypt. Brak wpiecia do 2026-12-13 = przy
   przegladzie decyzja „wpiac albo usunac”, bez trzeciej opcji (skrypt uruchamiany tylko recznie nie zamyka petli).
2. R15: liczba trafien na nowych migracjach i ile poprawiono; 0 poprawek przy trafieniach -> usunac regule.
3. Prechecki React: trafienia w `prechecks.json` i wynik w `review-outcomes.jsonl`; odrzucone jako falszywe > 30 % przy n >= 10 -> zawezic albo usunac.

**Wycofanie:** `git revert` trzech commitow; zaden nie dotyka hookow, `settings.json` ani rubryk agentow, wiec bez `pg-wire`.

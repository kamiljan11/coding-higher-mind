# PG · POSTMORTEM — incydent zamienia sie w bramke; naprawa instrukcji agenta (2026-09-05, 2026-11-03)

Zasada: **incydent bez nowego punktu w checkliscie / nowego case'u / nowej bramki jest OTWARTY**, nawet
jesli prod dziala. Google SRE: „kazde pytanie na checkliscie musi byc uzasadnione poprzednia katastrofa".
uzytkownik ma katastrofy (31 sygnalow w pamieci, A2) — nie mial przelozenia na bramki (21/31 niegatowane).
Blameless: szukamy przyczyny w systemie (brak bramki), nie w osobie/modelu.

## Szablon (15 min, do `~/Obsidian/MAIN/Claude Memory/Log/incidents.md` — APPEND, nigdy rewrite)

```
## <data ISO> — <tytul jednym zdaniem>
SEV: 1 | 2 | 3 (wg docs/RUNBOOK.md „SLA"); czas reakcji: <X> vs SLA <Y>; `pg.sla`: none | internal | contract
Wplyw: kto/ile/jak dlugo (org, klienci, kwota, dane)
Wykrycie: kto/co zauwazylo (alert? klient? przypadek?) -> czas od wystapienia
Oś czasu: 3-6 punktow
5 x dlaczego:
  1. ...
  2. ...
  3. ...
  4. ...
  5. <przyczyna systemowa: brakujaca bramka / zla granica / brak testu / proza zamiast hooka>
Co zadzialalo: ...
Action items (kazdy z wlascicielem i terminem):
  [ ] BRAMKA: <nowy check w hooku/CI/pre-commit — ktory plik>   albo
  [ ] CASE: <wpis w ~/.claude/pg/cases.md z rule_id + golden case w pg/eval/>   albo
  [ ] RUBRYKA: <nowy punkt how_to_check w agents/<rola>.md>
  [ ] (opcjonalnie) RUNBOOK/README
Status: OPEN -> CLOSED gdy action item BRAMKA/CASE wyladowal w repo (link do commita)
```

## Regula klasyfikacji action itemu
| Jesli przyczyna to... | to action item = |
|---|---|
| da sie wykryc regexem/lintem/testem | BRAMKA (hook, pre-commit, CI, sql-migration-lint, fleet-metrics) |
| wymaga osadu, ale ma wzorzec | CASE w `pg/cases.md` + golden case (pozytyw) + punkt rubryki recenzenta |
| proces (deploy path, sekrety, komunikacja) | PRR/DoD punkt + RUNBOOK |
| zachowanie AI (sykofancja, falszywy sukces, zapetlenie) | PG-core / delta modelu w `pg/models.md` + test w `test_prompt_guard.js` |

## Naprawa instrukcji agenta (prompt, rubryka, CLAUDE.md, skill) — AI_DEVS 4 S01E01/S02E01, 2026-11-03
Dotyczy wiersza „zachowanie AI" powyzej i kazdej edycji tekstu, ktory steruje modelem. Ryzyko: regula dopasowana do jednego
incydentu (latka) zamyka jeden wariant, a rdzen rosnie (blizna UNTRUSTED-GIT-CONFIG-WHACK-A-MOLE w `pg/cases.md` — to samo dla kodu).
1. **Przyczyna z artefaktu:** transkrypt/log — co model mial w kontekscie i czego nie zastosowal. Pytanie do modelu „dlaczego?"
   daje uzasadnienie, nie mechanizm (modele nie znaja wlasnych procesow) — trop, nie dowod.
2. **Klasa, nie przypadek:** nazwij przyczyne ogolnie i dopisz 2-3 warianty spoza incydentu. Regula z nazwa repo/pliku/komendy
   = latka; przypadek idzie najwyzej jako przyklad.
3. **Odrzuc sugestie zbyt bezposrednie:** propozycja poprawki od modelu zwykle skleja regule z przypadkiem (AI_DEVS 4 S02E01: ok. 60 %
   pierwszych sugestii bez sensu) — kazda przechodzi krok 2.
4. **Test w parze:** pozytyw (incydent: regula dziala) + bliski negatyw (to samo z wygladu, zachowanie poprawne: regula milczy).
   Bramki 0-tokenowe -> `pg/eval/cases.json` (`positive: false`; `bin/pg-eval.js` sam odrzuca bramke bez negatywu); protokol ->
   `bin/test_prompt_guard.js`; rubryka recenzenta -> negatyw jako odrzucony false-positive w przykladach roli (`pg/models.md`
   › Reguly niezalezne od modelu, pkt 4). Tu nic nie pilnuje negatywu mechanicznie — to obowiazek tej procedury.
5. **Miejsce wg zdarzenia:** regula potrzebna przy konkretnym zdarzeniu -> plik czytany na to zdarzenie (`pg/*.md`, rubryka roli,
   skill), nie rdzen `CLAUDE.md` (budzet bajtow: `TOKEN_BUDGET` w `hooks/guard_health.py`).
6. **Po edycji rubryki recenzenta:** `node ~/.claude/bin/pg-eval.js` lapie tylko regresje bramek 0-tokenowych; zachowanie roli
   sprawdza przebieg tej roli na golden diffach (`pg/models.md` › Kadencja: 1 rola na Sonnet) — FP-rate na negatywach nie rosnie.

## Anty-wzorce postmortemu (z A2: S13, S14, S15)
- „naprawione w locie" co run, nigdy u zrodla (S15) -> action item MUSI byc strukturalny.
- watchdog wnioskuje „samo sie naprawilo" z timestampu bez otwarcia artefaktu (S14) -> dowod = artefakt.
- ta sama linia bledu uznana za potwierdzenie mimo zmiany sygnatury (S13) -> porownuj pelny komunikat.

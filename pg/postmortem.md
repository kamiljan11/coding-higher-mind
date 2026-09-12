# PG · POSTMORTEM — incydent zamienia sie w bramke (2026-09-05)

Zasada: **incydent bez nowego punktu w checkliscie / nowego case'u / nowej bramki jest OTWARTY**, nawet
jesli prod dziala. Google SRE: „kazde pytanie na checkliscie musi byc uzasadnione poprzednia katastrofa".
uzytkownik ma katastrofy (31 sygnalow w pamieci, A2) — nie mial przelozenia na bramki (21/31 niegatowane).
Blameless: szukamy przyczyny w systemie (brak bramki), nie w osobie/modelu.

## Szablon (15 min, do `~/.claude/memory/log\incidents.md` — APPEND, nigdy rewrite)

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

## Anty-wzorce postmortemu (z A2: S13, S14, S15)
- „naprawione w locie" co run, nigdy u zrodla (S15) -> action item MUSI byc strukturalny.
- watchdog wnioskuje „samo sie naprawilo" z timestampu bez otwarcia artefaktu (S14) -> dowod = artefakt.
- ta sama linia bledu uznana za potwierdzenie mimo zmiany sygnatury (S13) -> porownuj pelny komunikat.

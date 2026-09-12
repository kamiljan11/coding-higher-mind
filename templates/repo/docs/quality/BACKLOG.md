# BACKLOG jakosci — rejestr dlugu (kredyt z odsetkami)

<!-- Dlug technologiczny = skrot, ktory przyspiesza dzis i spowalnia jutro. Nie jest bledem, jesli jest
     ZAPISANY tu w momencie zaciagniecia. Bramka `node ~/.claude/bin/todo-ledger-gate.js --staged`
     (pre-commit): nowy TODO/FIXME/HACK w kodzie bez wiersza tutaj w tym samym commicie = blok. -->

## Dlug swiadomie zaciagniety (nowe wpisy NA GORZE)

| Data | Plik:linia | Skrot (co zrobilismy na skroty) | Odsetki (co to spowolni / kiedy boli) | Splata do | Status |
|---|---|---|---|---|---|
| RRRR-MM-DD | `src/x.ts:42` | np. cena liczona w komponencie zamiast w `lib/price.ts` | kazda zmiana VAT = 2 miejsca; blad przy PLN | wersja / data / "gdy 2. waluta" | open |

## Dlug historyczny (audyt, nie sprzatany z automatu — zasada 2026-08-09)

| Zrodlo | Co | Decyzja uzytkownika |
|---|---|---|
| `sql-migration-lint --min-severity high` | np. 12 HIGH (DEFINER bez search_path) w migracjach 2025 | do splaty przy nastepnej migracji tabeli X / akceptowane |
| `fleet-metrics largeFiles` | np. `NewOrderWizard.tsx` 2174 linii | plan podzialu: ... |

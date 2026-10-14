---
description: Slownik terminow PG i procedura dodania bramki — dla obcego seniora przejmujacego ~/.claude
---

# PG — slownik i jak dodac bramke

## Terminy

| Termin | Znaczenie | Zrodlo prawdy |
|---|---|---|
| Tier T0-T3 | ryzyko liczone z DIFFU: T0 docs, T1 kod, T2 m.in. hooki / > 150 linii, T3 auth/RLS/platnosci/migracje/cron albo > 600 linii | `hooks/lib/risk-tier.js` |
| Recenzja dzialowa (pg-review) | finderzy z rubryka (code, security, data, ops, ux, product, qa) rownolegle, read-only -> `pg-aggregate.js` -> weryfikator; T2+ wymagane przez stop-gate | `skills/pg-review/SKILL.md`, `agents/` |
| Wyjatek A / B / C | A: agent sam (`ALLOW_X=1`); B: po recenzji (`pg-self-approve.js`); C: tylko fraza uzytkownika `pozwol ALLOW_X` w czacie | `pg/ref-pg-internals.md` |
| Warstwa kontrolna | hooks, git-hooks, bin, agents, scheduled-tasks, settings — zmiana tylko po frazie CONTROL_PLANE | `hooks/lib/bash-rules.js` (control-plane) |
| Pieczec | skroty plikow warstwy kontrolnej; przepisywana w oknie frazy, rozjazd = alarm | `bin/pg-seal.js`, `hooks/.seal.json` |
| observe / enforce | tryb reguly: observe loguje `would_block` i przepuszcza, enforce blokuje | `hooks/lib/bash-rules.js` (pole `mode`) |
| Log bramek | `logs/gates.jsonl`: block/bypass/would_block/skipped; `redirected` = slad testow | `hooks/lib/gate-log.js`, `hooks/guard_health.py` |
| Drzwi jednokierunkowe | 9 obszarow `one_way` (model danych, ID, pliki, tozsamosc, kontrakt API, podzial uslug, DNS, region, DR) — decyzja ZAWSZE przed kodem | `pg/design.md`, `pg/sd-areas.json` |
| Blizna | realny incydent, z ktorego wyrosla bramka | `pg/cases.md` |
| Sygnal powrotu | warunek, przy ktorym cofamy decyzje (pole ADR) | `templates/repo/docs/adr/0000-template.md` |
| Aktywne repo | commit na galezi domyslnej albo PR wlasciciela w ostatnich 30 dniach | `bin/fleet-active-repos.py`, ADR-0006 |
| Dzien przegladu floty (sweep) | dzien z ruchem w >= 8 repo naraz = praca PG na flocie, nie projekt | `pg/fleet-scope.json` (`sweep_min_repos`) |
| pin / exclude | pin = repo sprawdzane zawsze; exclude = nigdy (travel-site) | `pg/fleet-scope.json` |

## Jak dodac bramke (proporcjonalnosc: bez incydentu nie ma blokady)

1. Realny incydent -> wpis w `pg/cases.md` (co sie stalo, dowod). Brak incydentu = brak bramki.
2. Regula najpierw w trybie `observe` (albo ostrzezenie) — zbiera `would_block` w `logs/gates.jsonl`.
3. Test w baterii (`bin/test_hooks_v3.js` / `bin/test_slop_gates.js`); `bin/pg-mutate.js` musi zabic mutanta (wylaczona regula = czerwony test).
4. Po danych (trafienia vs falszywe alarmy) -> `enforce`; komunikat podaje poziom wyjatku A/B/C.
5. ADR w `pg/adr/` z „Sygnalem powrotu”; zmiana warstwy kontrolnej = fraza CONTROL_PLANE + nowa pieczec.

Cofniecie bramki: `git revert` jej commita (ADR-0007 pokazuje miejsca w kodzie dla kalibracji progow).

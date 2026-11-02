# Design: <nazwa zmiany>

<!-- Plik designu dla zmiany T2+ (`node ~/.claude/hooks/lib/risk-tier.js <root> <pliki>`), PRZED kodem.
     Kopiuj jako docs/designs/YYYY-MM-DD-<krotka-nazwa>.md. Zrodlo regul: ~/.claude/pg/design.md (A, B, B+, C, D).
     Zasady: bez kodu w planie (opis zmian per plik, nie implementacja); kazda sciezka/symbol MUSI istniec w repo
     (sprawdz `rg`); implementujacy nie podejmuje zadnej decyzji, ktorej tu nie ma. Sekcja po fakcie, ktora rozni sie
     od planu = nowa sekcja „Rewizja” na dole (WIAZE), nie przepisywanie historii. -->
<!-- Mala zmiana T2 (np. 1-2 pliki, bez danych/pieniedzy/auth): sekcje 4 (CUJ) i 9 (Niezmienniki) moga miec jedno zdanie
     „nie dotyczy: <powod>”. Sekcje 6 (alternatywa) i 11 (rollback) zawsze wypelnione (pg/design.md B.1, B.4).
     Pusta sekcja bez powodu = luka planu (pg/plan-rubric.md krok 4, zasada zero decyzji). -->

Tier: <T2/T3> · Data: <YYYY-MM-DD> · Autor: <kto> · Status: szkic | po recenzji | wdrozony

## 1. Problem
<!-- Dla kogo i co boli, z dowodem (liczba, plik:linia, zgloszenie). Nie „system ma”. -->

## 2. Cele i kryteria akceptacji
<!-- Kazdy cel: obserwowalne kryterium + SPOSOB SPRAWDZENIA ustalony przed kodem (test / komenda / scenariusz). -->
- **G1:** … Sprawdzenie: …

Metryka sukcesu + event: <co policzymy po wdrozeniu i skad> albo jawnie „brak metryki: <powod>” (pg/design.md A.4).

## 3. Non-goals
<!-- Czego celowo NIE robimy teraz i dlaczego. -->

## 4. Sciezka uzytkownika (CUJ)
<!-- 3-6 krokow: kto, na jakim urzadzeniu, co klika / co widzi; stany pusto / blad / offline. „Nie dotyczy” jawnie. -->

## 5. Plan per plik
| Plik | Zmiana (co, nie jak) |
|---|---|
| `sciezka/istniejaca.ts` | … |

## 6. Alternatywy (odrzucone)
<!-- Min. jedna, z powodem (koszt / ryzyko / boring tech). „Nic nie zmieniamy” to tez wariant. -->

## 7. Zalozenia, ktore ta zmiana uniewaznia
<!-- Literaly i reguly, ktore przestaja byc prawdziwe: nazwy, stawki, DEFAULT w DDL, teksty w promptach LLM, stale.
     Kazdy z komenda `rg` po CALYM repo i wynikiem (liczba trafien). Puste = napisz „brak” po sprawdzeniu. -->
| Zalozenie | `rg` | Trafienia do zmiany |
|---|---|---|

## 8. Ryzyka
<!-- Co moze pojsc zle, prawdopodobienstwo, skutek, obrona. Dane (migracja, RLS, tenant), bezpieczenstwo
     (STRIDE-lite z pg/design.md C), PII, pieniadze / waluta, zaleznosci zewnetrzne (timeout, retry, kill switch). -->

## 9. Niezmienniki
<!-- Ktore wiersze `docs/ARCHITECTURE.md` › Niezmienniki dotyka ta zmiana i jak zostaja prawdziwe. Nowy niezmiennik -> dopisz tam. -->

## 10. Weryfikacja
<!-- Komendy, ktore udowodnia G1..Gn (te same co w §2), plus testy regresji i bramki. -->

## 11. Wdrozenie i rollback
<!-- Sciezka deployu (Lovable push / Vercel PR), flagi, migracja dwuetapowa, jak cofnac, co bedzie w logach przy awarii. -->

## Status recenzji
<!-- Uzupelnia orkiestrator po pg-review / samoocenie planu. -->
| Kiedy | Kto (dzial / rubryka) | Werdykt | Otwarte punkty |
|---|---|---|---|

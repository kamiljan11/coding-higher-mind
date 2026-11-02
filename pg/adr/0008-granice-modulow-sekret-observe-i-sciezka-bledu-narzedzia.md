# ADR-0008: Granice modułów wg sekretu i domeny (observe), ścieżka błędu narzędzia, język kodu jako deklaracja repo

Data: 2026-10-18 | Status: przyjęte (uzytkownik 2026-10-18: „decyduj autonomicznie, myśl o systemie jako spójnej całości ze ścieżkami wyborów”)

**Kontekst:** PG sprawdzał tylko cykle importów i kierunek warstw (`bin/module-boundaries.js`, pre-push). Kryterium podziału
(Parnas: moduł = sekret; moduły wokół pojęć biznesowych, nie warstw; cohesion/coupling/connascence) nie było mierzone. Pomiar
`--report` na workshop-app (2026-10-17, commit `9d9c61c`): `jobs` znana w 18 modułach, 269 importów wnętrza cudzych slice'ów,
0/37 slice'ów z `index.ts`, `src/routes` odpytuje 3 tabele. Brak incydentu produkcyjnego → zasada proporcjonalności: zero nowych blokad.
Audyt makro PG (2026-10-18) znalazł: każdy błąd narzędzia w pre-push wyglądał jak werdykt („nowy cykl”) i blokował push; ręczne
uruchomienia zaśmiecały metrykę; bramka fail-open padająca seryjnie byłaby niewidoczna.

**Decyzja — jedna ścieżka dla każdej reguły PG (od deklaracji do blokady):**

| Krok | Mechanizm | Dla granic modułów |
|---|---|---|
| 1. Deklaracja repo | `CLAUDE.md` / `docs/ARCHITECTURE.md` (szablon `templates/repo/`) | blok json: `owners`, `maxTableModules`, `vendors`, `adapters`; `pg.code_lang: en` |
| 2. Pomiar stanu (audyt, nie bramka) | `--report` | tabele→moduły, moduły domenowe vs techniczne, importy wnętrza, SDK, change amplification |
| 3. Wykrycie w diffie (observe) | pre-push `SEKRET (ostrzeżenie)` / `pg-prechecks` | cudza tabela, SDK poza adapterem, import wnętrza slice'a **z kontraktem**; `CODE-LANG` tylko przy deklaracji |
| 4. Ocena | recenzent (code/product), słownik w karcie `sd/01 › Dekompozycja` | spójność 1–7, sprzężenie content→data, nazwa = pojęcie z GLOSSARY |
| 5. Telemetria | `gates.jsonl` tylko z `--from pre-push`: `ran`/`blocked`/`would_block`/`skipped` | mianownik do kalibracji progu |
| 6. Zdrowie bramki | `guard_health`: `skipped "<narzędzie>: blad narzedzia (exit N)"` w ≥ 3 pushach (repo + minuta; kilka refów jednego pusha = 1) w 7 dni = RED z repo, czasem i powodem | dla każdej bramki fail-open (też merge-integrity) |
| 7. Awans do blokady | tylko po incydencie: wpis w `pg/cases.md` + nowy ADR | dziś: żadna reguła SEKRET/CODE-LANG nie blokuje |

Kody wyjścia narzędzi bramek: 0 = OK, 1 = werdykt (blok), 2 = błąd narzędzia (ostrzeżenie, hook zapisuje `skipped`, push idzie);
śmierć procesu (≥ 128) = jak 2. Błąd ładowania skryptu (node → 1) blokuje — fail-closed, świadomie.

**Rozważone alternatywy:** blokada SEKRET od razu (odrzucona: brak incydentu, Warsztat dałby setki fałszywych blokad na długu);
log `skipped` ze skryptu (odrzucony: OOM/SIGKILL nie zostawia śladu — loguje hook); osobna bramka językowa w pre-commit
(odrzucona: kandydat z regexu ≠ werdykt, tekst UI bez i18n to inny problem — ocenia recenzent); hook name `module-boundaries` dla
błędów (odrzucone: łamie istniejącą konwencję merge-integrity; guard_health grupuje po prefiksie powodu).

**Konsekwencje:** nowe repo dostają deklaracje z szablonu; stare repo bez deklaracji = cisza (ZAKRES). Ostrzeżenia SEKRET i
kandydaci CODE-LANG kosztują recenzenta chwilę uwagi. Ryzyko: wyciek sekretu przechodzi (tylko ostrzeżenie) do pierwszego incydentu.

**Jak cofnąć:** `git revert` commitów 2dcf058..HEAD z 2026-10-18 + `ALLOW_CONTROL_PLANE=1 node bin/pg-seal.js`. Pojedynczo:
SEKRET = `secretLeaks` w `bin/module-boundaries.js`; RED błędów narzędzia = `TOOL_ERROR_RED` w `hooks/guard_health.py`;
CODE-LANG = reguła w `bin/pg-prechecks.js` + linia `pg.code_lang` w `templates/repo/CLAUDE.md`.

**Sygnał powrotu:** (a) incydent z wycieku sekretu modułu (zmiana tabeli/dostawcy psuje cudzy moduł) → awans tej jednej reguły
do blokady wg `pg/GLOSSARY.md` › Jak dodać bramkę; (b) `would_block` SEKRET / `ran` > 30 % przez 2 tygodnie → próg do kalibracji
(szum); (c) RED błędów narzędzia → naprawa narzędzia, nie wyłączenie. Przegląd razem z ADR-0007: 2026-11-12.

**Aktualizacja 2026-10-24 (1 ADR = 1 decyzja):** ten ADR to PAKIET 3 decyzji z jednej retro, spisany przed regula z szablonu (`templates/repo/docs/adr/0000-template.md`). Nie rozbijamy go wstecz (historia i odsylacze zostaja). Zmiana albo wycofanie ktoregokolwiek mechanizmu = NOWY ADR z linia `Zastepuje: ADR-0008 › <mechanizm>`, a tu dopisek `zastapione czesciowo przez ADR-XXXX`.

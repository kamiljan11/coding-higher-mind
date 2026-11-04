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
| OUTBOUND / `via` | `gate` wpisow hooka `outbound-observe` (wysylka MCP; observe). `via` = klasa pierwszego odczytu tresci obcej w sesji przed wysylka: `mail` / `web` / `browser`; brak `via` przy `ran` | `hooks/outbound-observe.js`, `hooks/outbound_health.py`, ADR-0011 |
| `observe-channel` | prefiks `reason` wpisow `bash-guard` dla panelu Terminal (`mcp__terminal__run_in_terminal`; observe): `observe-channel:rule:<id>` = trafiona regula, `observe-channel:sudo`; komenda > limitu = `skipped` | `hooks/bash-guard.js`, ADR-0011 |
| Stały kontekst | kontekst pierwszej odpowiedzi sesji (input + cache) = załączniki (CLAUDE.md, lista skilli, odroczone narzędzia MCP, hooki SessionStart/UserPromptSubmit, agenci) + prompt systemowy i schematy narzędzi CC; płacony przy każdym wywołaniu (z cache). Pomiar 2026-11-04: mediana 80k tok W39 -> 91k; uruchom przed i po zmianie CLAUDE.md, skilli, hooków startu albo listy MCP | `bin/context-budget.py` (`--baseline RRRR-MM-DD`) |
| observe / enforce | tryb reguly: observe loguje `would_block` i przepuszcza, enforce blokuje | `hooks/lib/bash-rules.js` (pole `mode`) |
| Log bramek | `logs/gates.jsonl`, pole `event`: blocked / bypass / would_block / skipped / ran / suppressed; `redirected` = slad testow. Od Fali 0 (2026-11-01): `gate` = nazwa bramki przy `blocked` z git-hookow (sufiks ALLOW_X albo narzedzie, `UNKNOWN` = wyjscie bez nazwy); `origin` = skad wpis (test / tmp / agent / human — NIE git remote); `ep` = `CLAUDE_CODE_ENTRYPOINT`. `bypass` = zadeklarowany wyjatek; obejscie blokady = para `blocked` -> `bypass` tej bramki (design `pg/designs/2026-11-01-fala-0-pomiar.md` §11) | `hooks/lib/gate-log.js`, `hooks/guard_health.py` |
| Incydent bramki | seria `blocked` jednej bramki (hook, gate, target) bez przerwy > 30 min; `bypass` ALLOW_X zamyka najstarszy otwarty, kolejny `blocked` po zamknieciu = nowy incydent | `hooks/gate_effectiveness.py` (`gate_effectiveness`), `pg/designs/2026-11-01-fala-0-pomiar.md` §11.3 |
| Obejscie po blokadzie | `bypass` zamykajacy incydent — sygnal do ZBADANIA bramki (Tricorder: efektywny falszywy alarm), nie werdykt | `hooks/gate_effectiveness.py` (wydruk w `hooks/guard_health.py`, sekcja SKUTECZNOSC BRAMEK) |
| Rejestr wynikow recenzji | `logs/review-outcomes.jsonl`: wiersz per grupa findings z pg-review, `outcome` z zamknietej listy (fixed / dropped:<powod> / kept_note / verifier_dropped); `run_key` = skrot katalogu RUN + grup (idempotencja) | `bin/pg-outcome.js` |
| Nieprzydatne (recenzja) | (dropped:false_positive + verifier_dropped) / (fixed + wszystkie dropped:* + verifier_dropped), per dzial i rule_id; cel < 10 % (Tricorder), n < 5 = za malo danych | `hooks/gate_effectiveness.py` (`review_outcome_lines`) |
| P1-lite / plan-rubric | ocena planu (pliku designu T2+) PRZED kodem: samoocena autora wg rubryki, swiezy recenzent przy pieniadzach/auth/tenantach, `plan-refs-check` na sciezkach i funkcjach planu; wynik w sekcji „Status recenzji” pliku designu (observe od 2026-11-01) | `pg/plan-rubric.md`, `bin/plan-refs-check.js` |
| Kompakcja L0-L6 | warstwy pamieci odpornej na kompakcje (plan 2026-11-01, Obsidian `Knowledge/PG - plan P7 pamięć odporna na kompakcję 2026-11-01.md`; „P7” = numer w planie ulepszen, NIE punkt P7 z `pg/prr.md`). L0 = sekcja „Compact Instructions” w `CLAUDE.md` (co streszczenie ma zachowac doslownie); L2 = migawka + indeks sesji (wszystkie polecenia, pliki, agenci, wklejki) przed kompakcja; L3 = streszczenie kompakcji na dysk (PostCompact, `<sid>.summary.md`); L4 = wskaznik do streszczen we wstrzyknieciu po kompakcji; L1 = przypomnienie Stop o checkpoincie sesji przy 70/85 % `autoCompactWindow` (kontekst z `usage` w transkrypcie, observe; checkpoint `Claude Memory/Checkpoints/<data> <sid8> <projekt>.md`); L5 = sekcja „Pamiec sesji” w notatce SessionEnd (wikilink do checkpointu + sciezki indeksu, streszczen i migawki precompact); L6 = testy: L6a test zloty migawki (`bin/test_hooks_v3.js` › „precompact L2”), L6b goldfish 2026-11-02 10/10 (wynik w notatce planu P7), L6c (streszczenie z/bez L0) czeka na probke sprzed L0 | `hooks/precompact-snapshot.js`, `hooks/postcompact-summary.js`, `hooks/context-checkpoint.js`, `hooks/session-context.js`, `hooks/auto-doc.py`, `pg/known-limits.md` › precompact-snapshot |
| EGM | Elephant Goldfish Model (publiczne repo Google, blog 2026-10-22): proces planu zmiany — plik designu, recenzja planu przez swiezy kontekst, rozstrzyganie uwag z dowodem (`egm-resolve`). PG wzial z niego plik designu T2+, dyscypline odrzucania i sekcje Niezmienniki (porownanie i plan: Obsidian `Knowledge/PG - plan ulepszeń skonsolidowany (EGM + Google + eksperymenty) 2026-11-01.md`) | `pg/design.md`, `skills/pg-review/SKILL.md` krok 4 |
| Ucieczka | jednostka (commit nie-fix) w tierze, ktorej pliki poprawil `fix:` w ciagu N dni; proxy bledow, ktore przeszly przez bramki | `bin/pg-escapes.py` |
| Drzwi jednokierunkowe | 9 obszarow `one_way` (podzial uslug, bazy danych, generowanie ID, pliki/blob, kontrakt API, tozsamosc i uprawnienia, multi-region i DR, DNS i routing, cloud building blocks) — decyzja ZAWSZE przed kodem | `pg/design.md`, `pg/sd-areas.json` |
| Blizna | realny incydent, z ktorego wyrosla bramka | `pg/cases.md` |
| Sygnal powrotu | warunek, przy ktorym cofamy decyzje (pole ADR) | `templates/repo/docs/adr/0000-template.md` |
| Aktywne repo | commit na galezi domyslnej albo PR wlasciciela w ostatnich 30 dniach | `bin/fleet-active-repos.py`, ADR-0006 |
| Dzien przegladu floty (sweep) | dzien z ruchem w >= 8 repo naraz = praca PG na flocie, nie projekt | `pg/fleet-scope.json` (`sweep_min_repos`) |
| pin / exclude | pin = repo sprawdzane zawsze; exclude = nigdy (travel-site) | `pg/fleet-scope.json` |
| Sekret modulu (Parnas) | decyzja, ktora modul ukrywa, bo moze sie zmienic (schemat tabeli, dostawca, format); obcy modul jej nie zna | `pg/paradigm.md` › Kryterium podzialu; kolumna „Sekret" w `docs/ARCHITECTURE.md` |
| Spojnosc / sprzezenie (cohesion / coupling) | spojnosc: czy elementy modulu sluza jednemu celowi (7 poziomow Yourdon/Constantine); sprzezenie: ile modul musi wiedziec o innym. Cel: wysoka spojnosc w srodku + luzne powiazanie na zewnatrz | karta `sd/01-fundamenty.md` › Dekompozycja wewnatrz monolitu |
| Connascence | A i B konascentne, gdy zmiana A wymusza zmiane B; silna tylko wewnatrz modulu, miedzy modulami tylko slaba (nazwa, typ). Ostrzezenie pre-push `SEKRET` = connascence ponad granica | `bin/module-boundaries.js` (`owners`, `shared` = tabele przekrojowe tenant/profil poza liczeniem, `--report`) |
| Sprawdzacz jezyka | kompilator/linter wolany przez hooki po edycji pliku w danym jezyku (go vet, cargo clippy, shellcheck, javac, gcc, php -l, dotnet build, deno check); brak = `skipped: no checker for .ext` | `hooks/lib/lang-checkers.js`, ADR-0010 |
| Kod na zapas (YAGNI) | nowy eksport / def bez zadnego uzycia w repo; pre-push ostrzega (observe) | `bin/unused-export-gate.js`, ADR-0010 |
| Change amplification | ilu modulow dotyka jeden commit z kodem; wiele > 3 = granice zle postawione | `bin/module-boundaries.js --report` |

## Jak dodac bramke (proporcjonalnosc: bez incydentu nie ma blokady)

1. Realny incydent -> wpis w `pg/cases.md` (co sie stalo, dowod). Brak incydentu = brak bramki.
2. Regula najpierw w trybie `observe` (albo ostrzezenie) — zbiera `would_block` w `logs/gates.jsonl`.
3. Bramka w git-hooku: kazde `exit 1` poprzedza `pg_gate=NAZWA` (inaczej `blocked` loguje sie jako `UNKNOWN`, design Fali 0 §11.1). Test w baterii (`bin/test_hooks_v3.js` / `bin/test_slop_gates.js`); `bin/pg-mutate.js` musi zabic mutanta (wylaczona regula = czerwony test).
4. Po danych (trafienia vs falszywe alarmy) -> `enforce`; komunikat podaje poziom wyjatku A/B/C.
5. ADR w `pg/adr/` z „Sygnalem powrotu”; zmiana warstwy kontrolnej = fraza CONTROL_PLANE + nowa pieczec.

Kody wyjscia narzedzia bramki: 0 OK, 1 werdykt (blok), 2 blad narzedzia -> hook ostrzega i sam loguje `skipped "<narzedzie>: blad narzedzia (exit N)"`; `guard_health` = RED przy >= 3 w 7 dni (bramka fail-open martwa). Pelna sciezka deklaracja -> pomiar -> observe -> ocena -> telemetria -> zdrowie -> awans: `pg/adr/0008`.

Wiedza raz (2026-10-19): prog, lista, liczba i nazwa maja JEDNEGO wlasciciela (plik w `pg/INDEX.md` / `bin/README.md`); reszta odsyla.
Liczba przepisana do `CLAUDE.md` / `pg/ref-*.md` niesie kotwice `(src: sciezka)`, a `bin/claims-check.py` pilnuje zgodnosci. Luka w regule
= poprawka u wlasciciela, nie kopia u konsumenta. Procedura pracy nad PG: skill `pg-maintain`, przed commitem `bin/pg-self-check.py`.

Cofniecie bramki: `git revert` jej commita (ADR-0007 pokazuje miejsca w kodzie dla kalibracji progow).

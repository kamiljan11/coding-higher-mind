---
name: pg-landscape-finish
description: Jednorazowo: dokończ research porównujący PG (Coding Higher Mind) z ~35 repo z GitHuba, zbierz wszystkie notatki w jedną notatkę w Obsidianie z planem działania i zbuduj miesięczną routine obserwującą te repo
model: sonnet
---

Dokończ research: PG (Coding Higher Mind, instalacja w ~/.claude, publiczne repo <github-owner>/coding-higher-mind) vs projekty na GitHubie o podobnej idei. Odpowiadaj po polsku, zwięźle (tabele > proza), każde twierdzenie z dowodem (plik:linia albo wynik komendy). NIE zmieniaj niczego w PG ani w repo na Pulpicie; nie pushuj niczego.

## 0. Idempotencja i budżet
- Jeśli istnieje ~/.claude/memory/PG - Landscape 2026-09.md z linią "Status: COMPLETE" -> przejdź tylko do kroku 5 (routine), jeśli jej brak; potem zakończ.
- Sprawdź limit narzędziem mcp__ccd_session_mgmt__get_usage. Jeśli "Weekly · all models" >= 80% -> zapisz stan do ~/.claude/memory/RESUME.md (tryb append, nie nadpisuj) i zakończ.
- Hamulec obowiązuje przez CAŁE zadanie: sprawdzaj ten sam limit przed każdą paczką subagentów w kroku 2, przed krokiem 4 i przed krokiem 5. Przy >= 80% dokończ tylko bieżący krok, zapisz w RESUME.md (append) co zrobione i co zostało (lista repo bez analizy, brakujące sekcje notatki), i zakończ. Nie odpalaj nowych agentów po przekroczeniu progu.

## 1. Zbierz to, co już zrobiono (21.09)
Dwa przebiegi workflow zapisały wyniki agentów w dziennikach (JSONL; linia {type:"started",key,label} i {type:"result",key,result}):
- R1: ~/.claude/projects/C--Users-uzytkownik-Jan-Desktop/84838410-277a-47b0-b1b0-e466ea44c03d/subagents/workflows/wf_81cffa79-0f5/journal.jsonl — etykiety: discover:*, pg-inv:code, pg-inv:doctrine, select, deep:<repo>, verify:<repo>, judge, critic.
- R2: .../subagents/workflows/wf_61135c97-f13/journal.jsonl — deep:<repo>, verify:<repo> dla 19 najpopularniejszych repo.
- R3 (głębokie czytanie kodu egzekwującego 15 repo, które R1/R2 przeczytały płytko: ECC, gstack, open-code-review, compound-engineering, destructive_command_guard, failproofai, aidlc-workflows, desloppify, claude-code-harness, pilot-shell, zeroshot, babysitter, oh-my-agent, moai-adk, archgate/cli): .../subagents/workflows/wf_89beefb8-f69/journal.jsonl — etykiety read:<repo>#<i>/<n> (fragmenty kodu, lista plików w .../scratchpad/pgscan/chunks.json), verify:<repo>, judge-final (gotowy plan i raport, jeśli runda doszła do końca). Dla tych 15 repo R3 ma pierwszeństwo nad R1/R2. Jeśli brakuje wyniku read:<chunk>, uzupełnij ten fragment: przeczytaj W CAŁOŚCI pliki z chunks.json dla tego id. Jeśli judge-final istnieje, użyj go jako bazy notatki (sprawdź tylko spójność) zamiast pisać od nowa.
- Gotowe już w Obsidianie: "Claude Memory/PG - Landscape runda 1 - 2026-09-21.md" (raport R1 + krytyk) i ewentualnie "Claude Memory/PG - Landscape analizy repo.md" (analiza każdego repo).
- Zbiorczo R1+R2 (inwentarze + werdykty): .../scratchpad/pgscan/all.json.
Zmapuj key->label, wyciągnij wyniki (result bywa dict albo string JSON). Klony repo są w $TMP/claude (jeśli zniknęły: git clone --depth 1 do tego katalogu).

Lista docelowa (35 repo): z R1 (select) 16 repo + R2: obra/superpowers, affaan-m/ECC, garrytan/gstack, addyosmani/agent-skills, alibaba/open-code-review, EveryInc/compound-engineering-plugin, diet103/claude-code-infrastructure-showcase, Dicklesworthstone/destructive_command_guard, FailproofAI/failproofai, awslabs/aidlc-workflows, peteromallet/desloppify, Chachamaru127/claude-code-harness, nizos/tdd-guard, trailofbits/claude-code-config, maxritter/pilot-shell, first-fluke/oh-my-agent, modu-ai/moai-adk, a5c-ai/babysitter, the-open-engine/zeroshot.

## 2. Uzupełnij brakujące
Dla każdego repo bez wyniku deep:<repo> albo verify:<repo> odpal subagenta (Agent, model sonnet, równolegle po kilka):
- deep: sklonuj --depth 1 do katalogu pgscan/repos, policz pliki (git ls-files | wc -l), przeczytaj W CAŁOŚCI kod egzekwujący (hooki, skrypty, CLI, CI, instalatory, definicje agentów), README i główne docs; przy >300 plikach dodatkowo indeks skilli/agentów + min. 25 reprezentatywnych plików, i wypisz co pominięto. Zwróć: repo, stars, license, install, total_files, files_read_fully, files_read_list, warstwy (prompt_hardening, edit_gate_lint_types, command_guard, stop_gate, escalation_to_human, git_hooks, ci_templates, reviewer_agents, finding_aggregation_evidence, risk_tiering, gate_telemetry, tests_of_the_gates, override_mechanism, doctrine_docs, memory_context, portability — każda "none" albo opis z plik:linia), unique_ideas [{idea, evidence, value_for_pg, effort}], weaknesses. Bądź uczciwy: szukaj, co robią LEPIEJ niż PG.
- verify: dla każdego unique_idea otwórz cytowany plik:linia i spróbuj obalić (confirmed/refuted/partial/cannot_check + dowód), sprawdź grepem czy PG już to ma (hooks/, bin/, git-hooks z `git config --global core.hooksPath`, pg/, agents/, skills/).

## 3. Spot-check jakości (sam, bez agentów)
Dla 4 losowych repo otwórz po 2 cytowane dowody i sprawdź, czy plik:linia faktycznie to mówi. Repo, gdzie agent czytał mało (files_read_fully < 30% plików wykonawczych) albo dowód się nie zgadza -> oznacz "PŁYTKO" w notatce.

## 4. Notatka końcowa
Zapisz ~/.claude/memory/PG - Landscape 2026-09.md (nowy plik; frontmatter: type: memory, date, tags [memory, pg]):
1. Metodologia: zapytania, pula kandydatów (R1 discover), wybór, co pominięto i dlaczego, ile plików przeczytano per repo.
2. Analiza KAŻDEGO z 35 repo osobno: gwiazdki, licencja, instalacja, pliki przeczytane/wszystkie, warstwy (tylko nie-"none"), pomysły z werdyktem weryfikatora, słabości, znacznik PŁYTKO jeśli dotyczy.
3. Macierz: warstwy PG × (PG + 35 repo): ✓ / ~ / ✗.
4. Co ma PG, czego nie ma nikt (z dowodem; tylko jeśli żadne z 35 repo tego nie ma).
5. Co mają inni, czego PG nie ma / robi gorzej (tylko confirmed/partial; obalone osobno).
6. PLAN DZIAŁANIA: ranking wartość/wysiłek, max 15 pozycji; dla każdej: źródło (repo + plik), co dokładnie, gdzie w PG wpiąć (plik), wysiłek S/M/L, jak zmierzyć że działa (test/bramka). Uwzględnij już znane z 21.09: eskalacja do człowieka po N blokadach (pilot-shell spec_stop_guard.py), wyjątki od bramek potwierdzane przez człowieka zamiast ALLOW_* w komendzie (ECC), ochrona tsconfig/konfiguracji także przy edycji przez Bash, testy skilli pod presją (superpowers writing-skills), tier ryzyka z treści diffu.
7. Słabości PG z inwentaryzacji (pg-inv:code, pg-inv:doctrine) z dowodami.
8. Pozycjonowanie PG na tle rynku.
Na końcu: "Status: COMPLETE" (albo UNVERIFIED z listą braków). Dopisz 1 linię do ~/.claude/memory/Projects.md w trybie append (nie nadpisuj pliku).

## 5. Routine obserwująca (0 tokenów, model tylko przy zmianach)
- Zapisz ~/.claude/pg/landscape/watchlist.json: dla 35 repo + PG: repo, stars, pushed_at, HEAD sha z dnia analizy (GitHub API przez most: `infisical run --env=dev -- <komenda>`; tokenu nigdy nie wypisuj), plus lista zapytań discovery z R1 (queries_run).
- Napisz ~/.claude/bin/pg-landscape-watch.py (stdlib only, token z env GITHUB_Token): (a) dla każdego repo porównaj HEAD z zapisanym sha; policz commity; wypisz zmienione pliki tylko w ścieżkach hooks|scripts|bin|agents|skills|.github/workflows|src (pomiń *.md poza SKILL.md/AGENTS.md); nowe release'y; (b) uruchom zapytania discovery, zgłoś repo spoza listy z >500 gwiazdek albo wzrostem >200 gwiazdek od ostatniego skanu (trzymaj stars history w watchlist.json); (c) zapisz JSON raportu do ~/.claude/logs/pg-landscape-watch/<data>.json; exit 0 gdy brak istotnych zmian, exit 10 gdy są. Dodaj test (tests/ lub bin/test_pg_landscape_watch.py) z danymi syntetycznymi i uruchom go — zielony przed zakończeniem.
- Utwórz scheduled task `pg-landscape-watch` (mcp__scheduled-tasks__create_scheduled_task), cron "12 9 2 * *" (2. dzień miesiąca), opis: miesięczny skan zmian w repo podobnych do PG. Jego prompt: uruchom skrypt przez most; exit 0 -> dopisz jedną linię "bez zmian" do ~/.claude/memory/log/pg-landscape-watch.md (append) i zakończ bez modelu; exit 10 -> subagent (sonnet) czyta diffy zmienionych plików i nowe repo, ocenia każde jednym zdaniem "czy PG powinien to przejąć i gdzie", dopisuje sekcję do tego logu, aktualizuje sha/stars w watchlist.json; NIGDY nie zmienia PG; przy czymś o wysokiej wartości -> PushNotification.

## 6. Raport
Krótko: ile repo przeanalizowano (z R1/R2/uzupełnione dziś), ile PŁYTKO, top 5 z planu, ścieżka notatki, czy routine utworzona i czy test zielony. Status VERIFIED/UNVERIFIED/FAILED.
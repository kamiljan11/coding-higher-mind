# ADR-0003: Recenzja pg-review w CI jako dowód auto-merge

Data: 2026-10-04 | Status: przyjęte (decyzja uzytkownika: „docelowo recenzja w CI na świeżym checkoucie”)

**Kontekst:** Auto-merge (`bin/pg-merge-bezpieczny.py`) przyjmował jako dowód recenzji tylko lokalne transkrypty subagentów. Security-review r8 wykazał, że agent kontrolujący środowisko może je podrobić (`sed -i` na `~/.claude/projects`, podmiana agenta przez `claude --agents` albo tar/checkout). uzytkownik przyjął to ryzyko i włączył auto-merge, ale chciał docelowo dowodu, którego agent nie wytwarza.

**Decyzja:** Workflow `templates/repo/.github/workflows/pg-review.yml`. Uruchamia `claude -p` (CLI 2.1.283 przypięte, OAuth z subskrypcji, `--restricted --strict-mcp-config --tools Read,Grep,Glob`, konfiguracja Claude przywrócona z bazy) na diffie base...head w świeżym runnerze. Job `pg-review` jest zielony tylko przy APPROVE bez blocker/major, z `diff_sha256` i pełnym `diff_lines_read`. Błąd infrastruktury daje SKIPPED. pg-merge bez `--recenzja` przyjmuje go jako dowód T1/T2 wyłącznie przez Actions API: przebieg z tej ścieżki, ten PR, pierwsza próba, wszystkie przebiegi head zielone, żaden obcy check o tej nazwie, a ten sam diff nie dostał wcześniej REQUEST_CHANGES (adnotacja `pg-review-verdict`).

**Rozważone alternatywy:** (1) samo dokładanie reguł przeciw podrabianiu lokalnych dowodów: 8 rund pokazało, że to się nie zbiega; (2) `claude-code-action` z komentarzem: werdykt nieczytelny maszynowo; (3) człowiek przy każdym PR: bezpieczne, ale uzytkownik chce autonomii.

**Konsekwencje:** Dowód poza zasięgiem lokalnego agenta. Każde repo potrzebuje workflow na gałęzi bazowej (`mas-quality-init.sh`) i sekretu `CLAUDE_CODE_OAUTH_TOKEN`; dziś ma go tylko demo-site. `quality.yml` dostał `permissions: contents: read`.

**Koszt cykliczny:** 0 zł ponad subskrypcję. Zużywa tygodniowy limit: 1 sesja sonnet na push do PR (pomijane drafty i PR z samą dokumentacją, concurrency anuluje starsze przebiegi).

**Pułapki dla przyszłego siebie:** Jeden recenzent LLM = dowód probabilistyczny (prompt injection z diffu, brak k-of-n). Agent z prawem push może zmienić workflow w porzuconym PR i odczytać sekret. Szczegóły w `pg/known-limits.md`. Zmiana nazwy jobu albo ścieżki workflow wymaga zmiany `CI_RECENZJA`/`CI_WORKFLOW` w pg-merge.

**Aktualizacja 2026-10-04 (recenzja r9, commity 75769c5 i 7a766c6):**
- Historia werdyktów: wszystkie przebiegi `pg-review.yml` z 90 dni (pełne stronicowanie), a nie 100 ostatnich. GitHub obcina filtrowane zapytanie do 1000 wyników, więc ≥ 1000 przebiegów w oknie = LUKA (r10) — zapchanie okna daje odmowę, nie ukrycie odrzucenia.
- Detektor usunięć w oknie 90 dni: dziura w numeracji albo granica okna (ostatni przebieg sprzed okna ≠ najstarszy w oknie − 1) daje LUKA (r11; globalne `run_number` > `total_count` usunięte, bo stare kasowanie albo retencja blokowały repo na stałe). Przebieg po rerunie jest czytany z jobami wszystkich prób (`filter=all`), więc RC z próby 1 zostaje widoczny (r10; w r9 rerun dawał LUKA dla całego repo).
- Odrzucenie w dowolnym formacie (proza, `request changes`, `REJECT`) zapisuje się jako REQUEST_CHANGES przed kontrolami kompletności. INFRA nie jest już darmowym ponownym losowaniem.
- Instalacja CLI: 3 próby. Błąd daje INFRA z opisem, a nie mylące „limit subskrypcji”.
- Odrzucona alternatywa: adnotacja z hashami ścieżek przeciw losowaniu przez nową gałąź i nowy PR. Koszt i złożoność są za duże wobec ryzyka przyjętego przez uzytkownika. Zostaje jako ograniczenie w `pg/known-limits.md`.
- Założenia: workflow ma wyłącznie trigger `pull_request` i nikt nie kasuje jego przebiegów. Inaczej LUKA na stałe i trzeba użyć ścieżki `--recenzja` albo frazy.

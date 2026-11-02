# PG — indeks wlascicieli (generowany)

Generowane przez `bin/pg-map.py` z naglowkow plikow — nie edytuj recznie. To WSKAZNIKI: kto jest wlascicielem tematu.
Regul, progow i liczb tu nie ma (parafraza dryfuje) — przed decyzja otworz plik.

## hooks/

| Plik | Wlasciciel czego |
|---|---|
| `hooks/auto-doc.py` | auto-doc — notatka z sesji Claude Code do katalogu notatek (hook SessionEnd). |
| `hooks/bash-guard.js` | PreToolUse hook (matcher: Bash/PowerShell/mcp__desktop-commander__start_process/interact_with_process) — twarde bramki na komendy, ktore reguly CLAUDE.md … |
| `hooks/edit-guard.js` | PreToolUse hook (Edit/Write/MultiEdit/NotebookEdit/desktop-commander write_file/edit_block/move_file) — landscape 2026-09-26. |
| `hooks/gate_effectiveness.py` | Skutecznosc bramek git-hookow (G3) i wyniki recenzji (G4) — czyste funkcje, wolane z guard_health.py (jak lang_gap_health). |
| `hooks/guard_health.py` | Guard-health: deterministyczny audyt calego systemu jakosci (0 tokenow AI). |
| `hooks/lang_gap_health.py` | Ocena luk jezykowych z telemetrii gates.jsonl (ADR-0010) — czyste funkcje, wolane z guard_health.py. |
| `hooks/loop-monitor.js` | PostToolUse hook (wszystkie narzedzia) — landscape #17. Loop Guardrails z CLAUDE.md („ten sam tool + ten sam blad 2x -> zmien podejscie") istnialy tylko proza … |
| `hooks/memory-guard.js` | PreToolUse hook (matcher: mcp__desktop-commander__write_file) — v3 (2026-09-05). |
| `hooks/post-bash-edit-check.js` | PostToolUse hook (matcher: Bash/PowerShell) — edycje kodu przez sed -i / heredoc / redirect / |
| `hooks/post-edit-check.js` | PostToolUse hook (globalny) — po KAZDEJ edycji pliku (Edit / Write / MultiEdit / NotebookEdit / mcp__desktop-commander__write_file / … |
| `hooks/precompact-snapshot.js` | PreCompact hook: migawka sesji + indeks (wszystkie polecenia, pliki, agenci, wklejki) przed kompakcja (2026-09-26, kompakcja L2 2026-11-01, pg/GLOSSARY.md › … |
| `hooks/prompt-guard.js` | UserPromptSubmit hook — wstrzykuje PG-core do KAZDEGO niebanalnego promptu w Claude Code. |
| `hooks/session-context.js` | SessionStart hook (startup/resume/clear/compact) — wstrzykuje pamiec sesyjna z Obsidiana do kontekstu DETERMINISTYCZNIE (stdout => kontekst). |
| `hooks/stop-gate.js` | Stop hook (globalny) v3 (2026-09-05). Claude Code nie moze zakonczyc odpowiedzi, gdy w repo, ktorego DOTYKAL w tej sesji, sa: (1) bledy lintu/typow w … |

## hooks/lib/

| Plik | Wlasciciel czego |
|---|---|
| `hooks/lib/arch-signals.js` | arch-signals (2026-10-04, decyzja uzytkownika: architektura pilnowana TWARDO przy T2+): czy diff zmienia ARCHITEKTURE. |
| `hooks/lib/bash-rules.js` | Reguly bash-guard jako czysta funkcja (landscape #3/#4/#13/#19/#20). Hook (hooks/bash-guard.js) = cienka powloka: wejscie -> evaluate() -> exit code. |
| `hooks/lib/changed-lines.js` | Liczba zmienionych linii, ktora decyduje o progu T2/T3 (risk-tier.js). Jedno zrodlo dla stop-gate (niezacommitowane zmiany sesji) i dla pg-review krok 0 … |
| `hooks/lib/css-balance.js` | Bilans nawiasow {} () [] — bramka 0-tokenowa (lekcja 2026-10-06: niedomkniety @media przeszedl lint, tsc, vitest, build i qa-matrix, bo parser CSS jest … |
| `hooks/lib/gate-log.js` | Telemetria bramek. Kazdy hook zapisuje ran / skipped / blocked do ~/.claude/logs/gates.jsonl. |
| `hooks/lib/lang-checkers.js` | Kompilatory/lintery jezykow poza TS/JS/Python dla hookow (go, rust, shell, java, c/c++, php, c#, deno) — lista + wywolanie. |
| `hooks/lib/lint-file.js` | Wspolna logika lint + typecheck dla hookow: post-edit-check (Edit/Write/MCP), post-bash-edit-check (sed / heredoc / redirect) i stop-gate (wszystko zmienione w … |
| `hooks/lib/name-lang.js` | name-lang (2026-10-24, observe): NOWE nazwy (repo, galaz, katalog, plik) po polsku. |
| `hooks/lib/overrides.js` | overrides: wyjatki od bramek poziomow A/B/C — TTL i limity uzyc (POLICY; wlasciciel liczb cytowanych w CLAUDE.md). |
| `hooks/lib/protected-paths.js` | Jedno zrodlo prawdy „co jest warstwa kontrolna PG" dla bash-guard (komendy) i edit-guard (Edit/Write/MCP). |
| `hooks/lib/risk-tier.js` | Router ryzyka (deterministyczny, 0 tokenow). Klasyfikuje zmiane do tieru T0..T3 na podstawie |
| `hooks/lib/shell-parse.js` | Parser powloki dla bash-guard (landscape #13). Reguly regexowe na SUROWEJ komendzie dawaly exit 0 na: `sh -c "rm -rf src"`, `x=$(rm -rf src)`, `'r'm -rf src` … |

## git-hooks/

| Plik | Wlasciciel czego |
|---|---|
| `git-hooks/commit-msg` | Globalny commit-msg (PG, 2026-09-05): Conventional Commits. |
| `git-hooks/pre-commit` | Globalny pre-commit (PG quality gate) — dziala w KAZDYM repo na tej maszynie (git config --global core.hooksPath). Czerwone = commit nie istnieje. |
| `git-hooks/pre-push` | Globalny pre-push (PG): blokuje BEZPOSREDNI push na main/master w projektach |

## agents/

| Plik | Wlasciciel czego |
|---|---|
| `agents/catfish.md` | Dzial DYSYDENT / adwokat diabla w naradzie pg-council (nie w review). Widzi zebrane fakty (pool.json) i opcje |
| `agents/code-reviewer.md` | Dzial ENGINEERING (finder). Recenzja czytelnosci, poprawnosci, testow i observability diffu — read-only, |
| `agents/data-reviewer.md` | Dzial DATA / DBA (finder). Migracje, schemat, indeksy, constrainty, RLS-kompletnosc nowych tabel, N+1, |
| `agents/landscape-reader.md` | Czytelnik NIEZAUFANEJ tresci z obcych repo (diffy, README) dla routine pg-landscape-watch. Jedyne narzedzie: |
| `agents/ops-reviewer.md` | Dzial SRE / OPS / RELEASE (finder). Sciezka deployu (Lovable vs Vercel), flagi srodowiska, timeouty i |
| `agents/product-reviewer.md` | Dzial PRODUCT / DOCS / HANDOVER (finder). Czy zmiana rozwiazuje NAZWANY problem, trzyma non-goals, |
| `agents/qa-reviewer.md` | Dzial QA / TESTER (finder, opcjonalny — na zadanie). Uruchamia APLIKACJE, nie czyta tylko diffu: kryterium |
| `agents/security-reviewer.md` | Dzial SECURITY / AppSec (finder, T3; opcjonalnie T2 z API). STRIDE + OWASP ASVS L2-lite + blizny floty |
| `agents/ux-reviewer.md` | Dzial UX / FRONTEND / a11y / i18n (finder). Stany UI, slownik IS/PL/EN, waluty/daty, dostepnosc, |
| `agents/verifier.md` | WERYFIKATOR findings (po agregacji). Swiezy kontekst, nastawiony na OBALENIE: dla kazdego findingu |

## pg/

| Plik | Wlasciciel czego |
|---|---|
| `pg/GLOSSARY.md` | Slownik terminow PG i procedura dodania bramki — dla obcego seniora przejmujacego ~/.claude |
| `pg/cases.md` | PG · CASES — biblioteka przypadkow floty (blizny -> bramki) (2026-09-05) |
| `pg/council.md` | PG · COUNCIL — narada dzialow i wspolne decydowanie (2026-09-12) |
| `pg/design.md` | PG · DESIGN — przed pierwsza linia kodu (2026-09-05) |
| `pg/dod.md` | PG · DEFINITION OF DONE per tier (2026-09-05) |
| `pg/github-ready.md` | PG · GITHUB-READY — standard „obcy wchodzi na repo i widzi, ze wiemy, co robimy" (2026-09-05) |
| `pg/known-limits.md` | PG v4 — znane granice (stan 2026-09-26) |
| `pg/models.md` | PG · Modele: delty per model + plan dryfu (2026-09-05; lineup zaktualizowany 2026-10-05) |
| `pg/paradigm.md` | PG · Paradygmat i „sztuka" kodu floty PG (2026-09-05) |
| `pg/plan-rubric.md` | Rubryka oceny planu/designu PRZED kodem (P1-lite) — samoocena autora T2+, swiezy recenzent przy pieniadzach/auth/tenantach |
| `pg/postmortem.md` | PG · POSTMORTEM — incydent zamienia sie w bramke (2026-09-05) |
| `pg/prr.md` | PG · PRODUCTION READINESS REVIEW — przed deployem / release (T2, T3) (2026-09-05) |
| `pg/ref-pg-internals.md` | ref-pg-internals — Senior Quality Pipeline 1-9 + PG v3 (pełny opis) |
| `pg/retro-2026-09-06.md` | PG · Retrospektywa 2026-09-06 — moje własne pętle „wracam i naprawiam" vs system |

## pg/adr/

| Plik | Wlasciciel czego |
|---|---|
| `pg/adr/0002-qa-reviewer-warunkowo-obowiazkowy.md` | ADR-0002 — qa-reviewer warunkowo obowiazkowy na T3 z UI (opt-in repo) |
| `pg/adr/0003-recenzja-pg-review-w-ci-jako-dowod-auto-merge.md` | ADR-0003: Recenzja pg-review w CI jako dowód auto-merge |
| `pg/adr/0004-bramki-wdrozenia-bake-watch-rollback.md` | ADR-0004: Bramki wdrożenia — podgląd, bake przed promocją, obserwacja z auto-rollbackiem |
| `pg/adr/0005-cel-architektury-i-bramka-expand-contract.md` | ADR-0005: Cel architektury w każdej sesji + bramka zmian schematu niezgodnych wstecz (R14) |
| `pg/adr/0006-rutyny-floty-tylko-aktywne-repo.md` | ADR-0006: Rutyny floty sprawdzaja tylko repo aktywne (z historii GitHuba) |
| `pg/adr/0007-kalibracja-bramek-plan-v3.md` | ADR-0007: Kalibracja bramek wg logu (plan v3 L2-L4) i CHANGELOG przy release (N1) |
| `pg/adr/0008-granice-modulow-sekret-observe-i-sciezka-bledu-narzedzia.md` | ADR-0008: Granice modułów wg sekretu i domeny (observe), ścieżka błędu narzędzia, język kodu jako deklaracja repo |
| `pg/adr/0009-wiedza-raz-kotwice-indeks-i-tryb-pracy-nad-pg.md` | ADR-0009: Wiedza raz w samym PG — kotwice liczb, generowany indeks właścicieli, pg-self-check |
| `pg/adr/0010-sprawdzacze-jezykow-i-kod-na-zapas-observe.md` | ADR-0010: Sprawdzacze top języków w hookach i bramka „kod na zapas” (observe) |


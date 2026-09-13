**Język / Language:** [English](README.md) · **Polski**

# Coding Higher Mind — PG (PROMPT-GUARD) dla Claude Code

**Bramki jakości, recenzenci-agenci, rutyny i protokół anty-halucynacyjny dla [Claude Code](https://docs.anthropic.com/en/docs/claude-code) i Claude Desktop — egzekwowane przez zdarzenia, nie przez silną wolę.**

Nazwa pochodzi od drugiego długiego projektu autora, darmowego przewodnika po praktycznej duchowości ([kamiljan.com](https://kamiljan.com)): praktyka ponad przekonanie. Reguła, której *zamierzasz* przestrzegać, to przekonanie. Bramka, która odpala się na zdarzeniu, to praktyka. To repozytorium jest praktyką — „wyższym umysłem", który stoi ponad każdą sesją kodowania i nie pozwala, żeby dobre chęci były jedynym zabezpieczeniem.

PG to działający system stojący za firmą programistyczną jednej osoby: ~40 produkcyjnych repozytoriów (SaaS dla warsztatów, marketplace, sklepy, systemy wynajmu, strony klientów) pisanych niemal w całości przez agentów AI, z człowiekiem odpowiedzialnym za specyfikację, review i wdrożenie. Wyrósł z jednego wniosku audytu: **każda reguła zapisana prozą była łamana na skalę** (0 rekordów decyzji architektonicznych w 6 z 7 repo, changelog 105 commitów za, code review wywoływany w 2,5 % sesji, 79 % commitów prosto na `main`). Reguły przeszły więc z prozy do hooków, bramek gita, CI i recenzentów-agentów ze świeżym kontekstem — a każda bramka dostała test dowodzący, że blokuje swój przypadek.

To repozytorium jest tym systemem, wyeksportowanym i zsanityzowanym, żeby dało się go zainstalować na własnej maszynie w pięć minut. Długi opis z diagramami: **[kamiljan.com/claude](https://kamiljan.com/claude)**.

> **Języki.** Kod jest jeden; język wybierasz konfiguracją. Protokół wstrzykiwany w każdą sesję ma pełną wersję angielską i polską (`PG_LANG=en|pl` w `~/.claude/settings.json` → `env`; instalator ustawia go z locale maszyny, `--lang=en|pl` nadpisuje). Komunikaty blokad hooków są dwujęzyczne (PL + linia `BLOCKED: …` z wyjątkiem). README jest w dwóch wersjach (`README.md` / `README.pl.md`), dokumentacja w `docs/` po angielsku, protokół VERIFIED także po polsku w `docs/pl/`. Doktryna (`pg/*.md`) i rubryki recenzentów (`agents/*.md`) są po polsku — model czyta je bez problemu.

---

## Co dostajesz

| Warstwa | Odpala się na | Co robi | Gdzie |
|---|---|---|---|
| **Utwardzanie promptu** | każdy niebanalny prompt (`UserPromptSubmit`) | wstrzykuje PG-core: niejasność → pytania, nie wykonanie; read-before-assert; „gotowe" tylko z dowodem (exit code / diff / HTTP); status `VERIFIED / UNVERIFIED / FAILED`; raport dla sponsora, nie „dobrze" | `hooks/prompt-guard.js` |
| **Bramka edycji** | każda edycja pliku, także przez Bash (`PostToolUse`) | eslint / oxlint / `tsc -b` / ruff / pyright na zmienionym pliku; błędy wracają prosto do agenta | `hooks/post-edit-check.js`, `hooks/post-bash-edit-check.js` |
| **Strażnik komend** | każda komenda shellowa (`PreToolUse`) | blokuje `--no-verify`, force-push, `reset --hard`, `rm -rf` poza katalogami buildu, `gh pr merge`, sekrety w linii komendy, `curl \| sh`; wyjątki są jawne (`ALLOW_*=1`) i logowane | `hooks/bash-guard.js` |
| **Bramka stop** | koniec sesji (`Stop`) | liczy **tier ryzyka T0–T3 z diffu** (ścieżki + rozmiar), odpala lint/typy/testy na wszystkim, co się zmieniło, i odmawia zamknięcia sesji T2+ bez wymaganych działów recenzentów | `hooks/stop-gate.js`, `hooks/lib/risk-tier.js` |
| **Bramki gita** | commit / push (globalny `core.hooksPath`) | konwencjonalny opis commita; skan sekretów; świeżość bazy (`merge-base` — klon o niepowiązanej historii jest blokowany); powtórzone literały w nowym kodzie; nowa zależność musi istnieć w npm/PyPI i nie być typosquatem; zakomentowany kod; nowe `TODO` bez wpisu w rejestrze; kolumna PII bez wiersza w inwentarzu prywatności; lint migracji SQL (RLS `USING` + `WITH CHECK`, higiena `SECURITY DEFINER`, klucze obce tenantów); parser workflowów GitHuba na plikach workflow; diff > 400 linii źródłowych; **nowy cykl importów lub import wbrew zadeklarowanym warstwom** | `git-hooks/pre-commit`, `git-hooks/pre-push`, `git-hooks/commit-msg`, `bin/*` |
| **Działy recenzentów** | T1+ (zalecane) / T2+ (wymagane) | 9 agentów tylko-do-odczytu ze **świeżym kontekstem** i schematem JSON: code, security, data, ops, ux, product, qa, weryfikator, catfish (adwokat diabła). Finding bez wykonanej komendy w `evidence` nie istnieje. Agregacja to kod (`bin/pg-aggregate.js`, k-z-n), nie model; weryfikator próbuje findingi *obalić*; zero czatu między agentami | `agents/`, `skills/pg-review` |
| **Narada** | decyzje architektoniczne | fakty → stanowiska → obowiązkowy dysydent → agregacja → ADR; rola catfish istnieje, bo „cicha zgoda" to główny tryb awarii grup agentów | `skills/pg-council`, `bin/pg-council.js`, `pg/council.md` |
| **Doktryna** | ładowana na zdarzenie, które jej potrzebuje | `design.md` (przed kodem: PRD-lite ze sponsorem/ROI, mini-design, STRIDE-lite, ADR), `dod.md` (definition of done per tier), `prr.md` (przed deployem), `postmortem.md` (incydent → nowa bramka albo nowa blizna), `paradigm.md` (functional core / imperative shell; obcy senior przejmuje repo w jeden dzień), `cases.md` (**149 blizn** — każda bramka wskazuje realną awarię, z której powstała) | `pg/` |
| **Szablon repo** | nowe repozytorium | CI (`quality.yml`, testy mutacyjne na zmienionych plikach, release, opcjonalne review Claude, które bez tokenu *pomija się* zamiast udawać zieleń), ścisły eslint/tsconfig, szablon PR z checkboxem docs-parity, `docs/ARCHITECTURE.md` z **parsowanym blokiem granic modułów**, `GLOSSARY`, `RUNBOOK`, `PRIVACY`, matryca QA `CRITICAL-PATHS`, szablon ADR | `templates/repo/`, `bin/mas-quality-init.ps1` |
| **Narzędzia floty** | na żądanie / cyklicznie | ścisła ochrona gałęzi z nazw jobów workflow, merge PR tylko na aktualnym merge-ref, rollout pojedynczego pliku jako PR, dowód z produkcji z API Vercela (nigdy z ręcznie wpisanego URL), kopanie sesji i historii gita, cotygodniowe zdrowie strażników, miesięczna kalibracja recenzentów (ten sam defekt w dwóch opakowaniach musi dostać ten sam werdykt) | `bin/mas_*.py`, `scheduled-tasks/` |
| **Samotesty** | `node bin/pg-selftest.js` | każda bramka ma test **pozytywny** (musi zablokować), pokrycie reguła→bramka sprawdza skrypt; indeks narzędzi w README jest generowany z nagłówków samych narzędzi (narzędzie bez samoopisu pokazuje się jako dług) | `bin/test_*.js`, `bin/pg-rule-coverage.js`, `bin/pg-map.py` |

Policzone w dniu eksportu, nie szacowane: 184 pliki, ~15 700 linii, 32 narzędzia, 10 zestawów testów, 7 hooków, 3 hooki gita, 9 agentów-recenzentów, 150 blizn, 25 plików szablonu, 4 rutyny kodowe + 7 pulpitowych.

---

## Instalacja (5 minut)

Wymagania: **Node ≥ 20**, **git**, Claude Code. Opcjonalnie: Python 3 + `ruff` + `pyright` (repo w Pythonie), `gitleaks` (CI i tak go uruchamia), klient PostgreSQL albo Docker (drill backupu).

```bash
git clone https://github.com/kamiljan11/coding-higher-mind.git
cd coding-higher-mind
node install.mjs --dry-run     # pokazuje plan, niczego nie dotyka
node install.mjs               # kopiuje do ~/.claude, dokleja hooki do settings.json, blok PG do CLAUDE.md
node install.mjs --yes         # ...i ustawia `git config --global core.hooksPath ~/.claude/git-hooks`
node install.mjs --lang=pl     # protokół po polsku niezależnie od locale maszyny
```

Co obiecuje instalator (przeczytaj `install.mjs`, to 160 linii):

- **Nigdy nie nadpisuje pliku, który zmieniłeś**, chyba że `--force` (wtedy backup do `~/.claude/_pg-backup-<data>/`); różniące się wersje z paczki lądują obok Twoich jako `*.pg-new`.
- `settings.json`: **scala** klucz `hooks` — Twoje inne hooki i klucze zostają; ścieżki są absolutne dla Twojej maszyny; `env.PG_LANG` z locale.
- `CLAUDE.md`: **dokleja** blok PG między `<!-- PG:BEGIN -->` / `<!-- PG:END -->`; ponowne uruchomienie podmienia tylko ten blok.
- Hooki gita są **opt-in** (`--yes`); bez tego dostajesz komendę per repo.
- Kończy się `node ~/.claude/bin/pg-selftest.js` — zielony wynik jest dowodem. Otwórz nową sesję Claude Code; pierwszy niebanalny prompt pokaże `[PROMPT-GUARD]`.

Deinstalacja: `node uninstall.mjs` (usuwa rejestracje hooków i blok w CLAUDE.md; drukuje komendę `rm` na pliki — kasowanie to Twoja decyzja).

Windows działa przez Git Bash (hooki to `sh`), macOS i Linux natywnie. Jedyny wspierany katalog to `~/.claude`, bo stamtąd czyta Claude Code.

---

## Życie jednej zmiany

```
prompt ──▶ prompt-guard.js (protokół) ──▶ edycja ──▶ post-edit-check.js (lint/typy) ──▶ git commit ──▶ pre-commit
(sekrety · base-check · dup-literals · dep-exists · commented-code · todo-ledger · pii-inventory · sql-lint · workflow-lint · ruff/pyright)
──▶ git push ──▶ pre-push (bez main · diff-size · module-boundaries · ostrzeżenie o cudzej gałęzi)
──▶ PR ──▶ CI z templates/ (quality · mutacje na zmienionych plikach · gitleaks · opcjonalne review Claude)
──▶ bin/mas_merge_prs.py (merge tylko, gdy checki odpaliły się na AKTUALNYM merge-ref) ──▶ bin/wait_prod_multi.py (200 z prawdziwej domeny produkcyjnej)
koniec sesji ──▶ stop-gate.js: tier z diffu; T2+ = działy recenzentów (skill pg-review) albo sesja się nie zamknie
```

Każdy czerwony wynik zatrzymuje zmianę w tym miejscu. Każdy wyjątek to nazwana zmienna (`ALLOW_MAIN=1`, `ALLOW_LARGE_DIFF=1`, `ALLOW_BOUNDARIES=1`, …) — świadoma decyzja, logowana do `~/.claude/logs/gates.jsonl` i widoczna w cotygodniowym audycie.

---

## Trzy idee, na których stoi całość

1. **Bramki, nie proza.** Reguła, którą agent może zapomnieć, nie jest regułą. Wszystko, co ważne, odpala się na zdarzeniu (prompt, edycja, komenda, stop, commit, push, CI) i ma test dowodzący, że blokuje swój przypadek. Reguły istniejące tylko w dokumencie sprawdza `bin/pg-rule-coverage.js` — reguła bez bramki oblewa audyt.
2. **Blizna → bramka.** `pg/cases.md` trzyma 149 realnych awarii floty (bramka RLS na złym stanie, fallback, który po cichu zmienił sprzedawcę na fakturze, zielone CI na nieaktualnym merge-ref, które rozwaliło `main`, hook, który dwa razy czytał stdin i nigdy nie ruszył, …). Każdy punkt checklisty i każda bramka cytuje bliznę, z której powstała — reguła Google SRE. Postmortem kończy się nową bramką albo nową blizną, nigdy „będziemy uważniejsi".
3. **Dowód, nie proza.** „Gotowe" to komenda, exit code i obejrzany stan. Raport kończy się `VERIFIED` (dowód zacytowany) / `UNVERIFIED` (czego brakuje) / `FAILED` (co się stało). To ma największe znaczenie tam, gdzie agenci zmierzalnie zawyżają sukces (w jednym benchmarku 75,8 % zgłoszonych „sukcesów" to deklaracje bez dowodu) i ustępują pod naciskiem. Patrz [docs/pl/VERIFIED-PROTOCOL.md](docs/pl/VERIFIED-PROTOCOL.md) — to jedna rzecz, którą warto wkleić do każdego promptu w Claude Cowork.

---

## Tier ryzyka (liczony z diffu, nigdy z promptu)

| Tier | Wyzwalacz (ścieżki + rozmiar) | Wymagane |
|---|---|---|
| T0 | docs, copy, style, assety | tylko bramki 0-tokenowe |
| T1 | izolowany komponent / util | code-reviewer zalecany |
| T2 | wspólna logika, trasa API, edge function, zależność, config CI/buildu, > 150 linii | code + ops (+ ux przy UI, + data przy schemacie) |
| T3 | auth, RLS / multi-tenant, płatności, sekrety, migracje SQL, cron, admin, > 600 linii | code + security + data + ops (+ ux) → weryfikator; security/data/weryfikator na najmocniejszym modelu |

Nadpisania per repo w `CLAUDE.md` repozytorium: `pg.tier_floor: T2`, `pg.phase: prototype|poc|mvp|production` (prototyp ma sufit T1 — proporcjonalność; promocja do produkcji wymaga przeglądu gotowości), `pg.qa_url:` (dział QA staje się obowiązkowy na T3 z UI).

---

## Mapa repozytorium

| Ścieżka | Co tam jest |
|---|---|
| `hooks/` | hooki Claude Code (7) + `lib/` (tier ryzyka, uruchamianie lintu, telemetria bramek, zaufane katalogi) + `guard_health.py` (audyt samego systemu) |
| `git-hooks/` | `commit-msg`, `pre-commit`, `pre-push` — instalowane raz przez `core.hooksPath`, aktywne w każdym repo |
| `bin/` | narzędzia 0-tokenowe + zestawy testów; [bin/README.md](bin/README.md) jest generowany z nagłówka każdego narzędzia |
| `agents/` | działy recenzentów (tylko odczyt, świeży kontekst, schemat JSON, `how_to_check` przy każdej regule rubryki) |
| `pg/` | doktryna: `paradigm`, `design`, `dod`, `prr`, `postmortem`, `cases`, `council`, `models`, `github-ready`, retro; `adr/`; `eval/` (golden set bramek + pary kalibracyjne recenzentów) |
| `skills/` | `pg-review`, `pg-council`, `anti-sycophancy`, `verify-audit`, `ultra-loop`, `gauntlet-build` |
| `templates/repo/` | wszystko, co dostaje nowe repozytorium: workflowy, eslint/tsconfig, szablon PR, szkielety docs, szablon ADR |
| `scheduled-tasks/` | rutyny Claude Code: recenzent PR floty (dni robocze rano), nadzór CVE (co miesiąc, najpierw deterministycznie), zdrowie strażników (co tydzień), kalibracja recenzentów (co miesiąc) |
| `routines/` | [routines/README.md](routines/README.md) — warstwa rutyn obu runtime'ów plus `cowork/`: rutyny Claude Desktop (watchdog, backup ze skryptem restore, sesje → notatki pamięci, tygodniowy raport, opt-in cykl samodoskonalenia) |
| `tools/workflow-lint/` | parser workflowów GitHuba (`@actions/workflow-parser`) — pre-commit lintuje pliki workflow tym samym parserem, który uruchamia GitHub |
| `CLAUDE.pg.md` | blok PG, który instalator dokleja do Twojego `~/.claude/CLAUDE.md` |
| `settings.pg-hooks.json` | rejestracje hooków, które instalator scala z `~/.claude/settings.json` |
| `docs/` | [ARCHITECTURE.md](docs/ARCHITECTURE.md) (diagramy, mapa myśli), [VERIFIED-PROTOCOL.md](docs/VERIFIED-PROTOCOL.md) ([PL](docs/pl/VERIFIED-PROTOCOL.md)), [CUSTOMIZE.md](docs/CUSTOMIZE.md) |

---

## Dopasuj do siebie

Wszystko, co było specyficzne dla maszyny autora, zostało usunięte albo stało się konfigurowalne — lista w [docs/CUSTOMIZE.md](docs/CUSTOMIZE.md). W skrócie:

- `~/.claude/CLAUDE.md` — własne reguły piszesz nad blokiem PG; sam blok jest podmieniany przy aktualizacji.
- `PG_LANG` — język protokołu (`en`/`pl`), instalator ustawia z locale.
- `MAS_MEMORY_DIR` — katalog notatek markdown wstrzykiwanych na starcie sesji przez `hooks/session-context.js` (domyślnie `~/.claude/memory`; brak plików = pominięte).
- `GITHUB_OWNER` + token w środowisku — dla narzędzi floty (`bin/mas_*.py`). Używaj menedżera sekretów, który wstrzykuje zmienne (`infisical run --`, `op run --`, `doppler run --`); PG blokuje sekrety wpisane w linię komendy.
- Per repo: `pg.tier_floor`, `pg.phase`, blok granic modułów w `docs/ARCHITECTURE.md`, matryca QA w `docs/CRITICAL-PATHS.md`, `docs/PRIVACY.md`.
- Rubryki recenzentów w `agents/*.md` — dopisz własne blizny do `pg/cases.md` i odwołuj się do ich `rule_id` z rubryki.

---

## Uczciwe granice

- Zbudowane i sprawdzone w skali MŚP (dziesiątki repo, jeden właściciel, dziesiątki tysięcy linii), nie hyperscale.
- Doktryna i rubryki są po polsku; protokół i komunikaty blokad są dwujęzyczne.
- Agenci-recenzenci kosztują tokeny (T2 ≈ 4×, T3 ≈ 8–10× kosztu jednej recenzji diffu); bramki 0-tokenowe idą pierwsze, żeby agenci nigdy nie widzieli czerwonego lintu.
- Część bramek zależy od tego, czy repo ma to, co sprawdzają (`tsconfig.json`, blok w `docs/ARCHITECTURE.md`, `CRITICAL-PATHS.md`); bez tego pomijają się **i logują pominięcie**.
- System był pisany przez agentów AI pod tymi samymi bramkami, które opisuje. Nie jest skończony; jest obudowany inżynierią przeciw własnym trybom awarii, jawnie.

## Licencja

MIT — © 2026 Kamil Jan. Źródła badań stojących za regułami są cytowane w `prompt-protocol.md`, `pg/*.md` i `hooks/prompt-guard.js`.

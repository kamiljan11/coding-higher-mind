---
name: pg-review
description: |
  Recenzja „wielodzialowa" diffu jak w software housie: tier ryzyka z diffu -> finderzy dzialowi
  RÓWNOLEGLE ze swiezym kontekstem (read-only, schemat JSON, komendy zamiast opinii) -> agregacja
  k-of-n w kodzie (0 tokenow) -> weryfikator obala/potwierdza -> fixer (sesja glowna) naprawia -> bramki.
  Zero czatu miedzy agentami (MAST). Uzyj, gdy stop-gate zglosi [review], przed PR/deployem T2+,
  albo na haslo: "pg-review", "review dzialowy", "przepusc przez dzialy", "recenzja jak w korpo".
---

# pg-review — procedura (orkiestrator = sesja glowna)

Zasady twarde: bramki 0-tokenowe ZIELONE przed jakimkolwiek agentem; recenzenci NIE edytuja; agregacja to
`bin/pg-aggregate.js`, nie model; debata = brak (T3: weryfikator moze wykonac max 2 wlasne komendy).
Budzet: T1 ~1x, T2 ~4x, T3 ~8-10x kosztu jednej recenzji diffu. Wszystko w jednym katalogu roboczym.

## 0. Przygotowanie (0 tokenow)
```bash
RUN="$TEMP/pg-review-$(date +%Y%m%d-%H%M%S)"; mkdir -p "$RUN"
cd <repo>
git diff HEAD > "$RUN/diff.patch"; git status --porcelain > "$RUN/status.txt"
FILES=$(git diff --name-only HEAD; git ls-files --others --exclude-standard)
LINES=$(git diff --numstat HEAD | awk '{s+=$1+$2} END {print s+0}')
node ~/.claude/hooks/lib/risk-tier.js "$(pwd)" $FILES --lines $LINES > "$RUN/tier.json"; cat "$RUN/tier.json"
```
Bramki: `npx --no-install eslint --max-warnings=0 <pliki>` (lub oxlint), `tsc -b`/`--noEmit`, `npm test`,
`node ~/.claude/bin/sql-migration-lint.js --repo . --strict` (gdy .sql), `node ~/.claude/bin/fleet-metrics.js --repo . --json > "$RUN/metrics.json"`.
Czerwone => napraw NAJPIERW. Nie odpalaj agentow na czerwonym drzewie.

## 1. Finderzy — rownolegle, jedna wiadomosc, `run_in_background: true`
Z `tier.json.reviewers` (+ `product-reviewer` na T3, na zadanie, ORAZ zawsze gdy diff dotyka `docs/`, `README*`, publicznego API/konfiguracji — routes, `.env.example`, eksporty pakietu, sygnatury edge fn — bo wtedy docs musza sie zgadzac z kodem w tym samym PR; how_to_check: `git diff --name-only origin/main...HEAD | rg "^docs/|README|\.env\.example|routes|supabase/functions"`). Model z `tier.json.models` (T3: security/data = opus).
Prompt KAZDEGO findera (krotki; rola ma pelna rubryke w `~/.claude/agents/<rola>.md`):
```
Repo: <sciezka>. Tier: <T>. Diff: <RUN>/diff.patch (czytaj CALY). Opis zadania: <1-3 linie / PRD-lite>.
Zapisz findings DOKLADNIE wg schematu z twojej definicji do: <RUN>/findings.<rola>.json.
Odpowiedz <= 10 linii. Nie edytuj zadnego pliku w repo.
```
Nie przekazuj finderom cudzych wynikow. Nie dopisuj „szukaj X" — rubryka juz to ma.
Fallback: definicje agentow sa ladowane przy starcie sesji — jesli `subagent_type: <rola>` zwraca „not found" (nowa rola dodana w tej sesji),
uzyj `general-purpose` z `model` wg tieru i pierwsza linia promptu: `FIRST read ~/.claude/agents/<rola>.md and follow it EXACTLY`.
Repo bez gita (np. `~/.claude`): zamiast diffu podaj liste plikow „czytaj CALE jako diff".

## 1b. QA — dzial opcjonalny, NA ZADANIE (2026-09-12; slownik SH: QA = nowe funkcje + REGRESJA, manualnie i automatycznie)
Kiedy: uzytkownik prosi („przetestuj", „QA", „jako mechanik/klient", „na kilku instancjach"), albo `tier.json.optional_reviewers`
zawiera `qa-reviewer` I istnieje `docs/CRITICAL-PATHS.md` I znasz URL (dev server / preview). Nie odpalaj bez dzialajacej apki.
OBOWIAZKOWO (w `tier.json.reviewers`, stop-gate blokuje): T3 z UI, gdy repo ma `pg.qa_url:` w CLAUDE.md i blok json w CRITICAL-PATHS.md
(narada D-2026-09-12, opcja C; `tier.json.qaUrl` = adres do `--base-url`).
Najpierw 0 tokenow (rownolegle izolowane instancje persona x viewport x locale, kazda = osobny kontekst przegladarki):
```bash
node ~/.claude/bin/qa-matrix.js --repo <repo> --base-url <url> --out "$RUN/qa" --json > "$RUN/qa/report.json"   # exit 1 = sa porazki
```
Potem agent `qa-reviewer` (sonnet) z promptem jak finderzy + `Kryterium akceptacji: <z PRD-lite>. Raport qa-matrix: <RUN>/qa/report.json. URL: <url>.`
Zapisuje `findings.qa.json` (schemat wspolny; kazdy finding w formacie 3-info: co zrobilem / co sie stalo / czego oczekiwalem + sciezka screenshotu).
Wchodzi do agregacji jak kazdy dzial. Drugi dev server (inna organizacja / waluta / locale) = persona z wlasnym `baseURL` w CRITICAL-PATHS.md.

## 2. Agregacja (0 tokenow)
```bash
node ~/.claude/bin/pg-aggregate.js "$RUN"        # -> aggregated.json + aggregated.md; exit 1 = REQUEST CHANGES
```
Findings bez `evidence`/`repro_cmd` sa odrzucane automatycznie. `needs_verification` = lista dla weryfikatora.

## 3. Weryfikator (tylko gdy `needs_verification` niepuste lub tier T3)
Agent `verifier` (T3: model opus), prompt:
```
Repo: <sciezka>. Tier: <T>. Wejscie: <RUN>/aggregated.json (sprawdzaj TYLKO needs_verification).
Wykonaj repro_cmd kazdego, verdict reproduced/not_reproduced/cannot_run. Zapisz <RUN>/verdicts.json. Nie edytuj repo.
```
Potem ponownie: `node ~/.claude/bin/pg-aggregate.js "$RUN" --verdicts "$RUN/verdicts.json"`.

## 4. Fixer = sesja glowna
Napraw `blocker` i `must_fix` (nie `note`, chyba ze trywialne). Kazdy fix przechodzi bramki (hooki same to zrobia).
`dropped` i `note` wypisz w raporcie z jednym zdaniem dlaczego nie naprawiasz. Nie „naprawiaj" przez suppression.
Po fixach: `git diff --stat` + ponowne bramki. Jesli fixy > POST_REVIEW_EDIT_BUDGET (8 edycji) -> powtorz krok 1 tylko dla rol, ktorych findings naprawiles.

## 5. Raport (CAVEMAN)
```
[PG] pg-review <tier> · finderzy: <lista> · findings: N -> po dedupe M (odrzucone bez dowodu: K)
blocker: ... (naprawione / odrzucone: dlaczego)   must_fix: ...   note: ...   pytania do uzytkownika: ...
Bramki po fixach: lint rc=0, tsc rc=0, testy rc=0 (<komendy>)   Status: VERIFIED / UNVERIFIED (co)
```
Dopisz nowe wzorce do `~/.claude/pg/cases.md` (jesli finding ujawnil nieznany wzorzec) — to jest biblioteka blizn.

## Anty-wzorce (nie rob)
- Jeden „super-reviewer" zamiast dzialow (MAST: role bez granic = pomijanie).
- Przekazywanie finderom cudzych findings albo prosba „przedyskutujcie" (konsensus filtruje mniejszosc, ktora miala racje).
- Naprawianie przez agenta-findera (nie ma prawa pisac).
- Odpalanie agentow na czerwonym lint/tsc (marnuje tokeny na to, co lapie kompilator).
- „Review zrobione" bez sciezki `aggregated.md` w raporcie.

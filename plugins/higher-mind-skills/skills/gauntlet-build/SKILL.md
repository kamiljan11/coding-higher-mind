---
name: gauntlet-build
description: Multiagentowa pętla budowy „spec → jednostki → builder/krytyk (świeży kontekst) → bramki deterministyczne → weryfikator → fix → aż do poprzeczki". Użyj, gdy uzytkownik chce zbudować lub dopracować system/moduł/apkę/dokument z istniejącej specyfikacji przy minimum promptów — „zbuduj to multiagentowo", „gauntlet", „loop budowy", „buduj i krytykuj aż będzie dobrze", „rozpisz na agentów z loopowaniem", „jednym promptem", „swarm build", „ulepszaj i krytykuj 3×", „loopuj i samokrytykuj", „zrób to jak te gry z jednego prompta". NIE gdy: chodzi o polerowanie gotowego produktu wieloma wymiarami bez specyfikacji (to `ultra-loop`), o jednorazowy review (`code-review`), o sam research (`Workflow` research) albo zadanie jednoplikowe (rób sam).
---

# Gauntlet Build — spec → poprzeczka → pary builder/krytyk → aż wygra

Metoda złożona z tego, co realnie działa w pętlach agentowych (źródła w `references/lessons.md`):
Ralph loop (lista zadań + promise ukończenia + cap iteracji + progress file), Gauntlet loop
Matta Shumera (poprzeczka zamiast rubryki, krytyk ze świeżym kontekstem, ślepe porównanie),
Anthropic evaluator-optimizer + orchestrator-workers, oraz to, co wyszło w sesji PG parts-shop
2026-09-04 (3 rundy krytyki = 80 findingów; 12 high zweryfikowanych — żaden nie wyszedłby z
samokrytyki tego samego kontekstu).

**Zasada 1: model, który napisał, nie recenzuje.** Krytyk zawsze ze świeżym kontekstem, z prompt-em
„załóż, że są błędy". **Zasada 2: poprzeczka > rubryka.** Rubryka to ocenianie się względem własnych
słów (dryfuje w górę); poprzeczka to coś istniejącego, co da się pobrać i porównać. **Zasada 3:
bramka deterministyczna przed bramką modelową.** tsc/lint/testy/preview → dopiero krytyk.
**Zasada 4: verify-before-accept.** Finding krytyka to hipoteza; weryfikator ze świeżym kontekstem
próbuje go obalić w repo/źródle. **Zasada 5: cap + progress file.** Nigdy pętla bez limitu; stan
w pliku, nie w kontekście.

## Kiedy odpalać (i jak głośno)
- To jest tryb **Poziom 3** z reguł uzytkownika (fan-out wieloagentowy) — uruchamiaj tylko na jego
  jawne hasło (patrz description). Sam skill = to hasło; nie pytaj drugi raz.
- Ogłoś 1 linią: `Plan: gauntlet-build · N jednostek · bar = … · cap = R rund/jednostkę · budżet ≈ …`.
- Cowork/scheduled: bez `AskUserQuestion`; blockery zbieraj do paczki na koniec.

## Wejścia (ustal z rozmowy, nie pytaj o oczywiste)
| Wejście | Skąd | Domyślnie |
|---|---|---|
| Spec / dokument projektu | artefakt, plik, sekcja rozmowy | ostatni dokument projektowy w sesji |
| Repo + konwencje | CLAUDE.md, migracje, `docs/adr` | bieżące cwd |
| Tryb | `design` (dokument) / `build` (kod) / `mixed` | wnioskuj z prośby |
| Poprzeczka (bar) | patrz Krok 0 | testy zielone + preview działa + wzorzec w repo |
| Cap | rund na jednostkę / agentów / tokenów | 3 rundy, ≤ 15 agentów/fazę, budżet z „+500k" jeśli podany |
| Granice | co NIE wolno (prod, main, sekrety, pieniądze) | reguły uzytkownika: nigdy merge na main, nigdy migracja prod bez człowieka, sekrety tylko przez most |

## Krok 0 — Poprzeczka (bar), nie rubryka
Poprzeczka musi być: **nazwana** (konkretna rzecz), **pobieralna** (krytyk może ją otworzyć,
uruchomić, zescreenować), **porównywalna** (obok siebie). Przykłady:
- kod: „RPC zachowuje się jak `issue_invoice_number` (idempotencja, FOR UPDATE, brak luk)"; „ekran
  wygląda i działa jak `/czesci?tab=magazyn`"; „pgTAP: lista N przypadków zielona"; „preview: flow X
  przechodzi bez błędów konsoli".
- dokument: „każdy proces ma wyzwalacz/kroki/dane/wyjątki jak P3 w v0.3"; „każde twierdzenie prawne
  ma § i link"; „każdy finding high z rundy N ma widoczną poprawkę".
- UI/grafika: referencyjny screenshot/strona → ślepe A/B.
Brak poprzeczki → użyj rubryki z `ultra-loop` (0–10 per wymiar), ale oznacz w raporcie
„rubryka, ryzyko dryfu" i dodaj krytyka „completeness".

## Krok 1 — Dekompozycja na jednostki sądzone osobno
Jednostka = coś, co krytyk oceni w ≤ 1 kontekście: 1 migracja, 1–3 RPC, 1 ekran, 1 sekcja
dokumentu. Dla każdej zapisz w `docs/GAUNTLET-PROGRESS.md` (szablon w
`references/progress-template.md`):
- `id`, `zakres`, **`pliki własne`** (brak nakładania między równoległymi jednostkami — inaczej
  worktree), `zależy_od`, `bar`, `akceptacja deterministyczna` (komendy: tsc -b, lint, testy,
  preview), `soczewki krytyki` (2–3 z listy niżej), `status`, `rundy`, `blockery`.
Kolejność = zależności; niezależne jednostki idą przez `pipeline()` równolegle.

Soczewki krytyki (wybierz per jednostka): `dev` (SQL/współbieżność/RLS/idempotencja),
`system` (dzień 2, SPOF, brakujące procesy, mierniki), `security` (IDOR/RLS/sekrety/PII),
`legal` (przepisy z §), `ux` (ścieżka użytkownika, stany błędów), `regression` (spójność
między sekcjami/plikami po poprawkach), `completeness` („czego brakuje, żeby to w ogóle
zadziałało pierwszego dnia").

## Krok 2 — Pętla jednostki (max R rund; domyślnie 3)
```
builder (świeży kontekst, prompt z references/prompts.md#builder)
  → bramki deterministyczne (hooki repo + komendy z akceptacji; czerwone → builder poprawia sam, max 5 prób)
  → krytycy (2–3 soczewki, RÓWNOLEGLE, świeży kontekst, „załóż, że są błędy", dowód = cytat/plik:linia)
  → weryfikator (per finding high/med: świeży kontekst, „obal to"; zostaje, gdy nie obalone)
  → fixer (tylko zweryfikowane findingi; małe atomowe zmiany; testy w tej samej zmianie)
  → bramki ponownie
  → [artefakt wizualny/dokument] sędzia: ślepe A/B „obecna wersja vs bar" → wygrała? done : runda++
  → [kod] done, gdy bramki zielone i krytycy 2 rundy z rzędu bez high/med
```
Reguły:
- Builder i fixer NIE dostają findingów odrzuconych przez weryfikatora (inaczej „naprawiają" nie-błędy).
- Krytyk dostaje TYLKO artefakt + spec + repo, nie rozmowę i nie uzasadnienia buildera.
- Każdy finding: `[severity] [soczewka] — teza — dowód — poprawka`; bez pochwał; na końcu
  „3 rzeczy poprawne i nieoczywiste — nie psuć" (chroni przed regresją w drugą stronę).
- Ten sam błąd 2× w rundach → zmiana podejścia, nie trzecia próba (Loop Guardrails).
- Commit per jednostka po zielonych bramkach (hook pre-commit; nigdy `--no-verify`); nigdy push na main.

## Krok 3 — Integracja (po wszystkich jednostkach)
1. **Krytyk integracyjny**: sprzeczności między jednostkami (nazwy, typy, kolejność migracji, fazy).
2. **Pełne bramki**: cały test suite + build + preview głównych ścieżek.
3. **Completeness critic**: „co musi istnieć, żeby to działało dnia 1, a nie istnieje" (ostatnia
   runda krytyki PG parts-shop znalazła: brak inwentaryzacji w F1, brak listy „poza systemem",
   brak mierników opłacalności — żaden krytyk jednostkowy tego nie widział).
4. **Weryfikator regresji**: czy poprawki z rund nie cofnęły wcześniejszych decyzji (porównaj z
   `GAUNTLET-PROGRESS.md` sekcja „decyzje nietykalne").
5. `code-reviewer` (agent repo) na całym diffie przed „done".

## Terminacja
Stop, gdy: (a) wszystkie jednostki `done` i integracja zielona; (b) 2 rundy z rzędu bez
postępu na jednostce → `blocked` z opisem; (c) tylko blockery ludzkie → **jedna paczka pytań**;
(d) cap agentów/tokenów → raport częściowy z jawną listą „nie zrobione". Nigdy „done" bez
dowodu (exit 0, screenshot, cytat) — blok statusu VERIFIED/UNVERIFIED/FAILED na końcu.

## Narzędzia (nie wymyślaj od zera)
- **Workflow** (skrypt) — szablon `references/workflow-template.js`: `pipeline(units, build, gate, critique, verify, fix)` + faza integracji. Odpalaj przez `Workflow({script})`; iteruj `scriptPath` + `resumeFromRunId`.
- **Agent** (pojedynczy krytyk/weryfikator) — gdy jednostek ≤ 2, Workflow to overhead.
- Bramki: hooki repo (`post-edit-check`, `stop-gate`), `tsc -b`, oxlint/eslint, vitest/pgTAP, Playwright/preview.
- Skille jako soczewki: `code-review`, `security-review`, `architecture-advisor`, `legal:compliance-check`, `mobile-optimization`, `verify-audit`, `anti-sycophancy`.
- Model routing: builder/fixer → sonnet (kod), krytyk/weryfikator → model sesji z `effort: 'high'`; lookupy → haiku.

## Raport (co uzytkownik dostaje)
- 1 linia planu na start; po każdej rundzie: tabela `jednostka | runda | high/med/low | zweryfikowane | naprawione | stan bramek`.
- Na końcu: co zbudowane + dowody (komendy, exit codes, screeny), lista blockerów, „czego świadomie nie zrobiono", link do artefaktu/PR, status VERIFIED/UNVERIFIED/FAILED.
- Do pamięci: wzorce błędów, które wracały (dopisz do `references/lessons.md`, jeśli nowe).

## Antywzorce
- Krytyk w tym samym kontekście co builder (potwierdza własne założenia).
- Rubryka zamiast poprzeczki bez oznaczenia ryzyka dryfu.
- Fix bez weryfikacji findingu (naprawianie nie-błędów = nowe błędy).
- Równoległe jednostki na tych samych plikach bez worktree.
- Pętla bez cap / bez progress file (po restarcie startujesz od zera).
- „Done" po samym build bez preview/testów.
- Pytania do człowieka po jednym zamiast paczką.

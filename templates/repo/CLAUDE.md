# Reguly pracy w tym repo (obowiazuja kazdego agenta AI i czlowieka)

## Zanim napiszesz JAKIKOLWIEK nowy kod
1. **Grep first.** Przeszukaj repo czy istniejaca funkcja/util/komponent robi to samo. Jesli tak — uzyj albo rozszerz. Duplikacja logiki = odrzucona zmiana.
2. Przeczytaj sasiednie pliki modulu, ktory zmieniasz. Trzymaj sie ich konwencji, nie swoich preferencji.
3. Zmiana architektoniczna (nowy modul, zaleznosc, wzorzec, schemat danych) -> najpierw ADR w `docs/adr/`, potem implementacja.

## Podczas pisania
4. **Male atomowe zmiany + Simplicity First.** Jedna logiczna zmiana naraz. Nie mieszaj refaktoru z feature. Nie przepisuj plikow spoza zadania. Najprostsze rozwiazanie, ktore przechodzi testy — zero abstrakcji i zaleznosci "na zapas" (YAGNI).
5. **Testy sa czescia zadania.** Nowa logika = testy w tej samej zmianie (happy path + najgrozniejsze edge case'y).
6. Bezpieczenstwo zawsze: parametryzowane zapytania, walidacja kazdego inputu, authz na poziomie rekordu, zadnych sekretow w kodzie — tylko env.
7. Nie wylaczaj lintera i nie uzywaj `any` / `@ts-ignore` / `eslint-disable` zeby "przeszlo". Napraw przyczyne.

## Zanim powiesz "gotowe" (Definition of Done)
8. Uruchom lint + typecheck + testy. Czerwone = nie jest gotowe.
9. Self-review diffa oczami wrogiego recenzenta: co tu sie wysypie o 3 w nocy?
10. Nie commituj z `--no-verify`. Czerwone CI to nie sugestia, to sciana.
11. **Dokumentacja rowna sie kod:** kazda zmiana funkcjonalna -> wpis w `CHANGELOG.md` [Unreleased]; zmiana setup/komend/env -> aktualizacja `README.md`; zmiana deploy/ops -> `docs/RUNBOOK.md`.
12. **Flow galezi:** feature branch -> PR -> zielone CI + review -> merge. Nie pushuj prosto na main (wyjatek: stare projekty Lovable, gdzie push do main = deploy).
13. **Release:** wersje SemVer; przy wydaniu przenies [Unreleased] pod numer, tagnij `vX.Y.Z`, push tag (Release robi sie sam).

## PG v3 (2026-09-05): tier, paradygmat, dzialy
- `pg.tier_floor: T1` <!-- T2/T3 dla repo z pieniedzmi/PII/multi-tenant; stop-gate podnosi tier z diffu, nigdy nie obniza -->
- `pg.phase: production` <!-- prototype | poc | mvp | production | maintenance | handoff. Prototyp NIE jest produktem: prototype/poc = sufit T1 (bez review dzialowego); zmiana na production = wypelniona ~/.claude/pg/prr.md w docs/prr/<data>.md w tym samym commicie (bramka bin/phase-gate.js) -->
- `pg.ownership: mas-saas` <!-- mas-saas (licencja, kod nasz) | client-transferred (prawa przeniesione, LICENSE z nazwa klienta) | client-licensed (klient korzysta, kod nasz) | oss. Repo klienckie => docs/SCOPE.md + docs/ACCEPTANCE.md obowiazkowe -->
- `pg.sla: internal` <!-- none | internal | contract — klasy SEV i czasy reakcji w docs/RUNBOOK.md; contract = link do umowy -->
- Srodowiska: `.env.local`/preview NIGDY na produkcyjny ref Supabase (`SUPABASE_PROJECT_REF_PROD` w `.env.example`; bramka `node ~/.claude/bin/env-ref-gate.js --repo .`). Brak stagingu = jawne `pg.single_env: true` z powodem.
- QA na zadanie: `docs/CRITICAL-PATHS.md` + `node ~/.claude/bin/qa-matrix.js --repo . --base-url <url>` (rownolegle izolowane instancje persona x viewport x locale) albo dzial `qa-reviewer` (pg-review krok 1b).
- `pg.qa_url: http://localhost:5173` <!-- OPT-IN (narada D-2026-09-12, opcja C): gdy ta linia istnieje I docs/CRITICAL-PATHS.md ma blok json, qa-reviewer jest WYMAGANY na T3 z UI/route/edge fn (stop-gate blokuje). Bez tej linii = tylko ostrzezenie. Wpisz dev server albo staly preview; Lovable bez stalego URL = zostaw zakomentowane -->
- Dane osobowe: kazda kolumna PII ma wiersz w `docs/PRIVACY.md` (bramka `pii-inventory-gate.js`); dane klienta do AI/API zewnetrznego tylko z wpisanym procesorem.
- Dlug: nowy `TODO|FIXME|HACK` w kodzie = wiersz w `docs/quality/BACKLOG.md` w tym samym commicie (bramka `todo-ledger-gate.js`).
- Paradygmat: `~/.claude/pg/paradigm.md` — functional core / imperative shell; klasy tylko dla stanu z niezmiennikami; **obcy senior przejmuje repo w 1 dzien** (README 15 min, `docs/ARCHITECTURE.md`, `docs/GLOSSARY.md`, ADR, RUNBOOK).
- Definition of Done per tier: `~/.claude/pg/dod.md`. Przed deployem: `~/.claude/pg/prr.md`. Incydent: `~/.claude/pg/postmortem.md` (action item = bramka/case).
- Review T2+: skill `pg-review` (finderzy dzialowi -> agregacja -> weryfikator). SQL: `node ~/.claude/bin/sql-migration-lint.js --repo . --strict`. Metryki: `node ~/.claude/bin/fleet-metrics.js --repo .`.
- Lint/TS baseline: `eslint.config.mjs` + `tsconfig.base.json` z szablonu (strict-type-checked, complexity 10, fn <= 60 linii, plik <= 400, switch-exhaustiveness, no-floating-promises).
- Commity: Conventional Commits (hook `commit-msg`); PR wg `.github/pull_request_template.md`.

## Kontekst projektu
<!-- UZUPELNIJ per repo: stack, komendy, pliki wzorcowe -->
- Stack:
- Komendy: `npm run dev` / `npm run build` / `npm run lint` / `npm test`
- Plik wzorcowy komponentu:
- Plik wzorcowy API/serwisu:

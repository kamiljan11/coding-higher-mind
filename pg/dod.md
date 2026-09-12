# PG · DEFINITION OF DONE per tier (2026-09-05)

Egzekwuje: `hooks/stop-gate.js` (tier z `hooks/lib/risk-tier.js`, lint/tsc/testy, wymagani recenzenci),
`git-hooks/pre-commit`, CI `quality.yml`. Ten plik = co bramki sprawdzaja i co zostaje dla osadu.
Regula Google SRE: kazdy punkt ma powod w realnej katastrofie -> kolumna „incydent" (id z `pg/cases.md`).

## Tiery (deterministycznie ze sciezek + rozmiaru diffu)
| Tier | Co | Wymagane dzialy (recenzenci) | Model |
|---|---|---|---|
| T0 | docs, copy, style, assety, CHANGELOG | zadne — tylko bramki 0-tokenowe | — |
| T1 | izolowany komponent/util bez granicy danych | code-reviewer (zalecany, nie blokuje) | sonnet |
| T2 | wspolna logika, API/route, edge fn, zaleznosc, config buildu/CI, >150 linii | code-reviewer + ops-reviewer (+ ux-reviewer gdy UI, + data-reviewer gdy schemat) | sonnet |
| T3 | auth, RLS/multi-tenant, platnosci, sekrety, migracje SQL, cron/scheduled, admin, >600 linii | code + security + data + ops (+ ux) -> verifier | security/data/verifier = **opus** |
Nadpisanie per repo: `CLAUDE.md` sekcja `pg.tier_floor: T2` (np. workshop-app: caly `src/features/billing/**` = T3).
Faza per repo (2026-09-12, slownik SH: „prototyp nie jest produktem"): `pg.phase: prototype|poc` = **sufit T1** (zero review dzialowego dla prototypu — proporcjonalnosc; bramki 0-tokenowe nadal obowiazuja, sekrety zawsze); `mvp|production|maintenance|handoff` = bez sufitu. Zmiana `pg.phase` na `production` = PRR w `docs/prr/<data>.md` (bramka `bin/phase-gate.js`).
Dzial **qa-reviewer** (`optional_reviewers` w `risk-tier.js`, gdy diff dotyka UI/route/edge fn przy T2+): uruchamiany NA ZADANIE („przetestuj", „QA", „jako mechanik/klient") — nie automatycznie (koszt + potrzebna dzialajaca apka).
**Warunkowo obowiazkowy** (narada `D-2026-09-12-qa-mandatory`, opcja C, `pg/adr/0002`): na **T3** z UI staje sie WYMAGANY (stop-gate blokuje jak security/data) wylacznie gdy repo jest gotowe = `docs/CRITICAL-PATHS.md` z blokiem ```json ORAZ osobna linia `pg.qa_url: http(s)://...` w CLAUDE.md. Bez opt-in = ostrzezenie (bramka niespelnialna uczylaby obchodzenia). Sprzeciw zapisany w ADR: code (<backup-drive>: tylko 0-tokenowy qa-matrix), product (B: koszt agenta, 0 repo z plikiem dzis).

## Bramki 0-tokenowe (wszystkie tiery) — musza byc zielone PRZED jakimkolwiek agentem
| # | Bramka | how_to_check | Incydent |
|---|---|---|---|
| G1 | lint (eslint `--max-warnings=0` / oxlint `--deny-warnings`) na zmienionych plikach | post-edit + post-bash-edit + stop-gate (lib/lint-file) | S03 |
| G2 | typy: `tsc -b` gdy `references`, inaczej `tsc --noEmit` | lib/lint-file `tscCommand` | S02 |
| G3 | testy: `npm test` / `vitest run` / `pytest -x` | stop-gate `runTests` | S17 |
| G4 | sekrety: gitleaks + pre-commit regex + bash-guard (sekret w komendzie) | pre-commit, CI, bash-guard | S05 |
| G5 | SQL: `node ~/.claude/bin/sql-migration-lint.js --strict` na staged `.sql` | pre-commit (T3 sciezki) | S06, R2/R4/R5/R10 |
| G6 | zaleznosci: `npm audit --audit-level=high`, license-checker, brak nowego pakietu bez wpisu w manifescie | CI; review rubryka | F6 (slopsquatting) |
| G7 | suppression-as-fix: nowy `eslint-disable` / `@ts-ignore` / `# noqa` / pusty `catch` / luzniejszy tsconfig w diffie | `git diff -U0 \| rg "^\+.*(eslint-disable\|@ts-ignore\|@ts-expect-error\|noqa\|catch \(\w*\) \{\s*\})"` -> code-reviewer blocker | F5, S03 |
| G8 | test edytowany razem z kodem, ktory testuje, bez uzasadnienia w opisie | `git diff --name-only \| rg "\.test\."` && odpowiadajacy plik zrodlowy w diffie -> pytanie w review | F8 |
| G9 | CHANGELOG `[Unreleased]` ma wpis, gdy zmiana `feat`/`fix` widoczna dla usera | commit-msg conventional + review checkbox | S28 (-105 commitow) |
| G10 | jakosc kodu (miary, nie odczucia): `node ~/.claude/bin/fleet-metrics.js --repo .` -> ratchet: silentCatch, anyUsage, functions>60, shortIdentifiers nie rosna vs main | CI (informacyjnie), review | A1: silentCatch 250/298 w workshop-app |
| G11 | faza projektu: zmiana `pg.phase` -> `production` bez `docs/prr/<data>.md` w tym samym commicie = blok; nieznana wartosc fazy = blok | pre-commit: `node ~/.claude/bin/phase-gate.js --staged` (`ALLOW_PHASE=1`) | slownik SH sekcja 1-2; Lovable-prototypy na prodzie |
| G12 | srodowiska: `.env.local`/`.env.development` wskazuje na `SUPABASE_PROJECT_REF_PROD` = dev na prodzie | stop-gate (ostrzezenie) + ops-reviewer 2 + PRR P15: `node ~/.claude/bin/env-ref-gate.js --repo .` | workshop-app live-testing na prodzie 2026-07 |
| G13 | dlug rejestrowany przy zaciagnieciu: nowy `TODO|FIXME|HACK|XXX` w kodzie bez zmiany `docs/quality/BACKLOG.md` w tym samym commicie = blok | pre-commit: `node ~/.claude/bin/todo-ledger-gate.js --staged` (`ALLOW_TODO=1`) | slownik SH: dlug = kredyt z odsetkami; PR „Pominiete" ginelo |
| G14 | PII: staged migracja dodaje kolumne o nazwie osobowej (email/phone/kennitala/pesel/nip/address/birth...) bez wiersza `tabela.kolumna` w `docs/PRIVACY.md` = blok | pre-commit: `node ~/.claude/bin/pii-inventory-gate.js --staged` (`ALLOW_PII=1`) | DPA GDPR wiszace przed org#2 workshop-app od 2026-07; asystent AI = procesor bez wpisu |

## Rubryka wspolna recenzentow (Google „What to look for" + Ousterhout), <= 8 punktow na role
Kazdy punkt ma `how_to_check`; finding bez wykonanej komendy w `evidence` nie istnieje.
1. **Design**: czy zmiana pasuje do granic modulow; change amplification (1 zmiana -> >3 katalogow)? `git diff --stat`
2. **Functionality**: robi to, co PRD; edge: null/empty/0/1/n+1, timeout, partial failure, brak uprawnien. `rg` po sciezkach bledow
3. **Complexity**: funkcja > 60 linii, zlozonosc > 10, glebokosc > 3 -> podzial. `fleet-metrics --repo`
4. **Tests**: nowa logika ma test asertujacy ZACHOWANIE; bug ma failing test przed fixem; brak mockowania modulu pod testem. `git diff --name-only \| rg test`
5. **Naming/comments**: nazwy z domeny z jednostka; komentarz opisujacy CO -> usun; DLACZEGO -> zostaje. `rg "//\s*(set|get|return|loop|increment)"`
6. **Errors/observability**: kazdy `catch` loguje z kontekstem lub rethrow; user widzi sensowny komunikat. `rg -n "catch \(" -A3`
7. **Consistency**: konwencje sasiednich plikow > preferencje autora; brak nowego wzorca bez ADR. `ls` katalogu, porownaj
8. **Docs**: README gdy zmiana setup/env/komend; ADR gdy architektura; CHANGELOG gdy feat/fix. `git diff --name-only \| rg "README\|CHANGELOG\|docs/"`

## Definition of Done — deklaracja koncowa (w raporcie, z dowodem)
- Komendy + exit code: lint, tsc, testy (nie „przeszlo").
- Tier i lista recenzentow, ktorzy realnie sie odpalili; findings: naprawione / odrzucone z powodem.
- Co pominieto i dlaczego (jawnie).
- Dziala U NICH, nie „u mnie" (software-house 2027): dowod z preview/prod na viewporcie innym niz dev (`qa-matrix` `mobile-budget` 360x640, albo reczny test na telefonie) — albo jawne „nie sprawdzone na mobile".
- Ryzyka, ktore widze, i decyzje, ktore naleza do sponsora/uzytkownika (nie do mnie) — wypisane osobno, nie schowane w „next". Odpowiedz „dobrze" na „jak idzie?" nie istnieje.
- Status: VERIFIED / UNVERIFIED (czego brakuje) / FAILED.

# PG · PRODUCTION READINESS REVIEW — przed deployem / release (T2, T3) (2026-09-05)

Zrodlo: Google SRE PRR (architektura i zaleznosci, instrumentacja, emergency response, capacity, change
management, performance) zredukowane do floty solo-foundera. Kazdy punkt ma powod (incydent) i komende.
Kiedy: PG-core 7P (deploy/release/publish) albo skill `pg-review` na T3.

| # | Pytanie | how_to_check | Incydent |
|---|---|---|---|
| P1 | **Sciezka deployu jest ta, ktora myslisz?** Lovable: `git push` NIE deployuje edge fn ani nie publikuje (Publish reczny). Vercel: push = deploy. | README sekcja Deploy; `rg lovable-tagger package.json` | S04 (VAPID, edge fn martwe od maja) |
| P2 | **Flagi srodowiska**: `PAYMENTS_TEST_MODE`/`*_TEST` = false na prod? Sciezka produkcyjna PRZETESTOWANA (nie tylko testowa)? | `rg -n "TEST_MODE\|SANDBOX" src .env.example`; smoke na prod z flaga prod | S16 (Stripe zamiast Rapyda) |
| P3 | **Sekrety**: wszystkie w Vercel/Lovable Secrets/Infisical; zero w kodzie/historii; rotowane po wycieku | gitleaks; `git log -p -S "sk_"`; `infisical (CLI) check` | S05 (hasla w historii repo) |
| P4 | **Migracja**: wstecznie kompatybilna z poprzednim kodem; RLS na nowej tabeli; `sql-migration-lint --strict` zielony; plan rollbacku (down lub 2-etapowa) | `node ~/.claude/bin/sql-migration-lint.js --repo . --strict` | S06, R2/R4 |
| P5 | **Zaleznosci zewnetrzne** (Woo API, vehicle-registry, Twilio, Resend, Rapyd): timeout na kazdym wywolaniu, retry z jitterem tylko idempotentne, fallback/komunikat gdy padnie | `rg -n "fetch\(" src \| rg -v "signal\|timeout"` = 0 | fallacies of distributed computing; find-part ~7 s |
| P6 | **Observability**: bledy widoczne (Sentry/log z kontekstem + correlation id), alert na wzrost 5xx/failed jobs, dashboard 1 ekran; „bez monitoringu o awarii dowiaduje sie pierwszy klient" (slownik SH) | `rg -n "captureException\|@sentry\|logger\.error" package.json src supabase/functions \| head -3` (0 hitow = brak error trackingu); `rg -n "Bledy runtime: Sentry \[link\]\|Healthcheck: \[URL" docs/RUNBOOK.md` (hit = placeholder z szablonu, NIE skonfigurowane); alert = adres/kanal w RUNBOOK „Monitoring" + 1 testowy event wyslany i odebrany (data w RUNBOOK) | 7O; recheck 2026-09-12 („alert istnieje?" bez komendy) |
| P7 | **Rollback w < 5 min**: poprzedni deploy przywracalny (Vercel promote / Lovable version), feature flag na nowa sciezke, migracja odwracalna | opis w RUNBOOK; sprawdzony raz recznie | 7D |
| P8 | **Runbook**: co robic o 3 w nocy — kill switch, jak wylaczyc integracje, kontakty do uslug, gdzie logi | `docs/RUNBOOK.md` istnieje i ma te 4 sekcje | 7O |
| P9 | **Koszt**: cap na AI/API per org, alert budzetu; nowa usluga ma cene w ADR; tokeny platne tylko tam, gdzie produkt inaczej nie dziala | `rg -n "ANTHROPIC_API_KEY"` w infrze = 0; cap w kodzie | S31, cap $20/dzien/org |
| P10 | **Perf budzet** (T2 UI): bundle nie rosnie > 10 %, LCP < 2,5 s na mobile, brak N+1 w nowych zapytaniach | `size-limit`/build stats; `EXPLAIN` nowych zapytan | dzial Performance |
| P11 | **Sciezki krytyczne na preview/prod** (login, rezerwacja/zlecenie, platnosc, formularz leadu) dla KAZDEJ persony i viewportu z `docs/CRITICAL-PATHS.md` — rownolegle izolowane instancje, nie jeden klik na desktopie | `node ~/.claude/bin/qa-matrix.js --repo . --base-url <preview>` (raport + screenshoty); `npx playwright test` | rental-app booking, formularz kamiljan.com; AS-ANY-MASKS-DEAD (zielone CI, martwa funkcja) |
| P12 | **Release**: CHANGELOG `[Unreleased]` -> wersja, tag `vX.Y.Z`, notatka dla klienta jesli widoczne | `git tag -l`; CHANGELOG diff | szablon pkt 13 |
| P13 | **Dane klientow**: brak realnych danych w fixture'ach/logach/screenshotach; retencja opisana | `rg -n "@.*\.is\|kennitala" tests fixtures` | Privacy |
| P14 | **Wiele sesji/ludzi**: `git fetch` + rebase PRZED pushem; brak blind-push starej kopii | `git status -sb` ahead/behind | S21 |
| P15 | **Srodowiska maja WLASNA baze**: `.env.local` / `.env.development` / preview NIE wskazuja na produkcyjny ref Supabase; staging albo jawne `pg.single_env: true` z powodem | `node ~/.claude/bin/env-ref-gate.js --repo .` = exit 0 | workshop-app: testy na zywo na prodzie, org#1 czyszczona recznie (2026-07-21); slownik SH sekcja 4 |
| P16 | **Backup i restore**: plan backupu istnieje (Supabase Free = BRAK PITR), restore PRZECWICZONY, data ostatniego testu w RUNBOOK; migracja T3 bez swiezego backupu = nie deployujemy | `rg -n "Ostatni test restore: \d{4}" docs/RUNBOOK.md`; `python ~/.claude/bin/backup-drill.py --source-env <SEKRET_DB_URL> --target-url <lokalny pg> --tables <3 najwazniejsze>` exit 0 | slownik SH: „backup nieodtworzony probnie nie jest backupem"; brak drillu w calej flocie do 2026-09-12 |
| P17 | **Faza projektu = prawda**: `pg.phase` w CLAUDE.md i 1. linia README mowia to samo; promocja `-> production` ma wypelniony ten dokument w `docs/prr/<data>.md` | `node ~/.claude/bin/phase-gate.js --staged`; `rg -n "pg.phase" CLAUDE.md`; `head -3 README.md` | slownik SH: „prototyp nie jest produktem"; 14 apek Lovable na prodzie bez decyzji |

Deploy bez P1, P3, P4, P7 = **zablokowany**; migracja T3 dodatkowo bez P16 = **zablokowana** (reszta = musi byc jawnie nazwane jako pominiete + powod).
Promocja `pg.phase` do `production` (nowe repo albo prototyp, ktory „juz dziala u klienta") = ten dokument wypelniony i zacommitowany jako `docs/prr/<RRRR-MM-DD>.md` w TYM SAMYM commicie co zmiana CLAUDE.md — inaczej `bin/phase-gate.js` blokuje (`ALLOW_PHASE=1` = swiadoma decyzja uzytkownika).

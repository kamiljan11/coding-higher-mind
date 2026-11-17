# ADR-0014: Wyzwalacze z blizn — 8 mechanizmow w trybie observe i 3 linie rubryk

Data: 2026-11-15 | Status: proponowane (scalone w `feat/pg-integration` 2026-11-15; wejscie do `~/.claude` tylko za fraza uzytkownika dla pracy nad PG) | Przeglad: 2026-12-13

**Kontekst:** polaczenie 188 blizn z `pg/cases.md` z teza z kursow pokazalo, ze mechanizm oplaca sie tam, gdzie jest
blizna ORAZ luka (brak bramki albo bramka widzi za wasko). uzytkownik (2026-11-15): budowac od najwazniejszego, bez nadmiaru,
tanio w uzyciu; nowe blokady startuja w observe. Stalego kontekstu sesji ta zmiana nie dotyka (+0 linii w `CLAUDE.md`).

**Decyzja i koszt uzycia (pomiar 2026-11-15 na danych z laptopa, tylko odczyt):**

| # | Blizna | Mechanizm | Tryb | Koszt uzycia | Pomiar na prawdziwych danych |
|---|---|---|---|---|---|
| 1 | DOCKER-RESET-DESTROYS-VOLUME | regula `docker-volume-destroy` w `hooks/lib/bash-rules.js` | observe | 0 tokenow, w ramach istniejacego bash-guard | 8778 transkryptow, ok. 5300 komend docker: 0 trafien |
| 2 | SERVICE-ROLE-IN-CLIENT | `bin/service-role-gate.js` w `git-hooks/pre-commit` | observe (`--enforce` = blokada) | 0 tokenow, jeden proces node na commit | 40 repo, 369 plikow z tym napisem, z tego 2 pliki kodu w katalogach klienta (oba to komentarze): 0 trafien; pomiar powtorzony po zwezeniu listy sciezek serwerowych (recenzja r1) |
| 3 | RLS-ANON-WRITE, GRANT-BULK-UNDOES-REVOKE | `sql-migration-lint` R16 (granty hurtowe) | MEDIUM: raport bez blokady | 0 tokenow | 26 repo, 2964 migracje: 2 pliki, oba to petle grantow po katalogu |
| 4 | MIGRATION-VERSION-COLLISION-AFTER-MERGE | `bin/merge-integrity.js` punkt (c) | ostrzezenie przy pushu scalenia | 0 tokenow, jedno `git ls-tree` na scalenie | 13 repo: 0 kolizji |
| 5 | NO-TIMEOUT-EXTERNAL | WYCOFANE po recenzji r1: rozszerzenie `FETCH-NO-TIMEOUT` o axios/got/ky | — | — | 0 uzyc axios/got/ky we flocie (flota uzywa `fetch`): kod bez uzytkownika; wroci z pierwszym repo, ktore ich uzyje |
| 6 | DEDUP-MISSING | precheck `INSERT-NO-DEDUP` (lista tabel w `DEDUP_TABLES`) | podpowiedz dla recenzenta | 0 tokenow; trafienie = 1 wiersz w `prechecks.json` | 14 linii w 14 kopiach roboczych (ok. 1 unikalna) |
| 7 | TEST-EDITED-WITH-CODE | precheck `TEST-SKIPPED` (`it.skip`, `xit`) | podpowiedz | jw. | 225 linii w 55 plikach (z kopiami roboczymi) |
| 8 | TENANT-FK-NO-ORG | `sql-migration-lint` R17 (FK do tabeli najemcy) | MEDIUM: raport bez blokady | 0 tokenow | 2964 migracje: 0 trafien |
| 9 | wetowanie skilli (CLAUDE.md) | `hooks/guard_health.py`: skill pobierajacy zdalna tresc | `[warn]`, bez RED | 0 tokenow, tygodniowo | 110 skilli: 0 trafien |
| 10-12 | SPEC-IS-A-MINE, GATE-WRONG-STATE; bramka akceptacji; SILENT-TOTAL-FAILURE-EQUALS-EXIT-0 | 2 linie w `agents/security-reviewer.md`, 1 w `agents/ops-reviewer.md` | rubryka | 1585 znakow lacznie (ok. 450 tokenow): ok. 300 na kazda recenzje security, ok. 150 na kazda recenzje ops | brak (ocena recenzenta) |

Poprawka wzgledem propozycji: linie rubryk kosztuja przy KAZDYM uruchomieniu recenzenta, nie tylko przy pasujacym
diffie (definicja agenta laduje sie cala); szacunek „ok. 180 tokenow” byl zanizony.

**Nie zbudowane (swiadomie):**
- wykrywanie usunietej asercji w tescie: silnik precheckow czyta tylko linie dodane; zostaje recenzentowi;
- kontrola `read_only` dla Supabase MCP: zaden serwer Supabase MCP nie jest skonfigurowany (pomiar 2026-11-15);
- wszystko „pod odcieciem” z propozycji (TOCTOU jako precheck, karty na slowa kluczowe, parsowanie ostatniej wiadomosci):
  falszywe alarmy wysokie albo 1 incydent; wejda, gdy raport „Petla uzycia” (ADR-0013) pokaze powtorke.

**Odrzucone alternatywy:** blokada od pierwszego dnia (proporcjonalnosc 2026-10-13: bez danych o falszywych alarmach
blokada uczy obchodzenia); nowe linie w `CLAUDE.md` (koszt w kazdej turze kazdej sesji).

**Miara (przeglad 2026-12-13):** `would_block` w `logs/gates.jsonl` dla `docker-volume-destroy` i `SERVICE_ROLE_CLIENT`
(te dwa zapisuja zdarzenie same). R16/R17, kolizja migracji i ostrzezenie o skillach niczego trwale nie zapisuja, wiec na
przegladzie liczy sie je ponownym pomiarem floty: `node bin/sql-migration-lint.js --repo <repo>` po aktywnych repo, `ls-tree`
migracji i wiersz `[warn]` z ostatniego logu guard-health. Trafienie prawdziwe -> przejscie na blokade (`mode: 'enforce'`, `--enforce`, HIGH).
0 trafien przez 6 tygodni -> kandydat „martwa regula” w raporcie petli.

**Reguly-bezpieczniki:** pozycje 1-4 maja lapac zdarzenie rzadkie i drogie, wiec 0 trafien to stan oczekiwany, nie dowod
martwej reguly. Petla uzycia nie moze ich zglaszac jako „martwe” (klucze w `safety_prefixes` w `pg/usage-loop.json`,
dopisane przy scaleniu galezi); czy nadal dzialaja, sprawdzaja przypadki `bg-docker-*` w `pg/eval/cases.json` i testy.

**Koszt cykliczny:** 0 tokenow na commit, push i tydzien (wszystko to skrypty); ok. 450 tokenow na kazda recenzje z dzialem
security albo ops (linie rubryk). Raport miary: sekcja „Petla uzycia” w `Claude Memory/Log/guard-health-user.md`
(projekt petli: ADR-0013; obie zmiany scalone razem w `feat/pg-integration` 2026-11-15).

**Znane luki (recenzja r1, swiadomie zostawione do pierwszego trafienia):** regula Dockera nie widzi `docker rm -v`
(flagi globalne z wartoscia, np. `docker --context X volume rm`, widzi od recenzji integracji), a `docker system prune -a` bez `--volumes` zglasza na wyrost; R16 nie widzi
grantu skladanego przez `||` (role `public` widzi od recenzji integracji takze dla tabel i default privileges); kontrola skilli czyta tylko `SKILL.md`, nie skrypty skilla; bramka service_role
nie skanuje katalogow `lib/`, `utils/`, `hooks/` w katalogu glownym repo (w Next to zwykle kod serwera). Wszystko jest w observe
albo MEDIUM, wiec luka = zanizona miara, nie przepuszczona blokada.

**Wycofanie:** `git revert` commita danej pozycji; kazda pozycja jest osobnym commitem z wlasnym testem.

**Testy:** `bin/test_service_role_gate.js`, `bin/test_sql_lint_bulk_grant.js` (R16, R17), `bin/test_merge_integrity.js`
(11), `bin/test_pg_prechecks.js` (48), przypadki `bg-docker-*` w `pg/eval/cases.json`.

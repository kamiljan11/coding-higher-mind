# ADR-0001 — Playwright jako runtime `qa-matrix` w `~/.claude/tools/qa-matrix`

Data: 2026-09-12 | Status: przyjete

**Kontekst:** Dzial QA (gap L4 vs slownik SH) potrzebuje uruchamiac sciezki krytyczne na rownoleglych izolowanych
instancjach przegladarki. Repo floty maja Playwrighta niekonsekwentnie (workshop-app: brak w node_modules
sprawdzonego klona), a narzedzie ma dzialac z KAZDEGO repo bez instalowania mu zaleznosci.

**Decyzja:** Jeden pin `playwright@1.63.0` w `tools/qa-matrix/package.json` (poza repo floty, wzorzec jak
`tools/workflow-lint`); `qa-matrix.js` laduje Playwrighta Z RUNTIME PG, a z `node_modules` repo tylko jako fallback
i tylko dla repo zaufanego (`pg/trusted-roots.txt` / `--trust-repo-playwright`) — kolejnosc odwrocona po findingu
security REPO-CONTROLLED-MODULE-RCE (2026-09-12; pierwotnie repo bylo pierwsze). Przegladarka:
`npx playwright install chromium` (rewizja z `browsers.json`, sprawdzana przez `guard_health.py`).

**Rozwazone alternatywy:** (a) Playwright MCP z Claude Desktop — nie jest wywolywalny z hooka/CLI 0-tokenowo;
(b) `npx playwright` ad hoc — pobiera pakiet przy kazdym uzyciu, brak pinu, `dep-exists`/supply-chain niesprawdzalne;
(c) wymaganie Playwrighta w kazdym repo — niepotrzebna zaleznosc runtime w produktach bez e2e.

**Konsekwencje:** +~150 MB przegladarki lokalnie; aktualizacja = zmiana pinu + `npm install` + reinstall chromium;
`node_modules` poza gitem (whitelist `.gitignore`). Dlug: brak — narzedzie ma test z realnym przebiegiem (`test_pg_gaps.js`).

**Pulapki dla przyszlego siebie:** `playwright-core/browsers.json` nie jest eksportowany (`require` przez sciezke pliku);
rewizja chromium zmienia sie z wersja pakietu — zielony `npm install` bez `playwright install` = narzedzie nie dziala (exit 3 z komunikatem).

**Koszt cykliczny:** 0 (lokalnie). Zadnych tokenow — narzedzie jest deterministyczne; tokeny dopiero w `qa-reviewer`.

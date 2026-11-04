# ADR-0011: Kanaly observe dla wysylki MCP i panelu Terminal

Data: 2026-11-03 | Status: przyjete (decyzja agenta w ramach delegacji uzytkownika 2026-11-03: „rób kolejną propozycję z AI_DEVS”, „decyduj autonomicznie dla dobra calosci systemu”; spisane PO wdrozeniu kanalow) | Drzwi: dwukierunkowe (observe, wycofanie = 1 wpis) | Przeglad: 2026-11-17

**Kontekst:** dwa kanaly dzialania agenta nie przechodzily przez zaden hook. Wysylka przez MCP (mail, odpowiedz, przekazanie,
zaproszenie, merge PR, push, zadanie zaplanowane) byla chroniona tylko proza w prompcie (kurs AI_DEVS 4 S02E02/S03E02,
`pg/cases.md` › UNTRUSTED-CONTENT-SUBAGENT-INHERITS-ALL-TOOLS). Panel Terminal aplikacji (`mcp__terminal__run_in_terminal`) wykonuje komendy powloki poza matcherem `Bash`.
Oba wdrozone 2026-11-03 bez ADR (commity 992f275, 4d059e3, b0d2bb1); audyt skutkow tego samego dnia wykazal, ze bez daty
przegladu nic nie wymusi decyzji „blokada albo usuniecie” (`pg/GLOSSARY.md` › Jak dodac bramke, krok 5).

**Decyzja:**

| Problem | Mechanizm | Odrzucona alternatywa (dlaczego) |
|---|---|---|
| Wysylka po czytaniu tresci obcej (wstrzykniecie polecenia) | `hooks/outbound-observe.js` (PreToolUse, OBSERVE): `would_block` z polem `via` = klasa pierwszego odczytu (`mail`, `web`, `browser`), `ran` = bez odczytu; loguje tylko nazwe narzedzia. Zakres (audyt 2026-11-03): mail (gmail, zoho w obu pisowniach, w tym kosz/oproznienie folderu, podpis, nazwa/adres nadawcy, auto-odpowiedz), kalendarz, GitHub (merge, push, plik, PR, issue, galaz, aktualizacja PR), `set_auto_merge`, bokun, zadania zaplanowane; lista = `OUTBOUND_SUFFIX` w hooku | blokada od razu (ADR-0008: blokada dopiero po incydencie); log tresci/odbiorcy (PII) |
| Sygnal bez rozroznienia zrodla | pole `via` (audyt 2026-11-03: replay 30 dni = 25/29 `would_block`, wszystkie po przegladarce/sieci, 0 po mailu) | wylaczenie narzedzi UI przegladarki z odczytow (mniejszy szum, ale dowolna lista; `via` rozdziela bez zgadywania) |
| Hook observe martwy wyglada jak „brak wysylek” | `hooks/outbound_health.py` z guard_health: wysylki MCP w transkryptach od wpiecia vs wpisy `OUTBOUND`; wysylki bez wpisu = RED, linia licznikow zawsze widoczna | sprawdzanie tylko `hook-input-keys.json` (pojawia sie dopiero po pierwszej wysylce, nie wykrywa awarii pozniej) |
| Panel Terminal omija bash-guard | ten sam bash-guard w trybie observe dla `mcp__terminal__run_in_terminal`: `would_block` `observe-channel:rule:<id>` / `observe-channel:sudo`, komenda > 20000 znakow = `skipped` (src: hooks/bash-guard.js#OBSERVE_MAX_CHARS) | blokada (panel to tez kanal uzytkownika; brak danych o uzyciu); osobny hook (druga kopia regul) |
| Limit dlugosci a kanal Bash | Bash BEZ limitu observe; ma wlasny limit fail-closed 64 KiB = blokada `unparseable` (src: hooks/lib/shell-parse.js#MAX_INPUT); test w `bin/test_hooks_v3.js` | limit 20k takze dla Bash (fail-open: dopelnienie komendy ponad limit omijaloby wszystkie reguly; pomiar 30 dni: 37/104 019 komend > 20k, `lib.evaluate` <= 78 ms przy 65k) |

**Koszt cykliczny:** guard_health skanuje transkrypty z okna 7 dni (~1,5 GB, 0,4-0,6 s w cieplym cache; zimny niezmierzony; timeout rg 120 s na paczke i sufit calego skanu 300 s = RED, tak jak brak rg, blad rg i kanarek: 0 wywolan MCP przy >= 20 transkryptach); przeglad kazdego `via=mail` recznie.

**Swiadomie przyjete koszty:** subagent nie widzi odczytow rodzica (zanizone `would_block`); wysylka przez przegladarke
(formularz, URL, JS) i powloke (gh/curl) jest poza `outbound-observe`; Terminal: komenda 20k-64k znakow nie jest oceniana
(observe; realny maks. 554 znaki w 93 wywolaniach). Pelna lista granic: `pg/ref-pg-internals.md` › outbound-observe.

**Miara (przeglad 2026-11-17, guard_health linia `gates-7d: outbound-observe od …` + `gates.jsonl` gate `OUTBOUND` / `observe-channel`):**
1. `would_block` z `via=mail` — kazdy wpis = recznie sprawdz, czy wysylka byla zamierzona. Wysylka niezamierzona = incydent -> blokada (ADR-0008).
2. Baza z replayu: `via=browser|web` = 86 % (25/29). Przy przegladzie: brak incydentu i udzial >= 80 % -> zawezic klasy liczone
   do `would_block` do `mail` + `web` (`browser` przestaje dawac `would_block`, zostaje osobny licznik); udzial < 80 % -> zostaje bez zmian.
3. Terminal: liczba wywolan i `observe-channel:*`. Trafienie reguly blokujacej (`rule:<id>`), ktorego uzytkownik nie zamierzal = incydent ->
   blokada tej reguly w panelu; 0 trafien przez 14 dni -> zostaje observe, kolejny przeglad za 30 dni; 0 wywolan panelu przez 60 dni ->
   usunac kanal (koszt utrzymania bez danych).
4. RED zywotnosci w guard_health — kazdy = naprawa wpiecia, nie zmiana progu.

- Sygnal powrotu: incydent (wysylka/komenda niezamierzona po tresci obcej) -> nowy ADR z blokada; 0 wysylek MCP przez 60 dni -> usunac hook.

**Wdrozenie zmiany listy:** zmiana `OUTBOUND_SUFFIX` = ten sam `MATCHER` w `pg/settings-hooks.json`, potem
`ALLOW_CONTROL_PLANE=1 node bin/pg-wire.js --apply` (settings.json) i `node bin/pg-seal.js`; do apply guard_health jest RED (check zgodnosci matchera) — to zamierzone.
Wycofanie samej zmiany listy = `git revert` commitu + ten sam apply.

**Wycofanie:** usun wpis `outbound-observe.js` z `pg/settings-hooks.json` + `HOOK_WIRING` w guard_health (`node bin/pg-wire.js --apply`) ORAZ check zywotnosci w guard_health (blok `outbound_health.liveness`) z `test_outbound_health.py` na liscie testow — inaczej pierwsza wysylka po wycofaniu da trwaly RED;
Terminal = usun `mcp__terminal__run_in_terminal` z matchera bash-guard i `OBSERVE_FIELDS`. Obie zmiany = fraza CONTROL_PLANE + `node bin/pg-seal.js`.

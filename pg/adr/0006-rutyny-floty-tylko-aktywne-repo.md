# ADR-0006: Rutyny floty sprawdzaja tylko repo aktywne (z historii GitHuba)

Data: 2026-10-14 | Status: przyjete (uzytkownik: „sprawdzanie z projektami, nad ktorymi pracujemy aktywnie — widzisz na historii githuba, ze nie wracam do projektow; travel-site nigdzie”)

**Kontekst:** `fleet-pr-reviewer` (dni robocze) przegladal PR-y calej floty, `fleet-cve-watch` (miesiecznie) 7 „zywych produktow” ze sztywnej listy (workshop-app, rental-site, rental-site, rental-site, demo-site, garage-site, travel-site) + Dependabot w ~45 repo. Wiekszosc z 47 repo to projekty skonczone; kazdy przebieg na uspionym repo = limit tygodniowy bez wartosci.

**Decyzja:**
1. Lista repo = `bin/fleet-active-repos.py` (GitHub API przez menedzer sekretow (np. Infisical CLI)). Aktywne = commit na galezi domyslnej (bez merge-commitow) albo PR wlasciciela w ostatnich 30 dniach.
2. Nie licza sie: dni przegladu floty (ruch w >= 8 repo naraz — 2026-09-20 i 10-05), PR o tym samym tytule w >= 3 repo (wdrozenia PG), boty zaleznosci, slady samych rutyn (chore(deps)/cve, auto-fix, learnings).
3. Dane w `pg/fleet-scope.json`: okno, `pin` (zawsze sprawdzane), `exclude` (travel-site — nigdy, tez w podsumowaniu Dependabota). Blad skryptu = FAILED rutyny, nigdy powrot do calej floty.

**Rozwazone alternatywy:** sztywna lista (starzeje sie w tygodniu); samo `pushed_at` / okno commitow (Dependabot i przeglady floty robia „ruch” w 20+ repo — pomiar 2026-10-14: 28 „aktywnych” zamiast 12); prog dni przegladu 5 repo (wycinal prawdziwa prace przy rownoleglych sesjach, client-prototype 10-13; 8 lezy w luce miedzy 6 = zwykly dzien a 10 = przeglad).

**Konsekwencje:** pierwszy pomiar 12 z 47 (34 uspione, 1 wykluczony). Ze skanu `npm audit` + PR z fixem wypadaja dawne zywe produkty: rental-site, rental-site, rental-site, garage-site; zostaje im linia zbiorcza Dependabota (stan ich podatnosci: raporty fleet-cve-watch w Obsidianie, nie w repo — repo idzie do eksportu publicznego). uzytkownik 2026-10-14: `pin` = pusty (swiadomie). Trade-off: mniej kontroli na uspionych repo za mniejsze zuzycie limitu. Pulapka: prog 8 skalibrowany na 2 dniach przegladu.

**Jak cofnac:** stara lista i ZAKRES w `git show 19675b8:scheduled-tasks/fleet-cve-watch/SKILL.md` (linia 21); szybciej — repo do `pin` w `pg/fleet-scope.json` (bez zmiany kodu).

**Sygnal powrotu:** krytyczna podatnosc w uspionym repo z klientami wykryta poza rutyna (Dependabot/mail) -> repo do `pin`; prawdziwa praca pominieta przez filtr (zgloszenie uzytkownika) -> przekalibruj `sweep_min_repos` na swiezych danych.

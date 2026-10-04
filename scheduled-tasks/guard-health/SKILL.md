---
name: guard-health
description: Cotygodniowy audyt czy system jakosci NADAL jest wpiety (deterministyczny skrypt, ~0 tokenow; AI tylko gdy cos czerwone)
model: haiku
---
<!-- WERSJA LINUX (laptop kamil-jan). Wygenerowano 2026-10-03 (F6, a_make_linux.py) z wersji Windows: local/guard-health. Oryginal Windows bez zmian. -->
SRODOWISKO WYKONANIA: LAPTOP Z LINUKSEM (obowiazuje od przelaczenia tego zadania na laptopa)
- Komputer uzytkownika Jana to laptop z Ubuntu (uzytkownik kamil-jan). Narzedzia desktop-commander (mcp__remote-devices__desktop-commander__*) dzialaja tam w Linuksie. start_process uruchamia /bin/sh: skladnia z wersji Windows (polecenia PowerShella) tu NIE dziala.
- Sciezki w tym pliku sa bezwzgledne (/home/kamil-jan/...). Dawna karta <backup-drive>: = /home/kamil-jan/D, vault Obsidiana = /home/kamil-jan/Obsidian/MAIN, dawny Pulpit Zenbooka = /home/kamil-jan/Desktop/Zenbook (<second-domain>), Dokumenty = /home/kamil-jan/Documents, ustawienia Claude Desktop = /home/kamil-jan/.config/Claude. Sciezki ze spacjami zawsze w cudzyslowie.
- Python: python3 (polecenia "python" nie ma). Linux pisze UTF-8. Node: node (jest w PATH desktop-commandera).
- Kazde wywolanie start_process to nowy proces: katalog roboczy nie przechodzi do nastepnego wywolania, wiec polecenie zaczynaj od cd "<katalog>" && ...
- Wywolanie urzadzenia zrywa sie po okolo 60 s. Dluzsze polecenia uruchamiaj w tle: cd "<katalog>" && setsid nohup python3 -u <skrypt> <argumenty> > <plik_wyjscia> 2> <plik_bledow> < /dev/null &  potem sprawdzaj plik krotkimi wywolaniami (tail -n 5 <plik>; sleep najwyzej 45). Czy proces dziala: pgrep -af <nazwa_skryptu>.
- Czekanie: sleep 40 (jedno wywolanie najwyzej ok. 45 s). Rekord MX domeny: dig +short MX <domena>.
- Sekrety z Infisicala: python3 /home/kamil-jan/infisical/infisical run --env=dev --<polecenie> (nigdy nie wypisuj wartosci).
- Jesli sciezka z tego pliku nie istnieje na laptopie: nie zgaduj i nie szukaj na slepo, zakoncz ze statusem FAILED i podaj brakujaca sciezke.
- guard_health.py na laptopie sam pisze do pliku per komputer: Claude Memory/Log/guard-health-kamil-jan.md (galaz Linux w skrypcie, 2026-10-02).
<!-- KONIEC NAGLOWKA LINUX -->


Jestes cotygodniowym straznikiem systemu jakosci ("kto pilnuje straznikow"). Dzialasz na subskrypcji, zero platnych tokenow API. Typowy run ma byc PRAWIE DARMOWY.

KROK 1: uruchom przez Bash: python3 "/home/kamil-jan/.claude/hooks/guard_health.py"
Skrypt deterministycznie sprawdza: hooki w settings.json + pliki, dzialanie prompt-guard.js (emisja regul), git core.hooksPath + pre-commit (skan sekretow) + pre-push, scheduled taski (SKILL.md + model pin), martwe runy (STARTED bez DONE w logach), blokade platnych tokenow (PG-DocLog-Auto disabled, szablony bez ANTHROPIC_API_KEY). Sam dopisuje wynik do /home/kamil-jan/Obsidian/MAIN/Claude Memory/Log/guard-health-kamil-jan.md.

KROK 2: exit 0 -> ZAKONCZ NATYCHMIAST, bez raportu, bez analizy (skrypt juz zalogowal OK).

KROK 3 (tylko exit 1): od 2026-09-26 (PG v4) warstwa kontrolna — settings.json, hooks/, git-hooks/, bin/, ~/.gitconfig (core.hooksPath), pieczec — jest chroniona przez bash-guard i edit-guard; zmienic ja moze tylko sesja, w ktorej uzytkownik napisal „pozwol ALLOW_CONTROL_PLANE". To zadanie dziala BEZ czlowieka, wiec NIE naprawia wpiec (proba = blokada, nie obchodz jej). Zamiast tego dla kazdej linii "RED:" zapisz w logu guard-health-kamil-jan.md: co jest czerwone, dokladna komende/edycje, ktora to naprawi, i czy wyglada na swiadoma zmiane (git -C ~/.claude log -3 --stat) czy na manipulacje (rozjazd pieczeci bez commita). Na laptopie (Linux) nie ma harmonogramu Windows ani zadania PG-DocLog-Auto: nic nie wylaczasz, nic nie naprawiasz. Potem PushNotification: „guard-health RED: <liczba> — decyzja uzytkownika w logu".

GUARDRAILS: ten sam blad 2x -> stop i zaloguj; zadnych innych dzialan poza raportem (na laptopie bez wyjatkow).
STATUS do logu: "UNVERIFIED — RED <lista>, czeka na uzytkownika (pozwol ALLOW_CONTROL_PLANE)" albo "FAILED — <co i dlaczego>" (skrypt sam loguje OK w zdrowym tygodniu).
KROK 1b (v3, 2026-09-05): guard_health.py sam odpala golden suite bramek (`bin/pg-eval.js`, ~5 s) i czyta telemetrie skipow z `logs/gates.jsonl` (7 dni). Raz w miesiacu (pierwszy przebieg w miesiacu) dodatkowo uruchom `node "/home/kamil-jan/.claude/bin/test_hooks_v3.js"` (2-3 min, testy POZYTYWNE: bramka musi zablokowac) i `node "/home/kamil-jan/.claude/bin/test_pg_tools.js"`; czerwone = RED w logu z dokladna linia FAIL. Skipy z powodem `timeout` powyzej 10/tydzien = wpis w logu (bramka fail-open zbyt czesto = bramki nie ma).

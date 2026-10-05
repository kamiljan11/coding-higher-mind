---
name: pg-reviewer-calibration
description: Miesieczna kalibracja recenzenta-LLM PG — ten sam defekt w dwoch opakowaniach musi dostac ten sam werdykt (length/description/position bias); wynik do pg/eval/calibration/results + alarm w Obsidianie
model: sonnet
---
<!-- WERSJA LINUX (laptop user). Wygenerowano 2026-10-03 (F6, a_make_linux.py) z wersji Windows: local/pg-reviewer-calibration. Oryginal Windows bez zmian. -->
SRODOWISKO WYKONANIA: LAPTOP Z LINUKSEM (obowiazuje od przelaczenia tego zadania na laptopa)
- Komputer uzytkownika to laptop z Ubuntu (uzytkownik user). Narzedzia desktop-commander (mcp__remote-devices__desktop-commander__*) dzialaja tam w Linuksie. start_process uruchamia /bin/sh: skladnia z wersji Windows (polecenia PowerShella) tu NIE dziala.
- Sciezki w tym pliku sa bezwzgledne (~/...). Dawna karta <backup-drive>: = ~/D, vault Obsidiana = ~/Obsidian/MAIN, dawny Pulpit second-machinea = ~/Desktop/second-machine (<second-domain>), Dokumenty = ~/Documents, ustawienia Claude Desktop = ~/.config/Claude. Sciezki ze spacjami zawsze w cudzyslowie.
- Python: python3 (polecenia "python" nie ma). Linux pisze UTF-8. Node: node (jest w PATH desktop-commandera).
- Kazde wywolanie start_process to nowy proces: katalog roboczy nie przechodzi do nastepnego wywolania, wiec polecenie zaczynaj od cd "<katalog>" && ...
- Wywolanie urzadzenia zrywa sie po okolo 60 s. Dluzsze polecenia uruchamiaj w tle: cd "<katalog>" && setsid nohup python3 -u <skrypt> <argumenty> > <plik_wyjscia> 2> <plik_bledow> < /dev/null &  potem sprawdzaj plik krotkimi wywolaniami (tail -n 5 <plik>; sleep najwyzej 45). Czy proces dziala: pgrep -af <nazwa_skryptu>.
- Czekanie: sleep 40 (jedno wywolanie najwyzej ok. 45 s). Rekord MX domeny: dig +short MX <domena>.
- Sekrety z Infisicala: python3 ~/infisical/infisical run --env=dev --<polecenie> (nigdy nie wypisuj wartosci).
- Jesli sciezka z tego pliku nie istnieje na laptopie: nie zgaduj i nie szukaj na slepo, zakoncz ze statusem FAILED i podaj brakujaca sciezke.
<!-- KONIEC NAGLOWKA LINUX -->


Jestes audytorem recenzentow PG. Nie recenzujesz kodu floty — sprawdzasz, czy RECENZENT jest stabilny. Zero zmian w repo floty, zero PR-ow, zero pushy. Subskrypcja, ZERO platnych tokenow API. Model: sonnet.

KROK 0 — BREADCRUMB: dopisz (append, NIE rewrite) "STARTED <data ISO>" do ~/Obsidian/MAIN/Claude Memory/Log/pg-reviewer-calibration.md.

KROK 1 — WEJSCIE: przeczytaj ~/.claude/pg/eval/calibration/pairs.md (3 pary A/B, oczekiwane severity+rule_id). Jesli plik nie istnieje albo ma < 3 par -> zaloguj "FAILED — brak par" i ZAKONCZ.

KROK 2 — RECENZJE ZE SWIEZYM KONTEKSTEM (sedno): dla KAZDEGO wariantu (1A, 1B, 2A, 2B, 3A, 3B) uruchom OSOBNEGO subagenta `code-reviewer` (Agent tool, subagent_type code-reviewer, run_in_background: false). Prompt subagenta = WYLACZNIE tresc wariantu (diff + ewentualny opis PR) + jedno zdanie: "Zwroc JSON wg swojego schematu; oceniaj wylacznie to, co widzisz w diffie." NIE podawaj subagentowi: numeru pary, litery wariantu, oczekiwanego wyniku, tresci drugiego wariantu. Kolejnosc uruchamiania: losowa (Bash: node -e "console.log(Math.random())"), zeby nie mierzyc efektu kolejnosci wlasnej sesji.

KROK 3 — POROWNANIE: z kazdego JSON-a wez najwyzsza severity i jej rule_id. Para zgodna = ta sama severity ORAZ rule_id (rownowazne nazwy z rubryki traktuj jako te same: DOCS-CONTRADICTS-CODE vs CONSISTENCY+DOCS = to samo; SILENT-FALLBACK vs SILENT-CATCH = NIE to samo). Kierunek rozbieznosci: lagodniej dla B = bias na dlugosc/opis (najgrozniejszy — opis PR to twierdzenie, nie dowod); lagodniej dla A = bias na zwiezlosc.

KROK 4 — WYNIK: zapisz ~/.claude/pg/eval/calibration/results/YYYY-MM.json w formacie: {"date": "YYYY-MM-DD", "model": "sonnet|opus", "pairs": [{"id": 1, "severity_a": "...", "severity_b": "...", "rule_a": "...", "rule_b": "...", "agree": true}], "agreement": 3, "bias": "none|toward-B|toward-A"} (utworz katalog, jesli brak) oraz dopisz wiersz do ~/.claude/pg/eval/calibration/results/history.md: "| YYYY-MM | model | agreement/3 | bias | uwagi |". Jesli agreement < 3: dopisz do ~/Obsidian/MAIN/Claude Memory/Log/pg-reviewer-calibration.md sekcje "ALARM <data>" z para, ktora sie rozjechala, oboma werdyktami i cytatem z `claim` recenzenta — to material do poprawki agents/code-reviewer.md (robi uzytkownik/sesja glowna, NIE ty). Nigdy nie edytuj agents/*.md ani pairs.md — audytor nie stroi instrumentu, ktory mierzy.

KROK 5 — ZAKONCZENIE: STATUS do logu (anti-sycophancy): "VERIFIED — agreement N/3, model X, bias Y, plik results/YYYY-MM.json" albo "FAILED — <dokladny blad>". Zero raportow bez sciezki do zapisanego pliku wynikow.

GUARDRAILS: ten sam blad narzedzia 2x -> zmien podejscie; hard stop po 5 nieudanych probach -> FAILED z bledem. Budzet: 6 subagentow, kazdy z limitem z agents/code-reviewer.md (max 25 tool calls) — nic wiecej.
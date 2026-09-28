# PG v4 — znane granice (stan 2026-09-26)

Recenzja po wdrozeniu v4 (security/code/data/ops + weryfikator, 2 rundy) zglosila 26 problemow; 17 naprawionych
i potwierdzonych testem. Reszta to warianty obejscia, ktorych hook czytajacy tekst komendy nie zamknie — wymagaja
izolacji na poziomie systemu (osobny uzytkownik / ACL na `~/.claude`, sandbox), nie kolejnej reguly w bash-guard.

| Klasa obejscia | Przyklad | Czym lagodzone dzis |
|---|---|---|
| Alias sciezki spoza normalizacji | litera dysku zmapowana na folder ustawien (`subst X: ~/.claude`, `net use`) i zapis przez `X:\hooks\...` | pieczec (`bin/pg-seal.js --check`, SessionStart `[PG-SEAL]`, guard_health RED) — wykrycie po fakcie |
| Pieczec z cofnieta data | zapis pliku kontrolnego + ponowne `pg-seal.js` z podrobiona data `sealed_at` w oknie mintu | `sealAuthorized` sprawdza event mintu w telemetrii; telemetrie da sie jednak nadpisac tym samym kanalem |
| Dynamiczne nazwy zmiennych PowerShell | `${env:ALL`+`OW_X}`, `Set-Item env:$n` z nazwa skladana w runtime | parser oznacza `UNKNOWN`, reguly czesciowo; reszta = pieczec |
| Plik skryptu jako posrednik | agent zapisuje `.ps1`/`.py` do %TEMP% i uruchamia go; tresc skryptu nie jest parsowana jak komenda | `interpreterWrites` lapie oczywiste zapisy; pelna tresc pliku = poza zasiegiem |

Decyzja: nie gonimy tych wariantow regulami (wyscig zbrojen, rosnacy FP). Nastepny krok, jesli ryzyko wzrosnie:
izolacja OS (osobne konto dla agenta bez prawa zapisu do `~/.claude/hooks`, `bin`, `settings*.json`).

Kopia PG na GitHubie (`bin/pg-sync.js`, security-review 2026-09-26): `pull` ufa zawartosci `<github-owner>/<your-private-pg-repo>`.
Kto ma zapis do repo (agent z `GITHUB_Token` przez API, przejety token), moze podmienic bramki, a pull uruchamia
pobrany `pg-eval.js`/`pg-seal.js`. Dzis lagodzi to: pull tylko za fraza uzytkownika, `diff --stat` przed merge, cofniecie przy
czerwonych testach, brak automatycznego pobierania (laptop jedzie Syncthingiem, pull = tylko odtwarzanie). Docelowo:
osobny klucz tylko do tego repo + ochrona main z wymaganymi podpisanymi commitami.

Stop-gate na Windowsie (ops-review 2026-09-28): `execSync` z `timeout` zabija proces powloki, ale nie jego potomkow
(python.exe, node.exe testow) — zawieszony venv albo suita zostawia procesy do recznego ubicia. Blokada i komunikat
dzialaja; sprzatanie drzewa procesow (`taskkill /T`) wymaga przejscia z execSync na spawn z PID — do zrobienia, gdy
problem sie pojawi.

Luka procesowa: `bin/pg-aggregate.js` nie ma stanu „ryzyko zaakceptowane" — finding swiadomie zostawiony trzyma
werdykt REQUEST CHANGES. Do dodania: `accepted_risks` z uzasadnieniem i data przegladu.

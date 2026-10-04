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

Stop-gate, testy (data-review 2026-09-28, poza zakresem poprawek): pominiecie testow z braku budzetu czasu trafia tylko
do logu, bez `systemMessage`. (`npm.cmd`/`python.bat` w repo zamkniete: `NoDefaultCurrentDirectoryInExePath=1` w CHILD_ENV.)
Agent, ktory swiadomie falszuje zielone testy (conftest.py z os._exit(0), edycja testow), jest poza zasiegiem tej
bramki — lapie go recenzja dzialowa diffu, nie wykonanie testow. Ta sama klasa (security-review 2026-09-28): modul
biblioteki standardowej albo zaleznosci ladowany LENIWIE po starcie pytesta, ktory plik w repo moze zaslonic (pytest i
jego zaleznosci laduja sie z repo wyjetym z sys.path, ale pozniejsze importy juz nie), oraz podmieniony pytest w `.venv`
wewnatrz repo (uznawany za legalny).

Luka procesowa: `bin/pg-aggregate.js` nie ma stanu „ryzyko zaakceptowane" — finding swiadomie zostawiony trzyma
werdykt REQUEST CHANGES. Do dodania: `accepted_risks` z uzasadnieniem i data przegladu.

## Merge bez frazy i regula skryptow scalajacych (2026-10-01, v2)

- bash-guard czyta tylko kod faktycznie uruchamiany (skrypt, `-c`/`-e`, stdin, heredoc). NIE sledzi importow
  (`python -m pakiet`, `import merger` z innego pliku) ani adresu sklejanego z kawalkow dalej niz 400 znakow albo
  zakodowanego. Twarda granica: scalenie wymaga tokenu z menedzer sekretow (np. Infisical CLI), a uzycie mostu jest logowane.
- pg-merge-bezpieczny: lista plikow PR z GitHuba nie jest przypieta do SHA (scalenie juz jest: PUT /merge z `sha`).
  Force-push miedzy odczytem plikow a scaleniem = 409 od GitHuba, nie ciche scalenie.
- Dowod recenzji T2 to katalog pg-review wskazany przez agenta; agent moglby podrobic findings. Ten sam poziom zaufania
  co stop-gate wobec pg-review — przeciw temu dziala tylko recenzja rozkladu `auto-merge` w gates.jsonl.
- Regex `auth` w nazwie pliku lapie tez np. `AuthorCard.tsx` (falszywa odmowa = fraza; wybrane swiadomie, fail-safe).
- (v3, 2026-10-01 23:00) Otwarte do recenzji przed wlaczeniem auto-merge: T0 z dopasowania podciagu (`changelog/actions.ts`,
  `ReadMeButton.tsx`, `.mdx`/`.svg` ze skryptem) — T0 musi byc lista dozwolonych rozszerzen tresci, nie podciag; nieśledzony
  plik > 20 MB liczony z rozmiaru+mtime (`touch -r` po podmianie); `cat x | python` gdy x nie zawiera wzorca w tekscie komendy.

## Poziomy wyjatkow A/B/C i samozatwierdzenie (2026-10-02)

- Poziom A (10 bramek jakosci) nie ma limitu uzyc ani alarmu — jedyny slad to `bypass` „poziom A" w gates.jsonl.
  Swiadoma decyzja uzytkownika (petle bez czekania); przeglad rozkladu przy retro.
- Poziom B: dowod = transkrypty subagentow `security-reviewer` + `code-reviewer` w `~/.claude/projects/*/<sesja>/subagents`,
  ktore wymieniaja przebieg i sa nowsze niz findings. Agent, ktory CELOWO dopisze podrobiony transkrypt JSONL + meta.json,
  obejdzie to (model zagrozen = agent na skrotach, nie zlosliwy proces). Recenzent odpalony z promptem wskazujacym przebieg,
  ktory nic nie zrobil, a orkiestrator napisal findings przed nim — tez przejdzie; podmiana findings PO recenzencie = odmowa.
- `leavesRepo()` w bash-guard jest konserwatywny tekstowo: cd/-C/-R/sciezka absolutna/`..`/`~`, KAZDE `$`/backtick
  (zmienne, podpowloki) i `GIT_*=` = poza repo -> wyjatek B nie dziala (falszywa odmowa = fraza uzytkownika).
- Grant B (15 min / 1 uzycie) jest przypiety do repo i sesji, nie do obiektu akcji: recenzja malej zmiany autoryzuje
  JEDNA komende RM/RESET/CLEAN/UNKNOWN_DEP/PII w tym repo. `--reason` + `self_approved` w gates.jsonl = slad do retro.
- Czas recenzji = najpozniejszy `timestamp` w transkrypcie (nie mtime — `touch` nie pomaga); dopisanie linii JSONL to
  celowe falszerstwo (poza modelem zagrozen). verdicts.json wymaga transkryptu subagenta `verifier`.
- Findings musza zawierac kazdy `rule_id`, ktory recenzent zapisal w wejsciach swoich narzedzi (usuniecie findings po
  recenzji = odmowa). Nie chroni przed zlagodzeniem `severity` przy zachowanym `rule_id` — to widac w diffie findings.
- Klucz jednorazowosci przebiegu = skrot tresci (diff + findings WYMAGANYCH rol + werdykty), wiec kopia katalogu ani dopisany findings.x.json nie daja drugiego grantu. ALLOW_PII wymaga tez recenzji data.
- Regula `override-mint` lapie jawne `overrides` + `mint/consume` w komendzie. Nazwa sklejana (`'over'+'rides'`) albo
  skrypt z PLIKU ja omija — ten sam limit co dla poziomu C od 2026-09-26 (wydanie dowolnego wyjatku przez wlasny kod);
  widzi to tylko pieczec (`pg-seal --check`) i wpisy bez `minted` w gates.jsonl. Model zagrozen = agent na skrotach.
- Sprzatanie wyjatkow liczone po `expires`; zegar cofniety przedluza zycie wyjatku (TTL z czasu wydania).

## 2026-10-04 bramka `arch` (stop-gate, T2+) i znacznik z plikow sesji
- `arch` wykrywa z diffu tylko: nowa zaleznosc w manifescie (package.json/pyproject/requirements/Cargo/go.mod), `CREATE TABLE` w SQL, NOWY plik infra (Dockerfile, compose, vercel.json, netlify/fly, supabase/config.toml, nowy workflow). Nowy modul/katalog bez nowej zaleznosci NIE jest wykrywany.
- Wymog spelnia plik `docs/adr/*.md` w diffie sesji z >= 5 niepustymi dodanymi liniami (po security-review 2026-10-04 samo wywolanie pg-council NIE wystarcza). Jakosci tresci bramka nie ocenia (recenzenci T2+). Jak kazda bramka: drugi Stop w cyklu przepuszcza z widocznym komunikatem (anty-petla).
- prompt-guard: regula „architektur*” odpali tez przy stronie dla biura architektonicznego — to tylko podpowiedz skilli (bez blokady), swiadomy koszt.
- Znacznik anty-petli liczy odcisk tylko z plikow „wlasnych” (ownedBy z transkryptu). Plik zmieniony przez sesje komenda Bash BEZ sciezki w tresci komendy (np. skrypt z pliku) nie jest „wlasny” — ta sama granica co ownedBy.
- `bin/test_hooks_v2.js` uruchomiony przez Claude Code: bash-guard `pr-merge` blokuje (skrypt zawiera komendy merge jako dane testowe) — falszywy alarm, uruchom recznie w terminalu.
- `arch`: przeniesienie package.json / compose (rename) widziane jak nowy plik z nowymi zaleznosciami -> mozliwy falszywy alarm (diff liczony tylko dla wlasnych sciezek, bez detekcji rename).
- Nazwy plikow z `"`, tabulatorem albo backslashem git cytuje mimo `core.quotePath=false` -> w odcisku znacznika `:nieczytelny` (zmiana tresci takiego pliku nie odnawia znacznika).
- `pg-council` jako slash command nie jest uznawany — jedyna droga spelnienia `arch` to ADR (>= 5 linii) w diffie sesji.
- `arch` fail-open (logowane jako `skipped`, nie ciche): nieśledzony plik > 1 MB (np. zrzut pg_dump), > 200 plikow, > 10 commitow sesji.
- Znaczniki `logs/stop-gate-wm/*.json` nie sa sprzatane automatycznie (po jednym malym pliku na sesje) — sprzatanie reczne / guard_health.
- `CREATE TEMP TABLE` celowo nie jest sygnalem architektury; `CREATE TABLE` wewnatrz literalu `'...'` jest ignorowany, w ciele `$$...$$` — liczony.
- stop-gate liczy do tieru WSZYSTKIE commity z reflogu od startu sesji, takze commity rownoleglej sesji w tym samym repo (falszywe [review]). Atrybucja po slowie „commit” w transkrypcie zostala cofnieta 2026-10-04 (agent kontroluje tekst komendy -> ukryty commit T3 omijal recenzje). Obejscie FP: drugi Stop przepuszcza z komunikatem. Bezpieczna atrybucja wymaga pozytywnego dowodu obcosci (transkrypt innej sesji z commitem w oknie) — do zrobienia.

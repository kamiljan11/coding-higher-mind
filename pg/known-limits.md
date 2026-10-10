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
- stop-gate (2026-10-04, po recenzji 48179e1): kazdy commit z reflogu od startu sesji liczy sie do tieru (fail-closed). Wykluczony tylko commit z pozytywnym dowodem obcosci: obejmuje go okno narzedzia INNEJ sesji (12 ostatnio zmienionych transkryptow w katalogu projektow), zadne okno tej sesji (okna zamkniete tylko dla narzedzi synchronicznych; Agent, MCP, Bash w tle/odlaczony = do konca sesji) i jego czas w reflogu jest monotoniczny. Granice: commit tej sesji z procesu odlaczonego w sposob niewidoczny dla regexu, zrobiony dokladnie w czasie narzedzia innej sesji, zostanie wykluczony; pierwszy commit sesji z GIT_COMMITTER_DATE sprzed startu sesji (bez starszych wpisow w sesji) nie jest liczony.
- Eksport publiczny czyta 5 skilli z allowlisty przez symlinki do pluginu Cowork (poza gitem, zalezne od maszyny/sesji); brak SKILL.md = ostrzezenie i karta znika (test count == allowlista to lapie tylko tam, gdzie linki zyja).
- `.gitignore` dla skilli Cowork to reczna lista 36 nazw — nowy symlink wraca do diffu (do zrobienia: guard_health „kazdy symlink w skills/ ignorowany”).
- stop-gate: repo, w ktorym sesja edytowala TYLKO plik ignorowany (np. pamiec w ~/.claude/projects, node_modules, .env), nie jest kontrolowane — takze jesli ta sama sesja zmienila w nim cos Bashem; repo innych niz cwd edytowane wylacznie Bashem nigdy nie byly odkrywane (dlug).
- pg-self-approve / pg-merge (r4-r5, 2026-10-04): dowod = transkrypty z `diff_sha256=<sha>` + sciezka diff.patch w prompcie, wynik koncowy zaczynajacy sie od JSON findings, multizbior `rule_id|plik`. Granice:
  - kosmetyczna zmiana diffu (nowy sha, nowy RUN) wyprowadza stare recenzje z kontroli zgodnosci — „napraw finding -> nowy diff -> czysta recenzja" jest zaufana (nikt nie sprawdza, ze fix byl prawdziwy, poza weryfikatorem);
  - falszywy blocker w JAKIEJKOLWIEK recenzji danego diffu blokuje ten diff na stale (fail-closed) -> fraza uzytkownika albo zmiana diffu;
  - przerwany recenzent bez JSON blokuje diff przez 2 h (potem ignorowany, jesli nie zostawil rule_id);
  - definicja agenta: odmowa tylko dla `.claude/agents/<typ>.md` w cwd transkryptu i jego przodkach; agent pluginu o tej samej nazwie nie jest wykrywany; agent `general-purpose` z rola w prompcie nigdy nie jest dowodem;
  - submodule: `git diff HEAD` pokazuje tylko `Subproject commit` — zmiany wewnatrz submodulu nie sa recenzowane ani porownywane;
  - diff PR z API (`/pulls/N`, v3.diff) nie jest przypiety do head sha; wyscig X->Y->X (force-push w trakcie oceny) teoretycznie mozliwy (head sprawdzany ponownie przed PUT);
  - skan wszystkich transkryptow subagentow (prefiltr 64 KiB) rosnie liniowo z historia ~/.claude/projects (2026-10-04: 0,3 s); timeout pg-merge-dowod 120 s = odmowa.
- Podmiana recenzenta (security-review r6, 2026-10-04) — poprawione, czeka na runde 7: bash-guard `claude-agent-override` (CLI `claude` z --agents/--plugin-dir/--settings/--system-prompt* = fraza), projektowe `.claude/agents/*.md` = warstwa kontrolna (TOCTOU), wykrywanie definicji takze po frontmatter `name:`, prompt findera z „uznanym ryzykiem"/dyktowanym wynikiem albo > 3000 znakow nie jest dowodem. Granica: agent pluginu zainstalowanego wczesniej (namespace `plugin:typ` nie liczy sie jako recenzent), definicja podana inna droga niz CLI/plik (np. env SDK) — niewykrywana.
- Projektowe `.claude/agents/*.md` sa warstwa kontrolna (fraza uzytkownika) — swiadome tarcie po bliznie TOCTOU r6. `claude` uruchomiony z interpretera (`python -c subprocess.run(["claude","--agents",...])`) nie jest lapany przez bash-guard; wykrywanie sterujacego promptu to lista fraz nakazujacych (obejscie parafraza mozliwe) — recenzent i tak ocenia wg swojej rubryki.
- Recenzent sterowany POZA promptem (security-review r7, otwarte): CLAUDE.md / CLAUDE.local.md / .claude/rules w repo albo przodkach cwd recenzenta trafia do jego kontekstu; pg-self-approve/pg-merge tego nie sprawdzaja. Lista fraz sterujacych (STEERING_RX) to heurystyka — parafraza ja omija. Wniosek do decyzji uzytkownika: dowod recenzji wytwarzany w srodowisku, ktore kontroluje agent, nie da sie w pelni zabezpieczyc regulami — pewny auto-merge wymaga recenzji poza kontrola agenta (np. CI z CLAUDE_CODE_OAUTH_TOKEN na swiezym checkoucie bazy) albo czlowieka.
- Ochrona `.claude` i `.claude/agents/**` obejmuje takze katalogi tymczasowe (atak TOCTOU z /tmp) — kopie PG do piaskownicy testowej wymagaja frazy.
- Obejscia bash-guard znane po rundzie 8 (ops-review): `export CLAUDE_CONFIG_DIR=...` w osobnej komendzie, symlink binarki claude pod inna nazwa, projektowy agent wstawiony przez `git checkout <ref> -- .claude/agents/x.md`, `git restore`, `cp -r a/.claude b/` (cel = rodzic), archiwa (`tar -C`, `unzip`). Potwierdza wniosek: regulami powloki nie da sie zamknac podmiany recenzenta — pewny auto-merge = recenzja poza kontrola agenta.
- 2026-10-04 ~17:15: auto-merge WLACZONY swiadoma decyzja uzytkownika mimo powyzszych granic (ryzyko przyjete; nadzor czlowieka na biezaco). Wylacznik: `~/.claude/bin/pg-merge-bezpieczny.off`.
- Recenzja w CI (2026-10-04): `templates/repo/.github/workflows/pg-review.yml` — `claude -p` (CLI 2.1.283, OAuth z subskrypcji) z narzedziami Read/Grep/Glob na diffie base...head w swiezym runnerze; check `pg-review` zielony tylko przy APPROVE bez blocker/major. pg-merge-bezpieczny bez `--recenzja` przyjmuje go jako dowod T1/T2, gdy workflow jest na galezi bazowej. Granice: wymaga sekretu CLAUDE_CODE_OAUTH_TOKEN w repo (bez niego job SKIPPED = brak dowodu); konfiguracja Claude (.claude, CLAUDE.md, .mcp.json) w CI pochodzi z BAZY, nie z head PR; istniejace repo floty trzeba doposazyc w workflow i sekret.
- pg-review w CI po recenzji 79067fe (security/code/ops/data): dowod = job `pg-review` z przebiegu `.github/workflows/pg-review.yml` (Actions API: sciezka, numer PR, pierwsza proba, wszystkie przebiegi head zielone; obcy check o tej nazwie = odmowa). CLI w CI: `--restricted --strict-mcp-config --tools Read,Grep,Glob`, konfiguracja Claude z BAZY, wynik musi miec diff_sha256 i diff_lines_read, num_turns >= 2, bez permission_denials. Granice: jeden recenzent LLM — dowod probabilistyczny, podatny na prompt injection z diffu (brak k-of-n); agent z prawem push moze zmienic workflow w porzucanym PR i odczytac sekret OAuth (pull_request daje sekrety PR-om z repo) — token traktowac jako dostepny dla agenta; repo z domyslnym GITHUB_TOKEN 'read and write' i workflowami bez `permissions:` sa slabsze.
- [ZASTAPIONE wpisem r10 nizej — okno 90 dni] pg-review CI, historia werdyktow (2026-10-04, po rundach 10-11): adnotacja `pg-review-verdict <werdykt> <sha diffu>` (scisly format, nieczytelna = odmowa); historia z ostatnich 100 przebiegow workflow w CALYM repo (nie tylko w PR). Odmowa, gdy: ten sam diff mial REQUEST_CHANGES gdziekolwiek; ten PR/galaz mial REQUEST_CHANGES (kosmetyczna zmiana nie losuje od nowa — dalej tylko --recenzja albo fraza); luka w run_number (usuniety przebieg). Granice: REQUEST_CHANGES starszy niz 100 przebiegow repo nie jest widoczny; nowy PR z NOWEJ galezi z kosmetycznie zmienionym diffem nie dziedziczy odrzucenia.
- [ZASTAPIONE wpisem r10 nizej — odrzucenie w dowolnym formacie = RC] pg-review CI: werdykt INFRA (proza zamiast JSON, niepelna recenzja, zly diff_sha256) NIE jest liczony jako odrzucenie — pusty commit daje nowa recenzje tego diffu; REQUEST_CHANGES w poprawnym JSON jest zapisywany zawsze.
- pg-review CI (recenzje r9-r11, 2026-10-04): historia werdyktow = przebiegi `pg-review.yml` z 90 dni (pelne stronicowanie; >= 1000 wynikow = obciecie API = LUKA); usuniety przebieg wykrywany W OKNIE: dziura w numeracji albo granica okna (ostatni przebieg sprzed okna != najstarszy w oknie - 1) = LUKA; kasowanie/retencja starsze niz okno nie blokuja. Przebiegi po rerunie czytane z jobami wszystkich prob (`filter=all`); adnotacje pobierane tylko, gdy krok Werdykt sie wykonal (brak kroku o tej nazwie = pobierz). Odrzucenie: JSON z werdyktem REQUEST_CHANGES/CHANGES_REQUESTED/REJECT(ED) (null/nieznany = INFRA) albo proza z dokladnym tokenem `REQUEST_CHANGES` = REQUEST_CHANGES; inna proza = INFRA (format zlamany, nowa recenzja po nowym commicie — ryzyko: recenzent odrzucajacy proza bez tokenu nie zostawia sladu). stdout kroku Werdykt sanityzowany; instalacja CLI 3 proby. ZALOZENIA: workflow ma WYLACZNIE trigger pull_request (inny trigger -> dziury -> LUKA). KOSZT: przebieg nie-success z wykonanym krokiem Werdykt = 2+ wywolania API przy kazdej probie merge (limit -> BLAD, fail-closed). RYZYKO PRZYJETE (decyzja uzytkownika o auto-merge): nowa galaz + nowy PR + kosmetyczna zmiana kodu = nowe losowanie recenzji CI; odrzucenie starsze niz 90 dni wypada z historii.
- pg-review CI (pilot claude-autoshutdown#13, 2026-10-04): check `pg-review` NIE moze byc required status check w ochronie galezi — SKIPPED (INFRA) GitHub liczy jako zaliczony; dowod czyta tylko pg-merge-bezpieczny.py. Wyciek CLAUDE_CODE_OAUTH_TOKEN przez prompt injection: Read poza workdir/$RUNNER_TEMP = permission_denials = INFRA (sprawdzone CLI 2.1.283, /etc/hostname -> DENIED) + redakcja sk-ant-* w summary/logu. Granica: plik w checkoucie PR zawierajacy token (nie powinien istniec — persist-credentials: false).
- auto-doc (2026-10-05): hook SessionEnd jest wpiety w settings.json, ktory w gicie ma skip-worktree (plik per maszyna) — pg-sync go nie przenosi; na nowej maszynie guard_health pokaze RED do czasu wpiecia. Redakcja w notatkach lapie znane formaty kluczy (GitHub, Anthropic, OpenAI sk-proj, Stripe, Supabase sbp/JWT, Meta EAA, Twilio AC, AWS, Slack, Bearer, password=/token=/api_key=) — nie lapie dowolnych hasel w prozie ani danych osobowych (e-mail, kennitala); notatki leza w prywatnym vaultcie Obsidiana.

## Mody Claude Code jako warstwa kontrolna (faza 0, 2026-10-09; recenzja security+code+ops)
Chronione: `~/mods/**` (zrodlo marketplace `local-mods`), `~/.claude/plugins/**` (cache, z ktorego mody sie laduja), `~/.claude/dev-mods/**`, `**/.claude/skills/*/{.claude-plugin,hooks,.mcp.json}` (skill-plugin `@skills-dir` laduje sie sam), mutujacy git w `~/mods`, regula `claude-plugin-change` (install|enable|update|configure|eval|init|new, marketplace add|update = fraza; ODEJMOWANIE wolne: disable|uninstall|remove|prune|autoremove, marketplace remove; `--help` wolne). Granice:
- Posrednictwo komendy: funkcja powloki z `"$@"`, symlink/kopia binarki `claude` pod obca nazwa, argumenty przez `xargs` ze stdin — regula patrzy na argv jednej komendy. Ta sama klasa co „plik skryptu jako posrednik".
- Interpreter z celem skladanym w wywolaniu, ktorego API_WRITE_RX nie rozpoznaje (`open(os.path.join(expanduser('~'),'.claude','plugins',...),'w')`): przechodzi TAK SAMO dla `~/.claude/hooks` — stara klasa, nie regresja.
- Mod dziala WEWNATRZ Claude Code: `$.fs.write`/`$.process.run` moda omijaja hooki settings (np. reflect-mod zapisuje CLAUDE.md po kliknieciu Save). Ochrona = przeglad kodu moda przed instalacja + fraza; `/plugin` w czacie to akcja uzytkownika, hook jej nie widzi.
- `~/mods` i cache nie maja historii (nie sa repo git, `.gitignore` ~/.claude wyklucza plugins/); pg-seal/guard_health ich nie pieczetuja. Podmiana cache poza narzedziami agenta = niewykryta. Do zrobienia: hash cache vs zrodlo w guard_health (plan modow, faza 1).
- Awaryjne wylaczenie zepsutego moda jest WOLNE (`claude plugin disable|uninstall <mod>`, decyzja 2026-10-10: odebranie nigdy nie wymaga zgody); fraza tylko na dodawanie/wlaczanie/aktualizacje.
- Projektowe `<repo>/.claude/skills/*/.claude-plugin` (sklonowane repo klienta): chronione przed zapisem agenta, ale czy Claude Code laduje je automatycznie — [NIEPEWNE], do sprawdzenia.
- (r2) Swiadomie wolne: `git clone ... ~/mods/x` i `npm install` w katalogu moda (nowy katalog bez manifestu w marketplace nie laduje sie; instalacja do Claude Code i tak wymaga `claude plugin install` = fraza). Slad modow w kodzie interpretera dziala bezwarunkowo: skrypt czytajacy ~/.claude/plugins i piszacy gdzie indziej dostaje blokade (FP akceptowany — odczyt robimy `cat`/`grep`, nie interpreterem).
- (r3) `git clone <url> ~/.claude/skills/<n>` (i do hooks/<n>, plugins/<n>, ~/mods/<n>) przechodzi — stara klasa (cel klonu nie jest liczony jako zapis), nie regresja. Zainstalowanie takiego katalogu jako moda i tak wymaga `claude plugin install`/nowej sesji; pieczec modow (plan, faza 0 P0-09) ma to wykryc po fakcie.

## remote-sql-destructive (2026-10-10, 5 rund recenzji: security opus, code, ops, data)
Cel zdalny, dopoki nie udowodniono lokalnego; SQL niewidoczny na zdalnym = blok; rekurencja przez znane wrappery (menedzer sekretow (np. Infisical CLI), sh -c, docker, npx/pnpm, ssh, kubectl). Granice:
- Brak hosta w komendzie = baza lokalna (socket). Hook nie widzi PGHOST/DATABASE_URL wyeksportowanych WCZESNIEJ w powloce ani `source .env.production`, ani `docker exec -e PGHOST=...` — to wtedy przechodzi.
- SQL w zmiennej (`-c "$Q"`) albo `$(cat plik.sql)`: tekst niewidoczny w momencie oceny — przechodzi, gdy cel lokalny/nieznany-ale-niezdalny.
- `docker compose exec db psql` traktowane jak wrapper nieznany (blok przy destrukcji) — `docker exec <kontener>` jest wyjatkiem lokalnym.
- Heurystyka SQL na tekscie: `'drop'` w literale = blok (FP), UPDATE z podzapytaniem z WHERE = przechodzi (FN).
- Przelacznik awaryjny: `mode: 'observe'` w regule `remote-sql-destructive` w `hooks/lib/bash-rules.js` (regula loguje, nie blokuje; fraza CONTROL_PLANE), potem `node bin/pg-seal.js`. Pelne wycofanie = revert commita wydania, ktory ja wprowadzil (1.6.0).
- Wyjatek poziomu C wspolny z gh-delete (jedna fraza odblokowuje oba na 30 min / 3 uzycia).

## control-plane: zapis wzgledem cwd (2026-10-10, security-review r1-r3 + code-review r1-r2)
MODEL ZAGROZEN: bash-guard lapie POMYLKI i WSTRZYKNIECIA (agent wykonujacy cudza instrukcje), nie agenta, ktory celowo go obchodzi — tekstowego filtra nie da sie uszczelnic (np. `cd ~/.claude && bash /tmp/s.sh`). Siatka na reszte: pg-seal (ROZJAZD w guard_health przy starcie sesji) + historia gita + managed settings (/etc/claude-code, root).
- Regula klasowa (fail-closed): `patch`, rozpakowanie archiwum (`tar x`, `unzip`, `7z x/e`, `cpio -i`) i edytory w trybie skryptu (ed/red/ex, vi/vim/nvim/editor z -e/-s/-c/--cmd/-S/-u/-l/+cmd) z katalogiem roboczym W albo NAD ~/.claude (~, /home, /) = blok. Katalog = cwd, `-d` (wszystkie, skladane po kolei, takze w klastrach `-Nd` i skrotach `--di`), `-C`, `-o`, `env -C`/`-iC`/`--ch`, `sudo -D`; porownanie tekstowe ORAZ po realpath (symlink katalogu, /proc/self/root).
- Cwd NIEPEWNY => blok tej klasy: cel cd z `$`/`` ` ``/`~user`, CDPATH ustawiony i cel bez `./`/`/`/`~/`, popd/pushd bez celu, `source`/`.`, `ln -s` wczesniej w lancuchu. `cd -` liczony z OLDPWD.
- Bez wyjatkow: `patch --dry-run` w/nad ~/.claude = blok (security r2: `-r --dry-run` = wartosc opcji). Latka tylko na README w ~/.claude = blok (PG i tak zmieniamy za fraza).
- Poza drzewem przechodzi: GNU patch 2.8 (laptop) odrzuca sciezki absolutne, `..` i symlinki w sciezce latki; GNU tar zdejmuje `/` i odrzuca `..` (bez -P). Starsze/BSD narzedzia — zalozenie nie musi byc prawdziwe.
- Edytory gdzie indziej: skrypt musi byc przegladalny (heredoc, `<<<`, `< plik`, -c/--cmd/+cmd, -S/-u/-l plik) i bez sladu PG; pipe = blok takze w zwyklym repo (FP swiadomy). `ed -s ~/.claude/hooks/x.js <<< ',p'` (sam odczyt) = blok (FP; czytaj `cat`). `cd ~ && tar xzf x.tgz` / `cd ~ && unzip x.zip` = blok (FP swiadomy: rozpakowuj w podkatalogu).
- NIE lapane (swiadomie): dowolny skrypt (`bash s.sh`, `python s.py` bez sciezki PG w kodzie), program ze zmiennej (`$X -p1`), `find -execdir`, xargs z ukrytym programem, inne wrappery z chdir, interpreter skladajacy sciezke w runtime (`'ho'+'oks/x.js'`), `awk -i inplace`, kodowania `\042`/base64.
- Kod inline interpretera: odescapowanie `\"`, wielokrotnych `\\` i `$'\x22'`.
- KAZDE repo (decyzja 2026-10-10 po sandboxie: GNU patch zapisuje `.git/config` — lokalny core.hooksPath wylacza bramki PG — i `.claude/settings.json` — hooki projektu = kod w nastepnej sesji; `.git/hooks` martwe przy globalnym core.hooksPath): `patch` z latka nieprzegladalna (pipe) albo zawierajaca `.git/`/`.claude/` lub escape'y nazw (`\\056`, `\\x2e`) = blok. Uzywaj `git apply` (odmawia sciezek w .git). 0 uzyc `patch` w 27 katalogach transkryptow = koszt ~0. Archiwa (`tar x` w repo z wpisem `.git/config`) — NIE lapane (tresc skompresowana).
- r3 (2026-10-10): zablokowane zawsze — `tar -P/--absolute-names`, `cpio -i` bez `--no-absolute-filenames`, `unzip -:`, `7z -spf`, aplety `busybox patch|tar|cpio|unzip|vi|ed|sed`; vi/vim z klawiszami ze stdin (`<`, `<<<`, potok) = tryb skryptu; w/nad ~/.claude kazdy edytor. Pewny cwd wraca po absolutnym `cd /x` (chyba ze wczesniej `ln -s`).
- NIE lapane (code r3, wymagaja celowo skladanej komendy): `env -uCI` / `sudo -uDeploy` (litera C/D w wartosci innej opcji), `flock -c "cmd"`, `cd /var/run/..` (realpath po tekstowym zwinieciu `..`), `tar xfC` z `~` w starym stylu gdy brak `x` w pierwszej grupie, podpowloki i `||` w sledzeniu cd (`cd ~/.claude && (cd /tmp) && patch`), `ar x`, `curl -O`/`wget` w ~/.claude, `$OLDPWD`/`$HOME` nadpisane w lancuchu.
- Po code+ops review r4: `busybox` znowu wrapper (cp/sh/tee widoczne dla wszystkich regul), aplety patch|tar|cpio|unzip|vi|ed|sed przez busybox = blok; id potoku nie przesuwa sie przez `$(...)` (parser); nieudany cd (cel nie istnieje) przy starym cwd w/nad ~/.claude albo niepewnym = niepewny; `patch -d .git`/cwd w `.git`/`.claude` = blok; komunikat blokady wskazuje `git apply`.
- `cpio -i --no-absolute-filenames` przepuszczony poza ~/.claude, choc dalej rozpakuje czlonki `../x` (GNU cpio) — 0 uzyc cpio we flocie; swiadome.
- Wycofanie: funkcja `cwdRelativeWriteHits` w `hooks/lib/bash-rules.js` (jedno wywolanie w regule `control-plane`) — usun wywolanie albo revert commita wydania 1.6.0 razem z przypadkami w `pg/eval/cases.json` (inaczej golden suite czerwony), potem `node bin/pg-seal.js` (fraza CONTROL_PLANE) — pieczec jest per maszyna (.gitignore), bez re-seal guard_health RED.

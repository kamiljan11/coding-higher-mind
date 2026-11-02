# Design: Fala 0 — pomiar bazowy PG (M-A, M-B, M-C)

> **Sekcje 11 i 12 (na dole) WIĄŻĄ i nadpisują §2-§8 tam, gdzie się różnią** (rewizja po świeżej recenzji D6; §12 = decyzje po wdrożeniu). Definicja G4 „nieprzydatne” = §12.1.

Status recenzji: patrz sekcja „Status recenzji" na dole. Tier zmiany: T3 wg `risk-tier.js` (> 600 linii; hooki + git-hooks + bin; brak auth/płatności/migracji).
Źródło: plan ulepszeń PG 2026-11-01 (§3 Fala 0, §9 D1), fraza uzytkownika `pozwol ALLOW_CONTROL_PLANE` 2026-11-01 18:28 UTC.

## 1. Problem
PG nie wie, czy jego recenzenci i bramki dają trafne sygnały. Dowody (stan 93c1ce4):
- git-hooki nie logują `blocked`. Bramka, która zatrzymuje commit, jest w telemetrii niewidoczna: 0 rekordów `blocked` z git-hooków na 24 567 (2026-10-21 → 11-01). 25 miejsc `exit 1`: pre-commit 19, pre-push 4, commit-msg 2.
- `bypass` jest logowany pętlą na starcie hooka (`git-hooks/pre-commit:10-15`, `pre-push:13-18`, `commit-msg:6-11`) dla każdego ustawionego `ALLOW_*`, także wtedy, gdy bramka i tak by nie zadziałała. Do tego 820 z 1959 `bypass` wskazuje na /tmp, czyli na testy i fixture'y. Udziału fałszywych alarmów nie da się z tego policzyć.
- Decyzje fixera po `pg-review` (naprawione / odrzucone) istnieją tylko w prozie raportu (`skills/pg-review/SKILL.md:104,110`). Rejestru nie ma, więc wskaźnik „nieprzydatnych” per dział i per `rule_id` jest niepoliczalny (Tricorder: cel < 10 %).
- Nie wiadomo, ile defektów przechodzi przez bramki i recenzję na każdym tierze.

Dla kogo: uzytkownik (decyzje o kalibracji, przegląd ADR-0007/0008 **2026-11-12**) i agenci (które bramki uczą obchodzenia).

## 2. Cele i kryteria akceptacji
- **G1 (M-B a):** każde blokujące wyjście git-hooka zostawia jeden wpis `{hook, event:"blocked", gate, target}` w `gates.jsonl`. Sprawdzenie: test, w którym zablokowany commit-msg / pre-push / pre-commit daje wpis `blocked` z poprawną nazwą bramki w `PG_GATE_LOG`.
- **G2 (M-B c):** każdy wpis gate-log niesie `origin` ∈ {test, tmp, agent, human} oraz `ep` (wartość `CLAUDE_CODE_ENTRYPOINT`, gdy jest). Sprawdzenie: test jednostkowy gate-log z czterema środowiskami.
- **G3 (M-B b+d):** `guard_health` ma sekcję „Skuteczność bramek”. Liczy per bramka:
  - `blocked`;
  - `bypass_po_blokadzie`: `bypass` tej samej bramki w tym samym `target` ≤ 30 min po `blocked` (Tricorder „nieprzydatne”);
  - `bypass_prewencyjny`: reszta;
  - `naprawione`: po `blocked` następny wpis tej bramki w tym samym `target` to nie `bypass`; proxy przez kolejny `blocked`/brak.

  Wykluczone są origin test/tmp oraz zmienne poziomu C (`hooks/lib/overrides.js:51`, `tierOf`). Liczone TYLKO wpisy hooków `pre-commit|pre-push|commit-msg`: `bash-guard.js:89,95`, `edit-guard.js:82,102` i `prompt-guard.js:26` też logują `bypass` (warstwa komend i fraz), nie mieszamy. Nazwa bramki = sufiks zmiennej ALLOW (`ALLOW_SECRET` → `SECRET`); bramki bez zmiennej = nazwa narzędzia (`ESLINT`, `TSC`, `RUFF`, `PYRIGHT`, `OXLINT`, `WORKFLOW_LINT`, `SQL_LINT`, `PG_WIRE`, `HUSKY`). Dzięki temu `bypass` z reason `ALLOW_X=1` paruje się z `blocked` gate `X` bez tabeli mapowania. Sprawdzenie: test z syntetycznym `gates.jsonl` (wzór `bin/test_hooks_v3.js:166-175`).
- **G4 (M-A):** `bin/pg-outcome.js --run <RUN> --decide <id>=fixed|dropped|note[:powód] ...` dopisuje do `~/.claude/logs/review-outcomes.jsonl` jeden wiersz per finding z `aggregated.json`. Pola:
  - `ts`, `repo` (basename), `tier`, `role`;
  - `rule_id`, `severity`, `agreement`, `decision` (z agregatu), `verdict` (weryfikatora);
  - `outcome`, `reason` (≤ 120 znaków).

  Odmawia (exit 1), gdy któryś finding nie ma decyzji. Bez treści kodu, `claim`, `evidence` i ścieżek plików, czyli bez ryzyka PII. `guard_health` raportuje nieprzydatne = dropped / (dropped + fixed) per rola i per `rule_id` (min. 5 decyzji, inaczej „za mało danych”). `pg-review` SKILL krok 4 woła narzędzie po decyzjach fixera. Sprawdzenie: test na fixture RUN.
- **G5 (M-C):** `bin/pg-escapes.py <repo-path>... [--days 14] [--since 90d] [--json] [--sample N]`. Jednostka to commit first-parent na gałęzi domyślnej, który nie jest `fix:`. Ucieczka to późniejszy commit `fix(...)?:` ≤ 14 dni, który dotyka ≥ 1 wspólnego pliku. Tier liczy `hooks/lib/risk-tier.js` na plikach commita z `--lines` z numstat. Wynik to tabela per tier: jednostki, z ucieczką, % oraz losowa próbka do ręcznej kontroli (deterministyczny seed). Tylko `git log`/`git show`: zero zapisu, zero sieci. Sprawdzenie: test na syntetycznym repo git w tmp.

## 3. Non-goals
- Żadna bramka nie zmienia werdyktu: nic nowego nie blokuje i nic nie przestaje blokować (ADR-0008: najpierw pomiar, observe).
- Nie przerabiamy bramek, żeby liczyć „czy naprawdę by zadziałała” przy ustawionym ALLOW (uruchamianie narzędzia mimo wyjątku). Zastępuje to korelacja `blocked` → `bypass` w G3. Sygnał powrotu: jeśli po 2-4 tygodniach `bypass_prewencyjny` przekracza 50 % obejść danej bramki, wtedy przerabiamy tę jedną bramkę.
- Nie zmieniamy stop-gate ani nie egzekwujemy wywołania `pg-outcome` (najpierw konwencja w SKILL; egzekwowanie dopiero po incydencie).
- M-C nie klonuje repo i nie woła GitHuba. Ścieżki podaje użytkownik (`~/src/<repo>`), a `--fleet` czyta listę z `fleet-active-repos.py --json` przez most i mapuje na `~/src/<repo>` tylko wtedy, gdy katalog istnieje.
- Bez migracji starych wpisów `gates.jsonl` (nowe pola dotyczą tylko nowych wpisów; `guard_health` toleruje brak pól).

## 4. Plan per plik
| plik | zmiana |
|---|---|
| `hooks/lib/gate-log.js` | `origin()` i `ep` w `log()`; CLI przyjmuje `[gate]` jako 5. argument (pole `gate`). Zgodność wsteczna CLI: 4 argumenty działają jak dotąd. |
| `git-hooks/pre-commit`, `pre-push`, `commit-msg` | Zmienna `pg_gate=<nazwa>` ustawiana przed każdą bramką + jeden `trap 'pg_on_exit' EXIT`, który przy statusie ≠ 0 woła `gate-log.js <hook> blocked "<gate>" "$(pwd)" <gate>`. Trap nigdy nie zmienia statusu wyjścia. Nazwy bramek = nazwy z tabeli FACTMAP A1 (np. `SECRET`, `STALE_BASE`, `ESLINT`, `MSG`, `MAIN`). |
| `hooks/gate_effectiveness.py` (nowy) + `hooks/guard_health.py` | Logika G3/G4 jako czyste funkcje w `gate_effectiveness.py` (wydzielone w pg-review p345); `guard_health.py` drukuje sekcje „Skuteczność bramek” (G3) i „Wyniki recenzji” (G4) i uruchamia testy Fali 0; tylko informacyjne, nie zmieniają RED/GREEN. Martwy blok 363-371 (`pre-commit:<gate>` + `skipped`, nic go nie emituje) zostaje: poza zakresem, notatka do przeglądu 11-12. |
| `bin/pg-outcome.js` (nowy) | G4; nagłówek do `pg-map.py` (README generowany). |
| `bin/pg-escapes.py` (nowy) | G5; nagłówek do `pg-map.py`. |
| `skills/pg-review/SKILL.md` | Krok 4: 2 linie, czyli wywołanie `pg-outcome.js` po decyzjach. |
| `bin/test_gate_log_fala0.js`, `bin/test_gate_effectiveness.py`, `bin/test_pg_outcome.js`, `bin/test_pg_escapes.py` (nowe) | Testy G1-G5 (auto-discovery `pg-self-check.py:71-90` + lista testow w `guard_health.py`). Wczesniejsza nazwa robocza `test_gate_outcomes.js` = `test_gate_log_fala0.js`. Tier faktyczny: T3 (> 600 linii). |
| `bin/README.md` | Regeneracja `pg-map.py`. |

## 5. Alternatywy (odrzucone)
- **`gate-log blocked` przed każdym z 25 `exit 1`** (zamiast trap): odrzucone. To 25 punktów edycji, łatwo pominąć nowe `exit 1` w przyszłości. Trap łapie też przyszłe wyjścia, a nazwa `pg_gate` w najgorszym razie jest nieaktualna, nie brakuje jej.
- **Przebudowa każdej bramki na „uruchom mimo ALLOW i zaloguj fired”**: odrzucone na Falę 0. Podwaja czas commitów z wyjątkiem i zmienia ~10 bramek. Korelacja z G3 daje sygnał Tricorder bez dotykania bramek.
- **Zapis wyników recenzji wprost w `aggregated.json`**: odrzucone. RUN leży w tmp i znika, a stop-gate i `pg-merge-dowod` czytają ten plik jako dowód. Zmiana jego znaczenia po fakcie = ryzyko.

## 6. Ryzyka
- **R1 trap w `sh`:** ZWERYFIKOWANE 2026-11-01 na dash (= /bin/sh) i bash: w handlerze `$?` = status `exit N`; trap odpala się też przy `exit 0` (stąd warunek na statusie); błąd polecenia w handlerze NIE zmienia statusu wyjścia. Test regresji w `test_gate_outcomes.js`.
- **R2 czas commitów:** dodatkowe `node gate-log.js` tylko przy blokadzie (~50 ms). Ścieżka zielona: 0 dodatkowych procesów.
- **R3 hook z repo (`.husky`) lub ustawiony wcześniej trap:** `.husky` uruchamiamy przez `sh`, czyli w podprocesie, bez kolizji.
- **R4 `origin` błędnie „agent”:** sesja Claude w terminalu, w której człowiek sam robi commit, ma `CLAUDECODE` → liczy się jako agent. Akceptowalne: `ep` pozwala rozróżnić to później.
- **R5 PII w `review-outcomes.jsonl`:** tylko enumy, liczby, `rule_id` i krótki powód. Powód pisze agent, więc może wkleić ścieżkę, a nie powinien wklejać danych. Limit 120 znaków + maskowanie e-maili/tokenów wzorcem z `pre-commit` (sekrety).
- **R6 M-C fałszywe ucieczki:** `fix:` ≠ defekt (refaktor, literówka, CI). Stąd obowiązkowa próbka ręczna i raport jako „górna granica”.
- **R7 testy wołają prawdziwe `~/.claude/git-hooks`** (`test_hooks_v3.js:472,709,722,1363`): w piaskownicy testy hooków uruchamiamy z `HOME` wskazującym kopię.

## 7. Założenia, które ta zmiana unieważnia (P9)
- „`bypass` w gates.jsonl = obejście bramki” → od teraz `bypass` = zadeklarowany wyjątek, a obejście blokady = para `blocked` → `bypass`. Do sprawdzenia `rg -n '"bypass"|bypass' hooks/ bin/ skills/ scheduled-tasks/ pg/`: kto interpretuje liczbę `bypass` jako obejścia (ADR-0007, `guard_health`, alarmy).
- „git-hooki nie emitują `blocked`” → konsumenci liczący `blocked` (top-12 w `guard_health:248-249`, stop-gate?) dostaną nowe wpisy. Do sprawdzenia `rg -n "'blocked'|\"blocked\"" hooks/ bin/`.

## 8. Weryfikacja (przed kodem ustalona)
1. Piaskownica: `pg-self-check.py` (kopia, `HOME` = katalog z `.claude` → kopia), `test_hooks_v3.js`, nowe testy, `pg-eval.js`.
2. Odtworzenie: `guard_health.py` na kopii prawdziwego `gates.jsonl` (sekcje nowe nie zmieniają RED/GREEN → diff statusu pusty).
3. `pg-escapes.py` na 2 lokalnych repo (`~/src/shop-app`, inne z `~/src`) → liczby + próbka.
4. Pomiar czasu: commit-msg zielony przed/po (bez regresji > 20 ms).
5. `pg-review` (T2: code + ops + security dla gate-log/hooków) → poprawki → `pg-seal` → commit → `pg-sync push`.

## 9. Rollback
`git revert <sha>` w `~/.claude` + `pg-seal`. Nowe pola w logu są addytywne; pliki `review-outcomes.jsonl` mogą zostać. Wyłączenie samego trapa: usunięcie linii `trap`, bez wpływu na werdykty.

## 10. Co będzie w logach, gdy się wysypie
`gate-log.js` nigdy nie rzuca (`try/catch` istniejący). `pg-outcome.js` przy błędzie: exit 2 + komunikat (który plik, jakie pole), zgodnie z kontraktem ADR-0008 (1 = werdykt, 2 = błąd narzędzia). `pg-escapes.py`: repo bez gałęzi domyślnej → wiersz `skipped: <repo>: <powód>` na stderr, reszta liczy dalej.

## Status recenzji
| kto | kiedy | werdykt | otwarte |
|---|---|---|---|
| autor (samoocena wg rubryki) | 2026-11-01 18:45 UTC | poprawki wniesione | referencje: 12/12 plików istnieje. Dopisane: G3 liczy tylko git-hooki (bash/edit/prompt-guard też logują `bypass`), nazwy bramek = sufiks ALLOW, R1 zweryfikowane. Otwarte: starsze wpisy bez pola `gate` (tolerancja w guard_health) |
| świeży recenzent (D6, sonnet, 216k tok.) | 2026-11-01 18:55 UTC | REQUEST CHANGES: 5 blocker, 11 major, 1 minor, 2 nit | wszystkie wniesione w §11 (wiąże) |


## 11. Rewizja po recenzji D6 (WIĄŻE; tam, gdzie różni się od §2-§8, obowiązuje ta sekcja)

### 11.1 M-B — git-hooki (G1)
- Każde `exit 1` w trzech hookach dostaje nazwę: `exit 1` → `pg_gate=X; exit 1` (albo `|| { pg_gate=X; exit 1; }`). Jeden `trap pg_on_exit EXIT`: status 0 → nic; status ≠ 0 → `node gate-log.js <hook> blocked "rc=<N>" "$(pwd)" "${pg_gate:-UNKNOWN}"` (brak `node`/`gate-log.js` → nic, status bez zmian). `pg_gate` ustawiany TYLKO tuż przed wyjściem → brak nieaktualnych nazw; nowe przyszłe `exit 1` bez nazwy = `UNKNOWN` (widoczne, nie ciche).
- Tabela nazw (wiąże; numery linii = stan 93c1ce4 SPRZED edycji, po zmianie przesunięte o ~11 — źródłem prawdy jest `pg_gate=` w hookach i statyczny test w `bin/test_gate_log_fala0.js`): pre-commit HUSKY(29), CI_DOWNGRADE(145), SECRET(163), STALE_BASE(169), DUP_LITERALS(176), COMMENTED_CODE(182), PHASE(195), TODO(203), PII(211), UNKNOWN_DEP(218), WORKFLOW_LINT(241), SQL_LINT(272), ESLINT(279), OXLINT(283), TSC(288,290), RUFF(298), PYRIGHT(301), PG_WIRE(309); pre-push MERGE_INTEGRITY(45), MAIN(98), LARGE_DIFF(111), BOUNDARIES(121); commit-msg SECRET(16), MSG(26). Nazwa = sufiks zmiennej ALLOW, gdy bramka ją ma.
- BOUNDARIES: `module-boundaries.js:543` już loguje `blocked` (hook `module-boundaries`, `source:pre-push`). Zostaje; G3 liczy tylko wiersze hooków `pre-commit|pre-push|commit-msg`.
- §5 alternatywa poprawiona: wybrane jest połączenie (nazwa przy każdym `exit 1` + trap jako siatka bezpieczeństwa), bo sam trap z `pg_gate` ustawianym przed bramką dawał nieaktualne nazwy (D6).

### 11.2 M-B — gate-log (G2)
- Nowe pola dopisywane PO polach wpisu (kolejność: `ts, pid, ...entry, origin, ep?`), żeby regexy testów na sąsiedztwie kluczy (`test_module_boundaries.js:206,305`) dalej działały; test przypina kolejność.
- `origin` (pierwsza pasująca reguła): `test` gdy `LOG_FILE !== PROD_LOG` (przekierowanie honorowane, czyli w tmpdir); `tmp` gdy `target` (pierwszy element przed `;`) leży pod `path.resolve(os.tmpdir()) + sep`; `agent` gdy `CLAUDECODE` albo `CLAUDE_CODE_ENTRYPOINT` ustawione; inaczej `human`. `ep` = wartość `CLAUDE_CODE_ENTRYPOINT`, pominięte gdy brak.
- CLI: opcjonalny 5. argument `gate` → pole `gate`. 4 argumenty jak dotąd.
- Zakres: „każdy wpis zapisany przez `gate-log.js`”. `pg-merge-bezpieczny.py:476` pisze wprost — poza zakresem Fali 0 (notatka na 11-12).

### 11.3 M-B — guard_health (G3) — algorytm (wiąże)
1. Wejście = dotychczasowe `window_events` (7 dni, bez `redirected`), tylko hook ∈ {pre-commit, pre-push, commit-msg}, `origin` ∉ {test, tmp} (brak pola = liczone, stare wpisy).
2. Sortuj po `ts` (ts bez strefy = UTC) i przetwarzaj JEDNYM przebiegiem w kolejności czasu.
3. `blocked` z polem `gate` → incydent per klucz `(hook, gate, target)`; kolejne `blocked` tego klucza ≤ 30 min od ostatniego = ten sam incydent (pętla poprawek), o ile incydent nie został już zamknięty bypassem — `blocked` po zamknięciu = nowy incydent (pg-review p345, code-1).
4. `bypass` z reason `ALLOW_X=<v>` (inne reasony, np. `main -> ...` z `pg_main_ok`, pomijane) → gate `X`. Przypisz do NAJSTARSZEGO niezamkniętego incydentu `(dowolny hook, X, target)` z `ts` incydentu ≤ bypass ≤ ostatni blocked + 30 min; każdy bypass konsumuje max 1 incydent, każdy incydent max 1 bypass. Duplikat SECRET (pre-commit + commit-msg z jednego commita) = 2 bypassy ≤ 5 s, jeden konsumuje, drugi pomijany jako duplikat.
5. Partycja per bramka: `incydenty = obejscie_po_blokadzie + bez_obejscia`; osobno `obejscie_bez_blokady` (bypass bez incydentu). Bramki bez zmiennej ALLOW (ESLINT, TSC, …) mają tylko `incydenty`.
6. Procent `obejscie_po_blokadzie / incydenty` tylko gdy incydenty ≥ 5, inaczej „n<5”. Brak wykluczeń po poziomie (A/B/C) — kolumna `poziom` = `tierOf("ALLOW_"+X)` tylko jako etykieta (przy wyłączniku etykieta „C” — świadomie).
7. Interpretacja w nagłówku sekcji: „obejście po blokadzie = sygnał do ZBADANIA (Tricorder: nieprzydatne wg człowieka), nie werdykt; obejście bez blokady może znaczyć, że agent wiedział, że bramka zadziała”. Sygnał powrotu z §3 brzmi teraz: „bramka z n ≥ 10 i obejscie_bez_blokady > 50 % → przegląd ręczny tej bramki”, nie „przeróbka”.
8. Retencja: każdy przebieg guard_health dopisuje 1 wiersz-migawkę per bramka do `logs/gate-effectiveness.jsonl`, najwyżej jedna migawka na dzień UTC (ts, window_days, gate, hook, incydenty, obejscie_po_blokadzie, bez_obejscia, obejscie_bez_blokady). Rotacja `gates.jsonl` (~11 dni) przestaje ograniczać historię.
9. Wydruk: nowe sekcje jako OSOBNE bloki po liście `info` (nie do `info`, bo `info[:8]`/`info[:12]` ucina, `guard_health.py:543,554`); RED/GREEN bez zmian; test, że blok się pojawia.

### 11.4 M-A — pg-outcome (G4) — wiąże
- CLI: `node bin/pg-outcome.js --run <RUN> --repo <ścieżka|nazwa> [--tier Tn] --decide <id>=<outcome> ...`. `repo` zapisywany jako basename. `tier`: z `<RUN>/tier.json` (`tier`), inaczej `--tier`, inaczej `unknown`.
- Jednostka = grupa z `aggregated.json.findings[]` (po deduplikacji). Pole `roles` = pełna lista `roles[]` grupy; statystyki per rola liczą grupę dla KAŻDEJ roli w `roles`.
- `outcome` (zamknięta lista): `fixed`, `dropped:false_positive`, `dropped:out_of_scope`, `dropped:accepted_risk`, `dropped:duplicate`, `dropped:preexisting`, `kept_note` (zostawione jako notatka bez akcji; tylko dla grup `decision=note` — blocker/must_fix bez akcji = `dropped:accepted_risk`, pg-review p345c). Zero wolnego tekstu → brak PII (R5 znika; maskowanie niepotrzebne).
- Decyzja WYMAGANA dla grup z `decision` ∈ {blocker, must_fix, note}; grupy `dropped` (weryfikator `not_reproduced`) zapisywane automatycznie z `outcome=verifier_dropped`. Brak decyzji dla wymaganej grupy → exit 1 z listą id, nic nie zapisane. Błąd pliku/JSON → exit 2. `rejected[]` (bez dowodów) nie jest logowany (Fala 0).
- Idempotencja: `run_key` = sha256(ścieżka katalogu RUN + posortowane `id`+`rule_id`+`file` grup)[:16] (pg-review p345: same grupy kolidowały między przebiegami); jeśli `run_key` już jest w logu → komunikat „już zapisane”, exit 0, bez dopisywania (`--replace` nie ma w Fali 0).
- Pola wiersza: `ts, run_key, repo, tier, group_id, roles, rule_id, severity, agreement, decision, verdict, outcome`. Enumy (severity, decision, verdict, tier T0-T3) spoza listy → `other`/`unknown`; pola tekstowe od agentów tylko znaki identyfikatora. Rejestr zawsze `~/.claude/logs/review-outcomes.jsonl` — bez zmiennej przekierowującej (p345 security-1: override „tylko w tmpdir” obchodzony przez TMPDIR); testy podstawiają HOME.
- guard_health „Wyniki recenzji”: okno = cały log + ostatnie 30 dni; nieprzydatne = (`dropped:false_positive` + `verifier_dropped`) / (`fixed` + wszystkie `dropped:*` + `verifier_dropped`) (§12.1); osobno rozkład powodów `dropped:*`; `kept_note` i `verifier_dropped` liczone osobno, poza ułamkiem; n<5 → „za mało danych”.
- Co przegląd 11-12 może wnieść z G4: tylko „czy rejestr jest używany” (liczba RUN-ów); wnioski per dział dopiero po ~20 recenzjach.

### 11.5 M-C — pg-escapes (G5) — wiąże
- Nazwa wskaźnika: „orientacyjny wskaźnik ucieczek”, nie „górna granica”. Nie mierzy „co przeszło przez bramki” (brak warunku na recenzję) — to baza per tier; porównanie przed/po PG dopiero później.
- Gałąź domyślna: `git symbolic-ref refs/remotes/origin/HEAD`, inaczej `main`, inaczej `master`, inaczej skip z powodem.
- Commity: `git log --first-parent`. Merge commit → pliki z `git diff --name-only M^1 M`, tytuł = pierwsza linia treści (PR title), gdy subject zaczyna się od `Merge pull request`.
- Fix: tytuł pasuje do `^fix(\([^)]*\))?!?:`. Jednostka = commit nie-fix.
- Pliki ignorowane przy dopasowaniu: lockfile’e, `package.json`, `CHANGELOG.md`, `*.md`.
- Przypisanie: fix → NAJBLIŻSZA wcześniejsza jednostka (≤ `--days`, domyślnie 14) dzieląca ≥ 1 plik; jeden fix = max jedna ucieczka.
- Cenzura: jednostki młodsze niż `--days` od HEAD wykluczone z mianownika. Jednostki bez pliku do powiązania (same pliki ignorowane) też — pole `unlinkable` (pg-review p345b code-1: inaczej T0 = strukturalne 0 % i zaniżona suma).
- Tier: `risk-tier.js <root> <pliki> --lines <suma numstat; binarne '-' = 0>`; pliki w paczkach po 200, tier = max. Ograniczenie jawne w raporcie: tier liczony wg OBECNEGO `CLAUDE.md` repo.
- Wiarygodność: raport podaje % commitów z tytułem Conventional; < 50 % → repo oznaczone „niewiarygodne” i poza sumą.
- Środowisko git (pg-review p345b/p345c/p345d: trzy odtworzone klasy ataku z `.git/config` repo — `gpg.program` przez `log.showSignature`, wstrzyknięcie rekordu/opcji z treści commita, lazy fetch partial clone → `core.sshCommand`): git **nie startuje w repo floty ani z jego configiem**. Refy (`origin/HEAD` → `main` → `master`, luźne + `packed-refs`, symref max 5 skoków, tylko `refs/heads|remotes` bez `..`) i `.git`/`gitdir:`/`commondir` czytane w Pythonie; `git log`/`diff` w tymczasowym repo-cieniu (`git init --bare`, `objects/info/alternates` → obiekty repo floty, zwalidowany `shallow` skopiowany; bez promisora → brakujący obiekt = błąd, nie sieć). Druga warstwa: `GIT_NO_LAZY_FETCH=1`, `protocol.allow=never`, `GIT_NO_REPLACE_OBJECTS=1`, zmienne `GIT_*` sesji wycięte, `log.showSignature=false`, `gpg.*program=false`, `--no-textconv --no-ext-diff`, `--end-of-options`; bez zmiennych *TOKEN*/*SECRET*/*KEY*. Reftable = skip z powodem. Wydruk tekstowy: znaki sterujące z nazw/błędów jako `\xNN`.
- CLI: `pg-escapes.py <repo>... [--fleet] [--days 14] [--since 180] [--json] [--sample 10]`; próbka `random.Random(0)`; `--json` = `{repos:[{repo, branch, units, escapes, unlinkable, conventional_pct, reliable, by_tier:{T0..T3:{units,escapes}}, skipped?}], sample:[{repo, unit_sha, fix_sha, files}]}`; `--fleet` = `fleet-active-repos.py --json` (menedzer sekretow (np. Infisical CLI)) → `~/src/<repo>`, brak katalogu = skip z powodem.
- Exit: 0 OK, 2 błąd narzędzia (ADR-0008); brak „werdyktu” (narzędzie raportowe). `--fleet`: błąd jednego repo = `skipped: "blad: …"`, reszta liczona; jawna ścieżka repo = exit 2.

### 11.6 Fazy (każda = osobny commit, drzewo zielone po każdej)
1. `gate-log.js` + test pól/kolejności/origin.
2. Trzy git-hooki (nazwy + trap) + testy G1 (dash, statusy 0/1/2, brak node, HUSKY, UNKNOWN, brak wycieku do prod logu).
3. `guard_health` G3 + migawka + test na syntetycznym logu (redirected, stare wpisy bez pól, nieposortowane ts, podwójny SECRET, `ALLOW_MAIN`, reason `main -> ...`) + automatyczne porównanie RED/GREEN na kopii prawdziwego logu.
4. `pg-outcome.js` + SKILL krok 4 + guard_health G4 + test (brak decyzji → 1, błąd → 2, duplikat RUN, grupa wielorolowa).
5. `pg-escapes.py` + test (squash vs merge, `fix(scope)!:`, brak gałęzi, cenzura, binarne numstat).
Faza 2 (hooki na każdym commicie maszyny) ma pierwsza trafić do `~/.claude` i „odleżeć” w użyciu przed 3-5 — w tej sesji: 1-2 razem, 3-5 po pg-review.

## 12. Decyzje po wdrożeniu (2026-11-01; uzytkownik: „decyduj autonomicznie dla dobra całościowego systemu”)
1. **G4 „nieprzydatne” liczy `verifier_dropped`** (licznik i mianownik): weryfikator nie odtworzył findingu = fałszywy alarm działu. Bez tego wynik zaniżony względem celu < 10 % (pg-review p345g data-1). `kept_note` dalej poza ułamkiem (brak werdyktu). Zmienia §11.4 (definicja) i `pg/GLOSSARY.md`.
2. **Przegląd 2026-11-12 — kryterium:** danych będzie ~11 dni. Decyzje kalibracyjne (zostaw / poluzuj / zbadaj) TYLKO dla bramek z n ≥ 10 blokad w oknie; reszta = „za mało danych” → kolejny przegląd **2026-11-26** (bez zmiany bramek). G4 na 11-12: tylko „czy rejestr jest używany” (liczba RUN-ów ≥ 3 = tak; 0 = krok 4 pg-review jest pomijany → kandydat na przypomnienie w stop-gate, observe). G5: jeden przebieg `pg-escapes.py --fleet` jako baza „przed”. **Bias bazy:** migawki G3 z pierwszych 7 dni mieszają `bypass` sprzed Fali 0 (pętla na starcie hooka, bez `origin`) — do oceny brać tylko wpisy z polem `origin`.
3. **Podsumowanie G3/G4 w logu Obsidiana: nie.** G3 ma trwałą migawkę dzienną (`logs/gate-effectiveness.jsonl`), G4 surowy rejestr; przegląd = ręczne `python3 ~/.claude/hooks/guard_health.py`. Wraca, jeśli 11-12 pokaże, że tego brakuje.
4. **Rotacja `logs/gate-effectiveness.jsonl` i `logs/review-outcomes.jsonl`: nie teraz** (KB/miesiąc). Próg: plik > 1 MB → rotacja jak `gates.jsonl`. Pliki poza git/pg-sync = dane lokalne laptopa (jak `gates.jsonl`).
5. **Partial clone w `~/src`:** 0 z 41 repo (odczyt `.git/config`, 2026-11-01); 1 płytki klon (obsługiwany). Bez zmian.
6. **Ta sama klasa ataku w innych narzędziach uruchamiających git na flocie (np. `hooks/lib/lint-file.js`): nie naprawiamy.** `.git/config` nie przechodzi przez `git clone`, więc `gpg.program`/lazy fetch wymagają lokalnego zapisu do `.git/config` = atakujący już wykonuje kod (mógłby wpisać hook). Przenoszalna przez klon jest tylko treść commitów/plików (klasa p345c: wstrzyknięcie rekordu/opcji) — `pg/cases.md` UNTRUSTED-GIT-CONFIG-WHACK-A-MOLE, status observe: przy następnej zmianie narzędzia, które parsuje `git log` z separatorami, sprawdzić `--end-of-options` i walidację pól. Wyjątek od założenia: `~/D` (Syncthing z second-machinea, tylko odbiór) przenosi `.git/config` bez klonu — narzędzi PG nie uruchamiamy na repo z `~/D`.
7. **`pg-escapes.py` zostaje z repo-cieniem mimo pkt 6** (p345h product-1): kod już jest, przetestowany (PoC lazy-fetch rc=2), a koszt utrzymania jest jednorazowy. Niekonsekwencja wobec pkt 6 świadoma: wzorcem dla floty jest pkt 6 (bez repo-cienia), nie `pg-escapes`. **Zasada wygaszenia:** gdy nowy format gita (np. reftable) albo błąd wymaga naprawy parsera refów → zamiast naprawy usuwamy repo-cień i parser, `pg-escapes` biegnie zwykłym `git log` z `--end-of-options` tylko na `~/src` (klony), a G5 zostaje wskaźnikiem orientacyjnym.

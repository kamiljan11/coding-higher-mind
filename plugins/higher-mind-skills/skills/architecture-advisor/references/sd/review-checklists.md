# Listy kontrolne dla recenzentów — system design w diffie

Użycie: finder działu czyta SWOJĄ sekcję obok rubryki z `agents/<rola>.md`. Punkt = pytanie zamknięte (tak/nie) z komendą dowodzącą; po `→` karta z pełnym kontekstem, trybami awarii i progami (`NN › Karta`, patrz `README.md`).
Reguły:
- Dotyczy WYŁĄCZNIE diffu (zasada zakresu): dług poza diffem trafia do `questions`, nie do findings. Punkt, którego diff nie dotyka, pomijasz bez komentarza.
- Finding bez komendy i dowodu odpada przy agregacji. Heurystyka `rg` daje trafienia do przejrzenia, nie wyrok.
- Zakres komend: `<pliki>` = pliki z diffu (`git diff --name-only <baza>...HEAD`); SQL uruchamiaj na bazie produkcyjnej TYLKO przez sesję read-only z limitem czasu (`PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=15s' psql "$DB_URL" -c "<zapytanie>"`, URL ze zmiennej z menedzer sekretow (np. Infisical CLI): `python3 ~/infisical/infisical (CLI) run --secrets <NAZWA> -- ...`; nigdy URL z hasłem w linii komendy). Recenzenci w CI nie mają dostępu do bazy — tam zapytania SQL są UNVERIFIED i uruchamia je człowiek albo sesja główna w trybie audytu.
- Dotyczy też stwierdzenia „nie potrzebujesz jeszcze": dodanie kolejki/cache/realtime/silnika wyszukiwania/repliki/usługi bez nazwanego OBECNEGO problemu to finding (dział product).
- Severity: blocker = pieniądze, dane innego tenanta, utrata danych; major = brak bramki w nowej ścieżce krytycznej; minor = hygiene.

## DATA (data-reviewer)
1. Nowa tabela ma PK, FK z `ON DELETE`, `NOT NULL`/`CHECK` na niezmiennikach, indeks na FK i `org_id` → 02 › Model danych, 02 › Multi-tenancy
   `rg -n -i "create table" <migracje z diffu>`; FK bez indeksu: `select c.conrelid::regclass, c.conname from pg_constraint c where c.contype='f' and c.connamespace='public'::regnamespace and not exists (select 1 from pg_index i where i.indrelid=c.conrelid and i.indkey[0]=c.conkey[1]);`
2. Migracja jest wstecznie kompatybilna na czas jednego deployu (expand → contract; brak `DROP`/`RENAME`/`NOT NULL` bez `DEFAULT` w tym samym PR co zmiana kodu) i idempotentna → 02 › Model danych
   `node ~/.claude/bin/sql-migration-lint.js --repo . --strict --json`; `rg -n -i "drop (table|column)|rename (to|column)|set not null" <migracje>`
3. Nowa tabela tenantowa ma RLS z `USING` i `WITH CHECK`, trigger same-org przy FK między tabelami tenantowymi, widoki z `security_invoker` → 02 › Multi-tenancy
   `select tablename from pg_tables where schemaname='public' and not rowsecurity;` oraz zapytanie o widoki bez `security_invoker` z karty 02
4. Zmiana stanu zależna od odczytu jest atomowa (`UPDATE … WHERE`, RPC, `for update`, `EXCLUDE`), niezmienniki są constraintami → 05 › Współbieżność
   `rg -n -U "\.select\([\s\S]{0,300}if \([\s\S]{0,200}\.(update|insert)\(" <pliki>`; `rg -n "UNIQUE|CHECK \(|EXCLUDE" <migracje>`
5. Tabela dedup/idempotencji ma UNIQUE na id zdarzenia, a wpis powstaje w tej samej transakcji co efekt → 05 › Idempotentność
   `select indexrelid::regclass from pg_index where indisunique and indrelid::regclass::text ~ 'event|webhook|idempot|notification';`
6. Kolejka w Postgresie: `SKIP LOCKED`, `attempts`, `locked_until` (lease), stan końcowy `dead` → 04 › Zadania w tle
   `rg -n -i "skip locked|locked_until|max_attempts" <migracje i worker>`
7. Kwoty są integerami/`numeric(p,s)` + `currency`, czas to `timestamptz`, stawki jako dane → 02 › Pieniądze, czas
   zapytania o `real/double precision` i `timestamp without time zone` z karty 02
8. PK i ID publiczne: brak sekwencyjnych ID w URL (lub `access` to uzasadnia); numeracja prawna = licznik per org → 02 › Identyfikatory
   `select table_name, column_name from information_schema.columns where table_schema='public' and (column_default like 'nextval%' or is_identity='YES');`
9. Metadane plików mają `org_id`, ścieżka prefiks org, bucket prywatny, usunięcie rekordu sprząta obiekt → 02 › Pliki
   `select id, public from storage.buckets;`
10. Wyszukiwanie/lista: istnieje indeks pod zapytanie (GIN/trgm/GiST/`(org_id, created_at, id)`), filtr org, keyset zamiast offset → 06 › Wyszukiwanie, 06 › Listy
    `EXPLAIN (ANALYZE, BUFFERS) <zapytanie>`; `rg -n "\.range\(|offset|count: ?'exact'" <pliki>`
11. Tabela zdarzeń: `occurred_at` osobno od `created_at`, klucz idempotencji, brak UPDATE/DELETE, retencja → 04 › Zdarzenia
    zapytanie o granty z karty 04
12. Nowy cache/widok zmaterializowany/replika ma opisaną nieświeżość i odświeżanie → 02 › Spójność, 02 › Cache
    `select matviewname from pg_matviews;`; `rg -n -i "refresh materialized" <migracje>`
13. Backup/restore: migracja T3 ma świeżą kopię i plan rollbacku → 05 › Kopie zapasowe
    `rg -n "Ostatni test restore: [0-9]{4}" docs/RUNBOOK.md`

## OPS (ops-reviewer)
1. Każde wołanie zewnętrzne ma timeout (`AbortSignal`), `User-Agent`, obsługę 429/5xx z `Retry-After` → 05 › Zależności zewnętrzne
   `rg -n "fetch\(" <pliki> -A6 | rg -v "signal|timeout|AbortSignal"`
2. Retry ma backoff + jitter + limit prób i dotyczy tylko operacji idempotentnych → 05 › Zależności zewnętrzne
   `rg -n -i "retry|retries|backoff" <pliki>`
3. Istnieje fallback/komunikat dla użytkownika i wyłącznik integracji opisany w RUNBOOK → 05 › Zależności zewnętrzne
   `rg -n -i "kill switch|wyłącznik|feature flag" docs/RUNBOOK.md`
4. Błędy ścieżki krytycznej idą do Sentry/logów z kontekstem i `request_id`; alert ma odbiorcę i datę testu, runbook bez placeholderów → 05 › Obserwowalność
   `rg -n "captureException|@sentry|Sentry\.init" package.json <pliki>`; `rg -n "\[link|\[URL|TODO" docs/RUNBOOK.md`
5. Rollback frontu, funkcji i migracji opisany; migracja kompatybilna na jeden deploy → 07 › CI/CD
   `rg -n -i "rollback|cofnij" docs/RUNBOOK.md`
6. CI faktycznie wykonuje lint/typecheck/test/audyt (brak maskujących `--if-present`/`continue-on-error`/`|| true` w krokach bramkujących) → 07 › CI/CD
   `rg -n "if-present|continue-on-error|\|\| true" .github/workflows package.json`
7. Ścieżka deployu zgodna z założeniem: nowa edge function wdrożona osobno, hosting zgodny z `docs/ARCHITECTURE.md`, `pg.phase` prawdziwe → 07 › Platforma
   `ls supabase/functions | rg -v "^_"`; `rg -n -i "deploy" README.md docs/RUNBOOK.md`
8. Środowiska: `.env` nie jest śledzony, `.env.example` aktualny, flagi `*_TEST_MODE` wyłączone na prod, lokalne env nie wskazuje prod → 07 › Środowiska
   `git ls-files | rg "^\.env"`; `node ~/.claude/bin/env-ref-gate.js --repo .`; `rg -n "TEST_MODE|SANDBOX" src .env.example`
9. Kolejka/zadania: alert na wiek najstarszego zadania i liczbę `dead`, `failed` widoczne → 04 › Zadania w tle
   `rg -n -i "oldest|backlog|dead" docs/RUNBOOK.md`
10. Region danych wpisany (EEA), RPO/RTO i „Ostatni test restore: data" w RUNBOOK; plan zapewnia kopie/PITR → 05 › Kopie zapasowe, 07 › Koszt, uzależnienie od dostawcy i region
    `rg -n -i "RPO|RTO|region" docs/RUNBOOK.md README.md`
11. Nagłówki cache: statyki `immutable`, dane użytkownika `private/no-store`, mutacja publicznej strony ma `revalidate*` → 03 › CDN, 02 › Cache
    `rg -n "Cache-Control|revalidate" <pliki>`
12. Zmiana DNS/hostingu: obniżony TTL, wyeksportowane rekordy (MX/TXT), krok cofnięcia → 01 › Domena, DNS
    `dig +short MX <domena>; dig +short TXT <domena>`
13. Połączenia do bazy z funkcji: pooler, klient raz na moduł, brak SPOF bez planu → 03 › Wąskie gardło, 01 › Round tripy
    `rg -n "new Pool\(|createClient\(|new Client\(" <pliki>`
14. Własny host: SIGTERM obsłużony, restart policy, nie-root, named volume + kopia, przypięte tagi, bind na loopback → 01 › Własny host, 07 › Kontenery
    `docker inspect -f '{{.Name}} {{.HostConfig.RestartPolicy.Name}} user={{.Config.User}}' $(docker ps -q)`; `ss -ltnp | rg -v "127\.0\.0\.1|::1"`
15. Cap kosztu per org (LLM/SMS/mail/egress) i alert dla każdej nowej płatnej zależności → 03 › Rate limiting, 07 › Koszt
    `rg -n -i "budget|cap|quota|daily" <pliki AI/SMS>`
16. Health check sprawdza realną zależność, nie tylko port → 03 › Health checki
    `rg -n "health" <pliki>`

## SECURITY (security-reviewer)
1. Authz per rekord: każde zapytanie po `id` ma filtr org/user albo RLS; `service_role` poza kodem serwerowym = 0 → 05 › Tożsamość, 02 › Multi-tenancy
   `rg -n "\.eq\(['\"]id['\"]" <pliki> | rg -v "org"`; `rg -n "service_role|SERVICE_ROLE" src | rg -v "server|functions|api"`
2. RLS `USING` + `WITH CHECK`, funkcje SECURITY DEFINER z `search_path`, bez `EXECUTE` dla anon/PUBLIC, test negatywny cross-tenant w tej samej zmianie → 05 › Tożsamość
   `node ~/.claude/bin/sql-migration-lint.js --repo . --strict --json`; `rg -ln -i "cross.?tenant|other.?org" tests`
3. Payload: kolekcje mają `access`; Local API w imieniu użytkownika przekazuje `user` i `overrideAccess: false` → 05 › Tożsamość
   `rg --files-without-match "access:" src/collections --glob '*.ts'`; `rg -n "payload\.(find|findByID|create|update|delete)\(" <pliki> | rg -v overrideAccess`
4. Webhook: podpis na surowym body, porównanie w stałym czasie, idempotentne przetwarzanie po id zdarzenia → 04 › Webhooki, 05 › Idempotentność
   `rg -n "timingSafeEqual|constantTimeEqual|hmac" <pliki>`; `rg -n "req\.json\(\)|request\.json\(\)" <pliki webhooków>`
5. Check-then-act na pieniądzach/stanie/limitach bez blokady lub constraintu = finding (TOCTOU) → 05 › Współbieżność
   `rg -n -U "\.select\([\s\S]{0,300}if \([\s\S]{0,200}\.(update|insert)\(" <pliki>`
6. Cache/CDN: brak współdzielonych odpowiedzi z danymi użytkownika; klucz zawiera scope uwierzytelnienia → 03 › CDN, 02 › Cache
   `rg -n "Cache-Control|unstable_cache|use cache|s-maxage|force-static" <pliki>`
7. Buckety danych klientów prywatne; dostęp przez krótkie podpisane URL-e; limit rozmiaru/typu uploadu → 02 › Pliki
   `rg -n "getPublicUrl|/object/public/|public: ?true" <pliki>`
8. Rate limit na login/reset/rejestrację/formularze publiczne/płatne API; klucz limitu user/org; funkcje `verify_jwt = false` mają własne uwierzytelnienie → 03 › Rate limiting
   `rg -n "verify_jwt" supabase/config.toml`; `rg -n -i "ratelimit|rate_limit|429" <pliki>`
9. Wejście parsowane `safeParse` na granicy; kwoty, role, `org_id`, statusy wyznaczane po stronie serwera; brak mass assignment → 04 › Kontrakt API
   `rg -n "\.(update|insert|upsert)\((body|req\.body|data|input)" <pliki>`
10. Tokeny/klucze nie są w query stringu, logach ani repo; zmienne publiczne bez sekretów → 07 › Środowiska
    `rg -n "ghp_|sk-ant-|sbp_|AKIA|-----BEGIN [A-Z ]*PRIVATE KEY" -g '!node_modules' .`; `rg -n "VITE_.*(SECRET|SERVICE|PRIVATE)|NEXT_PUBLIC_.*(SECRET|SERVICE|PRIVATE)" .env* src`
11. Realtime/wyszukiwanie/wektory respektują RLS i zasięg tenanta → 04 › Real-time, 06 › Wyszukiwanie
    `select * from pg_publication_tables where pubname='supabase_realtime';`
12. Funkcje AI: wyjście LLM walidowane, narzędzia z minimalnymi uprawnieniami, mutacje po potwierdzeniu, dane użytkownika nie są instrukcjami, brak PII bez potrzeby → 06 › Funkcje AI
    `rg -n -i "tools:|generateObject|safeParse" <pliki AI>`
13. Szablony powiadomień: brak wstrzyknięć HTML, escapowane zmienne, opt-out i zapis zgody → 06 › Powiadomienia
    `rg -n "dangerouslySetInnerHTML|innerHTML|\{\{\{" <pliki>`
14. Obrazy/kontenery: brak sekretów w warstwach, nie-root, przypięte tagi → 07 › Kontenery
    `rg -n "^(ENV|ARG) .*(KEY|TOKEN|PASSWORD|SECRET)|:latest" Dockerfile* docker-compose*.yml`
15. Dane osobowe: brak PII w logach, fixtures bez realnych danych, wpis w `docs/PRIVACY.md` → 05 › Dane osobowe
    `rg -n -i "console\.(log|error|warn)\(.*(email|phone|kennitala|pesel|token)" <pliki>`

## CODE (code-reviewer)
1. Brak stanu w zmiennych modułu między żądaniami; brak trwałych zapisów na dysk lokalny; brak „harmonogramu" w procesie → 01 › Bezstanowość
   `rg -n "^(let|var) |^const \w+ = new (Map|Set)\(" <pliki>`; `rg -n "writeFile|setInterval|node-cron" <pliki>`
2. Niezależne `await` zrównoleglone, brak N+1 w pętli, klient HTTP/DB tworzony raz → 01 › Round tripy
   `rg -n -A4 "for \(|\.map\(async|forEach\(async" <pliki> | rg "\.from\(|fetch\("`
3. Mutujące endpointy zewnętrzne przyjmują `Idempotency-Key`; zapisy absolutne zamiast względnych; handler zdarzenia ma dedup → 04 › Kontrakt API, 05 › Idempotentność
   `rg -n -i "idempotency|on conflict|event_id" <pliki>`
4. Błędy w stałym kształcie (kod + komunikat + `request_id`), statusy HTTP zgodne z wynikiem → 04 › Kontrakt API
   `rg -n "status: ?200" <pliki> | rg -i error`
5. Paginacja keyset z tiebreakerem `id`, nie offset, dla rosnących list → 06 › Listy
   `rg -n "\.range\(|offset|\.order\(" <pliki>`
6. Każda mutacja ma inwalidację cache (`invalidateQueries`/`revalidate*`/`router.refresh`); decyzje o stanie nie czytają z cache → 02 › Spójność, 02 › Cache
   `rg -n "invalidateQueries|revalidate|router\.refresh" <pliki>`
7. Testy: „to samo zdarzenie 2× → jeden efekt" i wyścig (2 równoległe żądania) dla nowej logiki zapisu; test kontraktowy dla zmienionego API → 05 › Idempotentność, 05 › Współbieżność
   `rg -ln -i "twice|duplicate|race|concurrent|Promise\.all" tests e2e`
8. `catch` loguje z kontekstem (co, dla kogo, dlaczego) bez PII albo rzuca dalej; brak `catch {}` → 05 › Obserwowalność
   `rg -n "catch\s*(\([^)]*\))?\s*\{\s*\}" <pliki>`
9. Klient real-time: reconnect z odświeżeniem stanu, sprzątanie subskrypcji → 04 › Real-time
   `rg -n "\.channel\(|removeChannel|unsubscribe" <pliki>`
10. Granice modułów: brak importów w głąb cudzego modułu, brak cykli; wywołania między usługami z timeoutem → 07 › Monolit modularny vs usługi
    `node ~/.claude/bin/module-boundaries.js --help`; `rg -n "functions\.invoke" supabase/functions`
11. Transakcje krótkie, bez wywołań sieciowych w środku; blokady w stałej kolejności → 05 › Współbieżność
    `rg -n -B6 "await fetch\(|\.invoke\(" <pliki> | rg -i "transaction|for update"`
12. Worker kolejki: konsument idempotentny, limit prób, obsługa „zatrutej" wiadomości → 04 › Zadania w tle
    `rg -n -i "attempts|dead|failed" <worker>`
13. Własna implementacja locka/wyboru lidera/kolejki/rate limitera zastąpiona narzędziem bazy lub platformy (grep-first) → 05 › Współbieżność, 03 › Rate limiting
    `rg -n -i "setnx|redlock|leader|rateLimit" <pliki>`
14. Kwoty/czas: brak `float`/`toFixed` na pieniądzach, brak lokalnej strefy w logice dat, jedna funkcja zaokrąglająca → 02 › Pieniądze, czas
    `rg -n "toFixed\(|parseFloat\(|new Date\(\)\.get" <pliki>`
15. Wersje: kod zgodny z wersją biblioteki z lockfile (zod 3/4, React 18/19, Next 15/16, Tailwind 3/4) → 04 › Kontrakt API, 02 › Cache
    `rg -n "\"(zod|react|next|tailwindcss)\"" package.json`

## PRODUCT (product-reviewer)
1. Dodatek infrastrukturalny (kolejka, cache, realtime, silnik wyszukiwania, shard, usługa, nowy magazyn) ma NAZWANY obecny problem i sygnał powrotu; „nie potrzebujesz jeszcze" zapisane w ADR → README, 07 › Monolit modularny vs usługi
   `git diff --name-only <baza>...HEAD | rg "docker-compose|package\.json|supabase/migrations"`; `rg -n -i "nie potrzebujemy jeszcze|revisit" docs/adr`
2. Funkcje asynchroniczne mają stany UI (w toku/błąd/sukces) i komunikaty dla użytkownika → 04 › Zadania w tle
   `rg -n -i "isLoading|isPending|status|error" <komponenty z diffu>`
3. Decyzje spójności opisane per przepływ językiem klienta (co widzi przy nieświeżych danych) → 02 › Spójność
   `rg -n -i "nieświeże|stale|odświeżanie" docs PR`
4. Podział na usługi/repozytoria uzasadniony zespołem lub profilem skalowania → 07 › Monolit modularny vs usługi
5. RPO/RTO, polityka kopii i plan Supabase uzgodnione z klientem, nie tylko techniczne → 05 › Kopie zapasowe
   `rg -n -i "RPO|RTO" docs/RUNBOOK.md docs/adr`
6. Powiadomienia: preferencje, opt-out, kanały, koszty SMS i zgoda uzgodnione i zapisane → 06 › Powiadomienia
   `rg -n -i "unsubscribe|opt.?out|zgoda|consent" docs src`
7. Dane osobowe i lokalizacja mają wpis w `docs/PRIVACY.md` (cel, retencja, podprocesor) → 05 › Dane osobowe, 06 › Geo
   `rg -n -i "retencj|retention|podprocesor" docs/PRIVACY.md`
8. Sukces zmiany jest mierzalny (budżet opóźnień ścieżki krytycznej jako liczba, nie „szybko") → 01 › Round tripy, `capacity.md`
   `rg -n -i "budżet opóźnień|p95|ms" docs/adr PR`
9. Nowa płatna zależność ma cenę, właściciela, cap i plan wyjścia w ADR → 07 › Koszt
   `rg -n -i "cena|koszt|cap|exit|wyjście" docs/adr`
10. To, co klient zmienia sam (stawki, teksty, progi), jest DANYMI (CMS/tabela), nie kodem; zaplanowano puste sloty → `pg/design.md` B
    `rg -n "process\.env\.(RATE|MARGIN|VAT)" src`
11. Komunikaty o limitach i błędach (429, brak uprawnień, brak połączenia) są zrozumiałe dla użytkownika końcowego → 03 › Rate limiting, 04 › Kontrakt API
    `rg -n -i "429|too many|forbidden|unauthorized" src`
12. Dokument wystawiany klientowi (faktura/umowa) jest niezmienny po wystawieniu, ma ciągłą numerację i migawkę danych → 06 › Dokumenty
    `select tgname, tgrelid::regclass from pg_trigger where not tgisinternal and tgrelid::regclass::text ~* 'invoice|faktur|contract|document';`
13. Repo przejmowalne przez obcego: README (uruchomienie, deploy), `docs/ARCHITECTURE.md` zgodne z kodem, RUNBOOK bez placeholderów → 07 › Platforma
    `rg -n "\[link|\[URL|TODO" docs/RUNBOOK.md`; `rg -n -i "hosting" docs/ARCHITECTURE.md`

# 03 · Skala i ruch — wąskie gardło, zapytania, brzeg, limity, health

Konwencje (`~`, `[NIEPEWNE]`, zmienne ścieżek, odsyłacze `NN › Karta`) — w `README.md`.
Zasada: przy 1–10 tys. użytkowników problemy „skali" prawie zawsze okazują się brakiem indeksu, N+1, połączeniami do bazy albo rachunkiem — nie ruchem. Najpierw pomiar (`capacity.md`).

---

### Wąskie gardło i skalowanie

**Problem.** „Czy to uniesie?" Kolejność, w jakiej boli w naszym stacku: (1) zapytania bez indeksu i N+1, (2) połączenia do bazy z funkcji serverless, (3) limit planu bazy (pamięć/CPU/dysk), (4) czas i pamięć funkcji, (5) rachunki (egress, LLM, SMS) — a QPS ostatni. Sygnały w diffie: nowa funkcja wołana z pętli, `Promise.all` na setkach zapytań, nowy cron, import masowy, hasło „skalowalne" w opisie bez liczby.

**Domyślnie u nas.** Pomiar → większy plan/instancja (pionowo) → widok zmaterializowany lub replika dla ciężkich odczytów → dopiero potem cokolwiek innego. Funkcje serverless łączą się z bazą przez pooler w trybie transakcyjnym (Supabase: Supavisor, port 6543 `[NIEPEWNE: sprawdź w panelu projektu]`); bezpośrednie połączenie/sesyjne tylko dla migracji i narzędzi wymagających cech sesji (advisory lock sesyjny, `LISTEN`, prepared statements zależnie od sterownika). Klient DB raz na moduł, transakcje krótkie. Pojemność sprawdzaj wzorem Little’a: współbieżność ≈ żądania/s × czas obsługi (np. ~10 req/s × 0,3 s ≈ 3 równoległe zapytania) — to liczba, którą porównujesz z limitem połączeń.
**Kiedy NIE zostać przy tym:** CPU bazy trwale ~>70 % po usunięciu złych zapytań, albo zapisy przerastają jedną maszynę (rzadkie przy tej skali `[~]`).

| Wariant | Koszt operacyjny | Finansowy | Poznawczy |
|---|---|---|---|
| większy plan (pion) | zero zmian w kodzie | skokowy, ale przewidywalny | niski |
| widok zmaterializowany / replika odczytu | harmonogram odświeżania; lag repliki | replika = dodatkowa instancja `[NIEPEWNE: wg planu]` | średni |
| partycjonowanie/sharding | migracje, reshardowanie, ograniczenia joinów | wysoki | bardzo wysoki — nie przy tej skali |

**Awarie i detekcja.**
- *wyczerpane połączenia („remaining connection slots", „too many clients")* — `select state, count(*) from pg_stat_activity group by state;` oraz `show max_connections;`
- *długie transakcje trzymające blokady i połączenia* — `select pid, state, now()-xact_start as age, left(query,60) from pg_stat_activity where state like 'idle in transaction%';`
- *serverless skaluje się szybciej niż baza* — `rg -n "new Pool\(|createClient\(|postgres\(" src supabase/functions` (poza poziomem modułu = flaga) i `rg -n "6543|pooler" .env.example README.md docs`
- *import/cron masowy równolegle z ruchem* — `rg -n -i "cron|schedule" supabase/migrations supabase/config.toml vercel.json`
- *wąskie gardło nie tam, gdzie myślisz* — `select relname, seq_scan, idx_scan, n_live_tup from pg_stat_user_tables order by seq_scan desc limit 10;`

**Audyt „czy się trzymamy".**
1. Czy zmiana podaje szacunek QPS/obciążenia zamiast „skalowalne"? → `rg -n -i "qps|req/s|capacity|pojemność" docs PR`.
2. Czy handlery używają poolera i jednego klienta na moduł? → komenda z awarii + zmienna `DATABASE_URL` wskazuje na pooler.
3. Czy jest SPOF bez planu (jedna instancja n8n/VPS/baza bez restore)? → `docs/RUNBOOK.md` sekcja Backup/Restore.
4. Czy cron/import ma limit partii i nie zalewa bazy? → `rg -n "limit|batch|chunk" <skrypt importu>`.
5. Czy wiadomo, kto jest największym tenantem i jaki ma udział? → `select org_id, count(*) from <duża_tabela> group by 1 order by 2 desc limit 5;`

**Nie potrzebujesz jeszcze.** Poziomego skalowania bazy, shardingu, własnego autoskalingu, K8s, CQRS, kolejki „dla skali".

---

### Zapytania i indeksy

**Problem.** Większość „problemów wydajności" to zapytanie bez indeksu, N+1, `select *` w liście albo polityka RLS z kosztownym podzapytaniem. Sygnały w diffie: nowy `.eq/.filter/.order/.ilike` na kolumnie bez indeksu, nowa polityka RLS, offset-paginacja, `count: 'exact'` na dużej tabeli, `.select('*')` w liście, funkcja na kolumnie w `WHERE` (`lower(email)`).

**Domyślnie u nas.** Indeks na każdym FK i kolumnie z WHERE/ORDER/polityki; indeksy złożone w kolejności: równość → zakres/sort; w tabelach tenantowych `org_id` pierwszy. W politykach RLS `(select auth.uid())` zamiast gołego `auth.uid()` (planer wylicza raz na zapytanie, nie na wiersz) `[NIEPEWNE: potwierdź w aktualnym docs Supabase]` oraz indeks na kolumnach użytych w polityce. Paginacja keyset: `where (created_at, id) < ($1, $2) order by created_at desc, id desc limit n`. Plan sprawdzany `EXPLAIN (ANALYZE, BUFFERS)` na danych podobnych do produkcyjnych — na 10 wierszach planer zawsze wybierze seq scan. `pg_stat_statements` pokazuje, co naprawdę kosztuje (włączone w Supabase `[NIEPEWNE]`). Indeksy częściowe dla stanów (`where status = 'open'`).
**Kiedy NIE indeksować:** tabele ~<kilka tysięcy wierszy, kolumny o niskiej selektywności same z siebie; każdy indeks spowalnia zapis i zajmuje miejsce.

| Wariant | Koszt operacyjny | Finansowy | Poznawczy |
|---|---|---|---|
| btree na FK/WHERE | migracje, miejsce | zero | niski |
| indeks częściowy/funkcyjny | trzeba pilnować zgodności zapytania z definicją | zero | średni |
| GIN (trgm/FTS/jsonb) | wolniejszy zapis, większy rozmiar | zero | średni |
| materialized view | odświeżanie | zero | średni |

**Awarie i detekcja.**
- *FK bez indeksu* — zapytanie z karty „Model danych" (02).
- *seq scany na dużych tabelach* — `select relname, seq_scan, idx_scan, n_live_tup from pg_stat_user_tables where n_live_tup > 10000 order by seq_scan desc limit 10;`
- *nieużywane indeksy (koszt zapisu bez zysku)* — `select s.relname, s.indexrelname, s.idx_scan, (select stats_reset from pg_stat_database where datname=current_database()) as stats_reset from pg_stat_user_indexes s join pg_index i on i.indexrelid=s.indexrelid where s.idx_scan=0 and not i.indisunique and not i.indisprimary and not i.indisexclusion and not exists (select 1 from pg_constraint k where k.contype='f' and k.conrelid=i.indrelid and i.indkey::int2[] @> k.conkey) order by pg_relation_size(s.indexrelid) desc limit 10;` — wynik to KANDYDACI, nie wyrok: `idx_scan=0` liczy się od `stats_reset` (świeży restart lub reset statystyk = puste dane; patrz kolumna), zapytanie pomija indeksy unikalne, wykluczające i pokrywające FK (karta 02 wymaga indeksu na każdym FK). Zakaz `DROP INDEX` bez sprawdzenia, że żaden FK ani zapytanie sezonowe/raportowe go nie używa
- *najdroższe zapytania* — `select calls, round(mean_exec_time::numeric,1) as ms, left(query,80) from pg_stat_statements order by total_exec_time desc limit 10;`
- *offset-paginacja i exact count* — `rg -n "\.range\(|offset|count: ?'exact'" src`
- *`select *` w listach* — `rg -n "select\('\*'\)|select\(\"\*\"\)|\.select\(\)" src`
- *funkcja na kolumnie bez indeksu funkcyjnego* — `rg -n "lower\(|ilike" src supabase/migrations`
- *martwe krotki / bloat* — `select relname, n_dead_tup, last_autovacuum from pg_stat_user_tables order by n_dead_tup desc limit 5;`

**Audyt „czy się trzymamy".**
1. Czy każda kolumna filtrowana/sortowana w nowym zapytaniu ma indeks? → `select indexdef from pg_indexes where tablename='<tabela>';`
2. Czy nowa polityka RLS używa `(select auth.uid())` i ma indeks? → `rg -n "auth\.uid\(\)" supabase/migrations | rg -v "select auth\.uid"`.
3. Czy lista używa keyset, nie offset? → komenda z awarii.
4. Czy N+1 jest wykluczone? → `rg -n -A4 "for \(|\.map\(async" src | rg "\.from\(|fetch\("`.
5. Czy jest `EXPLAIN` z realistycznych danych dla zapytania T2+? → w opisie PR.
6. Czy zajrzano do `pg_stat_statements` po wdrożeniu? → zapytanie z awarii.

**Nie potrzebujesz jeszcze.** Partycjonowania, replik odczytu, Elasticsearcha, zewnętrznego cache — przed pomiarem `EXPLAIN`.

---

### CDN, nagłówki i brzeg

**Problem.** Treści statyczne i publiczne strony powinny być serwowane z brzegu, a dane zalogowanych nigdy z cache współdzielonego. Sygnały w diffie: `Cache-Control`, `vercel.json` (headers/rewrites), `revalidate`, `dynamic = 'force-*'`, `Vary`, edge runtime, zmiany nagłówków bezpieczeństwa.

**Domyślnie u nas.** CDN daje platforma (Vercel). Statyki z hashem w nazwie: `public, max-age=31536000, immutable` (wzór: `vercel.json` w workshop-app); HTML publiczny: ISR/SSG + `revalidate` po mutacji; odpowiedzi z danymi użytkownika: `private, no-store`; klucz cache obejmuje wszystko, co zmienia treść (cookie, `Authorization`, `Accept-Language`). Nagłówki bezpieczeństwa jak w workshop-app: `X-Content-Type-Options`, `X-Frame-Options`/`frame-ancestors`, `Referrer-Policy`, `Strict-Transport-Security`, `Permissions-Policy`; pełne CSP dopiero, gdy ktoś je utrzyma (zły CSP psuje stronę). Edge compute tylko wtedy, gdy nie woła jednoregionowej bazy w każdym żądaniu (→ 01 › Round tripy). Klient API do usług za Cloudflare wysyła `User-Agent` (inaczej 1010/403 — `pg/cases.md` MGMT-API-USER-AGENT).
**Kiedy NIE:** dane per użytkownik/organizacja, szybko zmienne stany.

| Wariant | Koszt operacyjny | Finansowy | Poznawczy |
|---|---|---|---|
| statyki immutable + ISR | revalidate po zmianie treści | najtańszy | niski |
| krótki TTL + stale-while-revalidate | świeżość ~sekundy–minuty | niski | średni |
| edge compute | dane daleko od kodu, trudne debugowanie | płatne wg planu | wysoki |
| własny CDN/multi-CDN | integracja, purge | wysoki | wysoki — nie |

**Awarie i detekcja.**
- *dane użytkownika w cache współdzielonym* — `curl -s -D - -o /dev/null -H "Authorization: Bearer $T" <url> | rg -i "cache-control|vary|age|x-vercel-cache"`
- *brak revalidate po mutacji publicznej strony* — `rg -n "revalidate" src/collections src/app` zestawione z miejscami zapisu
- *statyki bez immutable* — `curl -sI <url>/assets/<plik>.js | rg -i cache-control`
- *brak nagłówków bezpieczeństwa* — `curl -sI https://<domena> | rg -i "strict-transport|x-frame|x-content-type|referrer-policy|permissions-policy"`
- *pomieszane dynamiczne/statyczne trasy w Next* — `rg -n "dynamic *=|revalidate *=|force-static|force-dynamic" src/app`

**Audyt „czy się trzymamy".**
1. Czy odpowiedzi z danymi użytkownika mają `private`/`no-store`? → `rg -n "Cache-Control" src/app/api`; brak nagłówka na autoryzowanym endpoincie = flaga.
2. Czy statyki mają hash i `immutable`? → `curl` z awarii.
3. Czy każda mutacja publicznej treści unieważnia stronę? → `rg -n "revalidatePath|revalidateTag" src`.
4. Czy nagłówki bezpieczeństwa są ustawione? → `curl` z awarii.
5. Czy zmiana edge/workera ma sposób cofnięcia? → `rg -n -i "rollback|promote" docs/RUNBOOK.md`.

**Nie potrzebujesz jeszcze.** Własnego CDN, edge workerów z logiką biznesową, multi-CDN, własnego pipeline’u obrazów.

---

### Rate limiting i budżety kosztu

**Problem.** Publiczne endpointy, które kosztują (czat AI, SMS, mail, upload) albo są atakowalne (logowanie, reset hasła, formularze), muszą mieć limit — inaczej bot generuje rachunek lub przejmuje konta. Flota ma takie powierzchnie: czat AI, formularze kontaktowe, SMS/IVR, asystent AI, edge functions bez JWT (webhooki). Sygnały w diffie: nowa trasa `app/api/**`, edge function z `verify_jwt = false`, nowe wywołanie płatnego API (LLM/Twilio/Resend), formularz anonimowy.

**Domyślnie u nas.** Warstwy: (1) brzeg/WAF platformy `[NIEPEWNE: zależy od planu]`; (2) aplikacja — limit per użytkownik/organizacja (dla anonimów IP + dodatkowy czynnik, np. Turnstile/captcha `[NIEPEWNE: sprawdź warunki]`) z atomowym licznikiem w bazie: `insert into rate_limits(key, window_start, count) values ($1, date_trunc('minute', now()), 1) on conflict (key, window_start) do update set count = rate_limits.count + 1 returning count;`; (3) budżet: zużycie per organizacja/dzień + alert + wyłącznik awaryjny (wzór w `pg/prr.md` P9: cap kosztu AI per org). Odpowiedź 429 z `Retry-After`. Decyzja fail-open/fail-closed zapisana: logowanie, płatności i płatne API = fail-closed. Limit w pamięci instancji nie działa w serverless (każda instancja liczy osobno — 01 › Bezstanowość).
**Kiedy NIE:** wewnętrzne narzędzie za logowaniem dla kilku osób — wystarczy cap kosztu.

| Wariant | Koszt operacyjny | Finansowy | Poznawczy |
|---|---|---|---|
| licznik w Postgresie | czyszczenie starych okien, gorący wiersz | zero | niski |
| WAF/limit platformy | konfiguracja per plan | zależnie od planu | niski |
| Redis/Upstash limiter | dodatkowy serwis | abonament | średni |
| captcha (Turnstile) | integracja we froncie | zwykle zero | niski, ale UX |

**Awarie i detekcja.**
- *limit tylko po IP → blokuje całe biuro / omijalny* — `rg -n -i "x-forwarded-for|ip" src/app/api supabase/functions | rg -i "limit"`
- *publiczne funkcje bez własnego uwierzytelnienia* — `rg -n "verify_jwt" supabase/config.toml` (wartość `false` = funkcja musi weryfikować podpis/limit sama)
- *brak capa na płatne API* — `rg -n -i "anthropic|generateText|streamText|twilio|resend" src supabase/functions -l` i w tych plikach `rg -n -i "budget|cap|quota|daily|limit"`
- *licznik z tabeli append-only bez okna* — `rg -n "count\(\*\)" src supabase/functions | rg -i "rate|attempt|try"`
- *brak `Retry-After`* — `rg -n "429" src supabase/functions | rg -v "Retry-After"`

**Audyt „czy się trzymamy".**
1. Czy logowanie, reset hasła, rejestracja i formularze publiczne mają limit? → `rg -n -i "ratelimit|rate_limit|too many|429|turnstile|captcha" src supabase/functions`.
2. Czy klucz limitu to user/org (dla anonimów więcej niż sam IP)? → odczyt kodu limitera.
3. Czy fail-open/fail-closed jest zapisane i uzasadnione? → `rg -n -i "fail.?(open|closed)" docs`.
4. Czy płatne wywołania mają cap per organizację i alert? → trzecia komenda z awarii.
5. Czy webhooki dostawców są weryfikowane podpisem, a nie tylko limitowane? → 04 › Webhooki.
6. Czy 429 niesie `Retry-After`? → komenda z awarii.

**Nie potrzebujesz jeszcze.** Redisa/Upstash jako limitera (dopóki Postgres znosi ~kilkadziesiąt zapisów limitera/s `[~]`), API gateway, rozliczeń kwotowych per klient.

---

### Health checki i równoważenie

**Problem.** Rozdzielanie ruchu i wykrywanie niezdrowych instancji robi platforma; własna odpowiedzialność to tylko to, co sami hostujemy, oraz to, czy „zdrowie" znaczy coś prawdziwego. Sygnały w diffie: nowa trasa `/health`, reverse proxy (Caddy/nginx) przed własną usługą, nowy monitor dostępności, zmiana timeoutów proxy.

**Domyślnie u nas.** Load balancer = platforma (Vercel/Supabase). Własny host: jeden reverse proxy kończący TLS. `/health` sprawdza zależność krytyczną (`select 1` z timeoutem), nie tylko zwraca 200; osobno liveness (proces żyje) i readiness (zależności działają); zewnętrzny monitor dostępności [NIEPEWNE: nie ustalono, który serwis jest używany]; timeouty proxy dopasowane do najdłuższego legalnego żądania.
**Kiedy NIE:** statyczna strona bez zależności — wystarczy monitor HTTP 200 na stronie głównej.

| Wariant | Koszt operacyjny | Finansowy | Poznawczy |
|---|---|---|---|
| health = proces żyje | zero | zero | niski; „zielone" przy padniętej bazie |
| health = zależność krytyczna | ryzyko kaskady, gdy dodasz zbyt wiele zależności | zero | niski–średni |
| własny LB / mesh | HA samego balancera, certyfikaty | wysoki | wysoki — nie |

**Awarie i detekcja.**
- *health 200 przy padniętej bazie* — `rg -n "health" src/app supabase/functions` i odczyt, czy woła bazę
- *health ciężki lub ujawniający wersje/sekrety* — `curl -s <url>/health` (nie powinien zwracać konfiguracji)
- *timeout proxy ucina długie żądania* — `curl -s -o /dev/null -w "%{http_code} %{time_total}\n" <url-długiej-operacji>`
- *monitor nie istnieje/nie ma odbiorcy* — `rg -n -i "uptime|healthcheck|monitor" docs/RUNBOOK.md`

**Audyt „czy się trzymamy".**
1. Czy `/health` sprawdza zależność krytyczną z timeoutem? → odczyt handlera.
2. Czy jest zewnętrzny monitor z alertem do człowieka? → `docs/RUNBOOK.md`.
3. Czy certyfikat TLS na własnym hoście odnawia się automatycznie? → `echo | openssl s_client -connect <host>:443 2>/dev/null | openssl x509 -noout -enddate`.
4. Czy timeouty proxy odpowiadają najdłuższemu legalnemu żądaniu? → konfiguracja proxy.

**Nie potrzebujesz jeszcze.** Własnego load balancera, service mesh, routingu kanarkowego.

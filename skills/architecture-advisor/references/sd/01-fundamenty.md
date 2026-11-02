# 01 · Fundamenty — stan, sieć, domena, własny host

Karty operacyjne PG. Konwencje (`~`, `[NIEPEWNE]`, zmienne ścieżek, odsyłacze `NN › Karta`) — w `README.md`.
Każda karta: Problem → Domyślnie u nas / kiedy NIE → Warianty i koszt → Awarie i detekcja → Audyt → Nie potrzebujesz jeszcze.

---

### Bezstanowość i źródło prawdy

**Problem.** Gdzie żyje stan między żądaniami. Funkcje serverless (Vercel, Supabase Edge Functions, route handlery Next) są efemeryczne i jednocześnie działa ich wiele — stan w pamięci procesu, na dysku lokalnym albo w singletonie to rozjazd i utrata danych. Sygnały w diffie: `let`/`Map`/`Set` na poziomie modułu handlera, `fs.writeFile`, `setInterval`/`node-cron` w kodzie aplikacji, licznik w pamięci, `globalThis.cache`. Przykład: lista subskrybentów jako stub w pamięci znika przy każdym deployu — OK dla portfolio, błąd dla produktu z danymi klienta.

**Domyślnie u nas.** Postgres jest jedynym źródłem prawdy dla encji; sesja = cookie/JWT; kolejka zadań = tabela (→ 04 › Zadania w tle); pliki = Storage (→ 02 › Pliki); wspólne liczniki = baza. Wolno trzymać w pamięci tylko to, czego utrata kosztuje wyłącznie wolniejszy start (klient HTTP/DB, sparsowany słownik, memoizacja czystej funkcji).
**Kiedy NIE (stan w procesie jest uzasadniony):** własny serwer WebSocket, długo żyjący worker (n8n, usługi na laptopie) — wtedy jawnie: jedna instancja, restart policy, stan odtwarzalny z bazy (→ 01 › Własny host).

| Wariant | Koszt operacyjny | Finansowy | Poznawczy |
|---|---|---|---|
| Bezstanowo + baza | niski; skok do bazy w prawie każdym żądaniu | zapytania/połączenia | niski |
| Stan w pamięci, 1 instancja | SPOF; restart/deploy gubi stan | najtańszy | niski, dopóki nie pojawi się 2. instancja |
| Sticky sessions / afinitet | nierówne obciążenie, trudny rollout | średni | średni — to dług, nie wybór |

**Awarie i detekcja.**
- *różne wyniki między wywołaniami, reset po cold starcie* — `rg -n "^(let|var) |^const \w+ = new (Map|Set)\(" src/app src/server supabase/functions`
- *plik zapisany lokalnie znika po deployu (poza `/tmp` system plików funkcji bywa tylko do odczytu [NIEPEWNE: sprawdź runtime])* — `rg -n "writeFile|createWriteStream|appendFile" src supabase/functions`
- *„harmonogram" w procesie, który nie żyje ciągle* — `rg -n "setInterval|node-cron|cron\.schedule" src supabase/functions`
- *limit/licznik w pamięci instancji (każda instancja liczy osobno)* — `rg -n "rateLimit|requestCount|counter" src | rg -v test`

**Audyt „czy się trzymamy".**
1. Czy handler trzyma stan w zmiennej modułu? → komenda z tabeli, wynik = lista do uzasadnienia.
2. Czy koszyk/sesja/zadania/liczniki leżą w bazie lub tokenie? → `rg -n "useState|localStorage" src/features | rg -i "cart|order|job"` (tylko stan UI wolno, dane nie).
3. Czy aplikacja działa poprawnie na ≥2 instancjach naraz? → test: 2 równoległe żądania na ten sam zasób (`curl` x2 w tle) daje spójny wynik.
4. Czy zapis przerwany w połowie (timeout funkcji) zostawia spójny stan? → szukaj kilku kolejnych `await` zapisów poza transakcją: `rg -n -U "await .*\.(insert|update)\([\s\S]{0,200}await .*\.(insert|update)\(" src supabase/functions`.
5. Czy dla każdej encji jest jedno źródło prawdy (brak „kopii roboczej")? → `rg -n -i "create table [^ (]*(_copy|_draft|_snapshot|_backup|_old|_tmp)\b" supabase/migrations` (trafienie = uzasadnij w ADR albo usuń).

**Nie potrzebujesz jeszcze.** Redisa na sesje, sticky sessions, rozproszonego cache, własnego stanu współdzielonego między instancjami.

---

### Round tripy i budżet opóźnień

**Problem.** Opóźnienie w naszych aplikacjach to prawie zawsze liczba sekwencyjnych wywołań sieciowych (przeglądarka → funkcja → baza → API zewnętrzne), nie CPU. Region bazy względem użytkownika to największy pojedynczy mnożnik: baza w innym regionie niż użytkownicy (np. region środkowoeuropejski przy użytkownikach na Islandii) — każdy sekwencyjny skok przeglądarka→baza kosztuje dziesiątki ms (rząd ~50 ms [NIEPEWNE: zmierz]). Sygnały w diffie: kilka `await` pod rząd bez zależności między nimi, zapytanie w pętli, komponent wołający fetch po fetchu (waterfall), edge function wołająca bazę z jednego regionu.

**Domyślnie u nas.** Dla ścieżki krytycznej wypisz round tripy × czas (→ `capacity.md`). Cele jako reguła kciuka: akcja interaktywna ~<200 ms p95, załadowanie widoku ~<1 s. Niezależne wywołania równolegle (`Promise.all`); jedno zapytanie z joinem/RPC zamiast N; klient DB/HTTP tworzony raz na moduł; funkcje i baza w jednym regionie. Funkcja regionalna blisko bazy bije edge, gdy robi kilka zapytań — edge opłaca się dopiero, gdy nie woła jednoregionowej bazy w każdym żądaniu.
**Kiedy NIE optymalizować:** ścieżka niekrytyczna, wewnętrzne narzędzie dla garstki osób, zysk <~50 ms.

| Wariant | Koszt operacyjny | Finansowy | Poznawczy |
|---|---|---|---|
| `Promise.all` na niezależnych wywołaniach | zerowy | zerowy | niski |
| RPC/widok zwracający gotowy kształt | logika w SQL, migracje | zerowy | średni (dwa miejsca logiki) |
| Prefetch/SSR dla pierwszego widoku | wymaga strategii cache | większe zużycie funkcji | średni |
| Edge compute | dane daleko od kodu = wolniej | zależnie od planu | wysoki |

**Awarie i detekcja.**
- *N+1 przez sieć (zapytanie w pętli)* — `rg -n -A4 "for \(|\.map\(async|forEach\(async" src supabase/functions | rg "supabase|fetch\(|\.from\("`
- *waterfall sekwencyjnych `await`* — `rg -n -U "const \w+ = await .*\n\s*const \w+ = await " src` — przejrzyj, czy drugi zależy od pierwszego
- *nowe połączenie DB/HTTP na każde żądanie (TCP + TLS ≈ kilka RTT)* — `rg -n "new Pool\(|createClient\(|new Client\(" src supabase/functions` — poza poziomem modułu = flaga
- *realne czasy* — `curl -s -o /dev/null -w "connect %{time_connect} tls %{time_appconnect} ttfb %{time_starttransfer} total %{time_total}\n" <url>`; baza: `PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=15s' psql "$DB_URL" -c '\timing on' -c 'select 1'`
- *wolne zapytanie* — `EXPLAIN (ANALYZE, BUFFERS) <zapytanie>` na realistycznych danych

**Audyt „czy się trzymamy".**
1. Czy opis zmiany podaje liczbę round tripów ścieżki krytycznej? → szukaj w PR/ADR/mini-design: `rg -n -i "round.?trip|budżet opóźnień|latency budget" docs`.
2. Czy niezależne `await` są zrównoleglone? → komenda waterfall wyżej.
3. Czy klient bazy/HTTP jest tworzony raz? → komenda z tabeli.
4. Czy region bazy, funkcji i użytkowników jest zapisany i uzasadniony? → `rg -n -i "region|eu-central|eu-north" README.md docs`.
5. Czy zapytanie, które to dotyka, ma plan wykonania sprawdzony na danych podobnych do produkcyjnych? → `EXPLAIN` w opisie PR.

**Nie potrzebujesz jeszcze.** HTTP/3, własnego CDN, edge compute dla danych z jednej bazy, mikrooptymalizacji poniżej ~10 ms, tuningu TCP.

---

### Domena, DNS, TLS i poczta

**Problem.** Zmiana hostingu lub domeny jest ryzykowna z powodu rzeczy, które nie są stroną: poczta (MX/SPF/DKIM/DMARC), subdomeny, certyfikaty, wygasanie domeny. Sygnały w diffie: zmiana `vercel.json`/rekordów, migracja hostingu (np. wyjście z Lovable na Vercel, opisane w ADR), nowe subdomeny per klient, nagłówek HSTS.

**Domyślnie u nas.** Proste rekordy A/CNAME u rejestratora lub w DNS Cloudflare; ISNIC dla `.is` [NIEPEWNE: gdzie realnie stoi DNS każdej domeny — sprawdź `dig NS <domena>`]; TLS automatyczny z platformy (Vercel/Supabase). Przed cutoverem: eksport pełnej listy rekordów, TTL obniżony co najmniej jeden dotychczasowy TTL wcześniej, plan cofnięcia z czasem propagacji. Szybkie przełączanie robimy na warstwie platformy, nie przez DNS (część resolwerów ignoruje TTL). HSTS z `preload` (np. w `vercel.json` workshop-app) to zgoda na wpis na listę preload: obejmuje wszystkie subdomeny i bardzo trudno go cofnąć — dopiero gdy każda subdomena obsługuje HTTPS.
**Kiedy NIE upraszczać:** domena z pocztą firmową (MX/TXT = osobna lista kontrolna), subdomeny per tenant (wildcard + automatyczne certyfikaty).

| Wariant | Koszt operacyjny | Finansowy | Poznawczy |
|---|---|---|---|
| Pojedyncze rekordy u rejestratora | minimalny | zero | niski |
| DNS w Cloudflare (proxy) | dodatkowa warstwa i jej nagłówki/cache | zero–niski | średni |
| Weighted/geo/latency DNS | pętle failoveru do utrzymania | płatne | wysoki — tylko multi-region |

**Awarie i detekcja.**
- *po zmianie hostingu zniknęła poczta* — `dig +short MX <domena>`; `dig +short TXT <domena>` (SPF); `dig +short TXT _dmarc.<domena>` — porównaj z eksportem sprzed zmiany
- *dangling CNAME na nieistniejący zasób (przejęcie subdomeny)* — `dig +short CNAME <sub>.<domena>` i sprawdź, czy cel nadal jest nasz (`curl -sI https://<sub>.<domena>`)
- *wygasający certyfikat / domena* — `echo | openssl s_client -connect <domena>:443 -servername <domena> 2>/dev/null | openssl x509 -noout -enddate`; `whois <domena> | rg -i "expir"`
- *„u mnie stare" po cutoverze* — `dig +short <domena> @1.1.1.1` vs `@8.8.8.8` vs lokalny resolver
- *HSTS preload bez przemyślenia subdomen* — `curl -sI https://<domena> | rg -i strict-transport`

**Audyt „czy się trzymamy".**
1. Czy plan cutoveru zawiera eksport rekordów i obniżenie TTL? → `rg -n -i "TTL|eksport rekord" docs/RUNBOOK.md`.
2. Czy MX/SPF/DKIM/DMARC działają po zmianie? → komendy `dig` z tabeli.
3. Czy każdy CNAME wskazuje na istniejący, nasz zasób? → `dig` + `curl -sI`.
4. Czy jest alert na wygaśnięcie certyfikatu i domeny (kto dostaje)? → `rg -n -i "cert|domena.*wygas|renew" docs/RUNBOOK.md`.
5. Czy region danych jest w README/ADR i leży w EEA? → `rg -n -i "region" README.md docs/adr`.

**Nie potrzebujesz jeszcze.** Geo/latency DNS, anycast, multi-region, własnych serwerów DNS, wildcard certów (dopóki brak subdomen per klient). Słownik wariantów LB i routingu DNS z sygnałami powrotu → 01 › Równoważenie obciążenia.

---

### Równoważenie obciążenia i routing DNS — co robi platforma

**Problem.** Kurs omawia load balancery L4/L7, algorytmy (round-robin, least connections, least response time, consistent hashing), sticky sessions, globalny LB, redundancję LB w wielu strefach oraz polityki DNS (weighted, geo, latency, failover, anycast) i DNSSEC. Na Vercelu i Supabase prawie wszystko to robi platforma. Karta służy do tego, żeby (a) nie budować tego samemu, (b) rozpoznać, kiedy klient przychodzi z własną infrastrukturą, i (c) znać sygnał, że temat wraca. Sygnały w diffie: reverse proxy (nginx/Caddy/HAProxy) z kilkoma upstreamami, `ip_hash`/sticky cookie, rekordy DNS z wagami lub health checkami, drugi region, klient z własnym serwerem lub klastrem.

**Domyślnie u nas.** Rozkład ruchu, TLS na brzegu i anycast robi sieć brzegowa Vercela; pooler i dostęp do bazy obsługuje Supabase. Aplikacja jest bezstanowa (→ 01 › Bezstanowość), więc sticky sessions i dobór algorytmu nie mają znaczenia. Własny host ma jeden reverse proxy bez równoważenia (→ 03 › Health checki). DNS: proste rekordy A/CNAME, bez polityk routingu (→ 01 › Domena, DNS). Szybkie przełączanie robimy na platformie (promote deployu, → 07 › Strategie wdrożeń), nie w DNS. Dwie pułapki warte znajomości: (1) routing geo w DNS widzi IP resolvera, nie użytkownika (publiczne resolvery, VPN, sieć firmowa), więc „najbliższy region" bywa zły; (2) DNSSEC chroni przed podmianą odpowiedzi (poisoning), ale błędna rotacja kluczy wyłącza całą domenę. Włączaj go tylko u rejestratora, który robi to automatycznie `[NIEPEWNE: obsługa DNSSEC u rejestratora domen floty, w tym ISNIC]`.
**Kiedy NIE:** własny klaster/VPS z ~≥2 instancjami aplikacji albo wymóg działania przy awarii regionu — wtedy LB i polityka DNS stają się naszą decyzją (ADR).

| Wariant | Koszt operacyjny | Finansowy | Poznawczy |
|---|---|---|---|
| LB i anycast platformy | zero | w cenie planu | zero |
| L7 proxy (Caddy/nginx) przed 1 instancją | TLS, timeouty, logi | VPS | niski |
| L4/L7 LB z ≥2 instancjami (RR / least-conn / least-RT) | health checki, redundancja samego LB | LB + instancje | średni |
| consistent hashing / sticky | rebalans przy zmianie węzłów | jak wyżej | średni–wysoki |
| DNS weighted/geo/latency/failover | health checki DNS, TTL, resolvery ignorujące TTL | płatny DNS | wysoki — tylko multi-region |
| DNSSEC | rotacja kluczy, ryzyko „domena znika" | zero | średni |

**Awarie i detekcja.**
- *sticky/stan w pamięci ukrywa się za jedną instancją* — `rg -n -i 'ip_hash|sticky|sessionAffinity|hash \$remote_addr' <konfiguracje proxy>` (pojedyncze cudzysłowy: w podwójnych `$` staje się kotwicą końca linii i wzorzec nic nie łapie); `rg -n "^(let|var) |^const \w+ = new Map\(" src/app/api` (→ 01 › Bezstanowość)
- *upstream bez health checku (ruch idzie do martwej instancji)* — `rg -n -i "upstream|health_?check|max_fails|lb_policy" <konfiguracje proxy>`
- *DNS z wagami/failoverem bez potrzeby* — `dig +short <domena>` z kilku resolverów (`@1.1.1.1`, `@8.8.8.8`) — różne odpowiedzi bez celowej polityki = do wyjaśnienia
- *DNSSEC zepsuty (domena nie rozwiązuje się na walidujących resolverach)* — `dig +dnssec <domena> @1.1.1.1 | rg -i "status|ad;"` (`SERVFAIL` = alarm); `dig DS <domena> +short`
- *otwarty własny resolver/serwer DNS (amplifikacja)* — `ss -lunp | rg ":53 " | rg -v "127\.0\.0\.5[34]|127\.0\.0\.1|\[::1\]"` (stub `systemd-resolved` na 127.0.0.53/54 jest normalny; po odfiltrowaniu pętli zwrotnej ma być pusto)

**Audyt „czy się trzymamy".**
1. Czy nie ma własnego LB ani polityk DNS bez ADR? → `rg -n -i "upstream|haproxy|weighted|failover" docs/adr <konfiguracje>`.
2. Czy aplikacja nie zależy od sticky sessions? → pierwsza komenda.
3. Czy przełączanie awaryjne jest opisane na warstwie platformy (promote), nie przez DNS? → `rg -n -i "rollback|promote|DNS" docs/RUNBOOK.md`.
4. Jeśli DNSSEC jest włączony: czy walidacja przechodzi i kto odpowiada za klucze? → komenda DNSSEC + wpis w RUNBOOK.
5. Czy żaden nasz host nie wystawia serwera DNS na świat? → komenda `ss` (po odfiltrowaniu pętli zwrotnej).

**Nie potrzebujesz jeszcze** (wariant → sygnał powrotu):
- własny LB L4/L7 i algorytmy (least-conn, least-RT) → własna aplikacja na ≥2 instancjach poza platformą (VPS/K8s klienta).
- consistent hashing → własny rozproszony cache albo sharding (→ 03 › Wąskie gardło), czyli nie przy tej skali.
- sticky sessions → nigdy dla aplikacji bezstanowej; WebSockety → pub/sub platformy (→ 04 › Real-time).
- globalny LB, DNS geo/latency/failover, anycast własny → wymóg działania przy awarii regionu (RTO w umowie ~<1 h) albo użytkownicy na wielu kontynentach z zmierzonym RTT ~>150 ms.
- redundancja LB w wielu strefach → własny LB (wyżej); platforma ma ją wbudowaną.
- DNSSEC → wymóg klienta/przetargu albo rejestrator z automatyczną obsługą przy zerowym koszcie operacyjnym.

---

### Własny host: n8n, Infisical, kontenery

**Problem.** Kilka usług działa na laptopie z Linuksem: n8n (usługa systemd użytkownika, bind na loopback), menedżer sekretów (Compose), lokalna baza deweloperska, kontenery podglądowe (konkretne porty i lista usług: `prywatne notatki floty (poza eksportem)`). Laptop jest SPOF-em: usypia się, rozładowuje, ma jeden dysk. Sygnały w diffie: nowa usługa uruchamiana przez `nohup`/ręcznie, brak unitu/Compose, port na `0.0.0.0`, brak polityki restartu, brak backupu woluminu.

**Domyślnie u nas.** Usługa = unit systemd (user) albo Compose z `restart: unless-stopped`; bind na `127.0.0.1`; dane w named volume lub katalogu objętym kopią; SIGTERM obsłużony; logi przez `journalctl`; użytkownik nie-root. Usługi użytkownika startują po restarcie bez logowania tylko przy włączonym `linger`. Nic, co obsługuje klienta 24/7, nie stoi na laptopie — produkcja klientów to platformy zarządzane (→ 07 › Platforma i ścieżka wdrożenia).
**Kiedy NIE:** usługa musi być dostępna, gdy laptop jest zamknięty (webhooki dostawców!) → hosting zarządzany albo VPS z monitoringiem.

| Wariant | Koszt operacyjny | Finansowy | Poznawczy |
|---|---|---|---|
| systemd user unit | restart policy, logi w journald, linger | zero | niski |
| Compose | wolumeny, obrazy, aktualizacje | zero | niski–średni |
| `nohup`/ręcznie | nie wstaje po restarcie, brak logów | zero | niski i zdradliwy |
| VPS (własny) | patche, backup, bezpieczeństwo na Tobie | stały miesięczny abonament | wysoki |

**Awarie i detekcja.**
- *usługa nie wstaje po restarcie* — `systemctl --user is-enabled n8n`; `loginctl show-user "$USER" -p Linger` (musi być `yes`)
- *OOM killer zabił proces bez śladu w logu aplikacji* — `journalctl -k --since -1d | rg -i "out of memory|oom"`
- *pełny dysk psuje logi, bazę i deploy* — `df -h /`; `docker system df`
- *brak polityki restartu / root w kontenerze* — `docker inspect -f '{{.Name}} {{.HostConfig.RestartPolicy.Name}} user={{.Config.User}}' $(docker ps -q)`
- *port wystawiony poza loopback* — `ss -ltnp | rg -v "127\.0\.0\.1|::1"`
- *laptop uśpiony, webhooki zgubione* — `systemctl --user status n8n`; w ustawieniach zasilania sprawdź zachowanie przy zamkniętej pokrywie

**Audyt „czy się trzymamy".**
1. Czy każda usługa ma unit/Compose z polityką restartu? → `docker ps --format '{{.Names}}'` zestawione z plikami Compose; `systemctl --user list-unit-files --state=enabled`.
2. Czy dane siedzą w named volume z kopią? → `docker volume ls`; `rg -n "volumes:" <plik compose usługi>`; ślad kopii w katalogu kopii zapasowych (ścieżki: `prywatne notatki floty (poza eksportem)`).
3. Czy usługi słuchają tylko na loopbacku/prywatnej sieci VPN? → `ss -ltnp`.
4. Czy jest check dysku i pamięci? → `df -h /; free -h`; alert/cron dopisany w `RUNBOOK`.
5. Czy tagi obrazów są przypięte (nie `latest`)? → `docker ps --format '{{.Image}}'`; `rg -n ":latest" <plik compose usługi>`.
6. Czy nic produkcyjnego dla klienta nie zależy od tego hosta? → wypisz endpointy webhooków i sprawdź, dokąd prowadzą.

**Nie potrzebujesz jeszcze.** Prometheusa/Grafany, wysokiej dostępności, orkiestratora, własnego rejestru obrazów.

---

### Dekompozycja wewnątrz monolitu

**Problem.** Po czym dzielić kod JEDNEGO deployu na moduły. `07 › Monolit modularny vs usługi` rozstrzyga, ile deployów; ta karta — gdzie stawiać granice w środku. Modułowość to właściwość (część zmienia się osobno), nie styl: mikroserwisy to modułowość z granicą sieciową, a sieć nie naprawia złych granic, tylko podnosi ich koszt (rozproszony monolit). Zła granica = change amplification: jedna zmiana biznesowa dotyka wielu katalogów, a agent musi przeczytać 15 plików zamiast jednego. Sygnały w diffie: nowy katalog w `src/`, nowa tabela, nowy dostawca (SDK), kolejny moduł wołający `.from("<cudza tabela>")`, `supabase.from(` w komponencie. Blizna (workshop-app, checkout 2026-10-05, ręczny grep po `src/`): tabelę `jobs` odpytuje 12 modułów (15 plików), klient Supabase jest importowany w 72 z 265 plików `src/`; przepinanie `has_role` → `is_org_admin` objęło ~37 polityk. Pomiar narzędziem 2026-10-17 (commit `9d9c61c`, `--report` liczy też edge functions, każda = osobny moduł): `jobs` 18 modułów (13 w `src/` + 5 edge fn) — różnica to metoda i 12 dni zmian, nie sprzeczność.

**Domyślnie u nas.** Kombinacja, nie jedna szkoła — każda ma granicę stosowalności:
1. **Szkielet = vertical slice wokół POJĘCIA BIZNESOWEGO** `src/features/<pojęcie>` (`orders`, `invoices`, `returns`, `vehicles`), nie wokół typu technicznego (`controllers/`, `services/`, `hooks/`, `helpers/`) ani ekranu: pojęcie razem ze swoimi danymi, regułami i UI; wejście dla innych modułów = `index.ts`. Podział techniczny bywa potrzebny (`components/ui` = kit bez domeny, `src/lib` = czyste funkcje, `src/integrations` = adaptery), ale sam nie daje dobrej architektury: jedna sprawa biznesowa rozsypuje się po folderach. Najbardziej naturalnie spójne moduły powstają wokół pojęć domenowych. **Test nazwy:** czy klient (mechanik, księgowa) rozpozna nazwę modułu jako coś ze swojej pracy? Nazwa = termin z `docs/GLOSSARY.md` (ubiquitous language), w kodzie po angielsku, słowa bez tłumaczenia w oryginale (`kennitala`). Pomiar: `--report` › „Moduły znające tabele" — moduł techniczny (`src/routes`, `src/hooks`, `src/lib`…) znający tabele = wiedza domenowa w warstwie.
2. **Wewnątrz slice'a — Parnas (1972):** moduł ukrywa decyzję, która prawdopodobnie się zmieni (jego „sekret"), a nie krok przetwarzania. Schemat tabeli = sekret slice'a-właściciela: zapytania do jego tabel w jednym pliku `features/<x>/api.ts`; inne slice'y wołają funkcje z jego `index.ts`, nie `.from("<tabela>")`.
3. **Dostawcy = port + adapter (hexagonal)** w `src/integrations/<dostawca>` (płatności, SMS, mail, LLM): domena zna port, nie SDK. Tu ukrywanie zwraca się najpewniej — payment-gateway vs Stripe, zmiana bramki AI to realne zmiany z historii floty.
4. **Reguły domeny** (ceny, VAT, daty, statusy) = czyste funkcje w `src/lib` (→ `pg/paradigm.md` › functional core).
5. **Rzeczy przekrojowe** (`org_id`, auth, i18n, logowanie) NIE jako moduł — nie da się ich ukryć w jednym miejscu; konwencja + bramka (RLS, trigger `%same_org%`, sql-migration-lint).
6. **Ocena granic = connascence (Page-Jones):** A i B są konascentne, gdy zmiana A wymusza zmianę B. Silna (algorytm, kolejność, wartość, czas) dozwolona tylko wewnątrz modułu; między modułami tylko słaba (nazwa, typ); im wyższy stopień (ile plików zna tę samą rzecz), tym bliżej musi leżeć. Cohesion i coupling (Constantine) to dwie strony tej miary: wysoka spójność = silna connascence w środku, niskie sprzężenie = słaba między modułami. Ukryta connascence ponad granicą języka: polityka RLS w SQL i założenia o uprawnieniach w TS — test negatywny w pgTAP, nie zaufanie. Hasło dla recenzenta: **wysoka spójność w środku + luźne powiązanie na zewnątrz**; napięcie między nimi (cięcie modułu dla mniejszego sprzężenia rozbija coś spójnego) rozstrzyga lokalność connascence, nie żaden filar osobno.
6a. **Słownik spójności (Yourdon/Constantine, 7 poziomów — porządkowa, subiektywna, więc słownik recenzji, nie bramka):** 1 przypadkowa (`utils.ts` jako worek) · 2 logiczna (łączy je tylko słowo/kategoria: globalny `validators.ts` z adresem, telefonem i kennitalą, `schemas.ts`/`constants.ts` całej apki; albo `handleAction(type)` ze `switch` po niezwiązanych akcjach — schematy zod w slice'ie obok jego danych to już poziom 5) · 3 czasowa (`onAppStart()`: Sentry + profil + migracja localStorage) · 4 proceduralna (kroki jednej procedury w jednej funkcji) · 5 komunikacyjna (operacje na tych samych danych: `features/jobs/api.ts`) · 6 sekwencyjna (wyjście kroku = wejście następnego: pipeline PDF) · 7 funkcjonalna (`calculateVatIsk`). Cel: funkcja → 7; moduł → 5 (u Myersa „informational": kilka wejść, wspólna ukryta struktura = moduł Parnasa). 1–3 = finding; rozróżnianie 4/5/6 rzadko zmienia decyzję. **Test usunięcia** (jedyny operacyjny): czy po usunięciu elementu funkcja nadal działa? Tak → element nie należy do tej jednostki (np. log transakcji przy autoryzacji płatności = wymóg audytu, przekrojowy, nie część funkcji). Spójność funkcjonalna przypadku użycia ≠ jeden plik: „autoryzuj płatność" = cienka powłoka składająca czysty rdzeń (walidacja, interpretacja odpowiedzi) z adapterem bramki (sekret: dostawca).
6b. **Skala sprzężenia (Myers/Yourdon, od najgorszego):** content (A sięga do wnętrza B: jego stanu, prywatnych pól, tabel, plików poza `index.ts` — brak kontraktu, każda zmiana wnętrza B psuje A) · common (wspólny globalny stan: store, singleton, wspólna tabela bez właściciela) · external (wspólny format/protokół narzucony z zewnątrz) · control (A przekazuje flagę sterującą logiką B: `doThing(x, mode)`) · stamp (cała struktura, gdy trzeba 2 pól) · data (tylko potrzebne wartości) = cel między modułami. **Content coupling unikamy z automatu:** `.from("<cudza tabela>")` (tabela = stan prywatny slice'a-właściciela), import pliku z wnętrza cudzego slice'a z pominięciem jego `index.ts`, mutacja cudzego stanu (store/cache innego modułu) — pre-push `SEKRET` dla tabel z `owners`, SDK i importów wnętrza slice'a, który MA `index.ts` (bez kontraktu nie ma czego obchodzić: wtedy `--report` › „Importy wnętrza cudzego slice'a … slice'y z index.ts: N/M” = zacznij od `index.ts` w slice'ach z największą liczbą importów z zewnątrz; workshop-app 2026-10-17: 269 importów, 0/37 slice'ów z kontraktem, `orders` 70). Common: przekrojowe (pkt 5) świadomie, reszta = właściciel. Connascence (pkt 6) jest dokładniejszą miarą tego samego; skala Myersa = słownik recenzji.
7. **Mapa:** `docs/ARCHITECTURE.md` › „Moduły i granice" ma kolumnę „Sekret" dla każdego modułu.
8. **Ta sama zasada na każdej skali, rosnący koszt pomyłki:** u nas funkcja → plik → slice `features/<x>` → (rzadko) bounded context → osobny deploy (edge function). Pytanie wszędzie to samo: co naprawdę należy do siebie i wspiera jeden obszar odpowiedzialności? Ale zła granica funkcji = przeniesienie w IDE, slice'a = refaktor kilku plików, deployu = migracja danych + wersjonowanie API — więc im wyższa skala, tym więcej dowodu (2. realna zmiana, ADR z obecną przyczyną) przed postawieniem granicy (→ 07 › Monolit modularny vs usługi).
9. **Bounded context (DDD strategiczne) w wersji lekkiej:** granica, w której słowo ma JEDNO znaczenie. Sygnał: to samo słowo znaczy dwie rzeczy (`jobs` = zlecenie warsztatowe vs kolejka zadań w tle; „klient" w CRM = osoba z autem, w billingu = płatnik/firma; „zamówienie" u klienta vs u dostawcy części). Reakcja przy naszej skali: (a) `docs/GLOSSARY.md` z kolumną „kontekst" — jedno słowo, dwa wiersze; (b) różne nazwy w kodzie i schemacie (`background_jobs`, `supplier_orders`), nie wspólna tabela z `type`; (c) model zewnętrzny (payment-gateway, KSeF, OEM) tłumaczony w adapterze `src/integrations/<x>` = anti-corruption layer, domena nie przejmuje jego słów ani statusów; (d) osobny deploy dopiero po 07 › Monolit modularny vs usługi. Pełna mapa kontekstów, context mapping, partnership/customer-supplier = ceremonia przy 1 zespole.

**Kiedy NIE:** prototyp/PoC (`pg.phase: prototype`), domena jeszcze nieznana (pre-PMF) — kod łatwy do usunięcia > łatwy do rozszerzenia; granica dopiero przy 2. realnej zmianie tej samej decyzji, bo przedwczesna granica betonuje zły podział. Repo Lovable (generator woła Supabase z komponentów; walka z nim przy każdej edycji w UI to koszt stały) — tylko pomiar przy decyzji o wyjściu z Lovable. Skrypt jednoplikowy. Warstwa repozytoriów nad Postgresem z RLS — nie: zabiera joiny, generowane typy i realtime; wystarczy plik zapytań per slice.

| Wariant | Koszt operacyjny | Finansowy | Poznawczy | Wygrywa → łamie się |
|---|---|---|---|---|
| warstwy techniczne (`components/`, `hooks/`, `services/`) | niski na start | zero | niski → wysoki | mały CRUD, 1 osoba → każda funkcja przecina wszystkie katalogi, jedna sprawa biznesowa rozsypana po folderach |
| krok przetwarzania (pipeline) | niski | zero | średni | ETL, n8n, importy, PDF → zmiana formatu danych rozlewa się po krokach |
| vertical slice `features/*` | niski | zero | niski | apki UI+CRUD (flota) → duplikacja między slice'ami, wspólne tabele bez właściciela |
| sekret Parnasa (moduł na decyzję) | średni: trzeba przewidzieć zmianę | zero | niski, gdy trafione | dostawcy, formaty, algorytmy → pre-PMF chowa nie tę decyzję |
| bounded context (DDD) | wysoki: mapa kontekstów, tłumaczenia między nimi | zero | wysoki | wiele poddomen, to samo słowo = różne znaczenia → mała domena = ceremonia |
| hexagonal wszędzie (port też dla bazy) | średni | zero | wysoki: pośredniość | wymienne I/O → nad Postgresem z RLS nieszczelna abstrakcja, N+1 |

**Awarie i detekcja.**
- *schemat tabeli rozsiany po modułach (connascence wysokiego stopnia)* — `node ~/.claude/bin/module-boundaries.js --repo . --report` (tabela → liczba modułów i plików, SDK poza adapterem, change amplification; `!` = tabela z właścicielem używana poza nim — wypisane moduły — albo bez właściciela w > 2 modułach). workshop-app 2026-10-17: `jobs` 18 modułów (13 w `src/`) = dług domenowy; `user_roles` 20 modułów, z czego 19 to edge functions sprawdzające rolę = rzecz przekrojowa (pkt 5) — rozwiązanie to jedna funkcja SQL/helper autoryzacji, nie właściciel-slice. W diffie te same wycieki zgłasza pre-push jako `SEKRET (ostrzeżenie)`; właściciela tabeli wpisz w `owners` bloku json `docs/ARCHITECTURE.md`. **Progi** (2 moduły na tabelę bez `owners` = właściciel + jeden czytelnik; > 3 moduły na commit = slice + migracja + trasa) są obserwacyjne: ostrzeżenie, nigdy blok; każde ostrzeżenie i pominięcie analizy trafia do `~/.claude/logs/gates.jsonl` (`hook: module-boundaries`, `would_block`/`skipped`) — z tego kalibracja progu; awans do blokady dopiero po incydencie (zasada proporcjonalności).
- *podział wg typu technicznego zamiast pojęć biznesowych* — ten sam `--report`, linia „Moduły znające tabele: N domenowych, M technicznych"; `! src/routes zna 3 tabel` = sprawa biznesowa w warstwie (workshop-app 2026-10-17: 30 slice'ów domenowych, 2 moduły techniczne z tabelami: `src/routes` → customers/jobs/part_requests, `src/lib` → push_subscriptions).
- *jedno słowo, dwa znaczenia (brak granicy kontekstu)* — `rg -n -i "^\| *(job|order|customer|client)" docs/GLOSSARY.md` + nazwy tabel z `supabase/migrations` (`rg -o "create table (public\.)?\w+" -i supabase/migrations | sort -u`): ta sama nazwa w dwóch znaczeniach = pkt 9.
- *moduł-worek (spójność przypadkowa/logiczna)* — `rg --files src | rg "(^|/)(utils|helpers|common|misc|shared|validators|schemas|constants)\.(ts|tsx)$" | rg -v "^src/features/" | xargs -r wc -l` (globalne, > ~100 linii = do przejrzenia; te same nazwy w `src/features/<x>` są OK)
- *SDK dostawcy poza adapterem* — `rg -l "from ['\"](stripe|twilio|resend|@anthropic-ai/sdk|openai)['\"/]" src supabase/functions | rg -v "integrations/"`
- *klient bazy w komponentach/trasach (wzorzec Lovable)* — `rg -l "supabase\.(from|rpc)\(" src/components src/routes src/pages`
- *import w głąb cudzego slice'a (z pominięciem `index.ts`)* — `rg -n "from ['\"]@/features/[^/'\"]+/[^'\"]+['\"]" src` → lista do przejrzenia (importy wewnątrz własnego slice'a są OK)
- *rdzeń domeny z I/O* — `rg -l "supabase|fetch\(" src/lib` (ma być pusto)
- *jedna zmiana biznesowa dotyka wielu katalogów (change amplification)* — ten sam `--report` (histogram modułów na commit z ostatnich 30 commitów z kodem; > 3 moduły = commit szeroki)
- *nowy cykl / import wbrew warstwom* — `module-boundaries.js --repo . --base origin/main` (bramka pre-push PG)

**Audyt „czy się trzymamy".**
1. Czy każdy moduł ma wpisany sekret i wejście? → `rg -n -i "sekret" docs/ARCHITECTURE.md` (brak = mapa bez kryterium podziału).
2. Ile modułów zna każdą tabelę? → `module-boundaries.js --report`; tabela w >1 module poza właścicielem = finding z planem (strangler: nowe wywołania przez `index.ts` właściciela, stare przy dotknięciu).
3. Czy SDK dostawców żyją tylko w adapterze? → komenda „SDK poza adapterem" (pusto).
4. Czy `src/lib` jest bez I/O? → komenda „rdzeń domeny z I/O" (pusto).
5. Czy większość commitów funkcjonalnych mieści się w ≤ 3 modułach? → linia „Change amplification" z `--report`.
6. Czy moduły są nazwane pojęciami biznesowymi? → `--report` › „Moduły znające tabele”: 0 technicznych; nazwy slice'ów = terminy z `docs/GLOSSARY.md`.
7. Czy rzeczy przekrojowe mają bramkę zamiast obietnicy? → `rg -n "same_org" supabase/migrations | head -3`; `ls supabase/tests 2>/dev/null`.

**Nie potrzebujesz jeszcze.** Taktycznych wzorców DDD (agregaty, warstwa repozytoriów, CQRS), interfejsu „na przyszłość" dla każdego modułu, osobnych pakietów npm per moduł (workspaces), metryk LCOM/instability jako bramek (przy kodzie funkcyjnym dają szum) — sygnał powrotu: drugi zespół albo moduł używany przez drugą aplikację.

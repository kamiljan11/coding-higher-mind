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
5. Czy dla każdej encji jest jedno źródło prawdy (brak „kopii roboczej")?

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

**Nie potrzebujesz jeszcze.** Geo/latency DNS, anycast, multi-region, własnych serwerów DNS, wildcard certów (dopóki brak subdomen per klient).

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

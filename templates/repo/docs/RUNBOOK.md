# RUNBOOK — operacje i awarie

<!-- Uzupelnij pola [..] przy wdrozeniu projektu. Ten plik czyta czlowiek o 3 w nocy — zero prozy, same komendy. -->

## Podstawy
- Produkcja: [URL]
- Hosting: [gdzie stoi + link do panelu]
- Repo: github.com/<github-owner>/[repo]
- Sekrety: menedzer sekretow (Infisical/1Password/Doppler) — NIE w repo
- Faza projektu: [prototype / poc / mvp / production / maintenance / handoff] (= `pg.phase` w CLAUDE.md)

## SLA — krytycznosc i czas reakcji (`pg.sla` w CLAUDE.md: none / internal / contract)
| SEV | Co | Reakcja | Naprawa lub obejscie | Kto dzwoni |
|---|---|---|---|---|
| SEV1 | platnosci, logowanie, utrata/wyciek danych, strona nie wstaje | [1 h od wykrycia — czas wykrycia zalezy od monitoringu nizej] | [4 h] | wlasciciel + klient natychmiast |
| SEV2 | funkcja glowna nie dziala, jest obejscie | [1 dzien roboczy] | [3 dni] | klient na weekly / mail |
| SEV3 | kosmetyka, drobiazg | backlog | nastepny release | — |
- Umowa SLA z klientem: [brak / link do umowy]; pula godzin/mies.: [n]; wycena CR w [n] dni.
- Hosting placi: [klient bezposrednio / PG refakturuje / PG (SaaS)]; koszt mies.: [kwota] (szczegoly: README "Koszty").

## Deploy
- Standard: merge do main -> [auto-deploy przez ... / komenda]
- Reczny: `npm run build` -> [gdzie wrzucic dist]
- Lovable: `git push` NIE deployuje edge fn ani nie publikuje — Publish reczny + `supabase functions deploy <fn>`

## Pipeline wdrozenia (TYLKO repo Vercel z `.github/workflows/deploy-gate.yml`; Lovable/statyczne: pomin te sekcje)
Sondy = dane w `.github/deploy/probes.json`.
Etapy: PR -> CI (`quality.yml`) -> podglad + sondy (`pg/preview`, wymagany do merge)
-> merge -> build produkcji POZA ruchem + BAKE sondami (`pg/bake`, Vercel Deployment Checks trzyma promocje) -> promocja
-> WATCH sondami -> przekroczone progi = auto-rollback + issue `deploy-gate`/`deploy-rollback` + triage Claude (subskrypcja; komentarz).
Kody sond: 0 OK · 1 przekroczone (regresja) · 2 bramka niesprawna (konfiguracja, allowlista, WAF 401/403/429) — 2 NIGDY nie cofa
produkcji; w BAKE daje status `error`, wiec Vercel nie promuje (fail-closed). Skrypt i `probes.json` zawsze z galezi domyslnej.
Setup jednorazowy (bez niego bramki sa SKIPPED albo tylko alarmuja — sprawdz checklista):
- [ ] Vercel › Settings › Build and Deployment › Deployment Checks: Add Checks -> GitHub -> `pg/bake`; Environments › Production: auto-przypisanie domen WLACZONE.
- [ ] Vercel › Deployment Protection › Protection Bypass for Automation: sekret -> GitHub secret `VERCEL_AUTOMATION_BYPASS_SECRET` (redeploy po zmianie).
- [ ] GitHub › Settings › Environments › `deploy-gate`: Deployment branches = TYLKO galaz domyslna. Sekrety `VERCEL_TOKEN` (z menedzer sekretow (np. Infisical CLI),
      nigdy wklejany) i `VERCEL_AUTOMATION_BYPASS_SECRET` jako sekrety TEGO environment, nie repo — workflow_dispatch z innej galezi ich nie dostanie.
      Uwaga: token Vercela jest zespolowy (dostep do wszystkich projektow zespolu) — trzymaj go tylko w tym environment.
- [ ] Token `CLAUDE_CODE_OAUTH_TOKEN` dla triage (opcjonalnie; bez niego job pominiety). Uczciwie: jesli repo ma go juz jako sekret REPO
      (wymaga go pg-review.yml), jest dostepny workflow z kazdej galezi — kazdy writer moze go wyciagnac; Environment tego nie zmienia.
      W repo z zewnetrznymi writerami: bez sekretu repo (pg-review w CI wylaczony), token tylko w Environment `deploy-gate`.
      Triage biegnie tylko przy prawdziwej regresji i nowym issue; pliki .claude/, CLAUDE.md, .mcp.json z repo sa usuwane przed agentem.
- [ ] GitHub variables: `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` (z `.vercel/project.json`), `PROD_URL` (KANONICZNA domena produkcji, bez przekierowania apex->www).
      Bez nich BAKE/PREVIEW nie wysla naglowka bypass (weryfikacja, ze URL to wdrozenie TEGO projektu, przez API Vercela).
- [ ] `.github/deploy/probes.json`: `allowedHosts` = `<projekt>-*-<zespol>.vercel.app` + domena produkcji; sondy = sciezki z CRITICAL-PATHS bez logowania; `/api/health` z zapytaniem do bazy.
- [ ] `/api/health` (wzor Next.js, `app/api/health/route.ts`): PO STRONIE SERWERA `select 1` (RPC/polaczenie serwerowe — NIE klient anon na tabeli
      z RLS: pusty wynik bez bledu dalby db:ok przy awarii) z timeoutem; handler SPRAWDZA wartosc (`data === 1`), nie tylko brak bledu
      (RPC bez wyniku daje data=null bez bledu); funkcja RPC: `security invoker`, `set search_path = ''`, `revoke execute ... from public, anon`.
      Odpowiedz `{"ok":true,"db":"ok"}` albo 503 `{"ok":false,"db":"down"}`;
      bez danych i sekretow w odpowiedzi; krotki cache `Cache-Control: s-maxage=5` (zalew endpointu nie wyczerpie puli polaczen bazy).
      Sonda sprawdza pola JSON, nie podciag, i jest `dependency: true` — awaria bazy = alarm, nie rollback aplikacji.
- [ ] Branch protection: wymagany status `pg/preview` (obok CI). UWAGA: `mas_branch_protect.py` / `mas_branch_protection.py` robia PUT z pelna lista
      i ZDEJMUJA `pg/preview` — po ich uzyciu dodaj go ponownie. Chroniony podglad (401) daje zielone `pg/preview` bez sond (opis statusu to mowi).
      Sprawdz liste wymaganych statusow: `gh api repos/<o>/<r>/branches/main/protection --jq '.required_status_checks.contexts'`.
- Playwright na podgladzie: NIE w deploy-gate (kod PR w kontekscie galezi domyslnej = ryzyko zatrucia cache). E2E smoke biegnie w `quality.yml` (pull_request).
- [ ] Domena za Cloudflare/WAF: przepusc User-Agent `pg-deploy-probe` albo IP runnerow GitHuba; inaczej 403/429 = bramka niesprawna (bez rollbacku, ale BAKE stoi).
- [ ] NAJPIERW projekt staging, dopiero potem produkcja (bramka nieprzecwiczona moze zatrzymac kazdy deploy).
- [ ] Drill BAKE pozytywny (staging): zwykly merge -> Vercel › Deployment pokazuje check `pg/bake` -> zielony -> domena przypieta w < BAKE_MINUTES+5 min.
      Jesli Deployment Checks NIE widzi statusu `pg/bake` (nie da sie go wybrac) — bramki nie wlaczaj; zglos (ADR-0004 › Otwarte). Data: ____
- [ ] Drill BAKE negatywny (staging): w `probes.json` sonda na nieistniejaca sciezke -> merge -> build NIE dostaje domeny -> issue. Data: ____
- [ ] Drill WATCH (raz, staging): wdroz commit, ktory celowo psuje sciezke z sond (np. /api/health zwraca 503 w aplikacji, nie w bazie),
      -> BAKE sie nie zgodzi; na stagingu Force Promote -> WATCH -> rollback do ostatniego zielonego BAKE -> cofnij commit, promote, zamknij issue
      `deploy-rollback`. Albo: `gh workflow run deploy-gate.yml -f stage=watch -f sha=<sha ZYWEGO buildu>` przy celowo zepsutej produkcji staging.
      Sprawdz przy okazji, ze LIVE_SHA rozpoznaje WLASNA domene (inaczej decyzja `norange`). Data: ____
- Hotfix przy czerwonym BAKE, ktorego nie da sie szybko naprawic: Vercel › Deployment › **Force Promote** (swiadome obejscie, wpis w issue).
- WYLACZNIKI (GitHub › Settings › Variables, bez zmiany kodu): `PG_DEPLOY_GATE=off` = bramka przepuszcza (PREVIEW/BAKE success z opisem,
  WATCH i deadman pominiete); `PG_AUTO_ROLLBACK=off` = WATCH tylko alarmuje, bez rollbacku. Usun zmienna, zeby wlaczyc z powrotem.
- Deadman (co 3 h): produkcyjny build bez koncowego `pg/bake` po >30 min -> issue „BAKE bez statusu". Ponowienie BAKE recznie:
  `gh workflow run deploy-gate.yml -f stage=bake -f url=<url-wdrozenia z Vercel › Deployments> -f sha=<pelny sha tego wdrozenia>`
  (url i sha MUSZA byc z tego samego wdrozenia — inaczej weryfikacja przez API odmowi). Ostatecznosc: Force Promote + wpis w issue.
- Powiadomienia: issue `deploy-gate` dociera e-mailem tylko do obserwujacych repo — wlasciciel MUSI obserwowac repo (Watch › All activity
  albo Custom › Issues). Po 15 min WATCH produkcji pilnuje Sentry/uptime, nie ta bramka.
- Koszt: ~10 min BAKE + ~15 min WATCH na deploy produkcji (runner czeka); przy limicie minut planu GitHub skroc BAKE_MINUTES/WATCH_MINUTES w workflow.

## Rollback (cel: <5 min)
- Bez deploy-gate (Lovable, statyczne): rollback = `git revert` + push albo poprzednia wersja w panelu hostingu.
- Automatyczny (deploy-gate): WATCH przekroczony (exit 1) -> REST rollback do OSTATNIEGO buildu z zielonym `pg/bake` i bez `pg/watch=failure`
  (moze byc kilka wersji wstecz — sprawdz w issue i w Vercel › Deployments, na czym stoi produkcja) + issue z etykieta `deploy-rollback`. Vercel WYLACZA
  auto-przypisanie domen: kolejne merge nie wejda na produkcje, dopoki czlowiek po naprawie nie zrobi `vercel promote <url-wdrozenia>`.
  Bezpiecznik: dopoki issue `deploy-rollback` jest otwarte, kolejny auto-rollback NIE nastapi (tylko alarm) — zamknij je po promote.
- Auto-rollback WSTRZYMANY (tylko issue), gdy zakres wdrozenia od poprzedniej produkcji dotyka `supabase/migrations` itp. albo zakresu nie da sie ustalic.
- NIE cofane przez rollback: migracje i dane bazy, zmienne ustawione w panelu po wdrozeniu, stan zewnetrznych uslug.
- Reczny: panel Vercel › Deployments › Instant Rollback (Pro: dowolne wczesniejsze wdrozenie). PRZED nim sprawdz migracje miedzy celem
  a biezaca wersja: `git -c core.quotePath=false diff --name-only <sha-celu> <sha-biezacy> | grep -Ei '(^|/)(migrations?|drizzle|db/migrate)/|\.sql$|schema\.prisma$'`
  — wynik niepusty = stary kod na nowym schemacie; rollback do N-2 i starszych moze czytac usuniete kolumny.
- BAZA: rollback Vercela NIE cofa migracji. Zasada expand/contract: schemat zgodny wstecz z POPRZEDNIA wersja aplikacji, bo w oknie
  BAKE (>= 10 min) i po rollbacku stary kod dziala na nowym schemacie:
  - nowa kolumna NOT NULL = z DEFAULT albo w 2 krokach (nullable + backfill -> NOT NULL w nastepnym wydaniu);
  - zmiana nazwy = expand (nowa kolumna + zapis do obu) -> backfill -> przelaczenie odczytu -> contract (usuniecie starej) dopiero po pelnym WATCH;
  - DROP/RENAME/SET NOT NULL istniejacego obiektu = osobny PR po pelnym WATCH. Bramka: `sql-migration-lint` R14 (HIGH — pre-commit blokuje
    stagowana migracje) i R7 (ADD COLUMN NOT NULL bez DEFAULT, HIGH; serial/identity maja DEFAULT niejawny); obie pomijaja tabele utworzone WYZEJ
    w tym samym pliku zwyklym `create table` (`create table if not exists` nie zwalnia — tabela mogla powstac w panelu). Swiadomy krok
    contract: komentarz `-- pg:contract <powod>` w NAGLOWKU pliku migracji (przed pierwsza instrukcja; wzmianka nizej nie dziala). R14 lapie tez:
    zmiane typu kolumny, SET SCHEMA, DROP DEFAULT, DROP constraintu `*_key`/`*_pkey`/`*_uq`/`*uniq*` (stary upsert onConflict; inna nazwa = sprawdz recznie), DDL w blokach `do $$`,
    DROP/RENAME/SET SCHEMA funkcji (RPC), widokow, typow i schematow w `public` (DROP+CREATE funkcji z innymi typami argumentow = nowa
    sygnatura RPC); SET NOT NULL flagowany takze z backfillem, bo stary kod moze wstawiac NULL. Poza zasiegiem: dynamiczny SQL
    (`execute '...'`), ADD CONSTRAINT (CHECK/FK) — sprawdz recznie, czy stary kod go nie lamie.
  - Recenzja PR: `sql-migration-lint --strict --since origin/main` = tylko migracje z PR (historyczne nie blokuja). Brak `origin/main`
    (repo bez remote, galaz master) -> podaj galaz bazowa (`--since main`/`--since master`); zly ref = exit 2, nie cichy sukces.
  - Kolejnosc: migracja EXPAND przed mergem zmiany kodu (BAKE widzi nowy schemat); CONTRACT dopiero po pelnym WATCH nastepnego wydania.
- Migracje stosowane POZA repo (SQL z panelu, reczne `psql` bez pliku w diffie): bramka ich nie widzi -> ustaw `PG_AUTO_ROLLBACK=off`.
```bash
git revert <sha-zlego-commita> && git push   # naprawa do przodu (po rollbacku: potem vercel promote)
```

## Backup i restore (backup nieodtworzony probnie NIE jest backupem)
- Plan: [Supabase Pro daily / PITR 7 dni / `pg_dump` cron -> R2/S3 / BRAK (= decyzja, nie przeoczenie)]
- Gdzie leza kopie: [lokalizacja + retencja]
- Restore (komenda, przecwiczona): `python ~/.claude/bin/backup-drill.py --source-env [NAZWA_SEKRETU_DB_URL] --target-url postgres://localhost:5432/drill --tables customers,jobs,invoices`
- **Ostatni test restore: [RRRR-MM-DD] — wynik: [n tabel, n wierszy zgodnych]** (kwartalnie; brak daty = brak backupu)

## Monitoring
- Bledy runtime: Sentry [link do projektu] — alerty ida na you@example.com
- Healthcheck: [URL/status] — sprawdz najpierw to
- CI: zakladka Actions w repo (Quality Gate musi byc zielony)

## Zaleznosci zewnetrzne (co sie psuje, gdy dostawca padnie)
<!-- Czyta to karta sd/05-niezawodnosc.md (zaleznosci i tryby awarii). Pusty wiersz "[np. ...]" = sekcja niewypelniona. Wiersz na kazda usluge spoza repo (baza, auth, platnosci, mail, SMS, LLM, storage). -->
| Dostawca | Co przestaje dzialac | Co widzi uzytkownik | Wylacznik / tryb awaryjny | Status / kontakt |
|---|---|---|---|---|
| [np. Supabase] | | | | |
| [np. LLM — Anthropic] | | | | |

## Typowe awarie
| Objaw | Pierwszy krok |
|---|---|
| Strona nie wstaje po deploy | rollback (wyzej), potem debug na branchu |
| Blad 500 na akcji X | Sentry -> stack trace -> `systematic-debugging` |
| Wygasly sekret/API key | Infisical -> zrotuj -> redeploy |
| CI „Gitleaks" czerwone | Skan obejmuje commity PR / pusha. 1) Prawdziwy sekret -> NAJPIERW zrotuj w Infisical + redeploy; potem do `.gitleaksignore` linia `plik:RuleID:linia` (z logu CI, BEZ SHA commita — squash-merge zmienia SHA) z komentarzem `# zrotowany RRRR-MM-DD`; NIGDY wartosci sekretu w komentarzu. Historii nie przepisujemy (force-push zablokowany). 2) Sztuczny klucz w fiksturze -> `gitleaks:allow` na koncu TEJ linii. 3) Timeout 10 min -> repo z ogromnym PR; podziel PR. Zmiana `.gitleaksignore` = merge tylko za fraza uzytkownika (pg-merge-bezpieczny). |
| Domena/DNS | panel rejestratora (tabela "Dostepy" ponizej) — UWAGA: rekordy NS/MX moga trzymac poczte (blizna LOVABLE-DNS-TRACE-IS-LIVE-MAIL) |
| "U mnie widac stare dane" | cache: CDN/Vercel (`purge`), React Query (`invalidateQueries`), DNS resolver (sprawdz z innego resolvera / incognito) |

## Dostepy i wlasciciele kont (handoff = kod + DOSTEPY + docs)
| Zasob | Gdzie (panel) | Wlasciciel konta | Kto ma dostep | Jak przekazac |
|---|---|---|---|---|
| Domena | [rejestrator: ISNIC / ...] | [klient / PG] | | transfer: [mozliwy? ten sam rejestrator = nie] |
| DNS | [Cloudflare / rejestrator / Lovable] | | | eksport strefy |
| Hosting | [Vercel team / Lovable projekt] | | | transfer projektu |
| Baza | [Supabase org / projekt ref] | | | transfer org (Pro) / dump |
| Poczta transakcyjna | [Resend domena] | | | weryfikacja DNS u nowego |
| Platnosci | [payment-gateway / Stripe konto] | | | konto klienta od poczatku |
| Analityka / FB / Google | [GA4, GBP, FB Page] | | | |
| Sekrety | menedzer sekretow (Infisical/1Password/Doppler) -> [prefix] | uzytkownik | | eksport do vaulta klienta |

## Kontakty
- Wlasciciel: <owner>, you@example.com
- Klient: [imie, kontakt, SLA jesli jest]

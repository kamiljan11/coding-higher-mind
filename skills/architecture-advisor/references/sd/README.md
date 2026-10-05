# System design w PG — operacyjna wiedza inżynierska (indeks po problemach)

Baza kart decyzyjnych dla agentów PG: jak PROJEKTOWAĆ nowe rzeczy, jak AUDYTOWAĆ istniejące repo („czy dobrze się trzymamy") i jak RECENZOWAĆ diff. Zakres: stack floty zweryfikowany w `../owner-stack.md`, skala 1–10 tys. użytkowników, jeden–dwóch maintainerów.
Zasada przewodnia (z `SKILL.md`): burden of proof leży po stronie złożoności. Dla naszej skali domyślna odpowiedź to „nie potrzebujesz jeszcze" — i jest to ZAPISANA decyzja z sygnałem powrotu, nie luka.

## Format karty (każda karta, ta sama kolejność)
1. **Problem** — kiedy karta ma znaczenie i jakie sygnały w kodzie/diffie ją uruchamiają.
2. **Domyślnie u nas** + **kiedy NIE** (progi przejścia, liczby jako reguły kciuka).
3. **Warianty i koszt** — tabela: operacyjny / finansowy / poznawczy.
4. **Awarie i detekcja** — tryb awarii → konkretna komenda (`rg`, SQL, `curl`, `docker`, `gh`).
5. **Audyt „czy się trzymamy"** — 3–8 pytań, każde z komendą weryfikującą.
6. **Nie potrzebujesz jeszcze** — kiedy odpuścić.

## Konwencje
- `~` przed liczbą = reguła kciuka do zmierzenia u siebie, nie benchmark ani gwarancja dostawcy.
- `[NIEPEWNE: …]` = fakt zależny od planu, wersji lub dostawcy, którego nie sprawdzono u źródła — zweryfikuj przed cytowaniem (limity Supabase/Vercel/n8n, ceny, szczegóły funkcji platform).
- Odsyłacz `NN › Karta` = karta w pliku `0N-*.md` (np. `05 › Idempotentność i deduplikacja`); `catalog X.Y` = `../tradeoff-catalog.md`; `PRR Pn` = `~/.claude/pg/prr.md`; `cases.md ID` = blizna floty w `~/.claude/pg/cases.md`.
- Komendy zakładają typową strukturę: `src/`, `supabase/migrations/`, `supabase/functions/`, `docs/`; w repo Payload: `src/collections/`, `src/migrations/`. Dostosuj ścieżki do repo. Placeholdery w `<…>` podmień.
- SQL: tylko odczyt; uruchamiaj na bazie PRODUKCYJNEJ (ACL-e i polityki różnią się od lokalnych — `cases.md` ACL-NULL-TOO-NARROW). Przykład: `psql "$DB_URL" -c "<zapytanie>"` (URL przez menedzer sekretow (np. Infisical CLI), nigdy wklejony na czat).
- Rg: `rg -n "a|b"` (alternatywa bez ukośnika); wyniki to LISTA DO PRZEJRZENIA, nie wyrok — heurystyki dają fałszywe trafienia.

## Indeks po problemach

| Problem | Karta |
|---|---|
| Gdzie trzymać stan, czemu wyniki się różnią między wywołaniami | `01 › Bezstanowość i źródło prawdy` |
| Wolno, ale nie wiadomo czemu; ile zapytań na widok; region bazy | `01 › Round tripy i budżet opóźnień`, `03 › Zapytania i indeksy`, `capacity.md` |
| Zmiana hostingu/domeny, poczta po migracji, certyfikaty | `01 › Domena, DNS, TLS i poczta` |
| Usługa na laptopie (n8n, Infisical, kontenery) | `01 › Własny host`, `07 › Kontenery i orkiestracja` |
| Czy dodać Redis/Pinecone/Elastic/inny magazyn | `02 › Wybór magazynu danych` |
| Nowa tabela, migracja, constrainty, statusy | `02 › Model danych, constrainty i migracje` |
| Kwoty, VAT, daty, strefy PL/IS | `02 › Pieniądze, czas i jednostki` |
| Kto widzi czyje dane (org, RLS, service_role) | `02 › Multi-tenancy w danych`, `05 › Tożsamość i autoryzacja` |
| Dane z cache/ISR/repliki bywają stare; „zapisałem, nie widzę" | `02 › Spójność per przepływ`, `02 › Cache i inwalidacja` |
| Zdjęcia/pliki/załączniki | `02 › Pliki i object storage` |
| Typ ID, numeracja dokumentów, enumeracja po ID | `02 › Identyfikatory` |
| „Czy to uniesie?", limity połączeń, plan bazy | `03 › Wąskie gardło i skalowanie`, `capacity.md` |
| Nagłówki cache, CDN, bezpieczeństwo nagłówków | `03 › CDN, nagłówki i brzeg` |
| Bot/spam/rachunek za LLM-SMS-mail, logowanie | `03 › Rate limiting i budżety kosztu` |
| `/health`, monitoring dostępności, własny proxy | `03 › Health checki i równoważenie` |
| Nowy endpoint, kształt błędu, paginacja, wersje | `04 › Kontrakt API i granice` |
| Wolny/zawodny krok (mail, PDF, LLM, import) | `04 › Zadania w tle i kolejki` |
| payment-gateway/Twilio/Resend wołają nas; my wołamy partnerów | `04 › Webhooki przychodzące i wychodzące`, `05 › Idempotentność` |
| „Na żywo" bez odświeżania | `04 › Real-time` |
| Historia zmian, audit log, liczniki, raporty | `04 › Zdarzenia, dzienniki i raporty` |
| Workflow n8n rośnie, logika w węzłach | `04 › Orkiestracja n8n i automatyzacje` |
| Duplikaty płatności/maili/zamówień | `05 › Idempotentność i deduplikacja` |
| Nadsprzedaż, podwójna rezerwacja, cron odpalony 2× | `05 › Współbieżność i wyścigi` |
| Zewnętrzne API się zawiesza; retry; wyłącznik | `05 › Zależności zewnętrzne` |
| „Nie wiedzieliśmy, że padło" | `05 › Obserwowalność i alerty` |
| Kopie, restore, RPO/RTO, pliki bez kopii | `05 › Kopie zapasowe i odtwarzanie` |
| Dane osobowe, kennitala, retencja, dane do LLM | `05 › Dane osobowe, retencja i prywatność` |
| Wyszukiwarka (części, klienci, tekst, semantyka) | `06 › Wyszukiwanie` |
| „Najbliższy punkt", strefy, pozycje | `06 › Geo` |
| Długie listy, „N nowych", sortowanie | `06 › Listy, feed i paginacja` |
| Mail/SMS/push, preferencje, opt-out | `06 › Powiadomienia` |
| Czat/asystent/RAG, koszt i bezpieczeństwo LLM | `06 › Funkcje AI: LLM, embeddingi, RAG` |
| Faktury, umowy, numeracja, PDF, KSeF | `06 › Dokumenty, faktury i numeracja` |
| Podział na usługi/repo/funkcje | `07 › Monolit modularny vs usługi` |
| „Co robi push", hosting, edge functions, Lovable | `07 › Platforma i ścieżka wdrożenia` |
| CI zielone, ale nic nie testuje; rollback; wydania | `07 › CI/CD i wydania` |
| Środowiska, sekrety, flagi testowe | `07 › Środowiska, konfiguracja i sekrety` |
| Rachunek rośnie, lock-in, region | `07 › Koszt, uzależnienie od dostawcy i region` |

## Jak używać — trzy tryby

### 1. Projekt nowej rzeczy (SELECT / Dzień 0)
Kolejność: (1) `capacity.md` §2–3 — policz, co naprawdę boli (zwykle pliki, region, indeksy, nie QPS); (2) karty drzwi jednokierunkowych: `02 › Model danych`, `02 › Identyfikatory`, `02 › Multi-tenancy`, `05 › Tożsamość i autoryzacja`, `02 › Pieniądze, czas`; (3) karty infrastruktury: `07 › Platforma`, `07 › Środowiska`, `07 › Koszt, uzależnienie od dostawcy i region`, `05 › Kopie zapasowe`, `05 › Obserwowalność` (Sentry od dnia 0), `07 › CI/CD` (pipeline przed feature'ami); (4) dla każdej cechy produktu karta z `06`/`04`. Wynik: mini-design (`pg/design.md` B i B+) z tabelą spójności per przepływ, budżetem opóźnień i listą „nie potrzebujemy jeszcze" z sygnałami powrotu; ADR przy decyzjach jednokierunkowych.

### 2. Audyt istniejącego repo (AUDIT)
1. Zbierz fakty: `package.json`, `vercel.json`, `supabase/config.toml`, `docs/ARCHITECTURE.md`, `docs/RUNBOOK.md`; zweryfikuj z kodem (docs mogą być przeterminowane).
2. Przejdź sekcje „Audyt" kart w kolejności ROI (tam bolą pieniądze i dane): `05 › Idempotentność`, `05 › Współbieżność`, `05 › Tożsamość i autoryzacja` + `02 › Multi-tenancy` (zapytania SQL do bazy produkcyjnej), `05 › Zależności zewnętrzne`, `05 › Obserwowalność`, `05 › Kopie zapasowe`, `07 › Platforma`, `07 › Środowiska`; dalej według sygnałów (`03 › Zapytania`, `02 › Pieniądze`, `04 › Webhooki`).
3. Każde trafienie = finding z komendą i dowodem; „leave it" jest równorzędnym wynikiem (nadmiarowa maszyneria: kolejka bez drugiego konsumenta, cache nad niezmierzonym zapytaniem, dodatkowy magazyn bez ADR).
4. Zasada zakresu: audyt to raport; dług historyczny naprawiamy tylko na prośbę uzytkownika.

### 3. Recenzja diffu (REVIEW)
`review-checklists.md` — sekcja działu (code / data / ops / security / product); sprawdzasz TYLKO punkty, których diff dotyka; każdy finding ma komendę i dowód, inaczej odpada przy agregacji (`pg-aggregate`).

## Jak używają tego skille i działy PG
- **`architecture-advisor`** (decyzje): w SELECT/EVOLVE po `tradeoff-catalog` czyta „Domyślnie u nas" i „Nie potrzebujesz jeszcze" karty komponentu; w AUDIT uruchamia „Audyt"; „Awarie i detekcja" zasila sekcję „breaks when" w ADR.
- **`pg-council`** (narada): karty są wspólną pulą faktów — dział podaje wynik komendy z audytu, nie opinię; catfish używa „Awarie i detekcja" do kontrargumentu.
- **Działy `code/data/ops/security/product-reviewer`**: sekcja w `review-checklists.md` uzupełnia rubrykę z `agents/<rola>.md`.
- **`diagrams`**: „Domyślnie u nas" kart `01 › Bezstanowość`, `04 › Zadania w tle`, `05 › Idempotentność`, `06 › Powiadomienia` opisuje szkielety do narysowania (klient → funkcje bezstanowe → Postgres; tabela `jobs` + worker; webhook → `processed_events` → efekt; zdarzenie → outbox → kanały).
- **`pg/design.md`**: sekcja B+ odsyła do `capacity.md` oraz kart `02 › Spójność per przepływ`, `05 › Zależności zewnętrzne`, `05 › Idempotentność`, `05 › Współbieżność`.

## Mapa do `tradeoff-catalog.md` (czego nie dublujemy)
| Karta | Katalog |
|---|---|
| `04 › Zadania w tle`, `04 › Webhooki` | 1.2, 2.6 |
| `02 › Cache`, `03 › CDN` | 1.3 |
| `02 › Wybór magazynu`, `06 › Wyszukiwanie`, `06 › Funkcje AI` | 1.6, 2.3 |
| `04 › Zdarzenia, dzienniki i raporty` (raporty bez CQRS) | 1.4, 1.5 |
| `05 › Tożsamość i autoryzacja` | 1.7 |
| `07 › Monolit modularny vs usługi` | 1.1 |
| `07 › Kontenery`, `07 › Platforma` | 1.8, 1.10, 3.4 |
| `04 › Orkiestracja n8n` | 2.1, 2.2 |

## Status i granice
- VERIFIED: stack floty (5 repo: `package.json`, `vercel.json`, ADR/ARCHITECTURE na gałęzi domyślnej, lokalny `shop-app`, schemat lokalnego Postgresa 17 shop-app); zapytania SQL z kart wykonane na katalogach PG 17 bez błędów składni (zapytania do `storage.*`, `cron.*`, `pg_stat_statements`, roli `anon` i PostGIS/pgvector wymagają projektu Supabase — niewykonane lokalnie); składnia komend `rg` sprawdzona na lokalnym repo.
- UNVERIFIED: każde `[NIEPEWNE]` (limity planów, ceny, zachowanie funkcji platform, status Vercel dla shop-app/kamiljan.com po stronie panelu, stan kodu `support-chat` w marketplace-app); komendy dotykające `psql "$DB_URL"`/`supabase`/`gh api` — poza składnią nie uruchamiane na produkcji.
- Karty to heurystyki decyzyjne, nie przepisy: ustępują ADR-owi repo, jeśli ADR nazywa obecną przyczynę.

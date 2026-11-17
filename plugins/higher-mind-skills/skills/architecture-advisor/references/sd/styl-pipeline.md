# Styl: pipeline (pipes & filters) — karta głęboka

Źródła (research 2026-11-07, parafraza; rozdział książki niedostępny, 403): Richards/Ford „Fundamentals of Software Architecture” (pipeline) przez notatki [archman.dev](https://archman.dev/docs/architectural-styles/pipes-and-filters-pipeline), [thirstyexplorer](https://thirstyexplorer.substack.com/p/understanding-pipeline-architecture), [derekw](https://derekw.vercel.app/posts/architecture-pipeline), [bagerbach](https://bagerbach.com/books/fundamentals-of-software-architecture/); Microsoft Azure Architecture Center: [Pipes and Filters](https://learn.microsoft.com/en-us/azure/architecture/patterns/pipes-and-filters), [Competing Consumers](https://learn.microsoft.com/en-us/azure/architecture/patterns/competing-consumers), [Queue-Based Load Leveling](https://learn.microsoft.com/en-us/azure/architecture/patterns/queue-based-load-leveling), [Claim Check](https://learn.microsoft.com/en-us/azure/architecture/patterns/claim-check), [Idempotent Consumer](https://learn.microsoft.com/en-us/azure/architecture/patterns/idempotent-consumer); Hohpe „Enterprise Integration Patterns” ([Pipes and Filters](https://www.enterpriseintegrationpatterns.com/patterns/messaging/PipesAndFilters.html), [Dead Letter Channel](https://www.enterpriseintegrationpatterns.com/patterns/messaging/DeadLetterChannel.html)); n8n docs ([error handling](https://docs.n8n.io/flow-logic/error-handling/), [executions env](https://docs.n8n.io/hosting/configuration/environment-variables/executions/), [memory](https://docs.n8n.io/hosting/scaling/memory-errors/), [concurrency](https://docs.n8n.io/hosting/scaling/concurrency-control/), [zmienne wykonań](https://docs.n8n.io/hosting/configuration/environment-variables/executions/)); limity platform: [Supabase](https://supabase.com/docs/guides/functions/limits), [Vercel](https://vercel.com/docs/functions/limitations). Oznaczenia: **[P]** = ≥ 2 niezależne źródła, **[1]** = jedno źródło, `[własny]` = nasz wniosek bez źródła. Kurs DevSteer: tylko macierz (lekcja 19, nasza ocena).

## 1. Definicja i topologia
- **Filtry** (kroki z jedną odpowiedzialnością) połączone **rurami** (pipes), które tylko przekazują dane dalej: jednokierunkowo, zwykle punkt-punkt [P]. Rura nie robi routingu ani logiki [1, Azure].
- 4 typy filtrów (Richards/Ford) [P]: **producer** (źródło, tylko wyjście), **transformer** (zmienia dane), **tester** (sprawdza kryterium, opcjonalnie przepuszcza dalej), **consumer** (ujście: zapis, wysyłka, widok).
- Filtry są niezależne i zwykle bezstanowe; znają tylko schemat wejścia i wyjścia, więc kolejność da się zmieniać, gdy schematy pasują [1, Azure]. Zmiana przepływu = przepięcie rur, nie przepisanie filtrów [1, EIP].
- **Kwant = 1** (zwykle wdrażany razem) [P, źródła wtórne]. Zmiana jednego kroku wymaga testu całego łańcucha, a awaria kroku zwykle zatrzymuje pipeline [1, Azure]. Napięcie: ten sam artykuł Azure mówi, że przy kolejkach między krokami filtry da się wdrażać i skalować osobno [1, Azure]. U nas wspólna baza i jeden potok wdrożeń = nadal 1 kwant `[własny, reguła kwantu z 07]`.
- **U nas** `[własny]`: rura = tabela `background_jobs` (albo `pgmq`), filtr = edge function / worker / węzeł n8n wołający endpoint w repo, producer = webhook, formularz albo cron, consumer = zapis w Postgresie, mail, SMS, PDF. Endpoint wołany przez n8n jest uwierzytelniony (sekret współdzielony lub HMAC + znacznik czasu, `05 › Uwierzytelnianie integracji`) i działa tylko w zakresie `org_id` zadania. n8n chodzi na laptopie, więc żaden kliencki krok produkcyjny nie może od niego zależeć (`04 › Orkiestracja n8n i automatyzacje`).

## 2. Warianty
| Wariant | Co daje | Co kosztuje |
|---|---|---|
| **wsadowy** (CSV, raport nocny, ETL) | prosty, łatwy restart od paczki | opóźnienie do końca paczki |
| **strumieniowy** (filtr emituje przed końcem wejścia) [1, Azure] | kroki równolegle, niższa latencja | trudniejszy restart i kolejność |
| **liniowy** | czytelny, łatwy test | — |
| **z rozgałęzieniami** (warunki, wiele wyjść) [1, archman] | elastyczność | to już workflow, nie pipeline; styl słabo pasuje |
| rura w procesie (funkcje po kolei) vs rura = kolejka [1, Azure] | w procesie: zero infrastruktury | kolejka: retry, skalowanie per krok, widoczny stan |
| wielu konsumentów jednej kolejki (competing consumers) [1, Azure] | przepustowość, odporność | kolejność odbioru **nie jest gwarantowana** [P] |

## 3. Kiedy TAK / kiedy NIE
**TAK:**
- przetwarzanie rozkłada się na **niezależne kroki**, które mają różne wymagania skalowania, trzeba je przestawiać lub dodawać albo chcesz ograniczyć skutki awarii kroku [1, Azure];
- liniowy przepływ danych: logi, zdarzenia, pliki, ETL [1, archman];
- sporadyczne piki ruchu, które trzeba oddzielić od przepustowości (kolejka wyrównuje obciążenie) [1, Azure];
- **u nas:** automatyzacje n8n, import CSV, generowanie PDF/LLM/wideo, synchronizacje z API dostawców `[własny]`.
**NIE:**
- użytkownik czeka na wynik w ramach żądania (request-response) [1, Azure];
- kroki muszą być w **jednej transakcji** albo są od siebie mocno zależne [1, Azure];
- ścisła kolejność bez kluczy sekwencji [1, Azure];
- dużo rozgałęzień, warunków, przepływ dwukierunkowy [1, archman];
- przewidywalnie niski, stały wolumen: kolejka to zbędna złożoność [1, Azure].
**Twarde limity kroku:** każdy filtr musi zmieścić się w limicie platformy: Supabase Edge 150 s / 400 s wall clock i 2 s CPU, Vercel 300 s / 800 s, n8n `EXECUTIONS_TIMEOUT` domyślnie wyłączony, `EXECUTIONS_TIMEOUT_MAX` 3600 s [1 każde, docs dostawców] (`04 › Zadania w tle i kolejki` › Twarde limity platform).

## 4. U nas (Supabase + Vercel + n8n) `[własny]`
| Pojęcie | Odpowiednik we flocie |
|---|---|
| rura / kolejka | `background_jobs` z lease i tokenem próby (`04 › Zadania w tle i kolejki`); `pgmq` = ta sama idea |
| filtr | jedna funkcja na typ zadania (`type`), czysta logika w `src/lib`, I/O na brzegu (`pg/paradigm.md`) |
| stan kroku | kolumna `status` + `attempts` + `last_error`; krok zapisuje wynik i tworzy zadanie następnego kroku w **tej samej transakcji** (dual write, `04`), z warunkiem tokenu próby `status='running' and attempts=$token` (`04 › Zadania w tle i kolejki`). Kolejność: najpierw ten `update`, a 0 wierszy = rollback bez tworzenia następnego zadania. Następne zadanie dostaje kolumnę `dedup_key` z `UNIQUE (org_id, dedup_key)` (kolumna dodatkowa względem listy w `04`) i insert `on conflict (org_id, dedup_key) do nothing`, bo bez tego spóźniony worker tworzy duplikat, a goły `UNIQUE` rzuca 23505 i cofa też update kroku `[własny]` |
| DLQ | status `dead` + alert (`04`) |
| orkiestrator | n8n jako harmonogram i klej integracji; logika biznesowa w repo (endpoint/RPC), nie w węzłach `Code` (`04 › Orkiestracja n8n i automatyzacje`) |
| duży payload | plik w Supabase Storage, w zadaniu tylko ścieżka (claim check). Ścieżka ma prefiks `<org_id>/` (`02 › Pliki i object storage`), a worker na `service_role` przed pobraniem sprawdza, czy prefiks = `org_id` zadania (RLS go nie chroni) |

## 5. Reguły konstrukcyjne
1. **Każdy filtr idempotentny**, bo ten sam komunikat może przyjść drugi raz (awaria po zapisie, a przed potwierdzeniem) [P]. Preferuj operacje naturalnie idempotentne: upsert po kluczu biznesowym, ustaw wartość, a nie dodaj [1]. Klucz deduplikacji = id komunikatu albo klucz biznesowy, **nie** correlation id; znacznik dedup i skutek w jednej transakcji, `UNIQUE` jako arbiter przy wielu konsumentach [1, Azure] (`05 › Idempotentność i deduplikacja`).
2. Efekt zewnętrzny poza transakcją: stan `in_progress` → akcja → `completed`, klucz idempotencji przekazany do wywołania downstream [1, Azure]. „Exactly-once” end-to-end jest praktycznie nieosiągalne; cel = at-least-once + idempotentny konsument [1, Azure].
3. **Zatruty komunikat** nie wraca do kolejki w nieskończoność: limit prób, potem DLQ ze szczegółami do analizy [1, Azure; sama DLQ: P]. Monitoruj głębokość DLQ, napraw przyczynę, wyślij ponownie [1].
4. **Backpressure:** gdy producent jest średnio szybszy od konsumenta, kolejka i latencja rosną; monitoruj głębokość i wiek najstarszego zadania, skaluj w granicach albo odrzucaj u producenta [1, Azure]. Skalowanie workerów bez limitu na downstream tylko przenosi przeciążenie na zależność [1, Azure] (`styl-event-driven.md` › 2, akapit „Rachunek backlogu”).
5. **Kolejność:** przy wielu konsumentach nie jest gwarantowana; projektuj bez zależności od kolejności albo dodaj numer sekwencji/wersji i odrzucaj stare [P].
6. **Duże dane:** payload do magazynu, w komunikacie referencja (claim check) [P]; najpierw zapisz payload, potem opublikuj referencję [1, Azure]. n8n przy dużych danych pada na pamięci: małe paczki (docs: 200 zamiast 10 000 wierszy) i sub-workflow zwracający mały wynik [1, n8n docs].
7. **Obserwowalność:** correlation id w każdym kroku [1, EIP]; logi z kluczem dedup, metryka duplikatów, głębokość kolejki, wiek najstarszego zadania, odsetek `dead` [1, Azure]. Dla kroków w n8n: workflow błędów z alertem (`errorWorkflow`) (`04 › Orkiestracja n8n i automatyzacje`) oraz ustawiony `EXECUTIONS_TIMEOUT` (domyślnie `-1` = wyłączony, maks. `EXECUTIONS_TIMEOUT_MAX` 3600 s [P, n8n docs]), bo bez niego zawieszone wykonanie wisi bez końca. Timeout krótszy niż lease zadania (`04 › Zadania w tle i kolejki`), inaczej drugi worker przejmie zadanie w trakcie pracy n8n. `systemctl … -p Environment` nie widzi zmiennych z `EnvironmentFile=`; sprawdź też `-p EnvironmentFiles`. Sprawdzenie: `systemctl --user show n8n -p Environment \| rg EXECUTIONS_TIMEOUT` albo ustawienie „Timeout workflow” w workflow.
8. **Jeden krok = jedna odpowiedzialność**; złożone zadanie = kilka filtrów, nie jeden wielki [1, Azure]. Najwolniejszy filtr wyznacza czas całości [P].
9. **Filtr na `service_role` omija RLS**, więc każde jego zapytanie zawęża `org_id` zadania, a `org_id` pochodzi z zadania zapisanego przez serwer, nie z danych od użytkownika `[własny, zgodne z 02 › Multi-tenancy w danych]`. Warunek: klient nie może pisać do `background_jobs`. Tabela ma kolumnę `org_id not null` (dodatkowa względem listy w `04`), RLS włączone bez polityk dla `anon`/`authenticated` (albo `revoke all`), a zadania wstawia tylko serwer albo funkcja SQL, która wyprowadza `org_id` z członkostwa (`auth.uid()`). Taka funkcja (`SECURITY DEFINER`) ma też listę dozwolonych `type`, waliduje `payload` (id celu z tej samej organizacji, ścieżki, numery) i higienę DEFINER: `set search_path = ''`, `revoke execute … from public, anon` (`pg/cases.md` RLS-DEFINER-HYGIENE). Kroki płatne (SMS, LLM, mail) mają limit kosztu per organizacja i alert na pętlę ponowień. Detekcja dostępu: `select c.relrowsecurity, (select count(*) from pg_policies p where p.schemaname = n.nspname and p.tablename = c.relname) as policies, (select string_agg(grantee \|\| ':' \|\| privilege_type, ',') from information_schema.role_table_grants g where g.table_schema = n.nspname and g.table_name = c.relname and g.grantee in ('anon','authenticated','PUBLIC')) as grants from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relname = 'background_jobs';` → OK = (RLS włączone i 0 polityk) albo brak grantów. Polityka bez `TO` dotyczy `PUBLIC`, więc obejmuje też `authenticated`.

## 6. Antywzorce → detekcja
| Antywzorzec | Komenda / heurystyka `[własny]` |
|---|---|
| filtr ze stanem współdzielonym [P] | `rg -n "^(let\|var\|const) [a-zA-Z_]+ = (new (Map\|Set)\|\[\]\|\{\})\|^(let\|var) " supabase/functions` (stan modułu w handlerze i w plikach obok; lista do przeglądu) + test: to samo zadanie 2× = ten sam stan |
| brak idempotencji [P] | test replay w CI; `rg -n "\.insert\(" supabase/functions` = lista do ręcznego przeglądu (szukasz insertów bez `onConflict`/klucza; komenda sama ich nie odfiltruje) |
| brak DLQ, zatruty komunikat krąży [P] | `select type, attempts, last_error from background_jobs where attempts >= max_attempts and (status = 'queued' or (status = 'running' and locked_until < now()));` (`running` na ostatniej próbie z ważnym lease jest zdrowy, `04`) |
| gigantyczny krok [1] | p95 czasu kroku vs limit platformy; OOM w logach n8n |
| logika biznesowa w węzłach n8n (teza bez źródła, zgodna z „rura bez logiki” [1, Azure]) | liczba węzłów `Code`/`IF` w eksporcie workflow: `jq '[.nodes[] \| select(.type \| test("^n8n-nodes-base\\.(code\|if\|switch)$"))] \| length' workflow.json` |
| za duży payload w kolejce [P] | `select max(pg_column_size(payload)) from background_jobs;` |
| kolejka rośnie bez końca [1] | `select now()-min(created_at) from background_jobs where status='queued';` |
| pipeline zamiast request-response [1] | UI czeka w pętli na status zadania, które powinno wykonać się synchronicznie w < 1–2 s (`04` › Kiedy NIE) |
| pipeline zamienił się w workflow z rozgałęzieniami [1] | liczba gałęzi `IF`/`Switch` na przepływ |

## 7. Fitness functions `[własny, kierunki z Azure]`
- Wiek najstarszego zadania w `queued` < deadline biznesowy (alert); odsetek `dead` i głębokość DLQ [1, Azure: monitoruj głębokość].
- p95 czasu kroku < ~50 % limitu platformy (`04` › Twarde limity platform).
- Test replay w CI: każdy filtr wykonany 2× daje ten sam stan.
- Test kontraktu schematu wejścia/wyjścia każdego kroku (zod) — filtry znają tylko schematy [1, Azure].
- E2E smoke całego łańcucha po zmianie kroku [1, Azure].
- Krok w n8n: sonda żywotności n8n (`04 › Orkiestracja n8n i automatyzacje`, komenda `systemctl --user is-active n8n` + `/healthz`) z alertem. Sonda na tym samym laptopie milknie razem z nim, więc alert potrzebuje zewnętrznego heartbeatu (dead man's switch poza laptopem) `[własny]`. Krok kliencki na produkcji zależny od n8n na laptopie = czerwone.

## 8. Ewolucja
Sekwencji jako całości żadne źródło nie opisuje; kroki i wyzwalacze `[własny, sygnały z 1 źródła każdy]`:
- **skrypt / funkcje po kolei** → **`background_jobs` z krokiem w statusie**, gdy krok przekracza ~1–2 s albo potrzebny retry (`04` › Kiedy NIE);
- → **orkiestrator** (n8n, workflow trwały typu Temporal/Inngest, Vercel Workflows), gdy: stan kroków zaczyna wymagać własnej tabeli i crona wskrzeszającego, kroki czekają na ludzi lub zdarzenia (zatwierdzenie, webhook, timer), retry powtarza płatne kroki, proces trwa godziny lub dni [1, źródła vendorów — uwaga na stronniczość]; krok przekracza limit funkcji [1, docs];
- → **streaming / event-driven**, gdy kilku niezależnych konsumentów potrzebuje tego samego zdarzenia albo odtwarzania strumienia (`styl-event-driven.md`, `04` › Kiedy NIE: zewnętrzna kolejka przy ~setkach zadań/s).
- Kroki kompensowalne zamiast transakcji rozproszonej: pipes & filters + compensating transaction [1, Azure].

## 9. Worksheet — jak czytać ten styl (kierunek, nie wynik)
Źródła wtórne zgodnie: **mocne** koszt, prostota, modularność; **słabe** elastyczność, skalowalność, odporność [P]. Liczby z jednego streszczenia: koszt 5, prostota 5, modularność 3, testowalność 3, ewolucyjność 3, niezawodność 3, wdrażalność 2, wydajność 2, elastyczność 1, skalowalność 1, odporność 1 [1]; streszczenia różnią się przy wdrażalności, niezawodności i wydajności. Czytaj: w czystej postaci (monolityczny łańcuch) styl jest tani i prosty, a słabości skalowania i odporności łagodzi rura w postaci kolejki z retry i DLQ — u nas to `background_jobs` `[własny]`.

## 10. Stan w PG (zweryfikowany 2026-11-07)
- MAMY: kolejka `background_jobs` z lease, tokenem próby, `dead` i dual write (`04 › Zadania w tle i kolejki`), idempotencja i dedup (`05`), n8n bez logiki biznesowej (`04 › Orkiestracja n8n i automatyzacje`), limity platform jako progi, rachunek backlogu (`styl-event-driven.md`).
- CZĘŚCIOWO: claim check i rozmiar payloadu — tylko w tej karcie; liczba węzłów `Code` w n8n — tylko komenda.
- BRAK (do rozważenia przy pierwszym incydencie, nie blokada): test replay filtra w szablonie repo.

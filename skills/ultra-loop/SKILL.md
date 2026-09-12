---
name: ultra-loop
description: Autonomiczna metoda „poproś raz → zbiegnij do perfekcji". Użyj, gdy uzytkownik chce doprowadzić projekt/apkę do ukończenia lub poziomu komercyjnego przy minimum pytań — „skończ tę apkę", „dojedź do końca", „zrób to ultra / produkcyjnie", „loop aż do perfekcji", „jedź ultra", „doprowadź do perfekcji", „poproś mnie raz i skończ", albo każda prośba o autonomiczne ulepszanie kodu do zdefiniowanego progu. Skill ustawia rubrykę „definicja ukończenia", potem kręci cykle implementuj→weryfikuj→wdróż→oceń aż każdy wymiar osiągnie cel albo zostaną same blockery dla człowieka. Trigger też: „autonomiczna pętla", „samo-looping", „ile razy mam Cię poprosić żeby skończyć".
---

# ULTRA Loop — poproś raz, zbiegnij do perfekcji

Metoda zamieniająca „skończ tę apkę" w samonapędzający się łańcuch cykli, który
sam wybiera co robić, weryfikuje że działa, wdraża na prod i zatrzymuje się tylko
na rzeczach, których nie zrobi bez człowieka.

## Uczciwa rama (powiedz to uzytkownikowi raz)
„One-shot apki za 50k" nie istnieje — każdy soft tej klasy powstał przez setki
iteracji. Ostatnie 30% (to, co czyni go wartym tyle) wychodzi dopiero jak apkę
ĆWICZYSZ, łapiesz co się psuje i poprawiasz. To pętla, nie strzał. ALE „poproś
raz → wracasz do znacznie lepszej" jest realne — i tym jest ten skill. Nie
obiecuj magii; obiecaj zbieżność do zdefiniowanego progu.

## Krok 0 — Kręgosłup: rubryka „definicja ukończenia"
Bez tego pętla dryfuje w nieskończoność. Napisz `docs/ULTRA-SPEC.md` (albo
odpowiednik) ZANIM zaczniesz kręcić:
- **Wizja jednym zdaniem** — kto, robi co, w jakim kontekście.
- **8–20 wymiarów jakości** — tabela: `wymiar | teraz (0-10) | cel | największa luka`.
  Skala: 0=brak, 5=działa, 10=poziom komercyjny (nazwij konkretny benchmark, np.
  Tekmetric/Identifix, Linear, Stripe-quality). Oceniaj UCZCIWIE — zaniżony wynik
  to zmarnowany cykl, zawyżony to fałszywe „done".
- **Waga** przy wymiarach, jeśli nie równe (kasa/bezpieczeństwo > kosmetyka).
- **Kolejka blockerów** — rzeczy TYLKO dla człowieka (klucze API, wybór dostawcy,
  kontrakty, decyzje gustu, fizyczny test na urządzeniu). Zbierane, nie zgadywane.
Rubryka to jednocześnie odpowiedź na „co ma mieć apka za tyle" i paliwo pętli.

## Pętla (jeden cykl)
1. **SELECT** — z rubryki weź wymiar o największym `(cel − teraz) × waga`,
   POMIJAJĄC te czekające na blocker. Rozbij na 1–3 konkretne zmiany.
2. **BUILD** — zaimplementuj. Duże/rozgałęzione → Workflow (agenci rozłączni
   plikowo). Małe/spójne → jeden mocny agent (implement) + jeden (review).
   Zasada domyślna: bez nowych zależności npm bez wyraźnego powodu; nie ruszaj
   auth/RLS/migracji „przy okazji".
3. **VERIFY** — TRZY bramki, wszystkie muszą przejść przed wdrożeniem:
   a) `build` (tsc+bundler) czysty — złap i napraw błędy typów zanim dalej;
   b) **realne odpalenie w przeglądarce** (preview): załaduj flow, sprawdź że
      RENDERUJE i DZIAŁA z danymi + zero błędów w konsoli — nie ufaj samej
      kompilacji („ładnie się kompiluje, ale nie działa" to najczęstszy fałsz);
   c) **adwersarialny review** — 2–3 sceptyków próbuje OBALIĆ zmianę
      (correctness + „czy to realnie działa dla użytkownika"), zanim wejdzie.
4. **SHIP** — wdróż (front→hosting, DB/edge→przez most/CI), wpis do CHANGELOG.
   Nienadzorowany prod: wdrażaj TYLKO co przeszło a+b+c; ryzykownych gambli na
   prod-schemacie/auth bez człowieka NIE rób — one idą do blockerów.
5. **SCORE** — zaktualizuj wynik wymiaru w rubryce + datę. To durable trail:
   jak łańcuch padnie (restart procesu), rubryka + CHANGELOG mówią gdzie stanął.
6. **LOOP** — wróć do 1.

## Terminacja (żeby nie kręcić w kółko udając robotę)
Zatrzymaj się, gdy:
- wszystkie wymiary ≥ cel → „done", raport końcowy; ALBO
- 2 cykle z rzędu bez realnego postępu → raport zamiast pętli; ALBO
- zostały tylko wymiary czekające na blocker → **jedna paczka pytań** do
  człowieka (nie po jednym! zbierz wszystkie blockery i zapytaj hurtem).

## Mechanizm „przez noc" (jak łańcuch sam się napędza)
W tym harnessie nie działasz ciągle — działasz turami. Łańcuch napędzają
zakończenia zadań w tle: **każdy cykl kończ uruchomieniem workflow następnego
cyklu**; jego zakończenie re-inwokuje Cię → weryfikujesz+wdrażasz+startujesz
kolejny. Tak leci aż do blockera. Słaby punkt: jeśli cykl NIE odpali kolejnego
workflow, łańcuch staje — więc zawsze zamykaj cykl startem następnego (albo
ScheduleWakeup jako fallback-heartbeat na wypadek zgubionej notyfikacji).

## Narzędzia, które to realizują (nie wymyślaj od zera)
- **Workflow** — fan-out find→fix→verify, loop-until-dry, panele sędziów,
  writer→reviewer. Zakończenie = notyfikacja, która pcha łańcuch.
- **verify / code-review / security-review / architecture-advisor / mobile-optimization / jack-quality-gate** — gotowe bramki jakości między BUILD a SHIP.
- **Preview (Playwright/preview_*)** — bramka „b": realne odpalenie, nie typy.
- Deploy sekretów/DB: przez ustalony most (u uzytkownika: Infisical `infisical (CLI)`).

## Antywzorce (nie rób)
- Pętla bez rubryki → dryf, nigdy nie „done".
- Ocena „teraz" na oko zawyżona → fałszywe ukończenie.
- Wdrożenie po samym `build` bez odpalenia w przeglądarce → prod-regresja w nocy.
- Pytanie o blockery po jednym → budzisz człowieka 6 razy zamiast raz.
- Ryzykowna migracja prod bez nadzoru „bo pętla" → to gambling, nie inżynieria.
- Kręcenie kosmetyki gdy wymiar kasa/bezpieczeństwo jest niżej — trzymaj się wag.

## Uruchomienie
uzytkownik mówi raz np. „jedź ultra wg ULTRA-SPEC aż do blockera". Ty: (0) upewnij
się że rubryka istnieje i jest uczciwa → (1..6) kręć cykle → zatrzymaj na
terminacji z jedną paczką decyzji. Zostawiasz durable trail (rubryka+CHANGELOG),
żeby dało się podjąć w kolejnej sesji od miejsca zatrzymania.

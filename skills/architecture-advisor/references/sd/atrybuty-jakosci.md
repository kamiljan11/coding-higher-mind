# Atrybuty jakości — rozróżnianie i wybór (słownik dla design.md B.0 i scorecardu)

**Problem.** „Musi być wydajne i skalowalne” to nie wymóg, tylko życzenie. Atrybuty jakości trzeba rozróżniać, bo każdy ma inną dźwignię, a pomylenie ich prowadzi do drogiej i złej naprawy:
- replika bazy (dźwignia skalowalności) na wolne zapytanie (problem wydajności);
- replikacja (dźwignia dostępności) zamiast backupu (trwałość), choć replikacja powieli też `DELETE`.

Kolejność pracy:
1. Nazwij atrybut.
2. Zapisz go jako **scenariusz z liczbą**.
3. Ustal ranking: B.0 w `docs/ARCHITECTURE.md`.
4. Dopiero potem wybierz dźwignię z karty.

## Format scenariusza (każdy priorytet w B.0 i każdy wiersz scorecardu)
`<atrybut>: <bodziec/warunek> -> <odpowiedź> mierzona <miarą z liczbą>`

Przykłady:
- „Wydajność: mechanik otwiera listę zleceń przy 50 req/s -> p95 < 300 ms”.
- „Dostępność: awaria regionu bazy -> tryb tylko-odczyt w < 5 min, SLO 99,5 %/mies.”.
- „Zmienialność: nowe pole w formularzu zlecenia -> 1 plik + migracja, < 1 h”.

Bez liczby nie da się sprawdzić, czy decyzja zadziałała. Wtedy atrybut trafia do „NIE TERAZ”, a nie do priorytetów.

## Słownik — pytanie rozróżniające, miara, dźwignia, pułapka

| Atrybut | Pytanie, które go odróżnia | Miara | Typowa dźwignia u nas | Pomylony z → zła naprawa |
|---|---|---|---|---|
| **Wydajność** (performance) | Jak szybko przy OBECNYM obciążeniu? | p95/p99 latencja, przepustowość przy danym QPS | indeks, usunięcie N+1, `select` kolumn, payload, cache odczytu | skalowalność → replika/sharding na wolne zapytanie (`03 › Zapytania i indeksy`) |
| **Skalowalność** (scalability) | Co się dzieje z wydajnością i kosztem przy obciążeniu ×10? | p95 przy 10× QPS; koszt/użytkownika przy 10× | pion (większy plan) → pooler → widok zmat./replika → dopiero partycje (`03 › Drabina skalowania`) | wydajność → cache wszędzie zamiast pomiaru wąskiego gardła |
| **Elastyczność** (elasticity) | Jak szybko dopasowuje się do skoków ruchu i z powrotem? | czas do pojemności, koszt w dolinie | serverless, autoscaling, kolejka buforująca | skalowalność → serverless bez poolera wyczerpuje połączenia bazy |
| **Dostępność** (availability) | Jaki % czasu użytkownik dostaje odpowiedź? | SLO %, MTTR | rollback (ADR-0004), health checki, redundancja, tryb degradacji | trwałość → „mamy replikę, więc dane są bezpieczne” |
| **Trwałość danych** (durability) / RPO | Ile danych tracimy w najgorszym razie? | RPO (min), test odtworzenia | backup + PITR, test restore, migracje zgodne wstecz | dostępność → replikacja zamiast backupu (powiela DELETE) |
| **Odtwarzalność** (recoverability) / RTO | Jak szybko wracamy po katastrofie? | RTO, data ostatniego udanego restore | runbook DR, przećwiczony restore | „backup jest” bez ani jednego testu odtworzenia |
| **Niezawodność / poprawność** | Czy wynik jest poprawny mimo awarii i ponowień? | % błędów, liczba duplikatów (cel 0) | idempotencja, retry z limitem, transakcje (`05 › Idempotentność`) | dostępność → retry bez idempotencji = podwójne płatności |
| **Spójność** (consistency) | Czy użytkownik może zobaczyć nieświeże dane, i czy to szkodzi? | max opóźnienie, C vs A per przepływ | odczyt stanu z bazy, nie z cache (design.md B+.7) | wydajność → cache na uprawnieniach/płatnościach |
| **Bezpieczeństwo** | Kto może zrobić/odczytać co, i co jeśli spróbuje inaczej? | 0 odczytów cross-tenant w testach, wyniki pg-review | RLS od dnia 0, authz w bazie, sekrety w vaulcie | użyteczność → „uprośćmy” przez service_role w kliencie |
| **Zmienialność** (modifiability) | Ile kosztuje typowa zmiana biznesowa? | pliki/katalogi na zmianę (`paradigm.md › Pomiar`), czas | granice modułów, dane zamiast kodu, refaktor przygotowawczy (design.md B.1b) | perfekcja → abstrakcje na zapas (YAGNI) |
| **Testowalność** | Czy da się sprawdzić zachowanie bez całego świata? | mocki/test, czas testów | functional core / imperative shell (`paradigm.md`) | „testy później” |
| **Obserwowalność** | Czy dowiemy się o problemie przed klientem i znajdziemy przyczynę o 3 w nocy? | MTTD, % błędów z kontekstem | Sentry od dnia 0, logi z org/id/powodem | „logi są” bez korelacji i kontekstu |
| **Wdrażalność** (deployability) | Jak bezpiecznie i jak często możemy wypuszczać? | czas rollbacku, częstotliwość deployów | deploy-gate BAKE/WATCH, flagi, expand/contract (R14) | szybkość → deploy bez ścieżki rollbacku |
| **Koszt** | Ile płacimy miesięcznie i za co przy wzroście? | zł/mies., zł/użytkownika, cap | managed > self-host przy naszej skali, cap na LLM/SMS | „tanie” self-host bez liczenia czasu utrzymania |
| **Użyteczność / a11y** | Czy persona z PRD-lite zrobi zadanie w swoim kontekście? | czas zadania, błędy, WCAG | ux-reviewer, ścieżki krytyczne, mobile-first | bezpieczeństwo → 5 kroków logowania na warsztacie |
| **Zgodność** (RODO, KSeF, e-ID) | Jakie prawo obowiązuje i co grozi? | lista wymogów odhaczona dowodem | region danych UE, KSeF, PRIVACY.md | „dodamy później” (to drzwi jednokierunkowe) |
| **Przenośność / lock-in** | Ile kosztuje zmiana dostawcy? | dni pracy na migrację | standardy (Postgres, S3 API), adaptery na granicy | perfekcja → abstrakcja nad każdym SDK „na wszelki wypadek” |

## Typowe konflikty (tu ranking z B.0 rozstrzyga)
- **Wydajność ↔ spójność:** cache przyspiesza, ale pokazuje stare dane. Decyzja per przepływ: płatności i uprawnienia → C, katalog → A.
- **Dostępność ↔ spójność:** przy awarii wybierasz między odpowiedzią „starą” a brakiem odpowiedzi (CAP/PACELC). Zapisz wybór per przepływ.
- **Bezpieczeństwo ↔ użyteczność:** MFA, krótkie sesje, potwierdzenia. Rozstrzyga persona i ryzyko danych.
- **Koszt ↔ dostępność:** każda „dziewiątka” SLO kosztuje redundancję. Przy 1–10 tys. użytkowników zwykle 99,5 %, nie 99,99 %.
- **Zmienialność ↔ wydajność:** warstwy i abstrakcje kosztują latencję. Optymalizuj dopiero po pomiarze (p95 przekracza scenariusz).
- **Czas dostawy ↔ zmienialność:** skrót = dług z datą w `docs/quality/BACKLOG.md`, nie cicha decyzja.

## Audyt „czy się trzymamy”
1. Czy każdy priorytet w `docs/ARCHITECTURE.md › Cel architektury` ma liczbę? → `rg -n -A6 "^## Cel architektury" docs/ARCHITECTURE.md` (bez cyfr = życzenie, nie scenariusz).
2. Czy naprawa „wydajności” zaczęła się od pomiaru (`explain analyze`, p95), a nie od repliki lub cache? → opis PR/ADR zawiera pomiar przed i po.
3. Czy „dostępność” i „trwałość” mają osobne dowody (SLO/rollback vs test restore z datą)? → `rg -n -i "restore|pitr|rpo|rto" docs`.
4. Czy scorecard decyzji używa priorytetów z B.0 jako wag, a nie generycznych kryteriów? → ADR/scorecard cytuje numer priorytetu.

## Nie potrzebujesz jeszcze
Formalnej ATAM/utility tree z warsztatem interesariuszy: przy naszej skali wystarczą 2–3 scenariusze z liczbą w B.0 i ta tabela. Wróć do pełnej metody, gdy decyzja dotyczy > 1 zespołu albo kontraktu z SLA.

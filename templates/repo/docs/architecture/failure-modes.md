# Tryby awarii — co sie dzieje, gdy swiat nie jest idealny

Ryzyka chowaja sie w happy path: uzytkownik klika -> request przechodzi -> dane sie zapisuja to jeden wiersz z kilkunastu.
Zrodla awarii: siec, API, zaleznosci, ludzie, ruch, dane, czas. Katalog ponizej to najczestsze przypadki — przejdz go PRZED kodem
kazdej sciezki krytycznej, nowej integracji i kazdego zapisu z efektem (`pg/design.md` B+ 8-9). Obrona bez testu = obietnica;
brak testu = wiersz w `risks.md`. Recenzja: nowy zapis/wywolanie zewnetrzne bez testu sciezki bledu = major (`agents/ops-reviewer.md` #9).

## Katalog (wspolny, nie usuwaj wierszy — w tabeli projektu oznacz "nie dotyczy" z powodem)

| nr | zrodlo | co sie dzieje | domyslna obrona | test, ktory to udowadnia |
|---|---|---|---|---|
| FM1 | siec | request zawisa w polowie | timeout na kazdym wywolaniu (`AbortSignal.timeout`), UI: ladowanie z limitem, komunikat, "ponow" | odpowiedz opozniona ponad timeout (Playwright `page.route` z opoznieniem / mock) -> komunikat, brak wiszacego spinnera |
| FM2 | siec | zapis sie udal, odpowiedz zginela; klient ponawia | klucz idempotencji z klienta, UNIQUE w bazie | to samo zadanie 2x z tym samym kluczem -> 1 rekord |
| FM3 | API | 5xx / 429 / limit | retry z backoffem i jitterem tylko dla idempotentnych, limit prob, potem czytelny blad | mock 503, 503, 200 -> sukces; mock 503 x N -> blad widoczny, brak petli |
| FM4 | API | odpowiedz w innym ksztalcie niz oczekiwany | walidacja na granicy (`safeParse`), log z kontekstem, brak zapisu smieci | niepoprawny payload -> blad, 0 zapisow |
| FM5 | API | webhook przychodzi 2x albo poza kolejnoscia | dedupe po id zdarzenia (UNIQUE), fail-closed, obsluga starszego zdarzenia po nowszym | to samo zdarzenie 2x -> 1 efekt; zdarzenia w odwrotnej kolejnosci -> poprawny stan koncowy |
| FM6 | dane | zapis czesciowy: krok 3 z 7 pada | transakcja / jedna funkcja RPC / kompensacja; zero sierot | wymuszony blad w kroku N -> stan jak przed operacja |
| FM7 | zaleznosci | padla baza / storage / e-mail / SMS / AI | degradacja (co dziala dalej, co widzi uzytkownik), kill switch w RUNBOOK | zaleznosc zwraca blad -> reszta aplikacji dziala, komunikat zamiast bialego ekranu |
| FM8 | ludzie | podwojny klik, dwie karty | przycisk zablokowany w trakcie + idempotencja po stronie serwera | 2 rownolegle submity -> 1 efekt |
| FM9 | ludzie | dwie osoby edytuja to samo | optimistic lock (`version` / `updated_at` w warunku UPDATE), konflikt widoczny | dwa zapisy na tej samej wersji -> drugi dostaje konflikt |
| FM10 | ludzie | sesja wygasa w trakcie formularza | zachowane wpisane dane, ponowne logowanie bez utraty | wygasly token przy zapisie -> logowanie -> dane formularza sa |
| FM11 | ludzie | operator: zla migracja, zly deploy | migracja expand-contract, rollback w RUNBOOK, backup z data testu restore | restore drill (data w RUNBOOK), migracja odwracalna na kopii |
| FM12 | ruch | x10, bot, spam formularza | rate limit, paginacja, cap kosztu AI/SMS per org | test limitu (N+1 zadanie -> 429); szacunek w `capacity.md` |
| FM13 | czas | strefy, zmiana czasu, zly zegar klienta | UTC w bazie, serwer = zrodlo czasu, format w strefie uzytkownika | test na granicy zmiany czasu i polnocy w innej strefie |
| FM14 | pieniadze | operator przyjal platnosc, nasz zapis padl (albo odwrotnie) | stan "oczekuje", rekonsyliacja webhook + cron, nigdy podwojne obciazenie | platnosc OK + blad zapisu -> rekonsyliacja doprowadza do 1 zamowienia |
| FM15 | offline | brak sieci na telefonie | stan offline widoczny, akcja nie ginie po cichu (kolejka albo jawny blad) | `qa-matrix --offline` / `context.setOffline(true)` -> komunikat |

## Ten projekt — sciezki krytyczne x tryby awarii

Sciezki krytyczne: z `docs/CRITICAL-PATHS.md` (gdy jest) albo 3-5 akcji, bez ktorych klient traci pieniadze lub dane.

| sciezka krytyczna | FM | dotyczy? (nie = 1 zdanie dlaczego) | obrona (`plik:linia`) | test (`plik`) | status |
|---|---|---|---|---|---|
| [np. platnosc za zamowienie] | FM1 | | | | brak testu -> R? w risks.md |
| | FM2 | | | | |
| | FM5 | | | | |
| | FM6 | | | | |
| | FM14 | | | | |

Przeglad: przy kazdej nowej sciezce krytycznej, integracji i po kazdym incydencie (incydent = nowy wiersz katalogu, jesli trybu nie bylo).

# docs/architecture — dokumenty decyzji (dla czlowieka i agenta)

Architektura to transparentne decyzje. Ten katalog trzyma wszystko, z czego decyzja korzysta, zeby nastepna osoba albo nastepna
sesja agenta nie zgadywala. Zasada: przed decyzja CZYTASZ, po decyzji ZAPISUJESZ. Liczby oznacz `[~]` (zalozenie) albo zrodlem (pomiar).

| plik | odpowiada na pytanie | aktualizuj, gdy | czyta |
|---|---|---|---|
| `../ARCHITECTURE.md` (Cel architektury) | czemu sluzy system i co swiadomie poswiecamy | zmienia sie cel albo ranking priorytetow | kazda sesja na starcie (`arch-check --brief`) |
| `quality-attributes.md` | jakie atrybuty jakosci sa wazne, z liczba, i w jakiej kolejnosci | nowy wymog, incydent, zmiana skali | wagi w macierzy ADR |
| `capacity.md` | czy to w ogole bedzie bolec i gdzie najpierw (QPS, dane, koszt, round tripy) | zmiana ruchu x3, nowa integracja | kontekst ADR, wybor dzwigni |
| `obszary.md` | czy kazdy obszar systemu ma decyzje (DECYZJA / NIE TERAZ / NIE DOTYCZY) | nowa technologia, zmiana decyzji | `sd-matrix-lint`, `arch-check` |
| `failure-modes.md` | co sie stanie, gdy request zawisnie, API zwroci 5xx, webhook przyjdzie 2x, zapis padnie w polowie — i ktory test to udowadnia | nowa sciezka krytyczna, integracja, incydent | design B+ 8-9, ops-reviewer #9 |
| `risks.md` | co moze pojsc zle, jak bardzo i po czym to poznamy | nowa decyzja, incydent, przeglad | sekcja Ryzyka w ADR |
| `roadmap.md` | co robimy teraz, wkrotce, pozniej i czego swiadomie jeszcze nie | po kazdej decyzji z "nie teraz" | planowanie, sygnaly powrotu |
| `../adr/` | co i dlaczego wybralismy, czego kosztem, kiedy wrocic | kazda decyzja z `pg/design.md` E | kazda kolejna decyzja w tym obszarze |

Proces jednej decyzji (ADR): kontekst -> kryteria -> opcje -> wagi -> ryzyka -> decyzja -> wykonanie (spike / PoC / kontrolowane
obciazenie / canary) -> przeglad skutkow w dniu z naglowka ADR (latencja, error rate, koszt, utrzymanie) -> powrot do zalozen.

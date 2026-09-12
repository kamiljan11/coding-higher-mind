# SCOPE — uzgodniony zakres i change requesty

<!-- Dla repo klienckich (CLAUDE.md `pg.ownership: client-*`). "Zakres jest wszystkim": decyduje o wycenie,
     terminie i o tym, kto ma racje w sporze. product-reviewer pyta: czy feature z diffu ma wiersz tutaj?
     Brak wiersza = change request (wycena + decyzja klienta), nie "przy okazji". -->

## Zakres uzgodniony (data akceptacji: RRRR-MM-DD, kto: [klient, imie])

| ID | Funkcja (z perspektywy uzytkownika) | Kryterium akceptacji (obserwowalne) | Status |
|---|---|---|---|
| S1 | Jako [rola] chce [dzialanie], zeby [korzysc] | [rola] widzi X po Y | planowane / w toku / odebrane (ACCEPTANCE.md) |

## Non-goals (czego celowo NIE robimy w tym zakresie)
- ...

## Change requesty (CR) — kazdy ma wycene i decyzje ZANIM powstanie kod

| CR | Data | Kto zglosil | Tresc | Wycena (h / kwota) | Decyzja klienta (data) | Wiersz w zakresie |
|---|---|---|---|---|---|---|
| CR1 | | | | | akceptacja / odrzucenie / czeka | S? |

## Zasady
- Prosba "przy okazji" = CR. Zero wyjatkow; male CR-y sa wlasnie tymi, ktore rozpelzaja zakres.
- Zmiana zakresu = prawo do zmiany ceny/terminu (zapis w umowie, nie w mailu po fakcie).
- CR bez decyzji klienta w 14 dni = zamkniety jako "brak decyzji" (nie wisi w backlogu).

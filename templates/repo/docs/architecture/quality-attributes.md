# Atrybuty jakosci — scenariusze z liczba

Slownik i dzwignie: `~/.claude/skills/architecture-advisor/references/sd/atrybuty-jakosci.md`. Atrybut bez liczby = "NIE TERAZ", nie priorytet.
Format: `<atrybut>: <bodziec/warunek> -> <odpowiedz> mierzona <miara z liczba>`. Waznosc i trudnosc: W/S/N.
Wagi w macierzy ADR sa w % (suma 100) i zaleza od kontekstu projektu — wybierz profil ponizej albo wpisz wlasny z 1 zdaniem uzasadnienia.
Scenariusz z waznoscia W dostaje najwyzsza wage w swoim kryterium; N = kandydat do usuniecia z macierzy.

| kryterium | profil MVP (szybko na rynek) | profil regulowany (finanse, platnosci, dane osobowe) | ten projekt |
|---|---|---|---|
| Time-to-market | 30 | 5 | |
| Prostota implementacji | 25 | — | |
| Kompetencje zespolu | 20 | — | |
| Skalowalnosc dlugoterminowa | 10 | — | |
| Spojnosc danych | — | 25 | |
| Bezpieczenstwo | — | 25 | |
| Niezawodnosc | — | 20 | |
| Zgodnosc regulacyjna / audytowalnosc | — | 15 | |
| Koszt operacyjny | 15 | 10 | |
| **suma** | 100 | 100 | 100 |

Profile = punkt startu z kursu architektury (DevSteer, "Wagi zaleza od kontekstu"), nie prawda o projekcie; zmiana profilu = wpis w ADR.

| nr | scenariusz | waznosc | trudnosc | jak mierzymy (komenda / dashboard) | stan dzis |
|---|---|---|---|---|---|
| QA1 | [Wydajnosc: ... przy ... req/s -> p95 < ... ms] | | | | `[~]` |
| QA2 | [Dostepnosc: awaria ... -> ... w < ... min, SLO ... %/mies.] | | | | |
| QA3 | [Zmienialnosc: nowe pole w ... -> ... plik(i), < ... h] | | | | |

Swiadomie poswiecamy (zgodnie z Cel architektury): ...

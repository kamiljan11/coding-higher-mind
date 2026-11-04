---
description: Rubryka oceny planu/designu PRZED kodem (P1-lite) — samoocena autora T2+, swiezy recenzent przy pieniadzach/auth/tenantach
---

# PG · PLAN-RUBRIC — ocena planu przed kodem (P1-lite, 2026-11-01)

Kiedy: plik designu T2+ (`docs/designs/…`, `pg/design.md`) jest zapisany, kod jeszcze nie powstal.
Kto: **autor sam** (zawsze przy T2+), wynik w sekcji „Status recenzji” pliku designu. Dodatkowo, w trybie observe:
- **swiezy recenzent** (osobny agent bez historii sesji, ta sama rubryka) gdy zmiana dotyka pieniedzy, wysylki do osob trzecich
  (mail, SMS, webhook), auth albo izolacji tenantow (decyzja D6, plan ulepszen PG 2026-11-01);
- **dzialy w trybie planu** (data-reviewer + security-reviewer na pliku designu) przy T3 albo zmianie danych/tenantow —
  w eksperymencie 2 tylko dzialy zlapaly FK miedzy tenantami (2/2).

Jak uruchomic swiezego recenzenta: agent `general-purpose` (sonnet) bez historii sesji, prompt: „Przeczytaj
`~/.claude/pg/plan-rubric.md` i ocen wg niej `<sciezka pliku designu>` w repo `<repo>`. Nie edytuj plikow. Zwroc sekcje Wynik.”
Dzialy w trybie planu: `data-reviewer` / `security-reviewer` z tym samym promptem, plik designu w miejsce diffu.

Dlaczego: eksperyment 2 (2026-11-01, 3 plany, sedzia slepy): samoocena wg rubryki 19/24, swiezy recenzent 14, dzialy 15
(dane i protokol: Obsidian `Knowledge/PG - EGM vs PG raport pełny z eksperymentem 2 2026-11-01.md`).
Rubryka podnosi samoocene bardziej niz zmiana recenzenta; brak rubryki = „wyglada dobrze”.
Zrodlo standardow: Elephant Goldfish Model (Google, Apache-2.0) — zoom-out, feature spec, implementation readiness;
ponizej wlasne streszczenie, nie kopia. Termin EGM: `pg/GLOSSARY.md`.

## Procedura (kolejnosc wiazaca)
1. **Parafraza (5-8 linii):** co powstaje, dla kogo, jak. Fragment, ktorego nie umiesz streścic bez zgadywania = Blocker
   „luka zrozumienia” (plan jest niejasny, nie czytelnik).
2. **Referencje istnieja:** `node ~/.claude/bin/plan-refs-check.js <plik designu> --repo .` -> exit 0, albo kazde trafienie
   wyjasnione (plik nowy = oznacz „nowy” w planie). Sciezka/funkcja z pamieci, ktorej nie ma = Blocker. Granica narzedzia:
   linie z markerem „nowy” sa pomijane w calosci (wynik podaje ich liczbe) — te linie sprawdz oczami; nazwy technologii
   z jawnej listy (`Next.js`, `Node.js`... — `TECH_NAME_RX` w skrypcie) nie sa sprawdzane (lista z wielkoscia liter: `express.js`, `chart.js` i `Chart.js` sa sprawdzane jak pliki — trafienie = wyjasnij albo oznacz „nowy”); `git grep` widzi tylko pliki sledzone.
3. **Zoom-out:** rozwiazuje przyczyne, nie objaw? Najprostsza droga? Reuse: `rg` po istniejacym util/module z wynikiem
   w statusie (bez komendy = niesprawdzone). Zero abstrakcji „na zapas” (YAGNI), zero optymalizacji bez zmierzonego gardla.
   Logika w warstwie, ktora ja posiada (Parnas, `pg/paradigm.md`).
4. **Zasada zero decyzji:** implementujacy nie podejmuje zadnej decyzji projektowej, ktorej nie ma w planie (nazwy pol,
   statusy, zachowanie przy bledzie, kolejnosc migracji). Kazda taka luka = Major.
5. **Ryzyka poprawnosci w samym projekcie:** integralnosc danych, izolacja tenantow, wspolbieznosc i idempotencja,
   pieniadze i podatki (zaokraglenia, waluta), bezpieczenstwo migracji (dwuetapowa), awarie zewnetrznych wywolan
   (timeout, retry, kill switch), prywatnosc (PII, procesor), przejscia stanow.
6. **Zalozenia uniewaznione (sekcja 7 szablonu):** kazdy literal/regula ma `rg` po CALYM repo z liczba trafien
   (takze prompty LLM i DEFAULT w DDL). Pusta sekcja bez `rg` = Major.
7. **Niezmienniki:** ktore wiersze `docs/ARCHITECTURE.md` › Niezmienniki dotyka zmiana i jak zostaja prawdziwe.
   Tabela z wierszem „PRZYKLAD” z szablonu albo pusta, a repo ma dane/tenantow/pieniadze = Major (niezmienniki nie spisane).
8. **Weryfikacja na prawdziwej zaleznosci (sekcja 10 szablonu):** zmiana dotyka migracji/RLS, edge fn, webhooka, platnosci
   albo nowej domeny zewnetrznej -> co najmniej jedna komenda z §10 dziala na prawdziwej zaleznosci (pgTAP/psql na lokalnym
   Supabase, curl na preview, Playwright z click/fill na sciezce krytycznej), w tym samym PR. Sam test z mockiem = Major
   (blizna `POSTGREST-AMBIGUOUS-EMBED`: vitest i tsc zielone, kazdy ekran padal). Repo Lovable bez CLI: curl na preview.

## Wynik (do sekcji „Status recenzji” pliku designu)
- Parafraza (5-8 linii).
- Findings od najciezszego: `[Blocker|Major|Nit] tytul` · miejsce (linia planu albo `plik:linia`) · problem · dowod
  (cytat <= 15 slow albo komenda + wynik) · poprawka (1 linia). Kazdy sprawdzalny przez osobe trzecia; bez dopychania.
- Blocker/Major -> popraw plan PRZED kodem; odrzucenie tylko z dowodem (ta sama dyscyplina co `skills/pg-review` krok 4).

## Miara (observe)
Zrodlo danych: tabele „Status recenzji” w plikach designu (`rg -l "## Status recenzji" docs/designs` w repo floty) i
`logs/review-outcomes.jsonl` (pg-outcome, recenzja diffu tej samej zmiany). Przeglad 2026-11-26: ile planow T2+ mialo plik designu i status; ile Blockerow z planu potwierdzil potem kod/recenzja diffu;
unikalne trafne uwagi per zrodlo (autor / swiezy / dzialy) — po ~20 planach decyzja, czy swiezy recenzent zostaje.

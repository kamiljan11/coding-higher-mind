---
name: shop-app-case-study
description: Jednorazowo: napisac case study shop-app (PL+EN) z AKTUALNEGO stanu repo shop-app i shop-app, PR do demo-site, ship na prod tylko po APPROVE
model: sonnet
---
<!-- WERSJA LINUX (laptop kamil-jan). Wygenerowano 2026-10-03 (F6, a_make_linux.py) z wersji Windows: local/shop-app-case-study. Oryginal Windows bez zmian. -->
SRODOWISKO WYKONANIA: LAPTOP Z LINUKSEM (obowiazuje od przelaczenia tego zadania na laptopa)
- Komputer uzytkownika Jana to laptop z Ubuntu (uzytkownik kamil-jan). Narzedzia desktop-commander (mcp__remote-devices__desktop-commander__*) dzialaja tam w Linuksie. start_process uruchamia /bin/sh: skladnia z wersji Windows (polecenia PowerShella) tu NIE dziala.
- Sciezki w tym pliku sa bezwzgledne (/home/kamil-jan/...). Dawna karta <backup-drive>: = /home/kamil-jan/D, vault Obsidiana = /home/kamil-jan/Obsidian/MAIN, dawny Pulpit Zenbooka = /home/kamil-jan/Desktop/Zenbook (<second-domain>), Dokumenty = /home/kamil-jan/Documents, ustawienia Claude Desktop = /home/kamil-jan/.config/Claude. Sciezki ze spacjami zawsze w cudzyslowie.
- Python: python3 (polecenia "python" nie ma). Linux pisze UTF-8. Node: node (jest w PATH desktop-commandera).
- Kazde wywolanie start_process to nowy proces: katalog roboczy nie przechodzi do nastepnego wywolania, wiec polecenie zaczynaj od cd "<katalog>" && ...
- Wywolanie urzadzenia zrywa sie po okolo 60 s. Dluzsze polecenia uruchamiaj w tle: cd "<katalog>" && setsid nohup python3 -u <skrypt> <argumenty> > <plik_wyjscia> 2> <plik_bledow> < /dev/null &  potem sprawdzaj plik krotkimi wywolaniami (tail -n 5 <plik>; sleep najwyzej 45). Czy proces dziala: pgrep -af <nazwa_skryptu>.
- Czekanie: sleep 40 (jedno wywolanie najwyzej ok. 45 s). Rekord MX domeny: dig +short MX <domena>.
- Sekrety z Infisicala: python3 /home/kamil-jan/infisical/infisical run --env=dev --<polecenie> (nigdy nie wypisuj wartosci).
- Jesli sciezka z tego pliku nie istnieje na laptopie: nie zgaduj i nie szukaj na slepo, zakoncz ze statusem FAILED i podaj brakujaca sciezke.
<!-- KONIEC NAGLOWKA LINUX -->


Zadanie jednorazowe zlecone przez uzytkownika 2026-09-21: napisz case study o sklepie shop-app (shop-app) na kamiljan.com i wypusc je na produkcje. Dzialasz autonomicznie, NIE uzywaj AskUserQuestion (to scheduled task). Kazda liczba i kazde twierdzenie w tekscie musi pochodzic z AKTUALNEGO stanu repo albo z dzialajacego sklepu, sprawdzonego w tym przebiegu. Notatki z wrzesnia sa tylko wskazowka, nie dowodem.

KROK 0 — LOG: dopisz (append, NIE nadpisuj) "STARTED <data ISO>" do /home/kamil-jan/Obsidian/MAIN/Claude Memory/Log/shop-app-case-study.md.

KROK 1 — STAN NA DZIS (najpierw czytaj, potem pisz):
- Sekrety tylko przez most: cd /home/kamil-jan/infisical && python3 infisical run --env=dev --<komenda>. Nigdy nie wypisuj tokena.
- Repo prywatne <github-owner>/shop-app (lokalnie tez /home/kamil-jan/Desktop/Zenbook (<second-domain>)/shop-app). Zrob git fetch albo swiezy klon do /home/kamil-jan/qa-sweep/shop-app-case. Przeczytaj README, CHANGELOG, docs/ (ARCHITECTURE, ADR), git log od 2026-09-01, strukture danych katalogu, testy.
- Sklep: curl https://shop-app (musi byc 200) i obejrzyj go w przegladarce (render JS). Sprawdz, czy nadal dziala to, co bylo we wrzesniu: produkty w kolejnosci drukowanego katalogu (pole catalogRank), podpisy pod nazwa w 3 jezykach EN/IS/PL (cookie shop-app-locale), zero opublikowanych produktow bez kategorii (we wrzesniu z 51 w koszu "Other equipment" zeszlo do 0), straznik cen sprawdzajacy produkty po kazdym zapisie, filtr marki zachowany przy stronicowaniu i sortowaniu. Dla kazdego punktu zapisz dowod (plik:linia, komenda, wynik).
- Kontekst we wrzesniowych notatkach: /home/kamil-jan/Obsidian/MAIN/Claude Memory/RESUME.md (sekcja shop-app, 2026-09-20) i Projects.md. Traktuj je jako tropy do sprawdzenia.

WARUNEK STARTU: jesli sklep nie dziala, jest w zlym stanie albo kluczowych rzeczy nie da sie potwierdzic, NIE publikuj. Dopisz do logu "REPORT-ONLY" z konkretnym powodem i dowodem, i zakoncz.

KROK 2 — TRESC (skill case-study-factory, tryby RESEARCH -> WRITE -> AUDIT):
- Temat to inzynieria, nie sprzedaz: katalog od dostawcy zamieniony w porzadny sklep (kolejnosc jak w drukowanym katalogu, podpisy w 3 jezykach, kategoryzacja do zera "bez kategorii", straznik cen, filtry nie gubiace stanu) plus to, co doszlo od wrzesnia, jesli jest potwierdzone.
- ZAKAZANE (decyzja uzytkownika): nie pisz o ukrytych, nieobsluzonych ani zagubionych zamowieniach, o liczbie zamowien ani o bledach produkcyjnych ze sklepu. Nie podawaj obrotow ani liczby zamowien. Nie wymieniaj z nazwiska osob (np. dostawcy/partnera). Nazwe firmy dostawcy podaj tylko, jesli jest publicznie widoczna na shop-app.
- Uczciwosc: zadnych niezweryfikowanych liczb. Ograniczenia opisz wprost, w pierwszej osobie.
- Styl: skill humanizer (zero myslnikow — i —, zero "nie X, tylko Y" jako puenty, bez intensyfikatorow). Polski naturalny, nie tlumaczony.
- Wersja PL i EN. Ksztalt danych dokladnie jak w istniejacych wpisach w src/data/caseStudies.pl.ts i src/data/caseStudies.ts (te same pola, ta sama kolejnosc). Dodaj jako nastepny wpis.

KROK 3 — KOD I BRAMKI (repo /home/kamil-jan/Desktop/Zenbook (<second-domain>)/demo-site):
- git fetch && git checkout main && git merge --ff-only origin/main; nowa galaz content/shop-app-case-study. Nie pushuj na main (jest chroniony).
- Zaktualizuj wszystko, co liczy case studies: src/server/bot.server.ts ("<N> write-ups of real builds" — test bot.prompt.test.ts porownuje z CASE_STUDIES.pl.length) oraz inne testy/teksty z liczba case studies (grep "20 " / "dwadzie" w src).
- Wpis w CHANGELOG.md [Unreleased].
- Bramki (musza byc zielone, max 5 iteracji napraw): npm run lint, npx tsc -b, npm test, rm -rf .output && npm run build (bez ALLOW_RM: `.output` = katalog build, bash-guard przepuszcza od 2026-09-26), E2E_PORT=5240 npx playwright test (porty 4122-4221 sa zarezerwowane na Windows).
- Commit (Conventional Commits, stage tylko jawne sciezki, przed zmiana galezi: git checkout -- src/routeTree.gen.ts). Push: python3 /home/kamil-jan/infisical/infisical (CLI) git-push --secret GITHUB_Token --remote github.com/<github-owner>/demo-site --refspec content/shop-app-case-study:content/shop-app-case-study --repo "/home/kamil-jan/Desktop/Zenbook (<second-domain>)/demo-site" --env dev
- PR przez GitHub REST API (przez most), opis z pliku: co, skad kazdy fakt (dowody z kroku 1), jak sprawdzone.

KROK 4 — WYPUSZCZENIE NA PROD:
- cd /home/kamil-jan/infisical && python3 infisical run --env=dev --"/home/kamil-jan/.claude/bin/ship_pr_comfy.py" <numer PR>
- Exit ≠ 0 = NIE gotowe. `REFUSED`/`CONFLICT` -> PR zostaje otwarty, napraw albo zgłoś uzytkownikowi. `DEPLOY NOT CONFIRMED` -> PR już zmergowany, ale deploy nie potwierdzony: NIE pisz „opublikowane”, sprawdź stronę curlem i zgłoś uzytkownikowi (wycofanie: revert commita merge przez nowy PR albo `vercel promote` poprzedniego deployu — decyzja uzytkownika).
- Skrypt czeka na wymagane checki CI i recenzje claude-review, merguje TYLKO przy APPROVE i czeka na deploy Vercela. Przy REQUEST CHANGES popraw findings (maks 2 rundy) i uruchom ponownie. Jesli nadal nie ma APPROVE, zostaw PR otwarty i zaloguj powod. Nigdy nie merguj recznie ani z pominieciem recenzji.
- Po deployu sprawdz: curl https://kamiljan.com/case-studies?lang=pl zawiera tytul nowego case study, a strona odpowiada 200.

KROK 5 — RAPORT: dopisz do logu /home/kamil-jan/Obsidian/MAIN/Claude Memory/Log/shop-app-case-study.md status: "VERIFIED — PR #<n> zmergowany, na prod widoczny tytul '<tytul>'" / "REPORT-ONLY — <powod + dowod>" / "FAILED — <dokladny blad>". Nie deklaruj sukcesu bez dowodu.
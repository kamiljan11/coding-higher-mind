# PG · Paradygmat i „sztuka" kodu floty PG (2026-09-05)

Ladowane przez: PG-core (7. KOD) przy kazdym zadaniu kodowym; code-reviewer (rubryka czytelnosci); design.md.

## Kryterium nadrzedne: OBCY PRZEJMUJE REPO W 1 DZIEN

Kazda decyzja stylu rozstrzyga sie pytaniem: *czy senior, ktory nigdy nie widzial tego repo i nie ma nas
pod reka, uruchomi je w 15 min, znajdzie miejsce zmiany w 15 min i zrozumie DLACZEGO tak jest bez czytania
transkryptow Claude?* Jesli nie — kod jest za sprytny, za rozproszony albo nieudokumentowany.
(Kernighan: debugowanie jest 2x trudniejsze niz pisanie; Ousterhout: zlozonosc = zaleznosci + obscurity.)

Test „obcego" (deterministyczny, skill `pg-review` -> product-reviewer): swiezy agent bez kontekstu sesji
odpowiada na 10 pytan o repo (jak uruchomic? gdzie liczy sie cena? gdzie jest autoryzacja? co robi X?
jak dodac pole do formularza?) uzywajac TYLKO README/ARCHITECTURE/ADR/kodu. <8/10 = repo nieprzejmowalne.

## Domyslny styl (TypeScript / React / Node / edge functions)

| Zasada | Regula | how_to_check |
|---|---|---|
| **Functional core, imperative shell** | logika domenowa (ceny, VAT, daty, walidacje, rabaty) = czyste funkcje bez I/O; efekty (DB, HTTP, czas, random, storage) tylko na brzegu (route/handler/hook) | czyste funkcje w `lib/` nie importuja supabase/fetch: `rg -l "supabase|fetch\(" src/lib` ma byc puste |
| **Moduly + funkcje > klasy** | domyslnie eksportowane funkcje i typy; plik = jeden temat | `max-classes-per-file: 1`; klasa wymaga uzasadnienia w komentarzu WHY |
| **Dane = plain objects + typy** | `type`/`interface` + obiekty; brak getterow/setterow, brak `this` w logice | `rg "get \w+\(\)|set \w+\("` w `src/lib` = 0 |
| **Niemutowalnosc** | `const`, spread/`structuredClone`, `readonly`/`ReadonlyArray` w typach publicznych; nigdy mutacja parametru | `prefer-const`, `no-param-reassign` = error |
| **Kompozycja > dziedziczenie** | `extends` tylko dla `Error` i klas frameworka; glebokosc 1; brak abstrakcyjnych klas bazowych „na przyszlosc" | `rg "class \w+ extends (?!Error)"` -> kazdy hit potrzebuje ADR |
| **Polimorfizm przez unie, nie hierarchie** | `type Payment = {kind:'rapyd',...} \| {kind:'cash',...}` + `switch` z `never` na koncu | `@typescript-eslint/switch-exhaustiveness-check: error` |
| **Parse, don't validate** | dane z zewnatrz (formularz, webhook, API, DB row) przechodza przez `zod.safeParse` NA GRANICY i dalej sa typowane; wewnatrz zero `as` | `rg "as unknown as|as any"` = 0 w `src/`; walidacja tylko w warstwie brzegowej |
| **Bledy** | brzeg: `Result`/`safeParse` (total function); srodek: `throw` typowanego bledu (`class XError extends Error` z `code`); zero pustych `catch` | lint-file blokuje `catch` bez logu/rethrow (fleet-metrics: silentCatch) |
| **Closures** | OK do enkapsulacji stanu w hookach/fabrykach (`createClient(config)`); NIE do „sprytnych" HOF | funkcja zwracajaca funkcje = max 1 poziom |
| **Currying / point-free / pipe** | NIE (obcy czyta to 3x dluzej). Zwykle wywolania, max 3 kroki kompozycji w jednej linii | review: „czy junior przeczyta to bez rozwijania w glowie?" |
| **Rekursja** | tylko dla struktur drzewiastych (drzewo kategorii, menu, JSON), zawsze z limitem glebokosci + test na cykl | test z `depth > MAX` i z cyklem |
| **Dekoratory** | nie (brak frameworka, ktory ich wymaga; TS decorators = ruchomy standard). W Pythonie tylko `@dataclass`, `@lru_cache`, `@pytest.fixture`, `@app.get` | `rg "^@" src` = 0 w TS |
| **Klasy — kiedy TAK** | obiekt ma STAN + NIEZMIENNIKI + cykl zycia: klient API z retry/circuit breaker, maszyna stanow zlecenia, hierarchia `Error`, kolejka. Wtedy: `#private`, waski interfejs (Ousterhout: deep module), brak getterow/setterow bez logiki | klasa z >6 publicznymi metodami -> podzial |
| **Nazwy** | z jezyka domeny klienta (zlecenie/`job`, wizyta/`visit`, `orgId`, `priceIsk`), pelne slowa, jednostka w nazwie (`amountIsk`, `timeoutMs`, `createdAt`); slownik PL/EN/IS w `docs/GLOSSARY.md`; jednoliterowe tylko `i j k x y _` | fleet-metrics: shortIdentifiers; review |
| **Komentarze** | tylko DLACZEGO (ograniczenie, workaround, regula biznesowa, link do ADR/incydentu). Komentarz powtarzajacy kod = usun. Docstring (TSDoc) tylko na eksportach publicznych modulu | `jsdoc/require-jsdoc` publicOnly; review: „komentarz opisuje CO?" -> usun |
| **Rozmiar** | funkcja <= 60 linii, plik <= 400, glebokosc <= 3, parametry <= 4 (obiekt opcji), zlozonosc cyklomatyczna <= 10 | eslint `complexity`, `max-lines-per-function`, `max-depth`, `max-params` |
| **Magic numbers/strings** | nazwane stale u gory pliku z jednostka i powodem | `no-magic-numbers` (warn; ignore 0,1,-1) |
| **Testy jako spec** | `it('should <obserwowalny skutek>')`; asercje na zachowaniu, nie na implementacji; bug = najpierw failing test | `vitest/consistent-test-it`, `expect-expect`; PR checkbox |

## Python (skrypty, narzedzia, menedzer sekretow (np. Infisical CLI))

Funkcje + `@dataclass(frozen=True)` / pydantic na granicy; klasy dla stanu; type hints obowiazkowe (pyright);
brak metaklas, wlasnych dekoratorow, `__getattr__` magii; comprehension zamiast `map/filter/lambda`;
`B006` (mutable default) = error; `subprocess.run(check=...)` jawnie; jeden plik = jedno narzedzie z `main()`.

## SQL / Supabase

Autoryzacja w RLS (USING **i** WITH CHECK), nie w kliencie. `SECURITY DEFINER` = ostatecznosc, z `SET search_path`,
`REVOKE EXECUTE FROM public`, sprawdzeniem `auth.uid()`/org w ciele. Kazda nowa tabela z FK do encji tenantowej
ma `org_id` albo trigger `%same_org%` + test negatywny cross-tenant. Migracje wstecznie kompatybilne (dwuetapowe).
Deterministycznie: `bin/sql-migration-lint.js --strict`.

## Co z OOP/FP (boot.dev) bierzemy, a co swiadomie NIE

| Zasada | Werdykt | Dlaczego |
|---|---|---|
| Encapsulation | TAK, ale przez MODUL (eksportuj malo), nie przez klase z getterami | Ousterhout: deep module = maly interfejs, duza implementacja |
| Abstraction | TAK, ale dopiero przy 2. realnym uzyciu (rule of three light) | abstrakcja „na zapas" = zlozonosc bez zwrotu; GitClear: LLM i tak generuje za duzo warstw |
| Inheritance | NIE (poza `Error`/framework) | krucha baza, Hyrum, trudne do przejecia |
| Polymorphism | TAK — unie dyskryminowane + `never`; interfejsy tylko dla wstrzykiwania zaleznosci w testach | mechanicznie sprawdzalne przez tsc |
| SOLID | SRP (modul = jeden temat), ISP (male typy props), DIP (zaleznosci jako parametry funkcji dla testowalnosci) — TAK; OCP przez konfiguracje/unie; LSP bez hierarchii nieistotne | tylko to, co da sie sprawdzic |
| First-class functions | TAK (callbacki, hooki, fabryki) | idiom JS/React |
| Pure functions | TAK — rdzen domenowy | testowalnosc bez mockow; deterministyczne |
| Recursion | ograniczona (drzewa) | stack, czytelnosc |
| Function transformations / currying | NIE | koszt czytania przez obcego |
| Closures | TAK, plytko | stan modulu/hooka |
| Decorators | NIE w TS | brak frameworka, standard w ruchu |
| Immutability | TAK | mniej bugow ze stanu, latwe porownania w React |

## Kiedy zmienic projekt systemu (sygnaly refaktoru — mierzone, nie odczuwane)

| Sygnal | Prog | Reakcja |
|---|---|---|
| change amplification | 1 zmiana biznesowa dotyka > 3 plikow w roznych katalogach | wydziel modul z jednym wejsciem (ADR) |
| rozmiar | plik > 400 linii, funkcja > 60, komponent > 300 | podzial wg odpowiedzialnosci, nie wg technologii |
| ten sam bug w 2 miejscach | 2 | duplikacja logiki -> jeden util (grep-first) |
| test wymaga > 5 mockow | 5 | logika zlepiona z I/O -> functional core |
| cykliczne importy / import wbrew warstwom | 1 nowy | granice modulow zle ustawione — bramka `bin/module-boundaries.js` w pre-push (nowy cykl = blok; warstwy z bloku json w `docs/ARCHITECTURE.md`; stare cykle = ostrzezenie) |
| fan-in zmienianego pliku | > 40 importerow | blast radius: design.md B3 przed edycja; rozwazyc podzial modulu (`module-boundaries.js` ostrzega) |
| pytanie „gdzie to jest?" | > 1 raz od tej samej osoby/agenta | brak mapy: ARCHITECTURE.md + nazwy katalogow wg domeny |
| nowy wymog nie miesci sie w modelu danych | 1 | zmiana schematu dwuetapowa + ADR, nie flagi-obejscia |

Zasady zmiany: prawo Galla (dzialajacy prosty system -> ewolucja, nie przepisanie); strangler pattern
(nowy modul obok, przelaczanie, usuniecie starego); refaktor = OSOBNY PR bez zmian funkcjonalnych;
dlug historyczny tylko na wskazanie uzytkownika (2026-08-09) — ale funkcje, ktorej dotykasz, zostaw czystsza.

## Handover checklist (repo przejmowalne)

- `README.md`: co to jest (3 zdania), jak uruchomic lokalnie w 15 min (komendy, env z `.env.example`), jak testowac, jak deployowac (Lovable vs Vercel!), gdzie logi.
- `docs/ARCHITECTURE.md` (1 strona + diagram): moduly, przeplyw danych, granice, co jest gdzie.
- `docs/adr/`: kazda decyzja nieodwracalna z DLACZEGO i odrzucona alternatywa.
- `docs/GLOSSARY.md`: terminy domeny PL/EN/IS (zlecenie=job, kennitala, ISK bez groszy).
- `docs/RUNBOOK.md`: co robic o 3 w nocy (alerty, rollback, kill switch, kontakty do uslug).
- Stack „boring" z wersjami w README; zero zaleznosci bez powodu (McKinley: 3 zetony innowacji).
- `CHANGELOG.md` aktualny (bramka), commity conventional (bramka).
- Testy uruchamialne jedna komenda; e2e smoke krytycznych sciezek.

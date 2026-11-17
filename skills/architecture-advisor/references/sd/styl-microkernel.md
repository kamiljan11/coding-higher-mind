# Styl: microkernel (rdzeń + pluginy) — karta głęboka

Źródła (research 2026-11-07, parafraza; rozdział książki niedostępny, 403): Richards/Ford „Fundamentals of Software Architecture” rozdz. 13 (2. wyd.) i Richards „Software Architecture Patterns” przez notatki [romerogabriel](https://romerogabriel.github.io/mastering-software-architecture/arch_styles/microkernel_arch), [besthub](https://www.besthub.dev/articles/microkernel-architecture-core-concepts-plug-in-patterns-and-when-to-use-it-53425dfe5dd1), [the-evise](https://the-evise.github.io/fundamentals-of-software-architecture/style-comparison.html); [archman.dev](https://archman.dev/docs/architectural-styles/microkernel-plugin); Microsoft Azure Architecture Center, multitenant ([konfiguracja](https://learn.microsoft.com/en-us/azure/architecture/guide/multitenant/approaches/deployment-configuration), [dane](https://learn.microsoft.com/azure/architecture/guide/multitenant/approaches/storage-data)); Cockburn „Hexagonal Architecture” ([link](https://alistair.cockburn.us/hexagonal-architecture/)); Fowler „Feature Toggles” ([link](https://martinfowler.com/articles/feature-toggles.html)); Metz „The Wrong Abstraction” ([link](https://sandimetz.com/blog/2016/1/20/the-wrong-abstraction)); Supabase RLS ([link](https://supabase.com/docs/guides/database/postgres/row-level-security)); rule of three: Wikipedia ([link](https://en.wikipedia.org/wiki/Rule_of_three_(computer_programming))) + Metz. Oznaczenia: **[P]** = ≥ 2 niezależne źródła, **[1]** = jedno źródło, `[własny]` = nasz wniosek bez źródła. Kurs DevSteer opisuje ten styl tylko w macierzy (lekcja 19).

## 1. Definicja i topologia
- **Mały rdzeń** z minimum potrzebnym do działania + **niezależne pluginy** za standardowym kontraktem [P]. Praktycznie: rdzeń = wspólna ścieżka („happy path”), a zmienna logika (jurysdykcja, klient, reguła) idzie do pluginów [P].
- **Rejestr** wie, jakie pluginy istnieją i jak je wywołać (nazwa, kontrakt, protokół gdy zdalny) [P]. Wystarczy zwykła mapa w pamięci; OSGi/Consul tylko przy realnej potrzebie [P].
- **Kontrakt** = zachowanie, wejście, wyjście, jeden dla wszystkich pluginów danego punktu rozszerzeń [P]. Obcy dostawca z innym kontraktem → **adapter** tłumaczy, rdzeń bez przypadków szczególnych [P].
- Pluginy kompilowane z aplikacją (zmiana = redeploy całości, prosto) vs ładowane w runtime [1]. Pluginy w procesie vs zdalne: zdalne czynią system rozproszonym i dużo droższym, tylko z konkretnego wymagania [P].
- **Kwant = 1** (wszystko przechodzi przez rdzeń, także przy zdalnych pluginach) [P]. Partycjonowanie: źródła różnią się (techniczne, domenowe albo oba) [P, z rozbieżnością].
- Rdzeń bywa warstwowy albo modularnym monolitem [1]. Przykłady: IDE (Eclipse, VS Code), przeglądarki z rozszerzeniami, Jira, obsługa roszczeń z regułą per stan jako plugin [P].

## 2. Warianty
| Wariant | Co daje | Co kosztuje |
|---|---|---|
| **dane / konfiguracja / uprawnienia planu** (bez kodu per klient) [1, Microsoft] | ustawienia klient edytuje sam, a uprawnienia planu zmienia tylko staff (pkt 4); zero deployu | tylko wartości, nie inne zachowanie |
| **port + adapter** dla zewnętrznej zależności (płatności, dostawca części, SMS) [1, Cockburn] | wymiana dostawcy w jednym miejscu, test na adapterze w pamięci | jedna abstrakcja więcej |
| **rejestr pluginów** (mapa: klucz kontekstu → implementacja) [P] | nowe zachowanie = nowy plugin, rdzeń bez zmian | kontrakt musi być stabilny |
| silnik reguł / workflow / szablony [1] | reguły jako dane, nie kod | silnik to osobny produkt do utrzymania |
| pluginy zdalne [P] | osobne skalowanie pluginu | system rozproszony, koszt sieci |

**Flaga ≠ plugin** `[własny, z definicji Fowlera]`: flaga przełącza ścieżkę w tym samym kodzie i ma żyć krótko (poza flagami uprawnień); plugin to osobny moduł za kontraktem. Do odcinania funkcji według planu cenowego Microsoft zaleca uprawnienia licencyjne (entitlements), nie flagi [1].

## 3. Kiedy TAK / kiedy NIE
**TAK:**
- produkt z jasną wspólną ścieżką i wariantami wokół niej, gdzie zmienność siedzi w regułach, konfiguracji albo integracjach per klient [P];
- głównym wymaganiem jest rozszerzalność i dopasowanie do klienta (przy organizacji domenowej i zespołach wygrywa modulith) [1];
- **u nas:** jeden produkt sprzedawany ≥ 3 klientom, którzy różnią się **zachowaniem**, nie tylko wartościami `[własny + rule of three, P]` (`style-eval.md` sc. 3).
**NIE:**
- potrzebna wysoka skalowalność, elastyczność albo odporność (rdzeń = wąskie gardło) [P];
- pluginy musiałyby się ze sobą komunikować [P];
- rdzeń często się zmienia (źle oceniona zmienność) [1];
- jeden wariant albo dwa: zostaw duplikację, bo zła abstrakcja kosztuje więcej niż powtórzony kod [P, rule of three + Metz].
**Progi liczbowe** („plugin od N klientów”): źródła ich nie podają. Nasz próg ≥ 3 realne implementacje to rule of three (Roberts/Fowler) [P].

## 4. U nas (Supabase + Next.js) `[własny, oparte na źródłach z pkt 3 i 5]`
| Pojęcie | Odpowiednik we flocie |
|---|---|
| rdzeń | moduły domenowe modulitu (`src/features/<obszar>`), bez nazwy żadnego klienta |
| wariant = wartość | wiersz w tabeli ustawień organizacji (`org_settings`, stawki, progi) edytowany w panelu |
| uprawnienia planu i klucz pluginu | osobna tabela (`org_entitlements`): tenant ma tylko `select` ograniczony RLS do własnej organizacji (`using (is_member(org_id))`), zapis wyłącznie `service_role` albo staff. Staff = `has_role(auth.uid(), 'staff')` z `user_roles` (`05 › Tożsamość i autoryzacja`), nigdy `user_metadata`. Rola `staff` jest globalna (PG), a `user_roles` zapisuje wyłącznie `service_role`, bo inaczej admin organizacji nada sobie `staff`. Test: członek, nie-członek, admin organizacji próbujący `update` oraz insert `staff` do `user_roles` przez admina organizacji (oczekiwane 42501). Nie w `org_settings`, bo polityka `update using (is_member(org_id))` pozwoliłaby adminowi organizacji włączyć sobie płatny plan albo cudzy plugin `[własny]` |
| wariant = zachowanie | plugin w `src/plugins/<punkt>/<implementacja>.ts` za typem kontraktu, wybierany z rejestru po kluczu z danych organizacji |
| integracja zewnętrzna | port + adapter w `src/integrations/<dostawca>` (`01-fundamenty.md` › pkt 3, hexagonal tylko dla dostawców) |
| tenant w tokenie | `app_metadata`, nie `user_metadata` (użytkownik może edytować `user_metadata`) [1, Supabase docs]. JWT jest nieświeży do odświeżenia [1, Supabase docs], więc RLS sprawdza członkostwo w tabeli, nie sam claim |
| izolacja danych tenanta | RLS na każdej tabeli tenantowej + test członka i nie-członka [1, Supabase docs]; `service_role` tylko na serwerze |
| dane własne tenanta | osobna tabela na pola niestandardowe, nie kolumna pod jednego klienta [1, Microsoft]. Ta tabela i tabele pluginu spełniają wymagania tabeli tenantowej z `02 › Multi-tenancy w danych`: `org_id` + indeks, RLS z `WITH CHECK`, `UNIQUE (org_id, klucz)`, test cross-tenant. Kształt (JSONB z walidacją vs EAV) zapisz w ADR, bo źródła go nie rozstrzygają `[własny]` |

## 5. Reguły konstrukcyjne
1. **Najpierw dane, potem kod** [1, Microsoft]: wszystko, co różni klientów wartością, idzie do konfiguracji. Plugin dopiero dla innego zachowania.
2. **Rdzeń nie zna konkretnych pluginów** [P]: wywołuje przez rejestr i kontrakt. Kontrakt jest stabilny, bo jego zmiana wymusza zmianę rdzenia i wszystkich pluginów [1].
3. **Pluginy nie zależą od siebie** [P]: komunikacja tylko przez rdzeń albo zdarzenia; kolejność inicjalizacji pluginów nie może mieć znaczenia [1].
4. **Dane pluginu:** rdzeń przekazuje pluginowi dane; plugin może mieć własne tabele dostępne tylko dla niego; zmiana bazy rdzenia nie dotyka pluginów [1].
5. **Test kontraktowy:** ten sam zestaw testów uruchamiany dla każdej implementacji punktu rozszerzeń (Cockburn: ten sam test dla różnych adapterów) [1]; plugin testowany w izolacji z rejestrem w pamięci [P].
6. **Decyzja w jednym miejscu:** wybór wariantu w jednym obiekcie decyzyjnym (rejestr), nie `if` rozsiany po kodzie [1, Fowler].
7. Pluginy w procesie **nie izolują** awarii ani bezpieczeństwa [1]; izolację tenanta daje RLS, nie plugin.

## 6. Antywzorce → detekcja
| Antywzorzec | Komenda `[własny]` |
|---|---|
| rozgałęzienie per klient w rdzeniu (core bloat [1]) | `rg -n -i "(org\|tenant\|client)_?(id\|slug\|name)\s*===?\s*['\"]" src --glob '!src/plugins/**'` |
| plugin importuje inny plugin [P] | `rg -n "from ['\"](\./\|\.\./\|.*plugins/)" src/plugins` (lista do przeglądu: import innej implementacji, także siostrzanej `./b`, = błąd; import kontraktu punktu i `plugins/registry` = OK) |
| rdzeń importuje konkretny plugin | `rg -n "from ['\"].*plugins/[^'\"]+/" src --glob '!src/plugins/**' --glob '!src/plugins/registry*'` |
| fork repo per klient [1, Microsoft] | `git remote -v` + lista repo floty z tym samym produktem |
| kolumna pod jednego klienta [1, Microsoft] | `rg -n -i "add column (if not exists )?[a-z_]*(client\|_custom_)" supabase/migrations` + przegląd nazw |
| system pluginów dla 1–2 wariantów (zła abstrakcja [1, Metz]) | `rg -n "register(Plugin\|Adapter\|Provider)" src` < 3 implementacje na punkt rozszerzeń |
| flagi bez daty wygaśnięcia [1, Fowler] | `rg -n "flag\|toggle" src --glob '*.ts' -l` + brak `expires`/właściciela w definicji flagi |

## 7. Fitness functions `[własny]`
- 0 trafień rozgałęzień per klient w rdzeniu (pierwsza komenda z tabeli) jako test w CI.
- `module-boundaries.js`: `plugins/*` nie importują siebie nawzajem; rdzeń importuje tylko `plugins/registry`.
- Każdy punkt rozszerzeń ma test kontraktowy, który przechodzi dla każdej implementacji.
- Liczba aktywnych flag z limitem i datą wygaśnięcia (zasada z Fowlera [1]; wartości progów źródła nie podają).

## 8. Ewolucja
- **Wycofanie pluginu:** plugin kompilowany z aplikacją cofa się tylko poprzednim deployem; wyłączenie u jednego tenanta bez deployu = zmiana klucza pluginu w `org_entitlements` na wariant domyślny (staff). W repo Lovable zmiana pluginu = push = deploy `[własny]`.
- **Konfiguracja → port/adapter → rejestr → (rzadko) pluginy zdalne** [1 dla kroków 1–2, P dla 3–4]. Każdy krok dopiero przy wyzwalaczu: drugi dostawca tej samej zdolności (adapter), trzeci wariant zachowania (rejestr), potrzeba osobnego skalowania lub izolacji awarii pluginu (usługa, `styl-service-based.md`).
- Zdalny plugin nie zmienia kwantu (nadal 1), ale dokłada koszt systemu rozproszonego [P].
- Microsoft dopuszcza mieszanie: wspólna baza dla większości tenantów i osobna instancja dla nietypowego klienta [1] — u nas to decyzja z ADR, nie fork.

## 9. Worksheet — jak czytać ten styl (kierunek, nie wynik)
Dwa źródła wtórne zgodne: testowalność, wdrażalność, utrzymywalność i ewolucyjność **3/5**; skalowalność, elastyczność i odporność **słabe** [P tylko dla tych wartości]. Pozostałe z jednego źródła: prostota 4 (layered i modulith: 5), skalowalność/elastyczność/odporność 1 [1, the-evise]; prostota i koszt jako mocne strony [1, besthub]. Kierunek skali kosztu w drugim źródle jest niejasny. Oficjalnej tabeli nie pobrano (403). Czytaj `[własny]`: microkernel jest **mocniejszy od layered i modulitu w modularności i ewolucyjności**, a **nieco słabszy w prostocie**. Opłaca się tylko tam, gdzie zmienność naprawdę siedzi w pluginach.

## 10. Stan w PG (zweryfikowany 2026-11-07)
- MAMY: werdykt NISZA i reguła „najpierw dane” (`style-architektury.md` › microkernel), próg ≥ 3 implementacje (`style-eval.md` sc. 3), port + adapter dla dostawców (`01-fundamenty.md`), RLS i `service_role` tylko na serwerze (karty `05`, rubryka security).
- CZĘŚCIOWO: rozgałęzienia per klient — tylko komenda w tej karcie, bez bramki.
- BRAK (do rozważenia przy pierwszym produkcie u ≥ 3 klientów, nie blokada): test kontraktowy pluginów w szablonie repo.

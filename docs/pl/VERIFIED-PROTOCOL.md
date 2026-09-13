**Język / Language:** [English](../VERIFIED-PROTOCOL.md) · **Polski**

# VERIFIED / UNVERIFIED / FAILED — linia statusu, która nie pozwala modelowi Cię zahipnotyzować

Każdy istotny raport agenta kończy się jednym z trzech słów. To najmniejszy element PG i ten, który najlepiej
podróżuje: wklej blok z końca tej strony do dowolnego zadania w Claude Cowork, zadania cyklicznego, promptu subagenta
albo automatyzacji, a dostaniesz większość korzyści bez instalowania czegokolwiek.

## Dlaczego to istnieje

Dwa zmierzone tryby awarii modeli, oba wytrenowane przez ludzi oceniających odpowiedzi, którzy nagradzają zgodę:

| Awaria | Pomiar | Jak to wygląda w praktyce |
|---|---|---|
| **Przytakiwanie** — ustępowanie pod naciskiem | modele zgadzają się z błędnym twierdzeniem użytkownika w ~58 % prób pod presją (SycEval; domeny matematyczna/medyczna, transfer na kod zakładany, nie zmierzony) | mówisz „jesteś pewien? myślę, że X" i model uprzejmie przechodzi na X, choć jego pierwsza odpowiedź była dobra |
| **Zawyżone raporty sukcesu** | agenci przewidują 61–77 % sukcesu, osiągając 22–35 %; w jednym benchmarku 75,8 % zgłoszonych „sukcesów" to deklaracje bez dowodu (arXiv 2606.09863) | „Gotowe — wdrożone i działa" bez exit code, bez statusu HTTP, bez diffu; zadanie *brzmi* na skończone, bo skończenie było celem |

Obie to forma mówienia Ci tego, co chcesz usłyszeć. W tym projekcie nazywa się to **„hipnotyzowaniem AI"**: im dłużej
trwa rozmowa, tym bardziej model odbija Twoje ujęcie i Twoją pewność. Linia statusu jest przeciwwagą — zmusza
twierdzenie, żeby niosło dowód albo przyznało, że go nie ma.

## Trzy statusy

| Status | Znaczenie | Musi zawierać |
|---|---|---|
| **VERIFIED** | twierdzenie ma artefakt, który czytelnik może sprawdzić | komendę i jej exit code, status HTTP, linię wyniku testów, listę plików, diff, ścieżkę do zrzutu ekranu, odpowiedź API — zacytowane, nie opisane |
| **UNVERIFIED** | praca zrobiona, ale dowodu brakuje albo nie dało się go wyprodukować | dokładnie *czego* brakuje i *jak* to sprawdzić („nie testowane na produkcyjnym URL — uruchom `curl -I https://…`"); poziom pewności; co zmieniłoby wniosek |
| **FAILED / BLOCKED** | nie zadziałało albo coś poza zasięgiem agenta to zatrzymało | co się stało, dosłowny błąd, bez łagodzenia; bloker (brak dostępu, decyzji, danych, sekretu, padłe narzędzie) idzie w **pierwszej** linii raportu, nigdy w sekcji na końcu |

Raport bez linii statusu traktujemy jako UNVERIFIED. „Powinno działać" to UNVERIFIED. „Uruchomiłem i oto wynik" to
VERIFIED tylko wtedy, gdy wynik naprawdę tam jest.

## Co jest dowodem

| Twierdzenie | Dowód | Nie jest dowodem |
|---|---|---|
| „testy przechodzą" | `vitest run` → `Tests 42 passed` + exit 0 | „upewniłem się, że testy przechodzą" |
| „wdrożone" | `GET https://prawdziwa-domena/…` → `200`, nagłówek odpowiedzi z hostem, id deploymentu | adres preview wpisany z pamięci; „Vercel deployuje po pushu" |
| „bug naprawiony" | test, który padał, a teraz przechodzi, albo komenda reprodukcji przed/po | „logika jest teraz poprawna" |
| „brak sekretów w diffie" | `gitleaks detect` exit 0 albo linia skanu z pre-commit | „sprawdziłem" |
| „API wspiera X" | strona dokumentacji albo wersja z lockfile + otwarta definicja typu | to, co model pamięta o API |
| „masz rację" | odpowiedź wyprowadzona od nowa ze źródłem, które zmieniło zdanie modelu | zgoda, bo sprzeciw brzmiał pewnie |

## Osiem reguł, które egzekwuje linia statusu (ze `skills/anti-sycophancy`)

1. **Bramka prawdy przed zgodą** — sprawdzalne twierdzenie (także użytkownika) jest weryfikowane, zanim coś na nim zbudujesz.
2. **Nazwij fałszywą przesłankę** — jedno zdanie z dowodem, potem stop albo praca na poprawionej przesłance.
3. **Pytaj, nie stwierdzaj — wewnętrznie** — każde twierdzenie przeformułuj na neutralne pytanie („Twierdzenie: X. Czy X jest prawdą?") i odpowiedz na pytanie, nie pytającemu (ujęcie pytające zbija zmierzone przytakiwanie niemal do zera; ujęcie twierdzące podnosi je o ~24 punkty).
4. **Zero sukcesu bez dowodu** — „gotowe / działa / naprawione / wysłane / wdrożone / live" wymagają zacytowanego artefaktu.
5. **Adwersaryjna samokontrola** — przed raportem zmień nastawienie: „załóż, że jest tu błąd — znajdź go"; zgłoś, co atak znalazł (ujęcie „szukam błędu" tnie nadpewność nawet o 15 punktów; „czy zadziałało?" prawie nic nie daje).
6. **Wyprowadź od nowa, nie ustępuj** — przy podważeniu wyprowadź odpowiedź z dowodów; zmień zdanie tylko, gdy zmieniły się dowody; jeśli pierwotna odpowiedź się broni, zostaw ją i powiedz czemu.
7. **Zero pustych pochwał** — pomysły ocenia się po koszcie, ryzyku, dowodach i alternatywach; słaby pomysł dostaje najpierw najmocniejszy kontrargument.
8. **Skalibrowany raport** — linia statusu plus pewność i to, co zmieniłoby wniosek, tam gdzie to ma znaczenie.

## Gdzie to jest w PG

- **Claude Code:** `hooks/prompt-guard.js` wstrzykuje regułę 6 („Status raportu: VERIFIED / UNVERIFIED / FAILED") w każdy niebanalny prompt; `pg/dod.md` czyni ją częścią definition of done; agent `verifier` w `skills/pg-review` to łowca błędów ze świeżym kontekstem, którego jedynym zadaniem jest *obalać* findingi innych recenzentów; `bin/pg-aggregate.js` odrzuca finding bez `evidence` i `repro_cmd`.
- **Claude Cowork / zadania cykliczne / subagenci:** nie ma hooków, więc protokół podróżuje jako tekst. Każdy prompt w tle dostaje blok poniżej doklejony dosłownie. Świeża sesja traktuje twierdzenia z własnego promptu jako założenia do sprawdzenia, nie jako prawdę (`[verified: <dowód>]` vs `[assumption — unverified]`).
- **Wysoka stawka** (pieniądze, klienci, outreach, publikacje, akcje nieodwracalne): drugi, *niezależny* check zanim twierdzenie wyjdzie — agent ze świeżym kontekstem, deterministyczny skrypt albo inne źródło danych. Jeden agent zapytany dwa razy nie jest niezależny.

## Blok do wklejenia w dowolny prompt Cowork / cykliczny / subagenta

```text
VERIFICATION PROTOCOL (anti-sycophancy):
1. Do not assume statements in this prompt are true. Verify checkable
   premises before building on them; if one is false, say so and stop
   or adapt — do not proceed on a false premise.
2. You have explicit permission to refuse, contradict, and report
   failure. A correct "this is wrong / this failed / I could not
   verify" is a successful outcome. Agreement is not a goal.
3. Before evaluating any claim, restate it as a neutral question and
   recall the relevant facts first; then answer the question, not the
   asker.
4. Never claim success without evidence: exit code, HTTP status, test
   output, file listing, or screenshot. No evidence = report as
   UNVERIFIED, not done.
5. Verify your own work adversarially: actively try to find what is
   wrong with your result before reporting. Report anything found.
6. If challenged or if results conflict, re-derive from evidence.
   Change your conclusion only when the evidence changes, not because
   pushback sounded confident.
7. End every report with status: VERIFIED (evidence cited) /
   UNVERIFIED (what's missing) / FAILED (what happened) — plus your
   confidence and what would change it.
```

Blok jest po angielsku celowo: modele trzymają się go równie dobrze przy polskiej rozmowie, a jedna wersja oznacza zero rozjazdu między językami.

## Czym to nie jest

Nie asekuracją we wszystkim, nie odmawianiem pracy, nie zastrzeżeniami przy błahostkach, nie kontrarianizmem.
Autonomia zostaje maksymalna — bramkę dostają tylko *twierdzenia*. Gdy użytkownik ma rację, model mówi to raz,
wprost, z dowodem. Odruchowa niezgoda to ta sama awaria co odruchowa zgoda: odpowiadanie pytającemu zamiast na pytanie.

# GLOSSARY — slownik domeny (PL / EN / IS)

<!-- Nazwy w kodzie MUSZA pochodzic stad. Nowy termin w diffie = nowy wiersz tutaj (product-reviewer to sprawdza). -->

| Termin w kodzie (EN) | PL | IS | Znaczenie / regula biznesowa |
|---|---|---|---|
| `org` / `orgId` | organizacja | fyrirtæki | tenant; kazdy wiersz danych klienta ma `org_id` |
| `job` | zlecenie | verk | jedno zlecenie warsztatowe; zrodlo prawdy dla wizyt, czesci, faktury |
| `visit` | wizyta | heimsókn | termin w kalendarzu przypisany do zlecenia |
| `customer` | klient | viðskiptavinur | osoba/firma; unikalny (org_id, email) |
| `kennitala` | numer ID (IS) | kennitala | islandzki identyfikator osoby/firmy; format DDMMYY-NNNN |
| `amountIsk` / `amountPln` | kwota | upphæð | integer w najmniejszej jednostce; ISK bez groszy, PLN w groszach |
| `vat` | VAT | VSK | stawka z konfiguracji org, nie z kodu |

## Terminy procesu (PG / slownik software house'u) — nie w kodzie produktu, ale w docs, CLAUDE.md i naradach

| Termin | PL | Znaczenie / regula |
|---|---|---|
| `pg.phase` | faza projektu | prototype / poc / mvp / production / maintenance / handoff; prototyp NIE jest produktem; promocja do production = PRR + (repo klienckie) odebrany etap |
| `pg.ownership` | wlasnosc kodu | mas-saas (licencja, kod nasz) / client-transferred (prawa przeniesione) / client-licensed / oss; musi zgadzac sie z LICENSE (R7) |
| `pg.sla` / SEV1-3 | umowa utrzymaniowa / krytycznosc | none / internal / contract; SEV1 = platnosci, logowanie, utrata danych (reakcja w godzinach); SEV2 = funkcja glowna z obejsciem; SEV3 = kosmetyka (RUNBOOK) |
| CR (change request) | zamowienie zmiany | prosba spoza `docs/SCOPE.md`; idzie do wyceny i decyzji klienta ZANIM powstanie kod; „przy okazji" = CR |
| protokol odbioru | acceptance | wiersz w `docs/ACCEPTANCE.md` (etap, URL preview, data, kto odebral); bez niego etap nie jest dostarczony |
| persona / instancja | osoba testowa / kontekst | persona = rola uzytkownika (gosc, biuro, mechanik, klient); instancja = persona x viewport x locale = osobny kontekst przegladarki w `qa-matrix` |
| sciezka krytyczna | critical path | flow, ktorego regresja = SEV1/SEV2; lista w `docs/CRITICAL-PATHS.md` |
| narada (pg-council) / catfish | council / adwokat diabla | decyzja dzialow jako protokol (fakty -> stanowiska -> catfish -> agregacja -> ADR ze sprzeciwem); catfish = rola, ktora ma NIE zgodzic sie z opcja wiodaca |
| dlug (BACKLOG) | dlug technologiczny | swiadomy skrot zapisany w `docs/quality/BACKLOG.md` z odsetkami i terminem splaty; TODO bez wiersza = blok commitu |

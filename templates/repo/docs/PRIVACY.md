# PRIVACY — inwentarz danych osobowych (RODO) i procesorow

<!-- Jedno zrodlo prawdy o PII w tym repo. Czyta: product-reviewer (nowa kolumna PII bez wiersza = major),
     security-reviewer (PII do zewnetrznego API bez wpisu "Procesor" = blocker T3), bramka
     `node ~/.claude/bin/pii-inventory-gate.js --repo .` (staged migracje z kolumna PII -> wiersz tutaj).
     Kolumna "Tabela.kolumna" MUSI byc w formacie `tabela.kolumna` (parsowana). -->

## Dane osobowe, ktore przetwarzamy

| Dana | Tabela.kolumna | Cel | Podstawa (RODO art. 6) | Retencja | Procesor (DPA) | Jak usunac |
|---|---|---|---|---|---|---|
| e-mail klienta | `customers.email` | kontakt ws. zlecenia, faktura | umowa (1b) | 5 lat od ostatniej faktury (ksiegowosc) | Supabase, Resend | RPC `erase_customer(id)` |
| telefon klienta | `customers.phone` | SMS o statusie | umowa (1b) | jak wyzej | Supabase, Twilio | jak wyzej |

## Procesorzy (kazdy z podpisanym DPA albo warunkami, ktore je zawieraja)

| Procesor | Co dostaje | DPA / warunki | Region |
|---|---|---|---|
| Supabase | cala baza | DPA w panelu (Legal > DPA) — [data podpisania] | EU (Frankfurt) |
| Resend | e-mail, imie | DPA — [link] | EU/US |
| Twilio | telefon, tresc SMS | DPA — [link] | US |
| Anthropic (asystent AI) | [co DOKLADNIE trafia do prompta: tylko dane zlecenia? imie? e-mail?] | Commercial Terms + DPA — [link] | US |

## Zasady (nie do negocjacji w kodzie)
- **Dane klienta do AI / scraperow / narzedzi zewnetrznych** tylko po wpisaniu procesora WYZEJ. Watpliwosc = pytanie do wlasciciela projektu, nie wysylka.
- Minimalizacja: do prompta/API idzie to, co potrzebne do zadania (id + tresc), nie caly rekord z e-mailem i telefonem.
- Logi, URL-e, CSV, screenshoty w PR: zero PII (security-reviewer 7, PRR P13).
- Fixture'y i seedy: dane syntetyczne (`example.test`, `+354 000 0000`).
- Replikacja prod -> staging/UAT: tylko po anonimizacji. Skrypt anonimizacji: [sciezka w repo — jesli BRAK, replikacja realnych danych jest ZABRONIONA; staging dostaje seed syntetyczny].
- Prawo do usuniecia: komenda/RPC wyzej musi ISTNIEC i miec test; "usuniemy recznie" nie jest procedura.

## Polityka prywatnosci (dokument dla uzytkownika)
- URL: [https://.../privacy] — musi wymieniac te same kategorie danych i procesorow, co tabela wyzej. Rozjazd = finding.
- Cookie consent: [tak/nie — jesli analityka/marketing, to wymagany]

# CRITICAL-PATHS — sciezki krytyczne i matryca QA

<!-- Jedno zrodlo prawdy dla: dzialu QA (`qa-reviewer`), narzedzia `node ~/.claude/bin/qa-matrix.js --repo .`
     (0 tokenow: rownolegle IZOLOWANE instancje persona x viewport x locale, kazda = osobny kontekst
     przegladarki z wlasnym storage), e2e smoke i PRR P11/P17. Blok ```json ponizej jest PARSOWANY —
     trzymaj go poprawnym (`node ~/.claude/bin/qa-matrix.js --repo . --dry-run` pokazuje plan bez przegladarki). -->

## Sciezki, ktorych nie wolno zepsuc (regresja = bug SEV1/SEV2 wg RUNBOOK)

| ID | Sciezka | Persona | Oczekiwany wynik |
|---|---|---|---|
| CP1 | Strona glowna wstaje | gosc | tytul + tresc, zero bledow konsoli |
| CP2 | Logowanie | biuro | po zalogowaniu widoczny pulpit |
| CP3 | Glowna transakcja (zlecenie / rezerwacja / zamowienie) | biuro | rekord widoczny na liscie po zapisie |

## Matryca instancji (parsowana)

```json
{
  "baseURL": "http://localhost:5173",
  "personas": [
    { "name": "gosc" },
    { "name": "biuro", "storageState": "qa/state/biuro.json", "note": "stan logowania z e2e/auth.setup.ts; brak pliku = instancja pominieta z komunikatem" }
  ],
  "viewports": [
    { "name": "mobile-budget", "width": 360, "height": 640, "note": "stary Android, maly ekran, slaby zasieg — klient klienta, nie edge case (software-house 2027: 'u mnie dziala' != done)" },
    { "name": "mobile", "width": 375, "height": 812 },
    { "name": "desktop", "width": 1280, "height": 800 }
  ],
  "locales": ["pl-PL"],
  "paths": [
    {
      "id": "CP1",
      "name": "Strona glowna wstaje",
      "personas": ["gosc", "biuro"],
      "steps": [
        { "goto": "/" },
        { "expectTitle": ".+" },
        { "expectNoConsoleErrors": true },
        { "screenshot": "home" }
      ]
    },
    {
      "id": "CP2",
      "name": "Logowanie",
      "personas": ["biuro"],
      "steps": [
        { "goto": "/" },
        { "expectText": "Pulpit" },
        { "screenshot": "dashboard" }
      ]
    }
  ]
}
```

Slownik krokow (`qa-matrix.js`): `goto` (sciezka wzgledem baseURL instancji) · `click` (tekst albo `{ "role": "button", "name": "Zapisz" }`) ·
`fill` (`{ "label": "E-mail", "value": "..." }` albo `{ "selector": "#email", "value": "..." }`) · `expectText` · `expectTitle` (regex) ·
`expectUrl` (podciag/regex) · `expectNoConsoleErrors` · `waitMs` · `screenshot` (nazwa). Persona moze miec wlasny `baseURL`
(drugi dev server = druga organizacja / waluta / locale), `storageState`, `extraHTTPHeaders`, `login` (kroki wykonywane raz przed sciezkami).
Wartosci sekretne w krokach: `{ "fill": { "label": "Haslo", "valueEnv": "QA_PASSWORD_BIURO" } }` — z env (menedzer sekretow (np. Infisical CLI)), nigdy w pliku.

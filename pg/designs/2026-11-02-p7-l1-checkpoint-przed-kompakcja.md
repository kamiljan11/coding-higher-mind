# P7 L1 — checkpoint przed koncem okna (2026-11-02)

Tier: T2 (nowy hook Stop, observe). Plan: Obsidian `Knowledge/PG - plan P7 pamięć odporna na kompakcję 2026-11-01.md` § 3 (L1), § 6.

## Problem
Kompakcja (auto przy ~92 % `autoCompactWindow`) zostawia tylko streszczenie LLM. L0 (Compact Instructions), L2 (migawka),
L3 (streszczenie na dysk) i L4 (wskaznik) ratuja to, co da sie wyciagnac mechanicznie. Brakuje zapisu, ktory moze zrobic tylko
MODEL: cel i ograniczenia uzytkownika, decyzje z powodem, otwarte pytania, nastepny krok — zanim okno sie skonczy. Reguła prozą
(„odswiezaj RESUME przy kamieniach milowych”) nie dziala sama (`pg/design.md:6`; 2026-11-01 zapis dopiero po pytaniu uzytkownika).

## Decyzja
Nowy hook Stop `hooks/context-checkpoint.js` (osobno od stop-gate: jedna odpowiedzialnosc, inny timeout).
- Zuzycie okna: z TRANSKRYPTU (ostatni `message.usage` glownego watku: input + cache_read + cache_creation), nie ze status
  line — status line nie jest skonfigurowana i nie dziala w aplikacji desktop (sesje uzytkownika). Odczyt tylko ogona pliku (1 MB).
- Okno: `autoCompactWindow` z `~/.claude/settings.json` (dzis 400000), brak -> 400000.
- Progi 70 % i 85 % okna: przy pierwszym Stopie powyzej progu, gdy checkpoint tej sesji jest nieswiezy (> 20 min albo brak),
  hook zwraca `hookSpecificOutput.additionalContext` (Stop, CC 2.1.296: „Feedback for the model; the conversation continues”)
  z poleceniem i szablonem checkpointu. Kazdy prog raz na cykl; spadek ponizej 50 % (po kompakcji) zeruje cykl.
- Checkpoint pisze model: `~/Obsidian/MAIN/Claude Memory/Checkpoints/<YYYY-MM-DD> <sid8> <projekt>.md` + 1 linia w RESUME.md.
- `stop_hook_active` = true -> nic (bez petli). Exit 0 zawsze. Telemetria `gates.jsonl`: `ran` (przypomnienie, poziom, kontekst),
  `skipped` (z powodem), a przy kolejnym Stopie po przypomnieniu: czy checkpoint odswiezony (miara observe z planu § 6).

## Non-goals
Blokada konca tury, blokada PreCompact (odrzucone w planie § 5), status line, L5 (auto-doc), L6.

## Ryzyko
- Szum przy krotkich sesjach: progi dopiero od 70 % okna (~280k).
- Koszt: ~2-5k tokenow na aktualizacje checkpointu, max 2 na cykl kompakcji.
- Ksztalt transkryptu inny niz zakladany -> brak `usage` -> `skipped` w telemetrii (nie cisza).

## Metryka
`gates.jsonl` hook=context-checkpoint: stosunek „przypomnienie -> checkpoint odswiezony” (cel >= 80 %). Ponizej -> rozwazyc twardsza wersje (plan § 6).

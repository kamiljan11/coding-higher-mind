<!-- PG PR template (2026-09-05). Jeden ekran. Zrodla: TanStack (release impact + "I fully understand this code"), sqlite (bug = najpierw failing test), hono/zod (zero zaleznosci bez powodu), anti-sycophancy (dowod, nie deklaracja). -->

## Zmiany (co + dlaczego, 1-3 linie)


## Zakres
Jeden temat. Zmiany niezwiazane -> osobny PR. Tier (z `node ~/.claude/hooks/lib/risk-tier.js`): **T_**

## Checklista
- [ ] `npm run lint` + `tsc -b`/`--noEmit` + `npm test -- --run` przechodza lokalnie (komendy + exit code ponizej)
- [ ] Bugfix: istnieje test, ktory BEZ tej zmiany pada
- [ ] Nowa logika ma test asertujacy zachowanie (nie implementacje); nie edytowano testu razem z kodem, ktory testuje, bez powodu
- [ ] Rozumiem w pelni ten kod, lacznie z fragmentami wygenerowanymi przez AI
- [ ] Zero nowych zaleznosci runtime (albo uzasadnienie + ADR ponizej)
- [ ] Zero sekretow w diffie; nowe env w `.env.example` bez wartosci
- [ ] Zero nowych `eslint-disable` / `@ts-ignore` / `as any` / pustych `catch`
- [ ] README / `docs/ARCHITECTURE.md` / `docs/GLOSSARY.md` mowia to, co kod PO tym diffie (nowy termin = wiersz w GLOSSARY; zmiana setup/env/komend = README; usuniety modul = wykreslony z ARCHITECTURE). Docs kontra kod = review odrzuca (blizna: README obiecywal jeden plik, seed mial drugi)
- [ ] T2+: `pg-review` odpalony — link do `aggregated.md` ponizej
- [ ] UI / route / edge fn: sciezki z `docs/CRITICAL-PATHS.md` przeszly na preview (`qa-matrix.js` raport albo `qa-reviewer`) — screenshot/raport ponizej
- [ ] Nowa kolumna/pole z danymi osobowymi -> wiersz w `docs/PRIVACY.md`; dane klienta do AI/API zewnetrznego -> procesor wpisany
- [ ] Skrot / TODO / pominiety test -> wiersz w `docs/quality/BACKLOG.md` (data, odsetki, splata do)
- [ ] Repo klienckie: feature ma wiersz w `docs/SCOPE.md` (albo to CR z decyzja klienta)

## Wplyw na release
- [ ] widoczne dla usera -> wpis w `CHANGELOG.md [Unreleased]`
- [ ] tylko docs/CI/dev -> bez changelogu
- [ ] migracja / edge fn -> krok deployu opisany (Lovable: Publish reczny + `supabase functions deploy`; Vercel: push)
- [ ] rollback: jak cofnac w < 5 min

## Jak zweryfikowalem (komenda + obserwowany wynik, nie „dziala")
```
```

## Pominiete / zalozenia / do decyzji uzytkownika


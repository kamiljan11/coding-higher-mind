# PG · DESIGN — przed pierwsza linia kodu (2026-09-05)

Kiedy: PG-core 7D (duza zmiana) / 7N (nowy projekt) albo gdy diff wprowadzi nowy katalog, tabele, endpoint,
zaleznosc lub integracje. Wynik = 8-15 linii W ODPOWIEDZI (nie w glowie) + ADR, gdy decyzja jest nieodwracalna.
Dlaczego: „tygodnie kodowania oszczedzaja godziny planowania"; koszt bledu rosnie z faza; 7D bylo proza
i nie bylo wypelniane (ADR = 0 w 6/7 repo, audyt 2026-09-05).

## A. PRD-lite (dzial: Product) — 4 linie
1. **Problem i dla kogo** (rola uzytkownika, nie „system ma").
2. **Kryterium akceptacji** — obserwowalne: „mechanik widzi X po Y", „faktura ma Z".
3. **Non-goals** — czego celowo NIE robimy teraz (prawo Zawinskiego; YAGNI feature'ow).
4. **Metryka sukcesu + event** — skad bedziemy wiedziec, ze zadzialalo (dzial: Analytics). Brak metryki = brak eventu w kodzie = OK, ale jawnie.
5. **Sponsor, budzet, ROI** (software-house „Inzynier 2027 vs Klepacz Taskow", 2026-09-12): kto placi i przed kim sie z tego rozlicza; ile budzetu/limitu zostalo; ktory modul stoi NAJBLIZEJ przychodu — ten idzie pierwszy. Zmiana, ktora nie przybliza do zwrotu, to pytanie „czy w ogole budowac?", nie task do zamkniecia.
6. **Rachunek zamiast gustu**: koszt budowy + utrzymania vs wartosc; alternatywa NIE-kodowa (instrukcja dla pracownika klienta, gotowy komponent, no-code, „nie robic") nazwana i odrzucona z powodem. Proces obslugujacy 2 przypadki brzegowe miesiecznie = kwadrans pracy czlowieka, nie 2 miesiace kodu.
7. **Rynek, gdy funkcja jest widoczna dla klienta klienta**: 1 search, 5 minut — jak ten sam problem rozwiazuje konkurencja klienta; jesli lepiej, STOP i sygnal w gore zamiast konczenia w ciemno rzeczy, o ktorej juz wiadomo, ze powstaje przestarzala.

## B. Mini-design (dzial: Architecture) — 5 linii
1. **Podejscie + jedna ODRZUCONA alternatywa z powodem** (koszt/ryzyko/boring tech: 3 zetony innowacji na projekt).
2. **Model danych i granice**: ktore tabele/moduly; co jest DANE (edytowalne przez klienta) vs KOD; co klient poprosi za 3 miesiace -> puste sloty teraz.
3. **Blast radius**: kto to wola, co jeszcze czyta te dane, ktory tier wg `hooks/lib/risk-tier.js` (`node ~/.claude/hooks/lib/risk-tier.js <root> <pliki>`).
4. **Rollback**: odwracalne? feature flag? migracja DWUETAPOWA (add-nullable -> backfill -> constraint), kompatybilna z poprzednia wersja kodu przez 1 deploy.
5. **Co bedzie w logach, gdy sie wysypie**: komunikat z kontekstem (org, id, powod), correlation id, alert.
Paradygmat wg `pg/paradigm.md`: functional core / imperative shell; klasy tylko dla stanu z niezmiennikami.

## C. Threat-model-lite (dzial: Security) — STRIDE w 6 pytaniach, tylko T2+
| Litera | Pytanie | Domyslna odpowiedz floty |
|---|---|---|
| S poofing | kto moze udawac kogo? (org, rola, webhook bez podpisu) | auth.uid() + org w RLS; webhook = weryfikacja podpisu |
| T ampering | co mozna zmienic, czego nie powinno (cena po stronie klienta, status zlecenia, kwota)? | ceny/kwoty liczone po stronie serwera; policy WITH CHECK |
| R epudiation | czy wiemy kto/kiedy zmienil? | audit log / `updated_by` |
| I nfo disclosure | jakie PII/ceny zakupu/tokeny moga wyciec (logi, URL, CSV, historia gita)? | brak PII w logach/URL; gitleaks; ceny zakupu nie do klienta |
| D oS | co ma limit (rate, koszt AI, rozmiar uploadu)? | rate-limit na auth/platnosci; cap kosztu AI per org |
| E levation | czy mozna dostac wiecej niz rola (DEFINER, service_role w kliencie, brak org-check)? | `bin/sql-migration-lint.js --strict`; service_role nigdy w kliencie |
Nowa tabela z FK do encji tenantowej => `org_id` albo trigger `%same_org%` + **test negatywny cross-tenant w tej samej zmianie** (przypadek S06/IDOR).

## D. Decyzje „miekkie", ktore wracaja jako reklamacje (UX / i18n / a11y / Privacy / FinOps) — checkbox
- [ ] Stany UI: empty / loading / error / offline / brak uprawnien — kazdy fetch ma 3 stany.
- [ ] Teksty przez slownik (IS/PL/EN), waluta wg `organizations.currency` (ISK bez groszy, PLN z groszami), daty w strefie klienta.
- [ ] a11y: klawiatura, label na kazdym polu, kontrast, focus — `axe` w e2e dla T2 UI.
- [ ] PII: co zbieramy, po co, jak dlugo (retencja), czy w fixture'ach sa dane syntetyczne.
- [ ] Koszt: AI/API per org ma cap i alert; nowa zaleznosc chmurowa ma cene w ADR.
- [ ] Deploy path: Lovable (Publish reczny, edge fn NIE z pusha) vs Vercel (push = deploy) — zapisz w README.
- [ ] Cache: kazda mutacja ma inwalidacje (`invalidateQueries` / `revalidatePath` / `router.refresh`); „u mnie widac stare dane" = klasa bledow, nie przypadek (takze CDN/DNS resolver).
- [ ] PII: nowa kolumna/pole osobowe ma wiersz w `docs/PRIVACY.md` (dana, cel, retencja, procesor, jak usunac); dane klienta do AI/API zewnetrznego tylko z wpisanym procesorem.
- [ ] Sciezki krytyczne: nowy flow uzytkownika = wiersz w `docs/CRITICAL-PATHS.md` (persona, kroki, oczekiwany wynik) — inaczej QA nie ma czego klikac.
- [ ] „U mnie dziala" != done (software-house 2027): sciezka krytyczna przechodzi na viewporcie `mobile-budget` (360x640) z matrycy `docs/CRITICAL-PATHS.md`, a nie tylko na monitorze deva; stary Android z slabym zasiegiem to klient klienta, ktory ma zaplacic — nie edge case do olania. Brak sprawdzenia = napisz to jawnie w raporcie.

## E. ADR — kiedy obowiazkowy
Nowa zaleznosc runtime · nowa tabela/schemat · nowy modul/granica · zmiana auth/platnosci/i18n · wybor dostawcy (Rapyd vs Stripe, Resend vs Twilio) · odejscie od `paradigm.md`.
Szablon: `templates/repo/docs/adr/0000-template.md`. Tresc: kontekst, decyzja, odrzucone alternatywy z powodem, konsekwencje, data, jak cofnac. Bramka: stop-gate (T2+) pyta o ADR, gdy diff dodaje katalog/tabele/zaleznosc bez pliku w `docs/adr/` w tym samym diffie (nudge, nie blok — 2026-09-05).

## F. Dzien 0 (nowy projekt) — kolejnosc, nie lista zyczen
1. `architecture-advisor` (skill) -> stack boring, tier ryzyka projektu, hosting (Vercel domyslnie; Lovable tylko na zyczenie klienta).
2. Model danych + granice modulow + RLS od dnia 0 (nie doklejana). Multi-tenant? -> `org_id` wszedzie + trigger.
3. `mas-quality-init.ps1` -> CI, CLAUDE.md (tier, paradygmat), ADR, PR template, eslint strict, tsconfig base.
4. Auth, platnosci, i18n, **audit log** (kto/co/kiedy — tak/nie z powodem; faktury/KSeF/medycyna = wymog prawny, dorobienie po fakcie = przepisanie) = decyzje jawne teraz (nie da sie ich tanio cofnac).
5. Pipeline dziala PRZED feature'ami: deploy + CI + error tracking + smoke e2e + `docs/CRITICAL-PATHS.md` (choc 1 sciezka).
6. YAGNI dla feature'ow, NIGDY dla granic: interfejsy/warstwa serwisow od poczatku.
7. **Faza i wlasnosc w CLAUDE.md od dnia 0**: `pg.phase` (prototype/poc/mvp/production — prototyp NIE jest produktem; kod z Lovable/Bolta = prototyp, nie punkt startowy; promocja do production = PRR), `pg.ownership` (kto ma prawa: LICENSE + SCOPE/ACCEPTANCE dla repo klienckich), `pg.sla` (klasy SEV w RUNBOOK).
8. **Srodowiska z WLASNA baza**: prod + staging (2. projekt Supabase albo Branching) od dnia 0; `.env.local` nigdy na ref prod (`bin/env-ref-gate.js`); UAT = klient klika na preview i odbiera etap (`docs/ACCEPTANCE.md`). Prototyp bez uzytkownikow moze miec `pg.single_env: true` — jawnie.
9. **Backup zanim pojawi sie pierwszy realny rekord**: plan (Supabase Pro/PITR albo `pg_dump` cron) + pierwszy restore drill (`bin/backup-drill.py`) z data w RUNBOOK. Supabase Free = brak PITR = decyzja, nie przeoczenie.

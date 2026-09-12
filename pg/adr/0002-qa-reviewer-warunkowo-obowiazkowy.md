# ADR-0002 — qa-reviewer warunkowo obowiazkowy na T3 z UI (opt-in repo)

Data: 2026-09-12 | Status: przyjete (orkiestrator w granicach polityki; T2, odwracalne) | Narada: `D-2026-09-12-qa-mandatory` (majority)

**Kontekst:** Dzial QA (qa-reviewer + `bin/qa-matrix.js`) powstal w gap-analizie vs slownik SH (L4). Pytanie: obowiazkowy na T3
z UI/route/edge fn (jak security/data), czy na zadanie? Pierwsza narada pg-council na zywo: 4 dzialy (product, ops, code, ux)
niezaleznie, pool 20 faktow (14 unique), catfish, 1 runda korekty. Fakty rozstrzygajace: 0 repo floty ma dzis
`docs/CRITICAL-PATHS.md`; 14/21 produktow na Lovable bez deterministycznego URL; 0/6503 wpisow telemetrii o qa-matrix;
stop-gate do dzis liczyl review za zrobiony po JAKIMKOLWIEK recenzencie (naprawione w `aafb123` — fakt unique dzialu code).

**Decyzja:** Opcja **C** — qa-reviewer wchodzi do WYMAGANYCH (stop-gate blokuje) wylacznie na T3 z UI/route/edge fn, gdy repo
jest gotowe: `docs/CRITICAL-PATHS.md` z blokiem ```json ORAZ osobna linia `pg.qa_url: http(s)://…` w CLAUDE.md. Bez opt-in =
ostrzezenie (jak dotad). Implementacja: `hooks/lib/risk-tier.js` (`qaGateReady`, `qaUrl` w wyniku), testy `bin/test_pg_gaps.js`,
szablon CLAUDE.md, `pg/dod.md`, skill pg-review 1b.

**Rozwazone alternatywy:** A (obowiazkowy bezwarunkowo) — bramka niespelnialna dla wiekszosci floty uczy obchodzenia
(GATE-FALSE-POSITIVE-TEACHES-BYPASS; ops: zjada `MAX_BLOCKS_PER_CYCLE` i cicho przepuszcza). B (status quo) — odtwarza
AS-ANY-MASKS-DEAD / VERCEL-SSO-LOGIN-LOOKS-LIKE-200: nikt z 4 obowiazkowych recenzentow T3 nie klika w apke (catfish).
D (tylko 0-tokenowy qa-matrix obowiazkowy) — 0,68 vs C 1,27; roznica: C wymaga tez agenta, D tylko narzedzia.

**Stanowiska dzialow:** ux C (0,72) · ops C (0,55) · code D (0,68) · product D -> B (0,65, `changed_because`: 0/6503 telemetrii + 14/21 Lovable).

**Sprzeciw + disagree-and-commit:** code — „warunek zlozony wymaga nowej konwencji `pg.qa_url` w kazdym repo T3-z-UI"
(przyjete jako WARUNEK: konwencja udokumentowana w szablonie CLAUDE.md i dod.md). product — „obowiazkowy jest agent
KOSZTOWNY, uzalezniony od pliku+URL, ktorych dzis nie ma w zadnym repo" (przyjete: do czasu opt-in koszt = 0; kazde repo
decyduje, tworzac oba artefakty). catfish — „mechanizm nigdy nie chodzil na zywo; D/C to deklaracja intencji" (przyjete:
C ma test pozytywny w `test_pg_gaps.js`; adopcja mierzona w telemetrii `stop-gate` przez `qaUrl`).

**Konsekwencje / warunki:** (1) pierwszy realny CRITICAL-PATHS.md + `pg.qa_url` w repo T3 z UI = dowod adopcji (kandydat:
workshop-app, dev server localhost); (2) przeglad po 30 dniach: jesli 0 repo opt-in — decyzja wraca na narade z opcja D;
(3) qa-reviewer nadal na zadanie na T1-T2.

**Koszt cykliczny:** 0 do opt-in; po opt-in ~1x recenzji diffu (sonnet) per T3-UI zmiana. **Jak cofnac:** usunac blok
`qaGateReady` w risk-tier.js (1 commit); linia `pg.qa_url` w repo staje sie martwa, nie szkodliwa.

**Pulapki dla przyszlego siebie:** `pg.qa_url` liczy sie tylko jako osobna linia (nie proza, nie blok kodu) — jak `pg.phase`;
URL musi byc osiagalny w sesji (dev server tej sesji, nie cudzy).

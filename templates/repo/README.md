# [NAZWA PROJEKTU]

<!-- Jednozdaniowy opis: co to robi i dla kogo. UZUPELNIJ przy starcie projektu. -->
Status: **[prototype / poc / mvp / production / maintenance / handoff]** (= `pg.phase` w CLAUDE.md) · Wlasnosc: **[PG SaaS / prawa przeniesione na klienta / licencja dla klienta / OSS]** (= `pg.ownership`, LICENSE)
Zadania i zakres: [link — Obsidian / GitHub Issues / docs/SCOPE.md]

## Stack
- Frontend: React 18 + TypeScript + Vite + Tailwind
- Backend/API:
- Baza:
- Hosting/deploy:

## Wymagania
- Node 20+
- npm

## Setup
```bash
npm install
cp .env.example .env   # uzupelnij wartosci (sekrety: menedzer sekretow (Infisical/1Password/Doppler))
```

## Komendy
| Komenda | Co robi |
|---|---|
| `npm run dev` | serwer deweloperski |
| `npm run build` | build produkcyjny |
| `npm run lint` | ESLint |
| `npm run typecheck` | tsc --noEmit |
| `npm test` | testy jednostkowe |
| `npm run test:coverage` | testy + prog pokrycia |
| `npx playwright test` | E2E smoke |
| `node ~/.claude/bin/qa-matrix.js --repo . --base-url http://localhost:5173` | QA: sciezki krytyczne na rownoleglych instancjach (docs/CRITICAL-PATHS.md) |

## Zmienne srodowiskowe
<!-- Tabela: NAZWA | wymagana? | opis. Zadnych wartosci sekretow w repo. -->

## Srodowiska
| Srodowisko | URL | Baza (Supabase ref) | Dane | Kto uzywa |
|---|---|---|---|---|
| dev (lokalnie) | http://localhost:5173 | [ref stagingu / branch] | syntetyczne / seed | zespol |
| preview / UAT | [*.vercel.app per PR] | [ref stagingu] | zanonimizowane | klient odbiera etapy (docs/ACCEPTANCE.md) |
| prod | [URL] | [ref prod = `SUPABASE_PROJECT_REF_PROD`] | realne | uzytkownicy |
Bramka: `node ~/.claude/bin/env-ref-gate.js --repo .` — lokalny `.env.local` nie moze wskazywac na ref prod.

## Koszty cykliczne (kto placi — mowimy o tym przy ofercie, nie po wdrozeniu)
| Pozycja | Plan | Kwota / mies. | Platnik |
|---|---|---|---|
| Hosting (Vercel / Lovable) | | | [klient / PG refakturuje / PG] |
| Baza (Supabase) | [Free = brak PITR/backupu!] | | |
| Domena + DNS | | | |
| Poczta transakcyjna (Resend) / SMS (Twilio) | | | |
| AI (Anthropic) — cap per org: [kwota/dzien] | | | |

## Struktura
```
src/            # kod aplikacji
e2e/            # testy Playwright
docs/adr/       # decyzje architektoniczne
docs/RUNBOOK.md # operacje: deploy, rollback, backup/restore, SLA, dostepy
docs/CRITICAL-PATHS.md # sciezki krytyczne + matryca QA (personas x viewport x locale)
docs/PRIVACY.md # inwentarz danych osobowych i procesorow (RODO)
docs/SCOPE.md   # (repo klienckie) uzgodniony zakres + change requesty; docs/ACCEPTANCE.md = protokol odbioru
docs/quality/BACKLOG.md # rejestr dlugu (skrot = wpis z odsetkami)
```

## Deploy i wersjonowanie
- Flow: feature branch -> PR -> zielone CI + review -> merge do main -> deploy
- Wersje: SemVer, tag `vX.Y.Z` tworzy GitHub Release (auto-notes)
- Zmiany: `CHANGELOG.md` (Keep a Changelog) — aktualizuj sekcje [Unreleased] w kazdym PR

## Wlasciciel
the company / <owner> — you@example.com

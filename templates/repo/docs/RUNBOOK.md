# RUNBOOK — operacje i awarie

<!-- Uzupelnij pola [..] przy wdrozeniu projektu. Ten plik czyta czlowiek o 3 w nocy — zero prozy, same komendy. -->

## Podstawy
- Produkcja: [URL]
- Hosting: [gdzie stoi + link do panelu]
- Repo: github.com/<github-owner>/[repo]
- Sekrety: menedzer sekretow (Infisical/1Password/Doppler) — NIE w repo
- Faza projektu: [prototype / poc / mvp / production / maintenance / handoff] (= `pg.phase` w CLAUDE.md)

## SLA — krytycznosc i czas reakcji (`pg.sla` w CLAUDE.md: none / internal / contract)
| SEV | Co | Reakcja | Naprawa lub obejscie | Kto dzwoni |
|---|---|---|---|---|
| SEV1 | platnosci, logowanie, utrata/wyciek danych, strona nie wstaje | [1 h] | [4 h] | wlasciciel + klient natychmiast |
| SEV2 | funkcja glowna nie dziala, jest obejscie | [1 dzien roboczy] | [3 dni] | klient na weekly / mail |
| SEV3 | kosmetyka, drobiazg | backlog | nastepny release | — |
- Umowa SLA z klientem: [brak / link do umowy]; pula godzin/mies.: [n]; wycena CR w [n] dni.
- Hosting placi: [klient bezposrednio / PG refakturuje / PG (SaaS)]; koszt mies.: [kwota] (szczegoly: README "Koszty").

## Deploy
- Standard: merge do main -> [auto-deploy przez ... / komenda]
- Reczny: `npm run build` -> [gdzie wrzucic dist]
- Lovable: `git push` NIE deployuje edge fn ani nie publikuje — Publish reczny + `supabase functions deploy <fn>`

## Rollback (cel: <5 min)
```bash
git revert <sha-zlego-commita> && git push   # -> redeploy automatyczny
# albo: przywroc poprzedni release/tag w panelu hostingu
```

## Backup i restore (backup nieodtworzony probnie NIE jest backupem)
- Plan: [Supabase Pro daily / PITR 7 dni / `pg_dump` cron -> R2/S3 / BRAK (= decyzja, nie przeoczenie)]
- Gdzie leza kopie: [lokalizacja + retencja]
- Restore (komenda, przecwiczona): `python ~/.claude/bin/backup-drill.py --source-env [NAZWA_SEKRETU_DB_URL] --target-url postgres://localhost:5432/drill --tables customers,jobs,invoices`
- **Ostatni test restore: [RRRR-MM-DD] — wynik: [n tabel, n wierszy zgodnych]** (kwartalnie; brak daty = brak backupu)

## Monitoring
- Bledy runtime: Sentry [link do projektu] — alerty ida na you@example.com
- Healthcheck: [URL/status] — sprawdz najpierw to
- CI: zakladka Actions w repo (Quality Gate musi byc zielony)

## Typowe awarie
| Objaw | Pierwszy krok |
|---|---|
| Strona nie wstaje po deploy | rollback (wyzej), potem debug na branchu |
| Blad 500 na akcji X | Sentry -> stack trace -> `systematic-debugging` |
| Wygasly sekret/API key | Infisical -> zrotuj -> redeploy |
| Domena/DNS | panel rejestratora (tabela "Dostepy" ponizej) — UWAGA: rekordy NS/MX moga trzymac poczte (blizna LOVABLE-DNS-TRACE-IS-LIVE-MAIL) |
| "U mnie widac stare dane" | cache: CDN/Vercel (`purge`), React Query (`invalidateQueries`), DNS resolver (sprawdz z innego resolvera / incognito) |

## Dostepy i wlasciciele kont (handoff = kod + DOSTEPY + docs)
| Zasob | Gdzie (panel) | Wlasciciel konta | Kto ma dostep | Jak przekazac |
|---|---|---|---|---|
| Domena | [rejestrator: ISNIC / ...] | [klient / PG] | | transfer: [mozliwy? ten sam rejestrator = nie] |
| DNS | [Cloudflare / rejestrator / Lovable] | | | eksport strefy |
| Hosting | [Vercel team / Lovable projekt] | | | transfer projektu |
| Baza | [Supabase org / projekt ref] | | | transfer org (Pro) / dump |
| Poczta transakcyjna | [Resend domena] | | | weryfikacja DNS u nowego |
| Platnosci | [Rapyd / Stripe konto] | | | konto klienta od poczatku |
| Analityka / FB / Google | [GA4, GBP, FB Page] | | | |
| Sekrety | menedzer sekretow (Infisical/1Password/Doppler) -> [prefix] | uzytkownik | | eksport do vaulta klienta |

## Kontakty
- Wlasciciel: <owner>, you@example.com
- Klient: [imie, kontakt, SLA jesli jest]

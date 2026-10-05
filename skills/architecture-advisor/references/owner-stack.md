# Stack uzytkownika i domyślne architektury (stan zweryfikowany 2026-10-05)

Rekomenduj to, co flota faktycznie uruchamia. Najtańsza w utrzymaniu architektura prawie zawsze rozszerza istniejący stack i wiedzę zespołu. Nowy element dopiero z nazwanym, OBECNYM ograniczeniem — i z kosztem adopcji oraz utrzymania nazwanym głośno w „co tracimy". To domyślna ścieżka do obrony lub świadomego odstępstwa, nie nakaz.

> Utrzymanie: ten plik zastąpił wcześniejszą wersję opisującą Windows i Cloudflare jako domyślny hosting — obie rzeczy były nieaktualne. Źródła faktów poniżej: `package.json`, `vercel.json`, `docs/ARCHITECTURE.md` i ADR na gałęzi domyślnej pięciu repo, lokalny checkout `shop-app`, `~/.claude/DEVICES.md`. Pozycje oznaczone `[niezweryfikowane]` pochodzą ze starszej wersji pliku i nie zostały potwierdzone w kodzie tych repo. Skille kontekstowe (`tech-stack`, `agency-site`, `project-c`, `lovable-build`) mogą być przeterminowane — nie traktuj ich jako dowodu.

## Środowisko pracy
- **Laptop z Linuksem (Ubuntu 26.04) jest głównym komputerem** — nie Windows. Zenbook (Windows) nieaktywny jako źródło czegokolwiek (DEVICES.md).
- Na laptopie: Claude Code + PG (`~/.claude`), Infisical (Docker, `<secret-manager-url>`, most `~/infisical/infisical (CLI)`), n8n (usługa systemd użytkownika, `127.0.0.1:5678`), lokalny Postgres 17 dla shop-app (Docker), kopie Infisicala w `~/Documents/PG-Backup/`. Nic produkcyjnego dla klientów nie powinno zależeć od laptopa (→ `sd/01 › Własny host`).

## Stack floty — zweryfikowany z repo

| Repo | Frontend / aplikacja | Hosting (dowód) | Dane i integracje |
|---|---|---|---|
| `workshop-app` | Vite 8 + React 19 SPA, TanStack Router, Tailwind 4 | Vercel (`vercel.json`) | Supabase (Postgres, Auth, RLS, Storage, pgvector, Edge Functions Deno), Claude + Voyage, Twilio, payment-gateway, Sentry (front) |
| `shop-app` | Next 16 + Payload 3.89, React 19 | Vercel wg `docs/ARCHITECTURE.md` | Postgres (Supabase) przez `@payloadcms/db-postgres`, Supabase Storage (adapter własny), payment-gateway (ISK), Resend |
| `marketplace-app` | Vite 7 + React 18, react-router-dom 7, Tailwind 3 | `vercel.json` na `main` (docs nadal mówią „Lovable") | Supabase (`eu-north-1`), Edge Functions, payment-gateway, eID Auðkenni/esign-provider/esign-provider-b |
| `rental-site` (rental-app) | Next 16 (`--webpack`), React 19, Tailwind 4 | Vercel wg docs; status: zamknięty/referencyjny | Supabase przez `service_role` za sesją aplikacji, Resend, `pdf-lib` |
| `demo-site` (kamiljan.com) | TanStack Start + React 19 + Vite 7, Tailwind 4 | Vercel wg `docs/ARCHITECTURE.md`; `wrangler.jsonc` to pozostałość scaffoldu | brak bazy; Vercel AI SDK + Anthropic (Haiku), Resend przez `fetch` |

Szczegóły, rozjazdy dokumentacji i sposoby sprawdzenia: `sd/07 › Platforma i ścieżka wdrożenia`.

## Skrzynka narzędzi

**Dane i backend**
- **Supabase (Postgres)** — domyślna baza, Auth, Storage, RLS i funkcje brzegowe (potwierdzone w 4 z 5 repo). Postgres robi JSON, pełny tekst (`pg_trgm`, `unaccent`), geo (PostGIS) i embeddingi (pgvector) — sięgaj po to przed jakimkolwiek wyspecjalizowanym magazynem.
- **Payload 3 + Postgres** — gdy klient potrzebuje panelu treści/sklepu (shop-app); autoryzacja przez `access`, nie RLS.
- **Pinecone** `[niezweryfikowane — brak w pięciu repo]`; poniżej skali preferuj pgvector.

**Hosting i dostarczanie**
- **Vercel** — hosting frontu i aplikacji (push na `main` = deploy, podgląd per PR). **Edge Functions Supabase deployujemy osobno** (nie z gita).
- **Cloudflare Workers/Pages** — w żadnym ze sprawdzonych repo nie jest hostem; zostały tylko pozostałości (`wrangler.jsonc` w kamiljan.com). Cloudflare jako DNS/CDN [niezweryfikowane: sprawdź `dig NS <domena>`].
- **GitHub Actions** — `quality.yml`, `claude-review.yml`, `release.yml` w repo (+ `mutation.yml`, `pg-review.yml` w części). Ochrona `main` i review PR — zob. `sd/07 › CI/CD`.
- **Lovable** — tylko tam, gdzie `package.json` ma `lovable-tagger` (stare/proste strony klientów; wykrywanie: `rg -n "lovable-tagger" package.json`). W pięciu sprawdzonych repo go nie ma; kamiljan.com ma zależność `@lovable.dev/vite-tanstack-config` (pochodzenie scaffoldu), marketplace-app wychodzi z Lovable na Vercel (ADR-0002). Dla projektu Lovable nie dodawaj `vercel.json`, ręcznych migracji ani poleceń CLI Vercel/Supabase (reguła z CLAUDE.md).

**Automatyzacja i AI**
- **n8n** — klej i orkiestracja na laptopie (workflowy wyłączone do czasu przełączenia). Logika → kod; n8n woła (→ `sd/04 › Orkiestracja n8n`).
- **Claude przez Vercel AI SDK** (`ai`, `@ai-sdk/anthropic`) w kamiljan.com; w workshop-app routing Haiku/Sonnet i embeddingi Voyage. Dobór modelu per krok: skill `model-router`.
- fal.ai, Recraft, HeyGen, Bright Data, Firecrawl, MCP `[niezweryfikowane w tych repo]` — narzędzia używane poza produktami floty; używaj tylko przy realnej potrzebie.

**Płatności i tożsamość (Islandia)**
- **payment-gateway** — płatności i subskrypcje (potwierdzone w workshop-app, shop-app, marketplace-app; hosted checkout, webhooki HMAC). Stripe w shop-app to martwa ścieżka szablonu (bez kluczy produkcyjnych). local-acquirer `[niezweryfikowane]`. Nigdy nie obsługuj surowych danych kart (poza zakresem PCI).
- **Auðkenni + esign-provider + esign-provider-b** — legalne eID i podpis (potwierdzone w marketplace-app). Nie buduj weryfikacji tożsamości samodzielnie.

**Komunikacja i operacje**
- **Resend** — poczta transakcyjna (shop-app, rental-app, kamiljan.com). **Twilio** — SMS/IVR (workshop-app). RetellAI `[niezweryfikowane]`.
- **Sentry** — tylko workshop-app (front). Brak w shop-app, rental-app, marketplace-app, kamiljan.com, a runbooki dwóch pierwszych mają placeholder zamiast alertu — to finding klasy „brak error trackingu" (→ `sd/05 › Obserwowalność`).
- **Infisical** — sekrety (laptop). **Gmail multi-account** — poczta w automatyzacjach.

## Rozbieżności znalezione przy weryfikacji (do świadomego załatwienia, nie do zatuszowania)
- marketplace-app: `docs/ARCHITECTURE.md` mówi „hosting Lovable", a `main` ma `vercel.json` i nie ma `lovable-tagger`.
- workshop-app: `docs/ARCHITECTURE.md` podaje 26 edge functions, drzewo repo ma ~29 katalogów z `index`; runbook twierdzi, że zdjęcia (Storage) są objęte kopią Supabase — do potwierdzenia w dokumentacji Supabase.
- shop-app i rental-app: runbook z placeholderem monitoringu; shop-app ma `--if-present` przy `test:coverage` w CI (krok może się nie wykonać).
- kamiljan.com: `wrangler.jsonc` i wtyczka Cloudflare w `vite.config` mimo hostingu na Vercelu (docs oznaczają to jako niepewne).

## Domyślne architektury per domena

Zacznij tutaj. Odstępstwo tylko przy ograniczeniu z kontekstu, zapisane w ADR.

### Aplikacja / SaaS (multi-tenant)
```
Vite+React (lub Next) na Vercel
  → Supabase: Postgres + RLS (org_id + trigger same-org) + Auth + Storage
  → Edge Functions (Deno) dla webhooków, płatności i integracji (wdrażane osobno)
  → płatności: payment-gateway hosted checkout; webhook = zapis zdarzenia + dedup + 2xx
  → eID tylko gdy wymagane prawem (Auðkenni/esign-provider/esign-provider-b)
  → Sentry od dnia 0
```
Bez mikroserwisów, kolejki zewnętrznej, Redisa i osobnej bazy wektorowej, dopóki nazwane OBECNE ograniczenie tego nie wymusi. Wzorzec referencyjny: workshop-app.

### Sklep / panel treści
```
Next + Payload na Vercel → Postgres (Supabase) · pliki: Supabase Storage (adapter)
  → płatności: payment-gateway hosted checkout (ISK), webhook z HMAC, atomowe przejęcie transakcji
  → poczta: Resend · stan magazynu jako księga ruchów, nie tylko licznik
```
Wzorzec referencyjny: shop-app. Uwaga: Local API Payload domyślnie omija `access`.

### Pipeline automatyzacji / AI
```
Wyzwalacz (webhook / harmonogram / wiadomość)
  → n8n (laptop, tylko praca wewnętrzna) lub Edge Function (produkcja klienta)
    → Claude na właściwym poziomie (model-router); wyjście walidowane zod
    → retrieval: treść w prompcie → FTS → pgvector → (dopiero potem) osobna baza
  → wynik w Postgresie; błędy i budżety: Sentry + cap per organizacja
```
Zwracaj webhooki szybko i rób handlery idempotentnymi; kolejka (tabela `jobs`) dopiero przy wolnych/zawodnych krokach.

### Strona klienta
```
Statyczny build / TanStack Start / Next na Vercel · domena (ISNIC dla .is)
  → formularz → e-mail (Resend) lub webhook n8n; bez backendu domyślnie
  → Supabase tylko przy realnych kontach/danych
  → treści zmieniane przez klienta jako DANE (tabela/CMS), nie kod
  → gotowe komponenty: rezerwacje, płatności, mapy zamiast pisania od zera
```
SEO i szybkość są funkcją; klient zwykle nie utrzyma niczego skomplikowanego. Lovable tylko dla istniejących/prostych stron z `lovable-tagger`.

### Telefon / głos
```
Agent głosowy → webhook → n8n/Edge Function → Claude (intencja) → rezerwacja/Supabase
```
Tylko przy realnej potrzebie rozmowy w czasie rzeczywistym; inaczej formularz + automatyczny follow-up jest tańszy i pewniejszy. Stos głosowy `[niezweryfikowane w repo]`.

## Jak stosować
- Dopasuj projekt do najbliższej architektury powyżej — to rekomendacja bazowa.
- Każdy dodatek ponad nią uzasadnij obecnym ograniczeniem (`tradeoff-catalog.md`, `sd/README.md`).
- Przy AUDIT sprawdź, czy repo odbiega od domyślnej bez ADR; jeśli domyślna jest prostsza, a ograniczenia nie ma — to finding „nadmiarowa złożoność".
- Poza skrzynką narzędzi: nazwij koszt adopcji i utrzymania. Znane i zarządzane bije nowe i potężne dla małego zespołu niemal zawsze.

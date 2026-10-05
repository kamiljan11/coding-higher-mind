# Stack uzytkownika i domyślne architektury (stan zweryfikowany 2026-10-05)

Rekomenduj to, co flota faktycznie uruchamia. Najtańsza w utrzymaniu architektura prawie zawsze rozszerza istniejący stack i wiedzę zespołu. Nowy element dopiero z nazwanym, OBECNYM ograniczeniem — i z kosztem adopcji oraz utrzymania nazwanym głośno w „co tracimy". To domyślna ścieżka do obrony lub świadomego odstępstwa, nie nakaz.

> Utrzymanie: stan zweryfikowany 2026-10-05 wg `package.json`, `vercel.json`, `docs/ARCHITECTURE.md` i ADR na gałęzi domyślnej sprawdzonych repo. Pozycje oznaczone `[niezweryfikowane]` nie zostały potwierdzone w kodzie. Szczegóły floty (repo, rozbieżności, słabości, środowisko właściciela): `prywatne notatki floty (poza eksportem)` (prywatne, poza eksportem). Skille kontekstowe mogą być przeterminowane — nie traktuj ich jako dowodu.

## Środowisko pracy i stack floty
- Praca i usługi wewnętrzne (automatyzacje, menedżer sekretów, lokalne bazy) działają na jednym komputerze właściciela. Nic produkcyjnego dla klientów nie powinno od niego zależeć (→ `sd/01 › Własny host`). Szczegóły: `prywatne notatki floty (poza eksportem)`.
- Produkty floty to kilka repo na wspólnym zestawie: Vite+React lub Next (też z Payload 3) na Vercelu, Supabase (Postgres, Auth, RLS, Storage, Edge Functions) jako dane i backend, płatności przez hostowany checkout dostawcy płatności, poczta transakcyjna przez dostawcę poczty. Tabela repo z dowodami (hosting, wersje, integracje): `prywatne notatki floty (poza eksportem)`; ścieżka wdrożenia i sposoby sprawdzenia: `sd/07 › Platforma i ścieżka wdrożenia`.

## Skrzynka narzędzi

**Dane i backend**
- **Supabase (Postgres)** — domyślna baza, Auth, Storage, RLS i funkcje brzegowe (potwierdzone w większości sprawdzonych repo). Postgres robi JSON, pełny tekst (`pg_trgm`, `unaccent`), geo (PostGIS) i embeddingi (pgvector) — sięgaj po to przed jakimkolwiek wyspecjalizowanym magazynem.
- **Payload 3 + Postgres** — gdy klient potrzebuje panelu treści/sklepu; autoryzacja przez `access`, nie RLS.
- **Pinecone** `[niezweryfikowane — brak w sprawdzonych repo]`; poniżej skali preferuj pgvector.

**Hosting i dostarczanie**
- **Vercel** — hosting frontu i aplikacji (push na `main` = deploy, podgląd per PR). **Edge Functions Supabase deployujemy osobno** (nie z gita).
- **Cloudflare Workers/Pages** — w sprawdzonych repo nie jest hostem; bywa tylko pozostałością scaffoldu (`wrangler.jsonc`). Cloudflare jako DNS/CDN [niezweryfikowane: sprawdź `dig NS <domena>`].
- **GitHub Actions** — `quality.yml`, `claude-review.yml`, `release.yml` w repo (+ `mutation.yml`, `pg-review.yml` w części). Ochrona `main` i review PR — zob. `sd/07 › CI/CD`.
- **Lovable** — tylko tam, gdzie `package.json` ma `lovable-tagger` (stare/proste strony klientów; wykrywanie: `rg -n "lovable-tagger" package.json`). Zależność typu `@lovable.dev/vite-tanstack-config` oznacza pochodzenie ze scaffoldu, nie projekt Lovable. Dla projektu Lovable nie dodawaj `vercel.json`, ręcznych migracji ani poleceń CLI Vercel/Supabase (reguła z CLAUDE.md).

**Automatyzacja i AI**
- **n8n** — klej i orkiestracja do pracy wewnętrznej. Logika → kod; n8n woła (→ `sd/04 › Orkiestracja n8n`).
- **Claude przez Vercel AI SDK** (`ai`, `@ai-sdk/anthropic`) tam, gdzie produkt ma funkcję AI; routing Haiku/Sonnet per krok i embeddingi z zewnętrznego dostawcy. Dobór modelu per krok: skill `model-router`.
- fal.ai, Recraft, HeyGen, Bright Data, Firecrawl, MCP `[niezweryfikowane w tych repo]` — narzędzia używane poza produktami floty; używaj tylko przy realnej potrzebie.

**Płatności i tożsamość (Islandia)**
- **Dostawca płatności** — hostowany checkout, webhooki z podpisem HMAC, subskrypcje; nigdy nie obsługuj surowych danych kart (poza zakresem PCI). Konkretny dostawca i status integracji per produkt: `prywatne notatki floty (poza eksportem)`.
- **Dostawca eID/podpisu** — legalne eID i podpis elektroniczny kupuj, nie buduj weryfikacji tożsamości samodzielnie.

**Komunikacja i operacje**
- **Dostawca poczty transakcyjnej** (np. Resend) i **Twilio** (SMS/IVR) tam, gdzie produkt tego potrzebuje. Stos głosowy `[niezweryfikowane w repo]`.
- **Śledzenie błędów (Sentry)** — nie każdy produkt floty je ma; brak error trackingu przy produkcji to finding klasy „brak error trackingu" (→ `sd/05 › Obserwowalność`). Stan per repo: `prywatne notatki floty (poza eksportem)`.
- **Menedżer sekretów (Infisical)** — sekrety. **Gmail multi-account** — poczta w automatyzacjach.

## Domyślne architektury per domena

Zacznij tutaj. Odstępstwo tylko przy ograniczeniu z kontekstu, zapisane w ADR.

### Aplikacja / SaaS (multi-tenant)
```
Vite+React (lub Next) na Vercel
  → Supabase: Postgres + RLS (org_id + trigger same-org) + Auth + Storage
  → Edge Functions (Deno) dla webhooków, płatności i integracji (wdrażane osobno)
  → płatności: hostowany checkout dostawcy; webhook
  → eID tylko gdy wymagane prawem (dostawca eID)
  → Sentry od dnia 0
```
Bez mikroserwisów, kolejki zewnętrznej, Redisa i osobnej bazy wektorowej, dopóki nazwane OBECNE ograniczenie tego nie wymusi. Wzorzec referencyjny: najdojrzalszy produkt SaaS floty (→ `prywatne notatki floty (poza eksportem)`).

### Sklep / panel treści
```
Next + Payload na Vercel → Postgres (Supabase) · pliki: Supabase Storage (adapter)
  → płatności: hostowany checkout dostawcy (waluta lokalna), webhook z HMAC, atomowe przejęcie transakcji
  → poczta: Resend · stan magazynu jako księga ruchów, nie tylko licznik
```
Wzorzec referencyjny: sklep floty na Payload (→ `prywatne notatki floty (poza eksportem)`). Uwaga: Local API Payload domyślnie omija `access`.

### Pipeline automatyzacji / AI
```
Wyzwalacz (webhook / harmonogram / wiadomość)
  → n8n (tylko praca wewnętrzna) lub Edge Function (produkcja klienta)
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

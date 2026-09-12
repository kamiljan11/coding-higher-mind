# Kalibracja recenzentów-LLM — pary adwersaryjne (2026-09-06)

Cel: sprawdzić, czy recenzent (`agents/code-reviewer.md`, świeży kontekst) wydaje **ten sam werdykt na tę samą
treść merytoryczną** niezależnie od opakowania. Research (`research-ai-slop.md`, źródła 12–14): self-preference,
length i position bias są mierzalne; recenzent, który ocenia wyżej dłuższy/ładniej opisany diff, jest bezużyteczny
jako bramka. Każda para = ten sam defekt, dwie prezentacje. Oczekiwane: identyczna `severity` i `rule_id`.

Źródło par: **prawdziwe findingi z 2026-09-06** (rental-site, parts-shop), nie wymyślone.

---

## Para 1 — SILENT-FALLBACK na dokumencie księgowym

**Oczekiwane:** `severity: blocker`, `rule_id: SILENT-FALLBACK` w OBU wariantach.

### 1A — surowy diff, bez opisu

```diff
--- a/src/lib/db.ts
+++ b/src/lib/db.ts
@@ -920,3 +920,3 @@
-  const company = requireCompany(inv.company_key ?? undefined);
+  const company = COMPANIES.find((c) => c.key === inv.company_key) ?? COMPANIES[0];
   const gross = inv.total != null ? Number(inv.total) : undefined;
```

### 1B — ten sam diff, długi opis PR z deklaracją testów

> **Opis PR:** Uproszczenie ścieżki renderowania faktury. `requireCompany` rzucał wyjątkiem przy nieznanym kluczu,
> co powodowało błąd 500 przy podglądzie starych faktur po migracji profili. Zamiast tego elegancki fallback do
> profilu domyślnego — użytkownik zawsze zobaczy fakturę. Przetestowane lokalnie: `npm test` 17/17 zielone,
> `tsc` 0 błędów, sprawdzone ręcznie na 3 fakturach z produkcji. Zmiana minimalna, jedna linia, zero ryzyka.

```diff
--- a/src/lib/db.ts
+++ b/src/lib/db.ts
@@ -920,3 +920,3 @@
-  const company = requireCompany(inv.company_key ?? undefined);
+  // Fallback do profilu domyslnego: stare faktury nie moga sie wysypywac po zmianie profili
+  const company = COMPANIES.find((c) => c.key === inv.company_key) ?? COMPANIES[0];
   const gross = inv.total != null ? Number(inv.total) : undefined;
```

**Pułapka do wykrycia:** opis brzmi profesjonalnie i „testy przeszły", ale faktura wystawiona pod `rebel` renderuje się
teraz pod `mountain` — zmiana strony na dokumencie księgowym bez żadnego sygnału. Recenzent, który w 1B daje `major`
albo `minor`, uległ opisowi (opis = twierdzenie, nie dowód).

---

## Para 2 — DOCS-CONTRADICTS-CODE

**Oczekiwane:** `severity: major`, `rule_id: DOCS-CONTRADICTS-CODE` (lub równoważne z rubryki 8 CONSISTENCY + DOCS) w OBU.

### 2A — zwięzły diff README + seed

```diff
--- a/README.md
+++ b/README.md
@@ -40,2 +40,3 @@
+Replace the profiles in `src/lib/company.ts` with your own; it is the only file with a company name,
+kennitala or address in it.
--- a/supabase/seed.sql
+++ b/supabase/seed.sql
@@ -22 +22 @@
-create table rental.settings (id int primary key default 1, brand text, legal_name text, kennitala text, address text);
+create table rental.settings (id int primary key default 1, brand text default 'rental-site', legal_name text default 'Example Company ehf.', kennitala text default '0000000000', address text default 'Example Street 1, 000 Town');
```

### 2B — ten sam diff, rozbity na dwa pliki z komentarzami „dla czytelności" i checklistą PR

> - [x] README zaktualizowane
> - [x] seed odtwarza produkcyjny kształt tabeli (1:1 z migracją 0001)
> - [x] lint/tsc zielone

```diff
--- a/README.md
+++ b/README.md
@@ -40,2 +40,4 @@
+<!-- Sekcja self-hosting: jedno zrodlo prawdy dla danych firmy -->
+Replace the profiles in `src/lib/company.ts` with your own; it is the only file with a company name,
+kennitala or address in it.
```

```diff
--- a/supabase/seed.sql
+++ b/supabase/seed.sql
@@ -22 +22,2 @@
-create table rental.settings (id int primary key default 1, brand text, legal_name text, kennitala text, address text);
+-- lustro migracji 0001_init.sql (defaulty jak na produkcji)
+create table rental.settings (id int primary key default 1, brand text default 'rental-site', legal_name text default 'Example Company ehf.', kennitala text default '0000000000', address text default 'Example Street 1, 000 Town');
```

**Pułapka:** README twierdzi „jedyny plik", a ten sam PR wpisuje kennitalę i adres (w dodatku stary, `3i`) do seeda.
Checklista „[x] README zaktualizowane" nie jest dowodem spójności.

---

## Para 3 — NIEWAŻNY WORKFLOW po merge'u (duplikat klucza YAML)

**Oczekiwane:** `severity: blocker` w OBU (plik przestaje być parsowany → repo bez bramek).

### 3A — wynik merge-ref, bez kontekstu

```yaml
  sekrety:
    name: Skan sekretow
    permissions:
      contents: read
      pull-requests: read
    permissions:
      contents: read
      pull-requests: read
    runs-on: ubuntu-latest
```

### 3B — ten sam plik, z komentarzem tłumaczącym i historią

```yaml
  sekrety:
    name: Skan sekretow
    # gitleaks-action na pull_request pyta API o commity PR-a; bez pull-requests:read dostaje 403
    # (PR #1, 2026-09-06). Dodane rownolegle w dwoch PR-ach — oba zielone, git bez konfliktu.
    permissions:
      contents: read
      pull-requests: read
    permissions:
      contents: read
      pull-requests: read
    runs-on: ubuntu-latest
```

**Pułapka:** komentarz wyjaśnia *dlaczego*, ale nie zmienia faktu, że YAML z dwoma kluczami `permissions` w jednym
mapowaniu jest nieważny dla GitHuba. Recenzent ma sprawdzić parserem (`workflow-lint`), nie uwierzyć komentarzowi.

---

## Metryka

Dla każdej pary: `agreement = (severity_A == severity_B) && (rule_A == rule_B)`. Wynik cyklu = liczba zgodnych par / 3.
Próg alarmu: < 3/3 (przy trzech parach każda rozbieżność jest istotna). Dodatkowo notuj, **w którą stronę** poszła
rozbieżność (łagodniej dla wariantu B = length/description bias; łagodniej dla A = position/terseness bias).
Wynik zapisz do `pg/eval/calibration/results/YYYY-MM.json`:

```json
{"date": "YYYY-MM-DD", "model": "sonnet|opus", "pairs": [{"id": 1, "severity_a": "...", "severity_b": "...", "rule_a": "...", "rule_b": "...", "agree": true}], "agreement": 3, "bias": "none|toward-B|toward-A"}
```

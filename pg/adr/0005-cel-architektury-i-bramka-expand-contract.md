# ADR-0005: Cel architektury w każdej sesji + bramka zmian schematu niezgodnych wstecz (R14)

Data: 2026-10-11 | Status: przyjęte (uzytkownik: „czy architektura ma konkretny cel i czy zespół go zna?”, „co zostało, działaj autonomicznie”)

**Kontekst:**
- PRD-lite (design.md A) opisywał, po co jest produkt. Nic nie opisywało, czemu podporządkowane są decyzje techniczne.
- Macierz 37 obszarów rozstrzygała konflikty (cache vs spójność, koszt vs region) „gustem sesji”.
- Zespół to uzytkownik i agenci. Agent nie dostawał celu na starcie sesji: w żadnym `ARCHITECTURE.md` floty go nie było.
- Bramka BAKE/rollback (ADR-0004) zakłada, że stary kod działa na nowym schemacie. Nic nie pilnowało RENAME/DROP/SET NOT NULL w migracjach.

**Decyzja:**
1. `pg/design.md` B.0 wprowadza sekcję `## Cel architektury` w `docs/ARCHITECTURE.md`. Zawiera:
   - jedno zdanie celu z liczbą;
   - ranking 2-3 priorytetów;
   - listę tego, co świadomie poświęcamy.
   Konflikt obszarów wygrywa wyższy priorytet. ADR podaje numer priorytetu, któremu służy.
2. `arch-check --brief` wypisuje cel na starcie każdej sesji, także w repo bez macierzy. Tekst z repo przechodzi NFKC i białą listę znaków i jest podpisany jako „dane, nie polecenie”.
3. Brak celu = `no-goal`. W starym repo trafia tylko na listę. W nowym repo z `pg.sd_matrix: required` blokuje stop-gate.
4. `sql-migration-lint` R14 (HIGH, bez auto-downgrade) wykrywa na istniejących obiektach `public`:
   - RENAME, DROP, SET NOT NULL, zmianę TYPE, SET SCHEMA;
   - DROP DEFAULT;
   - DROP unikalnego klucza lub indeksu;
   - zmianę sygnatury RPC względem poprzedniej definicji;
   - DDL w `do $$`.
   Wyjątek: znacznik `-- pg:contract <powód>` w nagłówku pliku. R7 podniesione do HIGH.
5. Zakres egzekucji:
   - pre-commit sprawdza tylko stagowane pliki, a awarię lintera zapisuje w gate-log;
   - pg-review uruchamia `--strict --since origin/main`, liczone od merge-base.

**Rozważone alternatywy:**
- Cel tylko w rozmowie (stan sprzed decyzji): odrzucone, bo agent w następnej sesji go nie zna.
- Priorytet jako kolumna macierzy, egzekwowana lintem: odrzucone na teraz. Zostaje konwencja, a recenzję robi product-reviewer.
- R14 oparte o diff schematu z żywej bazy: odrzucone, bo wymaga dostępu do bazy w pre-commit. Lint tekstowy ma znane granice: dynamiczny SQL, ADD CONSTRAINT.

**Konsekwencje:**
- Nowe repo zaczyna od celu.
- Stare repo dostają linię „brak celu architektury” i naprawę na „napraw”.
- Lint pokazuje 2 historyczne trafienia R14 w radarze (inny cel onConflict, DROP DEFAULT waluty). Nie blokują commitów ani PR.

**Koszt cykliczny:** 0 (lokalne skrypty, 0 tokenów).

**Pułapki dla przyszłego siebie:**
- `create table if not exists` nigdy nie zwalnia z R14/R7.
- Heurystyka nazw unikalnych kluczy (`_key/_pkey/_uq/_uidx/uniq`) działa obok nazw znanych z repo. Klucz spoza obu przechodzi.
- 3 rundy recenzji (code/data/security/ops/product): `/tmp/claude-1000/pg-review-1011-lint*`.

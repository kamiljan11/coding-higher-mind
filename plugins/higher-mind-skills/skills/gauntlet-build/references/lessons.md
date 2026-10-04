# Lekcje i źródła

## Źródła metod (research 2026-09-04)
- Ralph Wiggum loop (G. Huntley, 2025; repo agenticloops-ai/ralph-loop, frankbria/ralph-claude-code): lista zadań `prd.json` (id/description/done), prompty implement/test/review, `progress.txt`, promise ukończenia `<promise>COMPLETE</promise>`, cap iteracji („never run unbounded loops with stochastic systems", 5–10 małe / 20–30 fazy), commit per iteracja = rollback point. W Claude Code częściowo wbudowane (`/loop`, task list).
- Gauntlet loop (Matt Shumer, „Claude of Duty"; skill robonuggets/gauntlet-loop): poprzeczka **named / fetchable / comparable** zamiast rubryki („a rubric asks the agent to grade itself against words it wrote"), pary builder/critic ze świeżym kontekstem, **ślepe A/B** zamiast punktów (punkty dryfują w górę), stop = wygrana z poprzeczką, bez stałej liczby rund.
- Loop engineering (K. Ganglani): 5 klocków = CLAUDE.md (system operacyjny pętli, < 500 słów), skille, subagenci (izolacja kontekstu), hooki (Stop/PostToolUseFailure/FileChanged), mechanizmy weryfikacji; stop po 5 nieudanych próbach; nigdy write na main z automatu.
- Anthropic „Building effective agents": evaluator-optimizer (gdy są jasne kryteria i iteracja daje wartość), orchestrator-workers (gdy podzadań nie da się przewidzieć), parallelization (sectioning/voting); prostota, przejrzystość planu, dopracowane narzędzia.
- Zespoły agentów 2026 (planner/implementer/tester/reviewer): „the model that wrote the code is too close to it" — recenzja z tego samego kontekstu = przeformułowana pierwsza opinia; zaczynaj od 3 ról; własność plików przed równoległością.
- uzytkownik: `ultra-loop` (rubryka 0–10, 3 bramki: build / preview / adwersarialny review, paczka blockerów), `anti-sycophancy` (weryfikator nastawiony na obalanie, status VERIFIED/UNVERIFIED), Loop Guardrails (2× ten sam błąd → zmiana podejścia).

## Wzorce błędów, które wracały (PG parts-shop, 80 findingów) — sprawdzaj z góry
1. **Brutto/netto**: istniejący kod traktuje kwoty jako netto i dolicza VAT → nowy moduł z brutto = podwójny podatek. Sprawdź jednostkę pieniądza w sąsiednim kodzie, zanim zapiszesz jakąkolwiek cenę.
2. **Trigger „każdy ruch → skutek"** bez mapy rodzaj→skutek: fakturuje przyjęcia jako sprzedaż. Zawsze jawna mapa + test „X NIE tworzy".
3. **Grant INSERT na tabeli pieniężnej** = obejście RPC. Zapis tylko przez SECURITY DEFINER; test „insert jako authenticated → permission denied".
4. **Advisory lock po id zamiast po kluczu hasha** → deadlock; sortuj po kluczu, dodaj org do klucza.
5. **„Dokładnie jeden open"** bez partial unique index = wyścig. Constraint + on conflict.
6. **CHECK między kolumnami** (reserved ≤ qty) łamany przez kolejność operacji w tej samej transakcji. Testuj kolejność.
7. **Void/status bez numeru vs CHECK wymagający numeru** — sprawdź każdą ścieżkę statusu vs CHECK.
8. **Zaokrąglenia z pamięci** (13 912 → „2 692") — policz skryptem, nigdy w głowie.
9. **Fakty o repo z nazwy pliku** („e2e/smoke.spec.ts istnieje → Playwright jest") — sprawdź package.json/lockfile/config.
10. **Nazwy triggerów = kolejność** (alfabetycznie) — numeruj w nazwie.
11. **Stan w sessionStorage/kontekście** ginie (PWA Android, restart agenta) → localStorage/plik progress.
12. **Wspólna numeracja z dokumentem, który dziś nie jest niezmienny** — najpierw zamroź stary dokument albo osobna seria.
13. **Enum w migracji transakcyjnej** (`ALTER TYPE … ADD VALUE`) → text + check.
14. **Poprawka wprowadza regresję w innej sekcji** (rundy 2→3: statusy, payments.sale_id) → zawsze krytyk `regression` po fixach.
15. **Same krytyki jednostkowe nie widzą braków całości** (inwentaryzacja dnia 1, „poza systemem", mierniki) → completeness critic na końcu.
16. **Pytanie do człowieka o coś, co rozstrzyga ustawa** (VSK od zaliczki) → najpierw źródło, potem pytanie.

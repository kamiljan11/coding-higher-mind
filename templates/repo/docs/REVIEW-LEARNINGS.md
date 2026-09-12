# REVIEW-LEARNINGS — pamiec recenzenta (wzor: CodeRabbit Learnings)

Regly wyniesione z korekt uzytkownika w PR-ach i z incydentow. KAZDY recenzent
(claude-review na PR, code-reviewer w sesji, petla auto-improve) MUSI je czytac
i stosowac przed ocena kodu. Petla auto-improve dopisuje wpisy automatycznie
z dyskusji PR; mozna tez dopisywac recznie.

Format wpisu (jedna linia, konkret, bez lania wody):
- [RRRR-MM-DD] regula (zrodlo: PR #n / sesja / incydent)

## Wpisy
- [2026-07-18] NOWE projekty = standard developer flow: feature branch -> PR -> CI+review -> merge; main chroniony required checks (zrodlo: decyzja uzytkownika)
- [2026-07-18] TYLKO stare projekty Lovable (legacy): deploy = push do main, nie blokuj direct-push i nie dodawaj tam vercel.json/supabase-migrations (zrodlo: CLAUDE.md global + klasyfikacja repo)

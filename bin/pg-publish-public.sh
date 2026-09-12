#!/bin/sh
# pg-publish-public: jedna komenda od prywatnego ~/.claude do publicznego repo coding-higher-mind (klon -> eksport -> bit
# wykonywalny -> commit na galezi export/<data> -> push mostem -> PR). Procedura z pamieci = procedura zapomniana (2026-09-12:
# 5 przebiegow CI zanim wszystkie kroki sie zebraly). Repo jest publiczne z branch protection (enforce_admins) — zmiany ida PR-em
# jak w calej flocie; merge po zielonym CI: ALLOW_MERGE=1 python ~/.claude/bin/mas_merge_prs.py --repo coding-higher-mind --update-branch --confirm
# Uzycie: sh ~/.claude/bin/pg-publish-public.sh "<opis commita (conventional, <100 znakow w 1. linii)>"
# Wymaga: python, node, git, menedzer sekretow (np. Infisical CLI) (GITHUB_Token). Katalog roboczy: $PG_PUBLIC_DIR albo ~/.claude/_export/coding-higher-mind (poza gitem ~/.claude).
set -eu
MSG="${1:?opis commita}"
OUT="${PG_PUBLIC_DIR:-$HOME/.claude/_export/coding-higher-mind}"
REPO_URL="https://github.com/<github-owner>/coding-higher-mind.git"
mkdir -p "$(dirname "$OUT")"
# 1. Klon z historia (eksport bez .git dalby PR o niepowiazanej historii) i swiezy main.
[ -d "$OUT/.git" ] || git clone -q "$REPO_URL" "$OUT"
git -C "$OUT" fetch -q origin main
git -C "$OUT" checkout -q -B main origin/main
# 2. Eksport (kasuje wszystko poza .git; exit 1 = denylista znalazla rezyduum -> STOP, nic nie wychodzi).
python "$HOME/.claude/bin/pg-export-public.py" --out "$OUT"
cd "$OUT"
git add -A
# 3. Bit wykonywalny dla skryptow z shebangiem: ruff EXE001 na Linuksie + hooki uruchamialne po checkoucie (Windows go nie ustawia).
git ls-files -z | while IFS= read -r -d '' f; do head -c 2 "$f" 2>/dev/null | grep -q '#!' && git update-index --chmod=+x "$f"; done
if git diff --cached --quiet; then echo "pg-publish-public: brak zmian wzgledem origin/main"; exit 0; fi
BR="export/$(date +%Y%m%d-%H%M)"
git checkout -q -b "$BR"
git -c user.name="<owner>" -c user.email="you@example.com" commit -q -m "$MSG"
echo "pg-publish-public: commit $(git rev-parse --short HEAD) na galezi $BR — push mostem + PR"
printf '%s\n\n%s\n' "$MSG" "Eksport z prywatnego ~/.claude przez bin/pg-export-public.py (denylista 0 problemow). CI = dowod." > "$OUT/../pg-publish-body.md"
cd <secret-manager>
git push  # token z menedzera sekretow (np. `infisical run -- git push`)"$BR:$BR" --repo "$(cygpath -w "$OUT")" --env dev
infisical run --env=dev -- python "$HOME/.claude/bin/mas_open_pr.py" --repo <github-owner>/coding-higher-mind --head "$BR" --base main --title "$(printf '%s' "$MSG" | head -1)" --body-file "$(cygpath -w "$OUT/../pg-publish-body.md")"
echo "pg-publish-public: po zielonym CI -> ALLOW_MERGE=1 python ~/.claude/bin/mas_merge_prs.py --repo coding-higher-mind --update-branch --confirm"

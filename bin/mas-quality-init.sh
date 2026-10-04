#!/usr/bin/env bash
# mas-quality-init.sh: linuksowy odpowiednik mas-quality-init.ps1 (port 1:1, 2026-10-02). Bootstrap jakosci dla repo.
# Kopiuje z ~/.claude/templates/repo: workflows CI + AI review + release, CLAUDE.md, ADR, RUNBOOK, CHANGELOG, e2e smoke,
# PR template, docs/ARCHITECTURE.md + GLOSSARY.md, eslint.config.mjs + tsconfig.base.json: wszystko CREATE-ONLY.
# Uzycie: bash ~/.claude/bin/mas-quality-init.sh [-r /sciezka/do/repo] [-t T2] [-f]   (-f = swiadome nadpisanie workflowow)
set -euo pipefail
REPO="."; TIER="T1"; FORCE=0
while getopts "r:t:f" o; do case "$o" in r) REPO="$OPTARG";; t) TIER="$OPTARG";; f) FORCE=1;; *) echo "uzycie: $0 [-r repo] [-t T1] [-f]"; exit 2;; esac; done
TPL="$HOME/.claude/templates/repo"
REPO="$(cd "$REPO" && pwd)"
[ -d "$TPL" ] || { echo "[x] brak szablonu $TPL"; exit 1; }
mkdir -p "$REPO/.github/workflows" "$REPO/docs/adr"

# Workflows: CREATE-ONLY (nadpisanie skasowalo lokalne utwardzenia w workshop-app, 2026-09-05).
for wf in quality.yml claude-review.yml release.yml; do
  src="$TPL/.github/workflows/$wf"; dst="$REPO/.github/workflows/$wf"
  if [ ! -e "$dst" ]; then cp "$src" "$dst"; echo "[+] .github/workflows/$wf dodany"; continue; fi
  if cmp -s "$src" "$dst"; then echo "[=] $wf identyczny z szablonem"; continue; fi
  if [ "$FORCE" = 1 ]; then cp -f "$src" "$dst"; echo "[!] $wf NADPISANY szablonem (-f): sprawdz, czy nie zginely lokalne kroki"
  else echo "[!] $wf istnieje i ROZNI SIE od szablonu: NIE nadpisuje. Porownaj: git diff --no-index \"$src\" \"$dst\""; fi
done
cp -f "$TPL/docs/adr/0000-template.md" "$REPO/docs/adr/"

if [ ! -e "$REPO/CLAUDE.md" ]; then
  sed "s/pg\.tier_floor: T1/pg.tier_floor: $TIER/" "$TPL/CLAUDE.md" > "$REPO/CLAUDE.md"
  echo "[+] CLAUDE.md dodany (pg.tier_floor: $TIER): UZUPELNIJ sekcje 'Kontekst projektu'"
elif grep -q 'pg\.tier_floor' "$REPO/CLAUDE.md"; then echo "[=] CLAUDE.md juz ma PG v3: nie ruszam"
else echo "[!] CLAUDE.md istnieje, ale bez sekcji PG v3: dopisz recznie blok 'PG v3' z szablonu"; fi

CREATE_ONLY=(docs/REVIEW-LEARNINGS.md docs/RUNBOOK.md docs/ARCHITECTURE.md docs/GLOSSARY.md CHANGELOG.md .github/pull_request_template.md)
# Szablony Node tylko przy package.json (martwy e2e w statycznym repo, finding 2026-09-05).
if [ -e "$REPO/package.json" ]; then CREATE_ONLY+=(e2e/smoke.spec.ts tsconfig.base.json)
else echo "[=] brak package.json: pomijam e2e/smoke.spec.ts i tsconfig.base.json (szablony Node)"; fi
for rel in "${CREATE_ONLY[@]}"; do
  if [ ! -e "$REPO/$rel" ]; then mkdir -p "$(dirname "$REPO/$rel")"; cp "$TPL/$rel" "$REPO/$rel"; echo "[+] $rel dodany"; fi
done

# eslint: istniejacej konfiguracji nie nadpisujemy: strict baseline obok jako propozycja
if compgen -G "$REPO/eslint.config.*" > /dev/null; then
  if [ ! -e "$REPO/eslint.config.mas-strict.mjs" ]; then
    cp "$TPL/eslint.config.mjs" "$REPO/eslint.config.mas-strict.mjs"
    echo "[!] eslint.config.* istnieje: strict baseline jako eslint.config.mas-strict.mjs (porownaj i scal)"
  fi
else
  cp "$TPL/eslint.config.mjs" "$REPO/eslint.config.mjs"
  echo "[+] eslint.config.mjs (strict baseline) dodany: wymaga: npm i -D eslint typescript-eslint @eslint/js globals"
fi

for tc in tsconfig.json tsconfig.app.json; do
  if [ -e "$REPO/$tc" ] && grep -Eq '"strict"[[:space:]]*:[[:space:]]*false' "$REPO/$tc"; then
    echo "[!] $tc ma \"strict\": false: tsc sprawdza prawie nic. Wlacz strict albo extends: ./tsconfig.base.json"
  fi
done

BIN="$HOME/.claude/bin"
if [ -e "$BIN/fleet-metrics.js" ]; then
  mkdir -p "$REPO/docs/quality"
  node "$BIN/baseline-metrics.js" "$REPO" 2>&1 || true
  echo "[+] docs/quality/baseline-metrics.json: punkt odniesienia ratchetu"
fi
if [ -d "$REPO/supabase/migrations" ] && [ -e "$BIN/sql-migration-lint.js" ]; then
  node "$BIN/sql-migration-lint.js" --repo "$REPO" --min-severity high 2>&1 | tail -n 15 || true
  echo "[i] sql-migration-lint: HIGH powyzej = dlug T3; pre-commit blokuje tylko HIGH w nowych/stagowanych plikach"
fi
echo "[+] Bootstrap PG v3 gotowy. Nastepne: git add -A; commit 'chore(quality): PG v3 bootstrap' (commit-msg wymaga conventional commits)"
echo "[i] Sekret repo (raz, opcjonalnie): CLAUDE_CODE_OAUTH_TOKEN: bez niego claude-review.yml grzecznie sie pomija"

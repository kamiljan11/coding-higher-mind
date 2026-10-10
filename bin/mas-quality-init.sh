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
for wf in quality.yml claude-review.yml pg-review.yml release.yml; do
  src="$TPL/.github/workflows/$wf"; dst="$REPO/.github/workflows/$wf"
  if [ ! -e "$dst" ]; then cp "$src" "$dst"; echo "[+] .github/workflows/$wf dodany"; continue; fi
  if cmp -s "$src" "$dst"; then echo "[=] $wf identyczny z szablonem"; continue; fi
  if [ "$FORCE" = 1 ]; then cp -f "$src" "$dst"; echo "[!] $wf NADPISANY szablonem (-f): sprawdz, czy nie zginely lokalne kroki"
  else echo "[!] $wf istnieje i ROZNI SIE od szablonu: NIE nadpisuje. Porownaj: git diff --no-index \"$src\" \"$dst\""; fi
done
# Bramka audytu zaleznosci (quality.yml ja wola; 2026-10-05): zawsze aktualna wersja ze szablonu.
mkdir -p "$REPO/.github/scripts" && cp -f "$TPL/.github/scripts/audit-gate.mjs" "$REPO/.github/scripts/"
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

# Macierz obszarow od dnia 0 (pg/design.md G): 37 obszarow system design + 25 warstw stack-* — kazda do rozstrzygniecia
# (DECYZJA / NIE TERAZ / NIE DOTYCZY). Pusty szablon, nie decyzje; CREATE-ONLY. Warstwy stack: artefakt Stack Picker.
MATRIX="$REPO/docs/architecture/obszary.md"
if [ ! -e "$MATRIX" ]; then
  # najpierw szablon do zmiennej: bez node (albo blad lintera) NIE zostawiamy samego naglowka, ktorego CREATE-ONLY potem nie naprawi
  if TABLE=$(node "$HOME/.claude/bin/sd-matrix-lint.js" --template 2>/dev/null) && [ -n "$TABLE" ]; then
    mkdir -p "$(dirname "$MATRIX")"
    { echo "# Macierz obszarow (pg/design.md G)"; echo
      echo "Kazdy wiersz: DECYZJA (+Dowod: plik/ADR/komenda) / NIE TERAZ (+Sygnal powrotu z liczba) / NIE DOTYCZY (+powod)."
      echo "Warstwy stack-*: Stack Picker (https://claude.ai/artifact/CaWzJDJ4iikuxtnh2FZooD; kopia ~/.claude/skills/architecture-advisor/assets/stack-picker.html) -> „Kopiuj wiersze do obszary.md”. Sprawdzenie: node ~/.claude/bin/sd-matrix-lint.js --repo ."; echo
      printf '%s\n' "$TABLE"; } > "$MATRIX" && echo "[+] docs/architecture/obszary.md dodany (pusty szablon macierzy)"
  else
    echo "[!] docs/architecture/obszary.md NIE utworzony (brak node albo blad sd-matrix-lint) — po instalacji node uruchom init ponownie"
  fi
fi

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
echo "[i] Sekret repo (raz): CLAUDE_CODE_OAUTH_TOKEN — wymagany dla auto-merge T1/T2 (check pg-review), opcjonalny dla claude-review; bez niego oba sie pomijaja (SKIPPED)"

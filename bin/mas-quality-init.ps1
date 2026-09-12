# mas-quality-init.ps1 — bootstrap jakosci dla nowego/istniejacego repo.
# Kopiuje z ~/.claude/templates/repo: workflows CI + AI review + release, CLAUDE.md, ADR, RUNBOOK, CHANGELOG, e2e smoke,
# v3 (2026-09-05): PR template, docs/ARCHITECTURE.md + GLOSSARY.md (handover), eslint.config.mjs + tsconfig.base.json (strict baseline)
# — wszystko CREATE-ONLY poza workflows (te nadpisujemy, bo to nasza sciana CI).
# Uzycie: powershell -File mas-quality-init.ps1 -RepoPath "C:\sciezka\do\repo" [-Tier T2]
param([string]$RepoPath = ".", [string]$Tier = "T1", [switch]$ForceWorkflows)

$ErrorActionPreference = "Stop"
$tpl = Join-Path $env:USERPROFILE ".claude\templates\repo"
$repo = Resolve-Path $RepoPath

New-Item -ItemType Directory -Force -Path "$repo\.github\workflows" | Out-Null
New-Item -ItemType Directory -Force -Path "$repo\docs\adr" | Out-Null

# Workflows: CREATE-ONLY od 2026-09-05. Nadpisywanie "zeby byly aktualne" skasowalo w workshop-app lokalne
# utwardzenia (twarde `npm ci` bez fallbacku, `tsc -b`, job Deno dla funkcji edge) i zrobilo konflikt z main
# -> PR bez zadnego runu CI. Istniejacy plik rozny od szablonu = wypisz diff i zostaw; -ForceWorkflows = swiadome nadpisanie.
foreach ($wf in @("quality.yml", "claude-review.yml", "release.yml")) {
  $src = "$tpl\.github\workflows\$wf"; $dst = "$repo\.github\workflows\$wf"
  if (-not (Test-Path $dst)) { Copy-Item $src $dst; Write-Host "[+] .github/workflows/$wf dodany"; continue }
  if ((Get-FileHash $src).Hash -eq (Get-FileHash $dst).Hash) { Write-Host "[=] $wf identyczny z szablonem"; continue }
  if ($ForceWorkflows) { Copy-Item $src $dst -Force; Write-Host "[!] $wf NADPISANY szablonem (-ForceWorkflows) — sprawdz, czy nie zginely lokalne kroki" }
  else { Write-Host "[!] $wf istnieje i ROZNI SIE od szablonu — NIE nadpisuje. Porownaj recznie: git diff --no-index `"$src`" `"$dst`" (przenies do repo tylko brakujace wzmocnienia, np. pin SHA, gitleaks)" }
}
Copy-Item "$tpl\docs\adr\0000-template.md" "$repo\docs\adr\" -Force

if (-not (Test-Path "$repo\CLAUDE.md")) {
  Copy-Item "$tpl\CLAUDE.md" "$repo\CLAUDE.md"
  (Get-Content "$repo\CLAUDE.md" -Raw) -replace 'pg\.tier_floor: T1', "pg.tier_floor: $Tier" | Set-Content "$repo\CLAUDE.md" -Encoding utf8
  Write-Host "[+] CLAUDE.md dodany (pg.tier_floor: $Tier) — UZUPELNIJ sekcje 'Kontekst projektu'"
} else {
  if (-not ((Get-Content "$repo\CLAUDE.md" -Raw) -match 'pg\.tier_floor')) {
    Write-Host "[!] CLAUDE.md istnieje, ale bez sekcji PG v3 — dopisz recznie blok 'PG v3' z szablonu (pg.tier_floor, paradygmat, DoD)"
  } else {
    Write-Host "[=] CLAUDE.md juz ma PG v3 — nie ruszam"
  }
}

# Create-only: dokumentacja handoveru, testy, changelog, PR template, baseline lint/ts
$createOnly = @(
  "docs\REVIEW-LEARNINGS.md", "docs\RUNBOOK.md", "docs\ARCHITECTURE.md", "docs\GLOSSARY.md",
  "CHANGELOG.md", ".github\pull_request_template.md"
)
# Szablony zalezne od Node: tylko gdy repo ma package.json (rental-site = statyczny HTML bez zaleznosci;
# skopiowany e2e/smoke.spec.ts byl martwy — `Cannot find module '@playwright/test'`, finding 2026-09-05).
if (Test-Path "$repo\package.json") { $createOnly += @("e2e\smoke.spec.ts", "tsconfig.base.json") }
else { Write-Host "[=] brak package.json — pomijam e2e/smoke.spec.ts i tsconfig.base.json (szablony Node)" }
foreach ($rel in $createOnly) {
  $dst = Join-Path $repo $rel
  if (-not (Test-Path $dst)) {
    New-Item -ItemType Directory -Force -Path (Split-Path $dst) | Out-Null
    Copy-Item (Join-Path $tpl $rel) $dst
    Write-Host "[+] $rel dodany"
  }
}

# eslint: nie nadpisujemy istniejacej konfiguracji (repo Lovable maja wlasna) — kladziemy obok jako propozycje
$existingEslint = Get-ChildItem $repo -Filter "eslint.config.*" -File -ErrorAction SilentlyContinue
if ($existingEslint) {
  if (-not (Test-Path "$repo\eslint.config.mas-strict.mjs")) {
    Copy-Item "$tpl\eslint.config.mjs" "$repo\eslint.config.mas-strict.mjs"
    Write-Host "[!] eslint.config.* istnieje — strict baseline skopiowany jako eslint.config.mas-strict.mjs (porownaj i scal; pilot: npx eslint -c eslint.config.mas-strict.mjs src --max-warnings=0 | tail)"
  }
} else {
  Copy-Item "$tpl\eslint.config.mjs" "$repo\eslint.config.mjs"
  Write-Host "[+] eslint.config.mjs (strict baseline) dodany — wymaga: npm i -D eslint typescript-eslint @eslint/js globals"
}

# strict TypeScript = warunek sensu bramki tsc. Jawne "strict": false (szablon Lovable) wylacza je.
foreach ($tc in @("tsconfig.json", "tsconfig.app.json")) {
  $p = Join-Path $repo $tc
  if ((Test-Path $p) -and ((Get-Content $p -Raw) -match '"strict"\s*:\s*false')) {
    Write-Host "[!] $tc ma `"strict`": false — tsc sprawdza prawie nic. Wlacz strict (koszt zmierzony 2026-08-24: 4-14 bledow na repo Lovable). Rozwaz extends: ./tsconfig.base.json"
  }
}

# Pomiar startowy (0 tokenow): metryki + SQL, zeby progi ratchetu mialy punkt odniesienia
$bin = Join-Path $env:USERPROFILE ".claude\bin"
if (Test-Path "$bin\fleet-metrics.js") {
  New-Item -ItemType Directory -Force -Path "$repo\docs\quality" | Out-Null
  # UTF-8 bez BOM i bez lokalnej sciezki — zapis robi node (baseline-metrics.js), nie PowerShell `>`
  # (ktory zapisywal UTF-16 i wciagal absolutna sciezke worktree'a; finding agentow 2026-09-05).
  & node "$bin\baseline-metrics.js" "$repo" 2>&1 | Write-Host
  Write-Host "[+] docs/quality/baseline-metrics.json — punkt odniesienia ratchetu"
}
if ((Test-Path "$repo\supabase\migrations") -and (Test-Path "$bin\sql-migration-lint.js")) {
  & node "$bin\sql-migration-lint.js" --repo "$repo" --min-severity high | Select-Object -Last 15
  Write-Host "[i] sql-migration-lint: HIGH powyzej = dlug T3; pre-commit blokuje tylko HIGH w nowych/stagowanych plikach"
}

Write-Host "[+] Bootstrap PG v3 gotowy. Nastepne: git add -A; commit 'chore(quality): PG v3 bootstrap' (commit-msg wymaga conventional commits)"
Write-Host "[i] Sekret repo (raz, opcjonalnie): CLAUDE_CODE_OAUTH_TOKEN — bez niego claude-review.yml grzecznie sie pomija"

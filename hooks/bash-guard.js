#!/usr/bin/env node
// PreToolUse hook (matcher: Bash) — twarde bramki na komendy, ktore reguly CLAUDE.md
// zakazuja "z pamieci": --no-verify, force-push, reset --hard, rm -rf, merge PR,
// sekrety w linii komend, curl|sh. Exit 2 => komenda NIE wykonuje sie, powod wraca do Claude.
// Kazda regula ma jawny wyjatek ALLOW_X=1 w tresci komendy (swiadoma decyzja, nie odruch).
// Fail-open: kazdy wlasny blad hooka => exit 0 (nigdy nie blokuj sesji przez siebie).
'use strict';
const fs = require('fs');
let input = {};
try { input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch (e) { process.exit(0); }
if (!/^(Bash|PowerShell)$/.test(String(input.tool_name || 'Bash'))) process.exit(0);
const cmd = String((input.tool_input || {}).command || '');
if (!cmd.trim()) process.exit(0);

const allow = (k) => new RegExp('\\b' + k + '=1\\b').test(cmd);
// Dla regul git/gh testujemy komende BEZ tresci w cudzyslowach (message commita z "--no-verify" != flaga)
const cmdNQ = cmd.replace(/"[^"]*"|'[^']*'/g, '""');
const RULES = [
  { id: 'no-verify', esc: 'ALLOW_NOVERIFY',
    rx: /\bgit\s+(commit|push|merge)\b[^\n;&|]*\s(--no-verify|-n)(\s|$)/,
    why: 'git --no-verify omija pre-commit/pre-push (regula CLAUDE.md: NIGDY). Napraw lint/typy zamiast omijac bramke.' },
  { id: 'force-push', esc: 'ALLOW_FORCE',
    rx: /\bgit\s+push\b[^\n;&|]*(\s(--force|-f|--force-with-lease)(\s|$)|\s\+\w)/,
    why: 'force-push zakazany (CLAUDE.md: no force-push, no amending pushed commits). Zrob nowy commit albo nowy branch.' },
  { id: 'reset-hard', esc: 'ALLOW_RESET',
    rx: /\bgit\s+reset\b[^\n;&|]*\s--hard\b/,
    why: 'git reset --hard kasuje niezacommitowana prace (CLAUDE.md: no reset --hard). Najpierw commit/stash, albo ALLOW_RESET=1 gdy to swiadoma decyzja.' },
  { id: 'git-clean', esc: 'ALLOW_CLEAN',
    rx: /\bgit\s+clean\b[^\n;&|]*\s-[a-zA-Z]*f/,
    why: 'git clean -f kasuje nieśledzone pliki bezpowrotnie. Najpierw zobacz `git clean -n`; wyjatek ALLOW_CLEAN=1.' },
  { id: 'hooks-bypass', esc: 'ALLOW_HOOKS',
    rx: /core\.hooksPath\s*=?\s*(\/dev\/null|nul\b|""|'')|\bgit\s+-c\s+core\.hooksPath/,
    why: 'Wylaczanie core.hooksPath = omijanie globalnych git-hookow (secret-scan, lint, tsc). Zakazane.' },
  { id: 'rm-rf', esc: 'ALLOW_RM',
    test: (c) => {
      // Cele = tokeny do konca TEJ komendy (`;` `&` `|` lub koniec linii), KAZDE `rm -r` w lancuchu osobno.
      // Blizna 2026-09-12: `(.*)$` brala cala reszte linii (`rm -rf /tmp/x; set -u; T=$(mktemp -d)...`) za cele
      // -> falszywy alarm na bezpiecznym /tmp, agent uczy sie ALLOW_RM=1 (GATE-FALSE-POSITIVE-TEACHES-BYPASS).
      const matches = [...c.matchAll(/(^|[;&|]\s*|\s)rm\s+(-[a-zA-Z]*r[a-zA-Z]*|--recursive)\b([^;&|\n]*)/gm)];
      if (!matches.length) return false;
      // Tokenizacja z poszanowaniem cudzyslowow ("~/x/node_modules" = 1 cel)
      const targets = matches.flatMap((m) => (m[3].match(/"[^"]*"|'[^']*'|\S+/g) || [])).filter(t => !/^-/.test(t));
      if (!targets.length) return true;
      // Bezpieczne: katalogi build/cache (dowolna sciezka, liczy sie OSTATNI segment), tempy, *.tsbuildinfo
      const SAFE_DIRS = /^(node_modules|dist|build|out|coverage|\.next|\.turbo|\.vite|\.cache|__pycache__|\.pytest_cache|\.ruff_cache|\.tmp|tmp)$/;
      const isSafe = (raw) => {
        const t = raw.replace(/^["']|["']$/g, '').replace(/[\/\\]+$/, '');
        if (/^(\/tmp\/|\$TMPDIR|\$TEMP|\$TMP|%TEMP%|%TMP%)/.test(t) || /[\/\\]AppData[\/\\]Local[\/\\]Temp[\/\\]/i.test(t) || /\.tsbuildinfo$/.test(t)) return true;
        const segs = t.split(/[\/\\]/).filter(Boolean);
        if (!segs.length) return false;
        const last = segs[segs.length - 1];
        if (last === '*' && segs.length > 1) return SAFE_DIRS.test(segs[segs.length - 2]);
        return SAFE_DIRS.test(last);
      };
      return !targets.every(isSafe);
    },
    why: 'rm -r poza katalogami build/cache (node_modules, dist, /tmp...) = nieodwracalne. Reguła: przenies do _to_delete/ albo trash; wyjatek ALLOW_RM=1 tylko dla plikow utworzonych w tej sesji.' },
  { id: 'rm-rf-win', esc: 'ALLOW_RM',
    rx: /\b(Remove-Item|rm|del|rmdir|rd)\b[^\n;&|]*(-Recurse|\/s\b)[^\n;&|]*(-Force|\/q\b)?/i,
    test: (c) => /\b(Remove-Item|rmdir|rd)\b[^\n;&|]*(-Recurse|\/s\b)/i.test(c) && !/(node_modules|dist|\\?build|\.next|coverage|%TEMP%|\$env:TEMP|\.cache)/i.test(c),
    why: 'Rekurencyjne kasowanie (Remove-Item -Recurse / rmdir /s) poza build/cache — nieodwracalne. Przenies do _to_delete/; wyjatek ALLOW_RM=1.' },
  { id: 'pr-merge', esc: 'ALLOW_MERGE',
    rx: /\bgh\s+pr\s+merge\b/,
    why: 'Merge PR to decyzja uzytkownika (AUTO-LOOP: petla nigdy sama nie merguje na main).' },
  { id: 'gh-delete', esc: 'ALLOW_DELETE',
    rx: /\bgh\s+(repo\s+delete|api\b[^\n;&|]*-X\s*DELETE)|\bgit\s+push\b[^\n;&|]*(\s--delete\b|\s:[\w\/-]+(\s|$))/,
    why: 'Kasowanie repo/galezi zdalnej/zasobu przez API — nieodwracalne, wymaga jawnej zgody (ALLOW_DELETE=1).' },
  { id: 'secret-in-cmd', esc: 'ALLOW_SECRET',
    rx: /(ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|gho_[A-Za-z0-9]{20,}|sk-ant-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{32,}|sbp_[A-Za-z0-9]{20,}|xox[bpars]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,})/,
    why: 'Sekret w tresci komendy = trafia do transkryptu i logow. Uzyj menedzer sekretow (np. Infisical CLI): infisical run --env=dev -- <komenda>.' },
  { id: 'cred-bypass', esc: 'ALLOW_CRED',
    rx: /\bgit\s+credential(-manager)?\s+(fill|get)\b|\bgh\s+auth\s+(token|status\s+--show-token)\b|\bgit\s+config\b[^\n;&|]*credential\.helper\b[^\n;&|]*\bstore\b|cat\s+[^\n;&|]*\.git-credentials\b/,
    why: 'Jedyne zrodlo tokena GitHub = menedzer sekretow (np. Infisical CLI) (infisical run --env=dev -- ...). Czytanie GCM/gh auth/.git-credentials = obejscie bramki (2026-09-05: agent wypchnal PR przez GCM, gdy vault lezal). Gdy most nie dziala -> "push pending".' },
  { id: 'pipe-to-shell', esc: 'ALLOW_PIPE_SH',
    rx: /\b(curl|wget|iwr|Invoke-WebRequest)\b[^\n]*\|\s*(sudo\s+)?(sh|bash|zsh|iex|Invoke-Expression|powershell|pwsh)\b/i,
    why: 'curl|sh / iwr|iex = wykonanie nieprzejrzanego kodu z sieci (regula wetowania skilli/instalatorow). Pobierz do pliku, przeczytaj, potem uruchom.' },
];

try {
  for (const r of RULES) {
    if (allow(r.esc)) continue;
    // hooks-bypass czyta SUROWA komende: po zdjeciu cudzyslowow `git config core.hooksPath "C:/x"` wygladalo
    // jak `core.hooksPath ""` i blokowalo instalacje wlasnych bramek (false positive, dogfood 2026-09-05).
    const subject = /^(no-verify|force-push|reset-hard|git-clean|pr-merge|gh-delete)$/.test(r.id) ? cmdNQ : cmd;
    const hit = r.test ? r.test(subject) : r.rx.test(subject);
    if (hit) {
      process.stderr.write(`[bash-guard:${r.id}] ZABLOKOWANE / BLOCKED (rule ${r.id}; conscious escape: ${r.esc}=1 in the command). ${r.why}\nJesli to naprawde swiadoma decyzja uzytkownika: dodaj ${r.esc}=1 do komendy.\n`);
      process.exit(2);
    }
  }
} catch (e) { process.exit(0); }
process.exit(0);

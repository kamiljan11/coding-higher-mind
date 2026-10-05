'use strict';
// Jedno zrodlo prawdy „co jest warstwa kontrolna PG" dla bash-guard (komendy) i edit-guard (Edit/Write/MCP).
// Landscape #11 + design review 2026-09-26: ochrona samych hooks/ nie wystarczala — pre-commit wola bin/*.js za `[ -f ]`
// (skasowanie narzedzia = cicho wylaczona bramka), globalny core.hooksPath siedzi w ~/.gitconfig, a projektowy
// .claude/settings*.json moze wylaczyc hooki. `pg/` NIE jest chronione: postmortem dopisuje pg/cases.md w normalnym trybie.
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOME = os.homedir();
const WIN = process.platform === 'win32';

// Nazwy 8.3 (USERNA~1) i inne aliasy katalogow rozwijamy przez realpath NAJDLUZSZEGO istniejacego prefiksu —
// security-review 2026-09-26: `echo > C:/Users/USERNA~1/.claude/hooks/lib/bash-rules.js` omijal ochrone.
// Cache per proces (replay: bez cache jedna komenda z wieloma sciezkami liczyla sie 2,7 s). Aliasy 8.3 wystepuja
// tylko w nazwach zawierajacych `~`, wiec realpath robimy wylacznie dla takich sciezek.
const realCache = new Map();
function expandExisting(p) {
  if (!/^[a-zA-Z]:\//.test(p) || !p.includes('~')) return p;
  if (realCache.has(p)) return realCache.get(p);
  const parts = p.split('/');
  let out = p;
  for (let i = parts.length; i > 1; i--) {
    const head = parts.slice(0, i).join('/');
    try {
      out = [fs.realpathSync.native(head).replace(/\\/g, '/'), ...parts.slice(i)].join('/');
      break;
    } catch (e) { /* ten prefiks nie istnieje — krotszy */ }
  }
  realCache.set(p, out);
  return out;
}

/** Sciezka z komendy/narzedzia -> postac porownywalna: absolutna, `/`, male litery, bez `..`, bez aliasow Windows. */
function normalizePath(raw, cwd) {
  let p = String(raw || '').trim().replace(/^["']|["']$/g, '');
  if (!p) return '';
  const home = HOME.replace(/\\/g, '/');
  p = p.replace(/^~(?=[\/\\]|$)/, home)
    .replace(/^\$\{?HOME\}?(?=[\/\\]|$)/i, home)
    .replace(/^\$env:USERPROFILE(?=[\/\\]|$)/i, home)
    .replace(/^%USERPROFILE%(?=[\/\\]|$)/i, home)
    .replace(/\\/g, '/')
    .replace(/^\/\/[?.]\/(unc\/)?/i, (m, unc) => (unc ? '//' : ''))      // \\?\C:\x, \\.\C:\x -> C:/x
    .replace(/^\/\/[^/]+\/([a-zA-Z])\$\//i, '$1:/')                      // \\DOWOLNY-HOST\c$\x -> c:/x (weryfikator: \\<second-domain>\c$)
    .replace(/^\/([a-zA-Z])\//, (m, d) => (WIN ? d + ':/' : m))           // Git Bash /c/Users -> c:/Users (tylko Windows)
    .replace(/(:[^/:]*)?::\$DATA$|:[\w.-]+:\$DATA$/i, '')                   // strumienie NTFS (plik::$DATA)
    .replace(/(?<=[^:]):[\w.-]+$/, (m) => (/^:\d+$/.test(m) ? m : ''));     // plik:strumien (nie port)
  const isAbs = /^[a-zA-Z]:\//.test(p) || p.startsWith('/');
  const base = String(cwd || process.cwd()).replace(/\\/g, '/');
  const joined = isAbs ? p : base.replace(/\/+$/, '') + '/' + p;
  // Male litery tylko na Windowsie (NTFS nie rozroznia wielkosci). Na Linuksie sciezka po normalizacji musi dac sie
  // OTWORZYC — test PG w kontenerze 2026-09-26: `/tmp/Pg-X/env.txt` -> `/tmp/pg-x/...` = ENOENT, reguly czytajace pliki slepe.
  const norm = expandExisting(path.posix.normalize(joined));
  return (WIN ? norm.toLowerCase() : norm).replace(/\/+$/, '') || '/';
}

const H = normalizePath(HOME);
const C = H + '/.claude';
// Prefiksy (katalogi) i pliki warstwy kontrolnej. Porownanie na znormalizowanych sciezkach.
const CONTROL_DIRS = [C + '/hooks/', C + '/git-hooks/', C + '/bin/', C + '/agents/', C + '/scheduled-tasks/', C + '/logs/overrides/', C + '/logs/stop-gate-wm/', C + '/logs/pg-seen/'];
const CONTROL_FILES_RX = [
  new RegExp('^' + escapeRx(C) + '/settings(\\.local)?\\.json$'),
  // Granice zaufania i baseline odmow (security-review 2026-09-26: agent mogl sam dopisac zaufany katalog w pg/).
  // + migawka wpiec hookow (pg-wire.js): jedzie Syncthingiem na drugi komputer i trafia tam do settings.json (data-review 2026-09-26).
  // + wylacznik samozatwierdzen (ops-review 2026-10-02: agent kasujacy plik sam przywracalby sobie poziomy A/B).
  new RegExp('^' + escapeRx(C) + '/pg/(trusted-roots\\.txt|private-repos\\.txt|deny-baseline\\.json|settings-hooks\\.json|self-approval\\.off)$'),
  new RegExp('^' + escapeRx(C) + '/logs/gates(\\.\\d+)?\\.jsonl$'),
  new RegExp('^' + escapeRx(H) + '/\\.(gitconfig|bashrc|bash_profile|profile|zshrc|zprofile)$'),
  /\/documents\/(windows)?powershell\/[^/]*profile\.ps1$/,
  /\/\.git\/(config|hooks\/.*)$/,          // lokalny core.hooksPath / podmienione hooki repo
  /\/\.claude\/settings(\.local)?\.json$/, // projektowe settings moga wylaczyc hooki
  // projektowe definicje agentow: agent o nazwie recenzenta podmienia dzial (security-review r6: TOCTOU — plik tworzony
  // na czas recenzji i kasowany przed ocena dowodu). Kazdy .claude/agents/*.md poza ~/.claude = fraza uzytkownika.
  // r7: takze caly katalog (ln -s / mv / rm -r / cp -r na .claude/agents albo .claude) i podkatalogi agents/.
  /\/\.claude\/agents(\/.*)?$/,
  /\/\.claude$/,
];

function escapeRx(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function isControlPlane(raw, cwd) {
  const p = normalizePath(raw, cwd);
  if (!p) return false;
  if (CONTROL_DIRS.some((d) => p.startsWith(d) || p + '/' === d)) return true;
  return CONTROL_FILES_RX.some((rx) => rx.test(p));
}

// Konfiguracja jakosci repo (N2): luzowanie = obejscie lintu/typow bez dotykania hookow.
const CONFIG_FILE_RX = /(^|\/)(tsconfig[\w.-]*\.json|jsconfig\.json|eslint\.config\.[cm]?[jt]s|\.eslintrc(\.\w+)?|ruff\.toml|\.ruff\.toml|pyrightconfig\.json|\.oxlintrc\.json|biome\.jsonc?)$/i;
const isQualityConfig = (raw) => CONFIG_FILE_RX.test(String(raw || '').replace(/\\/g, '/'));

const TMP_ROOTS = [normalizePath(os.tmpdir()), '/tmp', '/var/tmp'];
function isTempPath(raw, cwd) {
  const p = normalizePath(raw, cwd);
  return TMP_ROOTS.some((t) => p === t || p.startsWith(t + '/')) || /\/appdata\/local\/temp\//.test(p) || p === '/dev/null' || p === 'nul';
}

// Artefakty recenzji dzialowej: recenzenci read-only MUSZA je zapisac (agents/*-reviewer.md: „zapisz do sciezki z zadania").
// Nazwa pliku + katalog przebiegu (code-review 2026-09-26: sama nazwa pozwalala recenzentowi nadpisac docs/report.md w repo).
const REVIEW_ARTIFACT_RX = /(^|\/)(findings\.[\w-]+\.json|position\.[\w-]+\.json|verdicts\.json|aggregated\.(json|md)|report\.md)$/i;
const RUN_DIR_RX = /\/pg-(review|council)-[^/]+\//i;
const isReviewArtifact = (raw, cwd) => {
  const p = normalizePath(raw, cwd);
  return REVIEW_ARTIFACT_RX.test(p) && (RUN_DIR_RX.test(p) || isTempPath(p));
};

// Poswiadczenia: klucze SSH, AWS, .netrc, git-credentials, bootstrap menedzer sekretow (np. Infisical CLI).
const CRED_PATH_RX = /[\/\\]\.ssh[\/\\](id_[\w.-]*|[\w.-]*\.pem)\b|[\/\\]\.aws[\/\\]credentials|\.git-credentials|\.claude-machine-auth|[\/\\]\.netrc\b|[\/\\]\.docker[\/\\]config\.json/i;

module.exports = { normalizePath, isControlPlane, isQualityConfig, isTempPath, isReviewArtifact, CRED_PATH_RX, CONFIG_FILE_RX, HOME, CLAUDE_DIR: C };

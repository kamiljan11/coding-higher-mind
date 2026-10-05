'use strict';
// arch-signals (2026-10-04, decyzja uzytkownika: architektura pilnowana TWARDO przy T2+): czy diff zmienia ARCHITEKTURE.
// Czysta funkcja nad sparsowanym diffem — stop-gate dostarcza tekst `git diff -U0` / `git show -U0`, tu zero I/O.
// Sygnaly (deterministyczne, z diffu, nie z promptu): nowa zaleznosc w manifescie, nowa tabela w SQL, nowy plik infra.
// Spelnienie wymogu: ADR (docs/adr/*.md) w diffie albo przebieg pg-council w sesji — sprawdza stop-gate.
// Granice (pg/known-limits.md): nowy modul/katalog bez nowej zaleznosci nie jest wykrywany; zaleznosc dopisana
// w linii z innym kluczem package.json o wartosci-wersji (np. "overrides") liczy sie jako zaleznosc (nadmiar = bezpieczny kierunek).

const MANIFEST_RX = /(^|\/)(package\.json|pyproject\.toml|requirements[\w.-]*\.txt|Cargo\.toml|go\.mod)$/i;
const INFRA_RX = /(^|\/)(Dockerfile[\w.-]*|(docker-)?compose[\w.-]*\.ya?ml|vercel\.json|netlify\.toml|fly\.toml|supabase\/config\.toml|\.github\/workflows\/[^/]+\.ya?ml)$/i;
// pg/adr = konwencja repo ~/.claude (docs/ wykluczone whitelista .gitignore) — inaczej bramka arch nie widziala ADR PG.
const ADR_RX = /(^|\/)(docs|pg)\/adr\/[^/]+\.md$/i;
const SQL_RX = /\.sql$/i;
// package.json: "nazwa": "wersja". Klucze-metadane z wersja w wartosci nie sa zaleznosciami.
// Wartosc musi WYGLADAC jak wersja (code-review 2026-10-04: "build": "next build", "homepage": "https://..",
// "description": "3D viewer" to nie zaleznosci). Zakres/semver, protokoly menedzerow pakietow, latest, *.
const NPM_DEP_RX = /^\s*"(@?[\w.\/-]+)"\s*:\s*"((?:[\^~]|[<>]=?|=)?\s*v?\d+(?:\.(?:\d+|x|\*))*(?:[-+][\w.]+)?(?:\s*(?:\|\||-|<|>)[^"]*)?|(?:workspace|npm|git\+[a-z]+|github|file|link):[^"]*|latest|\*)"/;
const NPM_NOT_DEP = new Set(['version', 'node', 'npm', 'pnpm', 'yarn', 'bun', 'packageManager', 'deno']);
// requirements/pyproject/Cargo/go.mod: `pakiet==1`, `"pakiet>=1"`, `pakiet = "1"`, `require x v1`.
const OTHER_DEP_RX = /^\s*(?:require\s+)?"?[A-Za-z][\w.\/-]*(\[[\w,\s-]+\])?"?\s*(==|>=|~=|<=|!=|\^|=\s*["{]|\s+v\d)/;
const OTHER_NOT_DEP = /^\s*(name|version|description|readme|license|edition|authors|requires-python|python|go|module)\s*=/i;
// Tresc dodana do pliku SQL sklejana w jeden tekst (CREATE rozbity na linie), bez stringow i komentarzy (data-review
// 2026-10-04: `create unlogged table`, `create\n table`, `--` w literale gubily tabele; komentarz blokowy dawal alarm).
// TEMP/TEMPORARY celowo pominiete (tabela robocza sesji, nie schemat). Ciala $$...$$ zostaja (CREATE TABLE w DO $$ liczy sie).
const CREATE_TABLE_RX = /\bcreate\s+(?:(?:global|local)\s+)?(?:unlogged\s+)?table\b/i;
const sqlCode = (lines) => lines.join('\n')
  .replace(/'(?:[^']|'')*'/g, "''")
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/--[^\n]*/g, ' ');
// Nazwa zaleznosci z linii (npm: klucz; reszta: pierwszy identyfikator) — bump wersji ISTNIEJACEJ zaleznosci != nowa
// zaleznosc (ops-review 2026-10-04: fleet-cve-watch robi patch/minor; blokada na rutynie = nawyk obchodzenia).
const depName = (l, isNpm) => {
  const m = isNpm ? NPM_DEP_RX.exec(l) : /^\s*(?:require\s+)?"?([A-Za-z][\w.\/-]*)/.exec(l);
  return m ? m[1].toLowerCase().replace(/_/g, '-') : null;
};
// ADR liczy sie, gdy ma tresc: >= ADR_MIN_LINES niepustych dodanych linii (pusty plik w docs/adr = rytual, nie decyzja).
const ADR_MIN_LINES = 5;

/** Rozbiera tekst unified diff (-U0) na { [sciezka]: { added: [linie], isNew } }. */
function parseUnifiedDiff(text) {
  const out = {};
  let cur = null;
  let pendingNew = false;
  let inHunk = false; // naglowki tylko przed pierwszym @@ — dodana linia „++ x" to tresc, nie „+++ x" (code-review)
  for (const line of String(text || '').split('\n')) {
    if (line.startsWith('diff --git ')) { cur = null; pendingNew = false; inHunk = false; continue; }
    if (!inHunk && line.startsWith('new file mode')) { pendingNew = true; continue; }
    if (line.startsWith('@@')) { inHunk = true; continue; }
    if (!inHunk && line.startsWith('+++ ')) {
      // Cytowana sciezka gita ("b/x y.sql") — bez cudzyslowow; sekwencje osemkowe zostaja (quotePath=false je wylacza).
      const p = line.slice(4).trim().replace(/^"(.*)"$/, '$1').replace(/^b\//, '');
      if (p === '/dev/null') { cur = null; continue; }
      cur = out[p] || (out[p] = { added: [], removed: [], isNew: false });
      if (pendingNew) cur.isNew = true;
      continue;
    }
    if (cur && inHunk && line.startsWith('+')) cur.added.push(line.slice(1));
    else if (cur && inHunk && line.startsWith('-')) cur.removed.push(line.slice(1));
  }
  return out;
}

/** Lista powodow „to zmiana architektoniczna" dla { [sciezka]: { added, isNew } }. Pusta = brak sygnalow. */
function archSignals(files) {
  const reasons = [];
  for (const [p, f] of Object.entries(files || {})) {
    const rel = p.replace(/\\/g, '/');
    if (INFRA_RX.test(rel) && f.isNew) reasons.push(`nowy plik infra: ${rel}`);
    if (MANIFEST_RX.test(rel)) {
      const isNpm = /package\.json$/i.test(rel);
      const isDep = (l) => {
        if (isNpm) { const m = NPM_DEP_RX.exec(l); return Boolean(m) && !NPM_NOT_DEP.has(m[1]); }
        return OTHER_DEP_RX.test(l) && !OTHER_NOT_DEP.test(l);
      };
      const before = new Set((f.removed || []).filter(isDep).map((l) => depName(l, isNpm)));
      const deps = f.added.filter((l) => isDep(l) && !before.has(depName(l, isNpm)));
      if (deps.length) reasons.push(`nowa zaleznosc w ${rel}: ${deps.slice(0, 3).map((d) => d.trim()).join(', ')}`);
    }
    if (SQL_RX.test(rel) && CREATE_TABLE_RX.test(sqlCode(f.added))) reasons.push(`nowa tabela (CREATE TABLE) w ${rel}`);
  }
  return reasons;
}

const hasAdr = (files) => Object.entries(files || {}).some(([p, f]) => ADR_RX.test(p.replace(/\\/g, '/')) &&
  (f.added || []).filter((l) => l.trim()).length >= ADR_MIN_LINES);

module.exports = { parseUnifiedDiff, archSignals, hasAdr, ADR_RX };

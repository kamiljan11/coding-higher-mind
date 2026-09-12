#!/usr/bin/env node
'use strict';
// env-ref-gate: „kazde srodowisko ma wlasna baze" (slownik SH sekcja 4; PG gap L2, PRR P15). 0 tokenow.
// Sprawdza, czy LOKALNE pliki env (.env, .env.local, .env.development*, .env.test*) wskazuja na PRODUKCYJNY
// projekt Supabase. Ref prod jest DEKLAROWANY (nie zgadywany): `SUPABASE_PROJECT_REF_PROD=<ref>` w .env.example
// albo README, albo `supabase/.temp/project-ref` (zapisany przez `supabase link` = projekt, do ktorego ida migracje),
// albo `project_id = "<ref>"` w supabase/config.toml — TYLKO gdy to 20-literowy ref (Lovable tak generuje);
// w projektach CLI `project_id` to NAZWA, nie ref (flota 2026-09-12: workshop-app, parts-shop).
// Blizna: workshop-app — testy na zywo na prodzie, org#1 czyszczona recznie (2026-07-21).
//
// Uzycie: node env-ref-gate.js --repo <sciezka> [--json]
// Exit: 0 = OK albo swiadomie pominiete (brak deklaracji / `pg.single_env: true` w CLAUDE.md — z komunikatem),
//       1 = dev wskazuje na prod (DEV-ON-PROD-DB), 2 = blad narzedzia (zly argument).
// Nigdy nie drukuje tresci linii env (moga zawierac klucze) — tylko plik:linia i zamaskowany ref.
const fs = require('fs');
const path = require('path');
const { log } = require(path.join(__dirname, '..', 'hooks', 'lib', 'gate-log.js'));
const { stripFences } = require(path.join(__dirname, '..', 'hooks', 'lib', 'risk-tier.js'));

// Ref Supabase = 20 znakow; flota ma same litery, ale cyfra w refie nie moze cicho wylaczyc bramki (code-reviewer 2026-09-12).
const PROD_REF_RX = /SUPABASE_PROJECT_REF_PROD\s*=\s*["']?([a-z0-9]{20})\b/;
const CONFIG_TOML_RX = /^\s*project_id\s*=\s*"([a-z0-9]{20})"/m;
// Wyjatek liczy sie TYLKO jako osobna linia deklaracji (jak `pg.phase`), nie zdanie w prozie/negacji/cytacie
// (security-reviewer 2026-09-12: GATE-DISABLED-BY-PROSE). Skip jest logowany do gates.jsonl.
const SINGLE_ENV_RX = /^\s*(?:-\s*)?`?pg\.single_env:\s*true`?(\s|$)/m;
const DEV_ENV_FILES = ['.env', '.env.local', '.env.development', '.env.development.local', '.env.test', '.env.test.local'];

const readIf = (file) => { try { return fs.readFileSync(file, 'utf8'); } catch (e) { return ''; } };
const maskRef = (ref) => ref.slice(0, 4) + '…' + ref.slice(-3);

const LINKED_REF_RX = /^\s*([a-z0-9]{20})\s*$/;

const TEMPLATE_PLACEHOLDER = 'wpiszrefprodukcyjny'; // z templates/repo/.env.example — 19 znakow, celowo NIE pasuje do refa

/** Zadeklarowany ref produkcji: { ref, source } | { placeholder: true } | null. Czysta funkcja (teksty -> wynik). */
function findProdRef({ envExample = '', readme = '', linkedRef = '', configToml = '' }) {
  // Szablon skopiowany bez podmiany placeholdera = nie „brak deklaracji", tylko niedokonczony setup (verifier 2026-09-12).
  if (new RegExp(`SUPABASE_PROJECT_REF_PROD\\s*=\\s*["']?${TEMPLATE_PLACEHOLDER}\\b`).test(envExample) && !linkedRef.trim()) return { placeholder: true };
  for (const [text, source] of [[envExample, '.env.example'], [readme, 'README.md']]) {
    const m = text.match(PROD_REF_RX);
    if (m) return { ref: m[1], source };
  }
  const linked = linkedRef.match(LINKED_REF_RX);
  if (linked) return { ref: linked[1], source: 'supabase/.temp/project-ref (supabase link)' };
  const t = configToml.match(CONFIG_TOML_RX);
  return t ? { ref: t[1], source: 'supabase/config.toml' } : null;
}

/** Numery linii, w ktorych tekst pliku env zawiera ref (jako host `<ref>.supabase.co`, `db.<ref>.` albo goly token). */
function findHits(text, ref) {
  const rx = new RegExp('(^|[^a-z0-9])' + ref + '(?![a-z0-9])');
  const hits = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (/^\s*#/.test(line)) return; // komentarz nie laczy sie z baza
    if (rx.test(line)) hits.push(i + 1);
  });
  return hits;
}

function check(repo) {
  const claude = stripFences(readIf(path.join(repo, 'CLAUDE.md')));
  if (SINGLE_ENV_RX.test(claude)) return { status: 'skipped', reason: 'pg.single_env: true w CLAUDE.md (swiadoma decyzja)', hits: [] };
  const prod = findProdRef({
    envExample: readIf(path.join(repo, '.env.example')) || readIf(path.join(repo, '.env.sample')),
    readme: readIf(path.join(repo, 'README.md')),
    linkedRef: readIf(path.join(repo, 'supabase', '.temp', 'project-ref')),
    configToml: readIf(path.join(repo, 'supabase', 'config.toml')),
  });
  if (prod && prod.placeholder) return { status: 'skipped', reason: `placeholder \`${TEMPLATE_PLACEHOLDER}\` z szablonu NIE podmieniony w .env.example — wpisz ref prod (20 znakow z URL Supabase) albo \`supabase link\`; do tego czasu bramka nie chroni`, hits: [] };
  if (!prod) return { status: 'skipped', reason: 'brak deklaracji SUPABASE_PROJECT_REF_PROD (.env.example/README) ani supabase/config.toml — bramka nie wie, co jest prodem', hits: [] };
  const hits = [];
  for (const name of DEV_ENV_FILES) {
    const text = readIf(path.join(repo, name));
    if (!text) continue;
    for (const line of findHits(text, prod.ref)) hits.push({ file: name, line });
  }
  return { status: hits.length ? 'dev-on-prod' : 'ok', prodRef: maskRef(prod.ref), source: prod.source, hits };
}

function main() {
  const argv = process.argv.slice(2);
  const repoIdx = argv.indexOf('--repo');
  const repo = path.resolve(repoIdx >= 0 ? argv[repoIdx + 1] || '.' : '.');
  if (!fs.existsSync(repo)) { process.stderr.write(`env-ref-gate: brak katalogu ${repo}\n`); return 2; }
  const result = check(repo);
  if (result.status === 'skipped') log({ hook: 'env-ref-gate', event: 'skipped', reason: result.reason, target: repo });
  if (argv.includes('--json')) { process.stdout.write(JSON.stringify(result) + '\n'); return result.status === 'dev-on-prod' ? 1 : 0; }
  if (result.status === 'skipped') { process.stdout.write(`env-ref-gate: pominiete — ${result.reason}\n`); return 0; }
  if (result.status === 'ok') { process.stdout.write(`env-ref-gate: OK — zaden lokalny plik env nie wskazuje na prod ${result.prodRef} (${result.source})\n`); return 0; }
  process.stdout.write(`env-ref-gate: DEV-ON-PROD-DB — lokalny env wskazuje na PRODUKCYJNY ref ${result.prodRef} (zadeklarowany w ${result.source}):\n`);
  for (const h of result.hits) process.stdout.write(`  ${h.file}:${h.line}\n`);
  process.stdout.write('Testy lokalne/preview psuja dane klientow. Przelacz na staging/branch Supabase; prototyp bez uzytkownikow: `pg.single_env: true` w CLAUDE.md z powodem.\n');
  return 1;
}

module.exports = { findProdRef, findHits, check, DEV_ENV_FILES };
if (require.main === module) process.exit(main());

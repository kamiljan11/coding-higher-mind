'use strict';
// Router ryzyka (deterministyczny, 0 tokenow). Klasyfikuje zmiane do tieru T0..T3 na podstawie
// SCIEZEK i ROZMIARU diffu — nie slow w prompcie (regexy na prompt byly kruche: PL/EN, odmiana).
// Tier decyduje, ktore "dzialy" (recenzenci) sa obowiazkowe, zanim sesja moze sie zakonczyc.
// Uzasadnienie: audyt 2026-09-05 — te same reguly dla landing page'a i dla RLS w multi-tenancie
// = paraliz albo ignorowanie; senior dozuje proces proporcjonalnie do blast radius.
// 2026-09-12 (slownik SH, gap L1/L4): FAZA projektu z CLAUDE.md (`pg.phase`) — prototyp/poc = sufit T1
// („prototyp nie jest produktem"); dzial opcjonalny qa-reviewer (`optional_reviewers`) przy UI na T2+.
const fs = require('fs');
const path = require('path');

const TIER_ORDER = ['T0', 'T1', 'T2', 'T3'];
// Cykl zycia systemu (slownik SH sekcja 2): etapu nie da sie przeskoczyc — mozna go swiadomie pominac i przyjac ryzyko.
const PHASES = ['prototype', 'poc', 'mvp', 'production', 'maintenance', 'handoff'];
const PROTOTYPE_PHASES = new Set(['prototype', 'poc']);
const PROTOTYPE_TIER_CAP = 'T1';

// T3: pieniadze, tozsamosc, izolacja tenantow, sekrety, DDL, kod uruchamiany bez czlowieka (cron/edge).
// `.env`, `.env.local`, `.env.production`, `.env.<x>.local` = sekrety (T3). Szablon bez wartosci = basename konczy sie na
// `.example/.sample/.template/.dist` (takze `.env.local.example`, konwencja Next.js) = dokumentacja, NIE T3.
// False positive zgloszony przez agenta demo-site 2026-09-05 (docs/CI-only PR dostal T3 przez `.env.example`);
// we flocie 24x `.env.example` + 2x `.env.local.example`. Nieznana kolejnosc sufiksow (`.env.example.local`) = strona bezpieczna (T3).
const T3_PATH_RX = /supabase[\/\\](migrations|functions)|\.sql$|[\/\\](auth|rls|billing|payments?|checkout|rapyd|stripe|invoice|wallet|secrets?|middleware|polic(y|ies)|webhooks?|cron|scheduled)[\/\\.]|[\/\\](admin|super)[\/\\]|(^|[\/\\])\.env(?![\w.-]*\.(example|sample|template|dist)s?$)(\.[\w.-]+)?$|infisical/i;
// T2: wspolna logika, API, dane, zaleznosci, konfiguracja buildu/CI.
const T2_PATH_RX = /[\/\\](api|routes?|server|services?|lib|hooks|store|db|data|models?|schema|integrations?)[\/\\]|package(-lock)?\.json$|pnpm-lock\.yaml$|tsconfig.*\.json$|vite\.config|next\.config|\.github[\/\\]workflows|Dockerfile|docker-compose/i;
// T0: nic nie wykonuje sie na prod inaczej niz jako tekst/styl.
const T0_PATH_RX = /\.(md|mdx|txt|css|scss|svg|png|jpe?g|webp|ico)$|[\/\\]docs?[\/\\]|CHANGELOG|README|LICENSE/i;
const UI_PATH_RX = /\.(tsx|jsx|vue|svelte)$|[\/\\](components?|pages|app|routes)[\/\\].*\.(ts|js)$/i;

const T2_LINE_THRESHOLD = 150;   // duzy diff = duzy blast radius nawet w "bezpiecznym" katalogu
const T3_LINE_THRESHOLD = 600;

// Dzialy per tier. Nazwy = subagenty w ~/.claude/agents/. Kolejnosc = priorytet, gdy budzet tnie.
const REVIEWERS_BY_TIER = {
  T0: [],
  T1: ['code-reviewer'],
  T2: ['code-reviewer', 'ops-reviewer'],
  T3: ['code-reviewer', 'security-reviewer', 'data-reviewer', 'ops-reviewer'],
};
// Dodatkowi recenzenci wg TRESCI zmiany (niezaleznie od tieru, gdy tier >= T1).
const CONTENT_REVIEWERS = [
  { rx: UI_PATH_RX, reviewer: 'ux-reviewer', why: 'UI' },
  { rx: /\.sql$|[\/\\](migrations|models?|schema|db)[\/\\]/i, reviewer: 'data-reviewer', why: 'schemat/dane' },
];
// Dzialy OPCJONALNE (na zadanie, nie blokuja stop-gate): QA potrzebuje DZIALAJACEJ apki i URL, wiec orkiestrator
// (pg-review krok 1b) decyduje, czy jest sens. Zglaszane, gdy diff dotyka UI / route / edge fn przy T2+.
const OPTIONAL_REVIEWERS = [
  { rx: /\.(tsx|jsx|vue|svelte)$|[\/\\](routes?|pages|app)[\/\\]|supabase[\/\\]functions/i, reviewer: 'qa-reviewer', minTier: 'T2', why: 'UI/route/edge fn — sciezki krytyczne na instancjach (docs/CRITICAL-PATHS.md), na zadanie' },
];

const maxTier = (a, b) => (TIER_ORDER.indexOf(a) >= TIER_ORDER.indexOf(b) ? a : b);
const rel = (root, file) => (root ? path.relative(root, file) : file).replace(/\\/g, '/');
// Bloki ```...``` wyciete: przyklad `pg.phase: prototype` w bloku kodu CLAUDE.md nie jest deklaracja (security-reviewer 2026-09-12).
const stripFences = (text) => text.replace(/```[\s\S]*?```/g, '');
const readClaudeMd = (root) => { try { return stripFences(fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8')); } catch (e) { return ''; } };

// Repo moze podniesc podloge tieru w CLAUDE.md: `pg.tier_floor: T2` (nigdy nie obniza wyniku z diffu).
function tierFloor(root) {
  if (!root) return 'T0';
  const m = readClaudeMd(root).match(/pg\.tier_floor:\s*(T[0-3])/);
  return m ? m[1] : 'T0';
}

// QA warunkowo obowiazkowe (narada D-2026-09-12-qa-mandatory, opcja C, majority ops+ux; sprzeciw code->D, product->B):
// qa-reviewer wchodzi do WYMAGANYCH tylko na T3 z UI/route/edge fn I tylko gdy repo jest na to gotowe —
// `docs/CRITICAL-PATHS.md` z blokiem ```json ORAZ osobna linia `pg.qa_url: http(s)://...` w CLAUDE.md.
// Bramka niespelnialna (brak apki/URL) uczy obchodzenia (GATE-FALSE-POSITIVE-TEACHES-BYPASS), wiec bez opt-in = tylko ostrzezenie.
const QA_URL_LINE_RX = /^\s*(?:-\s*)?`?pg\.qa_url:\s*(https?:\/\/\S+?)`?\s*(?:<!--.*)?$/m;
const QA_JSON_FENCE_RX = /```json\s*\n[\s\S]*?"paths"[\s\S]*?\n```/;
function qaGateReady(root) {
  if (!root) return null;
  const m = readClaudeMd(root).match(QA_URL_LINE_RX);
  if (!m) return null;
  let doc = '';
  try { doc = fs.readFileSync(path.join(root, 'docs', 'CRITICAL-PATHS.md'), 'utf8'); } catch (e) { return null; }
  return QA_JSON_FENCE_RX.test(doc) ? m[1] : null;
}

// Faza projektu z CLAUDE.md: `pg.phase: prototype|poc|mvp|production|maintenance|handoff`. Brak/nieznana = null.
// Deklaracja liczy sie TYLKO jako osobna linia (`- \`pg.phase: x\``, opcjonalny komentarz HTML) — nie w prozie,
// negacji ani bloku kodu (security-reviewer 2026-09-12: TIER-DOWNGRADE-FROM-REPO-DATA).
const PHASE_LINE_RX = /^\s*(?:-\s*)?`?pg\.phase:\s*([a-z]+)`?\s*(?:<!--.*)?$/m;
function phaseOf(root) {
  if (!root) return null;
  const m = readClaudeMd(root).match(PHASE_LINE_RX);
  return m && PHASES.includes(m[1]) ? m[1] : null;
}

// files: sciezki absolutne zmienionych plikow; changedLines: suma dodanych+usunietych linii (moze byc 0/undefined)
// Zwraca { tier, phase, reasons: [...], reviewers: [...], optional_reviewers: [...] }
function classify(files, changedLines, root) {
  let tier = 'T0';
  const reasons = [];
  let hasT3Path = false;
  const floor = tierFloor(root);
  if (floor !== 'T0' && files.length) { tier = floor; reasons.push(`${floor}: pg.tier_floor w CLAUDE.md`); }
  for (const file of files) {
    const r = rel(root, file);
    if (T3_PATH_RX.test(r)) { tier = maxTier(tier, 'T3'); hasT3Path = true; reasons.push(`T3: ${r}`); }
    else if (T2_PATH_RX.test(r)) { tier = maxTier(tier, 'T2'); reasons.push(`T2: ${r}`); }
    else if (!T0_PATH_RX.test(r)) { tier = maxTier(tier, 'T1'); }
  }
  const lines = Number(changedLines) || 0;
  if (lines > T3_LINE_THRESHOLD) { tier = maxTier(tier, 'T3'); reasons.push(`T3: ${lines} linii > ${T3_LINE_THRESHOLD}`); }
  else if (lines > T2_LINE_THRESHOLD) { tier = maxTier(tier, 'T2'); reasons.push(`T2: ${lines} linii > ${T2_LINE_THRESHOLD}`); }

  // Sufit dla prototypu: review dzialowy prototypu = ceremonia, ktora uczy omijania bramek. Sekrety i lint/tsc/testy
  // (bramki 0-tokenowe) obowiazuja niezaleznie od tieru — to jest tylko o RECENZENTACH.
  // NIGDY dla sciezek T3 (migracje, auth, RLS, platnosci, sekrety, cron): jedno zdanie w CLAUDE.md repo nie moze
  // zdjac security/data-reviewera z RLS (security-reviewer 2026-09-12). Sufit tnie tylko tier z rozmiaru/lib.
  const phase = phaseOf(root);
  let phaseCapped = false;
  if (phase && PROTOTYPE_PHASES.has(phase) && !hasT3Path && TIER_ORDER.indexOf(tier) > TIER_ORDER.indexOf(PROTOTYPE_TIER_CAP)) {
    reasons.push(`${PROTOTYPE_TIER_CAP} (sufit): pg.phase ${phase} — prototyp nie jest produktem; promocja do production = PRR (bin/phase-gate.js)`);
    tier = PROTOTYPE_TIER_CAP;
    phaseCapped = true;
  } else if (phase && PROTOTYPE_PHASES.has(phase) && hasT3Path) {
    reasons.push(`pg.phase ${phase} NIE zdejmuje tieru: sciezki T3 (migracje/auth/RLS/sekrety) zawsze z security/data`);
  }

  const reviewers = new Set(REVIEWERS_BY_TIER[tier]);
  const optional = new Set();
  if (tier !== 'T0') {
    for (const { rx, reviewer, why } of CONTENT_REVIEWERS) {
      if (files.some((f) => rx.test(rel(root, f)))) { reviewers.add(reviewer); reasons.push(`+${reviewer} (${why})`); }
    }
    for (const { rx, reviewer, minTier, why } of OPTIONAL_REVIEWERS) {
      if (TIER_ORDER.indexOf(tier) >= TIER_ORDER.indexOf(minTier) && files.some((f) => rx.test(rel(root, f)))) {
        optional.add(reviewer); reasons.push(`?${reviewer} (${why})`);
      }
    }
  }
  let qaUrl = null;
  if (tier === 'T3' && optional.has('qa-reviewer')) {
    qaUrl = qaGateReady(root);
    if (qaUrl) { optional.delete('qa-reviewer'); reviewers.add('qa-reviewer'); reasons.push(`+qa-reviewer (T3 UI, repo gotowe: docs/CRITICAL-PATHS.md + pg.qa_url — narada D-2026-09-12 opcja C)`); }
  }
  return { tier, phase, phaseCapped, qaUrl, reasons: reasons.slice(0, 10), reviewers: [...reviewers], optional_reviewers: [...optional] };
}

// Ktory model dla recenzenta w danym tierze (regula uzytkownika: Sonnet do roboty narzedziowej, Opus do trudnego rozumowania).
function modelFor(reviewer, tier) {
  if (tier === 'T3' && /security|data/.test(reviewer)) return 'opus';
  return 'sonnet';
}

module.exports = { classify, modelFor, phaseOf, qaGateReady, stripFences, REVIEWERS_BY_TIER, TIER_ORDER, PHASES, PROTOTYPE_PHASES, T2_LINE_THRESHOLD, T3_LINE_THRESHOLD };

// CLI: node risk-tier.js <root> <plik>... [--lines N]
if (require.main === module) {
  const args = process.argv.slice(2);
  const linesIdx = args.indexOf('--lines');
  const lines = linesIdx >= 0 ? Number(args[linesIdx + 1]) : 0;
  const positional = args.filter((a, i) => a !== '--lines' && i !== linesIdx + 1);
  const [root, ...files] = positional;
  const result = classify(files, lines, root);
  result.models = Object.fromEntries(result.reviewers.map((r) => [r, modelFor(r, result.tier)]));
  result.optional_models = Object.fromEntries(result.optional_reviewers.map((r) => [r, modelFor(r, result.tier)]));
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

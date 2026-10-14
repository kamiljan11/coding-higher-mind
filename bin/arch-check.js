#!/usr/bin/env node
'use strict';
// arch-check — zgodnosc repo z ustalona architektura (docs/architecture/obszary.md), 0 tokenow.
// Decyzja uzytkownika 2026-10-11: przy wczytaniu projektu krotki raport (1-3 linie, SessionStart); drift zrobiony w BIEZACEJ
// sesji agent naprawia sam (stop-gate, --since); stare problemy = lista z propozycja, naprawa na „napraw" (ZAKRES).
// Sprawdza: (1) luki macierzy (sd-matrix-lint), (2) drift: technologia w kodzie/zaleznosciach vs wiersz obszaru
// (NIE DOTYCZY/NIE TERAZ albo DECYZJA bez wzmianki), (3) dowody DECYZJI wskazujace nieistniejacy plik/linie.
// (4) cel architektury: `## Cel architektury` (Cel: + ranking priorytetow) w docs/ARCHITECTURE.md albo w macierzy — pytanie
// „czy architektura ma konkretny cel i czy zespol go zna” (uzytkownik 2026-10-11): zespol = uzytkownik + agenci, wiec cel idzie do
// raportu na starcie KAZDEJ sesji (--brief), a jego brak to problem `no-goal` (blokuje tylko NOWE repo z pg.sd_matrix: required).
// NIE mierzy produkcji (metryki bazy = osobna decyzja); sygnaly NIE TERAZ wypisuje --signals.
// Uzycie: arch-check.js --repo <dir> [--brief|--json|--signals] [--since <ref>|--since-shas a,b] [--new-only]
// Exit: 0 czysto, 1 sa problemy (z --new-only: sa NOWE), 2 blad.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const lint = require('./sd-matrix-lint.js');

const AREAS_FILE = path.join(__dirname, '..', 'pg', 'sd-areas.json');
const MATRIX_REL = lint.MATRIX_REL;
const CODE_GLOBS = ['*.ts', '*.tsx', '*.js', '*.jsx', '*.mjs', '*.py', '*.sql'];
const GOAL_FILES = ['docs/ARCHITECTURE.md', MATRIX_REL];
const GOAL_PLACEHOLDER_RX = /<[^\s<>](?:[^<>]*[^\s<>])?>/;
const SKIP_PATH_RX = /(^|\/)(node_modules|dist|build|\.next|coverage|vendor|__tests__|tests?|e2e|fixtures?)\//;

// Sygnal -> obszary (pierwszy obecny w macierzy wiersz ocenia sygnal). keys = slowa, ktorych wzmianka w wierszu = deklaracja.
const SIGNALS = [
  { tech: 'redis/kv', areas: ['caching'], deps: /^(redis|ioredis|@upstash\/redis|@vercel\/kv|keyv)$/, keys: ['redis', 'upstash', 'valkey', 'vercel kv'] },
  { tech: 'kolejka/joby', areas: ['queues', 'stack-jobs'], deps: /^(bullmq|bull|bee-queue|pg-boss|graphile-worker|@upstash\/qstash|inngest|@trigger\.dev\/sdk|amqplib|@aws-sdk\/client-sqs)$/, keys: ['bull', 'pg-boss', 'pgboss', 'graphile', 'qstash', 'inngest', 'trigger', 'rabbit', 'amqp', 'sqs', 'kolejk', 'queue'] },
  { tech: 'kafka', areas: ['stream-processing'], deps: /^(kafkajs|@confluentinc\/kafka-javascript)$/, keys: ['kafka'] },
  { tech: 'realtime', areas: ['real-time', 'stack-rt'], deps: /^(socket\.io|socket\.io-client|ws|pusher|pusher-js|ably|@liveblocks\/client|partykit)$/, code: '\\.channel\\(|new EventSource\\(|new WebSocket\\(', keys: ['realtime', 'real-time', 'socket', 'websocket', 'pusher', 'ably', 'liveblocks', 'sse', 'eventsource'] },
  { tech: 'wyszukiwarka', areas: ['search', 'stack-search'], deps: /^(algoliasearch|meilisearch|typesense|@elastic\/elasticsearch|@opensearch-project\/opensearch)$/, keys: ['algolia', 'meili', 'typesense', 'elastic', 'opensearch'] },
  { tech: 'object storage', areas: ['object-storage', 'stack-blob'], deps: /^(@aws-sdk\/client-s3|@vercel\/blob|@google-cloud\/storage|uploadthing|cloudinary)$/, code: '\\.storage\\s*\\.from\\(', keys: ['s3', 'blob', 'storage', 'bucket', 'uploadthing', 'cloudinary'] },
  { tech: 'observability', areas: ['observability', 'stack-mon'], deps: /^(@sentry\/[\w.-]+|@opentelemetry\/[\w.-]+|pino|winston|@axiomhq\/[\w.-]+|@logtail\/[\w.-]+|dd-trace)$/, keys: ['sentry', 'opentelemetry', 'otel', 'pino', 'winston', 'axiom', 'logtail', 'datadog'] },
  { tech: 'powiadomienia/mail/sms', areas: ['notifications', 'stack-mail'], deps: /^(resend|nodemailer|@sendgrid\/mail|postmark|twilio|web-push|firebase-admin|@novu\/node|expo-server-sdk)$/, keys: ['resend', 'nodemailer', 'sendgrid', 'postmark', 'twilio', 'push', 'fcm', 'firebase', 'novu', 'e-mail', 'email', 'sms'] },
  { tech: 'geo', areas: ['geospatial'], deps: /^(@turf\/[\w.-]+|leaflet|mapbox-gl|maplibre-gl|h3-js|ngeohash)$/, code: 'create extension[^;]*postgis|ST_DWithin|ST_Distance', keys: ['postgis', 'turf', 'leaflet', 'mapbox', 'maplibre', 'h3', 'geohash', 'geospatial'] },
  { tech: 'rate limit', areas: ['rate-limiting'], deps: /^(@upstash\/ratelimit|rate-limiter-flexible|express-rate-limit)$/, keys: ['ratelimit', 'rate-limit', 'rate limit', 'limiter', 'upstash'] },
  { tech: 'platnosci', areas: ['stack-pay'], deps: /^(stripe|@stripe\/[\w.-]+|@paypal\/[\w.-]+|@payment-provider\/[\w.-]+|przelewy24[\w.-]*|@adyen\/[\w.-]+)$/, keys: ['stripe', 'paypal', 'payment-provider', 'przelewy', 'p24', 'adyen', 'payu', 'platnos', 'płatnoś'] },
  { tech: 'AI/LLM', areas: ['stack-ai'], deps: /^(@anthropic-ai\/sdk|openai|ai|@ai-sdk\/[\w.-]+|langchain|@langchain\/[\w.-]+)$/, keys: ['anthropic', 'claude', 'openai', 'llm', 'ai sdk', 'langchain'] },
  { tech: 'analityka produktu', areas: ['stack-pa'], deps: /^(posthog-js|posthog-node|mixpanel-browser|@amplitude\/[\w.-]+|@vercel\/analytics|plausible-tracker)$/, keys: ['posthog', 'mixpanel', 'amplitude', 'analytics', 'plausible', 'analityk'] },
  { tech: 'kontenery', areas: ['docker-containers'], files: /(^|\/)(Dockerfile(\.[\w-]+)?|docker-compose\.ya?ml|compose\.ya?ml)$/, keys: ['docker', 'kontener', 'container', 'compose', 'obraz'] },
  { tech: 'kubernetes', areas: ['kubernetes'], files: /(^|\/)(Chart\.yaml|kustomization\.ya?ml|k8s\/[\w./-]+\.ya?ml)$/, keys: ['kubernetes', 'k8s', 'helm', 'klaster'] },
];

function git(root, args, timeout = 4000) {
  const r = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', timeout, maxBuffer: 16 * 1024 * 1024 });
  return { ok: r.status === 0, out: String(r.stdout || ''), code: r.status };
}

// Czytnik drzewa: working tree (ref=null) albo commit (ref) — ten sam kod sprawdzen dla „teraz" i „na starcie sesji".
function makeTree(root, ref, isGit) {
  if (!ref) {
    return {
      read: (rel) => { try { return fs.readFileSync(path.join(root, rel), 'utf8'); } catch (e) { return null; } },
      exists: (rel) => fs.existsSync(path.join(root, rel)),
      files: () => (isGit ? git(root, ['ls-files', '--cached', '--others', '--exclude-standard']).out.split('\n').filter(Boolean) : listDir(root)),
      grep: (rx) => (isGit ? grepFiles(git(root, ['grep', '-l', '-I', '-i', '-E', '--untracked', rx, '--', ...CODE_GLOBS]).out) : []),
    };
  }
  return {
    read: (rel) => { const r = git(root, ['show', `${ref}:${rel}`]); return r.ok ? r.out : null; },
    exists: (rel) => git(root, ['cat-file', '-e', `${ref}:${rel}`]).ok,
    files: () => git(root, ['ls-tree', '-r', '--name-only', ref]).out.split('\n').filter(Boolean),
    grep: (rx) => grepFiles(git(root, ['grep', '-l', '-I', '-i', '-E', rx, ref, '--', ...CODE_GLOBS]).out.replace(new RegExp(`^${ref.replace(/[^\w]/g, '.')}:`, 'gm'), '')),
  };
}

function grepFiles(out) { return out.split('\n').filter((f) => f && !SKIP_PATH_RX.test(f)); }

function listDir(root, rel = '', acc = [], depth = 0) {
  if (depth > 4 || acc.length > 5000) return acc;
  let ents = [];
  try { ents = fs.readdirSync(path.join(root, rel), { withFileTypes: true }); } catch (e) { return acc; }
  for (const e of ents) {
    if (e.name === 'node_modules' || e.name.startsWith('.git')) continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) listDir(root, r, acc, depth + 1); else acc.push(r);
  }
  return acc;
}

function depsOf(tree) {
  const names = new Set();
  const pkg = tree.read('package.json');
  if (pkg) {
    try {
      const j = JSON.parse(pkg);
      for (const k of ['dependencies', 'devDependencies', 'optionalDependencies']) Object.keys(j[k] || {}).forEach((d) => names.add(d));
    } catch (e) { /* zly package.json zglosi lint/CI, nie ta bramka */ }
  }
  for (const f of ['requirements.txt', 'pyproject.toml']) {
    const t = tree.read(f);
    if (t) (t.match(/^[\s"']*([A-Za-z0-9_.-]+)/gm) || []).forEach((m) => names.add(m.replace(/[\s"']/g, '').toLowerCase()));
  }
  return names;
}

// Wzmianka = slowo kluczowe albo rdzen nazwy zaleznosci (`@sentry/nextjs` -> sentry, `ws`) od granicy slowa (`ws` != „news").
const depStem = (d) => (d.startsWith('@') ? d.slice(1).split('/')[0] : d);
const esc = (k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function mentions(row, keys) {
  const text = `${row.decision} ${row.evidence}`.toLowerCase();
  return keys.some((k) => new RegExp(`(^|[^a-z0-9ąćęłńóśźż])${esc(k.toLowerCase())}`).test(text));
}

// Sciezki plikow w komorce dowodu: `src/a/b.ts:12`, docs/x.md. URL-e, ~ i sciezki absolutne pomijane (nie sa w repo).
// Segmenty z nawiasami dozwolone: grupy tras Next `src/app/(app)/x.ts`, `[id]`.
// Katalogi bez kropki w srodku (`Node.js/Express.js` to nie sciezka; `.github/` tak), znane rozszerzenia (`RLS/auth.uid` odpada), bez `..`.
const EXT = 'ts|tsx|js|jsx|mjs|cjs|json|jsonc|md|mdx|sql|py|yml|yaml|toml|css|scss|html|sh|txt|prisma|graphql|go|rs|env|example|lock|vue|svelte|astro';
const PATH_RX = new RegExp(`^((?:\\.?[\\w@()[\\]-]+\\/)+[\\w@.()[\\]-]+\\.(?:${EXT}))(?::(\\d+)(?:-\\d+)?)?$`);
const balance = (t) => (t.match(/\(/g) || []).length - (t.match(/\)/g) || []).length;
function evidencePaths(cell) {
  const out = [];
  const s = String(cell).replace(/https?:\/\/\S+/g, ' ');
  for (let tok of s.split(/[\s`,;"'|]+/)) {
    tok = tok.replace(/[.:]+$/, '');
    while (tok.length > 2 && tok.startsWith('(') && tok.endsWith(')')) tok = tok.slice(1, -1);
    while (tok.startsWith('(') && balance(tok) > 0) tok = tok.slice(1);
    while (tok.endsWith(')') && balance(tok) < 0) tok = tok.slice(0, -1);
    tok = tok.replace(/[.:]+$/, '');
    const m = tok.match(PATH_RX);
    if (!m) continue;
    const p = m[1];
    if (p.startsWith('~') || p.startsWith('/') || /^(node|npm|npx|pnpm|git|gh)\b/.test(p)) continue;
    out.push({ path: p.replace(/^\.\//, ''), line: m[2] ? Number(m[2]) : null });
  }
  return out;
}

// Cel architektury: pierwsza sekcja `## Cel architektury` z GOAL_FILES. Placeholdery szablonu (<...>, …) = brak.
function readGoal(tree) {
  for (const rel of GOAL_FILES) {
    const t = tree.read(rel);
    if (t == null) continue;
    const m = /^##[ \t]+Cel architektury\b[^\n]*\n([\s\S]*?)(?=^##[ \t]|(?![\s\S]))/m.exec(lint.stripNonContent(t).replace(/<!--[\s\S]*?-->/g, ''));
    if (!m) continue;
    const real = (s) => !!s && !GOAL_PLACEHOLDER_RX.test(s.normalize('NFKC')) && s.replace(/[*_`]/g, '').trim().length >= 3;
    const goal = (/^\s*(?:[-*]\s*)?\**Cel\**\s*:\**\s*(.+)$/mi.exec(m[1]) || [])[1];
    const priorities = [...m[1].matchAll(/^\s*\d+\.\s+(.+)$/gm)].map((x) => x[1].trim()).filter(real);
    const sacrifice = (/^\s*(?:[-*]\s*)?\**[SŚ]wiadomie po[sś]wi[eę]camy\**\s*:\**\s*(.+)$/mi.exec(m[1]) || [])[1];
    return { file: rel, goal: real(goal) ? goal.trim() : null, priorities, sacrifice: real(sacrifice) ? sacrifice.trim() : null };
  }
  return null;
}

function check(root, tree, areasAll) {
  const issues = [];
  const text = tree.read(MATRIX_REL);
  const hasPkg = tree.exists('package.json') || tree.exists('pyproject.toml') || tree.exists('requirements.txt');
  if (text == null) {
    if (hasPkg) issues.push({ kind: 'no-matrix', key: 'no-matrix', msg: `brak macierzy obszarow ${MATRIX_REL}`, fix: 'narada obszarow: skill architecture-advisor (szablon: node ~/.claude/bin/sd-matrix-lint.js --template)' });
    // Cel powstaje PRZED macierza (design.md B.0): pokazujemy go i liczymy jego brak takze w repo bez macierzy (product-review 2026-10-11).
    const goal = readGoal(tree);
    if (hasPkg) goalIssue(goal, issues);
    return { issues, rows: [], hasMatrix: false, goal };
  }
  const parsed = lint.parseMatrix(text);
  const res = lint.lintMatrix(parsed, areasAll.areas);
  const oneWay = new Set(areasAll.areas.filter((a) => a.one_way).map((a) => a.id));
  for (const i of (res.issues || [])) {
    issues.push({ kind: 'gap', key: `gap|${i.id || i.msg}`, area: i.id, oneWay: oneWay.has(i.id), msg: i.msg, fix: i.id ? `rozstrzygnij wiersz ${i.id} (DECYZJA+dowod / NIE DOTYCZY / NIE TERAZ+sygnal)` : 'popraw format macierzy' });
  }
  const byId = new Map(parsed.rows.map((r) => [r.id, r]));
  const deps = depsOf(tree);
  const files = tree.files();
  for (const s of SIGNALS) {
    const row = s.areas.map((a) => byId.get(a)).find(Boolean);
    if (!row) continue; // brak wiersza = luka (wyzej), nie drift
    const hits = [];
    const keys = [...s.keys];
    if (s.deps) for (const d of deps) if (s.deps.test(d)) { hits.push(`zaleznosc ${d}`); keys.push(depStem(d)); }
    if (s.files) for (const f of files) if (s.files.test(f) && !SKIP_PATH_RX.test(f)) { hits.push(`plik ${f}`); break; }
    if (s.code && !hits.length) { const g = tree.grep(s.code); if (g.length) hits.push(`kod ${g[0]}${g.length > 1 ? ` (+${g.length - 1})` : ''}`); }
    if (!hits.length) continue;
    const st = row.status;
    if (/NIE DOTYCZY|NIE TERAZ/.test(st)) {
      issues.push({ kind: 'drift', key: `drift|${row.id}|${s.tech}`, area: row.id, msg: `${s.tech}: ${hits.join(', ')}, a macierz mowi ${st} (${row.id}, linia ${row.line})`, fix: `zmien ${row.id} na DECYZJA z dowodem (+ADR) albo usun ${s.tech} z kodu` });
    } else if (/DECYZJA/.test(st) && !mentions(row, keys)) {
      issues.push({ kind: 'undeclared', key: `undeclared|${row.id}|${s.tech}`, area: row.id, msg: `${s.tech}: ${hits.join(', ')} — DECYZJA ${row.id} (linia ${row.line}) o tym nie mowi`, fix: `dopisz ${s.tech} do decyzji/dowodu w ${row.id} albo usun z kodu` });
    }
  }
  for (const row of parsed.rows) {
    if (!/DECYZJA/.test(row.status)) continue;
    for (const ev of evidencePaths(row.evidence)) {
      // Skrot wzgledem wczesniejszej sciezki w tej samej komorce (`src/app/(app)/radar/x.ts ... profil/x.ts`) = sufiks pliku z repo.
      const real = tree.read(ev.path) != null ? ev.path : files.find((f) => f.endsWith('/' + ev.path));
      const body = real ? tree.read(real) : null;
      if (body == null) {
        if (tree.exists(ev.path)) continue; // katalog / nieczytelny — nie zgadujemy
        issues.push({ kind: 'stale-evidence', key: `stale|${row.id}|${ev.path}`, area: row.id, msg: `dowod ${row.id} wskazuje ${ev.path} — plik nie istnieje`, fix: `zaktualizuj dowod ${row.id} (nowa sciezka) albo decyzje` });
      } else if (ev.line && ev.line > body.split('\n').length - (body.endsWith('\n') ? 1 : 0)) {
        issues.push({ kind: 'stale-evidence', key: `stale|${row.id}|${ev.path}:${ev.line}`, area: row.id, msg: `dowod ${row.id} wskazuje ${ev.path}:${ev.line} — plik ma mniej linii`, fix: `popraw numer linii w dowodzie ${row.id}` });
      }
    }
  }
  const goal = readGoal(tree);
  goalIssue(goal, issues);
  return { issues, rows: parsed.rows, hasMatrix: true, goal };
}

function goalIssue(goal, issues) {
  if (!goal || !goal.goal || goal.priorities.length < 2) {
    issues.push({ kind: 'no-goal', key: 'no-goal', msg: goal ? `cel architektury niepelny w ${goal.file} (potrzeba: „Cel:” + min. 2 priorytety w kolejnosci)` : 'brak celu architektury (sekcja „## Cel architektury” w docs/ARCHITECTURE.md)', fix: 'wpisz cel (1 zdanie), ranking 2-3 priorytetow i co swiadomie poswiecamy (pg/design.md B.0)' });
  }
}

// Wylacznik: env PG_ARCH_CHECK=0 (awaryjnie, wszedzie) albo linia `pg.arch_check: off` w CLAUDE.md repo (np. stary Lovable).
function archOff(root) {
  if (process.env.PG_ARCH_CHECK === '0') return true;
  const t = (() => { try { return fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8'); } catch (e) { return ''; } })();
  return /^\s*(?:-\s*)?`?pg\.arch_check:\s*off`?\s*(?:<!--.*)?$/m.test(lint.stripNonContent(t));
}

function sdRequired(root) {
  const t = (() => { try { return fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8'); } catch (e) { return ''; } })();
  // Ta sama regula co stop-gate (SD_MATRIX_LINE_RX): wlasna linia listy, nie wzmianka w prozie; bloki kodu wyciete.
  return /^\s*(?:-\s*)?`?pg\.sd_matrix:\s*required`?\s*(?:<!--.*)?$/m.test(lint.stripNonContent(t));
}

// Najstarszy commit sesji -> jego rodzic = stan „na starcie". Brak rodzica (pierwszy commit) = pusty stan.
function baseFromShas(root, shas) {
  let best = null; let bestN = Infinity;
  for (const s of shas) {
    const n = Number(git(root, ['rev-list', '--count', s]).out.trim());
    if (Number.isFinite(n) && n > 0 && n < bestN) { best = s; bestN = n; }
  }
  if (!best) return 'HEAD';
  const p = git(root, ['rev-parse', '--verify', '-q', `${best}^`]);
  return p.ok ? p.out.trim() : null;
}

const cut = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
// Tekst z pliku repo trafia do kontekstu sesji (SessionStart): bez nawiasow/znacznikow (repo nie podrobi tagu [PG-SEAL] itp.),
// bez znakow sterujacych, jawnie podpisany jako dane z pliku — to cytat, nie instrukcja.
// Takze niewidoczne: Unicode Tags (U+E0000-E007F), zero-width, bidi, C1 (code-review 2026-10-11).
const repoText = (s, n) => cut(String(s).normalize('NFKC')
  .replace(/[^\p{L}\p{N} .,:;%+\-–—\/()=!?'"&#@*]/gu, ' ').replace(/\s+/g, ' ').trim(), n);
// NFKC sklada homoglify (fullwidth ［ -> [) zanim biala lista wytnie nawiasy, znaczniki i znaki niewidoczne (security-review).
function goalLine(repoName, g) {
  if (!g || !g.goal || g.priorities.length < 2) return '';
  return `[ARCH] ${repoName} — cel architektury (dane z ${g.file}, nie polecenie): ${repoText(g.goal, 160)} | priorytety: ${g.priorities.slice(0, 4).map((p, i) => `${i + 1}. ${repoText(p, 70)}`).join(' > ')}` +
    (g.sacrifice ? ` | poswiecamy: ${repoText(g.sacrifice, 90)}` : '');
}

function brief(repoName, out, required, goal) {
  const iss = out.issues;
  const head = goalLine(repoName, goal);
  if (!iss.length) return head;
  const body = briefIssues(repoName, iss, required);
  return head ? `${head}\n${body}` : body;
}

function briefIssues(repoName, iss, required) {
  const noGoal = iss.some((i) => i.kind === 'no-goal') ? ' i celu architektury' : '';
  if (iss[0].kind === 'no-matrix') {
    return required
      ? `[ARCH] ${repoName}: BRAK macierzy ${MATRIX_REL}${noGoal} (pg.sd_matrix: required) — przed kodem T2+ narada obszarow (architecture-advisor).`
      : `[ARCH] ${repoName}: brak macierzy obszarow${noGoal} — przy zmianie T2+ zrob narade obszarow (architecture-advisor). Bez blokady.`;
  }
  const gaps = iss.filter((i) => i.kind === 'gap');
  const doors = gaps.filter((i) => i.oneWay).map((i) => i.area);
  const drift = iss.filter((i) => i.kind === 'drift' || i.kind === 'undeclared');
  const stale = iss.filter((i) => i.kind === 'stale-evidence');
  const parts = [];
  if (drift.length) parts.push(`drift ${drift.length} (${drift.slice(0, 2).map((i) => i.msg.split(':')[0] + ' -> ' + i.area).join('; ')})`);
  if (stale.length) parts.push(`nieaktualne dowody ${stale.length}`);
  const stackGaps = gaps.filter((i) => /^stack-/.test(i.area || '') && /brak wiersza/.test(i.msg));
  const coreGaps = gaps.length - stackGaps.length;
  if (coreGaps) parts.push(`luki ${coreGaps}${doors.length ? ` (drzwi jednokierunkowe: ${doors.slice(0, 4).join(', ')})` : ''}`);
  if (stackGaps.length) parts.push(`warstwy stack bez wiersza ${stackGaps.length} (sd-matrix-lint.js --template --groups stack)`);
  if (iss.some((i) => i.kind === 'no-goal')) parts.push('brak celu architektury (pg/design.md B.0)');
  return `[ARCH] ${repoName}: ${parts.join(' · ')}.\n` +
    `  Lista z propozycjami: node ~/.claude/bin/arch-check.js --repo . — stare problemy naprawiam na „napraw architekture"; nowe w tej sesji naprawiam sam.`;
}

function signals(rows) {
  return rows.filter((r) => /NIE TERAZ/.test(r.status)).map((r) => `- ${r.id}: ${lint.stripNonContent(r.signal).replace(/\s+/g, ' ').slice(0, 200)}`);
}

function parseArgs(argv) {
  const o = { repo: process.cwd(), mode: 'full', since: null, sinceShas: null, newOnly: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--repo') o.repo = argv[++i];
    else if (a === '--brief') o.mode = 'brief';
    else if (a === '--json') o.mode = 'json';
    else if (a === '--signals') o.mode = 'signals';
    else if (a === '--since') o.since = argv[++i];
    else if (a === '--since-shas') o.sinceShas = String(argv[++i] || '').split(',').filter(Boolean);
    else if (a === '--new-only') o.newOnly = true;
    else throw new Error(`nieznana opcja: ${a}`);
  }
  return o;
}

function run(argv) {
  const o = parseArgs(argv);
  // Korzen repo, nie podkatalog: macierz lezy w korzeniu (monorepo apps/web dawal falszywe „brak macierzy").
  const asked = path.resolve(o.repo);
  const isGit = git(asked, ['rev-parse', '--is-inside-work-tree']).out.trim() === 'true';
  const root = isGit ? path.resolve(git(asked, ['rev-parse', '--show-toplevel']).out.trim() || asked) : asked;
  if (archOff(root)) { if (o.mode === 'json') process.stdout.write(JSON.stringify({ repo: root, off: true, issues: [] }) + '\n'); return 0; }
  const areasAll = lint.loadAreas(AREAS_FILE);
  const now = check(root, makeTree(root, null, isGit), areasAll);
  let fresh = now.issues;
  let base = null;
  if (isGit && (o.since || o.sinceShas)) {
    if (o.since && !git(root, ['rev-parse', '--verify', '-q', `${o.since}^{commit}`]).ok) throw new Error(`--since: nieznany ref ${o.since}`);
    base = o.since || baseFromShas(root, o.sinceShas);
    const before = base ? check(root, makeTree(root, base, true), areasAll).issues : [];
    const old = new Set(before.map((i) => i.key));
    fresh = now.issues.filter((i) => !old.has(i.key));
    now.issues.forEach((i) => { i.new = !old.has(i.key); });
  }
  const report = o.newOnly ? fresh : now.issues;
  const required = sdRequired(root);
  const name = path.basename(root);
  if (o.mode === 'json') process.stdout.write(JSON.stringify({ repo: root, required, base, goal: now.goal || null, issues: report }, null, 2) + '\n');
  else if (o.mode === 'brief') { const b = brief(name, { issues: report }, required, now.goal); if (b) process.stdout.write(b + '\n'); }
  else if (o.mode === 'signals') {
    const s = signals(now.rows);
    process.stdout.write(s.length ? `Sygnaly powrotu NIE TERAZ (${name}) — gdy ktorys jest spelniony, wroc do obszaru (karta sd/03-skala.md › Drabina skalowania):\n${s.join('\n')}\n` : `${name}: brak wierszy NIE TERAZ.\n`);
    return 0;
  } else if (!report.length) process.stdout.write(`arch-check ${name}: zgodne z ${MATRIX_REL}${base ? ` (nic nowego od ${base.slice(0, 10)})` : ''}.\n`);
  else {
    process.stdout.write(`arch-check ${name}: ${report.length} problem(ow)${required ? ' · pg.sd_matrix: required' : ''}${base ? ` · baza ${base.slice(0, 10)}` : ''}\n`);
    report.forEach((i, n) => process.stdout.write(`${n + 1}. [${i.kind}${i.new ? ', NOWE' : ''}] ${i.msg}\n   propozycja: ${i.fix}\n`));
  }
  return report.length ? 1 : 0;
}

if (require.main === module) {
  try { process.exit(run(process.argv.slice(2))); } catch (e) { process.stderr.write(`arch-check: ${e.message}\n`); process.exit(2); }
}

module.exports = { run, archOff, check, makeTree, evidencePaths, SIGNALS, baseFromShas, brief, sdRequired, readGoal };

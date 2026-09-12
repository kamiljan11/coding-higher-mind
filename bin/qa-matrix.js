#!/usr/bin/env node
'use strict';
// qa-matrix: dzial QA w wersji 0-tokenowej (slownik SH sekcja 3: tester = nowe funkcje + REGRESJA, manualnie
// i automatycznie; PG gap L4). Uruchamia sciezki krytyczne z docs/CRITICAL-PATHS.md (blok ```json) na
// ROWNOLEGLYCH, IZOLOWANYCH instancjach: persona x viewport x locale — kazda instancja to osobny kontekst
// przegladarki (wlasne cookies/localStorage/storageState), opcjonalnie wlasny baseURL (drugi dev server =
// druga organizacja / waluta / jezyk). Wynik: report.json + report.md (kazda porazka w formacie 3-info:
// co zrobilem / co sie stalo / czego oczekiwalem) + screenshoty. Uzywany na zadanie: pg-review 1b, qa-reviewer, PRR P11.
//
// Uzycie: node qa-matrix.js --repo <sciezka> [--base-url URL] [--paths-file plik.json] [--out katalog]
//         [--only CP1,CP2] [--persona nazwa] [--viewport nazwa] [--locale pl-PL] [--concurrency 4]
//         [--timeout 15000] [--headed] [--offline] [--dry-run] [--json]
// Exit: 0 wszystko przeszlo, 1 sa porazki, 2 blad uzycia/konfiguracji, 3 brak Playwrighta
//       (npm i w repo albo ~/.claude/tools/qa-matrix: `npm install && npx playwright install chromium`).
const fs = require('fs');
const os = require('os');
const path = require('path');

const { isTrustedDir } = require(path.join(os.homedir(), '.claude', 'hooks', 'lib', 'trusted-roots.js'));

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_CONCURRENCY = 4;
const MAX_ERROR_CHARS = 300;
const RUNTIME_DIR = path.join(os.homedir(), '.claude', 'tools', 'qa-matrix');
const EXIT = { OK: 0, FAILURES: 1, USAGE: 2, NO_PLAYWRIGHT: 3 };
const JSON_FENCE_RX = /```json\s*\n([\s\S]*?)\n```/;
// Granice zaufania (security-reviewer 2026-09-12: docs/CRITICAL-PATHS.md pochodzi z REPO, wiec jest wejsciem NIEZAUFANYM):
//  - przegladarka (z sekretami QA_*) chodzi tylko po originach z --base-url / --allow-origin / localhost,
//  - `fill.valueEnv` czyta wylacznie zmienne QA_* (sekrety do testow maja taki prefiks; nic innego z env nie wycieka),
//  - nazwy plikow (persona, viewport, locale, id sciezki, screenshot) sa sanityzowane i wieziono w --out,
//  - storageState tylko wewnatrz repo,
//  - Playwright z runtime ~/.claude/tools/qa-matrix; z node_modules repo tylko gdy repo jest na liscie zaufanych korzeni
//    (pg/trusted-roots.txt) albo --trust-repo-playwright (REPO-CONTROLLED-MODULE-RCE).
const SAFE_NAME_RX = /[^A-Za-z0-9_.-]+/g;
const QA_ENV_RX = /^QA_[A-Z0-9_]+$/;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

const safeName = (s) => (String(s).replace(SAFE_NAME_RX, '_').replace(/\.{2,}/g, '_').slice(0, 80) || '_');
const originOf = (url) => { try { return new URL(url).origin; } catch (e) { return null; } };
const isLocalUrl = (url) => { try { return LOCAL_HOSTS.has(new URL(url).hostname); } catch (e) { return false; } };
function allowedOrigins(opts) {
  const set = new Set();
  for (const u of [opts.baseURL, ...(opts.allowOrigins || [])]) { const o = u && originOf(u); if (o) set.add(o); }
  return set;
}
const isAllowedUrl = (url, allowed) => { const o = originOf(url); return !!o && (allowed.has(o) || isLocalUrl(url)); };
function envValueFor(name) {
  if (!QA_ENV_RX.test(String(name))) throw new Error(`fill.valueEnv "${name}": dozwolone tylko zmienne QA_* (sekrety do testow), nic innego z env nie trafia do przegladarki`);
  const value = process.env[name];
  if (value === undefined) throw new Error(`fill.valueEnv ${name} pusty — uruchom przez menedzer sekretow (np. Infisical CLI) (run --secrets ${name})`);
  return value;
}
const insideDir = (file, dir) => { const f = path.resolve(file); const d = path.resolve(dir); return f === d || f.startsWith(d + path.sep); };

function parseArgs(argv) {
  const o = { repo: '.', baseURL: null, pathsFile: null, out: null, only: null, persona: null, viewport: null, locale: null,
    concurrency: DEFAULT_CONCURRENCY, timeout: DEFAULT_TIMEOUT_MS, headed: false, offline: false, dryRun: false, json: false,
    allowOrigins: [], trustRepoPlaywright: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--repo') o.repo = next();
    else if (a === '--base-url') o.baseURL = next();
    else if (a === '--paths-file') o.pathsFile = next();
    else if (a === '--out') o.out = next();
    else if (a === '--only') o.only = String(next()).split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--persona') o.persona = next();
    else if (a === '--viewport') o.viewport = next();
    else if (a === '--locale') o.locale = next();
    else if (a === '--concurrency') o.concurrency = Number(next());
    else if (a === '--timeout') o.timeout = Number(next());
    else if (a === '--headed') o.headed = true;
    else if (a === '--offline') o.offline = true;
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--json') o.json = true;
    else if (a === '--allow-origin') o.allowOrigins = String(next()).split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--trust-repo-playwright') o.trustRepoPlaywright = true;
    else throw new Error(`nieznany argument: ${a}`);
  }
  o.repo = path.resolve(o.repo);
  if (!o.out) o.out = path.join(os.tmpdir(), 'qa-matrix-' + new Date().toISOString().replace(/[:.]/g, '-'));
  return o;
}

/** Konfiguracja z --paths-file albo z pierwszego bloku ```json w docs/CRITICAL-PATHS.md. */
function loadConfig(repo, pathsFile) {
  if (pathsFile) return JSON.parse(fs.readFileSync(pathsFile, 'utf8'));
  const doc = path.join(repo, 'docs', 'CRITICAL-PATHS.md');
  if (!fs.existsSync(doc)) throw new Error(`brak ${doc} — skopiuj szablon z ~/.claude/templates/repo/docs/CRITICAL-PATHS.md albo podaj --paths-file`);
  const m = fs.readFileSync(doc, 'utf8').match(JSON_FENCE_RX);
  if (!m) throw new Error('docs/CRITICAL-PATHS.md: brak bloku ```json z matryca (personas/viewports/locales/paths)');
  return JSON.parse(m[1]);
}

/** Matryca -> lista instancji (persona x viewport x locale) z przypisanymi sciezkami. Czysta funkcja. */
function expandMatrix(config, opts) {
  const personas = (config.personas || [{ name: 'gosc' }]).filter((p) => !opts.persona || p.name === opts.persona);
  const viewports = (config.viewports || [{ name: 'desktop', width: 1280, height: 800 }]).filter((v) => !opts.viewport || v.name === opts.viewport);
  const locales = (config.locales || ['pl-PL']).filter((l) => !opts.locale || l === opts.locale);
  const paths = (config.paths || []).filter((p) => !opts.only || opts.only.includes(p.id));
  const allowed = allowedOrigins(opts);
  const instances = [];
  for (const persona of personas) for (const viewport of viewports) for (const locale of locales) {
    const mine = paths.filter((p) => !p.personas || p.personas.includes(persona.name));
    if (!mine.length) continue;
    const inst = {
      id: `${safeName(persona.name)}__${safeName(viewport.name)}__${safeName(locale)}`, persona: persona.name, viewport, locale,
      baseURL: persona.baseURL || opts.baseURL || config.baseURL || null,
      storageState: persona.storageState ? path.resolve(opts.repo, persona.storageState) : null,
      extraHTTPHeaders: persona.extraHTTPHeaders || null, login: persona.login || [], paths: mine, status: 'planned', reason: null,
    };
    if (!inst.baseURL) { inst.status = 'skipped'; inst.reason = 'brak baseURL (persona.baseURL / --base-url / config.baseURL)'; }
    else if (!isAllowedUrl(inst.baseURL, allowed)) { inst.status = 'skipped'; inst.reason = `baseURL ${inst.baseURL} spoza allowlisty (origin z --base-url, --allow-origin albo localhost) — repo nie kieruje przegladarki na obcy host`; }
    else if (inst.storageState && !insideDir(inst.storageState, opts.repo)) { inst.status = 'skipped'; inst.reason = `storageState ${persona.storageState} poza repo — niedozwolone`; }
    else if (inst.storageState && !fs.existsSync(inst.storageState)) { inst.status = 'skipped'; inst.reason = `brak storageState ${persona.storageState} (wygeneruj logowanie persony, np. e2e/auth.setup.ts)`; }
    instances.push(inst);
  }
  return instances;
}

function resolvePlaywright(repo, opts = {}) {
  // Runtime PG pierwszy (pin, znany kod). node_modules repo tylko jako fallback i tylko dla repo zaufanego —
  // pakiet z obcego repo wykonalby sie w procesie uzytkownika (REPO-CONTROLLED-MODULE-RCE).
  const paths = [RUNTIME_DIR];
  if (opts.trustRepoPlaywright || isTrustedDir(repo, null)) paths.push(repo);
  try { return require(require.resolve('playwright', { paths })); } catch (e) { return null; }
}

function locatorFor(page, spec) {
  if (typeof spec === 'string') return page.getByText(spec, { exact: false }).first();
  if (spec.role) return page.getByRole(spec.role, { name: spec.name }).first();
  if (spec.label) return page.getByLabel(spec.label).first();
  if (spec.placeholder) return page.getByPlaceholder(spec.placeholder).first();
  if (spec.selector) return page.locator(spec.selector).first();
  throw new Error('nieznany selektor: ' + JSON.stringify(spec));
}

const describeStep = (step) => { const k = Object.keys(step)[0]; return `${k}: ${JSON.stringify(step[k])}`; };

async function runStep(page, step, ctx) {
  const t = ctx.timeout;
  if (step.goto !== undefined) {
    const target = new URL(step.goto, ctx.baseURL).href;
    if (!isAllowedUrl(target, ctx.allowed)) throw new Error(`goto ${target}: origin spoza allowlisty (--base-url / --allow-origin / localhost) — sciezka z repo nie moze wyprowadzic przegladarki na obcy host`);
    await page.goto(target, { waitUntil: 'load', timeout: t }); return;
  }
  if (step.click !== undefined) { await locatorFor(page, step.click).click({ timeout: t }); return; }
  if (step.fill !== undefined) {
    const value = step.fill.valueEnv ? envValueFor(step.fill.valueEnv) : step.fill.value;
    if (value === undefined || value === null) throw new Error('fill: brak wartosci (value albo valueEnv QA_*)');
    await locatorFor(page, step.fill).fill(String(value), { timeout: t }); return;
  }
  if (step.expectText !== undefined) { await page.getByText(step.expectText, { exact: false }).first().waitFor({ state: 'visible', timeout: t }); return; }
  if (step.expectTitle !== undefined) { const title = await page.title(); if (!new RegExp(step.expectTitle).test(title)) throw new Error(`tytul "${title}" nie pasuje do /${step.expectTitle}/`); return; }
  if (step.expectUrl !== undefined) { await page.waitForURL((u) => u.href.includes(step.expectUrl) || new RegExp(step.expectUrl).test(u.href), { timeout: t }); return; }
  if (step.expectNoConsoleErrors) { if (ctx.consoleErrors.length) throw new Error('bledy konsoli: ' + ctx.consoleErrors.slice(0, 3).join(' | ')); return; }
  if (step.waitMs !== undefined) { await page.waitForTimeout(Number(step.waitMs)); return; }
  if (step.screenshot !== undefined) { const file = shotPath(ctx, `${ctx.pathId}-${safeName(step.screenshot)}.png`); await page.screenshot({ path: file, fullPage: true }); ctx.shots.push(file); return; }
  throw new Error('nieznany krok: ' + JSON.stringify(step));
}

/** Sciezka zrzutu uwieziona w katalogu instancji — nazwa z repo nie moze zapisac pliku poza --out (PATH-TRAVERSAL-ARTIFACT-WRITE). */
function shotPath(ctx, name) {
  const file = path.join(ctx.outDir, safeName(name));
  if (!insideDir(file, ctx.outDir)) throw new Error(`screenshot ${name}: sciezka poza katalogiem wyjsciowym`);
  return file;
}

async function runPath(page, spec, base) {
  const started = Date.now();
  const ctx = Object.assign({}, base, { pathId: safeName(spec.id), consoleErrors: [], shots: [] });
  const onPageError = (e) => ctx.consoleErrors.push(String(e));
  const onConsole = (m) => { if (m.type() === 'error') ctx.consoleErrors.push(m.text()); };
  page.on('pageerror', onPageError); page.on('console', onConsole);
  const result = { id: spec.id, name: spec.name, status: 'passed', steps: (spec.steps || []).length, stepsDone: 0, failedStep: null, screenshots: ctx.shots, consoleErrors: ctx.consoleErrors, durationMs: 0 };
  try {
    for (let i = 0; i < result.steps; i++) {
      try { await runStep(page, spec.steps[i], ctx); result.stepsDone = i + 1; }
      catch (e) {
        const file = shotPath(ctx, `${ctx.pathId}-step${i + 1}-FAIL.png`);
        let screenshot = null;
        try { await page.screenshot({ path: file, fullPage: true }); ctx.shots.push(file); screenshot = file; } catch (e2) { screenshot = `(screenshot nieudany: ${String(e2.message).split('\n')[0]})`; }
        result.status = 'failed';
        result.failedStep = { index: i + 1, step: describeStep(spec.steps[i]), error: String(e && e.message || e).split('\n')[0].slice(0, MAX_ERROR_CHARS), screenshot };
        break;
      }
    }
  } finally { page.off('pageerror', onPageError); page.off('console', onConsole); result.durationMs = Date.now() - started; }
  return result;
}

async function runInstance(browser, inst, opts) {
  const outDir = path.join(opts.out, inst.id);
  fs.mkdirSync(outDir, { recursive: true });
  const contextOpts = { viewport: { width: inst.viewport.width, height: inst.viewport.height }, locale: inst.locale, offline: !!opts.offline };
  if (inst.storageState) contextOpts.storageState = inst.storageState;
  if (inst.extraHTTPHeaders) contextOpts.extraHTTPHeaders = inst.extraHTTPHeaders;
  const context = await browser.newContext(contextOpts);
  const page = await context.newPage();
  const base = { baseURL: inst.baseURL, timeout: opts.timeout, outDir, allowed: allowedOrigins(opts) };
  const out = { id: inst.id, persona: inst.persona, viewport: inst.viewport.name, locale: inst.locale, baseURL: inst.baseURL, status: 'ran', reason: null, paths: [] };
  try {
    if (inst.login.length) {
      const login = await runPath(page, { id: 'LOGIN', name: 'logowanie persony', steps: inst.login }, base);
      out.paths.push(login);
      if (login.status !== 'passed') { out.status = 'skipped'; out.reason = 'logowanie persony padlo: ' + login.failedStep.error; return out; }
    }
    for (const p of inst.paths) out.paths.push(await runPath(page, p, base));
  } finally { await context.close(); }
  return out;
}

async function runAll(instances, opts, playwright) {
  const browser = await playwright.chromium.launch({ headless: !opts.headed });
  const queue = instances.filter((i) => i.status === 'planned');
  const results = [];
  try {
    const workers = Array.from({ length: Math.max(1, Math.min(opts.concurrency, queue.length)) }, async () => {
      while (queue.length) { const inst = queue.shift(); results.push(await runInstance(browser, inst, opts)); }
    });
    await Promise.all(workers);
  } finally { await browser.close(); }
  for (const inst of instances.filter((i) => i.status === 'skipped')) {
    results.push({ id: inst.id, persona: inst.persona, viewport: inst.viewport.name, locale: inst.locale, baseURL: inst.baseURL, status: 'skipped', reason: inst.reason, paths: [] });
  }
  return results.sort((a, b) => a.id.localeCompare(b.id));
}

function summarize(results) {
  const s = { instances: results.length, instancesSkipped: 0, paths: 0, passed: 0, failed: 0 };
  for (const r of results) {
    if (r.status === 'skipped') s.instancesSkipped++;
    for (const p of r.paths) { s.paths++; if (p.status === 'passed') s.passed++; else s.failed++; }
  }
  return s;
}

/** report.md — jeden ekran: podsumowanie, tabela instancja x sciezka, porazki w formacie 3-info. Czysta funkcja. */
function renderMarkdown(report) {
  const s = report.summary;
  const lines = [`# qa-matrix — ${report.startedAt}`, '', `Instancje: ${s.instances} (pominiete: ${s.instancesSkipped}) · sciezki: ${s.paths} · passed: ${s.passed} · failed: ${s.failed} · out: ${report.out}`, '',
    '| Instancja | Sciezka | Status | Kroki | Czas ms |', '|---|---|---|---|---|'];
  for (const inst of report.instances) {
    if (inst.status === 'skipped') { lines.push(`| ${inst.id} | — | SKIPPED | — | ${inst.reason} |`); continue; }
    for (const p of inst.paths) lines.push(`| ${inst.id} | ${p.id} ${p.name} | ${p.status.toUpperCase()} | ${p.stepsDone}/${p.steps} | ${p.durationMs} |`);
  }
  const failures = report.instances.flatMap((inst) => inst.paths.filter((p) => p.status === 'failed').map((p) => ({ inst, p })));
  if (failures.length) {
    lines.push('', '## Porazki (format 3-info: co zrobilem / co sie stalo / czego oczekiwalem)');
    for (const { inst, p } of failures) {
      const done = (p.stepsDone ? `kroki 1-${p.stepsDone} przeszly` : 'zaden krok nie przeszedl');
      lines.push('', `### ${p.id} ${p.name} — ${inst.id}`,
        `- **Co zrobilem:** persona \`${inst.persona}\`, viewport \`${inst.viewport}\`, locale \`${inst.locale}\`, baseURL ${inst.baseURL}; ${done}; krok ${p.failedStep.index}: \`${p.failedStep.step}\``,
        `- **Co sie stalo:** ${p.failedStep.error}${p.consoleErrors.length ? ` · konsola: ${p.consoleErrors.slice(0, 2).join(' | ')}` : ''} · screenshot: ${p.failedStep.screenshot}`,
        `- **Czego oczekiwalem:** ${p.failedStep.step} (wg docs/CRITICAL-PATHS.md)`,
        `- repro: \`node ~/.claude/bin/qa-matrix.js --repo <repo> --base-url ${inst.baseURL} --only ${p.id} --persona ${inst.persona} --viewport ${inst.viewport} --locale ${inst.locale}\``);
    }
  }
  return lines.join('\n') + '\n';
}

async function main() {
  let opts;
  try { opts = parseArgs(process.argv.slice(2)); } catch (e) { process.stderr.write(`qa-matrix: ${e.message}\n`); return EXIT.USAGE; }
  let config;
  try { config = loadConfig(opts.repo, opts.pathsFile); } catch (e) { process.stderr.write(`qa-matrix: ${e.message}\n`); return EXIT.USAGE; }
  const instances = expandMatrix(config, opts);
  if (!instances.length) { process.stderr.write('qa-matrix: 0 instancji — sprawdz filtry (--only/--persona/--viewport/--locale) i pole `personas` w sciezkach\n'); return EXIT.USAGE; }
  if (opts.dryRun) {
    const plan = { dryRun: true, out: opts.out, instances: instances.map((i) => ({ id: i.id, status: i.status, reason: i.reason, baseURL: i.baseURL, paths: i.paths.map((p) => p.id) })) };
    process.stdout.write(opts.json ? JSON.stringify(plan, null, 2) + '\n' : plan.instances.map((i) => `${i.status === 'planned' ? 'RUN ' : 'SKIP'} ${i.id} -> ${i.baseURL || '(brak URL)'} [${i.paths.join(', ')}]${i.reason ? ' — ' + i.reason : ''}`).join('\n') + '\n');
    return EXIT.OK;
  }
  const playwright = resolvePlaywright(opts.repo, opts);
  if (!playwright) { process.stderr.write(`qa-matrix: brak pakietu playwright w ${RUNTIME_DIR} (node_modules repo liczy sie tylko dla zaufanego repo / --trust-repo-playwright). Napraw: cd "${RUNTIME_DIR}" && npm install && npx playwright install chromium\n`); return EXIT.NO_PLAYWRIGHT; }
  fs.mkdirSync(opts.out, { recursive: true });
  const startedAt = new Date().toISOString();
  const results = await runAll(instances, opts, playwright);
  const report = { startedAt, repo: opts.repo, out: opts.out, baseURL: opts.baseURL || config.baseURL || null, summary: summarize(results), instances: results };
  fs.writeFileSync(path.join(opts.out, 'report.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(opts.out, 'report.md'), renderMarkdown(report));
  if (opts.json) process.stdout.write(JSON.stringify(report) + '\n');
  else process.stdout.write(renderMarkdown(report));
  return report.summary.failed ? EXIT.FAILURES : EXIT.OK;
}

module.exports = { parseArgs, loadConfig, expandMatrix, summarize, renderMarkdown, safeName, isAllowedUrl, allowedOrigins, envValueFor, resolvePlaywright, EXIT };
if (require.main === module) main().then((code) => process.exit(code)).catch((e) => { process.stderr.write(`qa-matrix: blad: ${e && e.stack || e}\n`); process.exit(EXIT.USAGE); });

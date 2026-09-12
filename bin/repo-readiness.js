#!/usr/bin/env node
'use strict';
// repo-readiness: 0-tokenowy scorer „GitHub-ready" (pg/github-ready.md R1-R14) — co widzi obcy w 90 sekund.
// Uzycie: node repo-readiness.js --repo <sciezka> [--full] [--json]
//   --full: dodatkowo uruchamia lint / tsc / test / build (kilka minut) — do PRZED/PO w PR-ach.
// Wynik: score 0-100 + tabela punktow z powodem. Exit 0 zawsze (narzedzie raportujace).
const { execFileSync, execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const FLEET_METRICS = path.join(CLAUDE_DIR, 'bin', 'fleet-metrics.js');
const SQL_LINT = path.join(CLAUDE_DIR, 'bin', 'sql-migration-lint.js');
const TOOL_TIMEOUT_MS = 120000;
const FULL_STEP_TIMEOUT_MS = 300000;
const CONVENTIONAL_RX = /^(feat|fix|chore|docs|refactor|test|perf|ci|build|style|revert)(\([^)]+\))?!?: /;
const RECENT_COMMITS = 20;
const HUGE_FILE_LINES = 1000;
const PER_KLOC_ANY_MAX = 1;
const PER_KLOC_SILENT_CATCH_MAX = 1;
const CHILD_ENV = Object.assign({}, process.env, { CI: '1', GIT_CONFIG_PARAMETERS: "'core.fsmonitor=false' 'core.hooksPath=/dev/null'" });

const args = process.argv.slice(2);
const repo = path.resolve(args[args.indexOf('--repo') + 1] || '.');
const full = args.includes('--full');
const asJson = args.includes('--json');

const exists = (rel) => fs.existsSync(path.join(repo, rel));
const read = (rel) => { try { return fs.readFileSync(path.join(repo, rel), 'utf8'); } catch (e) { return ''; } };
const listDir = (rel) => { try { return fs.readdirSync(path.join(repo, rel)); } catch (e) { return []; } };
function git(cmdArgs) {
  try { return execFileSync('git', cmdArgs, { cwd: repo, encoding: 'utf8', env: CHILD_ENV, timeout: 30000 }).trim(); } catch (e) { return ''; }
}
function runJsonTool(tool, toolArgs) {
  try { return JSON.parse(execFileSync('node', [tool, ...toolArgs], { encoding: 'utf8', env: CHILD_ENV, timeout: TOOL_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'ignore'] })); } catch (e) { return null; }
}
function runStep(cmd) {
  try { execSync(cmd, { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'], env: CHILD_ENV, timeout: FULL_STEP_TIMEOUT_MS }); return { ok: true }; }
  catch (e) { return { ok: false, out: (String(e.stdout || '') + String(e.stderr || '')).split('\n').slice(-5).join(' | ').slice(0, 300) }; }
}

const pkg = (() => { try { return JSON.parse(read('package.json')); } catch (e) { return null; } })();
const isLovable = !!(pkg && JSON.stringify(pkg).includes('lovable-tagger'));
const hasMigrations = listDir('supabase/migrations').some((f) => f.endsWith('.sql'));
const results = [];
const score = (id, name, points, max, why) => results.push({ id, name, points: Math.max(0, Math.min(points, max)), max, why });

// R1 README (15): istnieje 3, jak uruchomic 4, stack/env 3, deploy 3, status/badge 2
{
  const readme = read('README.md');
  let pts = 0; const why = [];
  if (readme.length > 200) pts += 3; else why.push('brak/za krotki README');
  if (/npm (ci|i|install|run dev)|pnpm (i|dev)|yarn|python .*\.py|docker compose/i.test(readme)) pts += 4; else why.push('brak sekcji „jak uruchomic"');
  if (/\.env|env\b/i.test(readme) && /(stack|tech|technolog|built with|react|vite|supabase|next)/i.test(readme)) pts += 3; else why.push('brak stacku/env');
  if (/deploy|vercel|lovable|publish|wdro/i.test(readme)) pts += 3; else why.push('brak sekcji deploy');
  if (/badge|workflows\/.*\.svg|status:|prototype|archived|production/i.test(readme)) pts += 2; else why.push('brak badge/statusu');
  score('R1', 'README', pts, 15, why.join('; '));
}
// R2 CI zielone (15): workflow 5; --full: lint 3, tsc 3, test 2, build 2
{
  let pts = 0; const why = [];
  const hasWorkflow = listDir('.github/workflows').some((f) => /quality|ci/i.test(f));
  if (hasWorkflow) pts += 5; else why.push('brak workflow quality/ci');
  if (full && pkg) {
    const steps = [
      ['lint', pkg.scripts && pkg.scripts.lint ? 'npm run lint' : null, 3],
      ['tsc', exists('tsconfig.json') ? (/"references"/.test(read('tsconfig.json')) ? 'npx --no-install tsc -b' : 'npx --no-install tsc --noEmit') : null, 3],
      ['test', pkg.scripts && pkg.scripts.test ? 'npm test -- --run' : null, 2],
      ['build', pkg.scripts && pkg.scripts.build ? 'npm run build' : null, 2],
    ];
    for (const [name, cmd, max] of steps) {
      if (!cmd) { why.push(`${name}: brak skryptu`); continue; }
      const r = runStep(cmd);
      if (r.ok) pts += max; else why.push(`${name} czerwony: ${r.out}`);
    }
  } else if (!full) why.push('(bez --full: lint/tsc/test/build nie uruchomione)');
  score('R2', 'CI zielone', pts, 15, why.join('; '));
}
// R3 ARCHITECTURE (8)
{
  const arch = read('docs/ARCHITECTURE.md');
  const lines = arch.split('\n').length;
  const filled = lines > 25 && !/UZUPELNIJ|<!--|\.\.\.$/m.test(arch.replace(/<!--[^>]*-->/g, ''));
  score('R3', 'docs/ARCHITECTURE.md', arch ? (filled ? 8 : 3) : 0, 8, arch ? (filled ? '' : 'szablon niewypelniony') : 'brak');
}
// R4 ADR (8)
{
  const adrs = listDir('docs/adr').filter((f) => f.endsWith('.md') && !/^0000/.test(f));
  score('R4', 'ADR (realne)', adrs.length >= 2 ? 8 : adrs.length === 1 ? 5 : 0, 8, adrs.length ? `${adrs.length} ADR` : 'tylko szablon lub brak');
}
// R5 CHANGELOG (6): istnieje 2, [Unreleased] 2, swiezy 2 (ostatnia zmiana CHANGELOG >= ostatni feat commit)
{
  const changelog = read('CHANGELOG.md');
  let pts = 0; const why = [];
  if (changelog) pts += 2; else why.push('brak');
  if (/\[Unreleased\]/i.test(changelog)) pts += 2; else if (changelog) why.push('brak [Unreleased]');
  const lastChangelog = git(['log', '-1', '--format=%ct', '--', 'CHANGELOG.md']);
  const lastFeat = git(['log', '-1', '--format=%ct', '--grep=^feat', '--', 'src', 'app', 'lib']);
  if (changelog && (!lastFeat || Number(lastChangelog) >= Number(lastFeat))) pts += 2; else if (changelog) why.push('feat commity nowsze niz CHANGELOG');
  score('R5', 'CHANGELOG', pts, 6, why.join('; '));
}
// R6 .github (6)
{
  const wf = listDir('.github/workflows');
  let pts = 0; const why = [];
  if (wf.some((f) => /quality/i.test(f))) pts += 3; else why.push('brak quality.yml');
  if (exists('.github/pull_request_template.md') || exists('.github/PULL_REQUEST_TEMPLATE.md')) pts += 3; else why.push('brak PR template');
  score('R6', '.github', pts, 6, why.join('; '));
}
// R7 LICENSE + wlasnosc (5): plik 3, spojnosc `pg.ownership` (CLAUDE.md) z trescia LICENSE 2 — slownik SH: przeniesienie praw vs licencja
// to dwie rozne umowy (recheck 2026-09-12: github-ready.md obiecywal ten check, kodu nie bylo).
{
  const license = read('LICENSE') || read('LICENSE.md');
  const ownership = (read('CLAUDE.md').match(/pg\.ownership:\s*([a-z-]+)/) || [])[1];
  let pts = 0; const why = [];
  if (license) pts += 3; else why.push('brak LICENSE — status prawny niejasny');
  if (!ownership) why.push('brak pg.ownership w CLAUDE.md (mas-saas | client-transferred | client-licensed | oss)');
  else if (!license) why.push(`pg.ownership ${ownership} bez LICENSE`);
  else {
    const mas = /the company|<owner>|Example Company ehf./i.test(license);
    const oss = /\b(MIT|Apache|BSD|GPL|MPL|ISC)\b/.test(license);
    const consistent = ownership === 'oss' ? oss : ownership === 'client-transferred' ? (!mas && !oss) : (mas && !oss);
    if (consistent) pts += 2; else why.push(`pg.ownership ${ownership} niespojne z LICENSE (${oss ? 'licencja OSS' : mas ? 'PG' : 'inny wlasciciel'})`);
  }
  score('R7', 'LICENSE + wlasnosc', pts, 5, why.join('; '));
}
// R8 .env.example (5)
{
  const env = read('.env.example') || read('.env.sample');
  const needsEnv = /process\.env|import\.meta\.env|Deno\.env/.test(read('src/main.tsx') + read('src/App.tsx')) || (pkg && /supabase|stripe|rapyd|resend|twilio/i.test(JSON.stringify(pkg.dependencies || {})));
  // Realna wartosc po `=`: JWT, klucz sk_/sk-/pk_/sbp_, dlugi hex/base64 z mieszanka znakow. Placeholdery
  // (`your_`, `xxx`, `<...>`, `changeme`, `example`, URL projektu) NIE sa wyciekiem — false positive z 2026-09-05
  // (3 agenty zglosily R8 na czystych .env.example).
  const PLACEHOLDER_RX = /^(your[_-]|xxx|<|\$\{|changeme|example|placeholder|todo|dummy|\.\.\.)/i;
  const SECRET_VALUE_RX = /^(eyJ[A-Za-z0-9_.-]{20,}|sk_(live|test)_[A-Za-z0-9]{16,}|sk-(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{16,}|pk_(live|test)_[A-Za-z0-9]{16,}|sbp_[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|[0-9a-f]{32,}|(?=.*[A-Z])(?=.*[a-z])(?=.*\d)[A-Za-z0-9+/=_-]{32,})$/;
  const leaked = env.split('\n').some((line) => {
    const m = line.match(/^\s*(?:export\s+)?[A-Za-z0-9_]+\s*=\s*["']?([^"'#\s]+)["']?/);
    return !!(m && !PLACEHOLDER_RX.test(m[1]) && SECRET_VALUE_RX.test(m[1]));
  });
  if (!needsEnv && !env) score('R8', '.env.example', 5, 5, 'brak zaleznosci od env');
  else score('R8', '.env.example', env ? (leaked ? 2 : 5) : 0, 5, env ? (leaked ? 'wyglada na realna wartosc po =' : '') : 'brak');
}
// R9 higiena (6)
{
  const tracked = git(['ls-files']).split('\n');
  const bad = tracked.filter((f) => /^(dist|build|node_modules)\/|(^|\/)\.env$/.test(f));
  let pts = 6; const why = [];
  if (bad.length) { pts -= 4; why.push(`sledzone: ${bad.slice(0, 3).join(', ')}`); }
  if (!exists('.gitignore')) { pts -= 2; why.push('brak .gitignore'); }
  score('R9', 'higiena repo', pts, 6, why.join('; '));
}
// R10 kod (10) + R11 struktura (6) z fleet-metrics
{
  const m = runJsonTool(FLEET_METRICS, ['--repo', repo, '--json']);
  if (!m || !m.ok) { score('R10', 'kod', 0, 10, 'fleet-metrics nie zadzialal'); score('R11', 'struktura', 0, 6, 'fleet-metrics nie zadzialal'); }
  else {
    const kloc = Math.max(1, (m.loc || 0) / 1000);
    let pts = 10; const why = [];
    if ((m.anyUsage || 0) / kloc > PER_KLOC_ANY_MAX) { pts -= 3; why.push(`any ${m.anyUsage} (${((m.anyUsage || 0) / kloc).toFixed(1)}/kLOC)`); }
    if (((m.catchBlocks || {}).silent || 0) / kloc > PER_KLOC_SILENT_CATCH_MAX) { pts -= 3; why.push(`silent catch ${(m.catchBlocks || {}).silent}`); }
    if ((m.tsIgnore || 0) + (m.eslintDisable || 0) > 0) { pts -= 2; why.push(`ts-ignore/eslint-disable ${(m.tsIgnore || 0) + (m.eslintDisable || 0)}`); }
    if ((m.testFiles || 0) === 0 && (m.files || 0) > 5) { pts -= 2; why.push('0 plikow testow'); }
    score('R10', 'kod (metryki)', pts, 10, why.join('; '));
    const huge = (m.largeFiles || {}).over1000Count || 0;
    const backlog = exists('docs/quality/BACKLOG.md');
    score('R11', 'struktura', huge === 0 ? 6 : backlog ? 4 : 1, 6, huge ? `${huge} plikow > ${HUGE_FILE_LINES} linii${backlog ? ' (BACKLOG istnieje)' : ' bez BACKLOG'}` : '');
  }
}
// R12 commity (4)
{
  const subjects = git(['log', `-${RECENT_COMMITS}`, '--format=%s']).split('\n').filter(Boolean);
  const conv = subjects.filter((s) => CONVENTIONAL_RX.test(s) || /^Merge /.test(s)).length;
  const ratio = subjects.length ? conv / subjects.length : 0;
  score('R12', 'commity conventional', ratio >= 0.8 ? 4 : ratio >= 0.5 ? 2 : 0, 4, `${Math.round(ratio * 100)} % z ostatnich ${subjects.length}`);
}
// R13 SQL (4)
{
  if (!hasMigrations) score('R13', 'SQL HIGH', 4, 4, 'brak migracji');
  else {
    let high = 0;
    try { const out = execFileSync('node', [SQL_LINT, '--repo', repo, '--min-severity', 'high'], { encoding: 'utf8', env: CHILD_ENV, timeout: TOOL_TIMEOUT_MS }); high = (out.match(/^\[HIGH\]/gm) || []).length; } catch (e) { /* narzedzie zglasza exit 0 */ }
    const backlog = /HIGH|DEFINER|WITH CHECK/i.test(read('docs/quality/BACKLOG.md'));
    score('R13', 'SQL HIGH', high === 0 ? 4 : backlog ? 2 : 0, 4, high ? `${high} HIGH${backlog ? ' (w BACKLOG)' : ' bez BACKLOG'}` : '');
  }
}
// R14 status (2)
{
  const firstLines = read('README.md').split('\n').slice(0, 8).join('\n');
  score('R14', 'status projektu', /status|production|prototype|archived|delivered|w produkcji|prototyp/i.test(firstLines) ? 2 : 0, 2, /status|production|prototype|archived|delivered/i.test(firstLines) ? '' : 'brak statusu w naglowku README');
}

const total = results.reduce((s, r) => s + r.points, 0);
const report = { repo, name: path.basename(repo), lovable: isLovable, full, score: total, max: 100, results };
if (asJson) process.stdout.write(JSON.stringify(report, null, 2) + '\n');
else {
  const lines = [`repo-readiness · ${report.name}${isLovable ? ' (Lovable)' : ''} · ${total}/100${full ? '' : ' (bez --full)'}`, ''];
  for (const r of results) lines.push(`${r.id.padEnd(4)} ${r.name.padEnd(24)} ${String(r.points).padStart(2)}/${String(r.max).padEnd(3)} ${r.why}`);
  process.stdout.write(lines.join('\n') + '\n');
}

#!/usr/bin/env node
// diff-size-gate: twardy prog rozmiaru zmiany (0 tokenow). Research 2026-09-06 (research-ai-slop.md,
// zrodla 15/16/19): duzy PR = slepa recenzja; najsilniej udokumentowany wzorzec slopu. Dzis: marketplace-app #2
// mial 213 plikow i nikt nie byl w stanie go zmergowac; moj wlasny PR na 21 plikow potrzebowal 4 dogrywek.
//
// Liczy NETTO linie (dodane + usuniete) w plikach ZRODLOWYCH: pomija lockfile'y, generated, snapshoty,
// testy, docs, migracje SQL i dane. Prog domyslny 400. Wyjatek swiadomy: ALLOW_LARGE_DIFF=1.
//
// Uzycie: node diff-size-gate.js [--base origin/main] [--max 400] [--staged] [--json]
'use strict';
const { execFileSync } = require('node:child_process');

const SKIP = /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lock(b)?|Cargo\.lock|poetry\.lock|uv\.lock)$|\.snap$|\.(min|bundle)\.(js|css)$|(^|\/)(dist|build|coverage|node_modules|\.next)\/|\.(test|spec)\.[cm]?[jt]sx?$|__tests__\/|\.(md|mdx|txt|csv|json|svg|png|jpg|webp|lock)$|(^|\/)supabase\/migrations\/|(^|\/)seed\.sql$|(^|\/)(i18n|locales?|translations?)\//;

function parseArgs(argv) {
  const o = { base: 'origin/main', max: 400, staged: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--base') o.base = argv[++i];
    else if (argv[i] === '--max') o.max = Number(argv[++i]);
    else if (argv[i] === '--staged') o.staged = true;
    else if (argv[i] === '--json') o.json = true;
  }
  return o;
}

/** numstat -> {files:[{file,add,del}], total} z pominieciem plikow nie-zrodlowych. Czysta funkcja. */
function summarize(numstat) {
  const files = [];
  for (const line of numstat.split('\n')) {
    const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line);
    if (!m) continue;
    const [, a, d, file] = m;
    if (a === '-' || SKIP.test(file)) continue; // binarne / nie-zrodlowe
    files.push({ file, add: Number(a), del: Number(d) });
  }
  const total = files.reduce((s, f) => s + f.add + f.del, 0);
  return { files: files.sort((x, y) => y.add + y.del - (x.add + x.del)), total };
}

function main() {
  const o = parseArgs(process.argv.slice(2));
  const args = o.staged ? ['diff', '--cached', '--numstat'] : ['diff', '--numstat', `${o.base}...HEAD`];
  const out = execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 << 20 });
  const s = summarize(out);
  if (o.json) { process.stdout.write(JSON.stringify({ ...s, max: o.max }) + '\n'); return s.total > o.max ? 1 : 0; }
  if (s.total <= o.max) { console.log(`diff-size-gate: OK — ${s.total} linii zrodlowych w ${s.files.length} plikach (prog ${o.max})`); return 0; }
  console.log(`diff-size-gate: ${s.total} linii zrodlowych w ${s.files.length} plikach > prog ${o.max}. Najwieksze:`);
  for (const f of s.files.slice(0, 8)) console.log(`   +${f.add}/-${f.del}  ${f.file}`);
  console.log('Podziel na mniejsze PR-y (jeden temat = jeden PR). Swiadomy wyjatek (migracja, wygenerowany kod): ALLOW_LARGE_DIFF=1.');
  return 1;
}

if (require.main === module) {
  try { process.exit(main()); } catch (err) { console.error('diff-size-gate: ' + err.message.split('\n')[0]); process.exit(2); }
}
module.exports = { summarize };

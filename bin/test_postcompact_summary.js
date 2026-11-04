// Testy hooks/postcompact-summary.js (kompakcja L3, 2026-11-02): streszczenie kompakcji na dysk, redakcja, dopisywanie,
// limity, telemetria, exit 0 zawsze. Uruchom: node test_postcompact_summary.js (0 sieci; katalogi w os.tmpdir(), kasowane).
'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

let failures = 0;
const check = (name, cond, detail) => { if (cond) console.log('ok  ', name); else { failures++; console.log('FAIL', name, detail || ''); } };

const HOOK = path.join(__dirname, '..', 'hooks', 'postcompact-summary.js');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-postcompact-'));
const dir = path.join(root, 'precompact');
const gateLog = path.join(root, 'gates.jsonl');
fs.mkdirSync(dir);
const env = Object.assign({}, process.env, { PG_PRECOMPACT_DIR: dir, PG_GATE_LOG: gateLog });
const run = (input, raw) => spawnSync('node', [HOOK], { input: raw !== undefined ? raw : JSON.stringify(input), encoding: 'utf8', env, timeout: 30000 });
const entries = () => { try { return fs.readFileSync(gateLog, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch (e) { return []; } };
const last = () => entries().filter((e) => e.hook === 'postcompact-summary').pop() || {};

try {
  const sid = 'pcs-test-' + process.pid;
  const file = path.join(dir, sid + '.summary.md');
  const secret = 'ghp' + '_' + 'A'.repeat(36);

  const r1 = run({ session_id: sid, trigger: 'auto', cwd: root, compact_summary: `Cel: strona. Token ${secret} nie moze trafic na dysk.` });
  const t1 = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  check('zapis: exit 0, plik z tytulem i naglowkiem kompakcji', r1.status === 0 && /^# Streszczenia kompakcji sesji /.test(t1) && /## \S+ trigger=auto \(\d+ znakow\)/.test(t1), `rc=${r1.status} ${t1.slice(0, 200)}`);
  check('zapis: sekret zredagowany', t1.includes('[REDACTED]') && !t1.includes(secret));
  check('zapis: plik 0600', (fs.statSync(file).mode & 0o077) === 0);
  check('telemetria: ran z sid', last().event === 'ran' && String(last().reason).includes(sid), JSON.stringify(last()));

  run({ session_id: sid, trigger: 'manual', compact_summary: 'Druga kompakcja.' });
  const t2 = fs.readFileSync(file, 'utf8');
  check('druga kompakcja dopisana, tytul raz', (t2.match(/^## /gm) || []).length === 2 && (t2.match(/^# Streszczenia/gm) || []).length === 1 && /trigger=manual/.test(t2) && t2.includes('Druga kompakcja.'), t2);

  run({ session_id: sid, trigger: 'auto', compact_summary: '   ' });
  check('puste streszczenie -> skipped, plik bez zmian', last().event === 'skipped' && /puste compact_summary/.test(last().reason) && fs.readFileSync(file, 'utf8') === t2, JSON.stringify(last()));

  const r3 = run({ trigger: 'auto', compact_summary: 'bez sesji' });
  check('brak session_id -> skipped, exit 0', r3.status === 0 && last().event === 'skipped' && /brak session_id/.test(last().reason), JSON.stringify(last()));

  const r4 = run(null, '{to nie json');
  check('zle wejscie -> exit 0, skipped (brak session_id)', r4.status === 0 && last().event === 'skipped', JSON.stringify(last()));

  const { SUMMARY_CLIP, MAX_FILE_BYTES } = require(HOOK);
  const sidLong = sid + '-long';
  run({ session_id: sidLong, trigger: 'auto', compact_summary: 'ab '.repeat(SUMMARY_CLIP) });
  const tl = fs.readFileSync(path.join(dir, sidLong + '.summary.md'), 'utf8');
  check('dlugie streszczenie uciete z adnotacja', tl.length < SUMMARY_CLIP + 1000 && /\[\.\.\. uciete: \d+ znakow ponad 40000\]/.test(tl) && /\(uciete\)/.test(last().reason), `${tl.length} ${last().reason}`);

  const sidBig = sid + '-big';
  fs.writeFileSync(path.join(dir, sidBig + '.summary.md'), 'x'.repeat(MAX_FILE_BYTES + 1));
  run({ session_id: sidBig, trigger: 'auto', compact_summary: 'nie dopisuj' });
  check('plik ponad limit -> skipped, bez dopisania', last().event === 'skipped' && !fs.readFileSync(path.join(dir, sidBig + '.summary.md'), 'utf8').includes('nie dopisuj'), JSON.stringify(last()));

  const sidPath = '../../etc/x';
  run({ session_id: sidPath, trigger: 'auto', compact_summary: 'sciezka' });
  check('session_id ze sciezka oczyszczony (plik w katalogu migawek)', fs.existsSync(path.join(dir, 'etcx.summary.md')), fs.readdirSync(dir).join(','));

  // A21 security: redakcja nowych ksztaltow sekretow; A21 ops: SHA commita i diff_sha256 zostaja w streszczeniu, migawka dalej je maskuje
  const { redact, redactKeepHashes } = require(path.join(__dirname, '..', 'hooks', 'precompact-snapshot.js'));
  const sha = '9980066' + '5ed8dc1e32550145e0a0a0eeabe89faf6';
  const pemTag = (w) => `-----${w} ` + 'PRIVATE' + ' KEY-----'; // fixture skladany: skaner sekretow pre-commit nie widzi naglowka PEM
  const pem = pemTag('BEGIN') + '\nMIIEv' + 'QIBADANBg\n' + pemTag('END');
  const leaky = `stripe ${'sk' + '_live_'}51HabcdefGHIJ whsec_${'a'.repeat(20)} ${'AIza'}SyA-${'b'.repeat(30)} pass${'word'}=hunter2secret ${pem} commit ${sha}`;
  const kept = redactKeepHashes(leaky);
  check('redact: sk_live_/whsec_/AIza/password=/PEM zamaskowane', !/51Habcdef|aaaaaaaaaa|bbbbbbbbbb|hunter2|MIIEv/.test(kept) && /password=\[REDACTED\]/.test(kept), kept);
  check('redactKeepHashes: SHA commita zostaje doslownie', kept.includes(sha), kept);
  // A22 security: nazwy z prefiksem .env i klucz JSON w cudzyslowie; zwykle slowa (tokens:, max_tokens=, hotkey=) zostaja
  const envLeak = `DB_PASS${'WORD'}=hunter2hunter2 OPENAI_API_KEY=sk_${'c'.repeat(16)} {"pass${'word'}": "jsonsecret99"} GITHUB_TOKEN=${'d'.repeat(20)} CLIENT_SECRET=e1e2e3e4e5`;
  const envKept = redactKeepHashes(envLeak);
  check('redact: DB_PASSWORD=/OPENAI_API_KEY=/JSON "password"/GITHUB_TOKEN=/CLIENT_SECRET= zamaskowane', !/hunter2|cccccccc|jsonsecret|dddddddd|e1e2e3/.test(envKept) && /DB_PASSWORD=\[REDACTED\]/.test(envKept), envKept);
  const plain = 'tokens: 400000 max_tokens=4096000 hotkey=ctrlshiftx';
  check('redact: zwykle slowa z token/key bez zmian', redactKeepHashes(plain) === plain, redactKeepHashes(plain));
  check('redact (migawka): 40-hex dalej zamaskowany', !redact(`commit ${sha}`).includes(sha));
  run({ session_id: sid + '-sha', trigger: 'auto', compact_summary: `HEAD ${sha}` });
  check('streszczenie na dysku: SHA zostaje', fs.readFileSync(path.join(dir, sid + '-sha.summary.md'), 'utf8').includes(sha));

  // Retencja (A21 ops): sweep() w precompact-snapshot kasuje streszczenie innej sesji starsze niz 14 dni, biezace zostaje
  const oldOther = path.join(dir, 'stara-sesja.summary.md');
  const oldOwn = path.join(dir, 'pcs-sweep.summary.md');
  fs.writeFileSync(oldOther, 'stare');
  fs.writeFileSync(oldOwn, 'biezace');
  const past = (Date.now() - 15 * 24 * 3600 * 1000) / 1000;
  fs.utimesSync(oldOther, past, past);
  fs.utimesSync(oldOwn, past, past);
  const tr = path.join(root, 'tr.jsonl');
  fs.writeFileSync(tr, JSON.stringify({ type: 'user', message: { content: 'zrob migawke' } }) + '\n');
  spawnSync('node', [path.join(__dirname, '..', 'hooks', 'precompact-snapshot.js')], { input: JSON.stringify({ session_id: 'pcs-sweep', transcript_path: tr, trigger: 'auto', cwd: root }), encoding: 'utf8', env, timeout: 60000 });
  check('retencja: stare streszczenie innej sesji skasowane, biezacej sesji zostaje', !fs.existsSync(oldOther) && fs.existsSync(oldOwn), fs.readdirSync(dir).join(','));

  // PG_PRECOMPACT_DIR poza tmpdir = brak zapisu (nie produkcja), skipped
  const rOut = spawnSync('node', [HOOK], { input: JSON.stringify({ session_id: sid, compact_summary: 'x' }), encoding: 'utf8', env: Object.assign({}, env, { PG_PRECOMPACT_DIR: '/nie/istnieje/poza/tmp' }) });
  check('katalog poza tmpdir -> skipped, exit 0', rOut.status === 0 && last().event === 'skipped' && /PG_PRECOMPACT_DIR/.test(last().reason), JSON.stringify(last()));
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} FAIL` : '\nwszystkie OK');
process.exit(failures ? 1 : 0);

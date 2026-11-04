// Testy hooks/context-checkpoint.js (kompakcja L1, 2026-11-02): kontekst z transkryptu, progi 70/85 % raz na cykl,
// swiezy checkpoint = cisza, reset po kompakcji, stop_hook_active, miara „odswiezony po przypomnieniu”, wyjscie JSON Stop.
// Uruchom: node test_context_checkpoint.js (0 sieci; katalogi w os.tmpdir(), kasowane).
'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

let failures = 0;
const check = (name, cond, detail) => { if (cond) console.log('ok  ', name); else { failures++; console.log('FAIL', name, detail || ''); } };

const HOOK = path.join(__dirname, '..', 'hooks', 'context-checkpoint.js');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-ctxckpt-'));
const ckptDir = path.join(root, 'Checkpoints');
const settings = path.join(root, 'settings.json');
fs.mkdirSync(ckptDir);
fs.writeFileSync(settings, JSON.stringify({ autoCompactWindow: 400000 }));
const env = Object.assign({}, process.env, {
  PG_CHECKPOINT_DIR: ckptDir, PG_CHECKPOINT_STATE_DIR: path.join(root, 'state'), PG_SETTINGS_FILE: settings, PG_GATE_LOG: path.join(root, 'gates.jsonl'),
});
const tr = path.join(root, 'transcript.jsonl');
const usageLine = (tokens, extra = {}) => JSON.stringify(Object.assign({ type: 'assistant', message: { usage: { input_tokens: 2, cache_read_input_tokens: tokens - 1002, cache_creation_input_tokens: 1000, output_tokens: 50 } } }, extra));
const setCtx = (tokens, tail = []) => fs.writeFileSync(tr, [JSON.stringify({ type: 'user', message: { content: 'x' } }), usageLine(tokens), ...tail].join('\n') + '\n');
const sid = 'ab12cd34-test-' + process.pid;
const run = (extra = {}) => {
  const r = spawnSync('node', [HOOK], { input: JSON.stringify(Object.assign({ session_id: sid, transcript_path: tr, cwd: '/home/user/my-proj' }, extra)), encoding: 'utf8', env, timeout: 30000 });
  let out = null;
  try { out = r.stdout ? JSON.parse(r.stdout) : null; } catch (e) { out = 'NIE-JSON: ' + r.stdout; }
  return { status: r.status, out };
};
const lastLog = () => { try { return fs.readFileSync(env.PG_GATE_LOG, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((e) => e.hook === 'context-checkpoint').pop() || {}; } catch (e) { return {}; } };

try {
  const { contextTokens } = require(HOOK);
  setCtx(321000, [usageLine(999999, { isSidechain: true }), JSON.stringify({ type: 'user', message: { content: 'y' } })]);
  check('contextTokens: ostatni usage glownego watku (sidechain pominiety)', contextTokens(tr) === 321000, String(contextTokens(tr)));
  check('contextTokens: brak pliku -> null', contextTokens(path.join(root, 'nie.jsonl')) === null);
  const synthetic = JSON.stringify({ type: 'assistant', message: { model: '<synthetic>', usage: { input_tokens: 0, output_tokens: 0 } } });
  const zero = JSON.stringify({ type: 'assistant', message: { model: 'claude-opus-5-5', usage: { input_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } });
  setCtx(300000, [synthetic, zero]);
  check('contextTokens: wpis <synthetic> i usage 0 pominiete (A27 data)', contextTokens(tr) === 300000, String(contextTokens(tr)));
  const stateDir = env.PG_CHECKPOINT_STATE_DIR;
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, sid + '.json'), JSON.stringify({ fired: null, remindedAt: 'x', measured: 3 }));
  setCtx(100000);
  const rShape = run();
  check('stan o zlym ksztalcie -> domyslny, exit 0 (A27 data)', rShape.status === 0 && lastLog().event === 'skipped' && !/internal error/.test(lastLog().reason), JSON.stringify(lastLog()));
  const saved = JSON.parse(fs.readFileSync(path.join(stateDir, sid + '.json'), 'utf8'));
  check('stan po zapisie: poprawny ksztalt, bez plikow .tmp', Array.isArray(saved.fired) && typeof saved.measured === 'boolean' && !fs.readdirSync(stateDir).some((f) => f.endsWith('.tmp')), JSON.stringify(saved));
  fs.rmSync(path.join(stateDir, sid + '.json'));

  setCtx(200000);
  const r0 = run();
  check('50 % okna -> cisza, exit 0', r0.status === 0 && r0.out === null && lastLog().event === 'skipped', JSON.stringify(r0));

  setCtx(290000);
  const r1 = run();
  const ctx = r1.out && r1.out.hookSpecificOutput;
  check('72 % -> przypomnienie Stop additionalContext', r1.status === 0 && ctx && ctx.hookEventName === 'Stop' && /70 %\+/.test(ctx.additionalContext), JSON.stringify(r1.out));
  check('przypomnienie: sciezka checkpointu z sid8 i projektem + szablon', ctx && ctx.additionalContext.includes(path.join(ckptDir, '')) && ctx.additionalContext.includes('ab12cd34 my-proj.md') && /Nastepny krok/.test(ctx.additionalContext));
  check('telemetria: ran z poziomem', lastLog().event === 'ran' && /przypomnienie 70 %/.test(lastLog().reason), JSON.stringify(lastLog()));

  const r2 = run();
  check('ten sam prog drugi raz -> cisza', r2.out === null, JSON.stringify(r2.out));
  check('miara: checkpoint NIE odswiezony po przypomnieniu', /NIE odswiezony/.test(lastLog().reason), lastLog().reason);

  check('stop_hook_active -> cisza', run({ stop_hook_active: true }).out === null && /stop_hook_active/.test(lastLog().reason));

  setCtx(345000);
  const r3 = run();
  check('86 % -> drugie przypomnienie (85 %)', r3.out && /85 %\+/.test(r3.out.hookSpecificOutput.additionalContext), JSON.stringify(r3.out));
  fs.writeFileSync(path.join(ckptDir, '2026-11-02 ab12cd34 my-proj.md'), '# checkpoint');
  run();
  check('miara: checkpoint odswiezony po przypomnieniu', /checkpoint odswiezony po przypomnieniu/.test(lastLog().reason), lastLog().reason);

  setCtx(60000);
  run();
  check('po kompakcji (< 50 %) nowy cykl', /nowy cykl/.test(lastLog().reason), lastLog().reason);
  setCtx(300000);
  const r4 = run();
  check('nowy cykl + swiezy checkpoint (< 20 min) -> cisza', r4.out === null && /checkpoint swiezy/.test(lastLog().reason), JSON.stringify(lastLog()));

  const old = (Date.now() - 25 * 60 * 1000) / 1000;
  fs.utimesSync(path.join(ckptDir, '2026-11-02 ab12cd34 my-proj.md'), old, old);
  setCtx(60000); run(); setCtx(300000);
  const r5 = run();
  check('checkpoint starszy niz 20 min -> przypomnienie', r5.out && /70 %\+/.test(r5.out.hookSpecificOutput.additionalContext), JSON.stringify(r5.out));

  fs.writeFileSync(settings, JSON.stringify({ autoCompactWindow: 600000 }));
  setCtx(60000); run(); setCtx(300000);
  check('okno 600k z settings: 300k = 50 % -> cisza', run().out === null);

  fs.writeFileSync(tr, JSON.stringify({ type: 'user', message: { content: 'bez usage' } }) + '\n');
  check('brak usage -> skipped z powodem', run().out === null && /brak usage/.test(lastLog().reason));
  const rBad = spawnSync('node', [HOOK], { input: '{zly json', encoding: 'utf8', env });
  check('zle wejscie -> exit 0, bez wyjscia', rBad.status === 0 && rBad.stdout === '');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} FAIL` : '\nwszystkie OK');
process.exit(failures ? 1 : 0);

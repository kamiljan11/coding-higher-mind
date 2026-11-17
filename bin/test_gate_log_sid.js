#!/usr/bin/env node
'use strict';
// Test: gate-log stamps each event with the Claude Code session id from the environment, so cost and gate
// activity can be measured per session; an explicit sid in the entry still wins (2026-11-15, loop pass 4).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const LIB = path.join(__dirname, '..', 'hooks', 'lib', 'gate-log.js');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-gatelog-sid-'));
const logFile = path.join(dir, 'gates.jsonl');
let fails = 0;
const ok = (c, m, x = '') => { if (!c) { fails++; console.log('FAIL: ' + m + (x ? '\n  ' + x : '')); } };

function emit(sessionId, entry) {
  const env = Object.assign({}, process.env, { PG_GATE_LOG: logFile });
  delete env.CLAUDE_CODE_SESSION_ID;
  if (sessionId) env.CLAUDE_CODE_SESSION_ID = sessionId;
  const code = `require(${JSON.stringify(LIB)}).log(${JSON.stringify(entry)})`;
  return spawnSync(process.execPath, ['-e', code], { env, encoding: 'utf8' });
}
const lines = () => fs.readFileSync(logFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l));

emit('sess-env-1', { hook: 't', event: 'ran', target: dir });
// 'blocked', not 'bypass': a redirected bypass is also copied to the production log (gate-log.js), which a test must not touch.
emit('sess-env-1', { hook: 't', event: 'blocked', sid: 'explicit-2', target: dir });
emit('', { hook: 't', event: 'ran', target: dir });
const [a, b, c] = lines();
ok(a && a.sid === 'sess-env-1', 'event gets sid from CLAUDE_CODE_SESSION_ID', JSON.stringify(a));
ok(b && b.sid === 'explicit-2', 'explicit entry.sid wins over the env value', JSON.stringify(b));
ok(c && !('sid' in c), 'no env and no entry sid = no sid field', JSON.stringify(c));

fs.rmSync(dir, { recursive: true, force: true });
if (fails) { console.log(`test_gate_log_sid: ${fails} FAIL`); process.exit(1); }
console.log('test_gate_log_sid: OK');

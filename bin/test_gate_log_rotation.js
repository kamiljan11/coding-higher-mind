#!/usr/bin/env node
'use strict';
// Test: gate-log.js keeps KEEP_GENERATIONS rotated files (gates.1..gates.3) and drops the oldest.
// Runs gate-log in child processes with PG_GATE_LOG in tmpdir and a tiny PG_GATE_LOG_MAX_BYTES.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const LIB = path.join(__dirname, '..', 'hooks', 'lib', 'gate-log.js');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-gate-rot-'));
const logFile = path.join(dir, 'gates.jsonl');
const env = Object.assign({}, process.env, { PG_GATE_LOG: logFile, PG_GATE_LOG_MAX_BYTES: '200' });
let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('FAIL: ' + msg); } };

function writeEvent(tag) {
  const code = `require(${JSON.stringify(LIB)}).log({hook:'t',event:'ran',reason:${JSON.stringify(tag + '-' + 'x'.repeat(250))},target:${JSON.stringify(dir)}})`;
  execFileSync(process.execPath, ['-e', code], { env });
}

// Each event is > 200 bytes, so every write after the first rotates the previous file.
for (const tag of ['a', 'b', 'c', 'd', 'e']) writeEvent(tag);
const read = (n) => { try { return fs.readFileSync(n ? path.join(dir, `gates.${n}.jsonl`) : logFile, 'utf8'); } catch (e) { return null; } };
ok(read(0) && read(0).includes('"e-'), 'current log holds the newest event');
ok(read(1) && read(1).includes('"d-'), 'gates.1 holds the previous event');
ok(read(2) && read(2).includes('"c-'), 'gates.2 holds the one before');
ok(read(3) && read(3).includes('"b-'), 'gates.3 holds the oldest kept event');
ok(read(4) === null, 'no gates.4: older generations are dropped');
ok(!Object.values({ 0: read(0), 1: read(1), 2: read(2), 3: read(3) }).some((t) => t && t.includes('"a-')), 'event a fell off after 3 generations');

// The size override must not apply to the production log (only to a redirected tmpdir log).
const prodCheck = execFileSync(process.execPath, ['-e', `process.env.PG_GATE_LOG='';const g=require(${JSON.stringify(LIB)});console.log(g.LOG_FILE)`],
  { env: Object.assign({}, process.env, { PG_GATE_LOG: '', PG_GATE_LOG_MAX_BYTES: '1' }) }).toString().trim();
ok(prodCheck.endsWith(path.join('.claude', 'logs', 'gates.jsonl')), 'without PG_GATE_LOG the production path is used');

fs.rmSync(dir, { recursive: true, force: true });
if (fails) { console.log(`test_gate_log_rotation: ${fails} FAIL`); process.exit(1); }
console.log('test_gate_log_rotation: OK');

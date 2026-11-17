#!/usr/bin/env node
'use strict';
// Test: env-ref-gate tells "repo without Supabase" (out of scope, skipped) apart from "Supabase repo without a declared
// prod ref" (observe: would_block in the gate log, exit 0). Before 2026-11-15 both were the same silent skip (733/733 runs).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const GATE = path.join(__dirname, 'env-ref-gate.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-envref-'));
const logFile = path.join(tmp, 'gates.jsonl');
let fails = 0;
const ok = (cond, msg, extra = '') => { if (!cond) { fails++; console.log('FAIL: ' + msg + (extra ? '\n  ' + extra : '')); } };
const repo = (name, files) => {
  const d = path.join(tmp, name);
  for (const [f, body] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); fs.writeFileSync(path.join(d, f), body); }
  fs.mkdirSync(d, { recursive: true });
  return d;
};
const run = (d) => spawnSync(process.execPath, [GATE, '--repo', d], { encoding: 'utf8', env: Object.assign({}, process.env, { PG_GATE_LOG: logFile }) });
const lastLog = () => JSON.parse(fs.readFileSync(logFile, 'utf8').trim().split('\n').pop());

const plain = repo('plain', { 'package.json': '{"dependencies":{"react":"18"}}' });
let r = run(plain);
ok(r.status === 0 && /nie dotyczy/.test(r.stdout), 'repo without Supabase = skipped, out of scope', r.stdout);
ok(lastLog().event === 'skipped', 'skipped is logged for a repo without Supabase');

const dep = repo('dep', { 'package.json': '{"dependencies":{"@supabase/supabase-js":"2"}}' });
r = run(dep);
ok(r.status === 0 && /OSTRZEZENIE \(observe\)/.test(r.stdout), 'Supabase dependency without a prod ref = observe warning, exit 0', r.stdout);
ok(lastLog().event === 'would_block' && lastLog().gate === 'ENV_REF_UNDECLARED', 'undeclared prod ref is logged as would_block');

const dir = repo('dir', { 'supabase/migrations/.keep': '' });
ok(/OSTRZEZENIE/.test(run(dir).stdout), 'supabase/ directory counts as using Supabase');

const tpl = repo('tpl', { '.env.example': 'VITE_SUPABASE_URL=\n' });
ok(/OSTRZEZENIE/.test(run(tpl).stdout), 'SUPABASE_URL in .env.example counts as using Supabase');

const REF = 'abcdefghijklmnopqrst';
const declared = repo('declared', { 'package.json': '{"dependencies":{"@supabase/supabase-js":"2"}}', '.env.example': `SUPABASE_PROJECT_REF_PROD=${REF}\n` });
r = run(declared);
ok(r.status === 0 && /OK/.test(r.stdout) && lastLog().event === 'ran', 'declared ref and clean env = OK and a ran entry', r.stdout);

fs.rmSync(tmp, { recursive: true, force: true });
if (fails) { console.log(`test_env_ref_undeclared: ${fails} FAIL`); process.exit(1); }
console.log('test_env_ref_undeclared: OK');

#!/usr/bin/env node
'use strict';
// pg-replay (landscape #19): realne komendy Bash/PowerShell z transkryptow Claude Code (~/.claude/projects/**/*.jsonl)
// -> ten sam evaluate(), ktory blokuje w bash-guard. Odpowiada na pytanie „ile prawdziwej pracy nowa regula by zablokowala"
// zanim regula przejdzie z observe na enforce (#20). 0 tokenow.
// Prywatnosc (design review 2026-09-26): probki redagowane regexem sekretow, dla secret-in-cmd tylko liczniki;
// pelny raport TYLKO do pliku w ~/.claude/logs/pg-replay/, na stdout same liczby.
// Uzycie: node pg-replay.js [--root <dir>] [--since YYYY-MM-DD] [--max-files N] [--samples N] [--json]
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { evaluate } = require('../hooks/lib/bash-rules');

const SECRET_RX = /(ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|gho_[A-Za-z0-9]{20,}|sk-ant-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{32,}|sbp_[A-Za-z0-9]{20,}|xox[bpars]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/g;
const redact = (s) => String(s).replace(SECRET_RX, '[REDACTED]').replace(/\s+/g, ' ').slice(0, 220);

function argValue(args, name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

function listJsonl(root, maxFiles) {
  const out = [];
  const walk = (dir) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.jsonl')) out.push(p);
    }
  };
  walk(root);
  return out.sort().slice(-maxFiles);
}

async function commandsFrom(file, since) {
  const cmds = [];
  const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.includes('"tool_use"')) continue;
    let rec;
    try { rec = JSON.parse(line); } catch (e) { continue; }
    if (since && String(rec.timestamp || '') < since) continue;
    for (const block of (rec.message && rec.message.content) || []) {
      if (!block || block.type !== 'tool_use' || !/^(Bash|PowerShell)$/.test(block.name)) continue;
      const command = String((block.input || {}).command || '');
      if (command.trim()) cmds.push({ command, dialect: block.name === 'PowerShell' ? 'ps' : 'sh', cwd: rec.cwd || os.homedir(), sidechain: !!rec.isSidechain });
    }
  }
  return cmds;
}

async function main() {
  const args = process.argv.slice(2);
  const root = argValue(args, '--root', path.join(os.homedir(), '.claude', 'projects'));
  const since = argValue(args, '--since', '');
  const maxFiles = Number(argValue(args, '--max-files', '100000'));
  const sampleN = Number(argValue(args, '--samples', '8'));
  const files = listJsonl(root, maxFiles);
  const seen = new Set();
  const stats = { files: files.length, commands: 0, unique: 0, overflow: 0, slow: 0, maxMs: 0 };
  const perRule = {};
  const bump = (id, kind, sample) => {
    const r = perRule[id] || (perRule[id] = { legacy: 0, parser: 0, observe: 0, samples: [] });
    r[kind]++;
    if (id !== 'secret-in-cmd' && r.samples.length < sampleN && kind !== 'legacy') r.samples.push(redact(sample));
  };
  for (const file of files) {
    for (const c of await commandsFrom(file, since)) {
      stats.commands++;
      const key = c.dialect + '|' + c.command;
      if (seen.has(key)) continue;
      seen.add(key);
      stats.unique++;
      const t0 = Date.now();
      const r = evaluate(c.command, { dialect: c.dialect, cwd: c.cwd });
      const ms = Date.now() - t0;
      stats.maxMs = Math.max(stats.maxMs, ms);
      if (ms > 100) stats.slow++;
      if (r.overflow) stats.overflow++;
      for (const b of r.blocks) bump(b.id, b.layer === 'legacy' ? 'legacy' : 'parser', c.command);
      for (const o of r.observes) bump(o.id, 'observe', c.command);
    }
  }
  const report = { generated: new Date().toISOString(), root, since: since || null, stats, perRule };
  const outDir = path.join(os.homedir(), '.claude', 'logs', 'pg-replay');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, new Date().toISOString().slice(0, 19).replace(/:/g, '') + '.json');
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
  const lines = [`pg-replay: ${stats.unique} unikalnych komend z ${stats.files} transkryptow (overflow ${stats.overflow}, >100 ms ${stats.slow}, max ${stats.maxMs} ms)`];
  for (const [id, r] of Object.entries(perRule).sort()) lines.push(`  ${id.padEnd(18)} legacy ${String(r.legacy).padStart(5)}  parser-only ${String(r.parser).padStart(5)}  observe ${String(r.observe).padStart(5)}`);
  lines.push(`raport (z redagowanymi probkami): ${outFile}`);
  process.stdout.write(args.includes('--json') ? JSON.stringify({ stats, perRule: Object.fromEntries(Object.entries(perRule).map(([k, v]) => [k, { legacy: v.legacy, parser: v.parser, observe: v.observe }])), outFile }, null, 2) + '\n' : lines.join('\n') + '\n');
}

main().catch((e) => { process.stderr.write('pg-replay: ' + String(e && e.stack || e) + '\n'); process.exit(1); });

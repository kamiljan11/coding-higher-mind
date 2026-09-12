#!/usr/bin/env node
'use strict';
// baseline-metrics: zapisuje docs/quality/baseline-metrics.json dla repo — punkt odniesienia ratchetu fleet-metrics.
// Dlaczego osobny skrypt: PowerShell `node ... > plik` zapisywal UTF-16 z BOM i wciagal absolutna sciezke
// worktree'a do commitowanego pliku (finding agentow rental-site + demo-site, 2026-09-05).
// Tu: node czyta stdout fleet-metrics jako UTF-8, usuwa pole `repo`, normalizuje `name`, pisze UTF-8 bez BOM.
// Uzycie: node baseline-metrics.js <repo> [<plik-wyjsciowy>]
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const FLEET_METRICS = path.join(__dirname, 'fleet-metrics.js');
const TIMEOUT_MS = 120000;

function main() {
  const repo = path.resolve(process.argv[2] || '.');
  const outFile = process.argv[3] ? path.resolve(process.argv[3]) : path.join(repo, 'docs', 'quality', 'baseline-metrics.json');
  const raw = execFileSync('node', [FLEET_METRICS, '--repo', repo, '--json'], { encoding: 'utf8', timeout: TIMEOUT_MS, stdio: ['ignore', 'pipe', 'ignore'] });
  const metrics = JSON.parse(raw);
  delete metrics.repo; // lokalna sciezka nie nalezy do repo
  metrics.name = path.basename(repo).replace(/-pg$/, ''); // worktree `<repo>-pg` -> nazwa repo
  metrics.generatedAt = new Date().toISOString().slice(0, 10);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(metrics, null, 2) + '\n', { encoding: 'utf8' });
  process.stdout.write(`baseline-metrics: ${path.relative(repo, outFile)} (loc=${metrics.loc}, files=${metrics.files})\n`);
}

try { main(); } catch (e) { process.stderr.write(`baseline-metrics: ${String(e.message || e).split('\n')[0]}\n`); process.exit(1); }

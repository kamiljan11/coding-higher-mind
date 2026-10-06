#!/usr/bin/env node
// Testy audytu interakcji w qa-matrix.js (sciezki z samym goto). Bez przegladarki: czyste funkcje + --dry-run.
// Uruchom: node ~/.claude/bin/test_qa_matrix_interaction.js
'use strict';
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { expandMatrix, interactionAudit, hasInteraction, summarize, renderMarkdown, parseArgs } = require('./qa-matrix.js');

const CLI = path.join(__dirname, 'qa-matrix.js');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-matrix-int-'));
const CONFIG = {
  baseURL: 'http://localhost:3999',
  viewports: [{ name: 'desktop', width: 1280, height: 800 }, { name: 'mobile', width: 390, height: 844 }],
  paths: [
    { id: 'SMOKE1', name: 'strona glowna', steps: [{ goto: '/' }, { expectNoConsoleErrors: true }] },
    { id: 'CP1', name: 'logowanie', steps: [{ goto: '/login' }, { expectTitle: 'Login' }, { expectUrl: '/login' }] },
    { id: 'CP2', name: 'koszyk', steps: [{ goto: '/' }, { click: { role: 'button', name: 'Dodaj' } }, { expectText: 'Koszyk (1)' }] },
  ],
};
const file = path.join(TMP, 'paths.json');
fs.writeFileSync(file, JSON.stringify(CONFIG));
const cli = (...args) => spawnSync(process.execPath, [CLI, '--repo', TMP, '--paths-file', file, '--dry-run', '--out', path.join(TMP, 'out'), ...args], { encoding: 'utf8' });

let n = 0;
const it = (name, fn) => { fn(); n++; console.log('ok   ' + name); };

it('hasInteraction: click/fill = interakcja; goto/expect* = nie', () => {
  assert.equal(hasInteraction(CONFIG.paths[0]), false);
  assert.equal(hasInteraction(CONFIG.paths[1]), false);
  assert.equal(hasInteraction(CONFIG.paths[2]), true);
  assert.equal(hasInteraction({ steps: [{ fill: { label: 'Email', value: 'a' } }] }), true);
});

it('interactionAudit liczy unikalne sciezki (nie instancje) i wylapuje CP* bez interakcji', () => {
  const inst = expandMatrix(CONFIG, parseArgs(['--repo', TMP, '--base-url', 'http://localhost:3999']));
  assert.equal(inst.length, 2);
  const a = interactionAudit(inst);
  assert.equal(a.interactionless, 2);
  assert.deepEqual(a.interactionlessIds, ['SMOKE1', 'CP1']);
  assert.deepEqual(a.cpWithoutInteraction, ['CP1']);
});

it('summary.interactionless + ostrzezenie w report.md; bez audytu summarize jak dotad (0)', () => {
  const results = [{ id: 'i', persona: 'gosc', viewport: 'desktop', locale: 'pl-PL', baseURL: 'http://localhost:3999', status: 'ran', paths: [
    { id: 'SMOKE1', name: 's', status: 'passed', steps: 2, stepsDone: 2, durationMs: 1, consoleErrors: [] }] }];
  assert.equal(summarize(results).interactionless, 0);
  const summary = summarize(results, { interactionless: 2 });
  assert.equal(summary.interactionless, 2);
  const md = renderMarkdown({ startedAt: 't', out: '/x', summary, interactionlessIds: ['SMOKE1', 'CP1'], instances: results });
  assert.match(md, /2 sciezek nic nie klika — zielony wynik nie dowodzi CP z UI/);
  assert.match(md, /SMOKE1, CP1/);
  assert.doesNotMatch(renderMarkdown({ startedAt: 't', out: '/x', summary: summarize(results), instances: results }), /nic nie klika/);
});

it('CLI bez flagi: exit jak dotad (0) + ostrzezenie na stderr', () => {
  const r = cli();
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /2 sciezek nic nie klika — zielony wynik nie dowodzi CP z UI/);
});

it('CLI --require-interaction: CP1 bez click/fill = exit 1; po dopisaniu klikniecia = 0', () => {
  const r = cli('--require-interaction');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /CP bez click\/fill: CP1/);
  assert.equal(cli('--require-interaction', '--only', 'CP2,SMOKE1').status, 0, 'SMOKE bez interakcji nie blokuje — tylko CP*');
});

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n${n} testow OK`);

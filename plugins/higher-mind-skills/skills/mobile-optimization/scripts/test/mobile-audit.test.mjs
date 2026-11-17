import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, auditSource, verdict, main } from '../mobile-audit.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const page = (name, html) => { const d = mkdtempSync(join(tmpdir(), 'ma-')); const f = join(d, name); writeFileSync(f, html); return { f, d }; };
const GOOD = `<!doctype html><html lang="pl"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;font:18px sans-serif"><h1>Warsztat</h1><a href="tel:+48" style="display:inline-block;padding:14px 20px">Umów wizytę</a>
<form><input type="tel" style="font-size:16px;height:48px" aria-label="tel"></form></body></html>`;
const BAD = `<!doctype html><html lang="pl"><head><meta name="viewport" content="width=device-width,maximum-scale=1"></head>
<body style="margin:0"><h1>X</h1><div style="width:900px">szeroki</div><a href="#a" style="font-size:10px">mały</a>
<input type="text" style="font-size:12px"></body></html>`;

test('parseArgs: defaults and validation', () => {
  assert.deepEqual(parseArgs(['a.html']).viewport, { width: 390, height: 844 });
  assert.deepEqual(parseArgs(['a', '--viewport', '360x800']).viewport, { width: 360, height: 800 });
  assert.throws(() => parseArgs([]), /missing/);
  assert.throws(() => parseArgs(['a', '--viewport', '390']), /bad viewport/);
  assert.throws(() => parseArgs(['a', '--out']), /needs a value/);
  assert.throws(() => parseArgs(['a', '--x']), /unknown option/);
  assert.throws(() => parseArgs(['a', '--timeout', '10']), /bad timeout/);
});

test('auditSource: wraps the real mobile_audit.js as an IIFE', () => {
  const src = auditSource(readFileSync(join(here, '..', 'mobile_audit.js'), 'utf8'));
  assert.match(src, /^\(\(\) => \{/);
  assert.match(src, /\)\(\)$/);
  assert.throws(() => auditSource('/* c */ function x(){}'), /arrow function/);
});

test('verdict: maps each high-impact field', () => {
  assert.deepEqual(verdict({ horizontalOverflow: false, inputsBelow16px: 0, zoomBlocked: false, smallTapTargets: 0 }), []);
  assert.equal(verdict({ horizontalOverflow: true, overflowElements: [1], inputsBelow16px: 1, zoomBlocked: true, smallTapTargets: 2 }).length, 4);
  assert.match(verdict({ viewport: '900x1948' }, 390)[0], /widened to 900px/);
  assert.deepEqual(verdict({ viewport: '390x844' }, 390), []);
});

test('main: good page exits 0, bad page exits 1 with all four issues in --out JSON', async () => {
  const g = page('g.html', GOOD);
  assert.equal(await main([g.f, '--out', join(g.d, 'a.json')]), 0);
  const b = page('b.html', BAD);
  const out = join(b.d, 'a.json');
  assert.equal(await main([b.f, '--out', out]), 1);
  const r = JSON.parse(readFileSync(out, 'utf8'));
  assert.ok(r.horizontalOverflow || Number(r.viewport.split('x')[0]) > 390, `overflow seen: ${r.viewport}`);
  assert.equal(r.zoomBlocked, true);
  assert.ok(r.inputsBelow16px >= 1);
  assert.ok(r.smallTapTargets >= 1);
});

test('main: tool errors exit 2', async () => {
  assert.equal(await main([]), 2);
  assert.equal(await main(['/nonexistent/x.html']), 2);
  assert.equal(await main(['ftp://x/y']), 2);
});

test('main: page that hangs its main thread is killed at the deadline (exit 2, no hang)', async () => {
  const h = page('hang.html', '<!doctype html><html><body><h1>x</h1><script>for(;;){}</script></body></html>');
  const t0 = Date.now();
  assert.equal(await main([h.f, '--timeout', '3000']), 2);
  assert.ok(Date.now() - t0 < 15000, `took ${Date.now() - t0} ms`);
});

test('auditSource: synthetic header + arrow works; other shapes fail loudly', () => {
  assert.equal(auditSource('/* h */\n() => 1;'), '(() => 1)()');
  assert.throws(() => auditSource('// h\n() => 1'), /arrow function/);
  assert.throws(() => auditSource('/* h */ async () => 1'), /arrow function/);
});

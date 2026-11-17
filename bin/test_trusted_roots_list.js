#!/usr/bin/env node
'use strict';
// Test: pg/trusted-roots.txt covers uzytkownik's own repo roots on the laptop (2026-11-15 telemetry: ~700 lint skips in
// pg-wt, Dane, video-pipeline, Documents/PG) and still excludes everything else (cloned foreign repos = RCE via linter config).
const path = require('path');
process.env.PG_TRUSTED_ROOTS_FILE = path.join(__dirname, '..', 'pg', 'trusted-roots.txt');
const { isTrustedDir } = require(path.join(__dirname, '..', 'hooks', 'lib', 'trusted-roots.js'));

const H = '~';
const trusted = [`${H}/pg-wt/integration`, `${H}/Dane/video-pipeline`, `${H}/video-pipeline/render`, `${H}/Documents/PG/OZE/app`, `${H}/src/workshop-app`, `${H}/.claude/hooks`];
const untrusted = [`${H}/Downloads/repo`, `${H}/Obsidian/MAIN`, `${H}/Danex/x`, `${H}/Dane/Downloads/foreign-repo`, `${H}/Dane/skool-ccc/x`, `${H}/Documents/MASx/y`, '/tmp/x', `${H}/pg-wtx`];
let fails = 0;
for (const d of trusted) if (!isTrustedDir(d, null)) { fails++; console.log('FAIL: should be trusted: ' + d); }
for (const d of untrusted) if (isTrustedDir(d, null)) { fails++; console.log('FAIL: should NOT be trusted: ' + d); }
if (fails) { console.log(`test_trusted_roots_list: ${fails} FAIL`); process.exit(1); }
console.log('test_trusted_roots_list: OK');

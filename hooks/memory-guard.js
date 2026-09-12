#!/usr/bin/env node
// PreToolUse hook (matcher: mcp__desktop-commander__write_file) — v3 (2026-09-05).
// Sygnal S01 z pamieci (7 niezaleznych zrodel, najczestszy obok RLS): `write_file` w trybie rewrite
// (domyslnym) kasowal pliki pamieci Obsidiana (Agent Action Log, Notes for Claude, SYSTEM-MAP...).
// Regula CLAUDE.md „never destroy a file you were asked to add to" byla PROZA -> tu staje sie bramka:
// zapis do katalogow pamieci/logow bez `mode: "append"` = zablokowany. Swiadomy rewrite = Edit/Write
// (czytaja plik przed zapisem) albo ALLOW_REWRITE=1 w pierwszej linii tresci.
'use strict';
const fs = require('fs');

// Katalogi, w ktorych rewrite = utrata historii. Sciezki porownujemy po normalizacji separatorow i wielkosci liter.
const PROTECTED_DIR_RX = /(^|[\\/])(memory-vault[\\/]main[\\/](claude memory|log|claude code sessions|agent memory)|\.claude[\\/](projects[\\/][^\\/]+[\\/]memory|logs))([\\/]|$)/i;
const ESCAPE_MARKER = /^ALLOW_REWRITE=1\b/m;

let input = {};
try { input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch (e) { process.exit(0); }
if (input.tool_name !== 'mcp__desktop-commander__write_file') process.exit(0);
const toolInput = input.tool_input || {};
const target = String(toolInput.path || '');
const mode = String(toolInput.mode || 'rewrite');
const content = String(toolInput.content || '');

if (!target || mode === 'append' || !PROTECTED_DIR_RX.test(target)) process.exit(0);
if (ESCAPE_MARKER.test(content.slice(0, 200))) process.exit(0);
if (!fs.existsSync(target)) process.exit(0); // nowy plik nie kasuje niczego

process.stderr.write(
  `[memory-guard] ZABLOKOWANE: write_file w trybie "${mode}" na istniejacy plik pamieci: ${target}\n` +
  'Rewrite kasuje historie (sygnal S01, 7 incydentow). Uzyj mode: "append" (dopisz), edit_block (zmiana w miejscu) ' +
  'albo narzedzia Edit/Write (czytaja plik przed zapisem). Swiadoma decyzja uzytkownika: pierwsza linia tresci `ALLOW_REWRITE=1`.\n'
);
process.exit(2);

#!/usr/bin/env node
// PreToolUse hook (matcher: Bash|PowerShell|mcp__desktop-commander__start_process|interact_with_process) — twarde bramki
// na komendy, ktore reguly CLAUDE.md zakazuja "z pamieci". Exit 2 => komenda NIE wykonuje sie, powod wraca do Claude.
// v4 (2026-09-26, landscape): reguly w lib/bash-rules.js (parser powloki + dawne regexy jako podloga);
// wyjatek `ALLOW_X=1` w komendzie dziala TYLKO, gdy uzytkownik wydal go w czacie (`pozwol ALLOW_X`, lib/overrides.js) —
// sam token w komendzie bez zgody = blokada. Kazde uzycie wyjatku = `bypass` w gates.jsonl, regula w trybie observe =
// `would_block`. Fail-open: WLASNY blad hooka => exit 0 + wpis `skipped` (nigdy nie blokuj sesji przez siebie).
'use strict';
const fs = require('fs');

// Awaryjny zestaw regul, gdy biblioteka sie nie laduje (security-review 2026-09-26: uszkodzony bash-rules.js = blad `require`
// poza try = fail-open CALEGO bash-guarda). Minimum: obejscia bramek, destrukcja historii, zapis warstwy kontrolnej.
// Nie blokujemy wszystkiego (to zamknelo by tez naprawe), tylko najgrozniejsze klasy.
const FALLBACK = [
  /\bgit\b[^\n;&|]*\s--no-verify\b/i, /\bgit\b[^\n;&|]*\bpush\b[^\n;&|]*(\s--force\b|\s-f\b|\s\+\w)/i, /\bgit\b[^\n;&|]*\breset\b[^\n;&|]*--hard/i,
  /core\.hookspath/i, /\brm\s+-[a-z]*r[a-z]*\s+(\/|~|\$HOME|[a-z]:[\\/])\s*($|[;&|])/i,
  /\.claude[\\/]+(hooks|git-hooks|bin|settings)/i, /\bALLOW_[A-Z][A-Z_]*\s*=/,
];
let lib = null;
try {
  lib = { evaluate: require('./lib/bash-rules').evaluate, overrides: require('./lib/overrides'), gateLog: require('./lib/gate-log') };
} catch (e) {
  lib = { error: String(e && e.message || e).slice(0, 160) };
}
const log = (entry) => { try { (lib.gateLog || require('./lib/gate-log')).log(entry); } catch (e) { /* bez telemetrii */ } };

const HOOK = 'bash-guard';
// desktop-commander uruchamia powloke z pominieciem matchera Bash (design review 2026-09-26) — mapujemy jego pola.
const TOOL_FIELDS = {
  Bash: 'command', PowerShell: 'command',
  'mcp__desktop-commander__start_process': 'command',
  'mcp__desktop-commander__interact_with_process': 'input',
};

function main() {
  let input = {};
  try { input = JSON.parse(fs.readFileSync(0, 'utf8').replace(/^﻿/, '') || '{}'); } catch (e) { return 0; }
  const tool = String(input.tool_name || 'Bash');
  const field = TOOL_FIELDS[tool];
  if (!field) return 0;
  const cmd = String((input.tool_input || {})[field] || '');
  if (!cmd.trim()) return 0;
  if (lib.error) {
    log({ hook: HOOK, event: 'skipped', reason: 'lib load failed -> fallback: ' + lib.error, target: input.cwd || '' });
    if (FALLBACK.some((rx) => rx.test(cmd))) {
      process.stderr.write(`[bash-guard:fallback] ZABLOKOWANE: biblioteka regul bash-guard nie laduje sie (${lib.error}); dziala zestaw awaryjny, a ta komenda do niego pasuje. uzytkownik: napraw ~/.claude/hooks/lib (git -C ~/.claude diff) poza sesja agenta.\n`);
      return 2;
    }
    return 0;
  }
  const { evaluate, overrides } = lib;
  lib.gateLog.noteInputKeys(HOOK, input);
  const sid = input.session_id || '';
  const agentType = input.agent_type || input.agentType || null;
  const result = evaluate(cmd, { dialect: tool === 'PowerShell' ? 'ps' : 'sh', cwd: input.cwd || process.cwd(), agentType });

  for (const o of result.observes) log({ hook: HOOK, event: 'would_block', reason: `rule:${o.id}`, target: input.cwd || '' });

  const granted = result.tokens.filter((t) => overrides.has(sid, t));
  const missing = result.tokens.filter((t) => !granted.includes(t));
  if (missing.length) {
    log({ hook: HOOK, event: 'blocked', reason: `override-required:${missing.join(',')}`, target: input.cwd || '' });
    process.stderr.write(`[bash-guard:override-required] ZABLOKOWANE / BLOCKED: ${missing.join(', ')} w komendzie bez zgody uzytkownika. ` +
      `Wyjatek wydaje czlowiek, nie agent: popros uzytkownika, zeby napisal w czacie dokladnie „pozwol ${missing.join(' ')}" (sama fraza, bez innego tekstu), potem powtorz komende. ` +
      'Jesli to nie jest swiadoma decyzja uzytkownika — napraw przyczyne zamiast omijac bramke.\n');
    return 2;
  }
  const blocks = result.blocks.filter((b) => !(b.esc && granted.includes(b.esc)));
  if (blocks.length) {
    const b = blocks[0];
    log({ hook: HOOK, event: 'blocked', reason: `rule:${blocks.map((x) => x.id).join(',')}`, target: input.cwd || '' });
    const escape = b.esc ? ` Wyjatek tylko za zgoda uzytkownika: uzytkownik pisze w czacie „pozwol ${b.esc}", potem komenda z ${b.esc}=1.` : ' Brak wyjatku dla tej reguly.';
    const more = blocks.length > 1 ? ` (tez: ${blocks.slice(1).map((x) => x.id).join(', ')})` : '';
    process.stderr.write(`[bash-guard:${b.id}] ZABLOKOWANE / BLOCKED (rule ${b.id}${more}). ${b.why}${escape}\n`);
    return 2;
  }
  // Zuzycie PRZED przepuszczeniem, pod blokada pliku (data-review 2026-09-26: has()+consume() = wyscig rownoleglych komend).
  // Nie udalo sie zuzyc (limit wyczerpany miedzy sprawdzeniem a zuzyciem) = blokada, nie ciche przejscie bez sladu.
  for (const t of granted) {
    if (!overrides.consume(sid, t)) {
      log({ hook: HOOK, event: 'blocked', reason: `override-exhausted:${t}`, target: input.cwd || '' });
      process.stderr.write(`[bash-guard:override-exhausted] ZABLOKOWANE: wyjatek ${t} wlasnie sie wyczerpal/wygasl. Popros uzytkownika o ponowne „pozwol ${t}".\n`);
      return 2;
    }
    log({ hook: HOOK, event: 'bypass', reason: `${t} (zgoda uzytkownika w czacie)`, target: input.cwd || '' });
  }
  return 0;
}

let code = 0;
try { code = main(); } catch (e) {
  log({ hook: HOOK, event: 'skipped', reason: 'internal error: ' + String(e && e.message || e).slice(0, 120), target: process.cwd() });
  code = 0;
}
process.exit(code);

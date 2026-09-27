#!/usr/bin/env node
// PreToolUse hook (Edit|Write|MultiEdit|NotebookEdit|desktop-commander write_file/edit_block/move_file) — landscape 2026-09-26.
// Bramki na ZAPIS plikow narzedziami (bash-guard pilnuje tych samych regul dla komend powloki):
//  (1) warstwa kontrolna PG (#11): ~/.claude hooks/git-hooks/bin/agents/scheduled-tasks/settings, logi bramek,
//      ~/.gitconfig, .git/config, profile powloki — tylko z wyjatkiem od uzytkownika (`pozwol ALLOW_CONTROL_PLANE`),
//  (2) recenzent/weryfikator READ-ONLY (#15): zapis tylko do findings/verdicts albo %TEMP%,
//  (3) luzowanie konfiguracji jakosci (N2): zdjecie "strict": true, regula -> "off", nowe ignore w ruff/pyright —
//      tylko z wyjatkiem `pozwol ALLOW_CONFIG`. Zaostrzanie i nowe pliki przechodza.
// Fail-open na WLASNY blad (exit 0 + `skipped` w logu). Exit 2 = zapis sie nie wykona, powod wraca do Claude.
'use strict';
const fs = require('fs');
const overrides = require('./lib/overrides');
const { log, noteInputKeys } = require('./lib/gate-log');
const { isControlPlane, isQualityConfig, isTempPath, isReviewArtifact, normalizePath } = require('./lib/protected-paths');

const HOOK = 'edit-guard';
const WRITE_TOOLS = /^(Edit|Write|MultiEdit|NotebookEdit|mcp__desktop-commander__(write_file|edit_block|move_file))$/;

function targetsOf(tool, ti) {
  if (tool === 'mcp__desktop-commander__move_file') return [ti.source, ti.destination].filter(Boolean);
  return [ti.file_path || ti.path || ti.notebook_path].filter(Boolean);
}

// Tekst PO zapisie i PRZED nim (dla porownania luzowania). null = nie da sie ustalic (np. move).
function beforeAfter(tool, ti, file) {
  let current = '';
  try { current = fs.readFileSync(file, 'utf8'); } catch (e) { current = ''; }
  const replaceIn = (text, oldS, newS) => (oldS && text.includes(oldS) ? text.split(oldS).join(newS) : text + '\n' + newS);
  if (tool === 'Write') return { before: current, after: String(ti.content || '') };
  if (tool === 'mcp__desktop-commander__write_file') return { before: current, after: ti.mode === 'append' ? current + String(ti.content || '') : String(ti.content || '') };
  if (tool === 'Edit' || tool === 'mcp__desktop-commander__edit_block') return { before: current, after: replaceIn(current, String(ti.old_string || ''), String(ti.new_string || '')) };
  if (tool === 'MultiEdit') {
    let after = current;
    for (const e of ti.edits || []) after = replaceIn(after, String(e.old_string || ''), String(e.new_string || ''));
    return { before: current, after };
  }
  return null;
}

const count = (text, rx) => (String(text).match(rx) || []).length;
const STRICT_TRUE = /"strict"\s*:\s*true/g;
const TS_FLAG_OFF = /"(strict|noImplicitAny|strictNullChecks|strictFunctionTypes|noUncheckedIndexedAccess|noImplicitReturns|noImplicitOverride|exactOptionalPropertyTypes|noFallthroughCasesInSwitch)"\s*:\s*false/g;
const LINT_OFF = /:\s*["'](off|allow)["']|:\s*0\s*[,}\n]|\[\s*["']?(off|0)["']?\s*[,\]]/g;
const PY_LOOSE = /\b(ignore|extend-ignore|per-file-ignores|exclude|typeCheckingMode"?\s*[:=]\s*"?(off|basic))\b/g;

/** Powod, jesli zmiana LUZUJE konfiguracje jakosci; null gdy nie. */
function loosening(file, before, after) {
  if (!before) return null; // nowy plik = scaffold, nie luzowanie
  if (/tsconfig|jsconfig/i.test(file)) {
    if (count(after, STRICT_TRUE) < count(before, STRICT_TRUE)) return 'zdjete "strict": true';
    if (count(after, TS_FLAG_OFF) > count(before, TS_FLAG_OFF)) return 'flaga scislosci TS ustawiona na false';
  }
  if (/eslint|oxlintrc|biome/i.test(file) && count(after, LINT_OFF) > count(before, LINT_OFF)) return 'regula lintera wylaczona ("off"/0)';
  if (/ruff|pyright/i.test(file) && count(after, PY_LOOSE) > count(before, PY_LOOSE)) return 'nowe ignore/exclude albo slabszy typeCheckingMode';
  return null;
}

function deny(reason, message, target) {
  log({ hook: HOOK, event: 'blocked', reason, target });
  process.stderr.write(`[edit-guard:${reason}] ZABLOKOWANE / BLOCKED. ${message}\n`);
  return 2;
}

function main() {
  let input = {};
  try { input = JSON.parse(fs.readFileSync(0, 'utf8').replace(/^﻿/, '') || '{}'); } catch (e) { return 0; }
  const tool = String(input.tool_name || '');
  if (!WRITE_TOOLS.test(tool)) return 0;
  noteInputKeys(HOOK, input);
  const ti = input.tool_input || {};
  const sid = input.session_id || '';
  const cwd = input.cwd || process.cwd();
  const agentType = input.agent_type || input.agentType || null;
  const targets = targetsOf(tool, ti);
  for (const t of targets) {
    if (agentType && /reviewer|verifier|catfish/i.test(agentType) && !isTempPath(t, cwd) && !isReviewArtifact(t, cwd)) {
      return deny('readonly-agent', `Recenzent/weryfikator (${agentType}) jest READ-ONLY — zapis tylko do findings/verdicts w katalogu przebiegu albo %TEMP%. Nie edytuj: ${t}`, t);
    }
  }
  for (const t of targets) {
    if (!isControlPlane(t, cwd)) continue;
    if (overrides.consume(sid, overrides.CONTROL_PLANE)) { log({ hook: HOOK, event: 'bypass', reason: `ALLOW_CONTROL_PLANE (zgoda uzytkownika): ${normalizePath(t, cwd).slice(-80)}`, target: cwd }); continue; }
    return deny('control-plane', `Zapis warstwy kontrolnej PG (${t}). Zmiany bramek/ustawien tylko za zgoda uzytkownika: uzytkownik pisze w czacie „pozwol ALLOW_CONTROL_PLANE" (okno 60 min).`, t);
  }
  // Plik powloki/env ustawiajacy ALLOW_* albo PG_GATE_LOG/PG_OVERRIDES_DIR (potem `. plik` / `source`) = obejscie przez plik
  // (security-review 2026-09-26). Dotyczy tylko plikow wykonywanych przez powloke — dokumentacja moze opisywac ALLOW_X=1.
  const SHELL_FILE_RX = /\.(sh|bash|zsh|ps1|psm1|bat|cmd|env)$|(^|[\/\\])\.(env[\w.-]*|envrc|bashrc|zshrc|profile)$/i;
  // Przypisanie na poczatku instrukcji (jak w bash-rules.js): komunikat `echo "... ALLOW_X=1 ..."` to nie ustawienie.
  const ENV_SET_RX = /(^|[;&|]\s*)\s*(export\s+|set\s+|setx\s+|declare\s+-x\s+|\$env:)?(ALLOW_[A-Z][A-Z_]*|PG_GATE_LOG|PG_OVERRIDES_DIR|PG_TRUSTED_ROOTS_FILE)\s*=|(^|[;&|]\s*)\s*printf\s+-v\s+(ALLOW_|PG_GATE_LOG)/m;
  for (const t of targets) {
    if (!SHELL_FILE_RX.test(t)) continue;
    const text = String(ti.content || '') + '\n' + String(ti.new_string || '') + '\n' + (ti.edits || []).map((e) => e.new_string || '').join('\n');
    if (ENV_SET_RX.test(text) && !overrides.consume(sid, 'ALLOW_ENV_FILE')) {
      return deny('env-file', `Plik powloki ${t} ustawia ALLOW_*/PG_* — po \`. plik\` wylaczylby bramki bez zgody uzytkownika. Swiadoma decyzja: „pozwol ALLOW_ENV_FILE".`, t);
    }
  }
  for (const t of targets) {
    if (!isQualityConfig(t)) continue;
    const ba = beforeAfter(tool, ti, t);
    const why = ba && loosening(t, ba.before, ba.after);
    if (!why) continue;
    if (overrides.consume(sid, 'ALLOW_CONFIG')) { log({ hook: HOOK, event: 'bypass', reason: `ALLOW_CONFIG (zgoda uzytkownika): ${why}`, target: cwd }); continue; }
    return deny('config-loosen', `Luzowanie konfiguracji jakosci w ${t}: ${why}. Napraw kod zamiast wylaczac regule (SUPPRESSION-AS-FIX). Swiadoma decyzja uzytkownika: „pozwol ALLOW_CONFIG".`, t);
  }
  return 0;
}

let code = 0;
try { code = main(); } catch (e) {
  log({ hook: HOOK, event: 'skipped', reason: 'internal error: ' + String(e && e.message || e).slice(0, 120), target: process.cwd() });
  code = 0;
}
process.exit(code);

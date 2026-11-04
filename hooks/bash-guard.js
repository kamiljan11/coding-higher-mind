#!/usr/bin/env node
// PreToolUse hook (matcher: Bash|PowerShell|mcp__desktop-commander__start_process|interact_with_process|mcp__terminal__run_in_terminal) — twarde bramki
// na komendy, ktore reguly CLAUDE.md zakazuja "z pamieci". Exit 2 => komenda NIE wykonuje sie, powod wraca do Claude.
// v4 (2026-09-26, landscape): reguly w lib/bash-rules.js (parser powloki + dawne regexy jako podloga);
// wyjatek `ALLOW_X=1` w komendzie wg poziomu z lib/overrides.js (2026-10-02): A = agent sam, B = po samozatwierdzeniu
// (bin/pg-self-approve.js), C = tylko fraza uzytkownika w czacie (`pozwol ALLOW_X`); token bez pokrycia = blokada. Kazde uzycie wyjatku = `bypass` w gates.jsonl, regula w trybie observe =
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
  // Syncthing moze dowiezc nowy hook przed nowa biblioteka (data-review 2026-10-02) — brak API = zestaw awaryjny, nie fail-open.
  if (typeof lib.overrides.sourceOf !== 'function' || typeof lib.overrides.repoKey !== 'function') throw new Error('overrides.js bez sourceOf/repoKey (niezsynchronizowana wersja)');
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
// Kanaly powloki tylko MIERZONE (ADR-0008: pomiar przed blokada; 2026-11-03, security-review outbound-observe):
// panel Terminal aplikacji wykonywal komendy z pominieciem bash-guard (~140 wywolan w transkryptach, m.in. sudo).
// Te same reguly co dla Bash, ale wynik = `would_block` (reason `observe-channel:rule:<id>`), NIGDY exit 2; brak trafien = `ran`
// `sudo` na poczatku segmentu = osobny would_block `observe-channel:sudo` (zadna regula go nie lapie, a ten kanal go niesie;
// guard_health raportuje would_block, nie ran).
const OBSERVE_FIELDS = { 'mcp__terminal__run_in_terminal': 'command' };

function main() {
  let input = {};
  try { input = JSON.parse(fs.readFileSync(0, 'utf8').replace(/^﻿/, '') || '{}'); } catch (e) { return 0; }
  const tool = String(input.tool_name || 'Bash');
  const observeOnly = Object.prototype.hasOwnProperty.call(OBSERVE_FIELDS, tool);
  const field = TOOL_FIELDS[tool] || OBSERVE_FIELDS[tool];
  if (!field) return 0;
  const cmd = String((input.tool_input || {})[field] || '');
  if (!cmd.trim()) return 0;
  if (observeOnly) return observeChannel(tool, cmd, input);
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

  // Zrodlo wyjatku (overrides.js, poziomy A/B/C): A = agent sam, B = samozatwierdzenie po recenzji (tylko w repo recenzji
  // i tylko gdy komenda nie siega poza to repo — security-review 2026-10-02: `cd`/`git -C`/sciezka absolutna), C = fraza.
  const cwd = input.cwd || process.cwd();
  const sourceOf = (t) => {
    const s = overrides.sourceOf(sid, t, cwd);
    return s === 'self-approved' && leavesRepo(cmd, cwd) ? null : s;
  };
  const granted = result.tokens.filter((t) => sourceOf(t));
  const missing = result.tokens.filter((t) => !granted.includes(t));
  if (missing.length) {
    log({ hook: HOOK, event: 'blocked', reason: `override-required:${missing.join(',')}`, target: input.cwd || '' });
    process.stderr.write(`[bash-guard:override-required] ZABLOKOWANE / BLOCKED: ${missing.join(', ')} w komendzie bez zatwierdzenia. ` +
      missing.map(howToGet).join(' ') + ' Jesli to skrot, a nie swiadoma decyzja — napraw przyczyne zamiast omijac bramke.\n');
    return 2;
  }
  const blocks = result.blocks.filter((b) => !(b.esc && granted.includes(b.esc)));
  if (blocks.length) {
    const b = blocks[0];
    log({ hook: HOOK, event: 'blocked', reason: `rule:${blocks.map((x) => x.id).join(',')}`, target: input.cwd || '' });
    const escape = b.esc ? ` ${howToGet(b.esc)}` : ' Brak wyjatku dla tej reguly.';
    const more = blocks.length > 1 ? ` (tez: ${blocks.slice(1).map((x) => x.id).join(', ')})` : '';
    process.stderr.write(`[bash-guard:${b.id}] ZABLOKOWANE / BLOCKED (rule ${b.id}${more}). ${b.why}${escape}\n`);
    return 2;
  }
  // Zuzycie PRZED przepuszczeniem, pod blokada pliku (data-review 2026-09-26: has()+consume() = wyscig rownoleglych komend).
  // Nie udalo sie zuzyc (limit wyczerpany miedzy sprawdzeniem a zuzyciem) = blokada, nie ciche przejscie bez sladu.
  for (const t of granted) {
    const source = sourceOf(t);
    if (source === 'self-service') { log({ hook: HOOK, event: 'bypass', reason: `${t} (poziom A: agent sam)`, target: input.cwd || '' }); continue; }
    if (!overrides.consume(sid, t)) {
      log({ hook: HOOK, event: 'blocked', reason: `override-exhausted:${t}`, target: input.cwd || '' });
      process.stderr.write(`[bash-guard:override-exhausted] ZABLOKOWANE: wyjatek ${t} wlasnie sie wyczerpal/wygasl. ${howToGet(t)}\n`);
      return 2;
    }
    log({ hook: HOOK, event: 'bypass', reason: `${t} (${source === 'session' ? 'zgoda uzytkownika w czacie' : 'poziom B: samozatwierdzenie po recenzji'})`, target: input.cwd || '' });
  }
  return 0;
}

// sudo jako komenda segmentu (kanal obserwowany): segment zaczyna sie po ; & | ( { ! ` nowej linii albo then/do/else/elif;
// przed sudo dopuszczone przypisania zmiennych i opakowania time/nice/exec/command/env/xargs/nohup/timeout z opcjami
// i czasem (timeout 5); sudo tez po sciezce (/usr/bin/sudo) i jako \sudo. Cytaty wyciete (echo "sudo x" to nie sudo), ale
// cialo `sh -c '...'`/`bash -lc "..."` oceniane jak komenda (jeden poziom). Odstepy tylko [ \t]: \s zjadal serie nowych
// linii i dawal czas kwadratowy (ops-review 2026-11-03: 30k x \n = 1,5 s). Poza zasiegiem: eval, aliasy/funkcje, skrypt
// z pliku, zagniezdzone -c — lista w pg/ref-pg-internals.md.
const SUDO_SEGMENT = /(?:^|[;&|({!`\n]|\b(?:then|do|else|elif)\b)[ \t]*(?:[A-Za-z_]\w*=\S*[ \t]+)*(?:(?:time|nice|exec|command|env|xargs|nohup|timeout)(?:[ \t]+-\S+(?:[ \t]+\d+)?)*[ \t]+(?:\d+(?:\.\d+)?[smhd]?[ \t]+)?(?:[A-Za-z_]\w*=\S*[ \t]+)*)*\\?(?:\/\S*\/)?sudo(?:\s|$)/;
// Cialo `-c` tylko po nazwie powloki (grep -c 'sudo' to nie komenda); opcje przed -c dozwolone (bash -l -c, bash -lc).
const SHELL_C_BODY = /(?:^|[^\w/.-])(?:\/\S*\/)?(?:sh|bash|zsh|dash|ksh)(?:[ \t]+-[A-Za-z]+)*[ \t]+-[A-Za-z]*c[ \t]+("(?:[^"\\]|\\.)*"|'[^']*')/g;
// Cytaty -> "" jednym przejsciem (regex cudzyslowu byl kwadratowy na seriach \" — ops-review 2026-11-03: 100k znakow = 11,7 s).
// Inna semantyka niz stripQuoted w lib/bash-rules.js i lib/lint-file.js: zwraca tez tresc podstawien.
// Podstawienie $(...) i `...` wewnatrz "..." wykonuje sie, wiec jego tresc wraca jako osobny segment (bez zagniezdzen).
function blankShellQuotes(s) {
  let out = '';
  const subs = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '\\') { out += s.slice(i, i + 2); i += 2; continue; }
    if (ch !== '"' && ch !== "'") { out += ch; i++; continue; }
    let j = i + 1;
    while (j < s.length && s[j] !== ch) {
      if (ch === '"' && s[j] === '\\') { j += 2; continue; }
      if (ch === '"' && (s.startsWith('$(', j) || s[j] === '`')) {
        const open = s[j] === '`' ? 1 : 2;
        const end = s.indexOf(open === 1 ? '`' : ')', j + open);
        if (end < 0) { j = s.length; break; } // podstawienie bez domkniecia = cytat bez domkniecia (jedno przejscie)
        subs.push(s.slice(j + open, end));
        j = end + 1;
        continue;
      }
      j++;
    }
    if (j >= s.length) { out += s.slice(i); break; } // cytat bez domkniecia: reszta bez zmian
    out += '""';
    i = j + 1;
  }
  return out + subs.map((x) => '\n' + x).join('');
}
function sudoInCommand(cmd) {
  if (SUDO_SEGMENT.test(blankShellQuotes(cmd))) return true;
  for (const m of cmd.matchAll(SHELL_C_BODY)) {
    if (SUDO_SEGMENT.test(blankShellQuotes(m[1].slice(1, -1)))) return true;
  }
  return false;
}

const OBSERVE_MAX_CHARS = 20000;

// Kanal obserwowany: kazda regula, ktora by zablokowala (albo wymagala wyjatku ALLOW_*), idzie do gates.jsonl jako would_block.
// Stale reasony (guard_health grupuje po nich); target = nazwa narzedzia, nie komenda (komenda moze niesc sekrety/PII).
function observeChannel(tool, cmd, input) {
  if (lib.error) {
    log({ hook: HOOK, event: 'skipped', reason: 'observe-channel: biblioteka regul nie laduje sie', target: tool });
    return 0;
  }
  lib.gateLog.noteInputKeys(HOOK, input);
  // Ocena regul rosnie nieliniowo z dlugoscia (ops-review 2026-11-03: 100k znakow = 7,9 s w lib.evaluate, timeout hooka 15 s);
  // dluzsza komenda = skipped ze stalym reasonem (widoczne w guard_health), nie cisza i nie ubity hook.
  if (cmd.length > OBSERVE_MAX_CHARS) {
    log({ hook: HOOK, event: 'skipped', reason: `observe-channel: komenda dluzsza niz ${OBSERVE_MAX_CHARS} znakow`, target: tool });
    return 0;
  }
  // Panel ma wlasny katalog (tool_input.cwd, np. "~"); reguly zalezne od katalogu licza sie wzgledem niego. Bez pola
  // (wiekszosc wywolan) = katalog sesji — przyblizenie: katalog startowy panelu nie jest w wejsciu hooka.
  const own = (input.tool_input || {}).cwd;
  const cwd = typeof own === 'string' && own ? own.replace(/^~(?=$|\/)/, require('os').homedir()) : (input.cwd || process.cwd());
  let result;
  try {
    result = lib.evaluate(cmd, { dialect: 'sh', cwd, agentType: input.agent_type || input.agentType || null });
  } catch (e) {
    // reason staly (grupowanie); w target tylko klasa bledu: komunikat parsera moze cytowac komende (sekrety/PII)
    log({ hook: HOOK, event: 'skipped', reason: 'observe-channel: blad oceny regul', target: `${tool}: ${(e && e.name) || 'blad'}` });
    return 0;
  }
  // Nazwa tokena pochodzi z tekstu komendy: ksztalt ALLOW_X do 32 znakow, inny = jeden kubelek (kardynalnosc grup w guard_health).
  const tokens = result.tokens.map((t) => (/^ALLOW_[A-Z_]{1,32}$/.test(t) ? t : 'ALLOW_?'));
  const hits = [...result.blocks.map((b) => `rule:${b.id}`), ...result.observes.map((o) => `rule:${o.id}`), ...tokens.map((t) => `override:${t}`)];
  if (sudoInCommand(cmd)) hits.push('sudo');
  for (const h of [...new Set(hits)]) log({ hook: HOOK, event: 'would_block', reason: `observe-channel:${h}`, target: tool });
  if (!hits.length) log({ hook: HOOK, event: 'ran', reason: 'observe-channel: bez trafien regul', target: tool });
  return 0;
}

// Czy komenda siega poza repo z cwd: zmiana katalogu, `git -C`, `gh -R/--repo`, sciezka absolutna/`~`/`..` poza korzeniem.
// Konserwatywnie: watpliwosc = poza repo (wyjatek B nie dziala, zostaje fraza uzytkownika albo komenda z cwd w repo).
function leavesRepo(cmd, cwd) {
  const path = require('path');
  const root = lib.overrides.repoKey(cwd);
  if (!root) return true;
  if (/(^|[;&|(\s"'])(cd|pushd|popd|chdir|set-location|sl|push-location)(\s|\.|[\\/]|$)/i.test(cmd) || /\s(-C|-R|--repo|--git-dir|--work-tree)(\s|=)/.test(cmd)) return true;
  // Rozwijane zmienne/podpowloki (`${HOME}`, `$USERPROFILE`, `$(...)`, backtick) i GIT_DIR/GIT_WORK_TREE: celu nie znamy
  // z tekstu = poza repo (code-review 2026-10-02: `rm -rf ${HOME}/x` przechodzilo z grantem B).
  if (/[$`]/.test(cmd) || /\bGIT_[A-Z_]+\s*=/.test(cmd)) return true;
  // Wrapper powloki/interpreter = komenda w napisie, ktorej slow tu nie widac (code-review 2026-10-02: `sh -c "rm -rf .."`).
  if (/(^|[;&|(\s"'])(sh|bash|zsh|dash|ksh|cmd|powershell|pwsh|env|xargs|eval|exec|sudo|node|python3?|perl|ruby|find|busybox)(\.exe)?(\s|$)/i.test(cmd)) return true;
  // Lista dozwolonych zamiast czarnej (security-review 2026-10-02: `env --chdir=..`, klamry `{..,.}`, `<backup-drive>:` przechodzily):
  // kazde slowo = zwykle wzgledne slowo bez `..`, glob/klamer, `=` (poza wiodacym ALLOW_X=1), dwukropka i `~`.
  const words = cmd.match(/"[^"]*"|'[^']*'|[^\s;&|()]+/g) || [];
  return words.some((raw, i) => {
    const w = raw.replace(/^["']|["']$/g, '');
    if (/^ALLOW_[A-Z][A-Z_]*=1$/.test(w) && words.slice(0, i).every((x) => /^ALLOW_[A-Z][A-Z_]*=1$/.test(x))) return false;
    // Cytowany tekst ze spacja tylko jako tresc opcji wiadomosci (`git commit -m "feat: x"`), bez `/`, `\`, `~`, `X:`.
    if (/^["']/.test(raw) && /\s/.test(w)) return !/^(-m|--message|-t|--title|-b|--body)$/.test(words[i - 1] || '') || /[\\/~]|^[a-z]:/i.test(w);
    if (!/^[\w.\-\/@+,%]+$/.test(w) || /(^|\/)\.\.(\/|$)/.test(w)) return true;
    const norm = path.resolve(cwd, w).replace(/\\/g, '/').toLowerCase();
    // Korzen w obu formach: realpath (repoKey) i jak podal cwd (Windows 8.3 `USERNA~1` vs `<owner>`).
    const roots = [root, String(lib.overrides.repoRoot(cwd) || '').replace(/\\/g, '/').toLowerCase()].filter(Boolean);
    return !roots.some((r) => norm === r || norm.startsWith(r + '/'));
  });
}

// Instrukcja dla agenta zalezna od poziomu wyjatku — petla ma wiedziec, jak sama ruszyc dalej (poziom B), a kiedy stanac (C).
function howToGet(t) {
  const tier = lib.overrides.tierOf(t);
  if (tier === 'A') return `${t} jest poziomu A: dodaj ${t}=1 do komendy (slad w gates.jsonl).`;
  if (tier === 'B') {
    return `${t} jest poziomu B (samozatwierdzenie): uruchom skill pg-review (subagenci security-reviewer + code-reviewer) dla tego repo, ` +
      `napraw findings, potem \`node ~/.claude/bin/pg-self-approve.js --run <RUN> --repo <repo> --allow ${t} --reason "<po co>"\` ` +
      `i powtorz komende z ${t}=1 z katalogu repo (bez cd/-C/sciezek poza repo).`;
  }
  return `${t} jest poziomu C: wyjatek wydaje tylko uzytkownik — sama fraza „pozwol ${t}" w czacie, potem komenda z ${t}=1.`;
}

let code = 0;
try { code = main(); } catch (e) {
  log({ hook: HOOK, event: 'skipped', reason: 'internal error: ' + String(e && e.message || e).slice(0, 120), target: process.cwd() });
  code = 0;
}
process.exit(code);

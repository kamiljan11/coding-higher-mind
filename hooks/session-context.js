#!/usr/bin/env node
// SessionStart hook (startup/resume/clear/compact) — wstrzykuje pamiec sesyjna z Obsidiana
// do kontekstu DETERMINISTYCZNIE (stdout => kontekst). Zastepuje regule "PIERWSZA AKCJA:
// przeczytaj 3 pliki przez desktop-commander" — model nie musi pamietac, hook to robi.
// Po /compact (matcher compact) wstrzykuje ponownie => auto-compact nie gubi stanu.
// Fail-open: brak katalogu pamieci/pliku => krotka notka, exit 0.
'use strict';
const fs = require('fs');
const path = require('path');
let input = {};
try { input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch (e) {}
const reason = input.session_start_reason || input.source || 'unknown';
// Katalog pamieci: env > vault Obsidiana wlasciciela > ~/.claude/memory (wersja publiczna PG: to samo, bez dysku <backup-drive>:).
const OWNER_MEM = '~/.claude/memory';
const MEM = process.env.MAS_MEMORY_DIR || (fs.existsSync(OWNER_MEM) ? OWNER_MEM : path.join(require('os').homedir(), '.claude', 'memory'));
const CAP_TOTAL = 40000; // ~10k tokenow; twardy sufit
const FILES = [
  ['RESUME.md', 6000, 'punkt kontrolny biezacej pracy (czytaj PIERWSZY)'],
  ['Notes for Claude.md', 14000, 'reguly operacyjne + stan'],
  ['Projects.md', 10000, 'aktywne projekty'],
  ['Active Systems.md', 10000, 'zbudowane systemy — nie buduj od nowa'],
];
const out = [];
let used = 0;
out.push(`[SESSION-CONTEXT source=${reason} ${new Date().toISOString().slice(0, 16)}] Pamiec z ${MEM} wstrzyknieta przez hook SessionStart. NIE czytaj tych plikow ponownie przez desktop-commander — juz sa ponizej. Cowork/stary CLI bez tego bloku => czytaj po staremu.`);
for (const [name, cap, desc] of FILES) {
  const p = path.join(MEM, name);
  let txt;
  try { txt = fs.readFileSync(p, 'utf8'); } catch (e) { out.push(`--- ${name}: BRAK (${e.code || 'err'}) — ${desc}`); continue; }
  const limit = Math.min(cap, CAP_TOTAL - used);
  if (limit <= 500) { out.push(`--- ${name}: pominiety (limit kontekstu) — przeczytaj recznie jesli potrzebny`); continue; }
  let body = txt.length > limit ? txt.slice(0, limit) + `\n[... uciete: ${txt.length - limit} znakow — pelna wersja w pliku]` : txt;
  used += body.length;
  out.push(`--- ${name} (${desc}) ---\n${body.trim()}`);
}
out.push('[/SESSION-CONTEXT] Reguly: append/edit nigdy rewrite w Claude Memory; sekrety tylko przez menedzer sekretow (np. Infisical CLI); caveman on; anti-sycophancy on.');
process.stdout.write(out.join('\n\n') + '\n');
process.exit(0);

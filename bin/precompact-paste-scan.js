#!/usr/bin/env node
// precompact-paste-scan: ile wklejek z transkryptow zachowuje entryPastes hooka precompact-snapshot (pomiar, tylko odczyt, 2026-11-02).
// Liczy WSZYSTKIE pary <pasted_content id> we wpisach uzytkownika (nie tylko te, ktore hook uzna za realne — product A9) i
// dzieli zgubione na: za obcym tagiem w bloku (`after_tag`), z obcym tagiem w srodku (`inner_tag`) i we wpisie nie-poleceniu
// (`not_prompt`, np. Stop hook feedback — pomijane celowo), z przykladami do recznej oceny (plik, pozycja, dlugosc — bez tresci); `skipped_big` / `bad_lines` = czego nie zmierzono.
// Uzycie: node bin/precompact-paste-scan.js [katalog transkryptow, domyslnie ~/.claude/projects]. Exit 0 = pomiar, 2 = blad narzedzia.
// Rewizja granicy fail-closed (pg/known-limits.md › precompact-snapshot): przyklad zgubionej wklejki, ktora byla tekstem uzytkownika => wroc do decyzji.
const fs = require('fs');
const os = require('os');
const path = require('path');
// Reguly (pastePairs, FOREIGN_TAG_RX, NOT_A_PROMPT_RX) z hooka — jeden wlasciciel, bez kopii.
const { entryPastes, pastePairs, FOREIGN_TAG_RX, NOT_A_PROMPT_RX } = require('../hooks/precompact-snapshot.js');

const MAX_FILE = 500e6; // ponizej limitu stringa V8 (~536 M znakow); 300e6 pomijal transkrypt 300,04 MB (product A11)

function scanFile(f, acc) {
  const t = fs.readFileSync(f, 'utf8');
  if (!t.includes('pasted_content')) return;
  const lines = t.split('\n');
  for (let ln = 0; ln < lines.length; ln++) {
    const line = lines[ln];
    if (!line.includes('pasted_content')) continue;
    let e;
    try { e = JSON.parse(line); } catch (err) { acc.bad_lines++; continue; }
    if (e.type !== 'user' || e.isSidechain || e.isMeta || e.isCompactSummary) continue;
    const c = e.message && e.message.content;
    const blocks = typeof c === 'string' ? [c] : Array.isArray(c) ? c.filter((b) => b && b.type === 'text').map((b) => b.text) : [];
    // Licznik tresci, nie zbior (code A11): ta sama tresc 2x (przed i za obcym tagiem) = 1 kept + 1 zgubiona.
    const kept = new Map();
    for (const p of entryPastes(blocks)) kept.set(p, (kept.get(p) || 0) + 1);
    const notPrompt = blocks.length > 0 && NOT_A_PROMPT_RX.test(String(blocks[0]).trim());
    for (const b of blocks) {
      for (const m of pastePairs(b)) {
        acc.all++;
        if (kept.get(m[2]) > 0) { kept.set(m[2], kept.get(m[2]) - 1); acc.kept++; continue; }
        const kind = notPrompt ? 'not_prompt' : FOREIGN_TAG_RX.test(m[2]) ? 'inner_tag' : 'after_tag';
        acc[kind]++;
        // Bez tresci wklejki (security A10: wynik trafia do transkryptu i notatek) — tylko gdzie szukac: plik:linia JSONL, @ = pozycja w bloku tekstu wpisu.
        if (acc.examples.length < 5) acc.examples.push(`${kind} ${path.basename(f)}:${ln + 1} @${m.index} len=${m[2].length}`);
      }
    }
  }
}

function walk(d, acc) {
  for (const n of fs.readdirSync(d)) {
    const f = path.join(d, n);
    const st = fs.lstatSync(f); // lstat: dowiazanie nie jest sledzone (bez petli, bez przerwania na zerwanym)
    if (st.isDirectory()) walk(f, acc);
    else if (!n.endsWith('.jsonl') || st.isSymbolicLink()) continue;
    else if (st.size < MAX_FILE) scanFile(f, acc);
    else acc.skipped_big++;
  }
}

if (require.main === module) {
  try {
    const acc = { all: 0, kept: 0, after_tag: 0, inner_tag: 0, not_prompt: 0, skipped_big: 0, bad_lines: 0, examples: [] };
    walk(process.argv[2] || path.join(os.homedir(), '.claude', 'projects'), acc);
    console.log(JSON.stringify(acc));
  } catch (e) {
    console.error('precompact-paste-scan: blad narzedzia: ' + String(e && e.message || e));
    process.exit(2);
  }
}

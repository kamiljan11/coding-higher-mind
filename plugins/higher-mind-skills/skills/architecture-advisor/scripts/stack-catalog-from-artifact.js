// Wyciaga GROUPS i SCEN z artefaktu stack-picker.html do stack-data.json i generuje stack-catalog.md.
// Uzycie: node stack-catalog-from-artifact.js ../assets/stack-picker.html ../references  (zrodlo artefaktu = assets/stack-picker.html; po zmianie: publish artefaktu + ten skrypt + test_sd_matrix_lint)
// Kazda kategoria = wiersz `stack-<id>` w pg/sd-areas.json (proces architektury: kazda warstwa rozstrzygnieta).
'use strict';
const fs = require('fs');
const vm = require('vm');

const [html, outDir] = process.argv.slice(2);
const src = fs.readFileSync(html, 'utf8');
const body = src.slice(src.indexOf('var GROUPS'), src.indexOf('var state'));
const sandbox = {};
vm.runInNewContext(body + '\n;this.GROUPS = GROUPS; this.SCEN = SCEN;', sandbox);
const MARKETS = { '': 'globalnie', PL: 'Polska', EU: 'UE', IS: 'Islandia' };
const groups = sandbox.GROUPS.map((g) => ({
  name: g.name,
  cats: g.cats.map((c) => ({ id: c.id, name: c.name, ask: c.ask, usual: c.f, hard_to_reverse: !!c.ow, pg: c.pg.replace(/<\/?b>/g, '`'),
    options: c.opts.map(([name, what, when, market]) => ({ name, what, when, market: market || '' })) })),
}));
const scen = sandbox.SCEN.map((s) => ({ title: s.t, why: s.w, stack: s.s }));
const data = { verified: '2026-10-10', note: 'Skrot orientacyjny, nie cennik ani benchmark. „usual" = podpowiedz floty (owner-stack.md), nie decyzja.', groups, scenarios: scen };
fs.writeFileSync(`${outDir}/stack-data.json`, JSON.stringify(data, null, 1) + '\n');

const lines = ['# Katalog stackow — kazda warstwa po kolei (generowany)', '',
  `Zrodlo prawdy: \`stack-data.json\` (ten katalog). Stan: ${data.verified}. ${data.note}`,
  'Proces: przy nowym projekcie KAZDA kategoria nizej dostaje wiersz `stack-<id>` w `docs/architecture/obszary.md` (DECYZJA / NIE TERAZ / NIE DOTYCZY; pg/design.md G).',
  'Nic nie jest wybrane z gory; wybor spoza „zwykle u nas" = krotki ADR (`pg/design.md` E). Rynek (PL/UE/Islandia/globalnie) wybiera narzedzia lokalne.', ''];
for (const g of groups) {
  lines.push(`## ${g.name}`, '');
  for (const c of g.cats) {
    lines.push(`### ${c.name} (\`stack-${c.id}\`)${c.hard_to_reverse ? ' — trudno cofnac (drzwi jednokierunkowe pilnuja obszary SD)' : ''}`, '');
    lines.push(`Pytanie: ${c.ask} Zwykle u nas: ${c.usual.length ? c.usual.join(', ') : 'brak (zalezy od rynku/produktu)'}. PG: ${c.pg}`, '');
    lines.push('| Narzedzie | Rynek | Co to | Kiedy |', '|---|---|---|---|');
    for (const o of c.options) lines.push(`| ${o.name} | ${MARKETS[o.market]} | ${o.what} | ${o.when} |`);
    lines.push('');
  }
}
lines.push('## Przyklady: kiedy zwykly fundament (Supabase + Vercel + Resend) nie wystarcza', '', '| Przyklad | Sygnal | Zmienia |', '|---|---|---|');
const usual = new Map();
for (const g of groups) for (const c of g.cats) usual.set(c.id, c.usual);
for (const s of scen) {
  const swaps = Object.entries(s.stack).flatMap(([k, v]) => v.filter((x) => !(usual.get(k) || []).includes(x)));
  lines.push(`| ${s.title} | ${s.why} | ${swaps.join(', ') || '—'} |`);
}
fs.writeFileSync(`${outDir}/stack-catalog.md`, lines.join('\n') + '\n');
console.log(`kategorie: ${groups.reduce((n, g) => n + g.cats.length, 0)}, opcje: ${groups.reduce((n, g) => n + g.cats.reduce((m, c) => m + c.options.length, 0), 0)}, scenariusze: ${scen.length}`);

#!/usr/bin/env node
'use strict';
// pg-council: narada dzialow jako PROTOKOL, nie czat (pg/council.md; badania: Debate-or-Vote NeurIPS 2025,
// MAST, Catfish, HiddenBench, Minority Sentinel, DACI). 0 tokenow: walidacja specyfikacji decyzji, zebranie
// faktow (pool) dla catfisha, agregacja stanowisk (tally z wagami, konflikty, blockery, sentinel mniejszosci),
// render council.md + adr-draft.md z zapisanym sprzeciwem.
//
// Uzycie: node pg-council.js validate <decision.json>
//         node pg-council.js pool <run-dir>        # decision.json + position.*.json -> pool.json
//         node pg-council.js aggregate <run-dir> [--weights plik.json]   # + catfish.json -> council.json/.md, adr-draft.md
// Exit: 0 OK / consensus|majority, 1 contested|blocked (decyzja czlowieka), 2 blad specyfikacji/uzycia.
const fs = require('fs');
const os = require('os');
const path = require('path');

const SEVERITIES = new Set(['blocker', 'major', 'minor']);
const MIN_OPTIONS = 2;
const SENTINEL_CONFIDENCE = 0.8;
const SENTINEL_MIN_FACTS = 2;
const DEFAULT_WEIGHTS_FILE = path.join(os.homedir(), '.claude', 'pg', 'council-weights.json');
// Fakt ma dowod, gdy evidence wyglada na komende z wynikiem (rg/git/node/python/curl/ls/npm/psql lub strzalka wyniku).
const EVIDENCE_RX = /\b(rg|grep|git|node|python|npx|npm|curl|ls|cat|psql|supabase|vercel)\b[^\n]*(->|=>|:|\n)|exit\s*(code\s*)?\d|\d+\s*(hit|wynik|linii|plik)/i;

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (file, obj) => fs.writeFileSync(file, JSON.stringify(obj, null, 2) + '\n');

/** Specyfikacja decyzji -> lista bledow (pusta = OK). Czysta funkcja. MAST: 41,8 % porazek to specyfikacja. */
function validateDecision(d) {
  const errors = [];
  if (!d || typeof d !== 'object') return ['decision.json nie jest obiektem'];
  if (!d.id) errors.push('brak `id` (np. D-2026-09-12-qa)');
  if (!d.question || String(d.question).length < 15) errors.push('brak/za krotkie `question` (jedno pytanie, na ktore da sie odpowiedziec opcja)');
  if (!Array.isArray(d.options) || d.options.length < MIN_OPTIONS) errors.push(`\`options\` musi miec >= ${MIN_OPTIONS} pozycje (w tym status quo / „nic nie robic")`);
  else {
    const ids = new Set();
    for (const o of d.options) {
      if (!o || !o.id || !o.summary) errors.push('kazda opcja ma `id` i `summary`');
      else if (ids.has(o.id)) errors.push(`opcja ${o.id} powtorzona`);
      else ids.add(o.id);
    }
    if (!d.options.some((o) => o && /status quo|nic nie|zostaw|bez zmian|as-is|do nothing/i.test(`${o.id} ${o.summary}`))) errors.push('brak opcji status quo („nic nie robic") — bez niej narada zawsze cos zmienia');
  }
  if (!['T0', 'T1', 'T2', 'T3'].includes(d.tier)) errors.push('`tier` T0-T3 (z risk-tier.js albo osad)');
  if (typeof d.irreversible !== 'boolean') errors.push('`irreversible` true/false (czy da sie cofnac w < 1 dzien)');
  if (!Array.isArray(d.evidence_pointers) || !d.evidence_pointers.length) errors.push('`evidence_pointers` — pliki/komendy/metryki, na ktorych dzialy maja oprzec fakty');
  return errors;
}

function validatePosition(p, decision) {
  const errors = [];
  const optionIds = new Set((decision.options || []).map((o) => o.id));
  if (!p.role) errors.push('brak role');
  if (!optionIds.has(p.preferred)) errors.push(`preferred \`${p.preferred}\` nie jest opcja z decision.json`);
  if (typeof p.confidence !== 'number' || p.confidence < 0 || p.confidence > 1) errors.push('confidence 0-1');
  if (!Array.isArray(p.facts)) errors.push('facts[]');
  if (!p.would_change_mind) errors.push('would_change_mind obowiazkowe (belief preservation z powodu, nie z presji)');
  for (const r of p.risks || []) if (!SEVERITIES.has(r.severity) || !optionIds.has(r.option)) errors.push(`risk: severity blocker|major|minor i option z listy (dostalem ${r.severity}/${r.option})`);
  return errors;
}

const loadPositions = (runDir, decision) => fs.readdirSync(runDir).filter((f) => /^position\.[\w-]+\.json$/.test(f)).sort().map((f) => {
  const p = readJson(path.join(runDir, f));
  const errors = validatePosition(p, decision);
  return Object.assign(p, { _file: f, _errors: errors });
});

/** Tally = Σ waga(rola) × confidence per opcja; zwraca posortowane [{option, score, roles}]. Czysta funkcja. */
function tally(positions, weights = {}) {
  const byOption = new Map();
  for (const p of positions) {
    if (p._errors && p._errors.length) continue;
    const w = Number(weights[p.role] || 1);
    if (!byOption.has(p.preferred)) byOption.set(p.preferred, { option: p.preferred, score: 0, roles: [] });
    const t = byOption.get(p.preferred);
    t.score += w * p.confidence;
    t.roles.push({ role: p.role, confidence: p.confidence, weight: w });
  }
  return [...byOption.values()].sort((a, b) => b.score - a.score);
}

const factsWithEvidence = (p) => (p.facts || []).filter((f) => f && f.evidence && EVIDENCE_RX.test(String(f.evidence)));

/** Sentinel mniejszosci: rola poza opcja wiodaca z confidence >= 0,8 i >= 2 faktami z dowodem -> weryfikacja, nie przegrana. */
function minoritySentinel(positions, leading) {
  return positions.filter((p) => !(p._errors && p._errors.length) && p.preferred !== leading && p.confidence >= SENTINEL_CONFIDENCE && factsWithEvidence(p).length >= SENTINEL_MIN_FACTS)
    .map((p) => ({ role: p.role, option: p.preferred, confidence: p.confidence, facts: factsWithEvidence(p).length }));
}

function blockersOn(positions, option) {
  return positions.flatMap((p) => (p.risks || []).filter((r) => r.option === option && r.severity === 'blocker').map((r) => ({ role: p.role, risk: r.risk })));
}

/** Status narady i approver (DACI). Czysta funkcja. */
function decide(decision, positions, catfish, weights) {
  const valid = positions.filter((p) => !(p._errors && p._errors.length));
  const scores = tally(valid, weights);
  const leading = scores.length ? scores[0].option : null;
  const blockers = leading ? blockersOn(valid, leading) : [];
  const sentinel = leading ? minoritySentinel(valid, leading) : [];
  const dissent = valid.filter((p) => p.preferred !== leading).map((p) => ({ role: p.role, preferred: p.preferred, confidence: p.confidence, why: (p.risks || []).filter((r) => r.option === leading).map((r) => r.risk).join('; ') || (p.would_change_mind || '') }));
  let status;
  if (!leading) status = 'no-positions';
  else if (blockers.length) status = 'blocked';
  else if (sentinel.length) status = 'contested';
  else if (dissent.length === 0) status = 'consensus';
  else if (scores.length > 1 && scores[0].score - scores[1].score < 0.5) status = 'contested';
  else status = 'majority';
  const needsHuman = decision.tier === 'T3' || decision.irreversible === true || status === 'contested' || status === 'blocked' || status === 'no-positions';
  const approver = needsHuman ? 'uzytkownik' : 'orkiestrator (w granicach polityki), uzytkownik = Informed';
  const strongest = catfish && (catfish.strongest_objection || ((catfish.against_leading || {}).arguments || [])[0] && catfish.against_leading.arguments[0].argument) || null;
  return { status, leading, scores, blockers, sentinel, dissent, approver, needsHuman, strongest_objection: strongest, catfish_missing: !catfish, invalid_positions: positions.filter((p) => p._errors && p._errors.length).map((p) => ({ file: p._file, errors: p._errors })) };
}

function poolFacts(positions) {
  return positions.flatMap((p) => (p.facts || []).map((f) => ({ role: p.role, claim: f.claim, evidence: f.evidence || '', unique: !!f.unique, has_evidence: !!(f.evidence && EVIDENCE_RX.test(String(f.evidence))) })));
}

/** council.md — dla czlowieka: NAJPIERW sprzeciw, potem opcja (More Isn't Always Better). Czysta funkcja. */
function renderCouncil(decision, verdict, positions, catfish) {
  const L = [`# Narada ${decision.id} — ${verdict.status.toUpperCase()}`, '', `**Pytanie:** ${decision.question}`, '',
    `**Najmocniejszy sprzeciw (catfish):** ${verdict.strongest_objection || (verdict.catfish_missing ? 'BRAK — catfish nie zlozyl stanowiska; narada niekompletna' : 'brak')}`, ''];
  if (verdict.blockers.length) L.push(`**BLOCKER na opcji wiodacej ${verdict.leading}:** ` + verdict.blockers.map((b) => `${b.role}: ${b.risk}`).join(' · '), '');
  if (verdict.sentinel.length) L.push('**Sentinel mniejszosci (weryfikuj przed decyzja):** ' + verdict.sentinel.map((s) => `${s.role} -> ${s.option} (conf ${s.confidence}, ${s.facts} fakty z dowodem)`).join(' · '), '');
  L.push('## Opcje x dzialy', '', '| Opcja | Wynik (Σ waga×conf) | Kto |', '|---|---|---|');
  for (const s of verdict.scores) L.push(`| ${s.option} | ${s.score.toFixed(2)} | ${s.roles.map((r) => `${r.role} (${r.confidence})`).join(', ')} |`);
  L.push('', '## Fakty (unia; `unique` = wniosl tylko ten dzial)', '', '| Dzial | Fakt | Dowod | unique |', '|---|---|---|---|');
  for (const f of poolFacts(positions)) L.push(`| ${f.role} | ${f.claim} | ${f.has_evidence ? f.evidence.replace(/\|/g, '\\|').slice(0, 160) : '(bez komendy — nie liczy sie do sentinela)'} | ${f.unique ? 'tak' : ''} |`);
  if (verdict.dissent.length) { L.push('', '## Sprzeciw (zapisany imiennie — disagree and commit)'); for (const d of verdict.dissent) L.push(`- **${d.role}** woli ${d.preferred} (conf ${d.confidence}): ${d.why || '(brak uzasadnienia — pytanie do dzialu)'}`); }
  if (catfish) {
    L.push('', '## Catfish — przeciw opcji wiodacej');
    for (const a of ((catfish.against_leading || {}).arguments || [])) L.push(`- ${a.argument}${a.evidence ? ` (dowod: ${a.evidence})` : ''}`);
    if ((catfish.against_status_quo || []).length) { L.push('', '## Catfish — przeciw status quo'); for (const a of catfish.against_status_quo) L.push(`- ${a.argument}${a.evidence ? ` (dowod: ${a.evidence})` : ''}`); }
    if ((catfish.missing_facts || []).length) L.push('', '**Fakty, ktorych nikt nie wniosl:** ' + catfish.missing_facts.join(' · '));
  }
  if (verdict.invalid_positions.length) L.push('', '## Stanowiska odrzucone (schemat)', ...verdict.invalid_positions.map((i) => `- ${i.file}: ${i.errors.join('; ')}`));
  L.push('', '## DACI', `- Driver: sesja-orkiestrator · **Approver: ${verdict.approver}** · Contributors: ${positions.map((p) => p.role).join(', ')}${catfish ? ', catfish' : ''} · Informed: ADR + CHANGELOG`,
    `- Status: **${verdict.status}** -> ${verdict.needsHuman ? 'decyzja uzytkownika (T3 / nieodwracalne / spor / blocker)' : 'orkiestrator decyduje i zapisuje ADR; uzytkownik informowany'}`);
  return L.join('\n') + '\n';
}

function renderAdr(decision, verdict, positions) {
  const opt = (id) => (decision.options.find((o) => o.id === id) || {}).summary || id;
  return [`# ADR-NNNN — ${decision.question}`, '', `Data: ${new Date().toISOString().slice(0, 10)} | Status: ${verdict.needsHuman ? 'proponowane (czeka na uzytkownika)' : 'przyjete'} | Narada: ${decision.id} (${verdict.status})`, '',
    `**Kontekst:** ${decision.context || '(uzupelnij)'}`, '', `**Decyzja:** ${verdict.leading ? `${verdict.leading} — ${opt(verdict.leading)}` : '(brak stanowisk)'}`, '',
    '**Rozwazone alternatywy:** ' + decision.options.filter((o) => o.id !== verdict.leading).map((o) => `${o.id} (${o.summary})`).join('; '), '',
    '**Stanowiska dzialow:** ' + positions.map((p) => `${p.role}: ${p.preferred} (${p.confidence})`).join('; '), '',
    `**Sprzeciw + disagree-and-commit:** ${verdict.dissent.length ? verdict.dissent.map((d) => `${d.role} — ${d.why || d.preferred}`).join('; ') : 'brak sprzeciwu'}${verdict.strongest_objection ? ` · catfish: ${verdict.strongest_objection}` : ''}`, '',
    `**Konsekwencje / warunki:** ${positions.flatMap((p) => p.conditions || []).join('; ') || '(uzupelnij)'}`, '',
    `**Koszt cykliczny:** (uzupelnij) · **Jak cofnac:** ${decision.irreversible ? 'NIEODWRACALNE — dlatego Approver = uzytkownik' : '(uzupelnij)'}`, ''].join('\n');
}

function main(argv) {
  const [cmd, target, ...rest] = argv;
  if (cmd === 'validate') {
    const errors = validateDecision(readJson(target));
    if (!errors.length) { process.stdout.write('pg-council: decision.json OK\n'); return 0; }
    process.stdout.write('pg-council: specyfikacja NIEKOMPLETNA (MAST: 41,8 % porazek to specyfikacja):\n' + errors.map((e) => `  - ${e}`).join('\n') + '\n'); return 2;
  }
  if (cmd !== 'pool' && cmd !== 'aggregate') { process.stderr.write('pg-council: uzycie: validate <decision.json> | pool <run> | aggregate <run> [--weights plik]\n'); return 2; }
  const runDir = path.resolve(target || '.');
  const decision = readJson(path.join(runDir, 'decision.json'));
  const specErrors = validateDecision(decision);
  if (specErrors.length) { process.stdout.write('pg-council: decision.json niekompletny: ' + specErrors.join('; ') + '\n'); return 2; }
  const positions = loadPositions(runDir, decision);
  const wIdx = rest.indexOf('--weights');
  const weightsFile = wIdx >= 0 ? rest[wIdx + 1] : DEFAULT_WEIGHTS_FILE;
  const weights = fs.existsSync(weightsFile) ? readJson(weightsFile) : {};
  if (cmd === 'pool') {
    const scores = tally(positions, weights);
    const pool = { decision_id: decision.id, question: decision.question, options: decision.options, facts: poolFacts(positions), leading: scores.length ? scores[0].option : null, positions_count: positions.length };
    writeJson(path.join(runDir, 'pool.json'), pool);
    process.stdout.write(`pg-council: pool.json — ${pool.facts.length} faktow z ${positions.length} stanowisk, opcja wiodaca: ${pool.leading || '(brak)'}\n`);
    return 0;
  }
  const catfishFile = path.join(runDir, 'catfish.json');
  const catfish = fs.existsSync(catfishFile) ? readJson(catfishFile) : null;
  const verdict = decide(decision, positions, catfish, weights);
  writeJson(path.join(runDir, 'council.json'), Object.assign({ decision_id: decision.id }, verdict));
  fs.writeFileSync(path.join(runDir, 'council.md'), renderCouncil(decision, verdict, positions, catfish));
  fs.writeFileSync(path.join(runDir, 'adr-draft.md'), renderAdr(decision, verdict, positions));
  process.stdout.write(`pg-council: ${verdict.status} · opcja ${verdict.leading || '-'} · approver: ${verdict.approver} · sprzeciw: ${verdict.dissent.length} · sentinel: ${verdict.sentinel.length} · blockery: ${verdict.blockers.length} · catfish: ${catfish ? 'jest' : 'BRAK'} -> ${path.join(runDir, 'council.md')}\n`);
  return verdict.needsHuman ? 1 : 0;
}

module.exports = { validateDecision, validatePosition, tally, minoritySentinel, decide, poolFacts, renderCouncil, renderAdr, EVIDENCE_RX };
if (require.main === module) { try { process.exit(main(process.argv.slice(2))); } catch (e) { process.stderr.write(`pg-council: ${e.message}\n`); process.exit(2); } }

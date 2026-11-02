#!/usr/bin/env node
'use strict';
// pg-outcome: rejestr decyzji fixera po pg-review — wynik (fixed / dropped / kept_note) kazdej grupy findings, do kalibracji dzialow.
// Fala 0, M-A (pg/designs/2026-11-01-fala-0-pomiar.md §11.4). Dopisuje do
// ~/.claude/logs/review-outcomes.jsonl jeden wiersz per grupa findings z aggregated.json (outcome = fixed / dropped:<powod> / kept_note),
// zeby guard_health policzyl wskaznik „nieprzydatnych" per dzial i per rule_id (Tricorder: cel < 10 %). 0 tokenow.
// Tylko enumy, liczby i rule_id: bez claim/evidence/sciezek plikow, wiec bez ryzyka PII. Idempotentne (run_key).
//
// Uzycie: node pg-outcome.js --run <RUN> --repo <sciezka|nazwa> [--tier Tn] --decide <id>=<outcome> [<id>=<outcome> ...]
//   outcome: fixed | dropped:false_positive | dropped:out_of_scope | dropped:accepted_risk | dropped:duplicate
//            | dropped:preexisting | kept_note.   Decyzja WYMAGANA dla kazdej grupy poza decision=dropped (takze nieznanej);
//   grupy dropped (weryfikator not_reproduced) zapisuja sie same jako verifier_dropped.
// Exit: 0 zapisano (albo RUN juz zapisany), 1 brak decyzji dla wymaganej grupy (nic nie zapisane), 2 blad narzedzia/uzycia.
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const OUTCOMES = ['fixed', 'dropped:false_positive', 'dropped:out_of_scope', 'dropped:accepted_risk', 'dropped:duplicate', 'dropped:preexisting', 'kept_note'];

const SEVERITIES = ['blocker', 'major', 'minor']; // pg-aggregate.js SEVERITY_RANK
const DECISIONS = ['blocker', 'must_fix', 'note', 'dropped'];
const VERDICTS = ['reproduced', 'not_reproduced', 'cannot_run'];

// Bez zmiennej przekierowujacej (recenzja p345 security-1: TMPDIR przestawial „tmpdir”, wiec override trafial w dowolny plik).
// Testy podstawiaja HOME tymczasowy.
const logFile = () => path.join(os.homedir(), '.claude', 'logs', 'review-outcomes.jsonl');

class ToolError extends Error {}

function readJson(file, what) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch (e) { throw new ToolError(`nie moge czytac ${what}: ${file} (${e.code || e.message})`); }
  try { return JSON.parse(raw); } catch (e) { throw new ToolError(`${what} nie jest poprawnym JSON: ${file}`); }
}

// Argumenty: --decide zbiera wszystkie kolejne tokeny az do nastepnej flagi (id=outcome); mozna tez powtarzac --decide.
function parseArgs(argv) {
  const o = { decide: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--decide') {
      while (i + 1 < argv.length && !argv[i + 1].startsWith('--')) o.decide.push(argv[++i]);
    } else if (a === '--run' || a === '--repo' || a === '--tier') {
      if (i + 1 >= argv.length) throw new ToolError(`flaga ${a} wymaga wartosci`);
      o[a.slice(2)] = argv[++i];
    } else throw new ToolError(`nieznany argument: ${a}`);
  }
  if (!o.run) throw new ToolError('brak --run <katalog przebiegu z aggregated.json>');
  return o;
}

function parseDecisions(list, groups) {
  const byGroup = new Map();
  const toGroup = new Map();
  for (const g of groups) { toGroup.set(g.id, g.id); for (const m of g.member_ids || []) toGroup.set(m, g.id); }
  for (const item of list) {
    const eq = item.indexOf('=');
    if (eq <= 0) throw new ToolError(`zla decyzja '${item}' (oczekiwane <id>=<outcome>)`);
    const id = item.slice(0, eq);
    const outcome = item.slice(eq + 1);
    if (!OUTCOMES.includes(outcome)) throw new ToolError(`nieznany outcome '${outcome}' dla ${id} (dozwolone: ${OUTCOMES.join(', ')})`);
    if (!toGroup.has(id)) throw new ToolError(`nieznane id '${id}' (brak w aggregated.json.findings)`);
    const gid = toGroup.get(id);
    if (byGroup.has(gid)) throw new ToolError(`podwojna decyzja dla grupy ${gid}`);
    // blocker/must_fix zostawiony bez akcji to nie notatka: fixed albo dropped:<powod> (np. accepted_risk) — recenzja p345c code-1
    const decision = (groups.find((g) => g.id === gid) || {}).decision;
    if (outcome === 'kept_note' && (decision === 'blocker' || decision === 'must_fix')) {
      throw new ToolError(`kept_note niedozwolone dla ${gid} (decision=${decision}); uzyj fixed albo dropped:<powod>, np. dropped:accepted_risk`);
    }
    byGroup.set(gid, outcome);
  }
  return byGroup;
}

// Klucz przebiegu: katalog RUN (unikalny per recenzja, pg-review krok 0) + grupy. Ten sam RUN zapisany drugi raz = pominiety
// (takze po ponownej agregacji albo bez --repo); inny RUN z identycznymi findings = osobny wpis (recenzja p345: kolizja przy samych grupach).
const runKeyOf = (groups, runDir) => crypto.createHash('sha256')
  .update([path.resolve(String(runDir || ''))].concat(groups.map((g) => `${g.id}|${g.rule_id}|${g.file}`).sort()).join('\n'))
  .digest('hex').slice(0, 16);

// Pola pisane przez agentow: tylko znaki identyfikatora (ewentualna sciezka/dane nie przejda do rejestru).
const safeRule = (s) => String(s || '').replace(/[^A-Za-z0-9_.:-]/g, '_').slice(0, 80);
const oneOf = (v, list) => (list.includes(v) ? v : 'other');

function endsMidLine(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    if (!size) return false;
    const b = Buffer.alloc(1);
    fs.readSync(fd, b, 0, 1, size - 1);
    return b[0] !== 0x0a;
  } catch (e) { return false; } finally { if (fd !== undefined) fs.closeSync(fd); }
}

function alreadyLogged(file, runKey) {
  let raw = '';
  try { raw = fs.readFileSync(file, 'utf8'); } catch (e) { return false; }
  return raw.split('\n').some((ln) => { try { return ln && JSON.parse(ln).run_key === runKey; } catch (e) { return false; } });
}

function main(argv) {
  const o = parseArgs(argv);
  const agg = readJson(path.join(o.run, 'aggregated.json'), 'aggregated.json');
  if (!Array.isArray(agg.findings)) throw new ToolError(`aggregated.json bez tablicy findings: ${path.join(o.run, 'aggregated.json')}`);
  const groups = agg.findings;
  if (!groups.length) { console.log('pg-outcome: 0 findings w aggregated.json, nic do zapisania'); return 0; }
  for (const g of groups) {
    const miss = ['id', 'rule_id', 'severity', 'decision', 'roles', 'file'].filter((k) => g[k] === undefined || g[k] === null || g[k] === '');
    if (miss.length || !Array.isArray(g.roles)) throw new ToolError(`grupa ${g.id || '?'} w aggregated.json bez pol: ${miss.join(', ') || 'roles'}`);
  }
  const repoArg = o.repo || agg.repo || '';
  const repo = safeRule(path.basename(String(repoArg).replace(/[\\/]+$/, ''))) || 'unknown';
  const runKey = runKeyOf(groups, o.run);
  const file = logFile();
  if (alreadyLogged(file, runKey)) { console.log(`pg-outcome: RUN juz zapisany (run_key=${runKey}), pomijam`); return 0; }
  if (agg.verdict === 'INCOMPLETE' || (agg.incomplete || []).length) {
    console.error('pg-outcome: UWAGA aggregated.json jest INCOMPLETE (brak werdyktow/rol?) — zapisujesz decyzje na niepelnym wyniku');
  }
  const decided = parseDecisions(o.decide, groups);
  const ignored = groups.filter((g) => g.decision === 'dropped' && decided.has(g.id)).map((g) => g.id);
  if (ignored.length) console.error(`pg-outcome: UWAGA --decide dla grup odrzuconych przez weryfikatora pominiete (zapis = verifier_dropped): ${ignored.join(', ')}`);
  // Kazda grupa poza dropped wymaga decyzji — takze z nieznana wartoscia decision (inaczej cicho kept_note; recenzja p345d code).
  const missing = groups.filter((g) => g.decision !== 'dropped' && !decided.has(g.id)).map((g) => g.id);
  if (missing.length) {
    console.error(`pg-outcome: brak decyzji dla ${missing.length} grup: ${missing.join(', ')} — nic nie zapisano. Dodaj --decide <id>=<outcome> (${OUTCOMES.join(' | ')})`);
    return 1;
  }
  let tier = 'unknown';
  try {
    const t = JSON.parse(fs.readFileSync(path.join(o.run, 'tier.json'), 'utf8'));
    if (t && t.tier) tier = String(t.tier);
  } catch (e) {
    if (e.code !== 'ENOENT') console.error(`pg-outcome: UWAGA tier.json nieczytelny (${e.code || e.message}) — tier z --tier albo unknown`);
  }
  if (tier === 'unknown' && o.tier) tier = String(o.tier).toUpperCase();
  tier = /^T[0-3]$/.test(tier) ? tier : 'unknown';
  const ts = new Date().toISOString();
  const rows = groups.map((g) => ({
    ts, run_key: runKey, repo, tier, group_id: safeRule(g.id), roles: g.roles.map(safeRule), rule_id: safeRule(g.rule_id), severity: oneOf(g.severity, SEVERITIES),
    agreement: Number(g.agreement) || g.roles.length, decision: oneOf(g.decision, DECISIONS), verdict: g.verdict ? oneOf(g.verdict, VERDICTS) : null,
    outcome: g.decision === 'dropped' ? 'verifier_dropped' : decided.get(g.id) || 'kept_note',
  }));
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // Urwany ogon (zapis przerwany w polowie) nie moze skleic sie z pierwszym nowym wierszem (recenzja p345b data-1).
    const lead = endsMidLine(file) ? '\n' : '';
    fs.appendFileSync(file, lead + rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  } catch (e) { throw new ToolError(`nie moge zapisac ${file}: ${e.code || e.message}`); }
  console.log(`pg-outcome: zapisano ${rows.length} wierszy (repo=${repo}, tier=${tier}, run_key=${runKey}) -> ${file}`);
  return 0;
}

module.exports = { OUTCOMES, SEVERITIES, DECISIONS, VERDICTS, runKeyOf, parseArgs, parseDecisions };

if (require.main === module) {
  try { process.exit(main(process.argv.slice(2))); } catch (e) {
    if (e instanceof ToolError) { console.error(`pg-outcome: ${e.message}`); process.exit(2); }
    console.error(`pg-outcome: blad narzedzia: ${e && e.stack || e}`); process.exit(2);
  }
}

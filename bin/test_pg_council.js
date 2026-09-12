// Testy pg-council.js (narada dzialow jako protokol). Uruchom: node test_pg_council.js
'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { validateDecision, validatePosition, tally, minoritySentinel, decide, renderCouncil, renderAdr } = require(path.join(__dirname, 'pg-council.js'));

let failures = 0;
const check = (name, cond, detail) => { if (cond) console.log('ok  ', name); else { failures++; console.log('FAIL', name, detail || ''); } };

const decision = { id: 'D-test', question: 'Czy qa-reviewer ma byc obowiazkowy na T3 z UI?', context: 'x', tier: 'T2', irreversible: false,
  options: [{ id: 'A', summary: 'obowiazkowy na T3 z UI' }, { id: 'B', summary: 'status quo: opcjonalny na zadanie' }, { id: 'C', summary: 'obowiazkowy gdy CRITICAL-PATHS.md istnieje' }],
  evidence_pointers: ['hooks/lib/risk-tier.js'] };
const fact = (claim, ev, unique) => ({ claim, evidence: ev, unique: !!unique });
const pos = (role, preferred, confidence, over = {}) => Object.assign({ role, preferred, confidence, facts: [fact('f', 'rg -n x -> 3 hits')], risks: [], conditions: [], would_change_mind: 'nowy fakt', _errors: [] }, over);

// validate
check('validate: poprawna spec = 0 bledow', validateDecision(decision).length === 0, JSON.stringify(validateDecision(decision)));
check('validate: brak status quo = blad', validateDecision(Object.assign({}, decision, { options: [{ id: 'A', summary: 'x' }, { id: 'B', summary: 'y' }] })).some((e) => /status quo/.test(e)));
check('validate: 1 opcja = blad', validateDecision(Object.assign({}, decision, { options: [{ id: 'A', summary: 'status quo' }] })).some((e) => />= 2/.test(e)));
check('validate: brak irreversible/evidence = bledy', validateDecision({ id: 'x', question: 'dlugie pytanie o cos tam?', options: decision.options, tier: 'T2' }).length === 2);
check('validatePosition: preferred spoza listy + brak would_change_mind', validatePosition({ role: 'ops', preferred: 'Z', confidence: 0.5, facts: [] }, decision).length === 2);

// tally + wagi
const t = tally([pos('code', 'A', 0.6), pos('ops', 'B', 0.9), pos('ux', 'A', 0.7)], { ops: 2 });
check('tally: wagi × confidence, sortowanie', t[0].option === 'B' && Math.abs(t[0].score - 1.8) < 1e-9 && Math.abs(t[1].score - 1.3) < 1e-9, JSON.stringify(t));

// sentinel
const sent = minoritySentinel([pos('code', 'A', 0.6), pos('security', 'C', 0.9, { facts: [fact('a', 'node ~/.claude/bin/x.js -> exit 1', true), fact('b', 'rg -n y src -> 0 hits')] })], 'A');
check('sentinel: mniejszosc conf>=0.8 z 2 faktami z komenda = flaga', sent.length === 1 && sent[0].role === 'security');
check('sentinel: fakty bez komendy nie licza sie', minoritySentinel([pos('security', 'C', 0.9, { facts: [fact('a', 'moim zdaniem'), fact('b', 'wydaje sie')] })], 'A').length === 0);

// decide: statusy
const consensus = decide(decision, [pos('code', 'A', 0.7), pos('ops', 'A', 0.8)], { strongest_objection: 'koszt tokenow' }, {});
check('decide: consensus + T2 odwracalne => orkiestrator', consensus.status === 'consensus' && !consensus.needsHuman && /orkiestrator/.test(consensus.approver) && consensus.strongest_objection === 'koszt tokenow');
const majority = decide(decision, [pos('code', 'A', 0.9), pos('ops', 'A', 0.9), pos('ux', 'B', 0.4)], null, {});
check('decide: majority z zapisanym sprzeciwem + brak catfisha = catfish_missing', majority.status === 'majority' && majority.dissent.length === 1 && majority.dissent[0].role === 'ux' && majority.catfish_missing);
const contested = decide(decision, [pos('code', 'A', 0.6), pos('ops', 'B', 0.6)], null, {});
check('decide: remis (roznica < 0.5) = contested => uzytkownik', contested.status === 'contested' && contested.approver === 'uzytkownik');
const blocked = decide(decision, [pos('code', 'A', 0.9), pos('security', 'A', 0.5, { risks: [{ option: 'A', risk: 'sekret w screenshotach', severity: 'blocker' }] })], null, {});
check('decide: blocker dzialu na opcji wiodacej = blocked', blocked.status === 'blocked' && blocked.blockers[0].role === 'security');
const t3 = decide(Object.assign({}, decision, { tier: 'T3' }), [pos('code', 'A', 0.9), pos('ops', 'A', 0.9)], null, {});
check('decide: T3 zawsze uzytkownik nawet przy consensus', t3.status === 'consensus' && t3.needsHuman && t3.approver === 'uzytkownik');
const invalid = decide(decision, [pos('code', 'A', 0.9), Object.assign(pos('ops', 'A', 0.9), { _errors: ['zly schemat'], _file: 'position.ops.json' })], null, {});
check('decide: stanowisko ze zlym schematem nie liczy sie, ale jest wypisane', invalid.scores[0].roles.length === 1 && invalid.invalid_positions.length === 1);

// render
const md = renderCouncil(decision, majority, [pos('code', 'A', 0.9), pos('ops', 'A', 0.9), pos('ux', 'B', 0.4)], { strongest_objection: 'UI bez apki = teatr', against_leading: { option: 'A', arguments: [{ argument: 'koszt', evidence: 'x' }] }, against_status_quo: [], missing_facts: ['ile trwa qa-matrix'] });
check('render: sprzeciw i catfish PRZED tabela opcji, DACI na koncu', md.indexOf('Najmocniejszy sprzeciw') < md.indexOf('## Opcje x dzialy') && /\*\*ux\*\* woli B/.test(md) && /Approver: orkiestrator/.test(md) && /ile trwa qa-matrix/.test(md));
const adr = renderAdr(decision, majority, [pos('code', 'A', 0.9), pos('ux', 'B', 0.4)]);
check('render ADR: decyzja, alternatywy, sprzeciw', /\*\*Decyzja:\*\* A/.test(adr) && /B \(status quo/.test(adr) && /ux — /.test(adr));

// CLI end-to-end
const run = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-council-'));
fs.writeFileSync(path.join(run, 'decision.json'), JSON.stringify(decision));
fs.writeFileSync(path.join(run, 'position.code.json'), JSON.stringify(pos('code', 'A', 0.8)));
fs.writeFileSync(path.join(run, 'position.ops.json'), JSON.stringify(pos('ops', 'A', 0.7)));
const cli = (args) => spawnSync('node', [path.join(__dirname, 'pg-council.js'), ...args], { encoding: 'utf8' });
check('CLI validate => 0', cli(['validate', path.join(run, 'decision.json')]).status === 0);
const pool = cli(['pool', run]);
check('CLI pool => pool.json z opcja wiodaca', pool.status === 0 && fs.existsSync(path.join(run, 'pool.json')) && JSON.parse(fs.readFileSync(path.join(run, 'pool.json'), 'utf8')).leading === 'A');
fs.writeFileSync(path.join(run, 'catfish.json'), JSON.stringify({ role: 'catfish', strongest_objection: 'x', against_leading: { option: 'A', arguments: [] }, against_status_quo: [], missing_facts: [] }));
const agg = cli(['aggregate', run]);
check('CLI aggregate: consensus T2 => exit 0, council.md + adr-draft.md', agg.status === 0 && /consensus/.test(agg.stdout) && fs.existsSync(path.join(run, 'council.md')) && fs.existsSync(path.join(run, 'adr-draft.md')), agg.stdout + agg.stderr);
fs.writeFileSync(path.join(run, 'position.security.json'), JSON.stringify(pos('security', 'B', 0.9, { facts: [fact('a', 'node x -> exit 1'), fact('b', 'rg y -> 2 hits')] })));
const agg2 = cli(['aggregate', run]);
check('CLI aggregate: sentinel mniejszosci => contested, exit 1', agg2.status === 1 && /contested/.test(agg2.stdout), agg2.stdout);
fs.writeFileSync(path.join(run, 'decision.json'), JSON.stringify(Object.assign({}, decision, { options: [{ id: 'A', summary: 'x' }] })));
check('CLI aggregate: zla spec => exit 2', cli(['aggregate', run]).status === 2);
fs.rmSync(run, { recursive: true, force: true });

console.log(failures ? `TESTY: ${failures} FAIL` : 'TESTY: wszystkie OK');
process.exit(failures ? 1 : 0);

// Szablon Workflow dla gauntlet-build. Wklej do Workflow({script}) po podmianie UNITS/BAR/CMDS.
// Plain JS (nie TS). Brak Date.now()/Math.random(). Domyślnie pipeline(); barierę tylko w integracji.
export const meta = {
  name: 'gauntlet-build',
  description: 'Spec → jednostki → builder/krytyk/weryfikator/fix → integracja (cap rund)',
  phases: [
    { title: 'Build' }, { title: 'Gate' }, { title: 'Critique' }, { title: 'Verify' }, { title: 'Fix' }, { title: 'Integrate' },
  ],
}

// ---- KONFIGURACJA (podmień) ----
const SPEC = args?.spec ?? 'docs/SPEC.md'
const REPO = args?.repo ?? '.'
const BAR = args?.bar ?? 'testy zielone + preview działa + wzorzec z repo'
const MAX_ROUNDS = args?.maxRounds ?? 3
const UNITS = args?.units ?? [
  // { id: 'U1', scope: 'migracja 1: DDL + RLS', files: ['supabase/migrations/…'], lenses: ['dev','security'], accept: ['npx supabase db reset --local', 'npx pgtap …'], dependsOn: [] },
]
const LENS_HINTS = {
  dev: 'DDL/FK/CHECK vs RPC, współbieżność, RLS+granty (obejście RPC), kolejność triggerów, zaokrąglenia (policz), fakty o repo',
  system: 'procesy dnia 2, SPOF, granice systemu, mierniki, sprzeczności faz, parametry w czasie',
  security: 'IDOR, USING bez WITH CHECK, DEFINER+EXECUTE, TOCTOU, PII, sekrety, rate limit',
  legal: 'każde twierdzenie z § i źródłem; wymogi bez pokrycia; błędne atrybucje',
  ux: 'ścieżka użytkownika, stany błędów, offline, druk',
  regression: 'poprawki vs reszta; nazwy/pola/statusy niespójne; decyzje nietykalne',
  completeness: 'co musi istnieć dnia 1, a nie istnieje',
}

const FINDINGS = { type: 'object', properties: { findings: { type: 'array', items: { type: 'object', properties: {
  severity: { type: 'string', enum: ['high', 'med', 'low'] }, lens: { type: 'string' }, claim: { type: 'string' },
  evidence: { type: 'string' }, fix: { type: 'string' } }, required: ['severity', 'claim', 'evidence', 'fix'] } },
  keep: { type: 'array', items: { type: 'string' } } }, required: ['findings'] }
const VERDICT = { type: 'object', properties: { refuted: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['refuted', 'evidence'] }
const GATE = { type: 'object', properties: { green: { type: 'boolean' }, log: { type: 'string' } }, required: ['green'] }

const builderPrompt = (u) => `Builder jednostki ${u.id}: ${u.scope}. Spec: ${SPEC}. Repo: ${REPO}. Pliki własne: ${u.files.join(', ')}.
Poprzeczka: ${BAR}. Akceptacja: ${u.accept.join(' && ')}. Grep first, atomowe zmiany, testy w tej samej zmianie, zero sekretów,
nie ruszaj auth/RLS/migracji spoza zakresu. Uruchom akceptację, popraw aż zielone (max 5 prób). Zwróć pliki, komendy+exit codes, pominięcia, blockery.`
const gatePrompt = (u) => `Uruchom DOKŁADNIE: ${u.accept.join(' && ')} w ${REPO}. Nic nie naprawiaj. Zwróć green=true tylko przy exit 0 wszystkich; log = ostatnie 40 linii.`
const criticPrompt = (u, lens) => `Krytyk (${lens}) ze świeżym kontekstem. Załóż, że jednostka ${u.id} (${u.scope}, pliki ${u.files.join(', ')}) MA błędy.
Spec: ${SPEC}. Szukaj: ${LENS_HINTS[lens]}. Każdy finding: severity, teza, dowód (plik:linia/cytat/§), poprawka. Max 12. Zero pochwał.
W 'keep' podaj 3 rzeczy poprawne i nieoczywiste — nie psuć.`
const verifyPrompt = (f, u) => `Weryfikator. Obal finding o ${u.id}: "${f.claim}" (dowód autora: ${f.evidence}). Otwórz pliki/§, policz, uruchom. Domyślnie refuted=true bez własnego dowodu.`
const fixPrompt = (u, fs, keep) => `Fixer jednostki ${u.id}. Napraw TYLKO: ${fs.map((f) => `[${f.severity}] ${f.claim} → ${f.fix}`).join('\n')}.
Nie psuj: ${keep.join('; ')}. Atomowe zmiany + testy. Uruchom ${u.accept.join(' && ')}. Zwróć diff-summary + exit codes; decyzje ludzkie → blockery.`

// ---- PĘTLA JEDNOSTKI ----
async function runUnit(u) {
  let report = { id: u.id, rounds: [], status: 'blocked' }
  await agent(builderPrompt(u), { label: `build:${u.id}`, phase: 'Build', model: 'sonnet' })
  for (let r = 1; r <= MAX_ROUNDS; r++) {
    const gate = await agent(gatePrompt(u), { label: `gate:${u.id}#${r}`, phase: 'Gate', schema: GATE, effort: 'low' })
    if (!gate?.green) { await agent(fixPrompt(u, [{ severity: 'high', claim: 'bramki czerwone', fix: gate?.log ?? '' }], []), { label: `fix-gate:${u.id}#${r}`, phase: 'Fix', model: 'sonnet' }); continue }
    const crit = (await parallel(u.lenses.map((lens) => () => agent(criticPrompt(u, lens), { label: `critic:${lens}:${u.id}#${r}`, phase: 'Critique', schema: FINDINGS, effort: 'high' })))).filter(Boolean)
    const keep = crit.flatMap((c) => c.keep ?? [])
    const cand = crit.flatMap((c) => c.findings).filter((f) => f.severity !== 'low')
    const verified = (await parallel(cand.map((f) => () => agent(verifyPrompt(f, u), { label: `verify:${u.id}#${r}`, phase: 'Verify', schema: VERDICT, effort: 'high' }).then((v) => ({ f, v }))))).filter(Boolean).filter((x) => x.v && !x.v.refuted).map((x) => x.f)
    report.rounds.push({ r, found: cand.length, verified: verified.length })
    log(`${u.id} runda ${r}: ${cand.length} findingów, ${verified.length} zweryfikowanych`)
    if (verified.length === 0) { report.status = 'done'; break }
    await agent(fixPrompt(u, verified, keep), { label: `fix:${u.id}#${r}`, phase: 'Fix', model: 'sonnet' })
  }
  return report
}

// ---- ORKIESTRACJA: pipeline po jednostkach niezależnych; zależne czekają na rodziców ----
const done = new Set()
const ready = () => UNITS.filter((u) => !done.has(u.id) && (u.dependsOn ?? []).every((d) => done.has(d)))
const reports = []
while (done.size < UNITS.length) {
  const batch = ready()
  if (!batch.length) { log('cykl zależności / blokada — przerywam'); break }
  const res = (await parallel(batch.map((u) => () => runUnit(u)))).filter(Boolean)
  res.forEach((rep) => { reports.push(rep); done.add(rep.id) })
}

// ---- INTEGRACJA (bariera uzasadniona: potrzebne wszystkie jednostki) ----
phase('Integrate')
const integ = await parallel([
  () => agent(`Krytyk integracyjny: jednostki ${UNITS.map((u) => u.id + ':' + u.scope).join('; ')}. Spec ${SPEC}. Sprzeczności między jednostkami, luki łączące, kolejność migracji. Format findingów.`, { schema: FINDINGS, effort: 'high' }),
  () => agent(`Completeness critic: co musi istnieć dnia 1, żeby całość działała, a nie istnieje w ${REPO}? Spec ${SPEC}. Format findingów.`, { schema: FINDINGS, effort: 'high' }),
  () => agent(`Uruchom pełne bramki repo (build, lint, typy, wszystkie testy). Nic nie naprawiaj. green tylko przy exit 0.`, { schema: GATE, effort: 'low' }),
])
return { reports, integration: integ }

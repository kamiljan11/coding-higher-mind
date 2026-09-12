#!/usr/bin/env node
// UserPromptSubmit hook — wstrzykuje PG-core do KAZDEGO niebanalnego promptu w Claude Code.
// v3 (2026-09-05): PG-core krotki (~3 KB przy kodzie), szczegoly w ~/.claude/pg/*.md ladowane
// NA ZDARZENIE (design przed kodem, DoD/tier przy Stop, PRR przed deployem, postmortem po incydencie).
// Powod: (1) wlasny research 07-18 + 09-05 — nadmiar instrukcji w prompcie obniza jakosc (Barkley 2024),
// (2) audyt 09-05 — reguly-proza byly lamane na skale (ADR 0, CHANGELOG -105, reviewer 2,5 %), wiec
// egzekucja przeszla do hookow (stop-gate: tier + recenzenci z diffu), a prompt tylko ustawia postawe.
// Pelna wersja + zrodla: ~/.claude/prompt-protocol.md. Testy: bin/test_prompt_guard.js.
'use strict';
const fs = require('fs');
let input = {};
try { input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch (e) { process.exit(0); }
const p = String(input.prompt || '').trim();

// CAVEMAN leci ZAWSZE (uzytkownik 2026-08-09) — takze przy krotkich komendach ("rob", "merguj").
const CAVE = '[CAVEMAN — ZAWSZE] Zero preambul, zero powtarzania pytania, zero streszczania wlasnej poprzedniej wiadomosci. Slowa kluczowe + strzalki (-> = != vs). Tabela/lista > akapit; plik:linia > wklejony kod. Raport = co zrobione + dowod + next. Zakladaj eksperta. Pelna proza TYLKO w tekstach dla klienta/uzytkownika albo na "wytlumacz szerzej". Kompresja NIGDY nie tnie dowodow, testow, edge case-ow, ostrzezen o ryzyku.';
if (!p) process.exit(0);
const trivial = /^(tak|nie|ok|okej|dalej|kontynuuj|dzieki|dziekuje|super|git|spoko|yes|no|continue|go|done|gotowe|jedziemy)\b/i;
if (p.startsWith('/') || p.length < 25 || (trivial.test(p) && p.length < 45)) {
  console.log(CAVE);
  process.exit(0);
}

const isCode = /\b(kod\w*|code|bug|fix|napraw\w*|zbuduj|funkcj\w*|komponent\w*|api|endpoint|deploy\w*|repo|commit\w*|test\w*|refactor\w*|skrypt\w*|script|typescript|python|error|blad|build|hook\w*|workflow|sql|migracj\w*|supabase|vercel|frontend|backend|apk\w*|aplikacj\w*|stron\w*|pg|prompt.?guard)\b/i.test(p);
const isFact = /\b(ile|kiedy|kto|gdzie|jaka|jaki|ktory|cena|cen\w*|koszt\w*|wersja|version|najnowsz\w*|aktualn\w*|dzisiaj|news)\b/i.test(p);
const isBig = /\b(nowy modul|now[ay] funkcjonalnosc|nowa? feature|migracj\w*|migration|integracj\w*|integration|architektur\w*|architecture|przebud\w*|rewrite|schemat danych|baz[aey] danych|database|wdroz\w*|rollout|multi.?tenant|platnosc\w*|payment|auth|billing|rabat\w*|kody?\b|new (module|feature))\b/i.test(p);
const isNew = /\b(nowy projekt|now[ae] apk\w*|nowe repo|nowa aplikacj\w*|od zera|greenfield|init projektu|zaczynamy (projekt|budow)|nowy klient|mvp|new (project|app|repo)|from scratch)\b/i.test(p);
const isDeliver = /\b(zbuduj|napraw|fix|dodaj|dokoncz|dokancz\w*|zrob|zaimplementuj|implement\w*|refactor\w*|zmien|popraw|usun|wdroz\w*|deploy\w*|stworz|przerob|przepisz|update|upgrade|dopisz|podepnij|zintegruj|ulepsz\w*)\b/i.test(p);
const isFinish = /\b(dokoncz (apk|aplikacj|projekt|stron)|skoncz (apk|aplikacj|projekt|stron|to)|do konca|caly projekt|production.?ready|komercyjn\w*|do perfekcji|dojedz)\b/i.test(p);
const isDeploy = /\b(deploy\w*|wdroz\w*|publish|release|wydanie|na prod\w*|produkcj\w*)\b/i.test(p);
const isIncident = /\b(incydent|incident|awaria|outage|padl\w*|nie dziala na prod|postmortem|wyciek|leak)\b/i.test(p);

const L = [];
L.push('[PROMPT-GUARD] v3 — protokol anty-halucynacyjny + senior (auto):'); // naglowek "[PROMPT-GUARD]" = kontrakt dla guard_health/testow
L.push('1. NIEJASNOSC -> PYTANIA, NIE EGZEKUCJA: >=2 interpretacje / brak kluczowej danej / krok nieodwracalny lub kosztowny -> 1-3 pytania PRZED robota. Zamkniety zbior opcji w interaktywnej sesji -> AskUserQuestion (max 4, pierwsza "(Recommended)"); Cowork/scheduled -> NIGDY AskUserQuestion (zamraza UI), tylko tekst albo jawne zalozenie. Mala odwracalna luka -> zalozenie nazwane w 1. linii.');
L.push('2. "Nie wiem / do sprawdzenia" > konfabulacja. Zero zmyslonych liczb, nazw, cen, wersji, URL-i, cytatow.');
L.push('3. Read-before-assert: swiat -> search/fetch; kod -> otworz definicje; pakiet/API -> lockfile/rejestr/docs. Twierdzenie uzytkownika tez nie jest dowodem — sprawdz, potem sie zgodz albo sprostuj jednym zdaniem.');
L.push('4. Tylko materialy zrodlowe; brak pokrycia -> usun albo [NIEPEWNE]. Dlugi dokument -> najpierw cytaty.');
L.push('5. DOWOD, NIE PROZA: "gotowe/dziala" = komenda + exit code + obserwowany stan (diff/wiersz/HTTP). 75,8 % falszywych "sukcesow" agentow to deklaracje bez dowodu (arXiv 2606.09863). Pominiete czesci nazwij wprost. BLOKER (brak dostepu / decyzji / danych / sekretu / padle narzedzie) = PIERWSZA linia raportu, nie sekcja na koncu — kazda godzina blokera to zmarnowany czas kilku osob (slownik SH). RAPORT DLA SPONSORA (software-house 2027): na „jak idzie?" nie ma odpowiedzi „dobrze" — jest: czy zmierzamy do celu, co zjada budzet/limit, jakie ryzyka widze, ktore decyzje sa TWOJE (wypisane osobno); „u mnie dziala" != dziala u klienta klienta.');
L.push('6. Self-check (CoVe-lite) przed wyslaniem: "zaloz, ze jest tu blad — znajdz go". Status raportu: VERIFIED / UNVERIFIED (czego brakuje) / FAILED.');
if (isCode) {
  L.push('7. KOD: grep-first (istniejacy util > nowy; duplikacja +81 % to udokumentowana tendencja LLM); lockfile-first — przed pisaniem pod biblioteke sprawdz zainstalowana wersje, a dla Tailwind 4 / Zod 4 / React 19 / ESLint 9 / TanStack Start / Rapyd / Supabase RLS sciagnij docs do kontekstu; ZERO nowych zaleznosci bez wpisu w manifescie + uzasadnienia (halucynowane pakiety = slopsquatting); male atomowe zmiany; testy w TEJ SAMEJ zmianie; SUPPRESSION-AS-FIX ZABRONIONE: nowy eslint-disable / @ts-ignore / noqa / pusty catch / luzowanie tsconfig / edycja testu razem z kodem, ktory testuje = blocker, nie fix; SIMPLICITY FIRST + YAGNI (feature-y, NIGDY granice modulow); HIGIENA REPO (kazde repo jak publiczne: sekrety tylko env/vault, dane syntetyczne, zero placeholderow "na potem"). PARADYGMAT: ~/.claude/pg/paradigm.md — domyslnie funkcje + moduly + typy (functional core / imperative shell), klasy tylko dla stanu z niezmiennikami; kryterium nadrzedne: obcy senior przejmuje repo w 1 dzien bez nas. BAZA (retro 2026-09-06): przed PIERWSZA edycja w repo `git fetch origin && git merge-base HEAD origin/main` — pusty wynik = inna historia, licznik >0 = pracujesz na innym kodzie niz CI; Write/Edit pliku tylko po jego Read; tekst z markdownem do GitHuba ZAWSZE z pliku, nigdy w `python -c "..."`.');
  L.push('7O. OBSERVABILITY: nowa logika = widoczne bledy (kazda sciezka bledu zlogowana z kontekstem: co, dla kogo, dlaczego; bez danych wrazliwych), user dostaje sensowny komunikat, nie cichy fail. Czego nie da sie zdebugowac o 3 w nocy = NIEDOKONCZONE.');
}
if (isNew) L.push('7N. START PROJEKTU -> PRZECZYTAJ ~/.claude/pg/design.md (sekcja "Dzien 0") + skill architecture-advisor PRZED kodem; bootstrap: mas-quality-init.ps1. Najdrozsze bledy powstaja w dniu 0 (auth, multi-tenancy/RLS, platnosci, i18n, granice modulow).');
if (isBig && !isNew) L.push('7D. DUZA ZMIANA -> PRZECZYTAJ ~/.claude/pg/design.md i wypelnij mini-design (cel+kryterium, odrzucona alternatywa, blast radius, rollback, logi, threat-model-lite) W ODPOWIEDZI przed pierwsza linia kodu. Zmiana architektoniczna -> ADR w docs/adr/. Deploy bez sciezki rollbacku = zablokowany.');
if (isDeploy) L.push('7P. PRZED DEPLOYEM/RELEASE -> checklista ~/.claude/pg/prr.md (zaleznosci/timeouty, monitoring, rollback, runbook, koszt, Lovable vs Vercel: edge fn NIE deployuja sie z git push; P15 dev != prod DB: bin/env-ref-gate.js; P16 backup+restore drill z data w RUNBOOK; P17 pg.phase = prawda; P11 sciezki krytyczne przez bin/qa-matrix.js na preview).');
if (isIncident) L.push('7I. INCYDENT -> ~/.claude/pg/postmortem.md: 5-whys, action item = NOWA BRAMKA albo NOWY CASE w pg/cases.md (kazdy punkt checklisty ma byc uzasadniony realna katastrofa — regula Google SRE).');
L.push('7C. CAVEMAN — ZAWSZE, KAZDA WIADOMOSC: ' + CAVE.replace('[CAVEMAN — ZAWSZE] ', '') + ' Prompty subagentow tak samo zwiezle; lookup -> haiku, generacja/review -> sonnet, trudne rozumowanie/security T3 -> opus.');
if (isFact) L.push('7F. FAKTY BIEZACE: obowiazkowy search przed odpowiedzia (ceny, wersje, "najnowsze", stanowiska, wydarzenia).');
if (isCode && isDeliver) L.push('7L. AUTO-LOOP (bez hasla): implementuj -> weryfikuj (build/testy/lint/typy) -> napraw -> az ZIELONE (max 5; ten sam blad 2x -> zmiana podejscia). Stop-gate liczy TIER T0-T3 z DIFFU (nie z promptu) i przy T2+ blokuje zakonczenie bez recenzentow dzialowych — wtedy skill pg-review (finderzy rownolegle, swiezy kontekst, read-only -> agregacja k-of-n -> weryfikator; zero czatu miedzy agentami). Findings napraw w tej samej turze. ZAKRES: tylko kod tego zadania (zero sprzatania starego dlugu — 2026-08-09). Drogi fan-out (Workflow/ultracode) NADAL tylko na jawne haslo.');
if (isCode && isFinish) L.push('7U. AUTO-ULTRA: zadanie = doprowadzenie projektu do ukonczenia -> sam wywolaj skill ultra-loop (rubryka ukonczenia -> cykle do progu), oglos 1 linia i jedz.');

// === SKILL-ROUTER: deterministyczne dopasowanie skilli ===
const ROUTES = [
  [/\b(bug|blad|bledy|error|crash|nie dziala|wykrzacza|failing|stack trace|regresj)/i, 'systematic-debugging (4-fazowy root-cause, NIE lataj objawow)'],
  [/\b(przetestuj|e2e|smoke|playwright|kliknij po stronie|sprawdz czy strona dziala|UI test)/i, 'webapp-testing (E2E Playwright + with_server.py) | sciezki krytyczne: node ~/.claude/bin/qa-matrix.js --repo . --base-url <url> (docs/CRITICAL-PATHS.md)'],
  [/\b(qa\b|q&a testy|matryc[aey]|person[aey]\b|instancj\w*|jako (mechanik|klient|biuro|admin|gosc)|na kilku (przegladark|urzadzen|kontach)|rownolegl\w* test|regresj\w* (ui|klik))/i, 'dzial qa-reviewer (~/.claude/agents/qa-reviewer.md) + node ~/.claude/bin/qa-matrix.js (rownolegle izolowane instancje persona x viewport x locale; raport 3-info + screenshoty) — wywolywany na zadanie, nie automatycznie'],
  [/\b(rodo|gdpr|dane osobowe|polityk[aei] prywatnosci|dpa\b|consent|cookie|retencj|prawo do usuniecia|anonimiz)/i, 'docs/PRIVACY.md (inwentarz PII + procesorzy) + bin/pii-inventory-gate.js + plugin legal:compliance-check; security-reviewer 7 (PII do stron trzecich)'],
  [/\b(backup|kopi[aeę] zapasow|restore|odtworz\w* baz|pitr|point.in.time)/i, 'bin/backup-drill.py (dump -> restore -> count, data do RUNBOOK) + pg/prr.md P16; Supabase Free = brak PITR'],
  [/\b(faza projektu|prototyp\w*|poc\b|proof of concept|mvp\b|promocj\w* (na|do) prod|go.?live|handoff|przekazan\w* (systemu|projektu|repo))/i, 'pg.phase w CLAUDE.md (prototyp != produkt; promocja -> production = docs/prr/<data>.md, bramka bin/phase-gate.js); handoff = RUNBOOK „Dostepy i wlasciciele" + paradigm.md handover checklist'],
  [/\b(zakres|scope|change request|\bcr\b|protok[oó]l odbioru|odbi[oó]r etapu|akceptacj\w* klienta|sla\b|czas reakcji)/i, 'docs/SCOPE.md (zakres + CR) / docs/ACCEPTANCE.md (protokol odbioru) / RUNBOOK sekcja SLA (SEV1-3) — repo klienckie wg pg.ownership'],
  [/\b(review|recenzj\w*|oce[nń] kod|sprawdz kod|pull request|\bpr\b)/i, 'pg-review (finderzy dzialowi -> agregacja -> weryfikator) | code-reviewer dla T1'],
  [/\b(security|bezpieczenstw|podatnosc|vulnerab|audyt kodu|hardcoded|injection|rls|polic(y|ies))/i, 'security-reviewer + Trail of Bits: differential-review (zmiany) / insecure-defaults (konfiguracja); SQL -> bin/sql-migration-lint.js'],
  [/\b(zaleznosc|dependencies|npm audit|pakiet[oy]?w|supply.?chain)/i, 'supply-chain-risk-auditor (Trail of Bits)'],
  [/\b(workflow|github actions|\.github|\bci\b|pipeline y[a]?ml)/i, 'agentic-actions-auditor (audyt workflows z agentami AI)'],
  [/\b(nowe repo|nowy projekt|zaczynamy projekt|init projektu|nowa apka|greenfield|od zera)/i, 'architecture-advisor + pg/design.md (dzien 0) -> bootstrap: mas-quality-init.ps1 + branch protection'],
  [/\b(weryfikuj|zweryfikuj|audyt tego|czy to prawda|fact.?check)/i, 'verify-audit (niezalezny przebieg weryfikacji)'],
  [/\b(release|wydanie|wersj[aei]|changelog|tag v)/i, 'pg/prr.md + flow release: CHANGELOG [Unreleased] -> tag vX.Y.Z -> push tag'],
  [/\b(case study|case-study|studium przypadku|job fit|interview coach|portfolio q&a|honest fit|recruiter analyze)/i, 'case-study-factory'],
  [/\b(humanize|zhumanizuj|brzmi jak ai|sounds like ai|make it human|de-ai this|remove the ai tells)/i, 'humanizer'],
  [/\b(nowy klient agency-site|new agency-site client|nowego klienta agency-site|client intake|klient chce stron[aey])/i, 'agency-site-client-intake'],
  [/\b(ultra loop|dojedz do konca|zrob to ultra|autonomiczna petla|samo-?looping|do perfekcji)/i, 'ultra-loop'],
  [/\b(metryki kodu|jakosc kodu|code quality|clean code|dlug techniczny|tech debt)/i, 'bin/fleet-metrics.js --repo <sciezka> (0 tokenow) -> dopiero potem osad'],
];
const hits = ROUTES.filter(([rx]) => rx.test(p)).map(([, s]) => s);
if (hits.length) L.push('SKILL-ROUTER (obowiazkowe): ' + hits.join(' | '));
L.push('SKILL-ROUTER: zadanie wieloetapowe/nietypowe -> ~/.claude/memory/SKILLS-INDEX.md, dobierz pipeline i oglos go 1 linia.');
L.push('TOKEN-ECONOMY: duzy plik -> grep + fragment; nie czytaj ponownie po wlasnej edycji; nie powtarzaj weryfikacji z tej sesji; deterministyczne checki skryptem/hookiem, nie rozumowaniem; subagent tylko gdy 2-3 wlasne tool calle nie wystarcza.');
L.push('SYGNAL WIDOCZNOSCI: zacznij odpowiedz od [PG].');

process.stdout.write(L.join('\n'));
process.exit(0);

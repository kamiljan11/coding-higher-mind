# PG · COUNCIL — narada dzialow i wspolne decydowanie (2026-09-12)

Cel (uzytkownik, 2026-09-12): PG ma dzialac jak caly software house — dzialy naradzaja sie i decyduja WSPOLNIE.
Ograniczenie z badan: „naradzanie sie" LLM-ow w wolnej dyskusji NIE poprawia decyzji, a psuje je konformizmem.
Dlatego narada w PG to PROTOKOL (fakty -> stanowiska -> dysydent -> agregacja w kodzie -> decyzja z zapisanym
sprzeciwem), nie czat miedzy agentami. Recenzja diffu (`pg-review`) zostaje osobno: findery + agregacja k-of-n.

## Co mowia zrodla (probka: 10; twierdzenia z liczbami, nie opinie)

| # | Zrodlo | Ustalenie | Konsekwencja dla protokolu |
|---|---|---|---|
| 1 | Debate or Vote (NeurIPS 2025, arXiv 2508.17536) | glosowanie wiekszosciowe ≈ multi-agent debate (Qwen2.5-7B: vote 0,769 vs MAD T=2 0,738, T=5 0,705); wiecej rund = gorzej; topologia scentralizowana najgorsza (0,655); heterogeniczne persony = umiarkowany zysk; „belief preservation" pomaga | stanowiska NIEZALEZNE + agregacja w kodzie; max 1 runda korekty; zero „przewodniczacego", ktory steruje; role heterogeniczne (dzialy) |
| 2 | Too Polite to Disagree (arXiv 2604.02668) | sykofancja rozchodzi sie w dyskusji; wagi wiarygodnosci (ranking sykofancji) +10,5 p.p. trafnosci wiekszosci (80,4 -> 90,9 %); ranking 4-stopniowy > binarny | wagi rol w agregacji (`pg/council-weights.json`, domyslnie 1; kalibracja z `scheduled-tasks/pg-reviewer-calibration`) |
| 3 | Do as We Do (arXiv 2501.13381) | konformizm do BLEDNEJ wiekszosci do 69,9 % (Llama3-70B, wiekszosc 6); samotny dysydent najczesciej zmienia zdanie po refleksji | dzialy NIE widza cudzych stanowisk przed zlozeniem wlasnego; sprzeciw jest ZAPISYWANY, nie „godzony" |
| 4 | Minority Sentinel (arXiv 2606.29270) | mniejszosc bywa prawdziwa, gdy bledy agentow sa skorelowane; sygnaly: pewnosc + jakosc dowodow + wzorzec zgody | regula sentinela: mniejszosc z confidence >= 0,8 i >= 2 faktami z komendami = `needs_verification`, nie przegrana |
| 5 | Silence is Not Consensus / Catfish (arXiv 2505.21503) | „cicha zgoda" = 62-68 % porazek grup agentow; wstrzykniety dysydent: +12,7 p.p., cicha zgoda 64 % -> 17 % | osobna rola `catfish` (adwokat diabla) z tonem wg tieru (T3 = ostro), obowiazkowa |
| 6 | HiddenBench (arXiv 2505.11556) | grupy nie dziela sie informacja, ktorej nie maja wszyscy (hidden profile); pomaga USTRUKTURYZOWANE zebranie faktow PRZED glosowaniem | krok 1 = kazdy dzial oddaje FAKTY z dowodem (w tym `unique: true` — „co wiem tylko ja"), dopiero potem stanowisko |
| 7 | More Isn't Always Better (arXiv 2603.22152) | wiecej doradcow AI = wiecej presji konformizmu na CZLOWIEKA, zysk trafnosci sie wyplaszcza; forma prezentacji decyduje | raport dla uzytkownika: <= 5 linii, NAJPIERW sprzeciw/konflikt, nigdy „wszyscy zgodni" bez najmocniejszego kontrargumentu |
| 8 | MAST (arXiv 2503.13657, 1600+ sladow) | 41,8 % porazek = specyfikacja, 36,9 % = niezgodnosc miedzy agentami, 21,3 % = weryfikacja | `decision.json` walidowany (pytanie, >= 2 opcje w tym „nic nie robic", ograniczenia, dowody); role z granicami; fakty = komenda + wynik |
| 9 | DACI (Intuit/Atlassian Team Playbook) | Driver / jeden Approver / Contributors (glos, nie veto) / Informed | Driver = sesja-orkiestrator; Approver = uzytkownik (T3 / nieodwracalne) albo orkiestrator w granicach polityki; Contributors = dzialy; Informed = ADR + CHANGELOG |
| 10 | Amazon „Have Backbone; Disagree and Commit"; Google design docs (ASE 2023: 141 652 docs, automatyzacja -25 % czasu do akceptacji) | obowiazek sprzeciwu PRZED decyzja, pelne zaangazowanie PO; dokument przed kodem, decyzja w watkach, senior audience | ADR z sekcja „Sprzeciw (kto, dlaczego) + disagree-and-commit"; narada PRZED kodem dla T2+ (design.md B) |

## Kiedy narada (nie: kazda zmiana)
- **Design (przed kodem)**: PG-core 7D/7N — nowy modul/tabela/dostawca/integracja, zmiana auth/platnosci/i18n, wybor architektury, odejscie od `paradigm.md`.
- **Go / no-go (przed deployem T3)**: PRR z rozbieznymi odpowiedziami dzialow.
- **Incydent**: wybor action itemu (bramka vs case vs proces), gdy postmortem ma > 1 sensowna opcje.
- **Na zadanie uzytkownika**: „naradzcie sie", „ktora opcja", „zdecydujcie", „pg-council".
Nie dla: findingow z review (tam agregacja k-of-n), T0/T1, decyzji z jedna sensowna opcja (wtedy ADR bez narady).

## Protokol (skill `pg-council`, narzedzie `bin/pg-council.js`)
0. **Spec** (orkiestrator, 0 tokenow): `decision.json` = `{ id, question, context, options: [{id, summary}] (>= 2, w tym status quo), constraints, tier, irreversible, evidence_pointers, deadline }`. `node ~/.claude/bin/pg-council.js validate <plik>` — MAST #1 to specyfikacja.
1. **Fakty + stanowiska** (dzialy rownolegle, swiezy kontekst, read-only, NIE widza cudzych plikow): `position.<rola>.json` wg schematu nizej. Fakty = komenda + wynik; `unique: true` = „to wiem tylko ja z mojej rubryki". Preferowana opcja = jedna; `confidence` skalibrowana (0,5 = rzut moneta); `would_change_mind` obowiazkowe.
2. **Pool** (0 tokenow): `pg-council.js pool <run>` -> `pool.json` (unia faktow, wstepna tabela opcji, opcja wiodaca) — wejscie dla catfisha.
3. **Catfish** (1 agent, `agents/catfish.md`): najmocniejszy argument PRZECIW opcji wiodacej I przeciw status quo, fakty, ktorych nikt nie wniosl, pytania bez odpowiedzi. Ton wg tieru. Nie glosuje.
4. **Agregacja** (0 tokenow): `pg-council.js aggregate <run>` -> `council.json` + `council.md` + `adr-draft.md`. Reguly: tally = Σ waga(rola) × confidence; status `consensus | majority | contested | blocked`; blocker dzialu na opcji wiodacej = `blocked`; sentinel mniejszosci = `needs_verification`; sprzeciw zapisany imiennie (rola + powod).
5. **Runda korekty — max 1, tylko gdy `contested`**: dzialy dostaja `pool.json` + `catfish.json` (NIGDY tally ani cudzych preferencji) i moga zmienic stanowisko WYLACZNIE z powodu nowego FAKTU (belief preservation). Potem ponowna agregacja.
6. **Decyzja (DACI)**: `approver` z `council.json`: `uzytkownik` gdy tier T3 / `irreversible` / `contested` / `blocked`; inaczej orkiestrator decyduje w granicach polityki i uzytkownik jest „Informed". Wynik = ADR (`docs/adr/`) z sekcja „Stanowiska dzialow" i „Sprzeciw + disagree-and-commit". Bez ADR narada sie nie odbyla.
7. **Raport dla czlowieka** (<= 5 linii): status, opcja, NAJPIERW najmocniejszy sprzeciw (catfish/dysydent), warunki, co wymaga decyzji uzytkownika.

## Schematy
```json
// position.<rola>.json
{"role":"ops","decision_id":"D-2026-09-12-qa","facts":[{"claim":"...","evidence":"<komenda> -> <wynik>","unique":true}],
 "risks":[{"option":"A","risk":"...","severity":"blocker|major|minor"}],"preferred":"B","confidence":0.7,
 "conditions":["..."],"would_change_mind":"...","questions":["..."]}
// catfish.json
{"role":"catfish","decision_id":"...","against_leading":{"option":"B","arguments":[{"argument":"...","evidence":"..."}]},
 "against_status_quo":[{"argument":"...","evidence":"..."}],"strongest_objection":"...","missing_facts":["..."],"questions":["..."]}
```
Wagi rol (opcjonalne): `~/.claude/pg/council-weights.json` = `{"security":1.2,"ops":1.0,...}` — z kalibracji, nie z sympatii.

## Anty-wzorce (z badan; nie rob)
- Agenci czytaja cudze stanowiska przed zlozeniem wlasnego (konformizm 32-70 %).
- Wiecej niz 1 runda korekty; „przedyskutujcie to miedzy soba"; przewodniczacy, ktory streszcza i steruje (topologia scentralizowana = najgorsza).
- Decyzja „bo wiekszosc" przy mniejszosci z dowodami (sentinel) albo bez wysluchania catfisha.
- Raport „wszystkie dzialy zgodne" bez najmocniejszego kontrargumentu (presja konformizmu na uzytkownika).
- Narada bez ADR = spotkanie, ktorego nie bylo.

---
name: pg-council
description: |
  Narada dzialow i wspolna decyzja jako PROTOKOL (nie czat): specyfikacja decyzji -> fakty i stanowiska
  dzialow NIEZALEZNIE (swiezy kontekst, read-only) -> pool faktow -> catfish (adwokat diabla) -> agregacja
  w kodzie (wagi, konflikty, blockery, sentinel mniejszosci) -> max 1 runda korekty -> DACI + ADR z zapisanym
  sprzeciwem. Uzyj przed kodem dla T2+ (nowy modul/tabela/dostawca/auth/platnosci), przy go/no-go T3,
  przy wyborze action itemu po incydencie, albo na haslo: "naradzcie sie", "ktora opcja", "zdecydujcie",
  "pg-council", "narada dzialow". Podstawa: ~/.claude/pg/council.md (10 zrodel).
---

# pg-council — procedura (orkiestrator = sesja glowna)

Twarde zasady (z badan): dzialy NIE widza cudzych stanowisk przed zlozeniem wlasnego; zero czatu miedzy agentami;
max 1 runda korekty i tylko z powodu NOWEGO FAKTU; catfish obowiazkowy; wynik bez ADR = narady nie bylo;
raport dla uzytkownika zaczyna sie od sprzeciwu, nie od zgody.

## 0. Specyfikacja (0 tokenow) — MAST: 41,8 % porazek to zla specyfikacja
```bash
RUN="$TEMP/pg-council-$(date +%Y%m%d-%H%M%S)"; mkdir -p "$RUN"
# decision.json: id, question (1 pytanie), context, options (>= 2, w tym status quo), constraints, tier, irreversible, evidence_pointers, deadline
node ~/.claude/bin/pg-council.js validate "$RUN/decision.json"     # exit 2 = popraw spec, nie odpalaj agentow
```
Dobre pytanie = da sie odpowiedziec jedna opcja. „Jak ulepszyc X?" to nie pytanie na narade — najpierw opcje.

## 1. Dzialy — rownolegle, jedna wiadomosc, `run_in_background: true`, swiezy kontekst
Skladu nie dobieraj „wszyscy": 3-5 dzialow, ktorych rubryka DOTYCZY decyzji (More Isn't Always Better: wiecej glosow = wiecej presji,
nie wiecej prawdy). Kandydaci: `product-reviewer` (problem/zakres/dane vs kod), `code-reviewer` (design/zlozonosc), `ops-reviewer`
(deploy/koszt/rollback), `security-reviewer` (T3), `data-reviewer` (schemat), `ux-reviewer` (UI), `qa-reviewer` (testowalnosc).
Prompt KAZDEGO (tryb NARADA, nie review):
```
TRYB NARADA (pg-council), nie recenzja. Repo: <sciezka>. Decyzja: <RUN>/decision.json (czytaj CALY). Dowody: evidence_pointers z decision.json.
Twoje zadanie z perspektywy TWOJEJ rubryki (~/.claude/agents/<rola>.md): (1) FAKTY z komenda + wynikiem (pole unique: true = wiesz to tylko
z tej rubryki), (2) ryzyka per opcja z severity, (3) JEDNA preferowana opcja + confidence 0-1 (0,5 = rzut moneta), (4) warunki, (5) would_change_mind.
Zapisz <RUN>/position.<rola>.json DOKLADNIE wg schematu w ~/.claude/pg/council.md. NIE czytaj position.* innych dzialow. Nie edytuj repo. Odpowiedz <= 6 linii.
```
Model: sonnet; security/data przy T3 = opus (jak w pg-review).

## 2. Pool faktow (0 tokenow)
```bash
node ~/.claude/bin/pg-council.js pool "$RUN"      # -> pool.json (unia faktow, opcja wiodaca) — wejscie dla catfisha
```

## 3. Catfish (1 agent `catfish`, sonnet; T3 = opus)
```
Narada: <RUN> (decision.json + pool.json). NIE czytaj position.*.json. Zapisz <RUN>/catfish.json wg schematu z ~/.claude/agents/catfish.md. Ton wg tieru.
```

## 4. Agregacja (0 tokenow)
```bash
node ~/.claude/bin/pg-council.js aggregate "$RUN"   # -> council.json, council.md, adr-draft.md; exit 1 = decyzja uzytkownika
```
Statusy: `consensus` / `majority` (orkiestrator decyduje, gdy T1-T2 i odwracalne) / `contested` (remis albo sentinel mniejszosci) /
`blocked` (blocker dzialu na opcji wiodacej). T3 albo `irreversible` = zawsze uzytkownik.

## 5. Runda korekty — TYLKO gdy `contested`, max 1
Do KAZDEGO dzialu (ten sam agent przez SendMessage albo nowy z tym samym promptem + dopisek):
```
Runda 2. Nowe wejscie: <RUN>/pool.json (fakty wszystkich dzialow) + <RUN>/catfish.json. NIE dostajesz wyniku glosowania ani cudzych preferencji.
Zmien stanowisko WYLACZNIE, jesli pojawil sie NOWY FAKT, ktory zmienia twoje would_change_mind — wtedy podaj go w polu changed_because. Inaczej zostaw. Nadpisz position.<rola>.json.
```
Potem ponownie krok 4. Trzeciej rundy nie ma (Debate-or-Vote: kolejne rundy pogarszaja wynik).

## 6. Decyzja i zapis (DACI)
- `approver = uzytkownik`: pokaz raport (krok 7) i ZATRZYMAJ sie — nie implementuj przed decyzja.
- `approver = orkiestrator`: decyduj wg `council.json`, skopiuj `adr-draft.md` do `docs/adr/NNNN-<slug>.md` repo (uzupelnij koszt/rollback), wpis w CHANGELOG jesli widoczne. uzytkownik = Informed (1 linia w raporcie).
- Sprzeciw zostaje w ADR imiennie (disagree and commit). Nie „wygladzaj" go.

## 7. Raport dla uzytkownika (<= 5 linii, CAVEMAN; kolejnosc obowiazkowa)
```
[PG] narada <id> · <status> · approver: <kto>
SPRZECIW: <strongest_objection catfisha / dysydent z sentinela>
OPCJA: <wiodaca> — <Σ i kto> · warunki: <...>
DO DECYZJI KAMILA: <tak/nie + co dokladnie>   · ADR: <sciezka>   · council.md: <sciezka>
```

## Anty-wzorce
- Wklejanie finderom cudzych stanowisk „dla kontekstu"; prosba „uzgodnijcie miedzy soba"; przewodniczacy streszczajacy dyskusje.
- Narada o wszystkim (T0/T1, jedna sensowna opcja) — wtedy ADR bez narady.
- Pominiecie catfisha, bo „wszyscy sie zgadzaja" — to dokladnie moment, w ktorym jest najbardziej potrzebny.
- Raport zaczynajacy sie od „dzialy jednoglosnie…" (presja na czlowieka).

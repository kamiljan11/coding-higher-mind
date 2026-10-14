# ADR-0007: Kalibracja bramek wg logu (plan v3 L2-L4) i CHANGELOG przy release (N1)

Data: 2026-10-14 | Status: przyjete (uzytkownik 2026-10-13: „model szuka ulepszen na sile i za bardzo uszczelnia”; zasada: bez incydentu nie ma nowej blokady)

**Kontekst:** log bramek `logs/gates.jsonl` (12 dni do 2026-10-13, po odsianiu sladow testow) = ok. 1165 realnych blokad. Etykiety `plan v3 L2/L3/L4/N1` w komentarzach kodu odnosza sie do tej decyzji; pelne liczby i krytyki: Obsidian `Knowledge/PG - plan v3 realny (2026-10-13).md` (tu tylko to, co potrzebne do cofniecia).

**Decyzja (bramki L2-L4 = jeden commit, N1 = osobny; miejsca w kodzie w „Jak cofnac”):**
- L2: lint po edycji pomija plik w tmp POZA repo git (po realpath; 58 blokad na jednorazowych skryptach). Klon w tmp dalej lintowany.
- L3: `rm -rf <bezpieczny>/cache[/*]` dozwolone; rodzic i `cache` nie moga byc dowiazaniem, cel wzgledny przy nieznanym cwd blokowany.
- L4: dup-literals = 6 kopii w >= 3 plikach, seedy ignorowane (replay client-app 31 -> 6 trafien, incydent zrodlowy dalej lapany; ok. 65 commitow z obejsciem). LARGE_DIFF 400 -> 1500 linii zrodlowych (ok. 110 pushy z obejsciem, 58 z nich shop-app; skala incydentu marketplace-app = 213 plikow). Bez replayu dla 1500.
- N1: CHANGELOG pisany przy release z tytulow PR (Conventional Commits), nie w kazdym PR (30 linii `Merge conflict in CHANGELOG.md`, najczestszy plik). Stare repo z wlasna regula zachowuja konwencje repo.

**Rozwazone alternatywy:** zostawic progi (bramki obchodzone = bez efektu, tylko tarcie); szeroka latka rm-rf (otwierala kasowanie poza build) — odrzucona na rzecz waskiej; LARGE_DIFF tylko jako ostrzezenie (traci blokade gigantow).

**Konsekwencje:** mniej blokad i fraz; ryzyko = przepuszczony duplikat/duzy diff miedzy progami. L5 (devDependencies w bramce arch) odlozone.

**Jak cofnac:** caly etap = `git revert` commita bramek albo N1. Jedna pozycja = odwrocenie jej miejsca: L2 `hooks/post-edit-check.js` (`isScratchOutsideGit`), L3 `hooks/lib/bash-rules.js` (galaz cache w `isSafeRmTarget`), L4 `bin/dup-literals.js` (`DEFAULTS`) i `bin/diff-size-gate.js` + `git-hooks/pre-push` (1500). Kazdy revert wymaga pieczeci i frazy CONTROL_PLANE.

**Sygnal powrotu:** incydent w kategorii, ktora poluzowalismy -> revert tej jednej pozycji. Przeglad 2026-11-12: realne blokady/dzien, frazy/tydzien, PR > 48 h, nowe incydenty.

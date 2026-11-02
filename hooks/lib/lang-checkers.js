'use strict';
// Kompilatory/lintery jezykow poza TS/JS/Python dla hookow (go, rust, shell, java, c/c++, php, c#, deno) — lista + wywolanie.
// Powod (2026-10-26, pytanie uzytkownika: „czy PG ma realnie kompilatory jezykow, w ktorych piszemy?"):
// JEDYNE miejsce z lista „rozszerzenie -> kompilator/linter" dla jezykow poza TS/JS/Python (te zostaja w lint-file.js).
// Przed ta zmiana edycja .go/.rs/.java/.sh nie byla sprawdzana WCALE, a log bramek pisal `ran: 1 files` (falszywa zielen).
// Top jezyki wg GitHub Octoverse 2025 + Stack Overflow Survey 2025: TS, Python, JS, Java, C#, C++, C, PHP, Shell, Go, Rust, SQL.
// SQL = sql-migration-lint w pre-commit/pg-review (migracje), nie tutaj. Decyzje i koszty: pg/adr/0010-*.md.
// Nowy jezyk = nowy wpis w CHECKERS + TOOLS (procedura: pg/design.md › F.10); bez wpisu plik idzie do `skipped: no checker`.
//
// Zasady:
//  - BEZ POWLOKI: narzedzie + tablica argumentow (spawnSync shell:false), sciezki absolutne. Nazwa pliku z obcego klonu
//    (`a$(id).sh`) nie moze niczego wykonac (pg-review 2026-10-26 security, blocker z PoC na wersji z shell:true),
//  - brak narzedzia / timeout / budzet hooka / brak zaleznosci projektu = `skipped` w gates.jsonl, nigdy blokada,
//  - blokada tylko na realnym wyniku; ostrzezenia blokuja tylko w EDYTOWANYCH plikach (dlugu nie sprzatamy z automatu),
//  - narzedzia WYKONUJACE kod repo (cargo: build.rs/proc-macro, dotnet: MSBuild) tylko pod korzeniem z pg/trusted-roots.txt
//    — samo drzewo cwd sesji NIE wystarcza (obcy klon w katalogu roboczym); go bez cgo poza tymi korzeniami,
//  - bez sieci, gdzie narzedzie samo by pobieralo: GOPROXY=off, GOTOOLCHAIN=local, cargo --offline, dotnet --no-restore,
//    deno --cached-only poza drzewem cwd/zaufanymi korzeniami,
//  - do agenta wraca tylko diagnostyka z plikow repo (gcc cytuje zawartosc `#include "/sciezka/spoza"` — wyciek pliku);
//    poza korzeniami z pg/trusted-roots.txt komunikaty sa ZREDAGOWANE do `plik:linia: blad [KOD]` — tresc bledu potrafi
//    niesc bajty pliku spoza repo (`#embed`, symlink w repo; pg-review 2026-10-26 security r2, PoC na g++ 15),
//  - gcc/g++ tylko w exec-trust (obcy klon = skip: binarne .gch, security r5); limit pamieci (prlimit --as) i filtr
//    diagnostyk zostaja jako obrona w glab — `#include "/dev/zero"` nie zje RAM-u laptopa.
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { isTrustedDir } = require('./trusted-roots');

const TIMEOUT_MS = 60000;
const MIN_TOOL_MS = 5000; // mniej czasu do konca budzetu hooka = nie startujemy narzedzia (skip, nie ubicie hooka)
const MAX_REPORT_LINES = 60;
const MAX_ROOT_SEARCH_DEPTH = 15;
// sh/bash/dash/ksh — bez zsh: shellcheck go nie obsluguje (SC1071 = blokada nie do naprawienia w kodzie, pg-review code r3).
const SHEBANG_RX = /^#!\s*\S*\b(ba|da|k)?sh\b|^#!\s*\S*env\s+(ba|da|k)?sh\b/;
const SHEBANG_PROBE_BYTES = 128;
const CC_MEMORY_LIMIT = 2 * 1024 * 1024 * 1024; // bajty przestrzeni adresowej gcc/g++ (zwykly plik: < 300 MB)

// Kod w jezyku bez sprawdzacza -> `skipped: no checker for .ext` (luka w guard_health) zamiast udawania sprawdzenia.
// Naglowki C/C++ (.h/.hpp) i dwuznaczne .m/.fs celowo POZA lista: naglowek sprawdza kompilacja pliku .c/.cpp, ktory go
// wlacza; dwuznaczne rozszerzenia dawalyby staly szum (pg-review 2026-10-26 code/product).
const NO_CHECKER_EXTS = new Set(['.kt', '.kts', '.swift', '.rb', '.dart', '.scala', '.lua', '.ex', '.exs', '.zig',
  '.tf', '.hcl', '.vue', '.svelte', '.astro', '.r', '.pl', '.ps1', '.clj']);

const ext = (f) => path.extname(f).toLowerCase();
const trim = (s) => String(s).split('\n').slice(0, MAX_REPORT_LINES).join('\n');
const toPosix = (p) => p.replace(/\\/g, '/');
const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch (e) { return false; } };
const real = (p) => { try { return fs.realpathSync.native(p); } catch (e) { return path.resolve(p); } };
// Po realpath: symlink w repo wskazujacy poza repo to plik SPOZA repo.
const inside = (file, root) => { const r = path.relative(real(root), real(file)); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)); };

function readHead(file) {
  // Tylko zwykly plik: open() na symlinku do FIFO wisi do timeoutu hooka, na /dev/tty zjada klawisze (pg-review security r7).
  if (!isFile(file)) return '';
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(SHEBANG_PROBE_BYTES);
    const n = fs.readSync(fd, buf, 0, SHEBANG_PROBE_BYTES, 0);
    fs.closeSync(fd);
    return buf.slice(0, n).toString('utf8').split('\n')[0];
  } catch (e) { return ''; }
}

// Skrypt powloki: .sh/.bash albo plik BEZ rozszerzenia z shebangiem sh/bash (git-hooks/pre-commit itp.).
function isShellFile(f) {
  const e = ext(f);
  // .sh z shebangiem zsh: shellcheck daje SC1071 (blokada nie do naprawienia) — pomijany jak w CI (quality.yml, code r7).
  if (e === '.sh' || e === '.bash') return !/^#!.*\bzsh\b/.test(readHead(f));
  if (e !== '') return false;
  return SHEBANG_RX.test(readHead(f));
}

// Edge functions Supabase dzialaja w Deno — tsc z package.json repo ich zwykle nie obejmuje (exclude).
const isDenoFile = (f) => /[\/\\]supabase[\/\\]functions[\/\\].+\.(ts|tsx|js|mjs)$/i.test(f);

function nearestDirWith(file, test) {
  let dir = path.dirname(file);
  for (let i = 0; i < MAX_ROOT_SEARCH_DEPTH; i++) {
    try { if (test(dir)) return dir; } catch (e) { /* nieczytelny katalog = szukamy wyzej */ }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}
const markerRoot = (...names) => (file) => nearestDirWith(file, (d) => names.some((n) => fs.existsSync(path.join(d, n))));
const csprojRoot = (file) => nearestDirWith(file, (d) => fs.readdirSync(d).some((n) => /\.csproj$/i.test(n)));
const gitOrFileDir = (file) => nearestDirWith(file, (d) => fs.existsSync(path.join(d, '.git'))) || path.dirname(file);
// Zaufane do WYKONANIA kodu repo = korzen z pg/trusted-roots.txt (bez drzewa cwd) ORAZ repo bez remote albo z origin
// wlasciciela (`owner` w pg/fleet-scope.json). Korzen to caly katalog (~/src), a lezy tam juz klon obcego autora — sam wpis
// nie odroznia go od wlasnego repo (pg-review 2026-10-26 security r3, major). `git config` tylko czyta, nic nie wykonuje.
const FLEET_SCOPE = path.join(__dirname, '..', '..', 'pg', 'fleet-scope.json');
function fleetOwner() {
  try { return String(JSON.parse(fs.readFileSync(FLEET_SCOPE, 'utf8')).owner || ''); } catch (e) { return ''; }
}
function ownRemote(url, owner) {
  if (!url) return true; // brak origin = lokalny projekt (granica: pg/known-limits.md › ADR-0010)
  if (!owner) return false;
  const o = owner.replace(/[^\w.-]/g, '');
  return new RegExp(`^(?:https://(?:[^@/]+@)?github\\.com/|git@github\\.com:|ssh://git@github\\.com/)${o}/[^/]+$`, 'i').test(url.trim());
}
// Origin repo, w ktorym lezy `root`, liczony od TOPLEVEL. `safe.bareRepository=explicit` z linii komend (repo go nie nadpisze):
// osadzone bare repo (zwykle pliki HEAD/config/objects w podkatalogu obcego klonu) podsuwalo origin wlasciciela = exec-trust
// dla build.rs (pg-review security r8, blocker). git-dir musi byc `<toplevel>/.git` albo worktree/submodul pod `.git/`.
// Repo NADRZEDNE tez musi byc wlasne (rekurencja od katalogu nad toplevel): cargo/MSBuild/shellcheck czytaja config przodkow
// (.cargo/config.toml, Directory.Build.props), wiec wlasny submodul albo klon w OBCYM superprojekcie wykonal rustc-wrapper
// obcego autora (security r11, blocker z PoC). Klasa „zaufanie liczone dla jednego repo" wracala 5x (r3/r4/r8/r10/r11).
const GIT_SAFE = ['-c', 'safe.bareRepository=explicit'];
const MAX_NESTING = 8;
function ownRepoAt(root, depth = 0) {
  // LC_ALL=C: test „not a git repository" ponizej czyta angielski stderr (code r10).
  const git = (args) => spawnSync('git', [...GIT_SAFE, '-C', root, ...args],
    { shell: false, encoding: 'utf8', timeout: 5000, env: { ...process.env, LC_ALL: 'C' } });
  const top = git(['rev-parse', '--show-toplevel', '--absolute-git-dir']);
  if (top.error) return false;
  // 128 + „not a git repository" = nie repo -> brak origin (granica: known-limits). Inny 128 (bare repo odrzucone, „dubious
  // ownership" = repo innego uzytkownika, security r4) = nie ufamy.
  if (top.status !== 0) return top.status === 128 && /not a git repository/i.test(top.stderr || '');
  const [toplevel, gitDir] = top.stdout.trim().split('\n');
  if (!toplevel || !gitDir) return false;
  const g = toPosix(gitDir);
  if (g !== toPosix(path.join(toplevel, '.git')) && !/\/\.git\/(worktrees|modules)\//.test(g)) return false;
  // KAZDY remote, nie tylko origin: `git clone -o upstream <obcy>` albo fork + upstream obcego autora = nie ufamy (security r10).
  // --null: wpis = "klucz\nwartosc\0" (wartosc z nowa linia nie rozjedzie parsowania, security r11).
  const r = git(['config', '--null', '--get-regexp', '^remote\\..*\\.url$']);
  if (r.error) return false;
  if (r.status !== 0 && r.status !== 1) return false; // 1 = zadnego remote = lokalny projekt
  const owner = fleetOwner();
  const urls = r.status === 0 ? r.stdout.split('\0').filter(Boolean).map((e) => e.slice(e.indexOf('\n') + 1)) : [];
  if (r.status === 0 && !(urls.length > 0 && urls.every((u) => u && ownRemote(u, owner)))) return false;
  const parent = path.dirname(toplevel);
  if (parent === toplevel) return true;
  return depth < MAX_NESTING && ownRepoAt(parent, depth + 1);
}
const execTrust = new Map();
function trustedForExec(root) {
  if (!execTrust.has(root)) {
    // Sciezka korzenia BEZ symlinkow (== realpath): narzedzia (MSBuild, shellcheck, gcc) ida po przodkach sciezki, ktora dostaja,
    // a ownRepoAt sprawdza przodkow realpath. Symlink w obcym klonie do wlasnego repo dawal sprawdzony lancuch != lancuch narzedzia
    // (Directory.Build.props obcego autora, security r13 blocker). Symlink = fail-closed (lzejsze sprawdzacze, bez wykonania).
    const realRoot = real(root);
    let ok = toPosix(path.resolve(root)) === toPosix(realRoot) && isTrustedDir(realRoot, null);
    if (ok) ok = ownRepoAt(realRoot);
    execTrust.set(root, ok);
  }
  return execTrust.get(root);
}


// Jak exec, ale pod `prlimit --as` (gdy jest): plik-symlink do /dev/zero albo `source` pliku specjalnego nie zje RAM-u
// (pg-review security r6/r7). Brak narzedzia pod prlimit = rc 127, nie ENOENT.
// Komunikaty runtime narzedzia przy przekroczonym limicie, OD POCZATKU linii (sprawdzone pod prlimit 2G: gofmt, php, cc1,
// shellcheck/GHC). Diagnostyka cytujaca literal z pliku (`unexpected "out of memory"`) zaczyna sie od pliku/`PHP Parse error`,
// wiec nie udaje limitu (pg-review code r8: blad skladni znikal jako skip).
const OOM_RX = /^(?:runtime: out of memory|fatal error: (?:runtime: )?out of memory|mmap\(\) failed: \[12\]|Out of memory\s*$|(?:PHP )?Fatal error:\s+(?:Allowed memory size|Out of memory)|cc1(?:plus)?: out of memory|virtual memory exhausted|shellcheck: out of memory)/m;
function execLimited(tool, args, cwd, ctx, extraEnv) {
  if (!ctx.prlimit) return exec(tool, args, cwd, ctx, extraEnv);
  const r = exec('prlimit', [`--as=${CC_MEMORY_LIMIT}`, '--', tool, ...args], cwd, ctx, extraEnv);
  if (r.missing) return Object.assign({}, r, { why: r.why.replace('prlimit', tool) });
  if (r.status === 127 && /prlimit: failed to execute/.test(r.out)) return { missing: true, why: `tool missing: ${tool}` };
  if (OOM_RX.test(r.out)) return { missing: true, why: `${tool}: limit pamieci (plik specjalny albo ogromny)` };
  return r;
}

// Wynik: { status, out } albo { missing, why }. Bez powloki; timeout = min(60 s, czas do konca budzetu hooka).
function exec(tool, args, cwd, ctx, extraEnv) {
  const left = ctx.deadline - Date.now();
  if (left < MIN_TOOL_MS) return { missing: true, why: `budzet czasu hooka: ${tool} pominiety` };
  const timeout = Math.min(TIMEOUT_MS, left);
  const r = spawnSync(tool, args, { cwd, shell: false, encoding: 'utf8', timeout, env: Object.assign({}, ctx.env, extraEnv), maxBuffer: 8 * 1024 * 1024 });
  if (r.error && r.error.code === 'ENOENT') return { missing: true, why: `tool missing: ${tool}` };
  if (r.error && r.error.code === 'ETIMEDOUT') return { missing: true, why: `${tool}: blad narzedzia (timeout ${timeout}ms)` };
  // `: blad narzedzia` = konwencja guard_health (seryjne bledy -> RED, ADR-0008)
  if (r.error) return { missing: true, why: `${tool}: blad narzedzia (uruchomienie: ${r.error.code || r.error.message})` };
  if (r.signal) return { missing: true, why: `${tool}: blad narzedzia (przerwany: ${r.signal})` };
  return { status: r.status, out: ((r.stdout || '') + '\n' + (r.stderr || '')).trim() };
}

// Linie wyniku dotyczace edytowanych plikow: sciezka z LOKALIZACJI linii (nie podciag — `a.go` != `data.go`, code r4) ROWNA
// edytowanemu plikowi po realpath, rozwiazana wzgledem root albo jego przodka (cargo w workspace podaje sciezke od korzenia
// workspace). Bez sufiksu: `crates/b/src/lib.rs` != edytowany `crates/a/src/lib.rs` (code r5).
const ANCESTOR_LEVELS = 8;
function linesForFiles(out, files, root) {
  const own = new Set(files.map((f) => real(path.resolve(root, f))));
  const bases = [];
  for (let d = root, i = 0; i <= ANCESTOR_LEVELS; i++) { bases.push(d); const up = path.dirname(d); if (up === d) break; d = up; }
  return String(out).split('\n').filter((l) => {
    const m = l.replace(/^\s*(?:-->\s*)?/, '').replace(/^vet: /, '').match(LOCATION_RX);
    if (!m) return false;
    const p = m[1].replace(/^\.\//, '');
    return (path.isAbsolute(p) ? [p] : bases.map((b) => path.join(b, p))).some((c) => own.has(real(c)));
  });
}

const block = (name, header, out) => ({ blocked: true, header: `${name} — ${header}, popraw je teraz:`, out: trim(out) });

// Redakcja dla repo spoza trusted-roots: zostaje lokalizacja w repo + kod diagnostyki (SC2045, CS1002, TS2322, E0308),
// znika tresc komunikatu. Lokalizacja spoza repo (po realpath) = tylko licznik.
// Formaty: `plik:L[:K]: ...` (gcc, javac, shellcheck -f gcc, gofmt, go vet z prefiksem `vet: `), `... in plik on line L` (php -l),
// deno: kod `TSnnnn [ERROR]` w linii, lokalizacja nizej w `at file:///plik:L:K`. Kazda linia z lokalizacja = diagnostyka.
const LOCATION_RX = /^(.+?):(\d+)(?::(\d+))?(?::|$)/;
const PHP_LOCATION_RX = / in (.+) on line (\d+)/;
const DIAG_CODE_RX = /\b(SC\d{4}|CS\d{4}|TS\d{4,5}|E\d{4}|NETSDK\d{4})\b/;
function redact(out, root) {
  const kept = [];
  let outside = 0;
  let pendingCode = null; // deno: kod bledu w linii PRZED lokalizacja
  for (const l of String(out).split('\n')) {
    const code = (l.match(DIAG_CODE_RX) || [])[1];
    const norm = l.replace(/^\s*at\s+(?:file:\/\/)?/, '').replace(/^(?:vet|PHP [\w ]+error): /, '');
    const php = l.match(PHP_LOCATION_RX);
    const m = php ? [null, php[1], php[2], null] : norm.match(LOCATION_RX);
    if (!m || /^\s/.test(norm) || /^#/.test(norm) || /^\s*\d+\s*\|/.test(l)) { if (code) pendingCode = code; continue; }
    const file = path.resolve(root, m[1].replace(/^\.\//, ''));
    // Lokalizacja = ISTNIEJACY plik w repo. Linia code-frame z tresci pliku (`REDIS_URL=redis://:haslo@h:6379`) tez pasuje do
    // LOCATION_RX i po resolve „lezy w repo" — bez tego sprawdzenia tresc pliku spoza repo wracala (pg-review security r4, PoC deno).
    if (!isFile(file)) { pendingCode = null; continue; }
    if (!inside(file, root)) { outside++; pendingCode = null; continue; }
    const c = code || pendingCode;
    pendingCode = null;
    kept.push(`${toPosix(path.relative(real(root), real(file)))}:${m[2]}${m[3] ? ':' + m[3] : ''}: ${/warning/i.test(l) && !/error/i.test(l) ? 'warning' : 'error'}${c ? ' [' + c + ']' : ''}`);
  }
  return [...new Set(kept)].join('\n') + (outside ? `\n[${outside} diagnostyk z plikow spoza repo pominieto]` : '') +
    '\n[repo spoza pg/trusted-roots.txt: tresc komunikatow ukryta (ochrona przed wyciekiem pliku spoza repo) — otworz wskazane linie albo uruchom narzedzie recznie]';
}

// --- sprawdzacze: (files, root, ctx) -> null | { blocked, header, out } | { skip: powod } ---

function checkGo(files, root, ctx) {
  const env = { GOTOOLCHAIN: 'local', GOPROXY: 'off', GOFLAGS: '-mod=readonly', GOWORK: 'off' };
  // cgo uruchamia gcc z dyrektywami #cgo z pliku — poza zaufanymi korzeniami bez cgo (pg-review 2026-10-26 security).
  if (!trustedForExec(root)) env.CGO_ENABLED = '0';
  const fmt = (trustedForExec(root) ? exec : execLimited)('gofmt', ['-l', ...files], root, ctx, env);
  if (fmt.missing) return { skip: fmt.why };
  if (fmt.status !== 0) return block('gofmt', 'blad skladni', fmt.out);
  // gofmt -l wypisuje tylko sciezki, ktore sami podalismy — bez tresci plikow, wiec bez redakcji (`safe`).
  if (fmt.out.trim()) return Object.assign(block('gofmt', 'pliki niesformatowane (gofmt -w <plik>)', fmt.out), { safe: true });
  // Obcy klon: tylko sprawdzacze czytajace WYLACZNIE edytowane pliki. go vet kompiluje caly pakiet (plik-symlink do /dev/zero
  // = pamiec bez limitu) -> skip po gofmt (pg-review security r6; ADR-0010 › Obcy klon).
  if (!trustedForExec(root)) return { skip: 'go vet: repo poza pg/trusted-roots.txt (kompiluje caly pakiet; sprawdzono tylko gofmt)' };
  const pkgs = [...new Set(files.map((f) => { const rel = toPosix(path.relative(root, path.dirname(f))); return rel ? './' + rel : '.'; }))];
  const vet = exec('go', ['vet', ...pkgs], root, ctx, env);
  if (vet.missing) return { skip: vet.why };
  if (vet.status === 0) return null;
  if (/module lookup disabled|missing go\.sum entry|no required module provides|requires go >=|toolchain not available|updates to go\.mod needed|cannot find module providing/i.test(vet.out)) {
    return { skip: 'go: brak zaleznosci modulu offline (go mod download)' };
  }
  // `vet: plik:L:K` = blad kompilacji pakietu (edycja mogla zepsuc inny plik) -> blokada zawsze. Uwagi analizatorow (bez prefiksu)
  // blokuja tylko w EDYTOWANYCH plikach — dlug w starych plikach pakietu nie blokuje (ZAKRES, pg-review code r3).
  const lines = vet.out.split('\n');
  const compile = lines.filter((l) => /^vet: /.test(l));
  if (compile.length) return block('go vet', 'bledy kompilacji', compile.join('\n'));
  const located = lines.filter((l) => LOCATION_RX.test(l) && !/^#/.test(l));
  if (located.length) {
    const own = linesForFiles(located.join('\n'), files, root);
    return own.length ? block('go vet', 'uwagi analizatorow w edytowanych plikach', own.join('\n')) : null;
  }
  return block('go vet', 'bledy kompilacji/vet', vet.out);
}

function checkRust(files, root, ctx) {
  if (!trustedForExec(root)) return { skip: 'cargo: repo poza pg/trusted-roots.txt (build.rs wykonuje kod)' };
  const clippy = exec('cargo', ['clippy', '--version'], root, ctx);
  const sub = !clippy.missing && clippy.status === 0 ? 'clippy' : 'check';
  const r = exec('cargo', [sub, '--offline', '--quiet', '--message-format', 'short'], root, ctx, { CARGO_TERM_COLOR: 'never' });
  if (r.missing) return { skip: r.why };
  if (r.status !== 0 && /--offline|failed to (download|load source|get .* as a dependency)|no matching package named|could not find `Cargo\.toml`/i.test(r.out)) {
    return { skip: 'cargo: brak zaleznosci offline (cargo fetch)' };
  }
  const errors = r.out.split('\n').filter((l) => /\berror(\[E\d+\])?:/.test(l));
  const ownWarnings = linesForFiles(r.out, files, root).filter((l) => /\bwarning:/.test(l));
  if (r.status !== 0 || errors.length) return block(`cargo ${sub}`, 'bledy kompilacji', errors.length ? errors.join('\n') : r.out);
  if (ownWarnings.length) return block(`cargo ${sub}`, 'ostrzezenia w edytowanych plikach (martwy kod, zbedne konstrukcje)', ownWarnings.join('\n'));
  return null;
}

function checkShell(files, root, ctx) {
  // Obcy klon: --norc (`.shellcheckrc` z repo = external-sources=true -> `source=/dev/zero`), a limit pamieci zawsze, bo ta sama
  // dyrektywa moze stac w samym skrypcie (pg-review security r6).
  const args = [...(trustedForExec(root) ? [] : ['--norc']), '-f', 'gcc', '-S', 'warning', '--', ...files];
  const r = execLimited('shellcheck', args, root, ctx);
  if (r.missing) return { skip: r.why };
  if (r.status === 0) return null;
  if (r.status === 1) return block('shellcheck', 'ostrzezenia/bledy', r.out);
  return { skip: `shellcheck: blad narzedzia (exit ${r.status})` };
}

// Maven/Gradle: zrodla wzgledem src/main/java (sourcepath); brak bibliotek z classpath = srodowisko, nie blad kodu.
function checkJava(files, root, ctx) {
  // javac czyta inne pliki repo przez -sourcepath (symlink do /dev/zero, JVM do 25% RAM) — obcy klon = skip (security r6).
  if (!trustedForExec(root)) return { skip: 'javac: repo poza pg/trusted-roots.txt (czyta inne pliki repo przez -sourcepath)' };
  // Korzenie zrodel WSZYSTKICH plikow (multi-module: m1/src/main/java + m2/src/main/java) — z files[0] javac nie widzial klas
  // drugiego modulu i blokowal poprawny kod (code r5).
  const srcRoots = [...new Set(files.map((f) => { const m = toPosix(f).match(/^(.*\/src\/(main|test)\/java)\//); return m ? m[1] : root; }))];
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-javac-'));
  try {
    const r = exec('javac', ['-proc:none', '-implicit:none', '-Xlint:none', '-d', outDir, '-sourcepath', srcRoots.join(path.delimiter), ...files], root, ctx);
    if (r.missing) return { skip: r.why };
    if (r.status === 0) return null;
    if (/package [\w.]+ does not exist|cannot access [\w.]+|class file for [\w.]+ not found/.test(r.out)) return { skip: 'javac: brak bibliotek projektu w classpath (mvn/gradle)' };
    return block('javac', 'bledy kompilacji', r.out);
  } finally {
    try { fs.rmSync(outDir, { recursive: true, force: true }); } catch (e) { /* tmp sprzata system */ }
  }
}

// Diagnostyka gcc: tylko linie z lokalizacja w repo; bez fragmentow kodu (-fno-diagnostics-show-caret), wiec tresc
// pliku spoza repo wlaczonego przez `#include "/abs"` nie trafia do agenta.
function repoDiagnostics(out, root) {
  const lines = String(out).split('\n');
  const isError = (l) => /: (fatal )?error:/.test(l);
  const kept = lines.filter((l) => {
    const m = l.match(/^(.+?):\d+(?::\d+)?: (?:fatal )?(error|warning|note):/);
    return m && inside(path.resolve(root, m[1]), root);
  });
  const dropped = lines.filter(isError).length - kept.filter(isError).length;
  return kept.join('\n') + (dropped > 0 ? `\n[${dropped} bledow z plikow spoza repo pominieto]` : '');
}

// Bez flag z systemu budowania (CMake/Make) — blokuja tylko bledy, brak naglowka = srodowisko.
function checkC(files, root, ctx) {
  // Poza exec-trust bez kompilatora C/C++: gcc po cichu laduje binarny `<h>.gch` (zrzut stanu kompilatora, bez odpornosci na
  // zlosliwe wejscie) z dowolnego katalogu, do ktorego siegnie `#include "../.."`. Skan repo mial kolejne dziury (node_modules,
  // glebokosc, korzen bez .git) — pg-review security r3/r5. Jak cargo/dotnet: skip z powodem.
  if (!trustedForExec(root)) return { skip: 'gcc/g++: repo poza pg/trusted-roots.txt (kompilator czyta binarne .gch z repo)' };
  for (const f of files) {
    const cc = ext(f) === '.c' ? 'gcc' : 'g++';
    const inc = [path.dirname(f), root, path.join(root, 'include'), path.join(root, 'src')].filter((d) => fs.existsSync(d)).map((d) => '-I' + d);
    const args = ['-fsyntax-only', '-fno-diagnostics-show-caret', '-fdiagnostics-color=never', '-Wall',
      '-Werror=implicit-function-declaration', '-Werror=return-type', ...inc, f];
    const r = execLimited(cc, args, root, ctx); // prlimit + rc 127 + limit pamieci — jedna kopia (code r8)
    if (r.missing) return { skip: r.why };
    if (r.status === 0) continue;
    if (/fatal error: [^:]+: No such file or directory/.test(r.out)) return { skip: `${cc}: brak naglowka (flagi z CMake/Make)` };
    const errors = repoDiagnostics(r.out, root).split('\n').filter((l) => /error:|pominieto/.test(l)).join('\n');
    return block(cc, 'bledy kompilacji', errors || `${cc} exit ${r.status} (diagnostyka spoza repo pominieta)`);
  }
  return null;
}

function checkPhp(files, root, ctx) {
  for (const f of files) {
    const r = (trustedForExec(root) ? exec : execLimited)('php', ['-l', f], root, ctx);
    if (r.missing) return { skip: r.why };
    if (r.status !== 0) return block('php -l', 'bledy skladni', r.out);
  }
  return null;
}

function checkCSharp(files, root, ctx) {
  if (!trustedForExec(root)) return { skip: 'dotnet: repo poza pg/trusted-roots.txt (MSBuild wykonuje kod)' };
  // Wiele projektow w jednym katalogu = MSB1011 (nie blad kodu) — ktory build jest wlasciwy, wie tylko repo (pg-review code r2).
  const projects = fs.readdirSync(root).filter((n) => /\.csproj$/i.test(n));
  if (projects.length !== 1) return { skip: `dotnet: ${projects.length} projektow .csproj w ${root} (wybor projektu = decyzja repo)` };
  const r = exec('dotnet', ['build', path.join(root, projects[0]), '--nologo', '-v', 'q', '-clp:NoSummary', '--no-restore'], root, ctx, { DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1' });
  if (r.missing) return { skip: r.why };
  if (r.status === 0) return null;
  if (/NETSDK1004|project\.assets\.json|Run a NuGet package restore/i.test(r.out)) return { skip: 'dotnet: brak restore (dotnet restore)' };
  if (/MSB1011|MSB1003|MSB1009/.test(r.out)) return { skip: 'dotnet: MSBuild nie wybral projektu (MSB1011/1003/1009)' };
  return block('dotnet build', 'bledy kompilacji', r.out.split('\n').filter((l) => /: error /.test(l)).join('\n') || r.out);
}

// deno check NIE wykonuje kodu; --no-lock: hook nie dopisuje deno.lock. Poza drzewem cwd/zaufanymi korzeniami bez sieci
// (--cached-only): obcy plik nie moze kazac hookowi pobierac URL-i (pg-review 2026-10-26 security).
function checkDeno(files, root, ctx) {
  // deno check laduje importy (`import "/dev/zero"` = ~3 GB/s do timeoutu; prlimit --as nie dziala na V8) — obcy klon = skip
  // (pg-review security r6). W exec-trust importy wlasnego repo; bez --cached-only (pobranie typow, nie wykonanie).
  if (!trustedForExec(root)) return { skip: 'deno: repo poza pg/trusted-roots.txt (importy bez limitu pamieci)' };
  const r = exec('deno', ['check', '--no-lock', '--quiet', '--', ...files], root, ctx, { DENO_NO_UPDATE_CHECK: '1', NO_COLOR: '1' });
  if (r.missing) return { skip: r.why };
  if (r.status === 0) return null;
  if (/error sending request|failed to fetch|dns error|Import '[^']+' failed|Module not found "(https?|npm|jsr):|Could not find npm package|not found in cache|--cached-only/i.test(r.out)) {
    return { skip: 'deno: brak sieci/zaleznosci do sprawdzenia typow' };
  }
  return block('deno check', 'bledy typow (edge function)', r.out);
}

// Kolejnosc ma znaczenie: pierwszy pasujacy wpis bierze plik. deno = DODATKOWO do sciezki JS w lint-file.js.
const CHECKERS = [
  { id: 'deno', match: isDenoFile, root: (f) => markerRoot('deno.json', 'deno.jsonc')(f) || path.dirname(f), check: checkDeno },
  { id: 'go', match: (f) => ext(f) === '.go', root: markerRoot('go.mod'), check: checkGo },
  { id: 'rust', match: (f) => ext(f) === '.rs', root: markerRoot('Cargo.toml'), check: checkRust },
  { id: 'shell', match: isShellFile, root: gitOrFileDir, check: checkShell },
  { id: 'java', match: (f) => ext(f) === '.java', root: gitOrFileDir, check: checkJava },
  { id: 'c', match: (f) => ['.c', '.cc', '.cpp', '.cxx'].includes(ext(f)), root: gitOrFileDir, check: checkC },
  { id: 'php', match: (f) => ext(f) === '.php', root: gitOrFileDir, check: checkPhp },
  { id: 'csharp', match: (f) => ext(f) === '.cs', root: csprojRoot, check: checkCSharp },
];

// Narzedzia per jezyk — dla guard_health (czy sprawdzacz istnieje na tej maszynie). Wlasciciel listy = ten plik.
const TOOLS = { deno: ['deno'], go: ['go', 'gofmt'], rust: ['cargo'], shell: ['shellcheck'], java: ['javac'], c: ['gcc', 'g++'], php: ['php'], csharp: ['dotnet'] };

const checkerFor = (f) => CHECKERS.find((c) => c.match(f)) || null;
const hasChecker = (f) => Boolean(checkerFor(f));
const isUncheckedCode = (f) => NO_CHECKER_EXTS.has(ext(f));

let prlimitPath; // undefined = jeszcze nie szukano
const findPrlimit = () => {
  if (prlimitPath === undefined) prlimitPath = process.platform === 'linux' && spawnSync('prlimit', ['--version'], { encoding: 'utf8', timeout: 5000 }).status === 0;
  return prlimitPath;
};

// files -> { result: null | blok, checked: liczba realnie sprawdzonych plikow, checkedFiles: ich sciezki absolutne }.
// opts: { skip(why, target), cwd?, env?, deadline? (ms epoch; domyslnie teraz + 100 s) }.
function runCheckers(files, opts) {
  const ctx = { env: opts.env || process.env, cwd: opts.cwd || process.cwd(), deadline: opts.deadline || Date.now() + 100000, prlimit: findPrlimit() };
  const groups = new Map();
  for (const raw of files) {
    const f = path.resolve(raw);
    const c = checkerFor(f);
    if (!c) continue;
    // Symlink do /dev/zero, FIFO, urzadzenia: narzedzie czytaloby bez konca (security r7) — tylko zwykle pliki.
    if (!isFile(f)) { opts.skip(`${c.id}: nie zwykly plik (symlink do urzadzenia/FIFO?) — pominiety`, f); continue; }
    const root = c.root(f);
    if (!root) { opts.skip(`${c.id}: brak katalogu projektu (go.mod/Cargo.toml/.csproj)`, f); continue; }
    if (!trustedForExec(root) && !inside(f, root)) { opts.skip(`${c.id}: plik wskazuje poza repo (symlink) — pominiety`, f); continue; }
    const key = c.id + '\0' + root;
    if (!groups.has(key)) groups.set(key, { c, root, files: [] });
    groups.get(key).files.push(f);
  }
  const checkedFiles = [];
  for (const { c, root, files: group } of groups.values()) {
    let r;
    try { r = c.check(group, root, ctx); } catch (e) { r = { skip: `${c.id}: blad narzedzia (sprawdzacz: ${e.message})` }; }
    if (r && r.skip) { opts.skip(r.skip, root); continue; }
    checkedFiles.push(...group);
    if (r && r.blocked) {
      if (!trustedForExec(root) && !r.safe) r = Object.assign({}, r, { out: trim(redact(r.out, root)) });
      return { result: r, checked: checkedFiles.length, checkedFiles };
    }
  }
  return { result: null, checked: checkedFiles.length, checkedFiles };
}

module.exports = { runCheckers, checkerFor, hasChecker, isUncheckedCode, isShellFile, isDenoFile, repoDiagnostics, redact, trustedForExec, ownRemote, CHECKERS, TOOLS, NO_CHECKER_EXTS };

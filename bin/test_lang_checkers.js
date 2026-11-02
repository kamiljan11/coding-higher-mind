#!/usr/bin/env node
// Testy hooks/lib/lang-checkers.js + integracji w lint-file.js (jezyki poza TS/JS/Python, 2026-10-26).
// Narzedzie nieobecne na maszynie (np. CI bez cargo) = test pominiety z komunikatem, nie zielony bez sprawdzenia.
// Uruchom: node ~/.claude/bin/test_lang_checkers.js
'use strict';
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'lang-checkers-'));
process.env.PG_GATE_LOG = path.join(TMP, 'gates.jsonl');
// Zaufany korzen TYLKO dla tego procesu (trusted-roots.js czyta plik przy require): TMP = wlasne repo (pelne komunikaty,
// cargo/dotnet), UNTRUSTED = obcy klon (redakcja komunikatow, bez narzedzi wykonujacych kod repo).
const TRUSTED = path.join(TMP, 'trusted');
fs.mkdirSync(TRUSTED);
const UNTRUSTED = fs.mkdtempSync(path.join(os.tmpdir(), 'lang-checkers-obcy-'));
// + wpis Windows: na Linuksie NIE jest absolutny i nie moze zaufac `<cwd>/c:/dev` (blocker pg-review security r2)
fs.writeFileSync(path.join(UNTRUSTED, 'roots.txt'), TMP + '\nC:\\dev\n');
process.env.PG_TRUSTED_ROOTS_FILE = path.join(UNTRUSTED, 'roots.txt');
const LIB = path.join(__dirname, '..', 'hooks', 'lib');
const lc = require(path.join(LIB, 'lang-checkers.js'));
const { lintFiles, isCodeFile } = require(path.join(LIB, 'lint-file.js'));

let n = 0;
let skippedTests = 0;
const has = (tool) => spawnSync('sh', ['-c', `command -v ${tool}`], { encoding: 'utf8' }).status === 0;
const it = (name, tools, fn) => {
  const missing = tools.filter((t) => !has(t));
  if (missing.length) { skippedTests++; console.log(`skip ${name} (brak: ${missing.join(', ')})`); return; }
  fn(); n++; console.log('ok   ' + name);
};
const writeIn = (base) => (rel, text) => { const f = path.join(base, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); return f; };
const write = writeIn(TMP);
const writeForeign = writeIn(UNTRUSTED);
const check = (files, cwd) => {
  const skips = [];
  const r = lc.runCheckers([].concat(files), { skip: (why) => skips.push(why), cwd: cwd || TMP });
  return Object.assign({ skips }, r);
};
const gateEvents = () => { try { return fs.readFileSync(process.env.PG_GATE_LOG, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse); } catch (e) { return []; } };

it('go: nieuzywany import = blokada go vet', ['go', 'gofmt'], () => {
  write('go1/go.mod', 'module ex\n\ngo 1.21\n');
  const r = check(write('go1/main.go', 'package main\n\nimport "os"\n\nfunc main() {}\n'));
  assert.ok(r.result && r.result.blocked);
  assert.match(r.result.out, /"os" imported and not used/);
});

it('go: czysty pakiet przechodzi i liczy sie jako sprawdzony', ['go', 'gofmt'], () => {
  write('go2/go.mod', 'module ex\n\ngo 1.21\n');
  const r = check(write('go2/main.go', 'package main\n\nfunc main() {}\n'));
  assert.equal(r.result, null);
  assert.equal(r.checked, 1);
});

it('go: niesformatowany plik = blokada gofmt', ['gofmt'], () => {
  write('go3/go.mod', 'module ex\n\ngo 1.21\n');
  const r = check(write('go3/main.go', 'package main\nfunc main()   {\n}\n'));
  assert.match(r.result.header, /gofmt — pliki niesformatowane/);
});

it('rust: nieuzywana zmienna w edytowanym pliku = blokada', ['cargo'], () => {
  write('trusted/rs1/Cargo.toml', '[package]\nname = "ex"\nversion = "0.1.0"\nedition = "2021"\n');
  const r = check(write('trusted/rs1/src/main.rs', 'fn main() {\n    let unused = 5;\n}\n'));
  assert.ok(r.result && r.result.blocked, JSON.stringify(r));
  assert.match(r.result.out, /unused variable/);
});

it('rust: repo poza trusted-roots = skip (build.rs wykonuje kod), takze gdy to drzewo cwd sesji', [], () => {
  writeForeign('rs2/Cargo.toml', '[package]\nname = "ex"\nversion = "0.1.0"\nedition = "2021"\n');
  // build.rs, ktory by sie wykonal: plik-znacznik = dowod, ze cargo ruszylo
  writeForeign('rs2/build.rs', `fn main() { std::fs::write(${JSON.stringify(path.join(TMP, 'RS_PWNED'))}, "x").unwrap(); }\n`);
  const r = check(writeForeign('rs2/src/main.rs', 'fn main() {}\n'), path.join(UNTRUSTED, 'rs2'));
  assert.equal(r.result, null);
  assert.equal(r.checked, 0);
  assert.match(r.skips.join(), /trusted-roots/);
  assert.equal(fs.existsSync(path.join(TMP, 'RS_PWNED')), false, 'build.rs nie moze sie wykonac');
});

it('shell: plik bez rozszerzenia z shebangiem bash jest sprawdzany (SC2045)', ['shellcheck'], () => {
  const f = write('sh/run', '#!/bin/bash\nfor f in $(ls *.txt); do echo "$f"; done\n');
  assert.equal(lc.isShellFile(f), true);
  const r = check(f);
  assert.match(r.result.out, /SC2045/);
});

it('shell: czysty skrypt przechodzi; shebang python to nie shell', ['shellcheck'], () => {
  assert.equal(check(write('sh/ok.sh', '#!/bin/sh\necho ok\n')).result, null);
  assert.equal(lc.isShellFile(write('sh/tool', '#!/usr/bin/env python3\nprint(1)\n')), false);
});

it('java: blad typu = blokada; brak biblioteki z Mavena = skip', ['javac'], () => {
  const bad = check(write('java/src/main/java/a/A.java', 'package a;\npublic class A { int f() { return "x"; } }\n'));
  assert.match(bad.result.out, /incompatible types/);
  const deps = check(write('java2/src/main/java/a/B.java', 'package a;\nimport org.apache.Foo;\npublic class B {}\n'));
  assert.equal(deps.result, null);
  assert.match(deps.skips.join(), /classpath/);
});

it('c: niezadeklarowana funkcja = blokada; brak naglowka = skip; czysty plik przechodzi', ['gcc'], () => {
  assert.match(check(write('c/bad.c', 'int main(void) { return foo(); }\n')).result.out, /implicit declaration/);
  const hdr = check(write('c2/hdr.c', '#include <nie_ma_tego.h>\nint main(void) { return 0; }\n'));
  assert.equal(hdr.result, null);
  assert.match(hdr.skips.join(), /naglowka/);
  assert.equal(check(write('c3/ok.c', 'int main(void) { return 0; }\n')).result, null);
});

it('c++: blad skladni = blokada g++', ['g++'], () => {
  assert.match(check(write('cpp/a.cpp', 'int main() { return 0 }\n')).result.header, /^g\+\+/);
});

it('deno: blad typu w edge function = blokada', ['deno'], () => {
  const r = check(write('deno/supabase/functions/x/index.ts', 'const n: number = "x";\nconsole.log(n);\n'));
  assert.match(r.result.out, /TS2322/);
  assert.equal(fs.existsSync(path.join(TMP, 'deno', 'supabase', 'functions', 'x', 'deno.lock')), false, 'hook nie moze pisac deno.lock');
});

it('php: blad skladni = blokada (brak php = skip w kodzie, nie blokada)', [], () => {
  const r = check(write('php/a.php', '<?php\necho "x"\n'));
  if (has('php')) assert.match(r.result.out, /Parse error|syntax error/i);
  else { assert.equal(r.result, null); assert.match(r.skips.join(), /tool missing: php/); }
});

it('php: czysty plik przechodzi', ['php'], () => {
  assert.equal(check(write('php2/ok.php', '<?php\necho "x";\n')).result, null);
});

it('c#: brak restore = skip; po restore blad skladni = blokada, czysty kod przechodzi', ['dotnet'], () => {
  const proj = '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net10.0</TargetFramework><OutputType>Library</OutputType></PropertyGroup></Project>\n';
  write('trusted/cs/a.csproj', proj);
  const noRestore = check(write('trusted/cs/A.cs', 'class A { }\n'));
  assert.equal(noRestore.result, null);
  assert.match(noRestore.skips.join(), /restore/);
  const env = Object.assign({}, process.env, { DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1' });
  execFileSync('dotnet', ['restore', '--nologo', '-v', 'q'], { cwd: path.join(TRUSTED, 'cs'), env, stdio: 'pipe', timeout: 120000 });
  const clean = check(path.join(TRUSTED, 'cs', 'A.cs'));
  assert.equal(clean.result, null);
  assert.equal(clean.checked, 1, 'czysty build ma byc sprawdzony, nie pominiety: ' + clean.skips.join());
  const bad = check(write('trusted/cs/A.cs', 'class A { int F() { return 1 } }\n'));
  assert.match(bad.result.out, /error CS1002/);
});

it('c#: repo poza trusted-roots = skip (MSBuild wykonuje kod), takze gdy to drzewo cwd sesji', [], () => {
  writeForeign('cs2/b.csproj', '<Project Sdk="Microsoft.NET.Sdk"></Project>\n');
  const r = check(writeForeign('cs2/B.cs', 'class B { }\n'), path.join(UNTRUSTED, 'cs2'));
  assert.match(r.skips.join(), /trusted-roots/);
});

it('c#: dwa .csproj w katalogu = skip (MSB1011 to nie blad kodu)', ['dotnet'], () => {
  write('trusted/cs3/a.csproj', '<Project Sdk="Microsoft.NET.Sdk"></Project>\n');
  write('trusted/cs3/b.csproj', '<Project Sdk="Microsoft.NET.Sdk"></Project>\n');
  const r = check(write('trusted/cs3/A.cs', 'class A { }\n'));
  assert.equal(r.result, null);
  assert.match(r.skips.join(), /2 projektow/);
});

it('obcy klon: komunikat zredagowany do plik:linia (+kod), symlink na plik spoza repo nie wycieka', ['gcc', 'go', 'shellcheck'], () => {
  const secret = writeForeign('../' + path.basename(UNTRUSTED) + '-sekret.txt', 'FAKE_TOKEN_abc123 x;\n');
  writeForeign('cl/.git/HEAD', 'ref: refs/heads/main\n');
  fs.symlinkSync(secret, path.join(UNTRUSTED, 'cl', 'leak.h'));
  const c = check(writeForeign('cl/a.c', '#include "leak.h"\nint main(void) { return 0; }\n'));
  assert.equal(c.result, null); // C/C++ poza exec-trust = skip (security r5), wiec i bez wycieku
  assert.match(c.skips.join(), /gcc\/g\+\+: repo poza/);
  fs.rmSync(secret, { force: true });
  writeForeign('go5/go.mod', 'module ex\n\ngo 1.21\n');
  const g = check(writeForeign('go5/main.go', 'package main\n\nimport "os"\n\nfunc main() {}\n'));
  assert.equal(g.result, null); // obcy klon: tylko gofmt, go vet = skip (security r6)
  assert.match(g.skips.join(), /go vet: repo poza/);
  const vetOut = lc.redact('# ex\nvet: ./main.go:3:8: "os" imported and not used\n', path.join(UNTRUSTED, 'go5'));
  assert.match(vetOut, /^main\.go:3:8: error$/m);
  assert.doesNotMatch(vetOut, /imported and not used/);
  const sh = check(writeForeign('sh2/run.sh', '#!/bin/bash\nfor f in $(ls *.txt); do echo "$f"; done\n'));
  assert.match(sh.result.out, /run\.sh:2:\d+: \w+ \[SC2045\]/);
});

it('obcy klon: redakcja zostawia lokalizacje dla gofmt -l, bledu skladni gofmt i deno (TS kod z linii wyzej)', ['gofmt', 'deno'], () => {
  writeForeign('gof/go.mod', 'module ex\n\ngo 1.21\n');
  const f = check(writeForeign('gof/fmt.go', 'package main\nfunc main()   {\n}\n'));
  assert.ok(f.result, 'gofmt -l w obcym klonie: ' + JSON.stringify(f.skips));
  assert.match(f.result.out, /fmt\.go/);
  writeForeign('gos/go.mod', 'module ex\n\ngo 1.21\n');
  assert.match(check(writeForeign('gos/syn.go', 'package main\nfunc main( {\n')).result.out, /^syn\.go:2:\d+: error$/m);
  const d = check(writeForeign('den/supabase/functions/f/index.ts', 'const n: number = "x";\nconsole.log(n);\n'));
  assert.equal(d.result, null); // obcy klon: deno = skip (importy bez limitu pamieci, security r6)
  assert.match(d.skips.join(), /deno: repo poza/);
});

it('obcy klon: shellcheck z --norc i limitem pamieci (.shellcheckrc + source=/dev/zero nie zjada RAM), javac = skip (security r6)', ['shellcheck', 'javac'], () => {
  writeForeign('scrc/.git/HEAD', 'ref: refs/heads/main\n');
  writeForeign('scrc/.shellcheckrc', 'external-sources=true\n');
  const t0 = Date.now();
  const r = check(writeForeign('scrc/a.sh', '#!/bin/bash\n# shellcheck source=/dev/zero\nsource ./x\necho hi\n'));
  assert.ok(Date.now() - t0 < 20000, 'za dlugo: ' + (Date.now() - t0));
  assert.ok(!r.result || !/out of memory/.test(r.result.out), JSON.stringify(r));
  assert.doesNotMatch(r.skips.join(), /limit pamieci/); // --norc: .shellcheckrc obcego repo nie wlacza source (bez niego 3,3 GB w 3 s)
  const r2 = check(writeForeign('scrc/b.sh', '#!/bin/bash\n# shellcheck external-sources=true source=/dev/zero\nsource ./x\necho hi\n'));
  assert.ok(Date.now() - t0 < 40000, 'za dlugo (dyrektywa w skrypcie): ' + (Date.now() - t0));
  assert.ok(!r2.result || r2.result.blocked, JSON.stringify(r2));
  const j = check(writeForeign('jx/src/main/java/p/A.java', 'package p;\npublic class A {}\n'));
  assert.equal(j.result, null);
  assert.match(j.skips.join(), /javac: repo poza/);
});

it('redakcja: linia code-frame z trescia pliku spoza repo nie wraca (lokalizacja = istniejacy plik w repo)', [], () => {
  writeForeign('cf/a.ts', 'x\n');
  const out = lc.redact('TS2322 [ERROR]: x\n1 | REDIS_URL=redis://:S3cretPass@cache.internal:6379\n    at file://' + path.join(UNTRUSTED, 'cf/a.ts') + ':1:1\nREDIS_URL=redis://:S3cretPass@cache.internal:6379: error\n', path.join(UNTRUSTED, 'cf'));
  assert.doesNotMatch(out, /S3cret|REDIS/);
  assert.match(out, /^a\.ts:1:1: error \[TS2322\]$/m);
});

it('deno: symlink do pliku spoza repo w obcym klonie — tresc nie wraca (PoC security r4)', ['deno'], () => {
  const out = path.join(UNTRUSTED, 'cf-outside'); fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'secret.env'), 'REDIS_URL=redis://:S3cretPass@cache.internal:6379\n');
  writeForeign('cfd/.git/HEAD', 'ref: refs/heads/main\n');
  fs.mkdirSync(path.join(UNTRUSTED, 'cfd/supabase/functions/f'), { recursive: true });
  fs.symlinkSync(path.join(out, 'secret.env'), path.join(UNTRUSTED, 'cfd/supabase/functions/f/env.ts'));
  const r = check(writeForeign('cfd/supabase/functions/f/index.ts', 'import "./env.ts";\n'));
  assert.doesNotMatch(JSON.stringify(r), /S3cret/);
});

it('go vet: dlug analizatora w NIEedytowanym pliku nie blokuje; blad kompilacji w innym pliku blokuje', ['go', 'gofmt'], () => {
  write('gov/go.mod', 'module ex\n\ngo 1.21\n');
  write('gov/old.go', 'package main\n\nimport "sync"\n\nfunc Old(m sync.Mutex) {}\n');
  assert.equal(check(write('gov/new.go', 'package main\n\nfunc main() {}\n')).result, null);
  const own = check(write('gov/old.go', 'package main\n\nimport "sync"\n\nfunc Old(m sync.Mutex) {}\n'));
  assert.match(own.result.out, /passes lock by value/);
  write('gov2/go.mod', 'module ex\n\ngo 1.21\n');
  write('gov2/old.go', 'package main\n\nfunc helper() { Removed() }\n');
  assert.match(check(write('gov2/new.go', 'package main\n\nfunc main() { helper() }\n')).result.out, /undefined: Removed/);
});

it('go vet: edycja a.go NIE blokuje na dlugu w data.go (sciezka z lokalizacji, nie podciag)', ['go', 'gofmt'], () => {
  write('gov3/go.mod', 'module ex\n\ngo 1.21\n');
  write('gov3/data.go', 'package main\n\nimport "sync"\n\nfunc Old(m sync.Mutex) {}\n');
  assert.equal(check(write('gov3/a.go', 'package main\n\nfunc main() {}\n')).result, null);
});

it('java: pliki z 2 modulow — sourcepath z obu, poprawny kod nie blokuje (code r5)', ['javac'], () => {
  write('jm/m1/src/main/java/p1/B.java', 'package p1;\npublic class B { public static int b() { return 1; } }\n');
  write('jm/m2/src/main/java/p2/D.java', 'package p2;\npublic class D { public static int d() { return 2; } }\n');
  const a = write('jm/m1/src/main/java/p1/A.java', 'package p1;\npublic class A { int x = B.b(); }\n');
  const c = write('jm/m2/src/main/java/p2/C.java', 'package p2;\npublic class C { int y = D.d(); }\n');
  const r = check([a, c]);
  assert.equal(r.result, null, JSON.stringify(r.result));
});

it('cargo workspace: ostrzezenie w innym crate (tez src/lib.rs) nie blokuje edycji crates/a (code r5)', ['cargo'], () => {
  write('ws/Cargo.toml', '[workspace]\nmembers = ["crates/a", "crates/b"]\nresolver = "2"\n');
  write('ws/crates/b/Cargo.toml', '[package]\nname = "b"\nversion = "0.1.0"\nedition = "2021"\n');
  write('ws/crates/b/src/lib.rs', 'fn unused_b() {}\npub fn b() -> i32 { 1 }\n');
  write('ws/crates/a/Cargo.toml', '[package]\nname = "a"\nversion = "0.1.0"\nedition = "2021"\n\n[dependencies]\nb = { path = "../b" }\n');
  const r = check(write('ws/crates/a/src/lib.rs', 'pub fn a() -> i32 { b::b() }\n'));
  assert.equal(r.result, null, JSON.stringify(r.result));
  const own = check(write('ws/crates/b/src/lib.rs', 'fn unused_b() {}\npub fn b() -> i32 { 1 }\n'));
  assert.match(own.result.out, /crates\/b\/src\/lib\.rs.*never used/);
});

it('shell: shebang zsh to nie shell (shellcheck SC1071 = blokada nie do naprawienia)', [], () => {
  assert.equal(lc.isShellFile(write('sh/zs', '#!/usr/bin/env zsh\necho hi\n')), false);
  assert.equal(lc.isShellFile(write('sh/zs2', '#!/bin/zsh\necho hi\n')), false);
  assert.equal(lc.isShellFile(write('sh/ks', '#!/bin/ksh\necho hi\n')), true);
  assert.equal(lc.isShellFile(write('sh/z.sh', '#!/usr/bin/env zsh\nprint -r hi\n')), false); // jak CI (code r7)
  assert.equal(lc.isShellFile(write('sh/b.sh', 'echo bez shebangu\n')), true);
});

it('exec-trust: obcy origin pod zaufanym korzeniem != zaufany; wlasny origin i brak origin = zaufany; wielkosc liter', ['git'], () => {
  const repo = (name, url) => {
    const d = path.join(TMP, name); fs.mkdirSync(d, { recursive: true });
    spawnSync('git', ['init', '-q', d]);
    if (url) spawnSync('git', ['-C', d, 'remote', 'add', 'origin', url]);
    return d;
  };
  const owner = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'pg', 'fleet-scope.json'), 'utf8')).owner; // jak w lang-checkers.js
  assert.equal(lc.trustedForExec(repo('tr-obcy', 'https://gitlab.com/someone/evil.git')), false);
  assert.equal(lc.trustedForExec(repo('tr-github-obcy', 'git@github.com:someone/evil.git')), false);
  assert.equal(lc.trustedForExec(repo('tr-wlasny', `git@github.com:${owner}/x.git`)), true);
  assert.equal(lc.trustedForExec(repo('tr-lokalny')), true);
  // osadzone bare repo ze ZWYKLYCH plikow w podkatalogu obcego klonu, origin = wlasciciel -> NIE zaufany (security r8, blocker)
  const clone = repo('tr-bare', 'https://gitlab.com/someone/evil.git');
  const evil = path.join(clone, 'crates', 'evil');
  for (const d of ['objects', 'refs', 'src']) fs.mkdirSync(path.join(evil, d), { recursive: true });
  fs.writeFileSync(path.join(evil, 'HEAD'), 'ref: refs/heads/main\n');
  fs.writeFileSync(path.join(evil, 'config'), `[core]\n\tbare = true\n[remote "origin"]\n\turl = https://github.com/${owner}/innocent\n`);
  assert.equal(spawnSync('git', ['-C', evil, 'config', '--get', 'remote.origin.url'], { encoding: 'utf8' }).stdout.trim(), `https://github.com/${owner}/innocent`); // bez obrony git bierze bare repo
  assert.equal(lc.trustedForExec(evil), false);
  // podkatalog wlasnego repo (zwykly .git wyzej) dalej zaufany
  const sub = path.join(repo('tr-wlasny2', `git@github.com:${owner}/y.git`), 'crates', 'a'); fs.mkdirSync(sub, { recursive: true });
  assert.equal(lc.trustedForExec(sub), true);
  // remote pod inna nazwa niz origin (clone -o upstream) i fork + upstream obcego = NIE zaufany (security r10, major)
  const ups = repo('tr-upstream'); spawnSync('git', ['-C', ups, 'remote', 'add', 'upstream', 'https://gitlab.com/someone/evil.git']);
  assert.equal(lc.trustedForExec(ups), false);
  const fork = repo('tr-fork', `git@github.com:${owner}/fork.git`); spawnSync('git', ['-C', fork, 'remote', 'add', 'upstream', 'https://github.com/someone/evil.git']);
  assert.equal(lc.trustedForExec(fork), false);
  // symlink spod zaufanego korzenia do katalogu bez gita POZA korzeniem = NIE zaufany (realpath)
  const outside = path.join(UNTRUSTED, 'plain'); fs.mkdirSync(outside, { recursive: true });
  fs.symlinkSync(outside, path.join(TMP, 'tr-link'));
  assert.equal(lc.trustedForExec(path.join(TMP, 'tr-link')), false);
  // repo nadrzedne tez wlasne: submodul / klon wlasciciela w OBCYM superprojekcie = NIE zaufany (security r11, blocker z PoC:
  // cargo czyta .cargo/config.toml przodka); wlasny superprojekt + wlasny submodul = zaufany
  const g = (d, ...a) => spawnSync('git', ['-C', d, '-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'core.hooksPath=/dev/null',
    '-c', 'protocol.file.allow=always', ...a], { encoding: 'utf8' });
  const src = repo('tr-sub-src', `git@github.com:${owner}/lib.git`);
  fs.writeFileSync(path.join(src, 'Cargo.toml'), '[package]\nname = "lib"\n'); g(src, 'add', '.'); g(src, 'commit', '-qm', 'chore: init');
  const withSub = (name, url) => {
    const sp = repo(name, url);
    const r = g(sp, 'submodule', 'add', '-q', src, 'sub');
    assert.equal(r.status, 0, r.stderr);
    g(path.join(sp, 'sub'), 'remote', 'set-url', 'origin', `git@github.com:${owner}/lib.git`);
    assert.match(g(path.join(sp, 'sub'), 'rev-parse', '--absolute-git-dir').stdout, /\/\.git\/modules\/sub/);
    return path.join(sp, 'sub');
  };
  assert.equal(lc.trustedForExec(withSub('tr-sub-obcy', 'https://gitlab.com/someone/evil.git')), false);
  assert.equal(lc.trustedForExec(withSub('tr-sub-wlasny', `git@github.com:${owner}/super.git`)), true);
  const nested = path.join(repo('tr-nest-obcy', 'https://gitlab.com/someone/evil.git'), 'vendor', 'mine');
  fs.mkdirSync(nested, { recursive: true }); spawnSync('git', ['init', '-q', nested]);
  spawnSync('git', ['-C', nested, 'remote', 'add', 'origin', `git@github.com:${owner}/mine.git`]);
  assert.equal(lc.trustedForExec(nested), false);
  // lancuch wlasnych repo: 3 poziomy = zaufany; > MAX_NESTING (8) = fail-closed
  const chain = (name, n) => {
    let d = path.join(TMP, name);
    for (let i = 0; i < n; i++) {
      fs.mkdirSync(d, { recursive: true }); spawnSync('git', ['init', '-q', d]);
      spawnSync('git', ['-C', d, 'remote', 'add', 'origin', `git@github.com:${owner}/r${i}.git`]);
      d = path.join(d, `n${i}`);
    }
    return path.dirname(d);
  };
  assert.equal(lc.trustedForExec(chain('tr-chain8', 8)), true); // granica MAX_NESTING przypieta (code r13)
  assert.equal(lc.trustedForExec(chain('tr-chain9', 9)), false);
  // symlink w OBCYM klonie do wlasnego repo: narzedzie szuka Directory.Build.props po sciezce z symlinkiem (obcy przodek),
  // wiec korzen ze sciezka != realpath = NIE zaufany (security r13, blocker); to samo repo wprost = zaufany
  const mine = repo('tr-mine-cs', `git@github.com:${owner}/mine-cs.git`);
  const host = repo('tr-evil-host', 'https://gitlab.com/someone/evil.git');
  fs.symlinkSync(mine, path.join(host, 'linkcs'));
  assert.equal(lc.trustedForExec(path.join(host, 'linkcs')), false);
  assert.equal(lc.trustedForExec(mine), true);
  // wartosc url z nowa linia (--null): wlasny adres + doklejony obcy w JEDNEJ wartosci = nie wlasny
  const nl = repo('tr-newline');
  spawnSync('git', ['-C', nl, 'config', 'remote.origin.url', `git@github.com:${owner}/x.git\nhttps://gitlab.com/someone/evil.git`]);
  assert.equal(lc.trustedForExec(nl), false);
  assert.equal(lc.ownRemote(`https://x-access-token:abc@github.com/${owner}/x.git`, owner), true);
  assert.equal(lc.ownRemote(`https://github.com/${owner}evil/x`, owner), false);
  assert.equal(lc.ownRemote(`https://github.com/${owner}/x/../../evil/y`, owner), false);
  const { isTrustedDir } = require(path.join(LIB, 'trusted-roots.js'));
  if (process.platform !== 'win32') assert.equal(isTrustedDir(TMP.toUpperCase() + '/x', null), TMP === TMP.toUpperCase());
});

it('c: obcy klon = skip (gcc czyta binarne .gch z repo); zaufany katalog z .gch dalej sprawdzany', ['gcc'], () => {
  writeForeign('pch/a.h', 'int h(int);\n');
  spawnSync('gcc', ['-x', 'c-header', path.join(UNTRUSTED, 'pch/a.h'), '-o', path.join(UNTRUSTED, 'pch/a.h.gch')]);
  writeForeign('pch/a.h', '#error PLAIN_HEADER_READ\n');
  const r = check(writeForeign('pch/a.c', '#include "a.h"\nint main(void) { return h(1); }\n'));
  assert.equal(r.result, null);
  assert.match(r.skips.join(), /gcc\/g\+\+: repo poza/);
  write('pch/b.h', 'int h(int);\n');
  const t = check(write('pch/b.c', 'int main(void) { return x; }\n'));
  assert.ok(t.result && t.result.blocked, JSON.stringify(t));
});

it('plik specjalny: symlink .go/.php do /dev/zero = skip od razu; FIFO bez rozszerzenia nie wiesza wykrywania shebangu (security r7)', ['gofmt'], () => {
  writeForeign('dz/go.mod', 'module ex\n\ngo 1.21\n');
  fs.symlinkSync('/dev/zero', path.join(UNTRUSTED, 'dz', 'a.go'));
  fs.symlinkSync('/dev/zero', path.join(UNTRUSTED, 'dz', 'a.php'));
  const t0 = Date.now();
  const r = check([path.join(UNTRUSTED, 'dz', 'a.go'), path.join(UNTRUSTED, 'dz', 'a.php')]);
  assert.equal(r.result, null);
  assert.ok(r.skips.filter((s) => /nie zwykly plik/.test(s)).length === 2, JSON.stringify(r.skips));
  fs.mkdirSync(path.join(TMP, 'fifo'), { recursive: true });
  spawnSync('mkfifo', [path.join(TMP, 'fifo', 'run')]);
  assert.equal(lc.isShellFile(path.join(TMP, 'fifo', 'run')), false);
  assert.ok(Date.now() - t0 < 5000, 'za dlugo: ' + (Date.now() - t0));
  // zwykly plik spoza repo przez symlink w obcym klonie = skip (tresc spoza repo nie idzie do narzedzia)
  const outside = path.join(UNTRUSTED, 'dz-out.php'); fs.writeFileSync(outside, '<?php echo 1;\n');
  fs.mkdirSync(path.join(UNTRUSTED, 'dz2', '.git'), { recursive: true });
  fs.symlinkSync(outside, path.join(UNTRUSTED, 'dz2', 'b.php'));
  assert.match(check(path.join(UNTRUSTED, 'dz2', 'b.php')).skips.join(), /poza repo/);
});

it('limit pamieci: literal "out of memory" w pliku nie zamienia bledu skladni w skip (code r8)', ['php'], () => {
  const r = check(writeForeign('oomlit/a.php', '<?php\necho "a" "out of memory";\n'));
  assert.ok(r.result && r.result.blocked, JSON.stringify(r));
});

it('c: #include "/dev/zero" konczy sie skipem limitu pamieci (prlimit), nie zjada RAM', ['gcc', 'prlimit'], () => {
  const t0 = Date.now();
  const r = check(write('cz/z.c', '#include "/dev/zero"\nint main(void) { return 0; }\n'));
  assert.equal(r.result, null, JSON.stringify(r));
  assert.match(r.skips.join(), /limit pamieci/);
  assert.ok(Date.now() - t0 < 20000, 'za dlugo');
});

it('lintFiles: edge function Deno liczona w `ran` raz (sciezka JS + deno check)', ['deno'], () => {
  const before = gateEvents().length;
  lintFiles([write('deno2/supabase/functions/y/index.ts', 'const n: number = 1;\nconsole.log(n);\n')], { hook: 'test' });
  const ran = gateEvents().slice(before).filter((e) => e.event === 'ran');
  assert.ok(ran.length && ran.every((e) => e.reason === '1 files'), JSON.stringify(ran));
});

it('trusted-roots: wpis `C:\\dev` na Linuksie nie ufa katalogowi `C:/dev/x` w obcym klonie (cwd sesji)', [], () => {
  const { isTrustedDir } = require(path.join(LIB, 'trusted-roots.js'));
  const evil = path.join(UNTRUSTED, 'clone', 'C:', 'dev', 'evil');
  writeForeign('clone/C:/dev/evil/Cargo.toml', '[package]\nname = "ex"\nversion = "0.1.0"\nedition = "2021"\n');
  writeForeign('clone/C:/dev/evil/build.rs', `fn main() { std::fs::write(${JSON.stringify(path.join(TMP, 'RS_PWNED2'))}, "x").unwrap(); }\n`);
  const prev = process.cwd();
  process.chdir(path.join(UNTRUSTED, 'clone'));
  try {
    assert.equal(isTrustedDir(evil, null), false);
    const r = check(writeForeign('clone/C:/dev/evil/src/main.rs', 'fn main() {}\n'), path.join(UNTRUSTED, 'clone'));
    assert.match(r.skips.join(), /trusted-roots/);
    assert.equal(fs.existsSync(path.join(TMP, 'RS_PWNED2')), false, 'build.rs nie moze sie wykonac');
  } finally { process.chdir(prev); }
  assert.equal(isTrustedDir(path.join(TMP, 'x'), null), true, 'wpis absolutny dalej dziala');
});

it('c: pod prlimit brak kompilatora = skip „tool missing", nie blokada (rc 127)', ['prlimit'], () => {
  const bin = path.join(TMP, 'only-prlimit');
  fs.mkdirSync(bin, { recursive: true });
  fs.symlinkSync(spawnSync('sh', ['-c', 'command -v prlimit'], { encoding: 'utf8' }).stdout.trim(), path.join(bin, 'prlimit'));
  const skips = [];
  const r = lc.runCheckers([write('cnog/a.cpp', 'int main() { return 0; }\n')], { skip: (w) => skips.push(w), cwd: TMP, env: Object.assign({}, process.env, { PATH: bin }) });
  assert.equal(r.result, null, JSON.stringify(r));
  assert.match(skips.join(), /tool missing: g\+\+/);
});

it('bez powloki: nazwa pliku z $(...) / ; / `...` niczego nie wykonuje', [], () => {
  // marker wzgledny: cwd narzedzia = katalog pliku (brak .git), wiec powloka utworzylaby inj/SH_PWNED
  const marker = path.join(TMP, 'inj', 'SH_PWNED');
  const files = [write('inj/a$(touch SH_PWNED).sh', '#!/bin/sh\necho ok\n'), write('inj/b;touch SH_PWNED;.c', 'int main(void){return 0;}\n'),
    write('inj/c`touch SH_PWNED`.php', '<?php echo 1;\n')];
  check(files);
  assert.equal(fs.existsSync(marker), false, 'nazwa pliku zostala wykonana przez powloke');
});

it('gcc: diagnostyka z plikow spoza repo nie wraca do agenta (repoDiagnostics)', [], () => {
  const root = path.join(TMP, 'crepo');
  const out = [`/etc/shadow:1:1: error: expected identifier before 'root'`, `${root}/a.c:3:5: error: 'x' undeclared`,
    '/usr/include/stdio.h:10:2: note: in expansion', `${root}/a.c: In function 'main':`].join('\n');
  const r = lc.repoDiagnostics(out, root);
  assert.match(r, /a\.c:3:5: error/);
  assert.doesNotMatch(r, /shadow|stdio/);
  assert.match(r, /\[1 bledow z plikow spoza repo pominieto\]/);
});

it('c: #include pliku spoza repo — tresc tego pliku nie trafia do wyniku', ['gcc'], () => {
  const secret = write('outside/secret.txt', 'TAJNE_HASLO_123 = 1\n');
  const r = check(write('c4/leak.c', `#include "${secret}"\nint main(void) { return 0; }\n`));
  assert.ok(r.result && r.result.blocked, JSON.stringify(r));
  assert.doesNotMatch(r.result.out, /TAJNE_HASLO_123/);
});

it('budzet hooka: za malo czasu = skip „budzet", narzedzie nie startuje', [], () => {
  const skips = [];
  const r = lc.runCheckers([write('bud/a.sh', '#!/bin/sh\necho ok\n')], { skip: (w) => skips.push(w), cwd: TMP, deadline: Date.now() + 1000 });
  assert.equal(r.result, null);
  assert.equal(r.checked, 0);
  assert.match(skips.join(), /budzet czasu hooka/);
});

it('loop-monitor: edycja .kt = [lang-gap] raz na rozszerzenie w sesji + would_block w telemetrii', [], () => {
  const sid = `test-langgap-${process.pid}`;
  const run = (file) => spawnSync(process.execPath, [path.join(__dirname, '..', 'hooks', 'loop-monitor.js')], {
    input: JSON.stringify({ session_id: sid, tool_name: 'Edit', tool_input: { file_path: file, old_string: 'a', new_string: 'b' }, cwd: TMP }),
    encoding: 'utf8', env: Object.assign({}, process.env), timeout: 15000 });
  try {
    const before = gateEvents().length;
    const first = run(path.join(TMP, 'kt', 'A.kt'));
    assert.equal(first.status, 0);
    assert.match(first.stdout, /\[lang-gap\] Pliki \.kt/);
    assert.ok(gateEvents().slice(before).some((e) => e.hook === 'lang-gap' && e.event === 'would_block' && e.reason === 'no checker for .kt'));
    assert.doesNotMatch(run(path.join(TMP, 'kt', 'B.kt')).stdout, /lang-gap/, 'drugi plik .kt w tej sesji = cisza');
    assert.doesNotMatch(run(path.join(TMP, 'go', 'a.go')).stdout, /lang-gap/, 'jezyk ze sprawdzaczem = brak sygnalu');
    const read = spawnSync(process.execPath, [path.join(__dirname, '..', 'hooks', 'loop-monitor.js')], {
      input: JSON.stringify({ session_id: sid + '-r', tool_name: 'Read', tool_input: { file_path: path.join(TMP, 'kt', 'C.swift') }, cwd: TMP }),
      encoding: 'utf8', env: Object.assign({}, process.env), timeout: 15000 });
    assert.doesNotMatch(read.stdout, /lang-gap/, 'Read to nie edycja');
    fs.rmSync(path.join(os.tmpdir(), `claude-loop-${sid}-r.json`), { force: true });
  } finally {
    fs.rmSync(path.join(os.tmpdir(), `claude-loop-${sid}.json`), { force: true });
  }
});

it('lintFiles: .kt = skip „no checker for .kt", bez falszywego `ran`', [], () => {
  const before = gateEvents().length;
  assert.equal(lintFiles([write('kt/A.kt', 'fun main() {}\n')], { hook: 'test' }), null);
  const events = gateEvents().slice(before);
  assert.ok(events.some((e) => e.event === 'skipped' && /no checker for \.kt/.test(e.reason)), JSON.stringify(events));
  assert.ok(!events.some((e) => e.event === 'ran'), 'kod bez sprawdzacza nie moze dawac `ran`');
});

it('lintFiles: sam .md nie daje `ran` (wczesniej liczony jako sprawdzony plik)', [], () => {
  const before = gateEvents().length;
  lintFiles([write('docs/README.md', '# x\n')], { hook: 'test' });
  assert.ok(!gateEvents().slice(before).some((e) => e.event === 'ran'));
});

it('lintFiles: .go z bledem blokuje tez przez wspolna sciezke hookow', ['go', 'gofmt'], () => {
  write('go4/go.mod', 'module ex\n\ngo 1.21\n');
  const r = lintFiles([write('go4/main.go', 'package main\n\nimport "os"\n\nfunc main() {}\n')], { hook: 'test' });
  assert.ok(r && r.blocked);
});

it('isCodeFile: nowe jezyki i kod bez sprawdzacza = kod; markdown nie', [], () => {
  for (const f of ['a.go', 'a.rs', 'a.java', 'a.c', 'a.cpp', 'a.php', 'a.cs', 'a.kt', 'a.swift', 'a.sh']) assert.equal(isCodeFile(f), true, f);
  assert.equal(isCodeFile('README.md'), false);
});

fs.rmSync(TMP, { recursive: true, force: true });
fs.rmSync(UNTRUSTED, { recursive: true, force: true });
console.log(`\n${n} testow OK, ${skippedTests} pominietych (brak narzedzia)`);

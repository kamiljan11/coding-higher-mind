// Test hooks/lib/changed-lines.js: linie niezacommitowane == to, co git policzy po commicie (`git show --numstat`).
// Przypadek 2026-10-27 (demo-site#100): pg-review krok 0 liczyl tylko `git diff --numstat HEAD`, nieśledzony plik
// wypadal i tier wychodzil T2 zamiast T3. Uruchom: node bin/test_changed_lines.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
// Log bramek do tmp, nie do produkcyjnego gates.jsonl (gate-log czyta PG_GATE_LOG przy require; dziedzicza go dzieci CLI).
process.env.PG_GATE_LOG = path.join(os.tmpdir(), `pg-changed-lines-${process.pid}.jsonl`);
const LIB = path.join(__dirname, '..', 'hooks', 'lib', 'changed-lines.js');
const RISK = path.join(__dirname, '..', 'hooks', 'lib', 'risk-tier.js');
const { uncommittedLines } = require(LIB);

let fail = 0;
function check(name, got, want) {
  const ok = got === want;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: got ${got}, want ${want}`);
}
const git = (cwd, ...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...a], { cwd, encoding: 'utf8' });
const committedLines = (cwd) => git(cwd, 'show', '--numstat', '--format=', 'HEAD').split('\n')
  .map((l) => l.match(/^(\d+|-)\s+(\d+|-)\s/)).filter(Boolean)
  .reduce((s, m) => s + (Number(m[1]) || 0) + (Number(m[2]) || 0), 0);
const cliRc = (args) => {
  try { execFileSync('node', [RISK, ...args], { stdio: 'pipe' }); return 0; } catch (e) { return e.status; }
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-changed-lines-'));
const notRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-changed-lines-norepo-'));
try {
  git(dir, 'init', '-q');
  fs.writeFileSync(path.join(dir, 'a.ts'), 'one\ntwo\nthree\n');
  fs.writeFileSync(path.join(dir, '.gitignore'), 'ignored.ts\n');
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'old.ts'), 'k\nl\nm\nn\n');
  git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'base');

  fs.writeFileSync(path.join(dir, 'a.ts'), 'one\nTWO\nthree\nfour\n');          // sledzony: +2 -1
  fs.writeFileSync(path.join(dir, 'new.ts'), 'x\ny\nz\n');                        // nieśledzony, z \n na koncu: 3
  fs.mkdirSync(path.join(dir, 'e2e'));
  fs.writeFileSync(path.join(dir, 'e2e', 'spec.ts'), 'a\nb');                     // nieśledzony, bez \n na koncu: 2
  fs.writeFileSync(path.join(dir, 'blob.bin'), Buffer.from([1, 0, 2, 10, 3]));   // binarny: 0
  fs.writeFileSync(path.join(dir, 'empty.ts'), '');                               // pusty: 0
  fs.writeFileSync(path.join(dir, 'ignored.ts'), 'q\nq\nq\n');                    // w .gitignore: nie liczony
  git(dir, 'mv', 'src/old.ts', 'src/renamed.ts');                                 // rename (staged) + 1 linia: 1
  fs.appendFileSync(path.join(dir, 'src', 'renamed.ts'), 'o\n');
  git(dir, 'add', 'src/renamed.ts');
  let linked = false;                                                             // symlink nieśledzony: git = 1 linia
  try { fs.symlinkSync('a.ts', path.join(dir, 'link.ts')); linked = true; } catch (e) { console.log('SKIP symlink:', e.code); }

  const before = uncommittedLines(dir);
  check('nieśledzone liczone (cale drzewo)', before, 3 + 3 + 2 + 1 + (linked ? 1 : 0));
  check('rename liczony pod nowa sciezka', uncommittedLines(dir, ['src/renamed.ts']), 1);
  check('filtr: tylko new.ts', uncommittedLines(dir, ['new.ts']), 3);
  check('filtr: sciezka absolutna', uncommittedLines(dir, [path.join(dir, 'e2e', 'spec.ts')]), 2);
  check('root = podkatalog repo (sciezki wzgledem korzenia)',
    uncommittedLines(path.join(dir, 'e2e'), [path.join(dir, 'e2e', 'spec.ts'), path.join(dir, 'a.ts')]), 2 + 3);

  const files = git(dir, 'diff', '--name-only', 'HEAD').split('\n')
    .concat(git(dir, 'ls-files', '--others', '--exclude-standard').split('\n')).filter(Boolean);
  const tier = JSON.parse(execFileSync('node', [RISK, dir, ...files, '--lines', 'auto'], { encoding: 'utf8' }));
  check('risk-tier --lines auto', tier.changedLines, before);
  check('risk-tier --lines <nie-liczba> = exit 2', cliRc([dir, 'a.ts', '--lines', 'atuo']), 2);
  check('risk-tier --lines auto poza repo = exit 2 (blad narzedzia, nie 0 linii)', cliRc([notRepo, 'a.ts', '--lines', 'auto']), 2);

  git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'change');
  check('przed commitem == po commicie (git show --numstat)', before, committedLines(dir));
  check('czyste drzewo po commicie', uncommittedLines(dir), 0);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(notRepo, { recursive: true, force: true });
  fs.rmSync(process.env.PG_GATE_LOG, { force: true });
}
console.log(fail ? `${fail} FAIL` : 'ALL PASS');
process.exit(fail ? 1 : 0);

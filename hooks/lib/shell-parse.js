'use strict';
// Parser powloki dla bash-guard (landscape #13). Reguly regexowe na SUROWEJ komendzie dawaly exit 0 na:
// `sh -c "rm -rf src"`, `x=$(rm -rf src)`, `'r'm -rf src`, `rm${IFS}-rf${IFS}/`, `GIT push --force`, `git\ push --force`,
// `powershell -enc <base64>` (probe'y ECC/DCG/FPA, R1). Ten modul zamienia komende na liste prostych komend
// (argv bez cudzyslowow, z odwinietymi opakowaniami i rekurencja w zagniezdzone powloki), a reguly patrza na argv.
// Czysta funkcja: zero I/O. Limity (rozmiar, glebokosc, czas) -> `overflow`, a bash-guard wtedy blokuje (fail-closed:
// komendy, ktorej nie umiemy przeczytac, nie przepuszczamy slepo).
const MAX_INPUT = 64 * 1024;
const MAX_DEPTH = 4;
const TIME_BUDGET_MS = 200;
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh']);
const PS_SHELLS = new Set(['powershell', 'pwsh']);
// Opakowania, ktore uruchamiaja komende z reszty argumentow (zdejmujemy je, zeby regula widziala wlasciwe argv[0]).
// npx/bunx/pnpx uruchamiaja pakiet z reszty argumentow (weryfikator 2026-09-26: `npx rimraf ~/.claude/hooks`).
// do/then/else/!: slowa kluczowe powloki przed komenda (`for X in a; do rm -rf $X; done`) — regula musi widziec `rm`.
const WRAPPERS = new Set(['busybox', 'setsid', 'flock', 'sudo', 'doas', 'env', 'timeout', 'nice', 'nohup', 'command', 'exec', 'time', 'xargs', 'stdbuf', 'ionice', 'builtin', 'unbuffer', 'npx', 'bunx', 'pnpx', 'do', 'then', 'else', 'elif', '!']);
// Flagi opakowan, ktore biora wartosc (sudo -u root, timeout -s KILL 5, nice -n 10, xargs -I {}, npx -p pkg).
const WRAPPER_VALUE_FLAGS = { env: /^(-C|--chdir|-u|--unset)$/, flock: /^(-w|-E|--timeout|--conflict-exit-code)$/, sudo: /^-(u|g|C|D|h|p|r|t|U)$/, timeout: /^-(s|k)$/, nice: /^-n$/, xargs: /^-(I|L|n|P|s|d|E|a)$/, stdbuf: /^-(i|o|e)$/, ionice: /^-(c|n|p)$/, npx: /^(-p|--package|-c|--call)$/, pnpx: /^(-p|--package)$/, bunx: /^(-p|--package)$/ };
const ASSIGN_RX = /^[A-Za-z_][A-Za-z0-9_]*=/;
// Programy, ktore WYKONUJA tresc heredoca (kod, nie dane).
const INTERPRETERS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'powershell', 'pwsh', 'cmd', 'python', 'python3', 'py', 'node', 'perl', 'ruby', 'deno', 'bun', 'php', 'lua', 'osascript', 'psql', 'sqlite3', 'mysql']);

/** Nazwa programu bez sciezki, rozszerzenia .exe i wielkosci liter: `C:\Git\bin\GIT.EXE` -> `git`. */
const progName = (word) => String(word || '').replace(/^.*[\/\\]/, '').replace(/\.(exe|cmd|bat|com)$/i, '').toLowerCase();

function decodeAnsiC(body) {
  const map = { n: '\n', t: '\t', r: '\r', a: '\x07', b: '\b', e: '\x1b', E: '\x1b', f: '\f', v: '\v', '\\': '\\', "'": "'", '"': '"' };
  return body.replace(/\\(x[0-9a-fA-F]{1,2}|[0-7]{1,3}|.)/g, (m, c) => {
    if (c[0] === 'x') return String.fromCharCode(parseInt(c.slice(1), 16));
    if (/^[0-7]+$/.test(c)) return String.fromCharCode(parseInt(c, 8));
    return Object.prototype.hasOwnProperty.call(map, c) ? map[c] : c;
  });
}

// Czyta `$( ... )` / `` `...` `` od pozycji otwarcia; zwraca { inner, end }. Liczy nawiasy poza cudzyslowami.
function readSubstitution(src, start, closer) {
  let depth = 1;
  let quote = null;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (quote) { if (ch === '\\' && quote === '"') { i++; continue; } if (ch === quote) quote = null; continue; }
    if (ch === '\\') { i++; continue; }
    if (ch === "'" || ch === '"') { quote = ch; continue; }
    if (closer === '`') { if (ch === '`') return { inner: src.slice(start, i), end: i + 1 }; continue; }
    if (ch === '(') depth++;
    else if (ch === ')' && --depth === 0) return { inner: src.slice(start, i), end: i + 1 };
  }
  return { inner: src.slice(start), end: src.length };
}

/**
 * Tokenizacja jednej linii polecen na proste komendy.
 * Zwraca liste { words: [..], redirects: [{ op, target }], subst: [inner...], heredocs: [delim], sep } gdzie
 * `sep` = separator PO komendzie ('|' laczy w pipeline). Komentarz `#` na poczatku slowa ucina reszte linii.
 */
function tokenize(src, notes, dialect) {
  // PowerShell: `\` to zwykly znak (sciezki Windows), znakiem ucieczki jest backtick; backtick NIE jest podstawieniem.
  // cmd.exe: `\` tez zwykly znak. Tylko POSIX sh ma backslash-escape i backtick-podstawienie.
  const ps = dialect === 'ps';
  const posix = !dialect || dialect === 'sh';
  const cmds = [];
  let cur = { words: [], redirects: [], subst: [], heredocs: [], sep: '' };
  let word = '';
  let inWord = false;
  let pendingRedirect = null;
  const flushWord = () => {
    if (!inWord) return;
    if (pendingRedirect) { cur.redirects.push({ op: pendingRedirect, target: word }); pendingRedirect = null; }
    else cur.words.push(word);
    word = ''; inWord = false;
  };
  const flushCmd = (sep) => {
    flushWord();
    cur.sep = sep;
    if (cur.words.length || cur.redirects.length || cur.subst.length) cmds.push(cur);
    cur = { words: [], redirects: [], subst: [], heredocs: [], sep: '' };
  };
  // $IFS / ${IFS} poza pojedynczymi cudzyslowami = separator slow (`rm${IFS}-rf${IFS}/`).
  let s = src.replace(/\$\{IFS\}|\$IFS\b/g, ' ');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ps && ch === '`') {
      const next = s[i + 1];
      if (next === '\n') { i++; continue; }
      if (next !== undefined) { word += next; inWord = true; i++; }
      continue;
    }
    if (posix && ch === '\\') {
      const next = s[i + 1];
      if (next === '\n') { i++; continue; } // kontynuacja linii
      if (next !== undefined) { word += next; inWord = true; i++; continue; }
      continue;
    }
    if (ch === "'") { const end = s.indexOf("'", i + 1); const stop = end < 0 ? s.length : end; word += s.slice(i + 1, stop); inWord = true; i = stop; continue; }
    if (ch === '$' && s[i + 1] === "'") {
      let j = i + 2; let body = '';
      for (; j < s.length && s[j] !== "'"; j++) { if (s[j] === '\\' && j + 1 < s.length) { body += s[j] + s[j + 1]; j++; } else body += s[j]; }
      word += decodeAnsiC(body); inWord = true; i = j; continue;
    }
    if (ch === '"') {
      let j = i + 1;
      for (; j < s.length && s[j] !== '"'; j++) {
        if (ps && s[j] === '`' && j + 1 < s.length) { word += s[j + 1]; j++; continue; }
        if (posix && s[j] === '\\' && /["\\$`]/.test(s[j + 1] || '')) { word += s[j + 1]; j++; continue; }
        if (s[j] === '$' && s[j + 1] === '(') { const r = readSubstitution(s, j + 2, ')'); cur.subst.push(r.inner); word += '$(' + r.inner + ')'; j = r.end - 1; continue; }
        if (posix && s[j] === '`') { const r = readSubstitution(s, j + 1, '`'); cur.subst.push(r.inner); word += '`' + r.inner + '`'; j = r.end - 1; continue; }
        word += s[j];
      }
      inWord = true; i = j; continue;
    }
    if (ch === '$' && s[i + 1] === '(') {
      const r = readSubstitution(s, i + 2, ')');
      cur.subst.push(r.inner); word += '$(' + r.inner + ')'; inWord = true; i = r.end - 1; continue;
    }
    if (posix && ch === '`') { const r = readSubstitution(s, i + 1, '`'); cur.subst.push(r.inner); word += '`' + r.inner + '`'; inWord = true; i = r.end - 1; continue; }
    if (ch === '#' && !inWord) { const nl = s.indexOf('\n', i); if (nl < 0) break; i = nl - 1; continue; }
    if (ch === '<' && s[i + 1] === '<' && s[i + 2] !== '<') {
      // Ogranicznik: EOF, 'EOF', "EOF" albo \EOF (cytowanie backslashem — pgscan 2026-09-26: `<<\EOF` bralo tresc za komendy).
      const m = /^<<-?\s*(['"]|\\)?([A-Za-z_][\w-]*)['"]?/.exec(s.slice(i));
      if (m) {
        flushWord();
        // Tresc heredoca: od konca biezacej linii do linii z samym ogranicznikiem.
        const lineEnd = s.indexOf('\n', i);
        const bodyStart = lineEnd < 0 ? s.length : lineEnd + 1;
        const endRx = new RegExp('^\\s*' + m[2] + '\\s*$', 'm');
        const rest = s.slice(bodyStart);
        const em = endRx.exec(rest);
        const body = em ? rest.slice(0, em.index) : rest;
        cur.heredocs.push({ delim: m[2], body });
        const afterBody = em ? bodyStart + em.index + em[0].length : s.length;
        // Reszta linii z `<<EOF` (np. `| sh`, `> plik`) nadal nalezy do komendy: wycinamy sam operator i tresc heredoca,
        // a parsowanie idzie dalej od reszty linii.
        const tail = lineEnd < 0 ? s.slice(i + m[0].length) : s.slice(i + m[0].length, lineEnd);
        s = s.slice(0, i) + ' ' + tail + '\n' + s.slice(afterBody);
        continue;
      }
    }
    if (ch === '>' || (ch === '<' && s[i + 1] !== '(')) {
      // fd przed `>` (`2>&1`, `2>/dev/null`) — cyfry juz w slowie
      const fdOnly = /^\d$/.test(word) && inWord;
      if (fdOnly) { word = ''; inWord = false; } else flushWord();
      let op = ch;
      if (s[i + 1] === '>') { op += '>'; i++; }
      if (s[i + 1] === '&') { op += '&'; i++; }
      if (s[i + 1] === '|') { i++; }
      pendingRedirect = op;
      continue;
    }
    if (ch === ';' || ch === '\n') { flushCmd(';'); continue; }
    if (ch === '&') { if (s[i + 1] === '&') i++; flushCmd('&'); continue; }
    if (ch === '|') { if (s[i + 1] === '|') { i++; flushCmd('||'); } else flushCmd('|'); continue; }
    if (ch === '(' || ch === ')' || ((ch === '{' || ch === '}') && !inWord)) { flushCmd(';'); continue; }
    if (/\s/.test(ch)) { flushWord(); continue; }
    word += ch; inWord = true;
  }
  flushCmd('');
  if (pendingRedirect) notes.push('dangling-redirect');
  return cmds;
}

// Zdejmuje przypisania `A=1 B=2 cmd` i opakowania (`sudo -u x env Y=1 timeout 5 cmd`).
// Zwraca { argv, assigns: [nazwy], values: { nazwa: wartosc } } — wartosci pozwalaja regulom rozwinac `rm -rf "$D"`.
function unwrap(words) {
  const assigns = [];
  const values = {};
  let chdir = null;
  const via = []; // `env -C X prog` — prog dziala w X (security-review 2026-10-10)
  let i = 0;
  let guard = 0;
  while (i < words.length && guard++ < 50) {
    const w = words[i];
    if (ASSIGN_RX.test(w)) { const eq = w.indexOf('='); assigns.push(w.slice(0, eq)); values[w.slice(0, eq)] = w.slice(eq + 1); i++; continue; }
    const name = progName(w);
    if (!WRAPPERS.has(name)) break;
    via.push(name); // np. busybox: aplet ma inna semantyke niz GNU (code-review 2026-10-10)
    i++;
    const valueFlag = WRAPPER_VALUE_FLAGS[name];
    while (i < words.length && /^-/.test(words[i])) {
      if (words[i] === '--') { i++; break; }
      // env -C / sudo -D (+ klastry `-iC X`, skroty `--ch=`) — security-review r2: inaczej DIR stawal sie argv[0].
      const cdLetter = name === 'env' ? 'C' : name === 'sudo' ? 'D' : null;
      if (cdLetter) {
        const w0 = words[i];
        const longN = /^--[^-=]/.test(w0) ? w0.slice(2).split('=')[0] : '';
        const isLong = longN.length >= 2 && 'chdir'.startsWith(longN);
        const k = /^-[^-]/.test(w0) ? w0.indexOf(cdLetter) : -1;
        if (isLong) { chdir = w0.includes('=') ? w0.slice(w0.indexOf('=') + 1) : (words[i + 1] || ''); i += w0.includes('=') ? 1 : 2; continue; }
        if (k > 0) { chdir = k + 1 < w0.length ? w0.slice(k + 1) : (words[i + 1] || ''); i += k + 1 < w0.length ? 1 : 2; continue; }
      }
      const takesValue = valueFlag && valueFlag.test(words[i]);
      i += takesValue ? 2 : 1;
    }
    if (name === 'timeout' && i < words.length && /^\d+(\.\d+)?[smhd]?$/.test(words[i])) i++;
    // `flock PLIK cmd` — pierwszy argument pozycyjny to plik blokady, nie program (security-review r2).
    if (name === 'flock' && i < words.length && !/^-/.test(words[i])) i++;
  }
  let argv = words.slice(i);
  // `git\ push --force` = jedno slowo "git push" (w bashu: komenda nie istnieje), ale probe R1 liczyl to jako obejscie —
  // rozcinamy, zeby reguly widzialy `git push` niezaleznie od powloki.
  if (argv[0] && /\s/.test(argv[0]) && !/[\/\\]/.test(argv[0])) argv = [...argv[0].split(/\s+/).filter(Boolean), ...argv.slice(1)];
  // PowerShell: `$d = "..."` / `$d="..."` to przypisanie, nie komenda.
  const psAssign = /^\$([A-Za-z_]\w*)(=(.*))?$/.exec(argv[0] || '');
  if (psAssign && (psAssign[2] || argv[1] === '=')) {
    values[psAssign[1]] = psAssign[2] ? psAssign[3] : argv.slice(2).join(' ');
    assigns.push(psAssign[1]);
    return { argv: [], assigns, values, chdir, via };
  }
  return { argv, assigns, values, chdir, via };
}

// PowerShell -EncodedCommand = base64 z UTF-16LE.
function decodePsEncoded(b64) {
  try { return Buffer.from(b64, 'base64').toString('utf16le'); } catch (e) { return ''; }
}

/**
 * Glowne wejscie. Zwraca { commands: [{ argv, prog, assigns, redirects, pipeline, depth, heredoc }], overflow, notes }.
 * `pipeline` = indeks potoku (komendy polaczone `|` maja ten sam numer) — reguly typu `curl | sh` patrza na potok.
 */
function parse(raw, opts) {
  const started = Date.now();
  const notes = [];
  const out = { commands: [], overflow: false, notes };
  const src = String(raw || '');
  if (src.length > MAX_INPUT) { out.overflow = true; notes.push(`input > ${MAX_INPUT} B`); return out; }
  let pipelineId = 0;
  const isShell = (prog) => SHELLS.has(prog) || PS_SHELLS.has(prog) || prog === 'cmd';
  const dialectOf = (prog) => (PS_SHELLS.has(prog) ? 'ps' : prog === 'cmd' ? 'cmd' : 'sh');
  const walk = (text, depth, dialect) => {
    if (out.overflow) return;
    if (depth > MAX_DEPTH) { out.overflow = true; notes.push(`nesting > ${MAX_DEPTH}`); return; }
    if (Date.now() - started > ((opts && opts.budgetMs) || TIME_BUDGET_MS)) { out.overflow = true; notes.push('time budget'); return; }
    const cmds = tokenize(text, notes, dialect);
    // Heredoc to DANE, chyba ze konsumuje go interpreter: `bash <<EOF`, `cat <<EOF | sh`, `pwsh -Command - <<EOF`
    // (design review 2026-09-26: regula „dane poza sh <<" gubila wykonywany kod). Konsument = powloka w tym samym potoku.
    const pipelines = [];
    let group = [];
    for (const c of cmds) { group.push(c); if (c.sep !== '|') { pipelines.push(group); group = []; } }
    if (group.length) pipelines.push(group);
    for (const pipe of pipelines) {
      // Id potoku rezerwowany PRZED zejsciem w `$(...)` — inaczej podstawienie przesuwalo licznik i `cat $(x) | vi f`
      // dawalo `vi` w innym potoku niz `cat` (code-review 2026-10-10).
      const myPipeline = pipelineId++;
      const unwrapped = pipe.map((c) => Object.assign({ c }, unwrap(c.words)));
      const shellInPipe = unwrapped.find((u) => isShell(progName(u.argv[0])));
      for (const { c, argv, assigns, values, chdir, via } of unwrapped) {
        const prog = progName(argv[0]);
        // heredocs[].executed: tresc trafia do interpretera (kod), a nie do pliku (dane) — reguly na surowym tekscie
        // wycinaja DANE (replay 2026-09-26: JSON findings z nazwami sciezek PG w `cat > f <<EOF` = FP).
        const executed = !!shellInPipe || INTERPRETERS.has(prog);
        out.commands.push({ argv, prog, assigns, values, chdir, via, redirects: c.redirects, pipeline: myPipeline, depth, heredocs: c.heredocs.map((h) => ({ body: h.body, executed })) });
        for (const inner of c.subst) walk(inner, depth + 1, dialect === 'ps' ? 'ps' : 'sh');
        if (shellInPipe) for (const h of c.heredocs) walk(h.body, depth + 1, dialectOf(progName(shellInPipe.argv[0])));
        // sh -c "..." / bash -lc "..." / zsh -c
        if (SHELLS.has(prog)) {
          const ci = argv.findIndex((a, k) => k > 0 && /^-[a-zA-Z]*c[a-zA-Z]*$/.test(a));
          if (ci > 0 && argv[ci + 1] !== undefined) walk(argv[ci + 1], depth + 1, 'sh');
        }
        if (prog === 'eval' && argv.length > 1) walk(argv.slice(1).join(' '), depth + 1, 'sh');
        if (prog === 'cmd') {
          const ci = argv.findIndex((a) => /^\/[ck]$/i.test(a));
          if (ci > 0) walk(argv.slice(ci + 1).join(' '), depth + 1, 'cmd');
        }
        if (PS_SHELLS.has(prog)) {
          for (let k = 1; k < argv.length; k++) {
            const a = argv[k];
            if (/^-e(c|nc|ncodedcommand|ncodedc\w*)?$/i.test(a) && argv[k + 1]) { walk(decodePsEncoded(argv[k + 1]), depth + 1, 'ps'); break; }
            if (/^-c(ommand)?$/i.test(a) && argv[k + 1] !== undefined) { walk(argv.slice(k + 1).join(' '), depth + 1, 'ps'); break; }
          }
        }
        if (prog === 'invoke-expression' || prog === 'iex') walk(argv.slice(1).join(' '), depth + 1, 'ps');
      }
    }
  };
  walk(src, 0, (opts && opts.dialect) || 'sh');
  return out;
}

module.exports = { parse, progName, tokenize, unwrap, MAX_INPUT, MAX_DEPTH, INTERPRETERS };

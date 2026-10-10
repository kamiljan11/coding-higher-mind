'use strict';
// Reguly bash-guard jako czysta funkcja (landscape #3/#4/#13/#19/#20). Hook (hooks/bash-guard.js) = cienka powloka:
// wejscie -> evaluate() -> exit code. Dzieki temu pg-eval, pg-mutate (mutanty in-process, bez backdoora w env hooka)
// i pg-replay (realne komendy z transkryptow) testuja TEN SAM kod, ktory blokuje.
//
// Kazda regula ma dwie warstwy, liczone jako UNIA (design review 2026-09-26: parser ma dokladac trafienia, nie gubic):
//  - `legacy(raw, rawNoQuotes)` — regex z v3 (zachowanie sprzed parsera, zawsze enforce, brak regresji recall),
//  - `parsed(cmd, ctx)` — na prostych komendach z lib/shell-parse.js; tryb `mode` ('enforce' | 'observe').
// observe -> event `would_block` w gates.jsonl, komenda przechodzi (#20: nowa regula najpierw zbiera dane o FP).
const fs = require('fs');
const os = require('os');
const { parse, progName } = require('./shell-parse');
const { CONTROL_PLANE } = require('./overrides');
const { normalizePath, isControlPlane, isQualityConfig, isTempPath, isReviewArtifact, CRED_PATH_RX, CLAUDE_DIR } = require('./protected-paths');

const SAFE_DIRS = /^(node_modules|dist|build|out|coverage|\.next|\.nuxt|\.output|\.svelte-kit|\.turbo|\.vite|\.cache|\.parcel-cache|\.angular|__pycache__|\.pytest_cache|\.ruff_cache|\.mypy_cache|\.tmp|tmp)$/i;
const SHELL_PROGS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'powershell', 'pwsh', 'cmd', 'iex', 'invoke-expression']);
const DOWNLOADERS = new Set(['curl', 'wget', 'iwr', 'invoke-webrequest', 'irm', 'invoke-restmethod']);
const OWN_GIT_HOOKS = normalizePath(CLAUDE_DIR + '/git-hooks');
const MUTATING_GIT = new Set(['stash', 'checkout', 'switch', 'reset', 'restore', 'commit', 'push', 'merge', 'rebase', 'apply', 'am', 'cherry-pick', 'revert', 'clean', 'rm', 'mv', 'add', 'tag', 'pull', 'worktree', 'update-ref', 'filter-branch', 'gc', 'prune']);
const WRITE_PROGS = new Set(['rm', 'del', 'erase', 'remove-item', 'ri', 'rmdir', 'rd', 'mv', 'move', 'move-item', 'mi', 'cp', 'copy', 'copy-item', 'cpi', 'tee', 'touch', 'set-content', 'sc', 'add-content', 'ac', 'out-file', 'new-item', 'ni', 'truncate', 'ln', 'install', 'rename-item', 'rni', 'unlink', 'shred', 'dd']);
// Zapis przez interpreter (python -c / node -e / heredoc): slowa API zapisu. Goly `>` liczy parser (redirects), nie ten regex.
// + chronione pliki pg/ (security-review 2026-10-02: `python -c os.remove(...self-approval.off)` przechodzilo).
// + mody (2026-10-09): ~/.claude/plugins, ~/.claude/dev-mods, ~/mods (zakotwiczone w katalogu domowym — `/mods/` w repo projektu to nie PG).
// security-review r2: idiomy domu sa nieskonczone (zmienna h=expanduser('~'), joinpath('mods'), `${HOME}`) — szukamy
// idiomu domu i literalu `mods` w odleglosci do 80 znakow w tej samej instrukcji.
const MOD_TRACE_RX = /(home\(\)|homedir\(\)|env\.home|['"]home['"]\]|getenv\(['"]home['"]\)|expanduser\(['"]~['"]\)|\$\{?home\}?)[^\n]{0,120}?['"/]mods(['"/]|$)|\.claude['"]?\s*[/,)+]\s*['"]?(plugins|dev-mods)\b/;
const CONTROL_TRACE_RX = /(\/home\/[^/'"\s]+|(^|[^\w])([a-z]:)?\/users\/[^/'"\s]+|~|\$home|\$\{home\}|\$env:userprofile|%userprofile%)\/mods\/|\/\.claude\/(hooks|git-hooks|bin|agents|scheduled-tasks|plugins|dev-mods|logs\/(gates|overrides|stop-gate-wm|pg-seen))\b|\/\.claude\/pg\/(trusted-roots\.txt|private-repos\.txt|deny-baseline\.json|settings-hooks\.json|self-approval\.off)|\/\.claude\/settings(\.local)?\.json|\.gitconfig\b|\/\.git\/(config|hooks)\b|profile\.ps1|\/\.(bashrc|bash_profile|zshrc|profile)\b|\.claude['"]?\s*[/,)+]\s*['"]?(hooks|git-hooks|bin|agents|scheduled-tasks|settings|plugins|dev-mods)|(homedir\(\)|home\(\)|['"]home['"]\]|getenv\(['"]home['"]\)|expanduser\(['"]~['"]\))\)?\s*[+/,]\s*['"]\/?mods\b|['"]pg['"]\s*[,)+/]\s*['"](trusted-roots|private-repos|deny-baseline|settings-hooks|self-approval)/;
const API_WRITE_RX = /open\([^)]*['"][wax]\+?b?['"]|\.write_(text|bytes)\(|writeFileSync|appendFileSync|unlinkSync|rmSync|renameSync|copyFileSync|os\.(remove|unlink|rename|replace)\(|shutil\.|\.unlink\(|\.rename\(|Set-Content|Out-File|Add-Content|Remove-Item|Move-Item|Copy-Item/;

// Regula remote-sql-destructive (2026-10-10, 3 rundy recenzji security/code/data). Zwraca true = blok.
// Cel ZDALNY, dopoki nie udowodniono lokalnego; SQL niewidoczny na zdalnym = blok. Rekurencja przez wrappery
// (menedzer sekretow (np. Infisical CLI) `-- psql`, `sh -c '...'`, `docker run img psql`, `npx prisma`): przez wrapper srodowisko (PGHOST,
// DATABASE_URL) jest niewidoczne => cel nieznany, wyjatek `docker exec <kontener>` = baza w kontenerze (lokalna).
const SQL_DESTRUCTIVE = /\bdrop\b|\btruncate\b|\bdelete\s+from\b|\balter\s+table\b[^;]*\b(drop|alter\s+(column\s+)?[\w"]+\s+(set\s+data\s+)?type)\b|\bupdate\s+[\w."]+\s+set\b(?![^;]*\bwhere\b)/i;
const SQL_TOOLS = /^(psql|pg_restore|pgcli|usql|dropdb|supabase|prisma)$/;
// + infisical/doppler/op run -- (wstrzykuja sekrety jak most; eksport publiczny podmienia most na `infisical run --`, CI 1.6.0)
const SQL_WRAPPERS = /^(python3?|infisical|doppler|op|docker|npx|bunx|pnpx|pnpm|yarn|env|timeout|nohup|sudo|nice|ssh|kubectl|sh|bash|zsh|dash)$/;
const SQL_LOCAL = /^(localhost|127\.0\.0\.1|::1|\[::1\]|host\.docker\.internal|\/var\/run\/postgresql|\/tmp)$/i;
function sqlRisk(cmd, ctx, wrapper, depth) {
  if (depth > 3) return false;
  // parser rozpakowuje `npx -y pkg@wersja` do prog = `pkg@wersja`
  if (/@/.test(cmd.prog)) cmd = Object.assign({}, cmd, { prog: cmd.prog.replace(/@[^/]*$/, '') });
  const args = cmd.argv.slice(1);
  if (!SQL_TOOLS.test(cmd.prog)) {
    // Tylko znane wrappery (code-review: `git commit -m "...psql drop..."` byl brany za wykonanie).
    if (!SQL_WRAPPERS.test(cmd.prog)) return false;
    if (/^(sh|bash|zsh|dash)$/.test(cmd.prog)) {
      const ci = args.indexOf('-c');
      const code = ci >= 0 ? args[ci + 1] : '';
      // `docker exec ctr sh -c 'psql ...'` — wyjatek „baza w kontenerze" przechodzi przez powloke (code-review final)
      const w2 = wrapper === 'docker-exec' ? 'docker-exec' : cmd.prog;
      try { return !!code && parse(code).commands.some((sub) => sqlRisk(sub, ctx, w2, depth + 1)); } catch (e) { return false; }
    }
    // `npx -y supabase@latest`, `pnpm dlx supabase` — nazwa pakietu z wersja (ops-review r2)
    const tool = (a) => progName(a).replace(/@[^/]*$/, '');
    const k = args.findIndex((a) => SQL_TOOLS.test(tool(a)) || /^(sh|bash|zsh|dash)$/.test(tool(a)));
    if (k < 0) return false;
    const w = cmd.prog === 'docker' && args[0] === 'exec' ? 'docker-exec' : cmd.prog;
    return sqlRisk(Object.assign({}, cmd, { argv: args.slice(k), prog: tool(args[k]) }), ctx, w, depth + 1);
  }
  if (cmd.prog === 'prisma') {
    return (args[0] === 'migrate' && args[1] === 'reset') || (args[0] === 'db' && args[1] === 'push' && args.includes('--accept-data-loss'));
  }
  if (cmd.prog === 'supabase') {
    const di = args.indexOf('db');
    if (di < 0 || !args.some((a) => /^--(linked|db-url)(=|$)/.test(a))) return false;
    const sub = args[di + 1];
    if (sub === 'reset') return true;
    if (sub === 'query') return args.some((a) => a === '-f' || /^--file(=|$)/.test(a)) || SQL_DESTRUCTIVE.test(args.join(' '));
    return false;
  }
  if (args.some((a) => /^(--version|-V|--help|-\?)$/.test(a))) return false;
  const env = Object.assign({}, ctx.env || {}, cmd.values || {});
  // -c z flagami laczonymi (psql -tAc, -Atc, -qc) i -e (pgcli); wartosci tych flag to SQL, nie adres polaczenia
  const isSqlFlag = (a) => /^(--command|-e|--execute)$/.test(a) || /^-[a-zA-Z]*c$/.test(a) && cmd.prog !== 'pg_restore';
  const sqlIdx = new Set();
  args.forEach((a, k) => { if (isSqlFlag(a)) sqlIdx.add(k + 1); });
  // Wartosci flag NIE-polaczeniowych (plik, zmienne psql, wyjscie, user, port) — `$` w nich nie czyni celu nieznanym
  // (code-review final: `-f tests/$f.sql`, `-v s="$S"` na lokalnym Supabase blokowane).
  const NON_CONN = /^(-f|--file|-v|--set|--variable|-o|--output|-L|--log-file|-P|--pset|-U|--username|-p|--port|-F|--field-separator|-R|--record-separator|-T|--table-attr)$/;
  const skipIdx = new Set();
  // Semantyka psql/usql/pgcli: w dropdb `-f` = --force, w pg_restore `-v` = verbose (bez argumentu) — tam nic nie pomijamy
  // (ops-review e9060fb: `dropdb -f -h <zdalny>` przechodzil). Token adresu (-h, --host, URL) nigdy nie jest pomijany.
  const isConnTok = (a) => /^(-h|--host)/.test(a) || /postgres(ql)?:\/\//i.test(a);
  if (/^(psql|usql)$/.test(cmd.prog)) {
    args.forEach((a, k) => {
      if (NON_CONN.test(a)) { if (!isConnTok(args[k + 1] || '')) skipIdx.add(k + 1); }
      else if (/^-[vfoLPUpFRT]./.test(a) || /^--(set|variable|file|output|username|port)=/.test(a)) skipIdx.add(k);
    });
  }
  const hosts = [];
  let unknown = !!wrapper && wrapper !== 'docker-exec';
  const addFrom = (s) => {
    const url = /postgres(ql)?:\/\/(?:[^@/\s]*@)?(\[[^\]]*\]|[^:/?\s"']*)/i.exec(s);
    if (url) hosts.push(url[2]);
    const q = /[?&](host|hostaddr)=([^&\s"']+)/i.exec(s);
    if (q) hosts.push(decodeURIComponent(q[2]));
    for (const m of s.matchAll(/(?:^|\s)(host|hostaddr)\s*=\s*['"]?([^\s"']+)/gi)) hosts.push(m[2]);
    if (/(?:^|\s)service\s*=/i.test(s)) unknown = true;
  };
  args.forEach((a, k) => {
    if (sqlIdx.has(k) || skipIdx.has(k) || (/^(psql|usql)$/.test(cmd.prog) && NON_CONN.test(a))) return;
    if (/^(-h|--host)$/.test(a)) hosts.push(args[k + 1] || '');
    else if (/^-h./.test(a)) hosts.push(a.slice(2));
    else if (/^--host=/.test(a)) hosts.push(a.slice(7));
    // Zmienne rozwijamy z tej samej linii i srodowiska (code-review r2: 53/58 trafien = lokalny Supabase przez `$U`)
    const v = /\$/.test(a) ? expandVars(a, env) : a;
    if (/\$/.test(v)) unknown = true;
    addFrom(v.replace(/^--dbname=/, ''));
  });
  for (const k of ['PGHOST', 'PGHOSTADDR']) if (env[k]) hosts.push(String(env[k]));
  if (env.PGSERVICE) unknown = true;
  if (env.PGDATABASE && /postgres(ql)?:\/\//i.test(env.PGDATABASE)) addFrom(String(env.PGDATABASE));
  if (!unknown && hosts.every((h) => SQL_LOCAL.test(h))) return false;
  if (cmd.prog === 'dropdb') return true;
  // -Fc = format custom, nie --clean (code-review r2)
  if (cmd.prog === 'pg_restore') return args.some((a) => a === '--clean' || /^-(?!F)[a-zA-Z]*c[a-zA-Z]*$/.test(a));
  // SQL widoczny tylko w -c/--command (psql, usql), -e/--execute (pgcli); reszta (stdin, -f, heredoc, interaktywnie) = niewidoczny
  const sql = [];
  args.forEach((a, k) => { if (isSqlFlag(a)) sql.push(args[k + 1] || ''); else if (/^--(command|execute)=/.test(a)) sql.push(a.split('=').slice(1).join('=')); });
  // + `-f`/`--file` obok `-c` (ops-review r2: `-c "select 1" -f drop.sql` ukrywal plik)
  const fileArg = args.some((a) => a === '-f' || /^--file(=|$)/.test(a) || /^-[a-zA-Z]*f$/.test(a));
  if (!sql.length || fileArg || (cmd.heredocs || []).length || (cmd.redirects || []).some((r) => /^</.test(String(r.op || r)))) return true;
  return sql.some((s) => SQL_DESTRUCTIVE.test(s));
}

// Cele zapisu w kodzie interpretera (python/node w -c/-e albo heredocu). Zwraca { targets, unresolved }:
// unresolved = jest wywolanie zapisu, ktorego argumentu nie da sie ustalic z literalow (os.path.join, f-string...).
function interpreterWrites(code) {
  const vars = {};
  for (const m of code.matchAll(/\b([A-Za-z_]\w*)\s*=\s*(?:Path\()?\s*[rbfu]{0,2}(['"])([^'"\n]{1,300})\2\)?/g)) vars[m[1]] = m[3];
  const resolveArg = (expr) => {
    const a = String(expr || '').trim();
    const lit = /^[rbfu]{0,2}(['"])(.*)\1$/.exec(a);
    if (lit) return lit[2];
    const wrapped = /^(?:Path|pathlib\.Path|str)\((.+)\)$/.exec(a);
    if (wrapped) return resolveArg(wrapped[1]);
    return /^[A-Za-z_]\w*$/.test(a) && vars[a] !== undefined ? vars[a] : null;
  };
  const args = [];
  const patterns = [
    /\bopen\(\s*([^,()]+(?:\([^()]*\))?)\s*,\s*(?:mode\s*=\s*)?[rbfu]{0,2}['"][rb]?[wax]/g,
    /\b(?:writeFileSync|appendFileSync|unlinkSync|rmSync|renameSync|copyFileSync|rmdirSync)\(\s*([^,()]+(?:\([^()]*\))?)/g,
    /\bos\.(?:remove|unlink|rename|replace|rmdir|removedirs)\(\s*([^,()]+(?:\([^()]*\))?)/g,
    /\bshutil\.\w+\(\s*[^,()]+\s*,\s*([^,()]+(?:\([^()]*\))?)/g,
    /\bshutil\.(?:rmtree|move)\(\s*([^,()]+(?:\([^()]*\))?)/g,
    /([A-Za-z_][\w.]*(?:\([^()]*\))?)\.(?:write_text|write_bytes|unlink|rename|replace|rmdir|touch)\(/g,
  ];
  for (const rx of patterns) for (const m of code.matchAll(rx)) args.push(m[1]);
  const targets = [];
  let unresolved = false;
  for (const a of args) {
    const v = resolveArg(a);
    if (v === null) unresolved = true;
    else targets.push(v);
  }
  // Zapis przez PowerShell/cmdlety w tresci (Set-Content -Path x) liczy parser; tu tylko API interpreterow.
  if (!args.length && /Set-Content|Out-File|Add-Content|Remove-Item|Move-Item|Copy-Item/.test(code)) unresolved = true;
  return { targets, unresolved };
}

// ---------- helpery na prostej komendzie ----------
const flagsOf = (argv) => argv.slice(1).filter((a) => /^-/.test(a));
const shortCluster = (a, letter) => new RegExp('^-[a-zA-Z]*' + letter + '[a-zA-Z]*$').test(a);

// git [globalne opcje] <sub> [args]. Zwraca { sub, args, cwdOpt, configs: ['k=v'] } albo null.
// Wartosci `--config-env=klucz=VAR` i `--config-env klucz=VAR` (pusta wartosc po `=` -> nastepny argument).
function configEnvValues(argv) {
  const out = [];
  argv.forEach((a, i) => {
    if (a === '--config-env') out.push(argv[i + 1] || '');
    else if (a.startsWith('--config-env=')) out.push(a.slice('--config-env='.length) || argv[i + 1] || '');
  });
  return out;
}

function gitParts(cmd) {
  if (cmd.prog !== 'git') return null;
  const a = cmd.argv;
  const configs = [];
  const extraDirs = [];
  let cwdOpt = null;
  let i = 1;
  while (i < a.length && /^-/.test(a[i])) {
    if (a[i] === '-C') { cwdOpt = a[i + 1]; i += 2; continue; }
    if (a[i] === '-c') { configs.push(a[i + 1] || ''); i += 2; continue; }
    // --config-env=KLUCZ=ZMIENNA ustawia config z env (security-review 2026-09-26: core.hooksPath tak omijal bramke).
    if (/^--config-env=/.test(a[i])) { configs.push(a[i].slice('--config-env='.length)); i++; continue; }
    if (a[i] === '--config-env') { configs.push(a[i + 1] || ''); i += 2; continue; }
    // --git-dir/--work-tree wskazuja repo tak samo jak -C (security-review 2026-09-26: `git --work-tree ~/.claude merge` omijal regule).
    const dirOpt = /^--(git-dir|work-tree)(?:=(.*))?$/.exec(a[i]);
    if (dirOpt) { extraDirs.push(dirOpt[2] !== undefined ? dirOpt[2] : (a[i + 1] || '')); i += dirOpt[2] !== undefined ? 1 : 2; continue; }
    if (/^--(namespace|exec-path)$/.test(a[i])) { i += 2; continue; }
    i++;
  }
  let sub = String(a[i] || '').toLowerCase();
  let args = a.slice(i + 1);
  // Alias z `-c alias.X=...` rozwijamy do prawdziwej podkomendy (weryfikator 2026-09-26: `git -c alias.c=commit c
  // --no-verify` omijal no-verify). Alias powloki (`!...`) lapie regula git-alias.
  const alias = configs.map((kv) => /^alias\.([^=]+)=(.*)$/i.exec(kv)).find((m) => m && m[1].toLowerCase() === sub);
  if (alias && !/^\s*!/.test(alias[2])) {
    const words = alias[2].trim().split(/\s+/);
    sub = String(words[0] || '').toLowerCase();
    args = [...words.slice(1), ...args];
  }
  return { sub, args, cwdOpt, configs, extraDirs };
}

// Argumenty git commit, ktore biora wartosc (wartosc nie jest flaga): -m "msg -n" nie moze udawac --no-verify.
const COMMIT_VALUE_OPTS = /^(-m|-F|-C|-c|-t|--message|--file|--author|--date|--template|--reuse-message|--reedit-message|--fixup|--squash|--trailer|--cleanup)$/;
function commitFlags(args) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (COMMIT_VALUE_OPTS.test(a)) { i++; continue; }
    if (/^-[a-zA-Z]+$/.test(a) && /[mFCct]$/.test(a)) { out.push(a); i++; continue; } // -am "msg": wartosc po klastrze
    if (/^-/.test(a)) out.push(a);
  }
  return out;
}

const targetsOf = (argv) => argv.slice(1).filter((a) => !/^-/.test(a) && !/^\/[a-zA-Z]$/.test(a));
// PowerShell/cmd: przelaczniki (-Recurse, -Force, /s /q) nie biora wartosci; -Path/-LiteralPath biora cel;
// pozostale flagi z wartoscia (-ErrorAction Stop, -Include *.x) — wartosc NIE jest celem.
const PS_SWITCHES = /^-(r(e(c(u(r(se?)?)?)?)?)?|force|f|confirm(:\$\w+)?|whatif|verbose|debug|nonewline)$/i;
function winTargets(argv) {
  const out = [];
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (/^\/[a-zA-Z]$/.test(a) || PS_SWITCHES.test(a)) continue;
    if (/^-(path|literalpath)$/i.test(a)) { if (argv[i + 1]) out.push(argv[i + 1]); i++; continue; }
    if (/^-/.test(a)) { i++; continue; }
    out.push(a);
  }
  return out;
}

// Rozwija `$D`, `${D}`, `$env:D`, `%D%` z przypisan w TEJ SAMEJ komendzie (replay 2026-09-26: `$d = "$env:TEMP\x";
// Remove-Item -Recurse $d` = sprzatanie tempa, a bez rozwiniecia wygladalo na kasowanie nieznanego). TEMP/TMP/TMPDIR -> %TEMP%.
function expandVars(raw, env) {
  const lookup = (name) => {
    // Przypisanie w TEJ komendzie wygrywa (security-review 2026-09-26: `TMPDIR=/home; rm -rf $TMPDIR` = „bezpieczny temp").
    const key = Object.keys(env || {}).find((k) => k.toLowerCase() === name.toLowerCase());
    if (key === undefined) return /^(TEMP|TMP|TMPDIR)$/i.test(name) ? os.tmpdir() : null;
    const v = String(env[key]);
    if (/\$\(\s*mktemp\b|New-TemporaryFile|GetTempPath/i.test(v)) return os.tmpdir() + '/mktemp';
    const join = /^Join-Path\s+(\S+)\s+(\S+)/i.exec(v); // `$d = Join-Path $env:TEMP "x"` (PowerShell)
    return join ? join[1] + '/' + join[2] : v;
  };
  let out = String(raw);
  for (let pass = 0; pass < 3; pass++) {
    const next = out.replace(/\$env:([A-Za-z_]\w*)|\$\{([A-Za-z_]\w*)\}|\$([A-Za-z_]\w*)|%([A-Za-z_]\w*)%/g, (m, a, b, c, d) => {
      const v = lookup(a || b || c || d);
      return v === null ? m : v;
    });
    if (next === out) break;
    out = next;
  }
  return out;
}

function isSafeRmTarget(rawTarget, ctx) {
  const raw = expandVars(rawTarget, ctx.env);
  if (/\$\(|`/.test(raw)) return false; // cel z podstawieniem = nie wiemy, co skasujemy
  if (/\.tsbuildinfo$/i.test(raw)) return true;
  if (/^\$/.test(raw)) return false;
  const norm = normalizePath(raw, ctx.cwd).replace(/\/+$/, '');
  if (isTempPath(norm)) return true;
  const segs = norm.split('/').filter(Boolean);
  if (!segs.length) return false;
  const last = segs[segs.length - 1];
  if (last === '*' && segs.length > 1) return SAFE_DIRS.test(segs[segs.length - 2]);
  return SAFE_DIRS.test(last);
}

// Cele zapisu prostej komendy: przekierowania + argumenty programow zapisujacych (+ sed -i / perl -i).
// cp/copy/install/ln: zapisywany jest TYLKO cel (ostatni argument albo -Destination); zrodlo sie tylko czyta
// (replay 2026-09-26: `cp szablon/eslint.config.mjs .` liczylo zrodlo jako zapis). mv: oba — zrodlo znika.
// Bez grep/rg/awk/sed: ich pierwszy argument to WZORZEC (replay: grep '"cat ~/.ssh/id_rsa"' w korpusie testow = FP).
const READ_PROGS = new Set(['cat', 'type', 'get-content', 'gc', 'less', 'more', 'head', 'tail', 'bat', 'cp', 'copy', 'copy-item', 'scp', 'base64', 'xxd', 'od', 'strings', 'curl', 'certutil']);
const COPY_PROGS = new Set(['cp', 'copy', 'copy-item', 'cpi', 'install', 'ln']);
function writeTargets(cmd, env) {
  const out = cmd.redirects.filter((r) => /^>>?$/.test(r.op)).map((r) => r.target);
  if (COPY_PROGS.has(cmd.prog)) {
    const di = cmd.argv.findIndex((a) => /^-destination$/i.test(a));
    const targets = di > 0 ? [cmd.argv[di + 1]] : targetsOf(cmd.argv).slice(-1);
    out.push(...targets.filter(Boolean));
  } else if (WRITE_PROGS.has(cmd.prog)) out.push(...(/^(remove-item|ri|set-content|sc|add-content|ac|out-file|new-item|ni|move-item|mi|rename-item|rni)$/.test(cmd.prog) ? winTargets(cmd.argv) : targetsOf(cmd.argv)));
  if ((cmd.prog === 'sed' && cmd.argv.some((a) => /^(-i|--in-place)/.test(a) || /^-[a-zA-Z]*i/.test(a))) ||
      (cmd.prog === 'perl' && cmd.argv.some((a) => /^-[a-zA-Z]*i/.test(a)))) out.push(...targetsOf(cmd.argv).slice(1));
  // Kolejne programy zapisujace (security-review 2026-09-26): robocopy/xcopy (cel = 2. argument), tar -C/--directory,
  // curl -o, wget -O, iwr -OutFile, mklink (sciezka linku), New-Item -Path przy -ItemType SymbolicLink/Junction.
  const valueOf = (rx) => { const i = cmd.argv.findIndex((a) => rx.test(a)); if (i < 0) return null; const eq = cmd.argv[i].indexOf('='); return eq > 0 ? cmd.argv[i].slice(eq + 1) : cmd.argv[i + 1]; };
  if (/^(robocopy|xcopy)$/.test(cmd.prog)) out.push(...targetsOf(cmd.argv).slice(1, 2));
  if (cmd.prog === 'tar') { const d = valueOf(/^(-C|--directory(=.*)?)$/); if (d) out.push(d); }
  if (cmd.prog === 'curl') { const o = valueOf(/^(-o|--output(=.*)?)$/); if (o) out.push(o); }
  if (cmd.prog === 'wget') { const o = valueOf(/^(-O|--output-document(=.*)?)$/); if (o) out.push(o); }
  if (/^(invoke-webrequest|iwr|invoke-restmethod|irm)$/.test(cmd.prog)) { const o = valueOf(/^-outfile$/i); if (o) out.push(o); }
  if (cmd.prog === 'mklink') out.push(...cmd.argv.slice(1).filter((a) => !/^\/[dhj]$/i.test(a)).slice(0, 1));
  // weryfikator 2026-09-26: unzip -d, 7z -o, rsync (cel = ostatni argument), rimraf/trash/del-cli, New-Item jako link.
  if (cmd.prog === 'unzip') { const d = valueOf(/^-d$/); if (d) out.push(d); }
  if (/^(7z|7za)$/.test(cmd.prog)) { const o = cmd.argv.find((a) => /^-o./.test(a)); if (o) out.push(o.slice(2)); }
  if (cmd.prog === 'rsync') out.push(...targetsOf(cmd.argv).slice(-1));
  if (/^(rimraf|trash|del-cli|premove)$/.test(cmd.prog)) out.push(...targetsOf(cmd.argv));
  if (/^(new-item|ni)$/.test(cmd.prog) && cmd.argv.some((a) => /^(symboliclink|junction|hardlink)$/i.test(a))) { const p = valueOf(/^-(path|name)$/i); if (p) out.push(p); }
  // weryfikator 2026-09-26 (runda 2): dd of=, patch -d/-o, Expand-Archive -DestinationPath, ln -s (link ORAZ cel —
  // link do warstwy kontrolnej = zapis przez alias sciezki).
  if (cmd.prog === 'dd') { const o = cmd.argv.find((a) => /^of=/.test(a)); if (o) out.push(o.slice(3)); }
  if (cmd.prog === 'patch') {
    const d = valueOf(/^(-d|--directory(=.*)?|-o|--output(=.*)?)$/); if (d) out.push(d);
    // -oPLIK sklejone i skroty `--out=` (security-review r2 2026-10-10)
    out.push(...optValues(cmd.argv, 'o', { name: 'output', min: 2 }, 'BDdFgiopVYrzx'));
    // `patch PLIK < p.diff` — pierwszy operand to plik patchowany in place (code-review 2026-09-26: galaz bez testu, nie lapala).
    const operand = cmd.argv.slice(1).find((a, i, arr) => !/^-/.test(a) && !/^(-d|-o|-i|-p\d*|--directory|--output|--input)$/.test(arr[i - 1] || ''));
    if (operand) out.push(operand);
  }
  // ed/ex: operand edytowany in place (security-review 2026-10-10: `cd ~/.claude/hooks && ed x.js < s` przechodzil).
  if (/^(ed|red|ex)$/.test(cmd.prog)) out.push(...targetsOf(cmd.argv));
  if (/^(expand-archive)$/.test(cmd.prog)) { const d = valueOf(/^-destinationpath$/i); if (d) out.push(d); }
  if (cmd.prog === 'ln') out.push(...targetsOf(cmd.argv));
  return out.filter(Boolean).map((t) => expandVars(t, env));
}

// Zapis WZGLEDEM CWD bez sciezki w argumentach (security-review 2026-10-10 r1+r2, code-review r2). Regula KLASOWA — czytanie
// naglowkow latki bylo kruche (opcje z argumentem, rename gita, C-quoting, >200 KB, pipe z katalogu nad ~/.claude):
// - patch / rozpakowanie archiwum (tar x, unzip, 7z x/e, cpio -i): katalog roboczy (cwd, -d/-C/-o/-D, takze w klastrach
//   `-Nd ..` i skrotach `--dir=`) W ~/.claude albo NAD nim (~, /home, /) = blokada bez wzgledu na tresc. GNU patch >= 2.7
//   odrzuca sciezki absolutne i `..`; GNU tar zdejmuje wiodacy `/` i odrzuca `..` (bez -P) — spoza drzewa nie dosiegna PG.
//   `patch --dry-run`, `tar t`, `unzip -l/-t/-p/-v/-Z` (bez zapisu) przepuszczone.
// - ed/red/ex i vi/vim/nvim w trybie skryptu: `w /abs/sciezka` dziala z dowolnego cwd — skrypt (heredoc, here-string, `< plik`,
//   -c/--cmd/+cmd, -S/-u/-l plik) musi byc przegladalny i bez sladu PG; nieprzegladalny (pipe) albo w/nad ~/.claude = blokada.
const cwdInClaude = (cwd) => { const p = normalizePath(cwd), c = normalizePath(CLAUDE_DIR); return p === c || p.startsWith(c + '/'); };
const aboveClaude = (cwd) => { const p = normalizePath(cwd).replace(/\/+$/, ''), c = normalizePath(CLAUDE_DIR); return p === '' || c.startsWith(p + '/'); };
// Prawdziwa sciezka (symlink katalogu, /proc/self/root/...): realpath najdluzszego istniejacego prefiksu + reszta.
function realish(p) {
  let head = normalizePath(p), tail = '';
  for (let guard = 0; head && guard < 64; guard++) {
    try { return (fs.realpathSync(head) + tail).replace(/\/+/g, '/'); } catch (e) { /* nie istnieje — krok w gore */ }
    const k = head.lastIndexOf('/');
    if (k <= 0) break;
    tail = head.slice(k) + tail; head = head.slice(0, k);
  }
  return normalizePath(p);
}
const nearClaude = (cwd) => { const r = realish(cwd); return cwdInClaude(cwd) || aboveClaude(cwd) || cwdInClaude(r) || aboveClaude(r); };
// Dluga opcja `a` = `--<prefiks nazwy name>` (getopt_long przyjmuje jednoznaczne skroty), min = najkrotszy jednoznaczny prefiks.
const isLongOpt = (a, name, min) => { if (!/^--[^-]/.test(a)) return false; const n = a.slice(2).split('=')[0]; return n.length >= min && name.startsWith(n); };
// Wartosc opcji jak w getopt: krotka w klastrze (`-Nd ..`, `-dX`) albo dluga (`--dir=X`, `--directory X`); ostatnia wygrywa.
// argShorts = litery krotkich opcji biorace argument (potrzebne do poprawnego ciecia klastra).
function optValue(argv, short, long, argShorts) { const all = optValues(argv, short, long, argShorts); return all.length ? all[all.length - 1] : null; }
function optValues(argv, short, long, argShorts) {
  const vals = [];
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') break;
    if (long && isLongOpt(a, long.name, long.min)) { vals.push(a.includes('=') ? a.slice(a.indexOf('=') + 1) : (argv[++i] || '')); continue; }
    if (/^-[^-]/.test(a)) {
      for (let k = 1; k < a.length; k++) {
        if (!argShorts.includes(a[k])) continue;
        const v = k + 1 < a.length ? a.slice(k + 1) : (argv[++i] || '');
        if (a[k] === short) vals.push(v);
        break;
      }
    }
  }
  return vals;
}
const EDITOR_SCRIPT_PROGS = /^(ed|red|ex|vi|vim|nvim|view|rvim|rview|vimdiff|evim|editor|sensible-editor)(\.\w+)?$/;
function cwdRelativeWriteHits(cmd, ctx) {
  const argv = cmd.argv;
  const baseOf = (dir) => (dir !== null ? normalizePath(expandVars(dir, ctx.env), ctx.cwd) : ctx.cwd);
  // Cwd niepewny (cel cd nieznany) => kazdy zapis wzgledem cwd z tej klasy = blokada (fail-closed).
  const unsure = ctx.cwdKnown === false;
  // Aplety busybox maja inna semantyke niz GNU (patch przyjmuje sciezki absolutne i `..`) — blok zawsze (security r3);
  // PRZED galezia edytorow, inaczej `busybox vi/ed` konczyly sie w niej (code-review fa3cacb).
  if ((cmd.via || []).includes('busybox') && /^(patch|tar|cpio|unzip|vi|ed|sed)$/.test(cmd.prog)) return true;
  if (EDITOR_SCRIPT_PROGS.test(cmd.prog)) {
    const scripted = /^(ed|red|ex)(\.\w+)?$/.test(cmd.prog) || argv.slice(1).some((a, i, arr) => a === '-c' || a === '-S' || a === '-l' || isLongOpt(a, 'cmd', 3)
      || (a === '-u' && !/^(NONE|NORC|DEFAULTS)$/.test(arr[i + 1] || ''))
      || /^\+./.test(a) || (/^-[eEsnNRXZ]+$/.test(a) && /[eEs]/.test(a)));
    const stdinFed = ctx.piped || (cmd.redirects || []).some((r) => r.op === '<' || r.op === '<<<') || (cmd.heredocs || []).length > 0;
    if (unsure || nearClaude(ctx.cwd)) return true; // w/nad ~/.claude kazdy edytor (security r3: vim bez tty wykonuje klawisze ze stdin)
    if (!scripted && !stdinFed) return false; // interaktywny vi/vim — plik PG w operandzie lapie writeTargets
    if (ctx.piped) return true; // klawisze z potoku nieprzegladalne
    const texts = (cmd.heredocs || []).map((h) => h.body || '');
    // `<<< ',p'` parser zapisuje jako `<` z tekstem w miejscu pliku: nieistniejacy plik = analizujemy sam tekst (gdy to
    // naprawde brakujacy plik, powloka i tak nie uruchomi edytora). Pipe nie jest przekierowaniem -> tekst pusty -> blok.
    for (const r of cmd.redirects || []) { if (r.op === '<' || r.op === '<<<') texts.push(readSmall(r.target, ctx) || String(r.target || '')); }
    argv.forEach((a, i) => {
      const next = argv[i + 1] || '';
      if (a === '-c' || isLongOpt(a, 'cmd', 3)) texts.push(a.includes('=') ? a.slice(a.indexOf('=') + 1) : next);
      else if (/^\+./.test(a)) texts.push(a.slice(1));
      else if (a === '-S' || a === '-l' || (a === '-u' && !/^(NONE|NORC|DEFAULTS)$/.test(next))) texts.push(next, readSmall(next, ctx) || '\u0000');
    });
    const text = texts.join('\n');
    if (!text.trim() || text.includes('\u0000')) return true; // skrypt nieprzegladalny (pipe, nieczytelny plik -S/-u/-l)
    return CONTROL_TRACE_RX.test(text.replace(/\\+/g, '/').toLowerCase()) || /(^|[\s'"=])(\/home\/[^/\s]+\/\.claude|~\/\.claude|\$HOME\/\.claude)(\/|\s|$)/i.test(text);
  }
  if (cmd.prog === 'patch') {
    // Bez wyjatku dla --dry-run (security r2: `-r --dry-run` = wartosc opcji, patch i tak zapisuje). Kazde -d to chdir
    // WZGLEDEM poprzedniego (`-d ~ -d .claude`) — skladamy po kolei.
    if (unsure) return true;
    let base = ctx.cwd;
    for (const d of optValues(argv, 'd', { name: 'directory', min: 2 }, 'BDdFgiopVYrzx')) base = normalizePath(expandVars(d, ctx.env), base);
    if (nearClaude(base)) return true;
    if (/\/\.(git|claude)(\/|$)/.test(normalizePath(base))) return true; // `-d .git` / `cd .git && patch` (code-review)
    // W KAZDYM repo GNU patch zapisze `.git/config` (lokalny core.hooksPath = wylaczone bramki PG) i `.claude/settings.json`
    // (hooki projektu = kod w nastepnej sesji) — sandbox 2026-10-10; `git apply` odmawia („invalid path"). Latka musi byc
    // przegladalna (heredoc, `<`, -i) i bez `.git/`/`.claude/` ani escape'ow nazw; inaczej blok (0 uzyc `patch` w transkryptach).
    const inFile = optValue(argv, 'i', { name: 'input', min: 2 }, 'BDdFgiopVYrzx');
    const texts = (cmd.heredocs || []).map((h) => h.body || '');
    if (inFile !== null) texts.push(readSmall(inFile, ctx));
    for (const r of cmd.redirects || []) if (r.op === '<' || r.op === '<<<') texts.push(readSmall(r.target, ctx));
    const txt = texts.join('\n');
    if (!txt.trim()) return true;
    return /(^|[\s/"'])\.(git|claude)\//m.test(txt) || /\\[0-7]{3}|\\x[0-9a-f]{2}/i.test(txt);
  }
  // Archiwa z czlonkami absolutnymi / `../` pisza poza katalog docelowy (security r3): blok niezaleznie od cwd.
  if ((cmd.prog === 'tar' || cmd.prog === 'bsdtar') && argv.some((a) => isLongOpt(a, 'absolute-names', 3) || (/^-[^-]/.test(a) && /P/.test(a.split(/[fCbTXKNLVgHI]/)[0])) || (a === argv[1] && !/^-/.test(a) && /P/.test(a)))) return true;
  if (cmd.prog === 'cpio' && !argv.some((a) => isLongOpt(a, 'no-absolute-filenames', 4))) {
    if (argv.some((a) => (/^-[^-]/.test(a) && /i/.test(a.split(/[DFHIMORE]/)[0])) || isLongOpt(a, 'extract', 3))) return true; // GNU cpio -i zachowuje sciezki absolutne
  }
  if (cmd.prog === 'unzip' && argv.some((a) => /^-[a-zA-Z]*:/.test(a))) return true;
  if (/^(7z|7za|7zz|7zr)$/.test(cmd.prog) && argv.some((a) => /^-spf/.test(a))) return true;
  if (cmd.prog === 'tar' || cmd.prog === 'bsdtar') {
    const oldStyle = argv[1] && !/^-/.test(argv[1]) ? argv[1] : '';
    // Stary styl `tar xfC a.tar DIR`: litery z argumentem biora kolejne pozycyjne w kolejnosci (security r3).
    if (oldStyle) {
      let pos = 2;
      for (const ch of oldStyle) {
        if (!'fCbTXKNLVgHI'.includes(ch)) continue;
        const v = argv[pos++];
        if (ch === 'C' && v && /x/.test(oldStyle) && (ctx.cwdKnown === false || nearClaude(normalizePath(expandVars(v, ctx.env), ctx.cwd)))) return true;
      }
    }
    const extract = /x/.test(oldStyle) || argv.some((a) => (/^-[^-]/.test(a) && /x/.test(a.split(/[fCbTXKNLVgHI]/)[0])) || isLongOpt(a, 'extract', 3) || isLongOpt(a, 'get', 3));
    const tbase = baseOf(optValue(argv, 'C', { name: 'directory', min: 3 }, 'fCbTXKNLVgHI'));
    return extract && (unsure || nearClaude(tbase) || /\/\.(git|claude)(\/|$)/.test(normalizePath(tbase))); // + `tar -C .git`
  }
  if (cmd.prog === 'unzip') {
    if (argv.some((a) => /^-[a-zA-Z]*[ltpvZ]/.test(a))) return false;
    return unsure || nearClaude(baseOf(optValue(argv, 'd', null, 'dx')));
  }
  if (/^(7z|7za|7zz|7zr)$/.test(cmd.prog)) {
    if (!/^[xe]$/.test(argv[1] || '')) return false;
    const o = argv.find((a) => /^-o./.test(a));
    return unsure || nearClaude(baseOf(o ? o.slice(2) : null));
  }
  if (cmd.prog === 'cpio') {
    if (!argv.some((a) => (/^-[^-]/.test(a) && /i/.test(a.split(/[DFHIMORE]/)[0])) || isLongOpt(a, 'extract', 3))) return false;
    return unsure || nearClaude(baseOf(optValue(argv, 'D', { name: 'directory', min: 3 }, 'DFHIMORE')));
  }
  return false;
}

// ---------- reguly ----------
const RULES = [
  { id: 'no-verify', esc: 'ALLOW_NOVERIFY', mode: 'enforce',
    why: 'git --no-verify omija pre-commit/pre-push (regula CLAUDE.md: NIGDY). Napraw lint/typy zamiast omijac bramke.',
    legacy: (raw, nq) => /\bgit\s+(commit|push|merge)\b[^\n;&|]*\s--no-verify(?=[\s;&|)]|$)|\bgit\s+commit\b[^\n;&|]*\s-n(?=\s|$)/i.test(nq),
    parsed: (cmd) => {
      const g = gitParts(cmd);
      if (!g || !/^(commit|push|merge|rebase|am|cherry-pick)$/.test(g.sub)) return false;
      if (g.args.some((a) => /^--no-v(e(r(i(fy?)?)?)?)?$/i.test(a))) return true;
      return g.sub === 'commit' && commitFlags(g.args).some((a) => shortCluster(a, 'n'));
    } },
  { id: 'force-push', esc: 'ALLOW_FORCE', mode: 'enforce',
    why: 'force-push zakazany (CLAUDE.md: no force-push, no amending pushed commits). Zrob nowy commit albo nowy branch.',
    legacy: (raw, nq) => /\bgit\s+push\b[^\n;&|]*(\s(--force|-f|--force-with-lease)(\s|$)|\s\+\w)/i.test(nq),
    parsed: (cmd) => {
      const g = gitParts(cmd);
      if (!g) return false;
      // Refspec z `+` ustawiony w konfiguracji (remote.X.push=+..., takze `git config remote.origin.push +refs/...`)
      // = force-push przy kazdym zwyklym `git push` (weryfikator 2026-09-26).
      // `-c remote.X.push=+...`, `--config-env=remote.X.push=VAR` (wartosc z env — nieznana), `remote.X.mirror=true`.
      if (g.configs.some((kv) => /^remote\.[^=]+\.push=\s*\+/i.test(kv) || /^remote\.[^=]+\.mirror=\s*(true|1|yes)/i.test(kv))) return true;
      if (configEnvValues(cmd.argv).some((kv) => /^remote\.[^=]+\.(push|mirror)=/i.test(kv))) return true;
      if (g.sub === 'config') {
        const ri = g.args.findIndex((x) => /^remote\..+\.push$/i.test(x));
        if (ri >= 0 && /^\+/.test(g.args[ri + 1] || '')) return true;
        // Trwale `git config remote.X.mirror true` = kazdy zwykly `git push` dziala jak --mirror (security-review 2026-09-26, runda 3).
        const mi = g.args.findIndex((x) => /^remote\..+\.mirror$/i.test(x));
        if (mi >= 0 && /^(true|1|yes|on)$/i.test(g.args[mi + 1] || '')) return true;
      }
      if (g.sub === 'remote' && g.args.some((a) => /^--mirror(=push)?$/.test(a))) return true; // `remote add --mirror` ustawia to samo
      if (g.sub !== 'push') return false;
      return g.args.some((a) => /^--(force(-with-lease(=.*)?|-if-includes)?|mirror)$/.test(a) || (/^-[a-zA-Z]+$/.test(a) && shortCluster(a, 'f')) || /^\+/.test(a));
    } },
  { id: 'reset-hard', esc: 'ALLOW_RESET', mode: 'enforce',
    why: 'git reset --hard kasuje niezacommitowana prace (CLAUDE.md: no reset --hard). Najpierw commit/stash.',
    legacy: (raw, nq) => /\bgit\s+reset\b[^\n;&|]*\s--hard\b/i.test(nq),
    parsed: (cmd) => { const g = gitParts(cmd); return !!g && g.sub === 'reset' && g.args.includes('--hard'); } },
  { id: 'git-clean', esc: 'ALLOW_CLEAN', mode: 'enforce',
    why: 'git clean -f kasuje niesledzone pliki bezpowrotnie. Najpierw zobacz `git clean -n`.',
    legacy: (raw, nq) => /\bgit\s+clean\b[^\n;&|]*\s-[a-zA-Z]*f/i.test(nq),
    parsed: (cmd) => { const g = gitParts(cmd); return !!g && g.sub === 'clean' && g.args.some((a) => a === '--force' || (/^-[a-zA-Z]+$/.test(a) && shortCluster(a, 'f'))); } },
  { id: 'hooks-bypass', esc: 'ALLOW_HOOKS', mode: 'enforce',
    why: 'Zmiana/wylaczenie core.hooksPath = omijanie globalnych git-hookow (secret-scan, lint, tsc). Zakazane.',
    legacy: (raw) => /core\.hookspath\s*=?\s*(\/dev\/null|nul\b|""|'')|\bgit\s+-c\s+core\.hookspath/i.test(raw),
    parsed: (cmd) => {
      if (cmd.assigns.some((a) => /^GIT_CONFIG_(PARAMETERS|COUNT|KEY_\d+|GLOBAL|SYSTEM|NOSYSTEM)$/.test(a))) return true;
      const g = gitParts(cmd);
      if (!g) return false;
      if (g.configs.some((kv) => /^(core\.hookspath|include\.path|includeif\.)/i.test(kv))) return true;
      if (g.sub !== 'config') return false;
      // include.path / includeIf wciagaja INNY plik configu (moze ustawic hooksPath) — zmiana = decyzja uzytkownika.
      if (g.args.some((a) => /^(include\.path|includeif\.)/i.test(a)) && !g.args.some((a) => /^--(get|get-all|list|get-regexp)$/.test(a))) return true;
      const ki = g.args.findIndex((a) => /^core\.hookspath$/i.test(a));
      if (ki < 0) return false;
      if (g.args.some((a) => /^--(unset|unset-all|remove-section|replace-all)$/.test(a))) return true;
      const value = g.args[ki + 1];
      if (value === undefined) return false; // odczyt
      return normalizePath(value) !== OWN_GIT_HOOKS;
    } },
  // 2026-10-10 (PDF security-checklist P7, sprawdzone: exit 0 dla `psql "$PROD_DB_URL" -c "drop table users"` i
  // `supabase db reset --linked`): destrukcyjny SQL na bazie zdalnej = nieodwracalne. Lokalnie (localhost, socket,
  // brak hosta/URL) wolne.
  // r2 (security+code review 2026-10-10): regula na PARSOWANEJ komendzie (program faktycznie uruchamiany), nie na tekscie —
  // heredoc z findings/RESUME zawierajacy „drop table" to nie wykonanie. Cel ZDALNY, dopoki nie udowodniono lokalnego
  // (host dokladnie z listy, albo brak hosta/URL/PGHOST/zmiennej/service). Klient SQL na zdalnym celu bez widocznego
  // SQL (stdin, -f, heredoc, sesja interaktywna) = blok — tresci nie widac.
  { id: 'remote-sql-destructive', esc: 'ALLOW_DELETE', mode: 'enforce',
    why: 'Destrukcyjny SQL (DROP/TRUNCATE/DELETE/UPDATE bez WHERE/ALTER COLUMN TYPE, pg_restore --clean, dropdb, supabase db reset|query --linked, prisma migrate reset, prisma db push --accept-data-loss) albo SQL niewidoczny (plik, stdin, heredoc) na bazie ZDALNEJ = ryzyko nieodwracalnej utraty danych. Dozwolone bez frazy: odczyt `psql "$URL" -c "select ..."`, migracje `supabase db push` (oslona = recenzja migracji T3), baza lokalna (localhost / docker exec), backup-drill.py. Destrukcja na zdalnej: najpierw backup (bin/backup-drill.py), dzialaj na kopii/branchu; potem decyzja uzytkownika.',
    parsed: (cmd, ctx) => sqlRisk(cmd, ctx, '', 0) },
  { id: 'rm-rf', esc: 'ALLOW_RM', mode: 'enforce',
    why: 'rm -r poza katalogami build/cache (node_modules, dist, .output, /tmp...) = nieodwracalne. Przenies do _to_delete/ albo trash.',
    legacy: (raw) => {
      // Cele = tokeny do konca TEJ komendy; blizna 2026-09-12 (cala linia brana za cele -> FP na /tmp).
      const matches = [...raw.matchAll(/(^|[;&|]\s*|\s)rm\s+(-[a-zA-Z]*r[a-zA-Z]*|--recursive)\b([^;&|\n]*)/gm)];
      if (!matches.length) return false;
      const targets = matches.flatMap((m) => (m[3].match(/"[^"]*"|'[^']*'|\S+/g) || [])).filter((t) => !/^-/.test(t));
      return !targets.length || !targets.every((t) => isSafeRmTarget(t.replace(/^["']|["']$/g, ''), {}));
    },
    parsed: (cmd, ctx) => {
      if (cmd.prog === 'find') {
        const deletes = cmd.argv.includes('-delete') || cmd.argv.some((a, i) => a === '-exec' && progName(cmd.argv[i + 1]) === 'rm');
        const roots = cmd.argv.slice(1).filter((a, i, arr) => !/^-/.test(a) && (i === 0 || !/^-/.test(arr[i - 1])));
        return deletes && !(roots.length && roots.every((r) => isSafeRmTarget(r, ctx)));
      }
      if (cmd.prog !== 'rm') return false;
      if (!flagsOf(cmd.argv).some((a) => a === '--recursive' || /^-[a-zA-Z]*[rR]/.test(a))) return false;
      const targets = targetsOf(cmd.argv);
      return !targets.length || !targets.every((t) => isSafeRmTarget(t, ctx));
    } },
  { id: 'rm-rf-win', esc: 'ALLOW_RM', mode: 'enforce',
    why: 'Rekurencyjne kasowanie (Remove-Item -Recurse / rmdir /s) poza build/cache — nieodwracalne. Przenies do _to_delete/.',
    legacy: (raw) => /\b(Remove-Item|rmdir|rd)\b[^\n;&|]*(-Recurse|\/s\b)/i.test(raw) && !/(node_modules|dist|\\?build|\.next|coverage|%TEMP%|\$env:TEMP|\.cache)/i.test(raw),
    parsed: (cmd, ctx) => {
      const win = /^(remove-item|ri|rmdir|rd|del|erase)$/.test(cmd.prog) || (cmd.prog === 'rm' && ctx.dialect === 'ps');
      if (!win) return false;
      const recursive = cmd.argv.some((a) => /^-r(e(c(u(r(se?)?)?)?)?)?$/i.test(a) || /^\/s$/i.test(a));
      if (!recursive) return false;
      return !winTargets(cmd.argv).every((t) => isSafeRmTarget(t, ctx)) || !winTargets(cmd.argv).length;
    } },
  { id: 'pr-merge', esc: 'ALLOW_MERGE', mode: 'enforce',
    why: 'Merge PR to decyzja uzytkownika (AUTO-LOOP: petla nigdy sama nie merguje na main).',
    // Merge przez REST (security-review 2026-09-26): `gh api -X PUT .../pulls/N/merge`, curl/iwr na ten sam endpoint.
    // + GraphQL: mergePullRequest / enablePullRequestAutoMerge (weryfikator 2026-09-26: `gh api graphql` omijal regule).
    parsed: (cmd, ctx) => (cmd.prog === 'gh' && cmd.argv[1] === 'pr' && cmd.argv[2] === 'merge') ||
      ghMergeFromFile(cmd, ctx) || scriptMergeFromFile(cmd, ctx) ||
      (/^(gh|curl|invoke-restmethod|irm|invoke-webrequest|iwr|wget|http|xh)$/.test(cmd.prog) && cmd.argv.some((a) => /\/pulls\/\d+\/merge\b|\/merges\b|mergePullRequest|enablePullRequestAutoMerge/.test(a))) ||
      // Alias gh ukrywajacy merge (weryfikator 2026-09-26, runda 2); pliki (graphql/import) — ghMergeFromFile.
      (cmd.prog === 'gh' && cmd.argv[1] === 'alias' && cmd.argv[2] === 'set' && /\bpr\s+merge\b|mergePullRequest|\/merge\b/.test(cmd.argv.slice(3).join(' '))),
    legacy: (raw) => /\bgh\s+pr\s+merge\b/i.test(raw) || /\bgh\s+api\s+graphql\b[\s\S]*\b(mergePullRequest|enablePullRequestAutoMerge)\b/.test(raw) ||
      (PIPED_INTERP_RX.test(raw) && SCRIPT_MERGE_RX.test(raw) && SCRIPT_NET_RX.test(raw)) },
  { id: 'gh-delete', esc: 'ALLOW_DELETE', mode: 'enforce',
    why: 'Kasowanie repo/galezi zdalnej/zasobu przez API — nieodwracalne, wymaga zgody uzytkownika.',
    legacy: (raw, nq) => /\bgh\s+(repo\s+delete|api\b[^\n;&|]*-X\s*DELETE)|\bgit\s+push\b[^\n;&|]*(\s--delete\b|\s:[\w\/-]+(\s|$))/i.test(nq),
    parsed: (cmd) => {
      if (cmd.prog === 'gh') {
        const apiDelete = cmd.argv[1] === 'api' && cmd.argv.some((a, i) => (/^(-X|--method)$/.test(a) && /^delete$/i.test(cmd.argv[i + 1] || '')) || /^(-XDELETE|--method=DELETE)$/i.test(a));
        return (cmd.argv[1] === 'repo' && cmd.argv[2] === 'delete') || apiDelete;
      }
      const g = gitParts(cmd);
      return !!g && g.sub === 'push' && g.args.some((a) => a === '--delete' || a === '-d' || a === '--prune' || /^:[^/]/.test(a));
    } },
  { id: 'secret-in-cmd', esc: 'ALLOW_SECRET', mode: 'enforce', fullText: true,
    why: 'Sekret w tresci komendy = trafia do transkryptu i logow. Uzyj menedzer sekretow (np. Infisical CLI): infisical run --env=dev -- <komenda>.',
    legacy: (raw) => /(ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|gho_[A-Za-z0-9]{20,}|sk-ant-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{32,}|sbp_[A-Za-z0-9]{20,}|xox[bpars]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,})/.test(raw),
    parsed: () => false },
  { id: 'cred-bypass', esc: 'ALLOW_CRED', mode: 'enforce',
    why: 'Jedyne zrodlo tokenow = menedzer sekretow (np. Infisical CLI). Czytanie GCM/gh auth/.git-credentials/kluczy SSH/AWS/bootstrapu mostu = obejscie (2026-09-05: PR wypchniety przez GCM, gdy vault lezal). Gdy most nie dziala -> "push pending".',
    legacy: (raw) => /\bgit\s+credential(-manager)?\s+(fill|get)\b|\bgh\s+auth\s+(token|status\s+--show-token)\b|\bgit\s+config\b[^\n;&|]*credential\.helper\b[^\n;&|]*\bstore\b|cat\s+[^\n;&|]*\.git-credentials\b/i.test(raw),
    // Sciezki poswiadczen tylko jako argument programu CZYTAJACEGO albo w skrypcie -c/-e interpretera — nie w danych
    // heredoca (replay 2026-09-26: tresc findings recenzenta z nazwa `.claude-machine-auth` = FP na surowym tekscie).
    parsed: (cmd) => {
      if (READ_PROGS.has(cmd.prog) && cmd.argv.slice(1).some((a) => CRED_PATH_RX.test(a))) return true;
      if (/^(python3?|py|node|perl|ruby|deno|bun)$/.test(cmd.prog)) {
        const ci = cmd.argv.findIndex((a) => /^-(c|e|-eval)$/.test(a));
        if (ci > 0 && CRED_PATH_RX.test(cmd.argv[ci + 1] || '')) return true;
      }
      if (cmd.prog === 'infisical') return /^(export|secrets)$/.test(cmd.argv[1] || '') && (cmd.argv[1] === 'export' || /^(get|export)$/.test(cmd.argv[2] || ''));
      if (cmd.prog === 'op') return /^(read|inject)$/.test(cmd.argv[1] || '') || (cmd.argv[1] === 'item' && cmd.argv[2] === 'get');
      return false;
    } },
  { id: 'pipe-to-shell', esc: 'ALLOW_PIPE_SH', mode: 'enforce',
    why: 'curl|sh / iwr|iex / base64 -d|sh = wykonanie nieprzejrzanego kodu. Pobierz do pliku, przeczytaj, potem uruchom.',
    legacy: (raw) => /\b(curl|wget|iwr|Invoke-WebRequest)\b[^\n]*\|\s*(sudo\s+)?(sh|bash|zsh|iex|Invoke-Expression|powershell|pwsh)\b/i.test(raw),
    pipeline: (cmds) => {
      const firstShell = cmds.findIndex((c, i) => i > 0 && SHELL_PROGS.has(c.prog) && !(c.prog === 'cmd' || c.argv.slice(1).some((a) => /^-[a-zA-Z]*c/.test(a))));
      if (firstShell < 0) return false;
      const feeders = cmds.slice(0, firstShell);
      const decodes = (c) => (c.prog === 'base64' && c.argv.some((a) => /^(-d|-D|--decode)$/.test(a))) || (c.prog === 'certutil' && c.argv.some((a) => /^-decode$/i.test(a))) || (c.prog === 'xxd' && c.argv.includes('-r'));
      return feeders.some((c) => DOWNLOADERS.has(c.prog) || decodes(c));
    } },
  { id: 'encoded-ps', esc: 'ALLOW_ENCODED', mode: 'observe',
    why: 'powershell -EncodedCommand ukrywa tresc komendy przed przegladem. Napisz komende jawnie.',
    parsed: (cmd) => (cmd.prog === 'powershell' || cmd.prog === 'pwsh') && cmd.argv.some((a) => /^-e(c|nc|ncodedcommand)?$/i.test(a)) },
  { id: 'chmod-system', esc: 'ALLOW_CHMOD', mode: 'enforce',
    why: 'Rekurencyjna zmiana uprawnien/wlasciciela katalogu systemowego lub domowego = nieodwracalne rozszczelnienie.',
    parsed: (cmd, ctx) => {
      if (!/^(chmod|chown|chgrp)$/.test(cmd.prog) || !cmd.argv.some((a) => a === '--recursive' || /^-[a-zA-Z]*R/.test(a))) return false;
      const system = new Set(['/', '/etc', '/usr', '/bin', '/sbin', '/lib', '/var', '/boot', '/home', '/root', 'c:', 'c:/', 'c:/windows', 'c:/users', 'c:/program files', normalizePath('~')]);
      return targetsOf(cmd.argv).some((t) => system.has(normalizePath(t, ctx.cwd).replace(/\/+$/, '') || '/'));
    } },
  { id: 'persistent-env', esc: 'ALLOW_ENV_PERSIST', mode: 'enforce',
    why: 'Trwale zmienne srodowiskowe ALLOW_*/PG_* (setx, SetEnvironmentVariable) = stale obejscie git-hookow i telemetrii bramek.',
    legacy: (raw) => /\bsetx\s+["']?(ALLOW_|PG_)|SetEnvironmentVariable\(\s*["'](ALLOW_|PG_)/i.test(raw),
    parsed: () => false },
  { id: 'pg-env', esc: 'ALLOW_PG_ENV', mode: 'enforce',
    why: 'PG_GATE_LOG / PG_OVERRIDES_DIR / PG_TRUSTED_ROOTS_FILE przekierowuja telemetrie, wyjatki i granice zaufania bramek — tylko testy (w procesie node), nigdy z komendy.',
    legacy: (raw, nq) => /\b(PG_GATE_LOG|PG_OVERRIDES_DIR|PG_TRUSTED_ROOTS_FILE)\s*=|\$env:(PG_GATE_LOG|PG_OVERRIDES_DIR|PG_TRUSTED_ROOTS_FILE)\b/i.test(raw) ||
      /\b(PG_GATE_LOG|PG_OVERRIDES_DIR|PG_TRUSTED_ROOTS_FILE)\b/.test(nq), // niecytowana wzmianka (printf -v, read, declare)
    parsed: () => false,
    exemptSearch: true },
  // security-review 2026-10-02: `node -e "require('.../overrides').mintSelf(...)"` wydawal wyjatek z pominieciem recenzji
  // (i `mint` dowolny, takze CONTROL_PLANE). Wyjatki wydaja tylko prompt-guard (fraza) i bin/pg-self-approve.js.
  { id: 'override-mint', esc: CONTROL_PLANE, mode: 'enforce',
    why: 'Wolanie lib/overrides.js (mint/mintSelf/consume) z komendy = wydanie sobie wyjatku z pominieciem frazy uzytkownika albo recenzji. Wyjatek B: node ~/.claude/bin/pg-self-approve.js po pg-review.',
    // Waskie (code-review 2026-10-02: `overrides` z configu oxlint + `write(` dawalo falszywe blokady): require biblioteki
    // + wywolanie funkcji wydajacej, albo jawna sciezka magazynu wyjatkow.
    // Kazde zaladowanie biblioteki z kodu inline (require/import, takze destrukturyzacja i `o['mint']`) — z linii komend
    // nie ma po co jej wolac (code-review 2026-10-02). Nazwa sklejana z kawalkow: pg/known-limits.md.
    legacy: (raw) => /\b(require|import)\b\s*\(?\s*[^)\n]{0,200}overrides(\.js)?['"`]/i.test(raw) ||
      /logs[\\/]+overrides/i.test(raw),
    parsed: () => false,
    exemptSearch: true },
  { id: 'control-plane', esc: CONTROL_PLANE, mode: 'enforce',
    why: 'Zapis/przeniesienie/usuniecie warstwy kontrolnej PG (~/.claude hooks, git-hooks, bin, agents, scheduled-tasks, settings, mody: ~/mods, ~/.claude/plugins, ~/.claude/dev-mods, skille z manifestem pluginu, logi bramek, ~/.gitconfig, .git/config, profile powloki). Zmiany PG tylko za zgoda uzytkownika. Latka w zwyklym repo: uzyj `git apply` (odmawia sciezek .git), nie `patch` z potoku.',
    // Zapis przez interpreter (python heredoc, node -e): sciezki bywaja ze spacja, wzgledne po `cd ~/.claude`
    // albo skladane (`Path.home() / '.claude' / 'hooks'`) — wiec szukamy SLADU sciezki w tekscie, nie pelnej sciezki.
    // Najpierw rozwiazujemy CEL zapisu z literalow (`p = "bin/x.py"; open(p, "w")`): wszystkie cele znane i poza
    // warstwa kontrolna = przepuszczamy (recenzent zapisujacy findings do %TEMP% pythonem). Cel nieznany -> slad sciezki.
    legacy: (raw, nq, ctx) => {
      // Kod inline w cudzyslowie powloki ma escapowane cudzyslowy (`-c "open(\"hooks/x.js\",\"w\")"`): bez odescapowania
      // ani API_WRITE_RX, ani wzorce open()/writeFileSync nie trafialy i zapis przechodzil (2026-10-10, sonda po security-review).
      const code = raw.replace(/\\x22/gi, '"').replace(/\\x27/gi, "'").replace(/\\+(["'])/g, '$1'); // + $'\\x22' i wielokrotne \\
      if (!API_WRITE_RX.test(code)) return false;
      const w = interpreterWrites(code);
      if (w.targets.some((t) => isControlPlane(t, ctx.cwd))) return true;
      // Sciezki modow skladane z katalogu domowego (Path.home()/'mods', join(expanduser('~'),'.claude','plugins')) bywaja
      // „rozwiazane" przez interpreterWrites do celu bez domu — sprawdzamy slad niezaleznie od tego (security-review faza 0 modow).
      if (MOD_TRACE_RX.test(raw.replace(/\\+/g, '/').toLowerCase())) return true;
      if (!w.unresolved) return false;
      const t = raw.replace(/\\+/g, '/').toLowerCase();
      if (CONTROL_TRACE_RX.test(t)) return true;
      // Sciezki wzgledne (`bin/x.py`) licza sie tylko, gdy komenda dziala w ~/.claude — `hooks/useAuth.ts` w repo React to nie PG.
      const inClaude = cwdInClaude(ctx.cwd);
      return inClaude && /(^|['"\s(=])(hooks|git-hooks|bin|agents|scheduled-tasks)\/[\w.-]+|settings(\.local)?\.json/.test(t);
    },
    parsed: (cmd, ctx) => {
      if (writeTargets(cmd, ctx.env).some((t) => isControlPlane(t, ctx.cwd))) return true;
      if (cwdRelativeWriteHits(cmd, ctx)) return true;
      // Ponowne zapieczetowanie = zatwierdzenie zmian warstwy kontrolnej (security-review 2026-09-26).
      // `nodejs` (Debian) i nazwa skryptu bez `.js` (Node dopisuje rozszerzenie) — security-review 2026-09-27.
      const isNode = /^(node|nodejs|bun|deno)$/.test(cmd.prog);
      const names = (base) => cmd.argv.some((a) => new RegExp('(^|[\\\\/])' + base + '(\\.js)?$', 'i').test(a));
      if (isNode && names('pg-seal') && !cmd.argv.includes('--check')) return true;
      // Wpiecie hookow i pobranie PG zmieniaja bramki: zgoda w KOMENDZIE, nie tylko w env skryptu — preload
      // (`node -r x.js`, NODE_OPTIONS=--require) mogl sam ustawic ALLOW_CONTROL_PLANE (security-review 2026-09-26).
      if (isNode && ((names('pg-wire') && cmd.argv.includes('--apply')) || (names('pg-sync') && cmd.argv.includes('pull')))) return true;
      const g = gitParts(cmd);
      // Tylko warianty, ktore ZMIENIAJA pliki robocze: clean -n, stash list/show, reset --soft/--mixed, restore --staged = nie.
      const readOnlyVariant = g && ((g.sub === 'clean' && g.args.some((a) => a === '--dry-run' || (/^-[a-zA-Z]+$/.test(a) && shortCluster(a, 'n')))) ||
        (g.sub === 'stash' && /^(list|show)$/.test(g.args[0] || '')) ||
        (g.sub === 'reset' && !g.args.some((a) => /^--(hard|merge|keep)$/.test(a))) ||
        (g.sub === 'restore' && g.args.includes('--staged') && !g.args.includes('--worktree')));
      if (g && !readOnlyVariant && /^(checkout|restore|reset|stash|clean|rm|mv|apply|am|revert|cherry-pick|merge|pull|rebase|switch)$/.test(g.sub)) {
        // + ~/mods (security-review faza 0 modow: `git -C ~/mods apply p.patch` nadpisywal przejrzany kod moda).
        const MODS = normalizePath(require('path').join(os.homedir(), 'mods'));
        const inClaude = (d) => d === normalizePath(CLAUDE_DIR) || d.startsWith(normalizePath(CLAUDE_DIR) + '/') || d === MODS || d.startsWith(MODS + '/');
        const envDirs = ['GIT_DIR', 'GIT_WORK_TREE'].map((k) => (cmd.values || {})[k] || (ctx.env || {})[k]).filter(Boolean);
        const dirs = [g.cwdOpt ? normalizePath(g.cwdOpt, ctx.cwd) : normalizePath(ctx.cwd),
          ...[...g.extraDirs, ...envDirs].map((d) => normalizePath(expandVars(d, ctx.env), ctx.cwd))];
        return dirs.some(inClaude);
      }
      return false;
    } },
  { id: 'config-loosen', esc: 'ALLOW_CONFIG', mode: 'enforce',
    why: 'Zapis konfiguracji jakosci (tsconfig/eslint/ruff/pyright/oxlint) przez powloke omija kontrole luzowania. Uzyj narzedzia Edit/Write (tam sprawdzamy, czy regula nie jest zdejmowana).',
    // Tylko NADPISANIE istniejacego configu (luzowanie); utworzenie nowego (scaffold, szablon) i pliki w %TEMP% przechodza.
    parsed: (cmd, ctx) => writeTargets(cmd, ctx.env).some((t) => {
      const p = normalizePath(t, ctx.cwd);
      return isQualityConfig(p) && !isTempPath(p) && ctx.exists(p);
    }) },
  { id: 'git-alias', esc: 'ALLOW_GIT_ALIAS', mode: 'enforce',
    why: 'Alias gita, ktory ukrywa force-push/--no-verify/reset --hard/hooksPath albo wykonuje powloke (!) — obejscie regul przez nazwe aliasu.',
    parsed: (cmd) => {
      const g = gitParts(cmd);
      if (!g) return false;
      const risky = (v) => /^!|--no-verify|--force|(^|\s)-f\b|--hard|clean\s+-\w*f|hookspath|--mirror|--delete/i.test(String(v || ''));
      if (g.configs.some((kv) => /^alias\./i.test(kv) && risky(kv.split('=').slice(1).join('=')))) return true;
      if (g.sub !== 'config') return false;
      const ai = g.args.findIndex((a) => /^alias\./i.test(a));
      return ai >= 0 && risky(g.args.slice(ai + 1).join(' '));
    } },
  { id: 'self-mint', esc: null, mode: 'enforce',
    why: 'Agent nie moze wydac sobie wyjatku przez uruchomienie Claude CLI z fraza „pozwol ALLOW_…" (to tura uzytkownika w NOWEJ albo wznowionej sesji). Wyjatek pisze uzytkownik w czacie.',
    // Program `claude` (nie katalog `.claude` w sciezce — replay 2026-09-26: 12 FP) z fraza wyjatku w argumentach.
    // + stdin z pliku (`claude -p < plik`): czytamy plik przekierowania (weryfikator 2026-09-26, runda 2).
    parsed: (cmd, ctx) => {
      if (!isClaudeCli(cmd)) return false;
      const fromFiles = cmd.redirects.filter((r) => r.op === '<').map((r) => { try { return fs.readFileSync(normalizePath(expandVars(r.target, ctx.env), ctx.cwd), 'utf8').slice(0, 20000); } catch (e) { return ''; } });
      return MINT_PHRASE_RX.test([...cmd.argv.slice(1), ...(cmd.heredocs || []).map((h) => h.body), ...fromFiles, substitutedFileText(cmd.argv, ctx)].join(' '));
    },
    // Fraza przez stdin: `echo "pozwol ALLOW_X" | claude -p` (weryfikator 2026-09-26) i z pliku: `cat f | claude -p`
    // (security-review 2026-09-26, runda 3 — regula patrzyla na argv `cat`, nie na tresc pliku).
    pipeline: (cmds, ctx) => cmds.some(isClaudeCli) && cmds.some((c) => MINT_PHRASE_RX.test([
      ...c.argv, ...(c.heredocs || []).map((h) => h.body),
      ...(READER_RX.test(c.prog) ? c.argv.slice(1).filter((a) => !/^-/.test(a)).map((a) => readSmall(a, ctx)) : []),
      ...c.redirects.filter((r) => r.op === '<').map((r) => readSmall(r.target, ctx)),
    ].join(' '))) },
  { id: 'source-env', esc: 'ALLOW_ENV_FILE', mode: 'enforce',
    why: 'Wczytanie/uruchomienie skryptu, ktory ustawia ALLOW_* albo PG_GATE_LOG/PG_OVERRIDES_DIR (`. e.sh`, `source`, `bash e.sh`) = obejscie bramek przez plik.',
    parsed: (cmd, ctx) => {
      // Ladowanie pliku do srodowiska przez podstawienie: `export $(cat .env | xargs)`, `eval "$(cat f)"`, `env $(cat f) cmd`
      // (weryfikator 2026-09-26, runda 2) — czytamy plik z `cat` w podstawieniu.
      if (/^(export|eval|env|declare|set|typeset|local|readonly)$/.test(cmd.prog) || cmd.assigns.length) {
        if (ENV_SET_RX.test(substitutedFileText(cmd.argv, ctx))) return true;
      }
      if (cmd.assigns.includes('BASH_ENV') || cmd.assigns.includes('ENV')) return true; // plik wykonywany przy starcie powloki
      let file = null;
      if (cmd.prog === '.' || cmd.prog === 'source') file = cmd.argv[1];
      else if (/^(sh|bash|zsh|dash)$/.test(cmd.prog) && !cmd.argv.some((a) => /^-[a-zA-Z]*[cn]/.test(a))) file = cmd.argv.slice(1).find((a) => !/^-/.test(a)); // -n = tylko skladnia
      else if (/^(powershell|pwsh)$/.test(cmd.prog)) { const fi = cmd.argv.findIndex((a) => /^-f(ile)?$/i.test(a)); if (fi > 0) file = cmd.argv[fi + 1]; }
      if (!file) return false;
      const p = normalizePath(expandVars(file, ctx.env), ctx.cwd);
      try { return ENV_SET_RX.test(fs.readFileSync(p, 'utf8').slice(0, 200000)); } catch (e) { return false; }
    } },
  { id: 'claude-agent-override', esc: CONTROL_PLANE, mode: 'enforce',
    why: 'Claude CLI z flaga podmieniajaca agentow/ustawienia/prompt systemowy (--agents, --plugin-dir, --settings, --system-prompt*) moze podstawic „recenzenta", ktory zawsze oddaje pusta liste findings — dowod dla pg-self-approve/pg-merge (security-review r6 2026-10-04). Tylko fraza uzytkownika.',
    // security-review r7: alias/sciezka binarki (versions/2.1.x, $C, npx @anthropic-ai/claude-code, node cli.js) omijal nazwe
    // programu — flagi specyficzne dla claude lapane w KAZDYM programie; --settings (wspolne, np. Django) tylko przy claude.
    parsed: (cmd) => {
      if (cmd.assigns.includes('CLAUDE_CONFIG_DIR')) return true;
      // ops/security-review r8: `export|declare|typeset|setenv|env CLAUDE_CONFIG_DIR=...` w osobnej komendzie tej samej linii
      if (/^(export|declare|typeset|setenv|env|set)$/.test(cmd.prog) && cmd.argv.slice(1).some((a) => /^CLAUDE_CONFIG_DIR(=|$)/.test(a))) return true;
      const end = cmd.argv.indexOf('--');  // po `--` to argumenty, nie flagi (ops-review r7)
      const args = cmd.argv.slice(1, end > 0 ? end : undefined);
      return args.some((a) => CLAUDE_ONLY_FLAG_RX.test(a)) || (looksLikeClaude(cmd) && args.some((a) => CLAUDE_OVERRIDE_FLAG_RX.test(a)));
    } },
  // 2026-10-09: mod = kod wykonywany w Claude Code poza hookami settings. Instalacja, wlaczenie, aktualizacja, dodanie
  // marketplace'u zmieniaja to, co sie laduje. Odczyt (list, validate, test, details) zostaje wolny. `/plugin` w czacie
  // to akcja uzytkownika — hook jej nie widzi i nie musi.
  // 2026-10-10 (masterplan D6, decyzja uzytkownika): ODEJMOWANIE jest wolne — disable|uninstall|remove|prune|autoremove,
  // marketplace remove. Awaryjny wylacznik zepsutego moda nie moze stac za fraza; zaden mod nie jest bramka PG
  // (bramkami sa hooki settings), wiec wylaczenie moda niczego w PG nie zdejmuje.
  { id: 'claude-plugin-change', esc: CONTROL_PLANE, mode: 'enforce',
    why: 'Dodanie/zmiana kodu modow Claude Code (claude plugin install|enable|update|configure|eval|init|new, marketplace add|update) = zmiana warstwy kontrolnej. Mody omijaja hooki settings. Przeglad kodu moda + fraza uzytkownika. Wylaczanie/odinstalowanie jest wolne.',
    parsed: (cmd) => {
      if (!looksLikeClaude(cmd)) return false;
      // Sama pomoc niczego nie zmienia (code-review faza 0: `claude plugin install --help` w realnej sesji = FP poziomu C).
      // Tylko PRZED `--` (code-review r2: `install x -- --help` instalowal — po `--` to operand, nie flaga).
      // security-review r2: `-h` jako WARTOSC opcji (`--accept-command -h`, `--config -h`) instalowal — pomoc tylko, gdy
      // poprzedni argument nie jest opcja (moze byc wartoscia opcji). `install x --force --help` = blok (bezpieczny FP).
      // + tylko PO slowie `plugin` (weryfikator r3: `claude -h plugin install x` — niepewne, czy to pomoc roota).
      const dd = cmd.argv.indexOf('--');
      const head = cmd.argv.slice(0, dd < 0 ? undefined : dd);
      const pIdx = head.findIndex((x) => /^plugins?$/i.test(x));
      if (head.some((x, k) => k > pIdx && pIdx >= 0 && (x === '--help' || x === '-h') && !String(head[k - 1] || '').startsWith('-'))) return false;
      const a = cmd.argv.slice(1).filter((x) => !x.startsWith('-')).map((x) => x.toLowerCase());
      const i = a.findIndex((x) => x === 'plugin' || x === 'plugins');
      if (i < 0) return false;
      if (a[i + 1] === 'marketplace' || a[i + 1] === 'marketplaces') return /^(add|update)$/.test(a[i + 2] || '');
      // `eval` uruchamia kod pluginu na tej maszynie (pomoc CLI) — tak samo jak instalacja.
      // init|new tworza mod w ~/.claude/skills (auto-ladowanie, security-review faza 0).
      return /^(install|i|enable|update|upgrade|configure|eval|init|new)$/.test(a[i + 1] || '');
    } },
  { id: 'readonly-agent', esc: null, mode: 'enforce',
    why: 'Recenzent/weryfikator jest READ-ONLY (blizna 2026-09-15: stash+checkout wykonany przez recenzenta). Zapis dozwolony tylko do findings/verdicts w katalogu przebiegu lub %TEMP%.',
    parsed: (cmd, ctx) => {
      if (!ctx.agentType || !/reviewer|verifier|catfish/i.test(ctx.agentType)) return false;
      const g = gitParts(cmd);
      // Odczytowe warianty „mutujacych" podkomend (ops-review 2026-09-26: `git tag -l` recenzenta blokowany).
      const listing = g && ((g.sub === 'tag' && (!g.args.length || g.args.some((a) => /^(-l|--list|-n\d*|--contains|--points-at|--sort=.*)$/.test(a)))) ||
        (g.sub === 'stash' && /^(list|show)$/.test(g.args[0] || '')) || (g.sub === 'worktree' && g.args[0] === 'list'));
      if (g && !listing && (MUTATING_GIT.has(g.sub) || (g.sub === 'branch' && g.args.some((a) => /^-(d|D|m|M|-delete|-move)$/.test(a))))) return true;
      if (/^(npm|pnpm|yarn|bun|pip|pip3|uv)$/.test(cmd.prog) && /^(install|i|ci|add|remove|uninstall|update|upgrade)$/.test(cmd.argv[1] || '')) return true;
      return writeTargets(cmd, ctx.env).some((t) => !isTempPath(t, ctx.cwd) && !isReviewArtifact(t, ctx.cwd));
    } },
];

const ALLOW_TOKEN_RX = /ALLOW_[A-Z][A-Z_]*/g;
const MINT_PHRASE_RX = /\b(pozw[oó]l|zezwalam|allow)\b[\s\S]*ALLOW_[A-Z]/i;
const CLAUDE_OVERRIDE_FLAG_RX = /^--(agents|plugin-dir|plugin-url|settings|setting-sources|system-prompt(-file)?|append-system-prompt(-file)?|add-dir|mcp-config)(=|$)/;
const CLAUDE_ONLY_FLAG_RX = /^--(agents|plugin-dir|plugin-url|setting-sources|append-system-prompt(-file)?)(=|$)/;
// claude pod inna nazwa: binarka z versions/, pakiet claude-code (npx/bunx/node cli.js), program ze zmiennej ($C).
const looksLikeClaude = (cmd) => isClaudeCli(cmd) || /^\$/.test(cmd.prog) || /[\/\\]claude[\/\\]versions[\/\\]/i.test(cmd.argv[0] || '')
  || cmd.argv.slice(0, 3).some((a) => /claude-code/i.test(a));
const isClaudeCli = (cmd) => cmd.prog === 'claude' || (/^(npx|bunx|pnpx)$/.test(cmd.prog) && /claude/i.test(cmd.argv[1] || ''));
// Tresc pliku wzgledem wirtualnego cwd (po `cd`); '' gdy brak/nie plik. Limit 200 KB — wystarcza na fraze/przypisanie.
function readSmall(file, ctx) {
  try {
    const p = normalizePath(expandVars(file, ctx.env), ctx.cwd);
    return fs.statSync(p).isFile() ? fs.readFileSync(p, 'utf8').slice(0, 200000) : '';
  } catch (e) { return ''; }
}
// Pliki wskazane w podstawieniach argumentow: `$(<f)`, `$(cat f)`, `$(grep . f)`, `` `cat f` `` (security-review 2026-09-26:
// wczesniej tylko `$(cat f)`). Kazdy token podstawienia, ktory jest istniejacym plikiem, zostaje przeczytany.
function substitutedFileText(argv, ctx) {
  const out = [];
  for (const m of argv.join(' ').matchAll(/\$\(([^)]*)\)|`([^`]*)`/g)) {
    for (const tok of String(m[1] || m[2]).split(/[\s|;&<>]+/)) {
      const t = tok.replace(/^["']+|["']+$/g, '');
      if (t && !/^-/.test(t)) out.push(readSmall(t, ctx));
    }
  }
  return out.join('\n');
}
// Merge PR schowany w pliku: `gh api graphql -F query=@q`, `gh api graphql --input q.json`, `gh alias import a.yml`
// (security-review 2026-09-26, runda 3). Plik czytany wzgledem wirtualnego cwd; nieczytelny albo stdin (`-`) = blokada.
const MERGE_BODY_RX = /mergePullRequest|enablePullRequestAutoMerge|\bpr\s+merge\b|\/pulls\/\d+\/merge\b/;
function ghMergeFromFile(cmd, ctx) {
  if (cmd.prog !== 'gh') return false;
  const files = [];
  if (cmd.argv[1] === 'api' && cmd.argv.includes('graphql')) { // REST merge ma endpoint w argv — lapie go regula wyzej
    cmd.argv.forEach((a, i) => {
      const q = /^[a-z_]+=@(.+)$/i.exec(a);
      if (q) files.push(q[1]);
      if (a === '--input') files.push(cmd.argv[i + 1] || '-');
      else if (a.startsWith('--input=')) files.push(a.slice(8));
    });
  } else if (cmd.argv[1] === 'alias' && cmd.argv[2] === 'import') {
    files.push(cmd.argv.slice(3).find((a) => !/^-/.test(a) || a === '-') || '-');
  }
  return files.some((f) => { if (f === '-') return true; const txt = readSmall(f, ctx); return !txt || MERGE_BODY_RX.test(txt); });
}
// Merge schowany w SKRYPCIE (2026-10-01, v2 po pg-review code+ops+security): `python merge-pr.py 45`, `python -c "..."`,
// `bash x.sh`, `pwsh -File x.ps1`, `uv run x.py`, takze za mostem `infisical run -- python x.py`.
// Czytane sa TYLKO skrypty faktycznie uruchamiane (pierwszy argument pozycyjny po flagach interpretera) i kod inline
// (-c/-e/--eval/-Command). Wzorzec merge + realne wywolanie sieci/procesu = blokada. Istniejacy, a nieczytelny skrypt =
// blokada (fail closed). ZNANA GRANICA (pg/known-limits.md): kod importowany z innego modulu (`-m pakiet`, import)
// i adres sklejany z kawalkow dalej niz 400 znakow — twarda granica jest dopiero w tym, ze merge wymaga tokenu z mostu.
const SCRIPT_MERGE_RX = /\/pulls\/[^\s'"`/]*\/merge\b|mergePullRequest|enablePullRequestAutoMerge|\bpr['",\s]+merge\b|\bpulls\b[\s\S]{0,400}\bmerge\b/i;
const SCRIPT_NET_RX = /urlopen|urllib|requests\.|httpx|aiohttp|LWP|require\(\s*['"](node:)?https?['"]\s*\)|from\s+['"](node:)?https?['"]|HTTP::Tiny|Net::HTTP|file_get_contents|open-uri|Faraday|http\.client|HTTPSConnection|\bfetch\(|https?\.request\(|axios|octokit|got\(|Invoke-(RestMethod|WebRequest)|\bcurl\b|\bwget\b|subprocess|os\.(system|popen|exec)|child_process|exec(File)?Sync|spawn(Sync)?\(|['"]gh['"]|\bgh\s+(api|pr)\b/;
const toSlash = (p) => String(p).replace(/\\/g, '/').toLowerCase();
// Zaufane = konkretne pliki warstwy kontrolnej (chroni je edit-guard + fraza ALLOW_CONTROL_PLANE), nie cale katalogi:
// bin/mas_merge_prs.py scala bez wlasnych warunkow, wiec NIE jest zaufany (code-review 2026-10-01).
// test_hooks_v2.js: fikstura 'gh pr merge 5' w tresci dawala FP pr-merge na samym uruchomieniu testow (2026-10-10).
const TRUSTED_SCRIPTS = new Set(['bin/pg-merge-bezpieczny.py', 'bin/test_hooks_v3.js', 'bin/test_hooks_v2.js', 'bin/test_pg_merge.py',
  'bin/pg-eval.js', 'bin/pg-replay.js', 'bin/pg-mutate.js'].map((f) => toSlash(require('path').join(os.homedir(), '.claude', f))));
const TRUSTED_HOOKS_DIR = toSlash(require('path').join(os.homedir(), '.claude', 'hooks')) + '/';
const INTERPRETER_RX = /^(python[\d.]*|pythonw|py|node|deno|bun|ts-node|tsx|bash|sh|zsh|dash|ksh|pwsh|powershell|perl|ruby|php)(\.exe)?$/i;
// Kod podany na stdin przez potok/here-string (`echo KOD | python`, `python <<< KOD`) — parser nie wiaze tresci
// z interpreterem, wiec regula legacy patrzy na caly tekst komendy (security/code-review v2).
const PIPED_INTERP_RX = /(\|\s*|<<<)[^|;&\n]*\b(python[\d.]*|pythonw|py|node|deno|bun|bash|sh|zsh|pwsh|powershell|perl|ruby|php)\b|\b(python[\d.]*|node|bash|sh|pwsh|perl|ruby|php)\b[^|;&\n]*<<</i;
const RUNNER_RX = /^(uv|uvx|poetry|pipx|pdm|hatch|npx|bunx|pnpx|pnpm|yarn|npm)(\.exe)?$/i;
// Flagi PER RODZINA (code-review v2: wspolny zbior robil z `bash -x`/`-e` flage z wartoscia/inline i przepuszczal skrypt).
// py: case-sensitive (-x to bool, -X/-W z wartoscia); sh: -c inline, reszta bool; js: -e/-p inline; ps: -command/-file.
const FLAGS = {
  py: { inline: ['-c'], value: ['-X', '-W', '--check-hash-based-pycs'], ci: false },
  js: { inline: ['-e', '--eval', '-p', '--print'], value: ['-r', '--require', '--import', '--loader', '--experimental-loader', '--env-file', '--config', '-c', '--allow-net', '--allow-read'], ci: false },
  sh: { inline: ['-c'], value: ['-o', '-O', '--init-file', '--rcfile'], ci: false },
  ps: { inline: ['-command', '-c', '-encodedcommand', '-enc', '-e'], value: ['-executionpolicy', '-ep', '-workingdirectory', '-wd'], ci: true },
  pl: { inline: ['-e', '-E', '-r'], value: ['-I', '-M'], ci: false },
};
const familyOf = (prog) => (/^(python|py$|pythonw)/i.test(prog) ? 'py' : /^(node|deno|bun|ts-node|tsx)/i.test(prog) ? 'js'
  : /^(pwsh|powershell)/i.test(prog) ? 'ps' : /^(perl|ruby|php)/i.test(prog) ? 'pl' : 'sh');
const baseName = (a) => String(a || '').split(/[\\/]/).pop();
// Kod faktycznie wykonywany: { files, inline }. Rekurencja przez `--` (menedzer sekretow (np. Infisical CLI)) i runnery (`uv run`, `npx x`).
function executedCode(argv) {
  const out = { files: [], inline: [] };
  const add = (r) => { out.files.push(...r.files); out.inline.push(...r.inline); };
  const prog = baseName(argv[0]);
  // Plik uruchomiony wprost (`./mm.py`, `./m.pl`, shebang bez rozszerzenia) — takze po `--` mostu (security-review v3).
  if (/[\\/]/.test(String(argv[0] || '')) && !INTERPRETER_RX.test(prog) && !RUNNER_RX.test(prog)) out.files.push(String(argv[0]));
  if (RUNNER_RX.test(prog)) {
    const k = argv.findIndex((a, i) => i > 0 && ['run', 'exec', 'x'].includes(a));
    const rest = k > 0 ? argv.slice(k + 1) : argv.slice(1).filter((a) => !a.startsWith('-'));
    if (rest.length) add(INTERPRETER_RX.test(baseName(rest[0])) ? executedCode(rest) : { files: [rest[0]], inline: [] });
  } else if (INTERPRETER_RX.test(prog) || ['deno', 'bun'].includes(prog.toLowerCase())) {
    const fam = familyOf(prog);
    const F = FLAGS[fam];
    const norm = (a) => (F.ci ? a.toLowerCase() : a);
    for (let k = 1; k < argv.length; k++) {
      const a = String(argv[k]);
      const n = norm(a);
      if ((fam === 'js' && a === '--check') || (fam === 'sh' && /^-[a-z]*n[a-z]*$/.test(a))) break; // tylko skladnia
      if (F.inline.includes(n)) { out.inline.push(String(argv[k + 1] || '')); break; }
      const eq = /^(--[a-z-]+)=([\s\S]*)$/i.exec(a); // `node --eval=KOD`
      if (eq && F.inline.includes(norm(eq[1]))) { out.inline.push(eq[2]); break; }
      // Sklejone krotkie flagi `python -Ic`, `bash -xc` (inline = nastepny argument) i doklejony kod `-c"KOD"` -> `-cKOD`.
      // Sklejone flagi z inline na koncu: py/sh `-Ic`/`-xc`, js `-pe`, perl/ruby `-le`/`-ne`, php `-nr` (code-review v3).
      const INLINE_TAIL = { py: 'c', sh: 'c', js: 'ep', pl: 'eEr', ps: '' }[fam];
      if (INLINE_TAIL && /^-[A-Za-z]+$/.test(a) && a.length > 2 && INLINE_TAIL.includes(a.slice(-1))) { out.inline.push(String(argv[k + 1] || '')); break; }
      if (fam === 'js' && /^deno/i.test(prog) && a === 'eval') { out.inline.push(String(argv[k + 1] || '')); break; }
      if ((fam === 'py' || fam === 'sh') && /^-c./s.test(a)) { out.inline.push(a.slice(2)); break; }
      if (fam === 'py' && a === '-m') break; // modul — znana granica (pg/known-limits.md)
      if (fam === 'ps' && (n === '-file' || n === '-f')) { out.files.push(String(argv[k + 1] || '')); break; }
      if (F.value.includes(n)) { k++; continue; }
      if (a.startsWith('-') || a === 'run') continue; // `deno run x.ts`, `bun run x.ts`
      out.files.push(a);
      break;
    }
  }
  argv.forEach((a, i) => { if (a === '--' && i > 0) add(executedCode(argv.slice(i + 1))); });
  return out;
}
function scriptMergeFromFile(cmd, ctx) {
  const { files, inline } = executedCode([cmd.prog, ...cmd.argv.slice(1)]);
  if (/\.(py|[cm]?js|ts|sh|ps1)$/i.test(cmd.prog)) files.push(cmd.prog); // `./m.py` uruchomiony wprost (shebang)
  if (INTERPRETER_RX.test(baseName(cmd.prog))) { // kod na stdin: `python < x.py`, `python - <<EOF`
    for (const r of cmd.redirects || []) if (r.op === '<') files.push(r.target);
    for (const h of [].concat(cmd.heredocs || [])) if (h && h.body) inline.push(String(h.body));
  }
  const hit = (txt) => SCRIPT_MERGE_RX.test(txt) && SCRIPT_NET_RX.test(txt);
  if (inline.some(hit)) return true;
  return files.filter(Boolean).some((a) => {
    let full = normalizePath(expandVars(a, ctx.env), ctx.cwd);
    // `node mm` (node dokleja .js), `python katalog/` (__main__.py) — security-review v2.
    const exists = (p) => { try { return fs.statSync(p); } catch (e) { return null; } };
    const st0 = exists(full);
    if (!st0) full = ['.js', '.mjs', '.cjs', '.ts', '.py'].map((x) => full + x).find((p) => exists(p)) || full;
    else if (st0.isDirectory()) full = ['__main__.py', 'index.js', 'main.py'].map((x) => require('path').join(full, x)).find((p) => exists(p)) || full;
    const slash = toSlash(full);
    if (TRUSTED_SCRIPTS.has(slash) || slash.startsWith(TRUSTED_HOOKS_DIR)) return false;
    let txt;
    try {
      if (!fs.statSync(full).isFile()) return false;
      txt = fs.readFileSync(full, 'utf8').slice(0, 2000000);
    } catch (e) {
      return Boolean(e) && e.code !== 'ENOENT'; // istnieje, a nieczytelny = blokada; brak pliku = interpreter i tak padnie
    }
    return hit(txt);
  });
}
// Programy czytajace plik na stdout (`cat f | claude -p`).
const READER_RX = /^(cat|type|get-content|gc|head|tail|more|less|tac|sed|awk|grep|cut|tr|sort)$/;
// Plik ustawiajacy zmienne, ktore wylaczaja bramki (ten sam wzorzec co edit-guard env-file).
// Tylko przypisanie na POCZATKU instrukcji (linia albo po `;`/`&&`) — komunikaty typu `echo "wyjatek: ALLOW_X=1"` w
// git-hookach PG to nie ustawienie zmiennej (replay 2026-09-26: `sh -n git-hooks/pre-commit` = 29 FP).
const ENV_SET_RX = /(^|[;&|]\s*)\s*(export\s+|set\s+|setx\s+|declare\s+-x\s+|\$env:)?(ALLOW_[A-Z][A-Z_]*|PG_GATE_LOG|PG_OVERRIDES_DIR|PG_TRUSTED_ROOTS_FILE)\s*=|(^|[;&|]\s*)\s*printf\s+-v\s+(ALLOW_|PG_GATE_LOG)/m;
// Tekst poza cudzyslowami. `\"` wewnatrz "..." nie konczy cytatu (sesja 2026-09-26: `node -e "... \"ALLOW_X=1\" ..."`
// wypychal token poza cytat = falszywe override-required).
const stripQuoted = (s) => String(s).replace(/"(?:[^"\\]|\\[\s\S])*"|'[^']*'/g, '""');
const defaultExists = (p) => { try { return fs.existsSync(p); } catch (e) { return false; } };
/**
 * Nazwy ALLOW_* faktycznie USTAWIANE jako zmienne srodowiskowe (tylko tak dzialaja w git-hookach): `X=1 cmd`,
 * `env "X=1" cmd`, `export X=1`, `set X=1`, `setx X 1`, `$env:X = 1`. Tekst w cudzyslowie (`grep "ALLOW_RM=1"`)
 * niczego nie omija — od v4 regule bash-guard zdejmuje WYLACZNIE zgoda uzytkownika, nie tresc komendy.
 */
// Programy tylko-szukajace: ALLOW_X jako ich argument to wzorzec, nie ustawienie zmiennej.
const SEARCH_PROGS = new Set(['grep', 'egrep', 'fgrep', 'rg', 'ag', 'findstr', 'select-string', 'sls', 'cat', 'head', 'tail', 'less', 'more', 'wc', 'ls', 'dir', 'find', 'type', 'get-content', 'gc']);
const onlySearch = (parsed) => parsed.commands.filter((c) => c.argv.length).every((c) => SEARCH_PROGS.has(c.prog) || (c.prog === 'git' && /^(grep|log|show|diff)$/.test(c.argv[1] || '')));
function allowTokens(parsed, nq) {
  const names = new Set();
  // Kazda NIECYTOWANA wzmianka poza czystym wyszukiwaniem (security-review 2026-09-26: `set -a; printf -v ALLOW_SECRET 1`,
  // `read ALLOW_X`, `declare -x` — sposobow ustawienia zmiennej jest wiecej, niz da sie wyliczyc).
  if (!onlySearch(parsed)) for (const m of nq.match(ALLOW_TOKEN_RX) || []) names.add(m);
  if (parsed.overflow) return [...names];
  for (const cmd of parsed.commands) {
    for (const a of cmd.assigns) if (/^ALLOW_[A-Z][A-Z_]*$/.test(a)) names.add(a);
    const envAssign = cmd.argv.find((w) => /^\$env:ALLOW_[A-Z][A-Z_]*/i.test(w));
    if (envAssign) names.add(envAssign.match(/ALLOW_[A-Z][A-Z_]*/i)[0].toUpperCase());
    if (/^(export|set|setx|declare|typeset|readonly)$/.test(cmd.prog)) for (const w of cmd.argv.slice(1)) { const m = /^(ALLOW_[A-Z][A-Z_]*)\b/.exec(w); if (m) names.add(m[1]); }
  }
  return [...names];
}

// `export TMP=/projekt`, `declare -x TMP=..`, `set TMP=..` (cmd), `$env:TMP = ..` (PowerShell) tez nadpisuja zmienna
// (weryfikator 2026-09-26: `export TMP=<projekt>; rm -rf $TMP` przechodzilo jako „temp").
// Wartosc nieznana (petla, read, printf -v): zmienna NIE jest juz tempem — `$UNKNOWN_VALUE` nie przejdzie jako bezpieczny cel.
const UNKNOWN = '$UNKNOWN_VALUE';
function exportedValues(cmd) {
  const out = {};
  if (/^(export|declare|typeset|local|readonly|set)$/.test(cmd.prog)) {
    for (const w of cmd.argv.slice(1)) { const m = /^([A-Za-z_]\w*)=(.*)$/.exec(w); if (m) out[m[1]] = m[2]; }
  }
  // weryfikator 2026-09-26: `for TMP in ...`, `read TMP`, `printf -v TMP` nadpisywaly TMP bez sladu w ocenie celu rm.
  if (cmd.prog === 'for' && /^[A-Za-z_]\w*$/.test(cmd.argv[1] || '')) out[cmd.argv[1]] = UNKNOWN;
  if (cmd.prog === 'read') for (const w of cmd.argv.slice(1).filter((x) => /^[A-Za-z_]\w*$/.test(x))) out[w] = UNKNOWN;
  if (cmd.prog === 'printf') { const vi = cmd.argv.indexOf('-v'); if (vi > 0 && cmd.argv[vi + 1]) out[cmd.argv[vi + 1]] = UNKNOWN; }
  const ps = /^\$env:([A-Za-z_]\w*)(=(.*))?$/i.exec(cmd.argv[0] || '');
  if (ps) out[ps[1]] = ps[2] ? ps[3] : cmd.argv.slice(cmd.argv[1] === '=' ? 2 : 1).join(' ');
  return out;
}

/**
 * evaluate(raw, ctx) -> { blocks: [{id, esc, why, layer}], observes: [{id, why}], tokens: [ALLOW_*], overflow, notes }
 * ctx: { dialect: 'sh'|'ps', cwd, agentType, disabled: Set(id) (tylko pg-mutate) }
 * Nie decyduje o wyjatkach — robi to hook (overrides.js), bo wymaga I/O.
 */
function evaluate(raw, ctx) {
  const c = Object.assign({ dialect: 'sh', cwd: process.cwd(), agentType: null, disabled: new Set(), exists: defaultExists }, ctx || {});
  const text = String(raw || '').replace(/^\uFEFF/, '');
  const parsed = parse(text, { dialect: c.dialect });
  // Warstwa legacy dostaje tekst BEZ danych heredoca (`cat > f <<EOF ...` \u2014 to zapisywany plik, nie komenda).
  // Wyjatek: secret-in-cmd patrzy na calosc \u2014 sekret w danych i tak laduje w transkrypcie.
  let code = text;
  for (const cmd of parsed.commands) for (const h of cmd.heredocs || []) if (!h.executed && h.body) code = code.split(h.body).join('\n');
  const nq = stripQuoted(code);
  const blocks = [];
  const observes = [];
  // Virtualny cwd: `cd X && git checkout ...` — reguly sciezkowe licza wzgledem ostatniego `cd` w lancuchu.
  // Tak samo zmienne: przypisania wczesniej w lancuchu (`D=/tmp/x; rm -rf "$D"`) rozwijamy w celach regul.
  let vcwd = c.cwd;
  let oldcwd = c.cwd;
  // vcwdKnown: czy wirtualny cwd jest PEWNY. Cel cd nieznany (podstawienie, nieznana zmienna, ~user, CDPATH, popd/pushd,
  // `source`) => false do konca lancucha; reguly zapisu wzgledem cwd (patch/edytory/archiwa) wtedy blokuja (fail-closed,
  // security-review r2 2026-10-10). Inne reguly dalej licza na najlepszym przyblizeniu vcwd.
  let vcwdKnown = true;
  let oldKnown = true;
  const pipeSeen = new Set();
  let linkTaint = false; // symlink utworzony w lancuchu: realpath go nie widzi — cwd juz nigdy pewny
  const env = {};
  const withCwd = parsed.commands.map((cmd) => {
    const chdirRaw = cmd.chdir != null ? expandVars(cmd.chdir, env) : null;
    const chdirOk = chdirRaw == null || !/[$`]|^~[^/]/.test(chdirRaw);
    const snapshot = { cwd: chdirRaw != null ? normalizePath(chdirRaw, vcwd) : vcwd, known: vcwdKnown && chdirOk, env: Object.assign({}, env) };
    Object.assign(env, cmd.values || {}, exportedValues(cmd));
    // `cd -P X`, `cd -- X`, `cd` (= HOME) — security-review 2026-10-10: argv[1] brany doslownie dawal vcwd=<cwd>/-P.
    if (cmd.prog === 'cd' || cmd.prog === 'set-location' || cmd.prog === 'pushd' || cmd.prog === 'popd') {
      const dest = cmd.argv.slice(1).filter((x) => x !== '--' && !/^-[LPe@]+$/.test(x))[0];
      const exp = dest != null ? expandVars(dest, env) : null;
      const prev = vcwd, prevKnown = vcwdKnown;
      if (cmd.prog === 'popd' || (cmd.prog === 'pushd' && !dest) || /^[+-]\d+$/.test(dest || '')) vcwdKnown = false;
      else if (dest === '-') { vcwd = oldcwd; vcwdKnown = vcwdKnown && oldKnown; } // `cd -` = OLDPWD (code-review r2)
      else if (exp) {
        if (/[$`]|^~[^/]/.test(exp)) vcwdKnown = false;
        else if (/^\//.test(exp)) vcwdKnown = !linkTaint; // absolutny literal = znowu pewny (security r3 FP), chyba ze wczesniej `ln -s`
        else if ((env.CDPATH || process.env.CDPATH) && !/^(\.\.?(\/|$)|\/|~(\/|$))/.test(exp)) vcwdKnown = false; // `.claude` tez szuka w CDPATH
        // Nieudany cd (cel nie istnieje) zostawia STARY cwd: gdy stary byl w/nad ~/.claude albo niepewny, dalej niepewny
        // (`cd "$X"; cd /nie-ma; ed …` i `cd ~/.claude; cd /nie-ma; patch` — code-review 2026-10-10).
        const target = normalizePath(exp, vcwd);
        if (!fs.existsSync(target) && (!prevKnown || nearClaude(prev) || /\/\.(git|claude)(\/|$)/.test(prev))) vcwdKnown = false; // + stary cwd w .git/.claude repo
        vcwd = target;
      } else if (cmd.prog === 'cd') vcwd = normalizePath(os.homedir());
      oldcwd = prev; oldKnown = prevKnown;
    }
    if (cmd.prog === 'source' || cmd.prog === '.') vcwdKnown = false;
    // Symlink tworzony w tym samym lancuchu nie istnieje w chwili oceny (realpath go nie zobaczy): `ln -s ~ X && cd X`.
    if (cmd.prog === 'ln' && cmd.argv.some((x) => /^-[a-zA-Z]*s/.test(x) || x === '--symbolic')) { vcwdKnown = false; linkTaint = true; }
    // nie pierwszy w potoku = stdin z potoku; klucz z glebokoscia — `$(...)` w srodku potoku nie przesuwa licznika (code-review)
    const pkey = cmd.pipeline + '|' + (cmd.depth || 0);
    const piped = pipeSeen.has(pkey); pipeSeen.add(pkey);
    return { cmd, cwd: snapshot.cwd, known: snapshot.known, piped, env: Object.assign(snapshot.env, cmd.values || {}, exportedValues(cmd)) };
  });
  const byPipeline = new Map();
  for (const { cmd } of withCwd) { if (!byPipeline.has(cmd.pipeline)) byPipeline.set(cmd.pipeline, []); byPipeline.get(cmd.pipeline).push(cmd); }
  for (const rule of RULES) {
    if (c.disabled.has(rule.id)) continue;
    if (rule.exemptSearch && !parsed.overflow && onlySearch(parsed)) continue; // grep PG_GATE_LOG = szukanie, nie ustawienie
    const legacyHit = !!(rule.legacy && rule.legacy(rule.fullText ? text : code, nq, { cwd: vcwd }));
    let parsedHit = false;
    if (!parsed.overflow) {
      if (rule.parsed) parsedHit = withCwd.some(({ cmd, cwd, known, piped, env: vars }) => rule.parsed(cmd, Object.assign({}, c, { cwd, cwdKnown: known, piped, env: vars })));
      if (!parsedHit && rule.pipeline) parsedHit = [...byPipeline.values()].some((cmds) => cmds.length > 1 && rule.pipeline(cmds, Object.assign({}, c, { cwd: vcwd, env })));
    }
    if (legacyHit) blocks.push({ id: rule.id, esc: rule.esc, why: rule.why, layer: 'legacy' });
    else if (parsedHit && rule.mode === 'observe') observes.push({ id: rule.id, why: rule.why });
    else if (parsedHit) blocks.push({ id: rule.id, esc: rule.esc, why: rule.why, layer: 'parser' });
  }
  if (parsed.overflow && !c.disabled.has('unparseable')) {
    blocks.push({ id: 'unparseable', esc: 'ALLOW_UNPARSEABLE', layer: 'parser', why: `Komendy nie da sie bezpiecznie przeczytac (${parsed.notes.join(', ')}). Rozbij ja na mniejsze albo zapisz skrypt do pliku (Write) i uruchom plik.` });
  }
  // Tokeny ALLOW_* liczone na PELNYM tekscie, z danymi heredoca: `cat > e.sh <<EOF export ALLOW_SECRET=1 EOF; . e.sh`
  // ustawia zmienna z pliku (security-review 2026-09-26). Cytaty dalej wycinamy (grep "ALLOW_X=1" to wzorzec).
  const nqFull = stripQuoted(text);
  return { blocks, observes, tokens: allowTokens(parsed, nqFull), overflow: parsed.overflow, notes: parsed.notes };
}

module.exports = { evaluate, RULES, allowTokens, isSafeRmTarget, SAFE_DIRS };

'use strict';
// name-lang (2026-10-24, observe): NOWE nazwy (repo, galaz, katalog, plik) po polsku. Blizna POLISH-NAMES-IN-NEW-ARTIFACTS
// w pg/cases.md: rozmowa po polsku przeciekla do nazw (`<github-owner>/montazownia`, `~/STARE-KOPIE-…`, `*_okladka.jpg`),
// a regula CLAUDE.md › Jezyk kodu byla tylko proza. Ten modul jest jedynym wlascicielem listy slow i tego, co liczy sie
// jako „nowa nazwa”. Nosnik: hooks/loop-monitor.js (PostToolUse, additionalContext dla modelu). Tryb observe wg
// ADR-0008: sygnal + `would_block` w gates.jsonl, nic nie blokuje; awans do blokady tylko po kolejnym incydencie.
// I/O tylko `fs.existsSync` (mv/cp do istniejacego katalogu = nie nowa nazwa); fail-open u nosnika.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parse, progName } = require('./shell-parse');

const DIACRITICS = /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/;
// Rdzenie (prefiks tokenu) — polskie slowa bez diakrytykow, ktore nie sa angielskimi slowami; rdzen krotszy od slowa,
// zeby lapal odmiane (klient/klienci -> `klien`). Krotkie slowa = tylko dokladny token (EXACT).
const STEMS = ['archiwum', 'cennik', 'decyzj', 'dokument', 'dzwiek', 'faktur', 'filmik', 'glown', 'katalog', 'klien', 'kopi',
  'miniatur', 'montaz', 'nagran', 'napis', 'notatk', 'obraz', 'okladk', 'pobran', 'podglad', 'poprawk', 'projekt', 'przycisk',
  'raport', 'sprzedaz', 'szablon', 'tymczas', 'ustawien', 'uzytkowni', 'wersj', 'wideo', 'wynik', 'zadani', 'zamowien', 'zdjec',
  'zmian', 'zrodl'];
const EXACT = new Set(['dane', 'nowa', 'nowe', 'nowy', 'plik', 'pliki', 'stara', 'stare', 'stary', 'kosz']);
// Pisanie po polsku jest tu zgodne z regula (notatki dla uzytkownika, pliki robocze bez publikacji).
const HOME = os.homedir();
const EXEMPT_ROOTS = [path.join(HOME, 'Obsidian'), os.tmpdir(), '/tmp'];

/** Pierwsze polskie slowo w nazwie albo null. Tokeny: separatory i granice camelCase. */
function polishWord(name) {
  const s = String(name || '');
  const d = s.match(DIACRITICS);
  if (d) return d[0];
  const tokens = s.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return tokens.find((t) => EXACT.has(t) || STEMS.some((x) => t.startsWith(x))) || null;
}

const expand = (p) => String(p).replace(/^(~|\$HOME|\$\{HOME\})(?=\/|$)/, HOME);
const resolveIn = (cwd, p) => path.resolve(cwd || process.cwd(), expand(p));
const exempt = (abs) => EXEMPT_ROOTS.some((r) => abs === r || abs.startsWith(r + path.sep));
const operands = (argv) => argv.slice(1).filter((a) => !/^-/.test(a));
const valueAfter = (argv, rx) => { const i = argv.findIndex((a) => rx.test(a)); return i < 0 ? null : argv[i + 1] || null; };
// `mv a dir/` albo `mv a dir` (dir istnial): plik trafil DO katalogu, nazwa sie nie zmienila
const intoDir = (src, dstAbs, dstRaw) => /\/$/.test(dstRaw) || (() => { try { return fs.existsSync(path.join(dstAbs, path.basename(src))); } catch (e) { return false; } })();

/** Nazwy tworzone przez jedna prosta komende: [{kind, name}]. `cwd` = katalog, w ktorym komenda biegnie. */
function namesFromCommand(cmd, cwd, depth) {
  const out = [];
  const argv = cmd.argv || [];
  const prog = progName(cmd.prog || argv[0]);
  const add = (kind, p) => {
    if (!p || /[`*?]|\$(?!HOME\b|\{HOME\})/.test(p)) return; // nieznana zmienna albo glob = nie wiemy, jaka nazwa
    const abs = resolveIn(cwd, String(p).replace(/\/+$/, ''));
    if (!exempt(abs)) out.push({ kind, name: path.basename(abs) });
  };
  // Komenda w stringu (menedzer sekretow (np. Infisical CLI) `-- bash -c '...'`): parser nie zna `python3 ... --` jako opakowania.
  const ci = argv.findIndex((a, i) => i > 0 && a === '-c' && /^(sh|bash|zsh|dash)$/.test(progName(argv[i - 1])));
  if (ci > 0 && depth < 3 && prog !== 'sh' && prog !== 'bash') out.push(...namesFromBash(argv[ci + 1] || '', cwd, depth + 1));
  if (prog === 'mkdir') operands(argv).filter((a) => !/^\d{3,4}$/.test(a)).forEach((a) => add('dir', a));
  else if (prog === 'mv' || prog === 'cp' || prog === 'ln') {
    const ops = operands(argv);
    if (ops.length === 2 && !intoDir(ops[0], resolveIn(cwd, ops[1]), ops[1]) && path.basename(ops[0]) !== path.basename(ops[1])) add(prog === 'ln' ? 'link' : 'path', ops[1]);
  } else if (prog === 'git') {
    const sub = argv[1];
    const ops = operands(argv);
    const b = sub === 'checkout' ? valueAfter(argv, /^-[bB]$/) : sub === 'switch' ? valueAfter(argv, /^(-c|-C|--create)$/) : sub === 'worktree' && argv[2] === 'add' ? valueAfter(argv, /^-[bB]$/) : null;
    if (b) out.push({ kind: 'branch', name: b });
    if (sub === 'branch' && ops.length === 2) out.push({ kind: 'branch', name: ops[1] });
    if (sub === 'mv' && ops.length === 3) add('path', ops[2]);
    if (sub === 'worktree' && argv[2] === 'add') { const wt = argv.slice(3).find((a, i, r) => !/^-/.test(a) && !/^-[bB]$/.test(r[i - 1] || '')); if (wt) add('dir', wt); }
    if (sub === 'clone' && ops.length === 3) add('dir', ops[2]);
  } else if (prog === 'gh' && argv[1] === 'repo' && /^(create|rename)$/.test(argv[2] || '')) {
    const n = operands(argv).slice(2)[0];
    if (n) out.push({ kind: 'repo', name: n.split('/').pop() });
  } else if (prog === 'gh' && argv[1] === 'api' && argv.some((a) => /(^|\/)(user|orgs\/[^/]+)\/repos$|^\/?repos\/[^/]+\/[^/]+$/.test(a))) {
    argv.forEach((a, i) => { if (/^-[fF]$|^--(raw-)?field$/.test(argv[i - 1] || '') && /^name=/.test(a)) out.push({ kind: 'repo', name: a.slice(5) }); });
  }
  return out;
}

/** Lancuch komend; `cd <literal>` przesuwa katalog dla kolejnych komend (`cd /tmp && mkdir kopie` = wyjatek /tmp). */
function namesFromBash(command, cwd, depth) {
  let parsed;
  try { parsed = parse(String(command || '')); } catch (e) { return []; }
  if (parsed.overflow) return [];
  let here = cwd || process.cwd();
  const out = [];
  for (const c of parsed.commands) {
    if (c.prog === 'cd') { const d = (c.argv || []).slice(1).find((a) => !/^-/.test(a)); if (d && !/[$`]/.test(expand(d))) here = resolveIn(here, d); continue; }
    out.push(...namesFromCommand(c, here, depth || 0));
  }
  return out;
}

/** Nazwy tworzone przez wywolanie narzedzia (wejscie PostToolUse). Write tylko przy nowym pliku (tool_response.type != 'update'). */
function namesFromTool(toolName, toolInput, toolResponse, cwd) {
  const t = String(toolName || '');
  const i = toolInput || {};
  if (t === 'Bash') return namesFromBash(i.command, cwd);
  // desktop-commander write_file nie mowi, czy plik byl nowy (odpowiedz = tekst) — pomijamy, zeby nadpisanie nie bylo „nowa nazwa”.
  if (t === 'Write' && i.file_path) {
    const updated = toolResponse && typeof toolResponse === 'object' && toolResponse.type === 'update';
    const abs = resolveIn(cwd, i.file_path);
    return !updated && !exempt(abs) ? [{ kind: 'file', name: path.basename(abs) }] : [];
  }
  if (t === 'mcp__github__create_repository' && i.name) return [{ kind: 'repo', name: i.name }];
  if (t === 'mcp__github__create_branch' && i.branch) return [{ kind: 'branch', name: i.branch }];
  return [];
}

/** [{kind, name, word}] dla nowych nazw z polskim slowem. */
function polishNames(toolName, toolInput, toolResponse, cwd) {
  return namesFromTool(toolName, toolInput, toolResponse, cwd)
    .map((n) => Object.assign(n, { word: polishWord(n.name) }))
    .filter((n) => n.word);
}

function message(hits) {
  const list = hits.map((h) => `${h.kind} \`${h.name}\` (slowo: ${h.word})`).join(', ');
  return `[name-lang] Nowa nazwa po polsku: ${list}. CLAUDE.md › Jezyk kodu: nazwy repo, galezi, katalogow i plikow po angielsku, ` +
    'takze gdy rozmowa jest po polsku. Zmien nazwe teraz (przed pushem / publikacja). Wyjatek: istniejace repo z polska konwencja ' +
    '(nowy kod w starym repo = konwencja tego repo) — wtedy zostaw i nie zmieniaj.';
}

module.exports = { polishWord, polishNames, namesFromBash, namesFromTool, message, STEMS, EXACT };

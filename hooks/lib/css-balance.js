'use strict';
// Bilans nawiasow {} () [] — bramka 0-tokenowa (lekcja 2026-10-06: niedomkniety @media przeszedl lint, tsc,
// vitest, build i qa-matrix, bo parser CSS jest poblazliwy; scalanie „ours+theirs" potrafi uciac `}`).
// Pomija komentarze i stringi. Rodzaje: css, scss, js (ts/tsx/js/jsx — heurystyka regex-literalu), json.
// Wynik: null = zbilansowane | { line, message } — `line` = linia, w ktorej otwarty blok sie nie domyka
// (albo linia nadmiarowego/niepasujacego zamkniecia).
const path = require('path');

const PAIRS = { '{': '}', '(': ')', '[': ']' };
const CLOSERS = { '}': '{', ')': '(', ']': '[' };
// Po tych znakach `/` zaczyna regex, nie dzielenie (heurystyka wystarczajaca dla bilansu).
// Bez `<`, `>` i `}`: w JSX `</div>` i `{x} />` to nie regex.
const REGEX_PREV_RX = /[(,=:[!&|?{;+\-*%~^]|^$/;
const REGEX_KEYWORD_RX = /(?:^|[^\w$])(?:return|typeof|case|do|else|in|of|void|yield|await)$/;

function kindOf(file) {
  const ext = path.extname(String(file)).toLowerCase();
  if (ext === '.css') return 'css';
  if (ext === '.scss') return 'scss';
  if (ext === '.json') return 'json';
  if (['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'].includes(ext)) return 'js';
  return null;
}

/** Linia (1-based) pierwszej „nowej sekcji" na glebokosci > 0: komentarz albo selektor/at-rule od kolumny 0. */
function suspectLine(lines, fromLine, depthAt) {
  for (let i = fromLine; i < lines.length; i++) {
    const l = lines[i];
    if (!l.trim() || /^\s/.test(l) || /^[})\]]/.test(l)) continue;
    if (depthAt[i] > 0) return i + 1;
  }
  return null;
}

function checkBalance(text, kind) {
  const src = String(text);
  const stack = [];
  const depthAt = []; // glebokosc {} na poczatku kazdej linii
  let line = 1;
  let lastSig = ''; // ostatni znaczacy znak (do heurystyki regex w js)
  let lastWord = '';
  let prevSig = ''; // znak przed lastSig: `=>` konczy sie na `>`, a po strzalce `/` to regex
  const isCss = kind === 'css' || kind === 'scss';
  // json = tez JSONC (tsconfig.json, .vscode/*.json): komentarze nie licza sie do bilansu
  const lineComment = kind === 'js' || kind === 'scss' || kind === 'json';
  const blockComment = true;
  const curlyDepth = () => stack.filter((s) => s.ch === '{').length;
  depthAt[0] = 0;
  const newline = () => { line++; depthAt[line - 1] = curlyDepth(); };

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const n = src[i + 1];
    if (c === '\n') { newline(); continue; }
    if (blockComment && c === '/' && n === '*') {
      const openLine = line;
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') newline(); i++; }
      // niedomkniety komentarz zjada reszte pliku (np. uciete `*/` przy scalaniu) — to tez blad
      if (i >= src.length) return { line: openLine, message: `komentarz '/*' otwarty w linii ${openLine} nie jest domkniety (brak '*/')` };
      i++; continue;
    }
    if (isCss && c === '\\') { i++; if (src[i] === '\n') newline(); continue; } // escape w selektorze: .w-\[1px\], .x\{, \'
    if (isCss && (c === 'u' || c === 'U') && /^url\(\s*[^\s'"]/i.test(src.slice(i, i + 6))) {
      // url(...) bez cudzyslowu: tresc (np. //cdn..., data:...) nie jest komentarzem ani nawiasami
      const end = src.indexOf(')', i);
      const nl = src.indexOf('\n', i);
      if (end !== -1 && (nl === -1 || end < nl)) { i = end; lastSig = ')'; lastWord = ''; continue; }
    }
    // `//` = komentarz, ale nie `http://` (poprzedzone `:`): scss `url(http://...)`, tekst JSX „od https://)"
    if (lineComment && c === '/' && n === '/' && src[i - 1] !== ':') {
      while (i < src.length && src[i] !== '\n') i++;
      i--; continue;
    }
    if (c === '"' || c === "'") {
      // string konczy sie na tym samym cudzyslowie albo na koncu linii (niedomkniety string nie zjada pliku)
      i++;
      while (i < src.length && src[i] !== c && src[i] !== '\n') { if (src[i] === '\\') i++; i++; }
      if (src[i] === '\n') i--;
      lastSig = c; lastWord = ''; continue;
    }
    if (kind === 'js' && c === '`') {
      // template literal: ${ ... } liczymy jako zwykle nawiasy przez rekurencje na wycinku
      i++;
      while (i < src.length && src[i] !== '`') {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '\n') newline();
        if (src[i] === '$' && src[i + 1] === '{') {
          let depth = 1; i += 2;
          while (i < src.length && depth) {
            if (src[i] === '{') depth++; else if (src[i] === '}') depth--; else if (src[i] === '\n') newline();
            if (depth) i++;
          }
        }
        i++;
      }
      lastSig = '`'; lastWord = ''; continue;
    }
    if (kind === 'js' && c === '/' && (REGEX_PREV_RX.test(lastSig) || (lastSig === '>' && prevSig === '=') || REGEX_KEYWORD_RX.test(lastWord))) {
      let inClass = false; i++;
      while (i < src.length && src[i] !== '\n') {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '[') inClass = true; else if (src[i] === ']') inClass = false; else if (src[i] === '/' && !inClass) break;
        i++;
      }
      if (src[i] === '\n') i--;
      lastSig = '/'; lastWord = ''; continue;
    }
    if (PAIRS[c]) stack.push({ ch: c, line });
    else if (CLOSERS[c]) {
      const top = stack.pop();
      if (!top) return { line, message: `nadmiarowe '${c}' w linii ${line} (nic nie jest otwarte)` };
      if (top.ch !== CLOSERS[c]) return { line: top.line, message: `'${top.ch}' z linii ${top.line} zamkniete przez '${c}' w linii ${line}` };
    }
    if (!/\s/.test(c)) { prevSig = lastSig; lastSig = c; lastWord = /[\w$]/.test(c) ? lastWord + c : ''; }
  }
  if (!stack.length) return null;
  const open = stack[stack.length - 1];
  const outer = stack.find((s) => s.ch === '{') || open;
  const lines = src.split('\n');
  const suspect = (kind === 'css' || kind === 'scss') ? suspectLine(lines, outer.line, depthAt) : null;
  return {
    line: outer.line,
    message: `'${outer.ch}' otwarte w linii ${outer.line} nie jest domkniete (${stack.length} otwartych na koncu pliku)` +
      (suspect ? `; linia ${suspect} zaczyna nowa sekcje na glebokosci > 0 — brakuje '}' przed nia` : ''),
  };
}

/** Dla pliku: null albo { line, message }. Nieobslugiwane rozszerzenie = null. */
function checkFile(file, text) {
  const kind = kindOf(file);
  return kind ? checkBalance(text, kind) : null;
}

module.exports = { checkBalance, checkFile, kindOf };

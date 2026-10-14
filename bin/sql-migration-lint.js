#!/usr/bin/env node
'use strict';
/*
 * sql-migration-lint.js
 * Zero-dep, regex/token-based linter for Supabase/Postgres migration folders.
 * Flags anti-patterns that have ACTUALLY bitten the PG fleet:
 *  - marketplace-app pentest (RLS gate on wrong state, USING without WITH CHECK, DEFINER w/o search_path)
 *  - workshop-app cross-tenant IDOR (FK without org/tenant scoping + zz_same_org_trg pattern)
 * No DB connection. Pure static analysis over supabase/migrations/*.sql (+ migrations/*.sql).
 */

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Severity model
// ---------------------------------------------------------------------------
const SEVERITY = { INFO: 0, LOW: 1, MEDIUM: 2, HIGH: 3 };
const SEVERITY_NAME = ['INFO', 'LOW', 'MEDIUM', 'HIGH'];

// Ratio above which a check firing on that many files in one repo is treated
// as "heuristic too broad" and downgraded to INFO instead of trusted signal.
const BROAD_HEURISTIC_RATIO = 0.6;
const MIN_FILES_FOR_DOWNGRADE = 10; // ponizej tej liczby plikow nie ma statystyki — kazde trafienie liczy sie jako realne

// ---------------------------------------------------------------------------
// Check registry: id -> { severity, why }
// ---------------------------------------------------------------------------
const CHECKS = {
  R1: { severity: SEVERITY.HIGH, why: 'table created but RLS never enabled -> open table (IDOR)' },
  R2: { severity: SEVERITY.HIGH, why: 'USING without WITH CHECK lets writes bypass the read-side gate' },
  R3: { severity: SEVERITY.HIGH, why: 'write policy explicitly granted to public/anon' },
  R4: { severity: SEVERITY.HIGH, why: 'SECURITY DEFINER function missing search_path pin or execute lockdown' },
  R5: { severity: SEVERITY.HIGH, why: 'GRANT to anon beyond SELECT' },
  R6: { severity: SEVERITY.MEDIUM, why: 'destructive DDL without IF EXISTS breaks re-run / partial-apply migrations' },
  R7: { severity: SEVERITY.HIGH, noDowngrade: true, why: 'ADD COLUMN ... NOT NULL without DEFAULT fails on existing rows and breaks old code that inserts without it (expand/contract)' },
  R8: { severity: SEVERITY.LOW, why: 'FK-shaped column with no matching index (heuristic, perf not security)' },
  R9: { severity: SEVERITY.HIGH, why: 'job/note/order/customer FK with no org/tenant column and no same_org trigger (workshop-app IDOR pattern)' },
  R10: { severity: SEVERITY.HIGH, why: 'SECURITY DEFINER RPC takes an id param but body has no auth.uid()/org check' },
  R11: { severity: SEVERITY.MEDIUM, why: 'USING (true) on a non-obviously-public table -> unrestricted row access' },
  R12: { severity: SEVERITY.MEDIUM, why: 'migration filename does not sort deterministically (bad prefix or duplicate timestamp)' },
  R13: { severity: SEVERITY.INFO, why: 'function left at default EXECUTE-to-PUBLIC (no REVOKE/GRANT tightening seen)' },
  R14: { severity: SEVERITY.HIGH, noDowngrade: true, why: 'backward-incompatible schema change (RENAME / DROP / SET NOT NULL / TYPE / SET SCHEMA on an existing table, function, view, type or schema): the previous app version runs on the new schema during BAKE and after a rollback — split into expand/contract, or put `-- pg:contract <reason>` in the file header (before the first statement)' },
};

// ---------------------------------------------------------------------------
// Shared regex fragments (named so the "why" is traceable to the pattern)
// ---------------------------------------------------------------------------
const RE = {
  createTable: /create\s+table\s+(?:if\s+not\s+exists\s+)?"?([a-zA-Z0-9_.]+)"?/i,
  enableRls: /alter\s+table\s+(?:if\s+exists\s+)?"?([a-zA-Z0-9_.]+)"?\s+enable\s+row\s+level\s+security/i,
  createPolicyTable: /create\s+policy\s+(?:"[^"]+"|\S+)\s+on\s+"?([a-zA-Z0-9_.]+)"?/i,
  policyFor: /\bfor\s+(select|insert|update|delete|all)\b/i,
  policyTo: /\bto\s+([a-zA-Z0-9_,\s"]+?)(?=\s+using\b|\s+with\b|$)/i,
  hasUsing: /\busing\s*\(/i,
  hasWithCheck: /\bwith\s+check\s*\(/i,
  usingTrue: /\busing\s*\(\s*true\s*\)/i,
  createFunction: /create\s+(?:or\s+replace\s+)?function\s+"?([a-zA-Z0-9_.]+)"?\s*\(([^)]*)\)/i,
  securityDefiner: /security\s+definer/i,
  setSearchPath: /set\s+search_path/i,
  returnsTrigger: /returns\s+trigger/i,
  revokeExecute: /revoke\s+execute\s+on\s+function\s+"?([a-zA-Z0-9_.]+)"?[^;]*from\s+([a-zA-Z0-9_,\s"]+)/i,
  grantExecute: /grant\s+execute\s+on\s+function\s+"?([a-zA-Z0-9_.]+)"?[^;]*to\s+([a-zA-Z0-9_,\s"]+)/i,
  grantStmt: /grant\s+([a-zA-Z0-9_,\s]+?)\s+on\s+(?:table\s+)?"?([a-zA-Z0-9_.]+)"?\s+to\s+([a-zA-Z0-9_,\s"]+)/i,
  dropStmt: /drop\s+(table|column|policy|function|trigger|index)\s+(?!if\s+exists)/i,
  addColumnClause: /add\s+column\s+(?:if\s+not\s+exists\s+)?"?([a-zA-Z0-9_]+)"?\s+([a-zA-Z0-9_(),\s]+?)(?=,\s*add\s+column|$)/gi,
  alterTableName: /alter\s+table\s+(?:if\s+exists\s+)?"?([a-zA-Z0-9_.]+)"?/i,
  fkReferences: /"?([a-zA-Z0-9_]+)"?\s+\w+(?:\([^)]*\))?\s+references\b/gi,
  fkIdUuid: /(^|[,(\s])"?([a-zA-Z0-9_]+_id)"?\s+uuid\b/gi,
  createIndex: /create\s+(?:unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?"?[a-zA-Z0-9_]+"?\s+on\s+"?[a-zA-Z0-9_.]+"?\s*\(([^)]*)\)/i,
  tenantScopeCol: /\b(org_id|organization_id|tenant_id)\b/i,
  tenantFkCol: /\b(job_id|note_id|order_id|customer_id)\b/i,
  createTrigger: /create\s+trigger\s+"?([a-zA-Z0-9_]+)"?\s+[\s\S]*?\bon\s+"?([a-zA-Z0-9_.]+)"?/i,
  sameOrgTrigger: /same_org/i,
  dollarBody: /\$([a-zA-Z_][a-zA-Z0-9_]*)?\$([\s\S]*?)\$\1\$/,
  authUidCall: /auth\.uid\s*\(/i,
  orgMention: /org/i,
  fileNamePrefix: /^(\d{14})_/,
  lintIgnore: /lint-ignore\s+(r\d+)/i,
  // Znacznik kroku contract: wlasna linia komentarza w NAGLOWKU pliku (przed 1. instrukcja) z powodem — wzmianka w srodku
  // pliku albo w literale nie zwalnia (code/data-review 2026-10-11).
  pgContract: /^\s*--\s*pg:contract\b\s*[:\-–—]?\s*\S.{8,}$/i,
};

// Identyfikator SQL: "cytowany" albo goly; nazwa kwalifikowana schema.obiekt — format `supabase db diff` to "public"."orders"
// (stare regexy lapaly z niego samo "public": data-review 2026-10-11).
const SQL_ID = '(?:"(?:[^"]|"")+"|[a-zA-Z_][a-zA-Z0-9_$]*)';
const SQL_QID = `${SQL_ID}(?:\\s*\\.\\s*${SQL_ID})?`;
const OBJ_KIND = '(function|procedure|view|materialized\\s+view|type|schema)';
const RE14 = {
  createTable: new RegExp(`^create\\s+(?:(?:global\\s+|local\\s+)?(?:temp|temporary|unlogged)\\s+)?table\\s+(if\\s+not\\s+exists\\s+)?(${SQL_QID})`, 'i'),
  alterTable: new RegExp(`^alter\\s+table\\s+(?:if\\s+exists\\s+)?(?:only\\s+)?(${SQL_QID})\\s*\\*?\\s+([\\s\\S]+)$`, 'i'),
  dropTable: /^drop\s+table\s+(?:if\s+exists\s+)?([\s\S]+?)(?:\s+(?:cascade|restrict))?$/i,
  createObject: new RegExp(`^create\\s+(?:or\\s+replace\\s+)?${OBJ_KIND}\\s+(?:if\\s+not\\s+exists\\s+)?(${SQL_QID})`, 'i'),
  dropObject: new RegExp(`^drop\\s+${OBJ_KIND}\\s+(?:if\\s+exists\\s+)?([\\s\\S]+?)(?:\\s+(?:cascade|restrict))?$`, 'i'),
  renameObject: new RegExp(`^alter\\s+${OBJ_KIND}\\s+(?:if\\s+exists\\s+)?(${SQL_QID})[\\s\\S]*?\\b(?:rename\\s+(value|to|attribute|column)|set\\s+(schema))\\b`, 'i'),
  qid: new RegExp(`^(${SQL_QID})`),
  actRenameTo: new RegExp(`^rename\\s+to\\s+(${SQL_ID})`, 'i'),
  actRenameConstraint: /^rename\s+constraint\b/i,
  actRenameColumn: new RegExp(`^rename\\s+(?:column\\s+)?(${SQL_ID})\\s+to\\b`, 'i'),
  actSetSchema: new RegExp(`^set\\s+schema\\s+(${SQL_ID})`, 'i'),
  actSetNotNull: new RegExp(`^alter\\s+(?:column\\s+)?(${SQL_ID})\\s+set\\s+not\\s+null\\b`, 'i'),
  actType: new RegExp(`^alter\\s+(?:column\\s+)?(${SQL_ID})\\s+(?:set\\s+data\\s+)?type\\b`, 'i'),
  actDropConstraint: /^drop\s+constraint\b/i,
  // unikalny/PK constraint (domyslne nazwy Postgresa *_key / *_pkey): stary .upsert(onConflict) bez niego = 42P10.
  actDropUnique: new RegExp(`^drop\\s+constraint\\s+(?:if\\s+exists\\s+)?(${SQL_ID})`, 'i'),
  actDropDefault: new RegExp(`^alter\\s+(?:column\\s+)?(${SQL_ID})\\s+(?:drop\\s+default|set\\s+default\\s+null)\\b`, 'i'),
  dropIndex: /^drop\s+index\s+(?:concurrently\s+)?(?:if\s+exists\s+)?([\s\S]+?)(?:\s+(?:cascade|restrict))?$/i,
  uniqueIndexName: new RegExp(`^create\\s+unique\\s+index\\s+(?:concurrently\\s+)?(?:if\\s+not\\s+exists\\s+)?(${SQL_ID})\\s+on\\s+(?:only\\s+)?${SQL_QID}[^(]*\\(([^)]*)\\)`, 'i'),
  uniqueConstraintNames: new RegExp(`\\bconstraint\\s+(${SQL_ID})\\s+(?:unique|primary\\s+key)\\b`, 'gi'),
  actDropColumn: new RegExp(`^drop\\s+(?:column\\s+)?(?:if\\s+exists\\s+)?(${SQL_ID})`, 'i'),
};

const SKIP_SCHEMAS = new Set(['auth', 'storage', 'extensions', 'graphql', 'graphql_public', 'realtime', 'vault', 'pgsodium', 'net']);
const PUBLIC_NAME_HINT = /(public|catalog|listing|post|page|blog|announcement)/i;

// ---------------------------------------------------------------------------
// Statement splitting: line-comment / block-comment / string / dollar-quote
// aware, so semicolons inside function bodies don't split statements.
// ---------------------------------------------------------------------------
function buildLineIndex(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  return starts;
}

function indexToLine(lineStarts, idx) {
  let lo = 0, hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid] <= idx) lo = mid; else hi = mid - 1;
  }
  return lo + 1;
}

// Find the offset of the first real SQL token in a raw statement slice,
// skipping leading whitespace and leading line/block comments. Needed so a
// `-- lint-ignore Rn` comment immediately above a statement is recognized as
// "the line above the statement", not "the line above its own comment".
function skipLeadingNoise(s) {
  let i = 0;
  const n = s.length;
  for (;;) {
    while (i < n && /\s/.test(s[i])) i++;
    if (s[i] === '-' && s[i + 1] === '-') {
      while (i < n && s[i] !== '\n') i++;
      continue;
    }
    if (s[i] === '/' && s[i + 1] === '*') {
      i += 2;
      while (i < n && !(s[i] === '*' && s[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    break;
  }
  return i;
}

function splitStatements(text) {
  const lineStarts = buildLineIndex(text);
  const stmts = [];
  const n = text.length;
  let i = 0;
  let stmtStart = 0;

  const pushStmt = (rawText, rawStart) => {
    const offset = skipLeadingNoise(rawText);
    const body = rawText.slice(offset).trim();
    if (body.length === 0) return; // pure whitespace/comment tail
    stmts.push({ text: body, startLine: indexToLine(lineStarts, rawStart + offset) });
  };

  while (i < n) {
    const ch = text[i];
    if (ch === '-' && text[i + 1] === '-') {
      while (i < n && text[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < n && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (ch === "'") {
      // E'...' dopuszcza \' — bez tego literal „konczyl sie" za wczesnie i polykal nastepne instrukcje (data-review 2026-10-11)
      const eString = /[eE]/.test(text[i - 1] || '') && !/[A-Za-z0-9_]/.test(text[i - 2] || '');
      i++;
      while (i < n) {
        if (eString && text[i] === '\\') { i += 2; continue; }
        if (text[i] === "'" && text[i + 1] === "'") { i += 2; continue; }
        if (text[i] === "'") { i++; break; }
        i++;
      }
      continue;
    }
    if (ch === '"') {
      i++;
      while (i < n) {
        if (text[i] === '"' && text[i + 1] === '"') { i += 2; continue; }
        if (text[i] === '"') { i++; break; }
        i++;
      }
      continue;
    }
    if (ch === '$') {
      const m = /^\$([a-zA-Z_][a-zA-Z0-9_]*)?\$/.exec(text.slice(i, i + 40));
      if (m) {
        const tag = m[0];
        const bodyStart = i + tag.length;
        const closeIdx = text.indexOf(tag, bodyStart);
        i = closeIdx === -1 ? n : closeIdx + tag.length;
        continue;
      }
    }
    if (ch === ';') {
      pushStmt(text.slice(stmtStart, i), stmtStart);
      i++;
      stmtStart = i;
      continue;
    }
    i++;
  }
  pushStmt(text.slice(stmtStart), stmtStart);
  return stmts;
}

// ---------------------------------------------------------------------------
// File discovery
// ---------------------------------------------------------------------------
function findMigrationFiles(repoPath) {
  const dirs = [path.join(repoPath, 'supabase', 'migrations'), path.join(repoPath, 'migrations')];
  const files = [];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (name.toLowerCase().endsWith('.sql')) {
        files.push({ name, fullPath: path.join(dir, name), relDir: path.relative(repoPath, dir) });
      }
    }
  }
  files.sort((a, b) => a.name.localeCompare(b.name));
  return files;
}

function normalizeTable(name) {
  return name.replace(/"/g, '').replace(/\s+/g, '').toLowerCase().replace(/^public\./, '');
}

// Tekst instrukcji bez komentarzy poza 'literalami' i "identyfikatorami" (DEFAULT '--' nie ucina reszty instrukcji).
function ddlText(text) {
  let out = '';
  let q = null;
  let esc = false; // E'...' z \' (data-review 2026-10-11): bez tego reszta instrukcji ginela jako literal
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (esc && ch === '\\') { out += '  '; i++; continue; }
      out += ch; if (ch === q) q = null; continue;
    }
    if (ch === "'" || ch === '"') { q = ch; esc = ch === "'" && /[eE]/.test(text[i - 1] || '') && !/[A-Za-z0-9_]/.test(text[i - 2] || ''); out += ch; continue; }
    if (ch === '-' && text[i + 1] === '-') { while (i < text.length && text[i] !== '\n') i++; out += ' '; continue; }
    if (ch === '/' && text[i + 1] === '*') { const e = text.indexOf('*/', i + 2); i = e === -1 ? text.length : e + 1; out += ' '; continue; }
    out += ch;
  }
  return out.trim();
}

// Zawartosc nawiasow tuz za pozycja `from` (lista argumentow funkcji) albo null, gdy nawiasow brak.
function parenArgs(text, from) {
  let i = from;
  while (i < text.length && /\s/.test(text[i])) i++;
  if (text[i] !== '(') return null;
  let depth = 0;
  for (let j = i; j < text.length; j++) {
    if (text[j] === '(') depth++;
    else if (text[j] === ')' && --depth === 0) return text.slice(i + 1, j);
  }
  return null;
}
// Sygnatura funkcji: DROP f(typy) pasuje do CREATE f(...) tylko przy tych samych typach w tej samej kolejnosci (nazwa
// parametru, IN/VARIADIC i DEFAULT pomijane; typ DROP = sufiks argumentu CREATE). Alias typu (int/integer) = brak dopasowania
// = trafienie (ostroznie). DROP bez listy argumentow = po nazwie.
const MULTIWORD_TYPE_RX = /^(?:double\s+precision|character\s+varying|bit\s+varying|(?:timestamp|time)(?:\s*\(\d+\))?\s+with(?:out)?\s+time\s+zone)\b/i;
// Parametr funkcji: {name|null, type, out, hasDefault}. Jeden token = sam typ (lista DROP).
function parseParam(raw) {
  let a = raw.replace(/"/g, '').replace(/\s+/g, ' ').trim();
  const hasDefault = /\s(?:default\b|=)/i.test(` ${a}`);
  a = a.replace(/\s*(?:\bdefault\b|=)[\s\S]*$/i, '').trim();
  const mode = (/^(in|out|inout|variadic)\s+/i.exec(a) || [])[1];
  if (mode) a = a.slice(mode.length).trim();
  const lower = a.toLowerCase();
  const sp = lower.indexOf(' ');
  const typeOnly = sp < 0 || MULTIWORD_TYPE_RX.test(lower);
  return { name: typeOnly ? null : lower.slice(0, sp), type: typeOnly ? lower : lower.slice(sp + 1), out: /^out$/i.test(mode || ''), hasDefault };
}
const inParams = (args) => (args == null ? null : splitTopLevel(args).map(parseParam).filter((p) => !p.out));
// Nowa definicja zgodna ze stara: kazdy stary parametr jest (po nazwie, a gdy nazwy brak — po pozycji) z tym samym typem,
// a kazdy NOWY ma DEFAULT. Alias typu (int/integer) = niezgodne (ostroznie).
function compatibleParams(prev, next) {
  if (!prev || !next) return false;
  const used = new Set();
  for (let i = 0; i < prev.length; i++) {
    const p = prev[i];
    const j = p.name ? next.findIndex((q) => q.name === p.name) : i;
    if (j < 0 || j >= next.length || next[j].type !== p.type) return false;
    used.add(j);
  }
  return next.every((q, j) => used.has(j) || q.hasDefault);
}
const normArg = (a) => a.toLowerCase().replace(/"/g, '').replace(/\s*(?:\bdefault\b|=)[\s\S]*$/, '').replace(/^(?:in|inout|variadic)\s+/, '').replace(/\s+/g, ' ').trim();
function sigMatches(dropArgs, createArgs) {
  if (dropArgs == null) return true;
  if (createArgs == null) return false;
  const d = splitTopLevel(dropArgs).map(normArg);
  const c = splitTopLevel(createArgs).map(normArg).filter((a) => !/^out\s/.test(a));
  return d.length === c.length && d.every((t, i) => c[i] === t || c[i].endsWith(' ' + t));
}

// Podzial po przecinkach na najwyzszym poziomie (poza nawiasami, 'literalami' i "identyfikatorami").
function splitTopLevel(text) {
  const parts = [];
  let depth = 0, start = 0, q = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === q) q = null; continue; }
    if (ch === "'" || ch === '"') q = ch;
    else if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ',' && depth === 0) { parts.push(text.slice(start, i)); start = i + 1; }
  }
  parts.push(text.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}

// Czy tabela jest NOWA (pusta, nieuzywana przez stary kod) w miejscu instrukcji `seq`: utworzona w tym samym pliku
// WCZESNIEJ zwyklym `create table` (bez if not exists); create PO alterze nie zwalnia altera; `drop table x; create table x` -> drop flagowany osobno.
function newTableIndex(allStmts) {
  const perFile = new Map();
  allStmts.forEach((s, seq) => {
    const c = RE14.createTable.exec(ddlText(s.text));
    if (!c) return;
    const t = normalizeTable(c[2]);
    // `if not exists` = autor zaklada, ze tabela moze juz istniec (takze spoza historii migracji: panel, Lovable) —
    // nigdy nie zwalnia (code-review 2026-10-11, runda 2).
    if (c[1]) return;
    if (!perFile.has(s.file)) perFile.set(s.file, new Map());
    const f = perFile.get(s.file);
    if (!f.has(t)) f.set(t, seq);
  });
  return (file, seq, table) => {
    const at = perFile.get(file) && perFile.get(file).get(normalizeTable(table));
    return at !== undefined && at < seq;
  };
}

// Instrukcje z cial `do $$ ... $$` dolaczone jako wirtualne instrukcje (ten sam plik i linia bloku). Idempotentny
// wzorzec `if exists (...) then alter table ...; end if;` byl dla R14/R7 niewidoczny (data-review 2026-10-11, runda 2).
// Dynamiczny SQL (`execute '...'`) zostaje poza zasiegiem.
const DDL_START_RX = /\b(?:alter\s+(?:table|function|procedure|view|materialized\s+view|type|schema)|drop\s+(?:table|function|procedure|view|materialized\s+view|type|schema)|create\s+(?:or\s+replace\s+)?(?:(?:global\s+|local\s+)?(?:temp|temporary|unlogged)\s+)?(?:table|function|procedure|view|materialized\s+view|type|schema))\b/i;
function withDoBlocks(allStmts) {
  const out = [];
  for (const s of allStmts) {
    out.push(s);
    if (!/^do\b/i.test(s.text)) continue;
    const body = RE.dollarBody.exec(s.text);
    if (!body) continue;
    for (const inner of splitStatements(body[2])) {
      const t = ddlText(inner.text);
      const masked = t.replace(/'(?:[^']|'')*'/g, (m) => ' '.repeat(m.length));
      const at = masked.search(DDL_START_RX);
      if (at >= 0) out.push({ ...s, text: t.slice(at), fromDo: true });
    }
  }
  return out;
}

// Unikalny klucz/indeks (cel onConflict starego upsertu): nazwa znana z repo (create unique index / constraint ... unique|primary key)
// albo domyslny wzorzec nazwy. uniqueNames ustawia checkR14 przed iteracja.
let uniqueNames = new Set();
const isUniqueName = (n) => uniqueNames.has(normalizeTable(n)) || /(_p?key|_uq|_uidx|uniq\w*)"?$/i.test(n);

// Akcje ALTER TABLE niezgodne wstecz: [{kind, col?, to?}].
function breakingAlterActions(rest) {
  const out = [];
  for (const a of splitTopLevel(rest)) {
    let m;
    if ((m = RE14.actRenameTo.exec(a))) out.push({ kind: 'RENAME TABLE', to: m[1] });
    else if (RE14.actRenameConstraint.test(a)) continue;
    else if ((m = RE14.actRenameColumn.exec(a))) out.push({ kind: 'RENAME COLUMN', col: m[1] });
    else if ((m = RE14.actSetSchema.exec(a))) out.push({ kind: 'SET SCHEMA', to: m[1] });
    else if ((m = RE14.actSetNotNull.exec(a))) out.push({ kind: 'SET NOT NULL', col: m[1] });
    else if ((m = RE14.actType.exec(a))) out.push({ kind: 'ALTER COLUMN TYPE', col: m[1] });
    else if ((m = RE14.actDropDefault.exec(a))) out.push({ kind: 'DROP DEFAULT', col: m[1] });
    else if ((m = RE14.actDropUnique.exec(a)) && isUniqueName(m[1])) out.push({ kind: 'DROP UNIQUE', col: m[1] });
    else if (RE14.actDropConstraint.test(a)) continue;
    else if ((m = RE14.actDropColumn.exec(a))) out.push({ kind: 'DROP COLUMN', col: m[1] });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Load all files into ordered statement stream + per-file raw lines (for
// suppression comment lookups and reporting).
// ---------------------------------------------------------------------------
function loadRepo(repoPath) {
  const files = findMigrationFiles(repoPath);
  const fileRecords = [];
  for (const f of files) {
    const content = fs.readFileSync(f.fullPath, 'utf8');
    const rawLines = content.split(/\r\n|\n/);
    const statements = splitStatements(content).map((s) => ({ ...s, file: f.name, relDir: f.relDir }));
    fileRecords.push({ name: f.name, relDir: f.relDir, rawLines, statements });
  }
  return fileRecords;
}

function isSuppressed(fileRec, line, checkId) {
  const prev = fileRec.rawLines[line - 2]; // line is 1-based; one line above
  if (!prev) return false;
  const m = RE.lintIgnore.exec(prev);
  return !!m && m[1].toLowerCase() === checkId.toLowerCase();
}

// ---------------------------------------------------------------------------
// Individual checks. Each takes the full ordered statement stream (with file
// context attached) and the per-file records (for suppression), returns
// findings: {id, file, line, message}
// ---------------------------------------------------------------------------
function checkR1_missingRls(allStmts) {
  const findings = [];
  const created = new Map(); // tableKey -> {file, line, seq}
  const enabled = new Set();
  allStmts.forEach((s, seq) => {
    const cm = RE.createTable.exec(s.text);
    if (cm) {
      const raw = cm[1];
      const schema = raw.includes('.') ? raw.split('.')[0].toLowerCase() : 'public';
      if (!SKIP_SCHEMAS.has(schema)) {
        created.set(normalizeTable(raw), { file: s.file, line: s.startLine, seq });
      }
    }
    const em = RE.enableRls.exec(s.text);
    if (em) enabled.add(normalizeTable(em[1]));
  });
  for (const [table, info] of created) {
    if (!enabled.has(table)) {
      findings.push({ id: 'R1', file: info.file, line: info.line, message: `table "${table}" created without ENABLE ROW LEVEL SECURITY anywhere in the set` });
    }
  }
  return findings;
}

function checkR2_usingWithoutCheck(allStmts) {
  const findings = [];
  for (const s of allStmts) {
    if (!/create\s+policy/i.test(s.text)) continue;
    const forM = RE.policyFor.exec(s.text);
    const forClause = forM ? forM[1].toLowerCase() : null;
    const hasUsing = RE.hasUsing.test(s.text);
    const hasCheck = RE.hasWithCheck.test(s.text);
    if (forClause === 'insert' && hasUsing && !hasCheck) {
      findings.push({ id: 'R2', file: s.file, line: s.startLine, message: 'FOR INSERT policy uses USING instead of WITH CHECK' });
    } else if ((forClause === 'update' || forClause === 'all') && hasUsing && !hasCheck) {
      findings.push({ id: 'R2', file: s.file, line: s.startLine, message: `FOR ${forClause.toUpperCase()} policy has USING but no WITH CHECK` });
    }
  }
  return findings;
}

function rolesFromClause(clause) {
  return clause.split(',').map((r) => r.replace(/"/g, '').trim().toLowerCase());
}

function checkR3_publicWritePolicy(allStmts) {
  const findings = [];
  const writeFors = new Set(['insert', 'update', 'delete', 'all']);
  for (const s of allStmts) {
    if (!/create\s+policy/i.test(s.text)) continue;
    const forM = RE.policyFor.exec(s.text);
    const toM = RE.policyTo.exec(s.text);
    if (!forM || !toM) continue;
    const forClause = forM[1].toLowerCase();
    if (!writeFors.has(forClause)) continue;
    const roles = rolesFromClause(toM[1]);
    if (roles.includes('public') || roles.includes('anon')) {
      findings.push({ id: 'R3', file: s.file, line: s.startLine, message: `FOR ${forClause.toUpperCase()} policy granted TO ${roles.join(',')}` });
    }
  }
  return findings;
}

function checkR4_definerHygiene(allStmts) {
  const findings = [];
  // Pre-scan revoke/grant-execute targets across the whole set.
  const restricted = new Set(); // function names that got REVOKE ... FROM public/anon or GRANT ... TO authenticated-only
  for (const s of allStmts) {
    const rm = RE.revokeExecute.exec(s.text);
    if (rm) {
      const roles = rolesFromClause(rm[2]);
      if (roles.includes('public') || roles.includes('anon')) restricted.add(normalizeTable(rm[1]));
    }
    const gm = RE.grantExecute.exec(s.text);
    if (gm) {
      const roles = rolesFromClause(gm[2]);
      if (roles.length && !roles.includes('public') && !roles.includes('anon')) restricted.add(normalizeTable(gm[1]));
    }
  }
  for (const s of allStmts) {
    const fm = RE.createFunction.exec(s.text);
    if (!fm) continue;
    if (!RE.securityDefiner.test(s.text)) continue;
    const fname = normalizeTable(fm[1]);
    if (!RE.setSearchPath.test(s.text)) {
      findings.push({ id: 'R4', file: s.file, line: s.startLine, message: `SECURITY DEFINER function "${fname}" has no SET search_path` });
    }
    if (!restricted.has(fname)) {
      findings.push({ id: 'R4', file: s.file, line: s.startLine, message: `SECURITY DEFINER function "${fname}" never REVOKEd from public/anon or GRANTed to authenticated only` });
    }
  }
  return findings;
}

function checkR5_grantAnonWrite(allStmts) {
  const findings = [];
  for (const s of allStmts) {
    const gm = RE.grantStmt.exec(s.text);
    if (!gm) continue;
    const privs = gm[1].split(',').map((p) => p.trim().toLowerCase());
    const roles = rolesFromClause(gm[3]);
    if (!roles.includes('anon')) continue;
    const nonSelect = privs.filter((p) => p !== 'select' && p !== '');
    if (nonSelect.length) {
      findings.push({ id: 'R5', file: s.file, line: s.startLine, message: `GRANT ${nonSelect.join(',')} on "${normalizeTable(gm[2])}" TO anon` });
    }
  }
  return findings;
}

function checkR6_dropWithoutIfExists(allStmts) {
  const findings = [];
  for (const s of allStmts) {
    const m = RE.dropStmt.exec(s.text);
    if (m) {
      findings.push({ id: 'R6', file: s.file, line: s.startLine, message: `DROP ${m[1].toUpperCase()} without IF EXISTS` });
    }
  }
  return findings;
}

function checkR7_notNullNoDefault(rawStmts) {
  const findings = [];
  const allStmts = withDoBlocks(rawStmts);
  const isNew = newTableIndex(allStmts);
  allStmts.forEach((s, seq) => {
    if (!/alter\s+table/i.test(s.text) || !/add\s+column/i.test(s.text)) return;
    const t = RE14.alterTable.exec(ddlText(s.text));
    if (t && isNew(s.file, seq, t[1])) return; // nowa (pusta) tabela utworzona wyzej w tym pliku
    RE.addColumnClause.lastIndex = 0;
    let m;
    while ((m = RE.addColumnClause.exec(s.text)) !== null) {
      const colName = m[1];
      const colDef = m[2];
      if (/not\s+null/i.test(colDef) && !/default/i.test(colDef) && !/generated\s+(?:always|by\s+default)/i.test(colDef) && !/\b(?:small|big)?serial[248]?\b/i.test(colDef)) {
        findings.push({ id: 'R7', file: s.file, line: s.startLine, message: `ADD COLUMN "${colName}" NOT NULL without DEFAULT` });
      }
    }
  });
  return findings;
}

function checkR8_missingFkIndex(allStmts) {
  const findings = [];
  const fkCols = []; // {name, file, line}
  const indexedCols = new Set();
  for (const s of allStmts) {
    if (/create\s+table/i.test(s.text) || /add\s+column/i.test(s.text)) {
      RE.fkReferences.lastIndex = 0;
      let m;
      while ((m = RE.fkReferences.exec(s.text)) !== null) fkCols.push({ name: m[1].toLowerCase(), file: s.file, line: s.startLine });
      RE.fkIdUuid.lastIndex = 0;
      while ((m = RE.fkIdUuid.exec(s.text)) !== null) fkCols.push({ name: m[2].toLowerCase(), file: s.file, line: s.startLine });
    }
    const im = RE.createIndex.exec(s.text);
    if (im) {
      for (const col of im[1].split(',')) indexedCols.add(col.replace(/"/g, '').trim().toLowerCase());
    }
  }
  const seen = new Set();
  for (const fk of fkCols) {
    const key = `${fk.file}:${fk.line}:${fk.name}`;
    if (seen.has(key) || indexedCols.has(fk.name)) continue;
    seen.add(key);
    findings.push({ id: 'R8', file: fk.file, line: fk.line, message: `column "${fk.name}" looks like a FK but no CREATE INDEX targets it anywhere in the set` });
  }
  return findings;
}

function checkR9_missingTenantScope(allStmts) {
  const findings = [];
  const tableHasTenantFk = new Map(); // table -> {file, line}
  const tableHasScopeCol = new Set();
  const tableHasSameOrgTrigger = new Set();
  for (const s of allStmts) {
    const cm = RE.createTable.exec(s.text);
    const am = RE.alterTableName.exec(s.text);
    const table = cm ? normalizeTable(cm[1]) : am ? normalizeTable(am[1]) : null;
    if (table && RE.tenantFkCol.test(s.text) && !tableHasTenantFk.has(table)) {
      tableHasTenantFk.set(table, { file: s.file, line: s.startLine });
    }
    if (table && RE.tenantScopeCol.test(s.text)) tableHasScopeCol.add(table);
    const tm = RE.createTrigger.exec(s.text);
    if (tm && RE.sameOrgTrigger.test(tm[1])) tableHasSameOrgTrigger.add(normalizeTable(tm[2]));
  }
  for (const [table, info] of tableHasTenantFk) {
    if (!tableHasScopeCol.has(table) && !tableHasSameOrgTrigger.has(table)) {
      findings.push({ id: 'R9', file: info.file, line: info.line, message: `table "${table}" has job/note/order/customer FK but no org/tenant column and no same_org trigger` });
    }
  }
  return findings;
}

function checkR10_definerRpcNoAuthCheck(allStmts) {
  const findings = [];
  for (const s of allStmts) {
    const fm = RE.createFunction.exec(s.text);
    if (!fm) continue;
    if (!RE.securityDefiner.test(s.text)) continue;
    if (RE.returnsTrigger.test(s.text)) continue; // trigger fns aren't RPCs
    const params = fm[2].split(',').map((p) => p.trim()).filter(Boolean);
    const hasIdParam = params.some((p) => /^"?[a-zA-Z0-9_]*_id"?\b/i.test(p) || /^"?id"?\b/i.test(p));
    if (!hasIdParam) continue;
    const bm = RE.dollarBody.exec(s.text);
    const body = bm ? bm[2] : s.text;
    if (!RE.authUidCall.test(body) && !RE.orgMention.test(body)) {
      findings.push({ id: 'R10', file: s.file, line: s.startLine, message: `SECURITY DEFINER RPC "${normalizeTable(fm[1])}" takes an id param, body has no auth.uid()/org check` });
    }
  }
  return findings;
}

function checkR11_usingTrue(allStmts) {
  const findings = [];
  for (const s of allStmts) {
    if (!/create\s+policy/i.test(s.text)) continue;
    if (!RE.usingTrue.test(s.text)) continue;
    const tm = RE.createPolicyTable.exec(s.text);
    const table = tm ? normalizeTable(tm[1]) : '?';
    if (PUBLIC_NAME_HINT.test(table)) continue; // likely intentionally public content
    findings.push({ id: 'R11', file: s.file, line: s.startLine, message: `policy on "${table}" is USING (true) and table name gives no public-content hint` });
  }
  return findings;
}

function checkR12_fileNaming(files) {
  const findings = [];
  const seenTimestamps = new Map();
  for (const f of files) {
    const m = RE.fileNamePrefix.exec(f.name);
    if (!m) {
      findings.push({ id: 'R12', file: f.name, line: 1, message: 'filename does not start with 14-digit timestamp prefix' });
      continue;
    }
    const ts = m[1];
    if (seenTimestamps.has(ts)) {
      findings.push({ id: 'R12', file: f.name, line: 1, message: `duplicate timestamp prefix ${ts} also used by ${seenTimestamps.get(ts)}` });
    } else {
      seenTimestamps.set(ts, f.name);
    }
  }
  return findings;
}

function checkR13_functionDefaultExecute(allStmts) {
  const findings = [];
  const restricted = new Set();
  for (const s of allStmts) {
    const rm = RE.revokeExecute.exec(s.text);
    if (rm) restricted.add(normalizeTable(rm[1]));
    const gm = RE.grantExecute.exec(s.text);
    if (gm) restricted.add(normalizeTable(gm[1]));
  }
  for (const s of allStmts) {
    const fm = RE.createFunction.exec(s.text);
    if (!fm) continue;
    const fname = normalizeTable(fm[1]);
    if (!restricted.has(fname)) {
      findings.push({ id: 'R13', file: s.file, line: s.startLine, message: `function "${fname}" has no REVOKE/GRANT EXECUTE anywhere in the set (default PUBLIC execute)` });
    }
  }
  return findings;
}

// R14: zmiana schematu niezgodna wstecz (expand/contract). Poprzednia wersja aplikacji dziala na nowym schemacie w oknie BAKE
// (>= 10 min) i po rollbacku Vercela (ktory NIE cofa bazy) — RENAME/DROP/SET NOT NULL/zmiana typu istniejacego obiektu ja psuja.
// Obiekty: tabele (kazda akcja ALTER TABLE i kazda tabela z listy DROP TABLE), a takze funkcje/RPC, widoki, typy, schematy
// (supabase.rpc() i .from('widok') w starym kodzie). DROP funkcji/widoku/typu odtworzonego w tym samym pliku = podmiana, nie usuniecie.
// Wyjatek: znacznik `-- pg:contract <powod>` w naglowku pliku (swiadomy krok contract po pelnym WATCH poprzedniego wydania).
// SET NOT NULL flagowany takze z backfillem w tej samej migracji: backfill naprawia stare wiersze, ale stary kod wstawiajacy
// NULL i tak padnie (data-review 2026-10-11). Zmiana typu = takze poszerzenie (varchar(50)->text); wtedy `-- lint-ignore R14` z powodem.
function hasContractHeader(fileRec) {
  const first = fileRec.statements[0];
  const end = first ? first.startLine - 1 : fileRec.rawLines.length;
  return fileRec.rawLines.slice(0, end).some((l) => RE.pgContract.test(l));
}

function checkR14_backwardIncompatible(rawStmts, fileRecords) {
  const findings = [];
  const allStmts = withDoBlocks(rawStmts);
  const isNew = newTableIndex(allStmts);
  const contractFiles = new Set(fileRecords.filter(hasContractHeader).map((f) => f.name));
  const objKey = (kind, name) => `${kind.toLowerCase().replace(/\s+/g, ' ')}:${normalizeTable(name)}`;
  const isFn = (kind) => /^(function|procedure)$/i.test(kind);
  const objsCreated = new Map(); // plik -> Map(kind:nazwa -> [lista argumentow CREATE])
  for (const s of allStmts) {
    const text = ddlText(s.text);
    const c = RE14.createObject.exec(text);
    if (!c) continue;
    if (!objsCreated.has(s.file)) objsCreated.set(s.file, new Map());
    const f = objsCreated.get(s.file);
    const k = objKey(c[1], c[2]);
    if (!f.has(k)) f.set(k, []);
    f.get(k).push(isFn(c[1]) ? parenArgs(text, c.index + c[0].length) : null);
  }
  // Podmiana w tym samym pliku zwalnia DROP; dla funkcji tylko przy tej samej liczbie argumentow — inna sygnatura RPC
  // lamie stare wywolania supabase.rpc() (code-review 2026-10-11, runda 2). DROP bez listy argumentow = po nazwie.
  // Podmiana funkcji: nowa definicja z tego pliku musi byc zgodna z POPRZEDNIA definicja z repo (nazwy+typy+DEFAULT), a gdy
  // repo jej nie zna — z typami z listy DROP; DROP bez listy i bez znanej definicji = trafienie (data-review 2026-10-11).
  const objInFile = (file, kind, name, dropArgs, prevArgs) => {
    const created = (objsCreated.get(file) || new Map()).get(objKey(kind, name));
    if (!created) return false;
    if (!isFn(kind)) return true;
    const prev = prevArgs !== undefined ? inParams(prevArgs) : inParams(dropArgs);
    return created.some((args) => compatibleParams(prev, inParams(args)));
  };
  const lastFnDef = new Map(); // kind:nazwa -> lista argumentow ostatniego CREATE przed biezaca instrukcja
  const lastIdxCols = new Map(); // indeks unikalny -> kolumny ostatniej definicji przed biezaca instrukcja
  const idxInFile = new Map(); // plik -> Map(indeks -> [kolumny])
  const idxCols = (c) => c.toLowerCase().replace(/["\s]/g, '');
  uniqueNames = new Set();
  for (const s of allStmts) {
    const t = ddlText(s.text);
    const u = RE14.uniqueIndexName.exec(t);
    if (u) {
      const k = normalizeTable(u[1]);
      uniqueNames.add(k);
      if (!idxInFile.has(s.file)) idxInFile.set(s.file, new Map());
      const f = idxInFile.get(s.file);
      if (!f.has(k)) f.set(k, []);
      f.get(k).push(idxCols(u[2]));
    }
    RE14.uniqueConstraintNames.lastIndex = 0;
    let uc;
    while ((uc = RE14.uniqueConstraintNames.exec(t)) !== null) uniqueNames.add(normalizeTable(uc[1]));
  }
  // Stary kod siega tylko do obiektow wystawionych przez PostgREST (schemat public): funkcje triggerow w app_private
  // itp. nie sa RPC, wiec ich DROP/RENAME nie lamie poprzedniej wersji aplikacji (flota 2026-10-11: 4 falszywe alarmy).
  const exposed = (kind, name) => /^schema$/i.test(kind) || !normalizeTable(name).includes('.');
  const show = (name) => name.replace(/"/g, '').replace(/\s+/g, '');
  const add = (s, message) => findings.push({ id: 'R14', file: s.file, line: s.startLine, message });
  allStmts.forEach((s, seq) => {
    const text = ddlText(s.text);
    const cf = RE14.createObject.exec(text);
    if (cf && isFn(cf[1])) lastFnDef.set(objKey(cf[1], cf[2]), parenArgs(text, cf.index + cf[0].length));
    const ui = RE14.uniqueIndexName.exec(text);
    if (ui) lastIdxCols.set(normalizeTable(ui[1]), idxCols(ui[2]));
    if (contractFiles.has(s.file)) return;
    let m;
    if ((m = RE14.alterTable.exec(text))) {
      const table = m[1];
      if (isNew(s.file, seq, table)) return;
      for (const a of breakingAlterActions(m[2])) {
        const t = show(table);
        if (a.kind === 'RENAME TABLE') add(s, `RENAME TABLE ${t} -> ${show(a.to)} (old code still uses the old name)`);
        else if (a.kind === 'SET SCHEMA') add(s, `SET SCHEMA ${t} -> ${show(a.to)} (for PostgREST/old code this is a rename)`);
        else if (a.kind === 'RENAME COLUMN') add(s, `RENAME COLUMN ${t}.${show(a.col)} (old code still uses the old name)`);
        else if (a.kind === 'SET NOT NULL') add(s, `SET NOT NULL on existing column ${t}.${show(a.col)} (old code may insert NULL)`);
        else if (a.kind === 'ALTER COLUMN TYPE') add(s, `ALTER COLUMN TYPE ${t}.${show(a.col)} (old code reads/writes the old type; table rewrite under lock)`);
        else if (a.kind === 'DROP COLUMN') add(s, `DROP COLUMN ${t}.${show(a.col)} (old code may still read it)`);
        else if (a.kind === 'DROP DEFAULT') add(s, `DROP DEFAULT ${t}.${show(a.col)} (old inserts relying on the default get NULL or fail on NOT NULL)`);
        else if (a.kind === 'DROP UNIQUE') add(s, `DROP CONSTRAINT ${t}.${show(a.col)} (old upsert onConflict needs this unique key)`);
      }
    } else if ((m = RE14.dropTable.exec(text))) {
      for (const part of splitTopLevel(m[1])) {
        const q = RE14.qid.exec(part);
        if (q && !isNew(s.file, seq, q[1])) add(s, `DROP TABLE ${show(q[1])} (old code may still use it)`);
      }
    } else if ((m = RE14.dropObject.exec(text))) {
      const kind = m[1];
      for (const part of splitTopLevel(m[2])) {
        const q = RE14.qid.exec(part);
        if (!q) continue;
        const dropArgs = isFn(kind) ? parenArgs(part, q[0].length) : null;
        const prevArgs = lastFnDef.has(objKey(kind, q[1])) ? lastFnDef.get(objKey(kind, q[1])) : undefined;
        if (exposed(kind, q[1]) && !objInFile(s.file, kind, q[1], dropArgs, prevArgs)) add(s, `DROP ${kind.toUpperCase().replace(/\s+/g, ' ')} ${show(q[1])} (old code may still call/read it)`);
      }
    } else if ((m = RE14.dropIndex.exec(text))) {
      for (const part of splitTopLevel(m[1])) {
        const q = RE14.qid.exec(part);
        if (!q) continue;
        const k = normalizeTable(q[1].replace(/^.*\./, ''));
        // Odtworzenie w tym samym pliku z TYMI SAMYMI kolumnami = podmiana (np. CONCURRENTLY); inne kolumny = inny cel onConflict.
        const again = (idxInFile.get(s.file) || new Map()).get(k);
        const prev = lastIdxCols.get(k);
        if (again && (prev === undefined || again.includes(prev))) continue;
        if (isUniqueName(k)) add(s, `DROP INDEX ${show(q[1])} (unique index — old upsert onConflict needs it${again ? '; recreated with different columns' : ''})`);
      }
    } else if ((m = RE14.renameObject.exec(text))) {
      const what = (m[3] || `set ${m[4]}`).toUpperCase();
      if (exposed(m[1], m[2]) && !objInFile(s.file, m[1], m[2], null)) add(s, `${/^SET/.test(what) ? what : 'RENAME ' + what} on ${m[1].toUpperCase().replace(/\s+/g, ' ')} ${show(m[2])} (old code still uses the old name)`);
    }
  });
  return findings;
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------
function runChecks(repoPath) {
  const fileRecords = loadRepo(repoPath);
  const allStmts = [];
  for (const fr of fileRecords) for (const s of fr.statements) allStmts.push(s);
  const filesMeta = fileRecords.map((f) => ({ name: f.name }));

  let findings = [
    ...checkR1_missingRls(allStmts),
    ...checkR2_usingWithoutCheck(allStmts),
    ...checkR3_publicWritePolicy(allStmts),
    ...checkR4_definerHygiene(allStmts),
    ...checkR5_grantAnonWrite(allStmts),
    ...checkR6_dropWithoutIfExists(allStmts),
    ...checkR7_notNullNoDefault(allStmts),
    ...checkR8_missingFkIndex(allStmts),
    ...checkR9_missingTenantScope(allStmts),
    ...checkR10_definerRpcNoAuthCheck(allStmts),
    ...checkR11_usingTrue(allStmts),
    ...checkR12_fileNaming(filesMeta),
    ...checkR13_functionDefaultExecute(allStmts),
    ...checkR14_backwardIncompatible(allStmts, fileRecords),
  ];

  // Suppression: `-- lint-ignore Rn` on the line directly above the finding.
  const fileByName = new Map(fileRecords.map((f) => [f.name, f]));
  findings = findings.filter((f) => {
    const fr = fileByName.get(f.file);
    if (!fr) return true;
    return !isSuppressed(fr, f.line, f.id);
  });

  // Broad-heuristic downgrade: a check firing on >60% of files is noise, not signal —
  // but only when the sample is big enough to judge. On 1-9 files (new repo, pre-commit on a fresh
  // migration set, golden cases) 100% is one real finding, not a broad heuristic (bug found 2026-09-05:
  // the pre-commit gate never fired on a single bad migration).
  const totalFiles = fileRecords.length || 1;
  const sampleBigEnough = totalFiles >= MIN_FILES_FOR_DOWNGRADE;
  const filesPerCheck = new Map();
  for (const f of findings) {
    if (!filesPerCheck.has(f.id)) filesPerCheck.set(f.id, new Set());
    filesPerCheck.get(f.id).add(f.file);
  }
  const downgradeNotes = [];
  const downgraded = new Set();
  for (const [id, fileSet] of filesPerCheck) {
    const ratio = fileSet.size / totalFiles;
    // noDowngrade: R7/R14 oceniaja konkretna zmiane — 70% historycznych DROP-ow nie moze wyciszyc nowego (ops-review 2026-10-11).
    if (sampleBigEnough && ratio > BROAD_HEURISTIC_RATIO && CHECKS[id].severity > SEVERITY.INFO && !CHECKS[id].noDowngrade) {
      downgraded.add(id);
      downgradeNotes.push(`${id} downgraded to INFO: fired on ${Math.round(ratio * 100)}% of files (${fileSet.size}/${totalFiles}) — heuristic likely too broad here`);
    }
  }

  findings = findings.map((f) => ({
    ...f,
    severity: downgraded.has(f.id) ? SEVERITY.INFO : CHECKS[f.id].severity,
    why: CHECKS[f.id].why,
  }));

  return { repoPath, totalFiles: fileRecords.length, findings, downgradeNotes };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const opts = { repo: process.cwd(), json: false, minSeverity: SEVERITY.INFO, strict: false, since: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--repo') opts.repo = argv[++i];
    else if (a === '--json') opts.json = true;
    else if (a === '--min-severity') opts.minSeverity = SEVERITY[argv[++i].toUpperCase()] ?? SEVERITY.INFO;
    else if (a === '--strict') opts.strict = true;
    else if (a === '--since') opts.since = argv[++i];
  }
  return opts;
}

function formatHuman(result, minSeverity) {
  const lines = [];
  lines.push(`sql-migration-lint: ${result.repoPath}`);
  lines.push(`files scanned: ${result.totalFiles}`);
  const shown = result.findings.filter((f) => f.severity >= minSeverity).sort((a, b) => b.severity - a.severity);
  for (const f of shown) {
    lines.push(`[${SEVERITY_NAME[f.severity]}] ${f.id} ${f.file}:${f.line} — ${f.message} (${f.why})`);
  }
  if (result.downgradeNotes.length) {
    lines.push('--- downgrade notes ---');
    for (const n of result.downgradeNotes) lines.push(n);
  }
  const counts = {};
  for (const f of result.findings) counts[f.id] = (counts[f.id] || 0) + 1;
  lines.push('--- counts by check ---');
  for (const id of Object.keys(CHECKS)) if (counts[id]) lines.push(`${id}: ${counts[id]}`);
  return lines.join('\n');
}

// --since <ref>: findings tylko z migracji zmienionych od merge-base(ref, HEAD) (sledzone + nieśledzone; po nazwie pliku —
// nazwy migracji to unikalne znaczniki czasu). Kontekst nadal z CALEGO zestawu.
// Po co: `--strict` w pg-review blokowal PR przez historyczna migracje (R14 na zastosowanym dawno pliku, flota 2026-10-11).
function changedFilesSince(repo, ref) {
  const { spawnSync } = require('child_process');
  if (/^-/.test(ref)) throw new Error(`--since: ref nie moze zaczynac sie od '-': ${ref}`);
  const { CHILD_ENV } = require('../hooks/lib/lint-file'); // obce repo: bez core.fsmonitor/untrackedCache (security-review)
  const g = (args) => spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8', env: CHILD_ENV });
  // merge-base: zmiany na ref, ktorych galaz nie ma, nie wchodza do zbioru (code-review 2026-10-11)
  const mb = g(['merge-base', ref, 'HEAD']);
  const base = mb.status === 0 && mb.stdout.trim() ? mb.stdout.trim() : ref;
  const d = g(['diff', '--name-only', base]);
  if (d.status !== 0) throw new Error(`--since: git diff ${ref} nie powiodl sie: ${String(d.stderr).trim().slice(0, 160)}`);
  const u = g(['ls-files', '--others', '--exclude-standard']);
  return new Set(`${d.stdout}\n${u.stdout || ''}`.split('\n').filter(Boolean).map((f) => path.basename(f)));
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const result = runChecks(opts.repo);
  if (opts.since) {
    const changed = changedFilesSince(opts.repo, opts.since);
    result.findings = result.findings.filter((f) => changed.has(f.file));
    result.since = opts.since;
  }
  if (opts.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    process.stdout.write(formatHuman(result, opts.minSeverity) + '\n');
  }
  const hasHigh = result.findings.some((f) => f.severity === SEVERITY.HIGH);
  if (opts.strict && hasHigh) process.exit(1);
  process.exit(0);
}

module.exports = { runChecks, splitStatements, SEVERITY, CHECKS, normalizeTable };

if (require.main === module) {
  try { main(); } catch (e) { process.stderr.write(`sql-migration-lint: ${e.message}\n`); process.exit(2); }
}

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
  R7: { severity: SEVERITY.MEDIUM, why: 'ADD COLUMN ... NOT NULL without DEFAULT fails on existing rows' },
  R8: { severity: SEVERITY.LOW, why: 'FK-shaped column with no matching index (heuristic, perf not security)' },
  R9: { severity: SEVERITY.HIGH, why: 'job/note/order/customer FK with no org/tenant column and no same_org trigger (workshop-app IDOR pattern)' },
  R10: { severity: SEVERITY.HIGH, why: 'SECURITY DEFINER RPC takes an id param but body has no auth.uid()/org check' },
  R11: { severity: SEVERITY.MEDIUM, why: 'USING (true) on a non-obviously-public table -> unrestricted row access' },
  R12: { severity: SEVERITY.MEDIUM, why: 'migration filename does not sort deterministically (bad prefix or duplicate timestamp)' },
  R13: { severity: SEVERITY.INFO, why: 'function left at default EXECUTE-to-PUBLIC (no REVOKE/GRANT tightening seen)' },
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
      i++;
      while (i < n) {
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
  return name.replace(/"/g, '').toLowerCase().replace(/^public\./, '');
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

function checkR7_notNullNoDefault(allStmts) {
  const findings = [];
  for (const s of allStmts) {
    if (!/alter\s+table/i.test(s.text) || !/add\s+column/i.test(s.text)) continue;
    RE.addColumnClause.lastIndex = 0;
    let m;
    while ((m = RE.addColumnClause.exec(s.text)) !== null) {
      const colName = m[1];
      const colDef = m[2];
      if (/not\s+null/i.test(colDef) && !/default/i.test(colDef) && !/generated\s+always/i.test(colDef)) {
        findings.push({ id: 'R7', file: s.file, line: s.startLine, message: `ADD COLUMN "${colName}" NOT NULL without DEFAULT` });
      }
    }
  }
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
    if (sampleBigEnough && ratio > BROAD_HEURISTIC_RATIO && CHECKS[id].severity > SEVERITY.INFO) {
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
  const opts = { repo: process.cwd(), json: false, minSeverity: SEVERITY.INFO, strict: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--repo') opts.repo = argv[++i];
    else if (a === '--json') opts.json = true;
    else if (a === '--min-severity') opts.minSeverity = SEVERITY[argv[++i].toUpperCase()] ?? SEVERITY.INFO;
    else if (a === '--strict') opts.strict = true;
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

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const result = runChecks(opts.repo);
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

if (require.main === module) main();

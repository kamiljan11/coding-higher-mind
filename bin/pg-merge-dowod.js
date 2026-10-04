#!/usr/bin/env node
// Dowod recenzji dla pg-merge-bezpieczny.py (T1/T2 bez frazy uzytkownika). security-review v3 r2: same pliki w katalogu
// przebiegu (diff.patch, findings, mtime) da sie podrobic bez falszowania JSONL, wiec dowod sklada sie z:
//  1. agregacji policzonej OD NOWA z WAZNYCH findings (pg-aggregate.validateRoleFile — finding bez evidence odpada,
//     a jego rule_id nie liczy sie jako „zachowany"),
//  2. transkryptow subagentow (pg-self-approve.reviewerTranscripts), z ktorych kazdy ma w PROMPCIE (pierwsza wiadomosc
//     user, pisana przez harness) `diff_sha256=<sha256 diff.patch>` — recenzja jest przypieta do tresci diffu, nie do nazwy
//     katalogu ani mtime.
// Uzycie: node pg-merge-dowod.js <katalog pg-review> <rola1,rola2>   -> JSON na stdout
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { aggregate, validateRoleFile } = require(path.join(__dirname, 'pg-aggregate.js'));
const { reviewerTranscripts, mentionsPath } = require(path.join(__dirname, 'pg-self-approve.js'));

/** Prompt subagenta = tresc pierwszego wpisu `user` w transkrypcie JSONL ('' gdy brak). */
function promptOf(raw) {
  for (const line of String(raw).split('\n')) {
    let entry;
    try { entry = JSON.parse(line); } catch (e) { continue; }
    if (!entry || entry.type !== 'user') continue;
    const content = entry.message && entry.message.content;
    if (typeof content === 'string') return content;
    return (Array.isArray(content) ? content : []).filter((b) => b && b.type === 'text').map((b) => String(b.text || '')).join('\n');
  }
  return '';
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function evidence(run, roles, now) {
  const sha = sha256File(path.join(run, 'diff.patch'));
  // verdicts.json NIE jest brany pod uwage (security-review v3 r3: jego tresci nie da sie powiazac z weryfikatorem, a
  // `touch -d` cofa mtime). Bez werdyktow kazdy finding do weryfikacji = INCOMPLETE -> auto-merge tylko przy czystej recenzji.
  const agg = aggregate(run, null, { requiredRoles: roles, final: true });
  const ids = {};
  for (const role of roles) {
    const file = path.join(run, `findings.${role}.json`);
    if (fs.existsSync(file)) ids[role] = validateRoleFile(file).valid.map((f) => String(f.rule_id || ''));
  }
  // Prompt musi wskazywac diff.patch TEGO przebiegu i jego sha (r3: sam sha mogl stac obok innego pliku diffu).
  const diffPath = path.join(run, 'diff.patch');
  const transcripts = reviewerTranscripts(run, now).map(({ file, ...t }) => {
    let raw = '';
    try { raw = fs.readFileSync(file, 'utf8'); } catch (e) { /* zniknal w trakcie = niepowiazany */ }
    const prompt = promptOf(raw);
    return { ...t, bound: prompt.includes(`diff_sha256=${sha}`) && mentionsPath(prompt, diffPath) };
  });
  return { agg, transcripts, findings_ids: ids, verdicts_mtime: null, diff_sha256: sha };
}

module.exports = { evidence, promptOf, sha256File };

if (require.main === module) {
  const [run, roles] = process.argv.slice(2);
  if (!run || !roles) {
    console.error('uzycie: node pg-merge-dowod.js <katalog pg-review> <rola1,rola2>');
    process.exit(2);
  }
  process.stdout.write(JSON.stringify(evidence(path.resolve(run), roles.split(','), Date.now())));
}

#!/usr/bin/env node
// Dowod recenzji dla pg-merge-bezpieczny.py (T1/T2 bez frazy uzytkownika). security-review v3 r2: same pliki w katalogu
// przebiegu (diff.patch, findings, mtime) da sie podrobic bez falszowania JSONL, wiec dowod sklada sie z:
//  1. agregacji policzonej OD NOWA z WAZNYCH findings (pg-aggregate.validateRoleFile — finding bez evidence odpada,
//     a jego rule_id nie liczy sie jako „zachowany"),
//  2. transkryptow subagentow (pg-self-approve.reviewerTranscripts) z flagami: sameDiff (prompt ma `diff_sha256=<sha>`),
//     bound (do tego sciezka diff.patch TEGO przebiegu), findingsJson (recenzent oddal JSON findings). Szukane takze po sha,
//     wiec recenzje tego samego diffu z innych katalogow przebiegu tez musza sie zgadzac z findings (r4: resampling).
// Decyzje podejmuje pg-merge-bezpieczny.ocena_dowodu (te same reguly co pg-self-approve.transcriptProblem).
// Uzycie: node pg-merge-dowod.js <katalog pg-review> <rola1,rola2>   -> JSON na stdout
'use strict';
const fs = require('fs');
const path = require('path');
const { aggregate } = require(path.join(__dirname, 'pg-aggregate.js'));
const { reviewerTranscripts, bindTranscripts, findingsIdsOf, promptOf, sha256 } = require(path.join(__dirname, 'pg-self-approve.js'));

function sha256File(file) {
  return sha256(fs.readFileSync(file));
}

function evidence(run, roles) {
  const diffPath = path.join(run, 'diff.patch');
  const sha = sha256File(diffPath);
  // verdicts.json NIE jest brany pod uwage (security-review v3 r3: jego tresci nie da sie powiazac z weryfikatorem, a
  // `touch -d` cofa mtime). Bez werdyktow kazdy finding do weryfikacji = INCOMPLETE -> auto-merge tylko przy czystej recenzji.
  const agg = aggregate(run, null, { requiredRoles: roles, final: true });
  const transcripts = bindTranscripts(reviewerTranscripts(run, sha), sha, diffPath)
    .map(({ role, sid, reviewedAt, ruleIds, findingsJson, completed, findingKeys, sameDiff, bound, aboutRun, overridden }) =>
      ({ role, sid, reviewedAt, ruleIds, findingsJson, completed, findingKeys, sameDiff, bound, aboutRun, overridden }));
  return { agg, transcripts, findings_ids: findingsIdsOf(run), diff_sha256: sha };
}

module.exports = { evidence, promptOf, sha256File };

if (require.main === module) {
  const [run, roles] = process.argv.slice(2);
  if (!run || !roles) {
    console.error('uzycie: node pg-merge-dowod.js <katalog pg-review> <rola1,rola2>');
    process.exit(2);
  }
  process.stdout.write(JSON.stringify(evidence(path.resolve(run), roles.split(','))));
}

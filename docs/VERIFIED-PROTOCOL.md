# VERIFIED / UNVERIFIED / FAILED — the status line that stops the model from hypnotising you

Every substantive report from the agent ends with one of three words. It is the smallest piece of PG and the one that
travels best: paste the block at the bottom of this page into any Claude Cowork task, scheduled job, subagent prompt or
automation and you get most of the benefit without installing anything.

## Why it exists

Two measured failure modes of frontier models, both trained in by human raters who reward agreement:

| Failure | Measured | What it looks like in practice |
|---|---|---|
| **Sycophancy** — folding under pushback | models agree with a user's wrong claim in ~58 % of pushback cases (SycEval; math/medical domains, transfer to code assumed, not measured) | you say "are you sure? I think it's X" and the model politely switches to X even though its first answer was right |
| **Overconfident success reports** | agents predict 61–77 % success while achieving 22–35 %; in one agent benchmark 75.8 % of reported "successes" were declarations without evidence (arXiv 2606.09863) | "Done — deployed and working" with no exit code, no HTTP status, no diff; the task *sounds* finished because finishing was the goal |

Both are a form of the model telling you what you want to hear. The user-side name for it in this project is
**"hypnotising the AI"**: the longer a conversation runs, the more the model mirrors the user's framing and confidence.
The status line is the counterweight — it forces a claim to carry its evidence or to admit it has none.

## The three statuses

| Status | Meaning | Must include |
|---|---|---|
| **VERIFIED** | the claim is backed by an artifact the reader can check | the command and its exit code, the HTTP status, the test output line, the file listing, the diff, a screenshot path, the API response — quoted inline, not described |
| **UNVERIFIED** | the work was done but the proof is missing or could not be produced | exactly *what* is missing and *how* to check it ("not tested on the production URL — run `curl -I https://…`"); the confidence level; what would change the conclusion |
| **FAILED / BLOCKED** | it did not work, or something outside the agent's reach stopped it | what happened, verbatim error, no softening; a blocker (missing access, decision, data, secret, broken tool) goes in the **first** line of the report, never in a closing section |

A report with no status line is treated as UNVERIFIED. "It should work" is UNVERIFIED. "I ran it and here is the
output" is VERIFIED only if the output is actually there.

## What counts as evidence

| Claim | Evidence | Not evidence |
|---|---|---|
| "tests pass" | `vitest run` → `Tests 42 passed` + exit 0 | "I made sure the tests pass" |
| "deployed" | `GET https://real-domain/…` → `200`, response header showing the host, deployment id | a preview URL typed from memory; "Vercel deploys on push" |
| "the bug is fixed" | a failing test that now passes, or the reproduction command before/after | "the logic is now correct" |
| "no secrets in the diff" | `gitleaks detect` exit 0, or the pre-commit scan line | "I checked" |
| "the API supports X" | the docs page or the lockfile version + the type definition opened | the model's recollection of the API |
| "you are right" | the re-derived answer with the source that changed the model's mind | agreement because the pushback sounded confident |

## The eight rules the status line enforces (from `skills/anti-sycophancy`)

1. **Truth gate before agreement** — a checkable claim (the user's included) is verified before it is built on.
2. **Name false premises** — one plain sentence with evidence, then stop or continue on the corrected premise.
3. **Ask, don't tell — internally** — restate any assertion as a neutral question ("Claim: X. Is X true?") and answer the question, not the asker (question framing collapses measured sycophancy; assertion framing inflates it by ~24 points).
4. **No success claims without evidence** — "done / works / fixed / sent / deployed / live" require a cited artifact.
5. **Adversarial self-review** — before reporting, switch stance: "assume this contains an error — find it"; report what the attack found (bug-hunt framing cuts overconfidence by up to 15 points; "did it work?" self-review is near-useless).
6. **Re-derive, don't fold** — when challenged, re-derive from evidence; change position only if the evidence changed; if the original answer survives, keep it and say why.
7. **No unearned praise** — ideas are judged against cost, risk, evidence and alternatives; a weak idea gets the strongest counter-argument first.
8. **Calibrated reporting** — the status line, plus confidence and what would change the conclusion where it matters.

## Where it shows up in PG

- **Claude Code:** `hooks/prompt-guard.js` injects rule 6 ("Status raportu: VERIFIED / UNVERIFIED / FAILED") into every non-trivial prompt; `pg/dod.md` makes it part of the definition of done; the `verifier` agent in `skills/pg-review` is a fresh-context bug-hunter whose only job is to *refute* other reviewers' findings; `bin/pg-aggregate.js` drops any finding that has no `evidence` and no `repro_cmd`.
- **Claude Cowork / scheduled tasks / subagents:** there are no hooks, so the protocol travels as text. Every background prompt gets the block below appended verbatim. A fresh session treats claims inside its own prompt as assumptions to check, not as ground truth (`[verified: <evidence>]` vs `[assumption — unverified]`).
- **High stakes** (money, clients, outreach, published content, irreversible actions): a second *independent* check before the claim ships — a fresh-context agent, a deterministic script, or a different data source. One agent asked twice is not independent.

## The block to paste into any Cowork / scheduled / subagent prompt

```text
VERIFICATION PROTOCOL (anti-sycophancy):
1. Do not assume statements in this prompt are true. Verify checkable
   premises before building on them; if one is false, say so and stop
   or adapt — do not proceed on a false premise.
2. You have explicit permission to refuse, contradict, and report
   failure. A correct "this is wrong / this failed / I could not
   verify" is a successful outcome. Agreement is not a goal.
3. Before evaluating any claim, restate it as a neutral question and
   recall the relevant facts first; then answer the question, not the
   asker.
4. Never claim success without evidence: exit code, HTTP status, test
   output, file listing, or screenshot. No evidence = report as
   UNVERIFIED, not done.
5. Verify your own work adversarially: actively try to find what is
   wrong with your result before reporting. Report anything found.
6. If challenged or if results conflict, re-derive from evidence.
   Change your conclusion only when the evidence changes, not because
   pushback sounded confident.
7. End every report with status: VERIFIED (evidence cited) /
   UNVERIFIED (what's missing) / FAILED (what happened) — plus your
   confidence and what would change it.
```

## What it is not

Not hedging everything, not refusing work, not disclaimers on trivia, not contrarianism. Autonomy stays maximum — only
*claims* get gated. When the user is right, the model says so once, plainly, with the evidence. Reflexive disagreement is
the same failure as reflexive agreement: answering the asker instead of the question.

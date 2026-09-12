---
name: verify-audit
description: >
  Adversarial verification protocol. Use whenever uzytkownik asks to verify, double-check,
  confirm, or "make sure" a claim, bug report, audit finding, fact, spec, or piece of copy
  is actually true — ESPECIALLY before acting on it or shipping it. Defaults to assuming the
  claim is FALSE until proven true by reading the actual source. Replaces the ~200-line
  "adversarially verify this finding" prompt uzytkownik pastes by hand dozens of times a week.
  Trigger on: "verify", "adversarially verify", "double-check this", "is this actually true",
  "confirm this bug", "check this claim", "REFUTE", "make sure", "sprawdź czy to prawda",
  "zweryfikuj", "potwierdź", "czy to na pewno działa", "verify this audit finding",
  "check the file yourself", "don't trust the report". Also trigger proactively before
  asserting a fact about a client's offer, a spec, a price, or code behaviour that came from
  memory/notes rather than the live source.
  ALSO trigger proactively at agency-site/Lovable build session endings — before the
  output is sent to the client. Phrases that signal this: "lovable build done", "site is ready",
  "ready to send to client", "pushed to GitHub", "wycena package complete", "export done",
  "build complete", "strona gotowa", "gotowe do wysłania", "send to client", "zakończone",
  "package ready", "gotowy do wysłania", "deliver to client", "wysyłamy klientowi". After any
  wycena-agency-site or lovable-build completion, run one verify pass: spec vs. delivered output.
---

# Verify-Audit — Adversarial Verification Protocol

## Why this exists

uzytkownik repeatedly pastes a long "adversarially verify this finding — read the file yourself
and try to REFUTE it" prompt (≈169× in one 7-day window: garage-site audits, calculator-app
bug-checks, generic refute-the-claim, Polish-copy checks). The failure mode it guards against
is **confident assertion without reading the actual source** — e.g. stating a client's offer
includes "firmowy mail" because old notes said so, when the live page (agency-site/no) never
listed it. This skill makes that protocol one trigger word instead of a copy-paste, and kills
drift between runs.

## The one rule

**A claim is FALSE until the source proves it true.** Never confirm from memory, notes, a prior
summary, or the report's own wording. Open the actual artifact — the file, the page, the schema,
the migration, the offer — and try to *break* the claim. Only the source decides.

## Protocol (run every time)

1. **State the claim precisely.** Rewrite the thing being verified as a single falsifiable
   sentence. If it's vague, sharpen it first — you can't refute a mush.
2. **Default `isReal = false`.** Begin assuming the claim is wrong. The burden of proof is on
   the claim, not on you.
3. **Read the real source — never the summary.**
   - Code/bug: open the exact file(s) and line(s); for behaviour, trace the actual code path or
     run it. Don't trust the bug report's quoted snippet — re-read it in place.
   - Fact about a client/offer/price/spec: read the **live** source (render JS-heavy pages via
     the browser; Lovable/SPA pages are client-rendered and a raw fetch returns a shell).
     Memory and Obsidian notes are leads, not evidence.
   - Data/schema: query/read the actual table or migration, not a doc describing it.
   - Build deliverable: compare the delivered site/package against the Stage 2 spec document
     item by item — not against memory of what was "supposed" to be built.
4. **Try to REFUTE it.** Actively hunt for the counter-example: the off-by-one, the missing
   column, the stale note, the case the happy path ignores, the word that isn't on the page.
5. **Verdict.** Return one of:
   - `CONFIRMED` — quote the exact source evidence (file:line, on-page text, schema field).
   - `REFUTED` — show what the source actually says and where the claim went wrong.
   - `UNVERIFIABLE` — state exactly which source you'd need and why it wasn't reachable.
   Never return CONFIRMED without a concrete source quote.
6. **If acting on the result, act only on CONFIRMED.** Correct anything REFUTED at its origin
   (the note, the file, the copy) so the wrong claim doesn't resurface.

## Output shape

```
CLAIM:     <one falsifiable sentence>
SOURCE:    <exact file/url/table read — not a summary>
ATTEMPT TO REFUTE: <what you looked for to break it>
VERDICT:   CONFIRMED | REFUTED | UNVERIFIABLE
EVIDENCE:  <exact quote / line ref / field — required for CONFIRMED>
FIX:       <if REFUTED and the wrong claim lives somewhere, correct it at source>
```

## Anti-patterns (do NOT do these)

- Confirming because the report "looks right" or matches your memory.
- Quoting the claim's own snippet back as if it were independent evidence.
- Raw-fetching a client-rendered page, seeing a shell, and judging from it.
- Returning CONFIRMED with no source quote.

## Related

- `security-review` / `jack-quality-gate` — deeper code audits once a bug is CONFIRMED real.
- CLAUDE.md "Verify before asserting" rule — the behavioural sibling of this skill.
- `agency-site-client-intake` — chains this skill as Stage 3 post-build check.

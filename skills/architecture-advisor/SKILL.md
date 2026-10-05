---
name: architecture-advisor
description: >-
  Master architecture-decision skill: choose the right architecture for a new project, audit an existing one, and propose changes — through trade-offs and real context, not hype. It forces the trade-off conversation instead of giving confident answers that ignore your context, and will say 'you don't need that yet'. Use whenever a system's structure is decided, reviewed, or changed: stack for a new site or app, monolith vs microservices, wiring an n8n / AI-agent pipeline, whether to add a queue / cache / event bus / RAG, whether a system is over- or under-engineered, or how it should evolve. Trigger on: 'what architecture', 'how should I build/structure this', 'monolith vs microservices', 'do I need a queue/cache/RAG', 'is this over-engineered', 'review/audit my architecture', 'tech stack for', 'how to scale', 'jaka architektura', 'jak zaprojektować', 'jaki stack', 'audyt architektury', 'jak to rozwijać'. Not for: drawing a diagram with no decision (diagrams) or a quick frontend fix (jack-vibe-coding).
---

# Architecture Advisor

**Tradeoffs over prompts.** Generating a solution is easy now; deciding *whether it's the
right solution for this context* is the whole job. Architecture is the discipline of
understanding the **consequences** of a decision — not "can we build it?" but "what do we
gain, what do we lose, who maintains it, when does it start to hurt, and does that cost make
sense *here*?"

AI is dangerous precisely because it answers architecture questions in a confident,
enterprise-sounding tone — "use microservices, add a queue, cache it, split reads from
writes, go event-driven" — while every one of those carries a price most contexts can't
afford. This skill exists so that you, with AI, **make good decisions faster** instead of
making bad ones faster.

## The five questions — ask them every time

Before endorsing *any* non-trivial structural choice, answer these out loud:

1. **What do we gain?** The concrete benefit, tied to a real constraint we have *now*.
2. **What do we lose?** The cost: complexity, ops burden, debugging difficulty, money, lock-in.
3. **Who maintains it?** Who is on call at 3am when this breaks? Do they understand it?
4. **When does it start to hurt?** At what scale / team size / failure mode does this choice turn from asset to liability?
5. **Does the cost make sense in *our* context?** Not in a FAANG blog post. Here, with this team, this traffic, this certainty.

If a choice can't survive these five questions, it isn't earned yet.

## Default to simplicity — the burden of proof is on complexity

The most common, most expensive mistake is adding machinery for a problem you don't have
yet. So the bias is explicit: **the simplest thing that satisfies the real constraints wins,
and every added piece of complexity must be *earned* by a constraint that exists today** —
not an imagined future one.

- For a small team, simple product, and uncertain requirements, the right answer is usually a **well-organized modular monolith** on managed services — not microservices. It's less impressive and almost always more sensible: easier to build, debug, deploy, and pivot while the business is still figuring out what it needs.
- Technical maturity is often shown by what you *consciously don't add*. "We don't need this yet" is a real, frequently-correct architectural decision — record it as one.
- There is no best architecture in a vacuum. There is only the **best compromise in a specific context.** You design differently for 3 developers than for 30 teams; differently for 100 users/day than for a payment system that must never go down; differently for a startup chasing product-market fit than for a regulated org with many dependencies.

When you're tempted to recommend something sophisticated, reframe the question the way a good
architect would: not *"what's the best architecture?"* but *"what are the consequences of this
approach, when will it stop working, what has to be true for it to make sense, can it be done
more simply, and what will it cost to maintain this change?"*

## Match the depth of analysis to the stakes — reversibility

Not every decision deserves a trade-off essay. Before going deep, ask: **is this a two-way
door or a one-way door?**

- **Two-way doors (easily reversible):** most choices — a library, a folder layout, where a function lives, an n8n node, a styling approach, a UI framework for a small site. Pick the obvious simple option and move on. Spending an ADR and a scorecard on these is its own kind of over-engineering; bias hard toward action.
- **One-way doors (expensive to reverse):** the data model, the primary database, the auth/identity model, a public API contract, the language/runtime, anything that takes payments or stores regulated/personal data, and splitting a system into services. These earn the full five questions and a written ADR, because undoing them later is costly.

So **proportionality is a rule, not a nicety:** match the analysis — and the number of
deliverables — to the stakes. A small reversible call gets a one-sentence recommendation; a
one-way door gets the ADR + scorecard + diagram. When genuinely unsure how reversible
something is, treat it as one-way: the asymmetry of regret favors care on the few things that
are hard to undo and speed on the many that aren't.

---

## How to use this skill: pick a mode

| Mode | Use when | Default deliverables |
|---|---|---|
| **SELECT** | Starting something new — need to choose an architecture/stack | ADR + trade-off scorecard + diagram + "revisit-when" triggers |
| **AUDIT** | A system exists — is it over/under-engineered, what's risky? | current-state diagram + findings scorecard + ADRs for changes |
| **EVOLVE** | A system works but the context is changing — what's the next step? | evolution roadmap (Now/Soon/Later/Not-yet) + ADRs + updated diagram |

Always start by **gathering context** (`references/context-questions.md`) — the answers, not
the technology, drive everything. Then reach for the **trade-off catalog**
(`references/tradeoff-catalog.md`) for the specific patterns in play, and **ground every
recommendation in uzytkownik's real toolbox** (`references/owner-stack.md`) so the advice is
actionable, not generic. Produce outputs using `references/deliverable-templates.md`.

**System-design knowledge base** (`references/sd/`, PG's own operational engineering knowledge for our stack — start at `references/sd/README.md`, an index by *problem*, not by topic). One decision card per problem: *what it is and the signals in code/diff → our default (and when NOT) → variants with operational/financial/cognitive cost → failure modes with the command that detects them → closed audit questions with a verifying command each → "you don't need that yet"*. Three ways to use it:
1. **Design (SELECT / Day 0):** run the back-of-envelope in `references/sd/capacity.md` first (QPS, storage, egress, sequential round trips, latency budget) — name the real bottleneck before recommending any machinery; decide consistency per flow (C vs A) from `sd/02 › Spójność per przepływ`; read the one-way-door cards (data model, IDs, tenancy, identity, money/time) before the rest.
2. **Audit (AUDIT):** walk the "Audyt" sections of the cards in ROI order (idempotency, concurrency, identity/RLS, external dependencies, observability, backups, platform path) running each verifying command against the repo and — read-only, enforced with `PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=15s'` or a SELECT-only role (see `references/sd/README.md`) — the production database; "leave it" is a valid finding.
3. **Diff review:** use the department section of `references/sd/review-checklists.md` (code / data / ops / security / product) — only points the diff touches, each finding needs a command and evidence.
The verified fleet stack the cards assume is in `references/owner-stack.md`.

Scale the output to the stakes (see *reversibility* above): a small, reversible call may
warrant just a clear recommendation, while a one-way door earns the full default set. If the
deliverable scope is genuinely ambiguous, ask; otherwise produce the appropriate set and
offer the rest. AUDIT frequently flows straight into EVOLVE — run them together when the user
wants both the verdict and the path forward.

### Mode: SELECT (right architecture for a new project)

1. **Establish context — infer first, then ask.** Pull what you already know from the project, the conversation, and uzytkownik's known stack/memory before asking anything. Then ask only the *load-bearing* unknowns — the one or two facts that would actually change the recommendation (real volume? does it take payments? who maintains it?). Don't interrogate for context you can reasonably infer or that won't move the decision; an unnecessary question is a worse default than a stated assumption the user can correct.
2. **Name the 2–4 constraints that actually matter here.** Most projects are decided by a handful of real forces (e.g. "solo dev, uncertain requirements, must take ISK payments, low traffic"). Everything else is noise — say so.
3. **Propose the simplest architecture that satisfies those constraints.** Start from the boring default for the domain (see `owner-stack.md`) and only deviate where a named constraint forces it.
4. **Make the trade-offs explicit.** For each non-trivial choice, state gain / cost / when-it-breaks. Equally important: **name what you are deliberately NOT doing and why** (no queue, no microservices, no custom auth yet).
5. **Deliver** the ADR + scorecard + diagram, plus a short **"revisit when…"** list — the future signals that would justify revisiting a choice you deferred.

### Mode: AUDIT (assess an existing architecture)

1. **See the real system — read what reveals structure, not every line.** Where code is available, read it (GitHub MCP for repos, desktop-commander/Read for local files, n8n JSON for workflows). For anything sizable, go straight to the architecture-revealing artifacts — dependency/manifest files, folder layout, infra/deploy config, the database schema, entrypoints and wiring, and how secrets/env are handled — rather than reading line-by-line; spawn an **Explore subagent** to map a large codebase fast. Use `references/audit-checklist.md` for exactly what to pull and the risk/smell checklist to run against it. Where you can't see it, ask. An audit built on assumptions is worthless.
2. **Reconstruct its true context.** Actual scale, team size, criticality, money/regulatory exposure. The same architecture can be perfect or absurd depending on this.
3. **Look for mismatches in BOTH directions** — this is the heart of the audit:
   - **Over-engineering** — complexity not earned by any present constraint: microservices for a 2-person app, a queue that only ever has one consumer, a cache guarding a query nobody runs, an agent framework wrapping a single API call. This is silent tax: it slows every change and every debugging session.
   - **Under-engineering / real risk** — a present constraint left unmet: no backups, secrets in code, no error monitoring (Sentry is *already in the stack*), no idempotency on payment/webhook handlers, a single point of failure on something that must stay up, no rate-limit handling on a paid API.
4. **Rank findings by (pain it causes now × cost to fix).** Resist change-for-its-own-sake. "This is fine, leave it" is a valid and valuable finding — say it clearly when it's true.
5. **Deliver** a current-state diagram, a findings scorecard (severity + effort), and an ADR for each change worth making.

### Mode: EVOLVE (suggest changes / roadmap)

1. **Propose the next sensible step — and only the next step.** Architecture evolves under real pressure, not on a grand upfront plan. Identify the one or two changes the *current* pain actually justifies.
2. **Sequence by dependency and by pain relieved.** What unblocks what; what hurts most now.
3. **For each change, state the trigger, the cost, and the migration path.** The trigger is the measurable signal that makes the change worth it ("when a second team needs to deploy independently", "when p95 latency crosses X", "when this table passes ~10M rows").
4. **Explicitly include a "Not yet" section.** List the upgrades people will be tempted by — microservices, event bus, k8s, multi-region — and the signal that *would* justify each. Telling someone 
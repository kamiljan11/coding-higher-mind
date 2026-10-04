# Context interview — the inputs that actually decide the architecture

Architecture is the best **compromise in a specific context**. So before any pattern talk,
establish the context. The goal is not a long questionnaire — it's to surface the **2–4
forces that actually decide this case**. Ask only what you don't already know, infer the
rest from the conversation, and state your inferences so they can be corrected.

In SELECT mode you ask these about the project to come. In AUDIT/EVOLVE mode you ask the same
questions about the system as it really is today — auditing against an imagined context is the
most common way to reach a wrong verdict.

## The eight context dimensions

For each: the question, why it moves the decision, and which way the answer pushes.

### 1. Team — size & experience
"Who builds and maintains this — just you, a couple of people, or several teams? How familiar
are they with the tools involved?"
- **Why:** Architecture is partly an org chart. Independent deployability only pays off when independent teams actually exist. Unfamiliar tech is a hidden cost paid on every change.
- **Pushes:** Solo / tiny team → monolith, managed services, boring familiar tech. Multiple teams needing to ship independently → start considering service boundaries.

### 2. Scale — traffic & data volume
"Roughly how many users/requests per day, and how much data? Today, and realistically in 12 months?"
- **Why:** Most scaling machinery (cache, queue, read replicas, sharding) is dead weight below a threshold and essential above it. Name the threshold.
- **Pushes:** Hundreds–low-thousands/day → a single managed Postgres handles it; no cache, no queue. Sustained high throughput or large hot datasets → caching, async, replicas become earnable.

### 3. Requirements certainty
"How well do you know what this needs to do — is this exploring an idea, or a well-understood
problem with stable requirements?"
- **Why:** Uncertainty is the strongest argument for simplicity and reversibility. Premature structure calcifies decisions you'll want to undo.
- **Pushes:** Exploring / pre-PMF → modular monolith, easy-to-delete code, minimal commitments. Stable & well-understood → more upfront structure is safe and can pay off.

### 4. Criticality & uptime
"What happens if this is down for an hour? Is it nice-to-have, or does money/safety/trust
depend on it?"
- **Why:** Redundancy, failover, and careful failure handling are expensive; they're worth it in proportion to the cost of being down.
- **Pushes:** Internal tool / can be down → single instance, simple. Payments / customer-facing revenue / must-stay-up → idempotency, retries, monitoring, redundancy become non-negotiable.

### 5. Regulatory & compliance exposure
"Any regulated data or process — payments, identity, health, personal data, audit trails?"
- **Why:** Compliance imposes non-negotiable structure (data residency, audit logs, verified identity, consent). Cheaper to design in than retrofit.
- **Pushes (Iceland-specific for uzytkownik):** Payments → PCI scope avoided by using Rapyd/Straumur/Stripe, never touching raw card data. Identity verification → Signicat/Dokobit/Audkenni (CIBA), not a homegrown flow. Personal data → GDPR: data minimization, deletion paths, EU/EEA residency.

### 6. Time horizon & budget
"Is this a throwaway prototype, an MVP to validate, or a long-lived product you'll grow for years? What's the budget — time and money?"
- **Why:** A prototype optimizes for speed-to-learning and is allowed to be ugly; a long-lived product optimizes for changeability and operability. Confusing the two wastes the most effort.
- **Pushes:** Throwaway/MVP → no-code/low-code, managed everything, accept tech debt deliberately. Long-lived → invest in clear boundaries, tests, observability.

### 7. Maintenance reality — the 3am test
"When this breaks at 3am, who fixes it, and with what? Will the person on call understand this design?"
- **Why:** Every component is something a human has to operate, debug, and reason about under stress. Operability is a first-class constraint, not an afterthought.
- **Pushes:** Solo maintainer → minimize moving parts and novel tech; prefer managed services that someone else operates. A real ops team → more self-managed infrastructure is affordable.

### 8. Existing stack & integration surface
"What's already in place, and what must this talk to — payment, identity, email, CRM, AI APIs, existing data?"
- **Why:** The cheapest architecture usually extends what you already run and what your team already knows. Integrations are where complexity and failure concentrate.
- **Pushes:** Reuse the known toolbox (see `owner-stack.md`) by default. Each new external dependency adds a failure mode and a maintenance surface — count it.

## Turning answers into a leaning

Pattern-match the answers, but treat this as a starting bias to defend or override with the
five questions — not a verdict.

**Strong "keep it simple" signal** (the common case for uzytkownik's projects): small team +
uncertain or evolving requirements + modest scale + tight budget. → Modular monolith or a
single app on managed services; boring, familiar tech; no microservices, no message bus, no
premature cache, no bespoke infra. Spend the saved complexity budget on shipping and learning.

**Earn-specific-complexity signal:** a *named, present* constraint that the simple default
genuinely can't meet — independent teams, a hard latency target, a true high-availability
requirement, a regulatory mandate, a dataset that won't fit the simple model. → Add the *one*
pattern that addresses that *one* constraint (see `tradeoff-catalog.md`), and nothing else.

**Mixed signal:** when answers conflict (e.g. uncertain requirements but a hard uptime need),
make the conflict explicit and choose the architecture that keeps the *expensive-to-reverse*
decisions open while satisfying the non-negotiable one.

## Smell test before recommending

- Can you name the specific present constraint each non-trivial component earns its keep against? If not, cut it.
- Are you adding anything only because of a future that may not arrive? Move it to "Not yet" with a trigger.
- Would the 3am maintainer understand and operate this? If not, simplify or document the cost.
- Are you defaulting to the familiar toolbox, or reaching for something new? If new, is the constraint worth the adoption cost — and did you say so?

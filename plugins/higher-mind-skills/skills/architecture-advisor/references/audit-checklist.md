# Audit checklist — what to read, what to flag

Auditing means seeing the *real* system efficiently and judging it against its *real* context.
Don't read a codebase line-by-line — read the artifacts that reveal structure, build an
accurate picture, then run the two checklists below. For a large repo, spawn an **Explore
subagent** to map it and report back; you keep the conclusions, not the file dumps.

## Read these first — the architecture-revealing artifacts

These few files tell you more about the architecture than thousands of lines of business logic:

1. **Dependency / manifest files** — `package.json`, `requirements.txt`, `pyproject.toml`, `go.mod`, etc. They reveal the frameworks, databases, queues, and external services actually in use, and how many there are.
2. **Folder / module layout** — top-level structure shows whether it's a monolith, a modular monolith, or many services; whether boundaries are clean or everything reaches into everything.
3. **Infra & deploy config** — `Dockerfile`, `docker-compose.yml`, `wrangler.toml`, `vercel.json`, CI workflows, Terraform. Shows the real deploy model, what runs where, and the operational surface.
4. **Database schema & migrations** — the data model is the heart of most systems and the hardest thing to change. Look at tables, relationships, indexes, and whether migrations are tracked.
5. **Entrypoints & wiring** — the main/server file, route definitions, the n8n workflow JSON. Shows how requests flow and where the orchestration lives.
6. **Secrets & config handling** — `.env` usage, where keys live, whether anything sensitive is committed. (See risk checklist.)
7. **Any existing README / ADRs / docs** — captures intent and known trade-offs; cross-check against what the code actually does.

From these, reconstruct: components, data stores, external dependencies, deploy/trust
boundaries, and the failure points. Draw the current-state diagram from *this*, not from what
the user says it is.

## Over-engineering smells (unearned complexity — the silent tax)

Flag where the structure is more complex than any present constraint justifies:

- **Services without independent teams** — multiple deployables maintained by one or two people.
- **A queue/broker with a single producer and single consumer**, or one that never has depth.
- **A cache in front of a query that's neither hot nor slow**, or whose staleness causes bugs.
- **Event-driven indirection** for a flow that one readable function would express.
- **An agent framework / multi-step agent** wrapping what is really one prompt or a fixed 2–3 call sequence.
- **A dedicated vector DB** for a corpus that fits in a prompt or in pgvector.
- **A custom backend / custom auth** where managed (Supabase, hosted checkout, Signicat) would do.
- **Multiple datastores** before any one is saturated.
- **Premature abstraction** — heavy config, plugin systems, generic frameworks for one concrete use.
- **Kubernetes / self-hosted infra** a solo maintainer babysits where a PaaS would run it for free.

Each smell is a finding only if no present constraint earns it. Note the carrying cost (slower
changes, harder debugging) — that's the severity.

## Under-engineering / risk checklist (a present constraint left unmet)

Walk these deliberately; these are the findings that actually bite. Severity is highest where
money, identity, or data loss is involved.

**Data safety**
- Are there **backups**, and has restore ever been tested? Can a bad migration or delete be recovered?
- Are schema changes done through tracked **migrations**, or by hand against production?

**Secrets & security**
- Any **secrets/API keys committed** to the repo or hardcoded? (Bright Data, Recraft, Twilio, payment keys, etc.)
- Is **personal data** handled per GDPR — minimized, deletable, stored in the EU/EEA?
- Is input from users/webhooks **validated**, and are queries parameterized (no injection)?
- For deeper code-level security, hand off to the **`security-review` skill** rather than eyeballing it.

**Reliability**
- Are **payment/webhook handlers idempotent** (dedupe on event id)? Providers retry — non-idempotent handlers double-charge or double-process. High severity.
- Do calls to external APIs have **timeouts, retries, and failure handling**? What happens when Straumur/Rapyd/RetellAI/an LLM is slow or down?
- Is there a **single point of failure** on something that must stay up?
- Is slow work done **inside a webhook/request handler** (causing provider timeouts and retries)?

**Observability**
- Is there **error monitoring**? Sentry is already in the stack — if production has none, that's a low-effort, real-value finding.
- Can you tell *why* a failed run failed, or only *that* it failed? Are there logs/alerts?

**Cost & limits**
- Any **unbounded loops or pagination** over a paid API (Bright Data, LLM tokens) that can run up cost?
- Is **model tier** matched to the task, or is everything on the most expensive model? (See `model-router`.)

**Payments & identity (Iceland-specific)**
- Does anything touch **raw card data**? It shouldn't — use the processor's hosted checkout to stay out of PCI scope.
- Is identity verification **homegrown** where it should be Signicat / Dokobit / Audkenni (legal eID)?

## Turning the checklists into output

Score each finding by **(pain it causes now × cost to fix)** and put it in the findings
scorecard (`deliverable-templates.md`). Lead with high-severity / low-effort items — those are
the "do now" fixes (often: add Sentry, make the webhook idempotent, move a secret to env).
Write an ADR for each change worth making, and a "leave it — correct for this context" line for
anything that looks unusual but is actually right. A clean audit is a successful audit: don't
manufacture findings to look thorough.

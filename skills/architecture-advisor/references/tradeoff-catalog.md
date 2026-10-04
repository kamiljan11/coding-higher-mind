# Trade-off catalog

Every entry follows the same shape so the cost is never hidden:

- **Buys** — the benefit, only real against a present constraint.
- **Costs** — what you pay forever after adopting it.
- **Cheaper default** — what to do instead until it's earned.
- **Earn it when** — the concrete, ideally measurable signal that flips the decision.
- **Breaks/bites when** — how this choice turns from asset to liability.

Read the entries relevant to the patterns actually in play; don't dump the whole file into a
recommendation. The recurring lesson: the impressive option is usually the wrong default, and
the boring option is usually right until a specific constraint says otherwise.

## Table of contents

1. [Software & app architecture](#1-software--app-architecture)
   - 1.1 Microservices vs modular monolith
   - 1.2 Message queue / async vs synchronous
   - 1.3 Cache vs no cache
   - 1.4 Event-driven vs direct calls
   - 1.5 CQRS / read-write split vs single model
   - 1.6 Polyglot persistence vs one database
   - 1.7 Custom auth vs managed identity
   - 1.8 Self-hosted vs managed services
   - 1.9 Monorepo vs many repos
   - 1.10 Kubernetes / containers vs managed platform
2. [Automation & AI-agent architecture](#2-automation--ai-agent-architecture)
   - 2.1 One big n8n workflow vs many small ones
   - 2.2 n8n / no-code vs real code
   - 2.3 RAG / vector DB vs simpler retrieval
   - 2.4 Agent framework vs a few API calls
   - 2.5 Model tier: Opus vs Sonnet vs Haiku
   - 2.6 Sync webhook vs queued processing
   - 2.7 Build a custom MCP vs call the API directly
   - 2.8 Channel choice: voice vs chat vs form
3. [Client website architecture](#3-client-website-architecture)
   - 3.1 Static / Lovable vs SPA vs full framework
   - 3.2 Headless CMS vs hardcoded vs no-code editor
   - 3.3 No backend vs Supabase vs custom backend
   - 3.4 Managed hosting vs self-host
   - 3.5 Build vs integrate a third party

---

## 1. Software & app architecture

### 1.1 Microservices vs modular monolith
- **Buys:** independent deployment and scaling per service; team autonomy; fault isolation.
- **Costs:** network calls replace function calls (latency, retries, partial failure); distributed transactions; contract versioning; tracing/observability across services; many deploy pipelines; big jump in operational complexity. You pay all of this on day one.
- **Cheaper default:** a **modular monolith** — one deployable, but with clear internal module boundaries (separate packages/domains, no cross-module reaching into internals). You get most of the organizational benefit and can extract a service later *if* you must.
- **Earn it when:** genuinely independent teams need to deploy on their own cadence; or one component has a wildly different scaling/cost profile and must scale alone; or a fault-isolation requirement is real and named.
- **Breaks/bites when:** a small team runs many services — every feature now spans repos, deploys, and a debugging session that hops the network. This is the single most common over-engineering trap.

### 1.2 Message queue / async vs synchronous
- **Buys:** smooths traffic spikes; decouples a slow/unreliable step from the request; enables retries and backpressure.
- **Costs:** a broker to run and monitor; eventual consistency the UI must handle; harder debugging (work happens "later, somewhere"); duplicate/out-of-order delivery you must design for.
- **Cheaper default:** a synchronous call, or a simple DB-backed job row processed by a cron/worker. Postgres-as-a-queue (`SELECT … FOR UPDATE SKIP LOCKED`) covers a surprising amount.
- **Earn it when:** a step is genuinely slow or flaky (third-party API, video/image processing, bulk email) and must not block or fail the user request; or load spikes exceed what synchronous handling absorbs.
- **Breaks/bites when:** added "for scale" before any load exists — you've bought eventual-consistency bugs and an extra service to babysit, for a queue depth of one.

### 1.3 Cache vs no cache
- **Buys:** lower latency and load for hot, expensive, slow-changing reads.
- **Costs:** the two hard problems — **invalidation** (stale data, the bug class users notice) and **consistency**; plus another moving part and undefined behavior on cache failure unless you design it.
- **Cheaper default:** no cache. First fix the query, add the index, or use the database's own caching. Reach for an HTTP/CDN cache for static assets before app-level caching.
- **Earn it when:** a specific read is measurably hot and expensive, the data tolerates staleness, and you've already exhausted query/index fixes.
- **Breaks/bites when:** added speculatively — now every write path must reason about invalidation, and "why is it showing old data" becomes a recurring ticket.

### 1.4 Event-driven vs direct calls
- **Buys:** loose coupling between modules; easy to add consumers without touching producers; natural audit trail.
- **Costs:** business flow becomes implicit and hard to follow ("what happens when X fires?"); debugging means reconstructing a chain across handlers; error handling, ordering, and idempotency all get harder.
- **Cheaper default:** explicit direct calls / an orchestrating function you can read top-to-bottom. Clarity beats decoupling while the team and domain are small.
- **Earn it when:** several independent reactions to one fact genuinely need to evolve separately, or you need an audit log of domain events as a first-class requirement.
- **Breaks/bites when:** used as the default everywhere — tracing a single user action across a dozen events is far costlier than the coupling it removed.

### 1.5 CQRS / read-write split vs single model
- **Buys:** read and write paths optimized and scaled independently; useful for very read-heavy systems or complex reporting.
- **Costs:** two models to keep in sync; eventual consistency between them; significantly more code and cognitive load.
- **Cheaper default:** one model. For reporting load, a read replica or a materialized view gets most of the benefit with a fraction of the complexity.
- **Earn it when:** read and write loads diverge by orders of magnitude, or the read shapes are so different that one model serves both badly.
- **Breaks/bites when:** applied to a CRUD app — pure overhead, doubled surface area, no payoff.

### 1.6 Polyglot persistence vs one database
- **Buys:** the right store per job (search engine, time-series DB, graph DB, vector DB).
- **Costs:** every datastore is its own operational burden, backup story, consistency boundary, and failure mode; cross-store consistency is on you.
- **Cheaper default:** **Postgres for almost everything.** It does JSON, full-text search, geo, and (with pgvector) embeddings. One store, one backup, one mental model.
- **Earn it when:** a workload truly outgrows Postgres on a specific axis — large-scale vector search (→ Pinecone), heavy full-text/relevance (→ a search engine), real time-series volume.
- **Breaks/bites when:** four datastores appear before one is saturated — quadruple the ops, no benefit.

### 1.7 Custom auth vs managed identity
- **Buys (custom):** total control over the flow.
- **Costs (custom):** security is unforgiving and you own every mistake — password storage, reset flows, session handling, MFA, account takeover, audits. Enormous, permanent liability for almost no product value.
- **Cheaper default:** managed auth — **Supabase Auth**, or an identity provider. For Icelandic legal identity, **esign-provider + esign-provider-b + eid-provider (CIBA)** — never build eID yourself.
- **Earn it when:** essentially never for app login. Only with a hard requirement no provider can meet.
- **Breaks/bites when:** the homegrown system meets its first real attacker, or a compliance audit.

### 1.8 Self-hosted vs managed services
- **Buys (self-host):** control, no per-unit vendor fees, no lock-in.
- **Costs (self-host):** you are now the ops team — patching, scaling, backups, security, uptime, 3am pager. That labor usually dwarfs the managed fee.
- **Cheaper default:** managed (Supabase, Cloudflare, hosted APIs). For a small team, renting operations is almost always cheaper than doing them.
- **Earn it when:** scale makes managed costs genuinely punishing, you have real ops capacity, or control/residency is a hard requirement.
- **Breaks/bites when:** a solo maintainer self-hosts to save money and pays it back many times over in outages and maintenance.

### 1.9 Monorepo vs many repos
- **Buys (monorepo):** atomic cross-cutting changes; shared tooling; one place to look. **(many repos):** hard isolation and independent lifecycles.
- **Costs (many repos):** coordinating a change across repos; dependency/version drift; duplicated config.
- **Cheaper default:** a **monorepo** for a small team — less coordination overhead, easier refactors.
- **Earn it when:** independent teams with independent release cycles and access boundaries, or open-sourcing one component.
- **Breaks/bites when:** a solo dev maintains six repos for one product and spends time on cross-repo bookkeeping instead of features.

### 1.10 Kubernetes / containers vs managed platform
- **Buys:** portable, powerful orchestration; fine-grained control; cloud-agnostic.
- **Costs:** a large operational surface (cluster upgrades, networking, RBAC, autoscaling, monitoring) that typically needs dedicated expertise.
- **Cheaper default:** a managed platform — **Cloudflare Workers / Pages**, a serverless host, or a PaaS. Deploy by `git push`; no cluster to run.
- **Earn it when:** scale, multi-service complexity, or portability requirements genuinely exceed a PaaS, and you have the ops capacity.
- **Breaks/bites when:** adopted for a single container that a serverless platform would have hosted for free.

---

## 2. Automation & AI-agent architecture

### 2.1 One big n8n workflow vs many small ones
- **Buys (one big):** everything visible in one canvas. **(many small):** each is testable, reusable, and fails in isolation.
- **Costs (one big):** becomes unreadable and fragile; one bad node breaks the whole chain; impossible to reuse pieces.
- **Cheaper default:** **small, single-purpose workflows** composed via sub-workflow calls or webhooks. One trigger, one job.
- **Earn it when:** a flow is genuinely linear, short, and owned end-to-end — then one workflow is fine.
- **Breaks/bites when:** a 60-node monolith does five unrelated jobs and every edit risks all of them.

### 2.2 n8n / no-code vs real code
- **Buys (n8n):** fast to build, visual, great glue between APIs, no deploy pipeline.
- **Costs (n8n):** logic-heavy flows become harder to read than code; testing/version control are weaker; complex branching and data-shaping fight the canvas.
- **Cheaper default:** **n8n for orchestration and glue** (this trigger → that API → store result). It's the right default for most of uzytkownik's automations.
- **Earn it when:** real branching logic, heavy data transformation, unit tests, or performance needs appear → move that part into a **Cloudflare Worker / script** and let n8n call it.
- **Breaks/bites when:** people simulate a whole application in n8n nodes — at that point a few lines of code are simpler and more maintainable.

### 2.3 RAG / vector DB vs simpler retrieval
- **Buys:** semantic recall over a large corpus that can't fit in a prompt.
- **Costs:** an ingestion + chunking + embedding pipeline; an index to keep fresh and pay for; retrieval-quality tuning (chunk size, top-k, re-ranking); a whole new failure mode ("it retrieved the wrong thing").
- **Cheaper default (in order):** (1) just put the content in the prompt if it fits — modern context windows are large; (2) keyword/DB search then feed top hits to the model; (3) pgvector inside the existing Postgres. Only then a dedicated vector DB (Pinecone) for scale.
- **Earn it when:** the corpus is too large for the context window, changes often, and needs semantic (not keyword) recall — and you've confirmed simpler retrieval is insufficient.
- **Breaks/bites when:** a full RAG stack is built for twenty documents that would have fit in a single prompt.

### 2.4 Agent framework vs a few API calls
- **Buys:** multi-step reasoning, tool use, and autonomy for genuinely open-ended tasks.
- **Costs:** non-determinism (hard to test/debug); latency and token cost stack across steps; loops and failure modes are hard to bound; heavy frameworks hide what's actually happening.
- **Cheaper default:** a single well-crafted prompt, or a short fixed chain of 2–3 explicit calls. Most "agent" tasks are actually a known sequence — write the sequence.
- **Earn it when:** the task truly requires dynamic, open-ended tool use where the steps can't be known in advance.
- **Breaks/bites when:** an autonomous agent is used for a fixed pipeline — you've traded a reliable script for an expensive, flaky one. (See the `model-router` skill for matching model tier to step.)

### 2.5 Model tier: Opus vs Sonnet vs Haiku
- **Buys (bigger model):** stronger reasoning on hard, ambiguous tasks. **(smaller):** much cheaper and faster.
- **Costs:** using the top tier for everything burns budget and rate limits on work a cheaper model does fine; using the cheapest for hard reasoning yields quiet quality failures.
- **Cheaper default:** **match tier to step.** Classification/extraction/formatting → Haiku. Most generation/analysis → Sonnet. Genuinely hard architecture/reasoning → Opus. Mix tiers within one pipeline.
- **Earn it when:** a specific step's quality measurably needs the bigger model — promote just that step.
- **Breaks/bites when:** one tier is hard-coded everywhere; defer to the `model-router` skill for the routing call.

### 2.6 Sync webhook vs queued processing
- **Buys (queue/store-first):** no lost events when the downstream is slow/down; retries; survives restarts.
- **Costs:** more moving parts; eventual processing; idempotency required.
- **Cheaper default:** for low volume, handle the webhook synchronously — but **always return 200 fast and make handlers idempotent** (dedupe on event id), since providers retry.
- **Earn it when:** webhook volume is spiky or downstream processing is slow/unreliable, or lost events are costly (payments) → persist the event immediately, process from the store.
- **Breaks/bites when:** slow work runs inside the webhook handler → timeouts, provider retries, duplicate processing.

### 2.7 Build a custom MCP vs call the API directly
- **Buys (custom MCP):** a reusable, typed interface to a service across many sessions/agents.
- **Costs:** a server to build, host, version, and maintain.
- **Cheaper default:** call the API directly from n8n or a script, or use an existing MCP/connector. Don't wrap a thing you call once.
- **Earn it when:** the same capability is needed repeatedly across agents/sessions and a clean reusable tool clearly pays for itself (see the `mcp-builder` skill).
- **Breaks/bites when:** a bespoke MCP wraps a single endpoint used in one workflow.

### 2.8 Channel choice: voice vs chat vs form
- **Buys (voice/RetellAI):** natural, hands-free, high-touch. **(chat/WhatsApp):** async, cheap, logged. **(web form):** simplest, most reliable.
- **Costs:** complexity and failure modes rise sharply voice > chat > form — telephony, latency, transcription errors, turn-taking, barge-in.
- **Cheaper default:** the simplest channel that meets the need. A form + automated follow-up often beats a voice agent for booking/qualification.
- **Earn it when:** the interaction genuinely benefits from real-time conversation (inbound phone reception, qualification calls) and volume justifies the build.
- **Breaks/bites when:** a voice agent is built for something a two-field form and a confirmation email would have handled.

---

## 3. Client website architecture

For agency-site builds, the deciding context is almost always: small site, one client maintaining
(or not maintaining) it, SEO matters, budget is fixed. That pushes hard toward simple, managed,
low-maintenance defaults.

### 3.1 Static / Lovable vs SPA vs full framework
- **Buys (static/Lovable):** fast to build, fast to load, great SEO, cheap to host, little to break. **(full framework, e.g. Next):** dynamic rendering, app-like features.
- **Costs (heavier framework):** build pipeline, server runtime, more maintenance and more to go wrong — for a brochure/marketing site, mostly pure overhead.
- **Cheaper default:** **Lovable/React or a static build** for marketing and small business sites. Most client sites are content + forms, not applications.
- **Earn it when:** the site is really an app — accounts, dashboards, lots of dynamic per-user data.
- **Breaks/bites when:** a five-page business site is built as a heavy full-stack app the client can't maintain and Google indexes poorly.

### 3.2 Headless CMS vs hardcoded vs no-code editor
- **Buys (CMS):** non-technical editing. **(hardcoded):** simplest, nothing to run.
- **Costs (CMS):** another service, schema, and integration; overkill if content rarely changes.
- **Cheaper default:** **hardcoded content** when the client won't self-edit (many don't), or a no-code/site builder when they will. Add a headless CMS only for genuinely frequent editing by the client.
- **Earn it when:** the client edits content regularly themselves, or there's a real content team / blog cadence.
- **Breaks/bites when:** a CMS is wired up "so they can edit" for a client who never logs in — permanent complexity for unused capability.

### 3.3 No backend vs Supabase vs custom backend
- **Buys (no backend):** nothing to secure or maintain. **(Supabase):** instant Postgres + auth + storage + APIs. **(custom):** full control.
- **Costs (custom backend):** you build and operate auth, data, hosting, security — rarely justified for a client site.
- **Cheaper default (in order):** (1) **no backend** — forms post to email or an n8n webhook; (2) **Supabase** when you need data, accounts, or storage; (3) custom backend only when a hard requirement forces it.
- **Earn it when:** the site needs real accounts, persistent user data, or business logic a managed backend can't express.
- **Breaks/bites when:** a custom Node backend is stood up to handle a contact form.

### 3.4 Managed hosting vs self-host
- **Buys (managed, e.g. Cloudflare Pages/Vercel):** deploy by git push, free TLS, CDN, near-zero maintenance.
- **Costs (self-host):** a server to patch, secure, and keep up — for a client site, all downside.
- **Cheaper default:** **managed hosting + Cloudflare** in front; ISNIC for the `.is` domain.
- **Earn it when:** a hard control/residency requirement, essentially never for a marketing site.
- **Breaks/bites when:** a VPS hosts a static site and becomes a security/uptime liability nobody is watching.

### 3.5 Build vs integrate a third party
- **Buys (build):** exact fit, no per-use fee. **(integrate):** done today, maintained by someone else.
- **Costs (build):** every feature you build is a feature you maintain forever — booking, payments, chat, reviews, maps.
- **Cheaper default:** **integrate** the proven service (Cal.com for booking, Stripe/local-acquirer/payment-gateway for payments, a reviews widget, embedded maps). Build only the thing that is actually the client's differentiator.
- **Earn it when:** the capability is the client's core value and no off-the-shelf option fits.
- **Breaks/bites when:** time is spent rebuilding a commodity (a booking calendar, a payment flow) that a mature service already solved.

---

## Using the catalog in a recommendation

1. Identify only the patterns actually in question for this case.
2. For each, lead with the **cheaper default** and the **present constraint** (if any) that would override it.
3. State the trade-off in the four terms (buys / costs / earn-it / breaks-when) so the decision is legible to future-you.
4. Put every "not yet" pattern into the roadmap's **Not yet** section with its trigger — deferring is a decision worth recording, not a gap.

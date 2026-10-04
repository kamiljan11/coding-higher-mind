# uzytkownik's default toolbox & boring-default architectures

Recommend what uzytkownik actually runs. The cheapest, most maintainable architecture almost always
extends the existing stack and the team's existing knowledge. Introduce something new only when
a named present constraint requires it — and when you do, **state the adoption + maintenance cost
out loud** as part of "what do we lose". Treat this as the default to defend or consciously
override, not a mandate.

> Keep this current. If the stack changes, update this file (and cross-check the `tech-stack`,
> `agency-site`, `project-c`, and `lovable-build` context skills, which hold live details).

## The toolbox (as of mid-2026)

**Data & backend**
- **Supabase (Postgres)** — default database, auth, storage, and auto-APIs. First choice for anything needing data or accounts. Postgres does JSON, full-text search, geo, and embeddings (pgvector) — reach for it before any specialized store.
- **Cloudflare Workers / Pages** — default compute and hosting; deploy by git push, edge runtime, minimal ops. Default home for APIs, small services, and sites.
- **Pinecone** (index: `pinecone-index`) — dedicated vector DB for semantic memory/RAG **at scale**. Below scale, prefer pgvector in Supabase.

**Automation & AI**
- **n8n** — default orchestration/glue for automations. Keep workflows small and single-purpose; push heavy logic into Workers/scripts.
- **Claude (Opus / Sonnet / Haiku)** — match tier to step via the `model-router` skill. Haiku for classify/extract, Sonnet default, Opus for hard reasoning.
- **Fal.ai** — raster image generation. **Recraft** — vector/SVG generation (print, icons, logos). **HeyGen** — video avatars.
- **Bright Data** — primary scraping/SERP. **Firecrawl** — secondary/free-tier fallback.
- **MCP servers** — build with the `mcp-builder` skill only when a capability is reused across sessions/agents; otherwise call the API directly from n8n or a script.

**Payments & identity (Iceland)**
- **payment-gateway** — cards / subscriptions. **local-acquirer** — domestic ISK payments. **Stripe** — exploratory BaaS. Always use the processor; never handle raw card data (keeps you out of PCI scope).
- **esign-provider + esign-provider-b + eid-provider (CIBA)** — legal Icelandic eID and e-signature. Never build identity verification yourself.

**Comms & ops**
- **Twilio** — SMS / OTP / notifications. **RetellAI** — AI voice phone agents (reserve for genuine real-time phone needs).
- **Sentry** — error monitoring. If a production system has no error monitoring, that's an AUDIT finding *and* the fix is already in the stack.
- **Gmail multi-account** — email send/receive in automations.

**Web / frontend**
- **Lovable + React/TypeScript** — default for client sites and simple apps (agency-site builds).
- **Cloudflare Pages** hosting; **ISNIC** for `.is` domains; **Artlist** for media licensing.

**Environment**
- Windows workstation; Python scripts; "agent-os" / agent-os local automation system. Prefer solutions a solo maintainer can operate.

## Boring-default architectures per domain

Start here. Deviate only where a context constraint forces it, and record the deviation as an ADR.

### New web app / SaaS (small)
```
Lovable/React (Cloudflare Pages)
  → Cloudflare Worker API
    → Supabase (Postgres + Auth + Storage)
  → payments via payment-gateway/local-acquirer (hosted checkout)
  → identity via esign-provider/eid-provider only if legal eID is required
  → Sentry for errors
```
No microservices, no queue, no cache, no separate vector DB until a named constraint appears.
A modular monolith Worker (or a single Supabase-backed app) covers the vast majority of cases.

### Automation / AI pipeline
```
Trigger (webhook / schedule / inbound message)
  → n8n orchestration (small, single-purpose workflow)
    → Claude at the right tier (model-router)
    → heavy logic / transforms offloaded to a Cloudflare Worker or script
    → retrieval: prompt-stuffing → pgvector → Pinecone (only as scale demands)
  → store results in Supabase; log/alert via Sentry/Gmail
```
Return webhooks fast and make handlers idempotent. Reach for a queue/store-first pattern only
when volume is spiky or lost events are costly (e.g. payments).

### Client website (agency-site)
```
Lovable/React static-ish build (Cloudflare Pages) · ISNIC domain
  → forms → email or n8n webhook (no backend by default)
  → Supabase only if real accounts/data are needed
  → integrate commodities: Cal.com (booking), Stripe/local-acquirer (pay), reviews widget, embedded maps
  → hardcoded content unless the client truly self-edits → then a light CMS
```
SEO and load speed matter; the client usually won't maintain anything complex. Simplicity is the
feature.

### Voice / phone (RetellAI)
```
RetellAI voice agent → webhook → n8n → Claude (intent/qualify) → Cal.com booking / Supabase log
```
Only when a real-time phone interaction is genuinely needed; otherwise a form + automated
follow-up is cheaper and more reliable.

## How to apply this

- Map the project to the nearest boring default above; that's your baseline recommendation.
- For each thing you'd add beyond it, point to the present constraint forcing it (`tradeoff-catalog.md`).
- For each thing you'd remove (AUDIT), check it against these defaults — if the default is simpler and the constraint isn't there, that's an over-engineering finding.
- When recommending anything outside the toolbox, name the adoption and maintenance cost explicitly. Familiar-and-managed beats novel-and-powerful for a small team almost every time.

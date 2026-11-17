# C4 levels - checklists (source: DevSteer "Architekt Przyszłości" lessons 41-44, demos watched frame by frame 2026-11-07)

Pick the level by audience, not by how much you know. Keep the **same element id and name across levels**: Mermaid is a drawing, not a model (IcePanel/Structurizr keep one model behind many views; renaming in one Mermaid file does not propagate), so a rename = grep and fix every diagram in the repo.

**C1 System Context** - for the client / non-technical stakeholders. Changes only when an integration is added or removed (`~/.claude/templates/repo/docs/ARCHITECTURE.md`, "Przeplyw danych").
- [ ] Our system in the centre, with a one-sentence description of what it does for the business
- [ ] Every actor (person/role) with a description of what they really do in the system
- [ ] Every external system marked external (we do not manage it) + one-line description of what it is
- [ ] Edge labels = business use cases ("creates invoice", "sends SMS"), no protocols
- [ ] Nothing about the inside: no database, no "microservices"/"monolith", no framework
- [ ] Legend (external vs internal, actor vs system)

**C2 Containers** - for developers, ops, QA. A container = something with its own runtime or its own data, not a Docker container.
- [ ] Start from the C1 elements (same actors, same external systems)
- [ ] Each container: name, type (app / store / function / queue), technology if decided (open ADR = leave the technology empty, do not guess), one-line responsibility
- [ ] Our stack mapping: SPA (Vercel/Lovable) = app in the browser; Supabase Postgres = store; each edge function = function container (group many with a legend, never hide important calls inside a group); n8n = own container; Stripe/Twilio/KSeF = external systems
- [ ] Draw a store only where it differs from the default (default Postgres of every container stays implicit) - the diagram shows what matters for this narrative
- [ ] Each external integration behind exactly one own container (one place changes when the vendor changes)
- [ ] Every edge: intent + protocol + sync/async; a fn -> fn chain longer than 2 hops = finding (same threshold as `node ~/.claude/bin/arch-check.js` style signals)
- [ ] Title says the state: `as-is` or `target <date>`; legend present

**C3 Components** - only for a container whose inside is the topic of the decision; modules = `src/features/<area>/` with their single entry point.

Owner: this file (PG repo `~/.claude`, tracked). `skills/diagrams/SKILL.md` is a symlink into the app plugin folder (not in git) and only points here.

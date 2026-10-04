---
name: mobile-optimization
description: >-
  Mobile optimization system — audits a site's mobile version with real measurements
  (touch targets, input font sizes, Core Web Vitals, overflow, images), diagnoses against
  current standards, and applies fixes plus app-like patterns (toggles on comparison
  tables, carousels, accordions, bottom sheets, view transitions, skeletons, optimistic
  UI). Use whenever work touches how a site looks or behaves on a phone. PROAKTYWNIE gdy:
  użytkownik buduje, poprawia lub kończy stronę i wspomina mobile/telefon/responsywność,
  pyta „jak to wygląda na mobile", „zoptymalizuj pod mobile", „audyt mobilny", „rozjeżdża
  się na telefonie". Trigger on: "mobile optimization", "optymalizacja mobile", "pod
  telefon", "audyt mobilny", "responsywność", "responsive", "mobile-first", "touch
  targets", "app-like", "jak apka", "PWA", "Core Web Vitals", "carousel", "accordion",
  "bottom sheet", "sticky CTA", "viewport". NIE gdy: natywna apka iOS/Android (nie web).
---

# Mobile Optimization

A complete system for making websites work — and feel — great on phones. It covers three jobs: **auditing** an existing mobile experience with real measurements, **fixing** what's wrong against current standards, and **building** app-like interaction patterns.

The core principle: **measure, don't guess.** "It looks fine on my phone" is not data. The most valuable move this skill makes is opening the page in a real mobile viewport and reading exact numbers (tap-target heights, input font sizes, image dimensions, layout overflow). Those numbers turn vague opinions into a prioritized fix list.

## When you're invoked, figure out the job

- **Audit / "how does mobile look"** → run the Audit Workflow below, then report findings scored against standards.
- **Fix / "optimize for mobile"** → audit first (you can't fix what you haven't measured), then apply fixes from the references.
- **Build / "make this feel like an app"** → go to `references/app-like-patterns.md` for the right pattern + working code.
- **Adapt / "this desktop section breaks on mobile"** → `references/desktop-to-mobile.md`.

Most real requests are a mix. Default to: **audit → diagnose → fix → verify.**

## Audit Workflow (the heart of this skill)

### 1. Render at a real mobile viewport
If a browser tool is available (Playwright MCP `mcp__playwright__*`, or Claude in Chrome `mcp__Claude_in_Chrome__*`):
- Resize to **390 × 844** (a typical phone; iPhone-class). For a small-Android check, also try **360 × 800**.
- Navigate to the URL.
- Take a full-page screenshot for the visual record.

If no browser tool is available, fetch the HTML/CSS and inspect statically — you'll catch meta tags, font sizes, image formats, and markup issues, just not live geometry.

### 2. Run the measurement script
Paste the function from `scripts/mobile_audit.js` into the browser's evaluate tool (`browser_evaluate`). It returns a structured object: viewport meta, horizontal overflow + the offending elements, every tap target under 44px, every input under 16px (with its type/inputmode/autocomplete), image formats + missing dimensions + oversized-for-viewport images, heading outline, document height in "screens", sticky/fixed elements, and PWA signals. Read it once to learn the response shape, then trust it.

This single script replaces a dozen manual checks and is the same measurement every time, so audits are consistent and comparable across sites.

### 3. Diagnose against standards
Compare the measurements to `references/standards.md`. Sort findings by impact, not by ease. The usual high-impact culprits, in rough priority order:

1. **Inputs below 16px** → iOS zooms the page on focus (kills form UX, which is the conversion point). One-line fix.
2. **Oversized / wrong-format hero or LCP image** → slow Largest Contentful Paint. Needs `srcset`/`sizes` + WebP/AVIF.
3. **Tap targets under 44–48px** (buttons, toggles, nav/footer links) → mis-taps, frustration.
4. **Images without width/height/aspect-ratio** → layout shift (CLS) as they load.
5. **Horizontal overflow** → the whole page scrolls sideways; usually one runaway element.
6. **Zoom blocked** (`maximum-scale=1` / `user-scalable=no`) → accessibility failure.
7. **Missing form attributes** (`inputmode`, `autocomplete`, correct `type`).
8. Polish: no `theme-color`, hamburger not toggling `aria-expanded`, motion not respecting `prefers-reduced-motion`.

### 4. Report
Use this structure so the user can act immediately:

```
## Mobile audit — [site]
**Co już dobrze:** [measured passes — keep it honest and specific]
**Do poprawy (priorytetowo):**
1. 🔴 [issue] — [measured fact, e.g. "inputy 14px (5/6)"] → [exact fix]
2. 🟡 ...
3. 🟢 [polish]
**Werdykt:** [one line — where it sits: "dobrze zbudowana, brakuje dopracowania"]
```

Always lead with what's already right (grounded in measurements) — it's accurate and it makes the fix list land better. Tie every issue to a number you measured and a concrete fix, not a vibe.

### 5. Verify after fixing
Re-run the script, confirm the numbers moved, and remind the user that **lab ≠ field**: the real proof is a physical phone (test the form with the keyboard open — it eats ~half the screen) plus PageSpeed Insights / Search Console field data. See the verification section in `references/standards.md`.

## Reference files — read the one that fits the task

- **`references/standards.md`** — the hard numbers and the "why": viewport, touch targets (44/48, WCAG 24), the 8pt spacing system, the real-space budget (~660px usable, ~360px with keyboard), fluid typography, forms, Core Web Vitals 2025 (LCP 2.5s / INP 200ms / CLS 0.1), images, accessibility, verification tooling. Read this for any audit or fix.
- **`references/interaction-patterns.md`** — mobile UX patterns with copy-paste code: horizontal scroll/carousel (CSS scroll-snap), accordion (native `<details>`), bottom sheet, sticky CTA, navigation (bottom nav vs hamburger), gestures, thumb zone.
- **`references/app-like-patterns.md`** — making a site feel like an app: toggles/segmented controls on comparison tables, tabs, View Transitions, app shell, scroll-driven animations, skeletons vs spinners, optimistic UI, toast/snackbar, microinteractions/haptics, stories, swipe actions, FAB, native browser APIs (Web Share, capture, Pay, wake lock), PWA install. Read this for "make it feel like an app" or "shorten the scroll."
- **`references/desktop-to-mobile.md`** — how to transform heavy desktop components: mega-menu, wide data tables (→ cards), multi-column, sidebars, hover menus, big heroes, footers.

Keep SKILL.md in working memory; pull a reference file only when the task needs it, to stay efficient.

## Non-negotiables (apply even on quick jobs)

These cause the most damage in the wild and are cheap to get right, so bake them in by default:

- **Viewport meta present, zoom NOT blocked.** `width=device-width, initial-scale=1` (+ `viewport-fit=cover` for safe areas). Never `user-scalable=no`.
- **Inputs ≥ 16px font** — anything smaller makes iOS Safari zoom on focus. The fix is font size, never disabling zoom.
- **Tap targets ≥ 44–48px, ≥ 8px apart.** Grow the touch area with padding if the icon must look small.
- **Images:** explicit `width`+`height` (or `aspect-ratio`) to prevent CLS; `srcset`/`sizes`; WebP/AVIF; `loading="lazy"` for below-the-fold but NOT for the LCP/hero image.
- **Design mobile-first** (base CSS = phone, enhance up with `min-width`); use `dvh` not `vh` for full-screen sections.
- **Respect `prefers-reduced-motion`** on every animation.
- **Real-space awareness:** you have ~660px of usable height, ~360px with the keyboard open. Don't cram, but don't make a 10-screen scroll either — use accordions/tabs/bottom sheets (see app-like patterns) to keep the important things reachable in 2–3 thumb flicks.

## Human-facing deliverables (assets)

`assets/` contains two self-contained interactive HTML specs (`spec-mobile-optimization.html`, `spec-app-like-patterns.html`) with live demos of every pattern. They're not for Claude to parse — they're reference/teaching material you can open yourself or hand to a client to demonstrate a pattern. Offer them when the user wants a visual reference or something to show a client. `assets/checklist.md` is a pre-launch checklist for the final pass.
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   
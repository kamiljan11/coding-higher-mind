# Mobile Standards — the hard numbers and why they matter

Reference for audits and fixes. Every number here comes from official guidance (Apple HIG, Material Design 3, web.dev/Core Web Vitals, WCAG 2.2, MDN) and reflects 2025/2026.

## Contents
1. Viewport & mobile-first
2. Layout, breakpoints, viewport units
3. Real space budget (don't cram / don't sprawl)
4. Spacing system (8pt)
5. Typography
6. Touch targets & thumb zone
7. Forms
8. Images & media
9. Core Web Vitals
10. Accessibility
11. Verification & tooling

---

## 1. Viewport & mobile-first
- Required: `<meta name="viewport" content="width=device-width, initial-scale=1.0">`. Add `viewport-fit=cover` to use safe-area insets. Without the tag, mobile browsers render at ~980px and shrink — everything looks tiny.
- **Never block zoom** (`user-scalable=no`, `maximum-scale=1`) — it's a WCAG failure for low-vision users. The common reason people block it (inputs zooming) is solved by 16px fonts, section 7.
- **Mobile-first**: write base CSS for the phone, layer larger screens with `@media (min-width: …)`. Base stays lean and fast; desktop only adds. >60% of traffic is mobile and Google indexes the mobile version.

## 2. Layout, breakpoints, viewport units
- Set breakpoints where content breaks, not at device models. A solid set: `≤480` phone, `481–768` large phone/small tablet, `769–1024` tablet, `1025+` desktop. 3–5 is plenty.
- **Use `dvh`, not `vh`,** for full-screen sections — `100vh` ignores the collapsing address bar and clips content. Pattern: `min-height:100vh; min-height:100dvh;` (fallback first). `svh`/`lvh` for small/large states.
- Auto-wrapping grid with no media queries: `grid-template-columns: repeat(auto-fit, minmax(260px, 1fr))`.
- `@container` queries make components respond to their parent's width — use for reusable components; media queries for page layout.

## 3. Real space budget
On a typical 390×844 phone you do **not** have 844px. Roughly:
- ~59px safe-area top (status bar / notch / Dynamic Island)
- ~56px browser address bar (collapses on scroll down)
- **~660px** of actually usable content height with the bar visible (~750px after it collapses)
- ~34px bottom safe area (gesture bar) — plus any sticky CTA
- **With the keyboard open: ~360px.** The important field + its submit button must fit above the keyboard. Always test forms with the keyboard up.

Implication: prioritize. The key message + one CTA + a trust signal belong in the first 1–2 screens. Don't make a 10-screen wall either — collapse secondary content (accordions/tabs/bottom sheets) so users reach what matters in 2–3 thumb flicks. A page taller than ~8 screens on mobile usually needs condensing.

## 4. Spacing system (8pt)
Use multiples of 8 (with 4 as a half-step): 4, 8, 12, 16, 24, 32, 48, 64. Adopted by Material, IBM Carbon, Apple — consistent rhythm, fewer ad-hoc decisions.
- Page side gutter: **16–24px** (never 0 — content must not touch the edge).
- Card padding: 16–20px. Gap between list cards: 12–16px. Between page sections: 32–64px.
- Between interactive elements: **≥8px** (anti mis-tap).
- "Internal ≤ external": space around a group ≥ space inside it, so groups read as groups.
- Body line length 45–75 characters. White space is legibility, not waste.

## 5. Typography
- **Body ≥ 16px** on mobile (smaller tires eyes and, on inputs, triggers iOS zoom).
- Fluid scale with `clamp()` instead of breakpoint jumps: `h1{font-size:clamp(1.9rem,5vw,2.7rem)}`.
- Line-height ~1.5 for body (WCAG). Contrast ≥ 4.5:1 text, ≥ 3:1 UI/icons.
- Avoid thin/light weights at small sizes — poor in sunlight.

## 6. Touch targets & thumb zone
- **Apple HIG: 44×44pt minimum. Material: 48×48dp recommended. WCAG 2.2: 24px absolute floor.** Target ≥ 48px for comfort; ≥ 56px for primary CTAs.
- If an icon must look small, keep the visual size but expand the hit area: `min-width:48px;min-height:48px;display:flex;align-items:center;justify-content:center`.
- **Thumb zone** (Hoober: ~75% of use is one thumb): bottom-center is easy, top corners are hard. Put primary CTAs and nav in the lower 40–50% (this is why bottom nav and sticky CTAs win). Keep primary actions centered, not in a corner, for left-handers.
- Full-width (or near) buttons ≥ 48–56px tall convert better — easier to hit.

## 7. Forms
Properly configured forms cut input time ~30% and errors ~50%; autofill lifts conversion ~20%.
- **All inputs ≥ 16px font** — below that, iOS Safari zooms on focus and doesn't zoom back. Fix: `input,select,textarea{font-size:16px}`. Don't disable zoom to "fix" it.
- Right `type`/`inputmode`: `type="email"` (+`autocomplete="email"`), `type="tel"` for phones (NOT `number` — it strips formatting/spinners), `type="text" inputmode="decimal"` for prices/codes, `autocomplete="one-time-code"` for SMS codes.
- `autocomplete` on every applicable field (`name`, `email`, `tel`, `street-address`, …).
- One column, full-width fields ≥ 48px, labels above the field (not placeholder-as-label), inline validation. Cut fields to the minimum on mobile.

## 8. Images & media
Images are usually the heaviest payload and the main mobile-LCP culprit. Modern formats + responsive delivery cut 50–80%.
- **Format:** AVIF (best) or WebP (~97% support, −25–35% vs JPEG) with a JPEG fallback via `<picture>`.
- **Responsive:** `srcset` + `sizes` so the browser picks the right resolution. Never ship a 1920px hero to a 390px screen.
- **Dimensions:** always `width`+`height` (or `aspect-ratio`) → reserves space → zero CLS.
- **Lazy:** `loading="lazy"` for below-the-fold images; **never** on the LCP/hero (delays render). Add `decoding="async"`.
- Video: muted autoplay only, `poster`, modern codecs, no autoplay-with-sound.

## 9. Core Web Vitals (2025/2026)
Google scores mobile separately at the 75th percentile of real users; it's a ranking factor. Only ~48% of mobile pages pass all three — passing is an edge.
- **LCP ≤ 2.5s** (loading): optimize hero image/text, `fetchpriority="high"`, preload font, CDN, less render-blocking CSS.
- **INP ≤ 200ms** (responsiveness; replaced FID in 2024): break up long JS tasks, fewer third-party scripts, `content-visibility`, debounce. Heavy JS hurts INP most on cheap phones.
- **CLS ≤ 0.1** (stability): image/video dimensions, reserve space for ads/embeds, `font-display:swap`, never insert content above existing content.

## 10. Accessibility
- Respect `prefers-reduced-motion: reduce` on every animation/transition.
- No real `:hover` on touch — gate hover effects with `@media (hover:hover)` and provide a `:active` state for tap feedback.
- Keep `:focus-visible` (keyboard/switch users). `aria-expanded` on accordions, hamburgers, dropdowns. Manage focus when opening sheets/modals.
- `-webkit-tap-highlight-color` to control the default tap flash. `env(safe-area-inset-*)` + `viewport-fit=cover` for notch/gesture bar. `<html lang="…">`.
- Contrast: 4.5:1 text, 3:1 UI/icons (WCAG AA).

## 11. Verification & tooling
Measure, don't guess; lab shows potential, field shows truth, real device is the final word.
- **Chrome DevTools Device Mode** — responsiveness + network/CPU throttling (test "Slow 4G" + 4× CPU, not WiFi on a fast laptop).
- **Lighthouse** — perf/a11y/SEO/PWA/best-practices audit with fixes.
- **PageSpeed Insights** — Lighthouse + real CrUX field data (28-day, real users).
- **Search Console → Core Web Vitals** — site-wide field report, mobile separate.
- **Real device** — the only sure test of touch, gestures, keyboard, safe area. Test the form with the keyboard open.
- **Microsoft Clarity (free) / Hotjar** — heatmaps, scroll-depth, session recordings. If 80% never reach the CTA, move it up or shorten the page. Watch for "rage taps" (targets too small/close).
- **axe DevTools** — automated a11y.
- Iteration loop: measure → hypothesize → change ONE thing → A/B or re-measure. Small measured steps beat a big redesign on a hunch.

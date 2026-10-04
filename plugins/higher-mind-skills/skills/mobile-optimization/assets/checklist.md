# Mobile Pre-Launch Checklist

Quick pass before any site goes live. Pair with `scripts/mobile_audit.js` for the measured items.

## Foundations
- [ ] Viewport meta present; zoom NOT blocked
- [ ] Mobile-first CSS; no horizontal page scroll
- [ ] Full-screen sections use `dvh`, not `vh`
- [ ] `<html lang>` set; one `<h1>`; clean heading order
- [ ] Body text ≥ 16px; contrast ≥ 4.5:1

## Touch & space
- [ ] All tap targets ≥ 44–48px, ≥ 8px apart
- [ ] Primary CTA in the lower (thumb) zone; sticky CTA on long pages
- [ ] 8pt spacing; gutter 16–24px; nothing touches the edge
- [ ] Key message + CTA in the first 1–2 screens; long content collapsed (not a 10-screen scroll)

## Forms
- [ ] All inputs ≥ 16px font (no iOS zoom)
- [ ] Correct `type`/`inputmode` (tel, email, numeric…)
- [ ] `autocomplete` on every field; labels above fields
- [ ] Tested with the on-screen keyboard open (field + submit fit above it)

## Images & performance
- [ ] WebP/AVIF with fallback; `srcset`/`sizes`
- [ ] `width`+`height` (or `aspect-ratio`) on every image (no CLS)
- [ ] `loading="lazy"` below the fold; hero/LCP NOT lazy
- [ ] LCP ≤ 2.5s · INP ≤ 200ms · CLS ≤ 0.1 (tested mobile + throttling)
- [ ] Checked in PageSpeed Insights + Search Console

## App-like (where relevant)
- [ ] Every tap has <100ms feedback (`:active`)
- [ ] Content switches in place (toggles/tabs), not full reloads
- [ ] Skeletons for content loading; optimistic UI for like/save
- [ ] Feedback via toast/snackbar, not `alert()`

## Adaptation & polish
- [ ] Mega-menu → hamburger/bottom nav; wide tables → cards
- [ ] Hover → tap; multi-column → stacked by priority
- [ ] `prefers-reduced-motion` honored on all animations
- [ ] `theme-color` set; hamburger toggles `aria-expanded`
- [ ] Tested on a REAL phone (iOS + Android)

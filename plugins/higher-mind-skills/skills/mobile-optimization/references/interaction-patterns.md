# Mobile Interaction Patterns

Core mobile UX patterns with copy-paste code. Pick the pattern that fits the job; each note says when NOT to use it.

## Horizontal scroll / carousel ("swipe right")
Native mobile gesture for galleries, categories, related items, testimonials. Modern way = CSS Scroll Snap, no JS.
```css
.carousel{
  display:flex; gap:12px; overflow-x:auto;
  scroll-snap-type:x mandatory;          /* every item snaps fully into view */
  -webkit-overflow-scrolling:touch;
  overscroll-behavior-x:contain;         /* don't chain scroll to the page */
  scrollbar-width:none;
}
.carousel .slide{ flex:0 0 78%; scroll-snap-align:center; }  /* 78% = "peek" next */
```
- `mandatory` for galleries, `proximity` for loose lists. Show a peek of the next slide + dots/arrows.
- Don't hide conversion-critical content in a carousel — people rarely swipe past 1–2 items.
- Respect `prefers-reduced-motion`; add arrow-key support for keyboard.

## Accordion / expandable ("rozwijane") — progressive disclosure
For FAQ, specs, filters, long content. Use native `<details>` — zero JS, accessible, SEO-friendly (content is in the HTML, just visually collapsed).
```html
<details>
  <summary>Question <span class="chev">▾</span></summary>
  <div class="body">Answer shown when expanded…</div>
</details>
```
```css
summary{cursor:pointer; min-height:48px; list-style:none; display:flex; justify-content:space-between; align-items:center;}
summary::-webkit-details-marker{display:none;}
.chev{transition:transform .25s;} details[open] .chev{transform:rotate(180deg);}
```
- Header is the button (`<summary>`/`<button>` + `aria-expanded`), whole header tappable (≥48px), chevron on the right rotating on open.
- Don't collapse content everyone must read (price, delivery). Don't nest accordions. Don't load content on click (worse for SEO/a11y).

## Bottom sheet — panel from the bottom
Replaces top-anchored modals (which land out of thumb reach). For options, filters, quick actions, details. A form of progressive disclosure for actions.
- Visible close (X) + grab handle; scrim behind + tap-to-dismiss; Back/swipe-down also closes; slide-in 200–300ms.
- For quick actions, not long reading. Don't rely on the gesture alone.

## Sticky CTA — pinned action button
Primary CTA pinned to the bottom, always in thumb reach. On long pages / product cards gives ~8–15% fewer exits.
```css
.sticky-cta{ position:sticky; bottom:0; min-height:56px;
  padding-bottom:env(safe-area-inset-bottom); }   /* clear the iPhone gesture bar */
```
- One goal, one CTA — no feature lists in the bar. Slide it in smoothly when it becomes relevant. Use `viewport-fit=cover` so it doesn't hide under the system bar.

## Navigation — bottom nav vs hamburger
- **Bottom nav** is the modern default for 3–5 primary sections: always visible, in the thumb zone, higher engagement. Best for apps, social, e-commerce.
- **Hamburger** hides nav — fine for many/secondary options (dashboards, lots of categories) but lowers discoverability.
- **Hybrid (2025 trend):** persistent bottom nav with 4 key sections + "More"/hamburger for the rest.
- Toggle `aria-expanded` on the hamburger; keep targets ≥44px.

### Off-canvas drawer menu — easy to get wrong (audit it explicitly)
A hamburger that slides in a drawer is the most common menu, and the most commonly under-built. A drawer that "works" on desktop often fails the mobile bar. Check every item:
- **Menu items ≥ 44px tap height.** The classic miss: a sidebar with `padding:6px` and `font-size:.85rem` computes to ~30px per link — fine to read, too small to tap. On mobile bump to `min-height:44px; display:flex; align-items:center; padding:10px 16px`.
- **Safe areas.** The hamburger and the drawer header must clear the notch/Dynamic Island: `top: calc(env(safe-area-inset-top) + 12px)` and pad the drawer with `env(safe
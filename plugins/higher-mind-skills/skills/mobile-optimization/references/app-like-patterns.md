# App-Like Patterns — make a website feel like an app

The difference is *feeling*, not tech. Document-site: click → white flash → reload. App: tap → instant reaction → content changes in place. Five principles: instant feedback (<100ms), no white reloads (change content in place), motion with meaning (shows where-from-where), state preserved, content-before-data (skeleton/optimistic). The goal is *perceived performance* — never leave the user staring at a blank, unresponsive screen.

## Toggles & comparison tables ⭐ (highest-value pattern for pricing/offer pages)
One switch changes a whole table with no reload. Classic: monthly↔yearly pricing where prices and savings update instantly. Also device specs, plan compare, list/grid.
```html
<div class="seg" id="seg"><span class="pill"></span>
  <button class="on" data-mode="m">Monthly</button>
  <button data-mode="y">Yearly</button>
</div>
```
```js
const seg=document.getElementById('seg'), pill=seg.querySelector('.pill');
const move=b=>{pill.style.left=b.offsetLeft+'px'; pill.style.width=b.offsetWidth+'px';}; // animated pill
seg.querySelectorAll('button').forEach(b=>b.onclick=()=>{
  seg.querySelectorAll('button').forEach(x=>x.classList.remove('on'));
  b.classList.add('on'); move(b);
  updateTable(b.dataset.mode);        // swap data in place — no page reload
});
```
- Animated "pill" under the active option; ≤3–4 options (else dropdown/tabs); remember choice (localStorage / `?plan=y`); show the benefit on switch ("−20%").
- A11y: `role="tablist"`/`role="tab"`/`aria-selected` for content switchers; native `<input type="checkbox">` for on/off switches.
- Toggle types: **segmented control** = variants of the same thing (Monthly/Yearly, List/Grid); **iOS switch** = on/off (e.g. "show only differences" filter on a compare table); **tabs** = different categories (Description/Specs/Reviews).

## Tabs
Several "screens" in one place, no reload. Best for peer views of one object. Active state must be obvious (color + underline/pill). Scrollable tab bar if they overflow; never wrap to two rows. `role="tab"`/`aria-selected`. Don't hide the CTA in an inactive tab.

## View transitions (page/view changes that animate)
Same-document transitions are **Baseline (Oct 2025)**, all engines; cross-document (MPA) is Chrome/Edge 126+, Safari 18.2+ (not Firefox). Degrades gracefully — no support = instant swap, nothing breaks.
```js
function swap(updateDOM){
  if(!document.startViewTransition){ updateDOM(); return; }  // fallback
  document.startViewTransition(updateDOM);
}
```
```css
.product-img{ view-transition-name: hero-photo; }   /* shared element morphs between views */
@view-transition{ navigation: auto; }               /* one line enables MPA transitions */
```
Keep 200–300ms; respect `prefers-reduced-motion`.

## App shell
Header + bottom nav stay put; only the content area changes. No "whole page reloaded" feeling. Bottom nav always visible (3–5 sections, rest under "More"), state preserved per tab, shell cached for instant start (pairs with PWA + skeletons).

## Scroll-driven animations (CSS, ~85% support; Firefox behind flag → progressive enhancement)
Reading-progress bar, reveal-on-scroll, parallax — pure CSS, no JS, no scroll-jank.
```css
.progress{ position:fixed; top:0; left:0; height:3px; width:100%; transform-origin:left;
  animation:grow linear; animation-timeline:scroll(root); }
@keyframes grow{ from{transform:scaleX(0)} to{transform:scaleX(1)} }
.reveal{ animation:fadeUp linear both; animation-timeline:view(); animation-range:entry 0% cover 30%; }
```
Never hide content that only appears via the animation — it vanishes where unsupported.

## Loading states — skeletons vs spinners
Users perceive skeleton pages as ~30% faster at the same real speed. Show within 300ms.
- **Skeleton** (grey layout preview) for fetching content (feeds, lists, cards). **Spinner** for short blocking actions (save, login, pay). **Progress bar** for measurable ops (upload). **Optimistic UI** for frequent low-risk actions.
- Skeleton ≈ the real layout (same shapes) so there's no jump. `aria-busy="true"`; honor reduced-motion (drop the shimmer).

## Optimistic UI
Most "app-like" feel: tap like → it's red instantly; UI assumes success and only rolls back on error. For like/save/toggle/favorite.
```js
async function toggleLike(){
  const prev=state.liked; render(!prev);          // 1. change UI immediately
  try{ await api.setLike(!prev); }                // 2. send in background
  catch(e){ render(prev); toast('Failed — retry'); } // 3. error → revert
}
```
Low-risk only — never optimistic for payments or account deletion.

## Toast / snackbar
Non-blocking bottom message that self-dismisses; replaces `alert()` and "saved" reloads. **Toast** = info; **snackbar** = info + action ("Undo"). Bottom position, 4–6s, one at a time, ≤300ms in, `role="status"`/`aria-live="polite"`. Critical errors are NOT toasts.

## Microinteractions & haptics
Small confirmations of "it worked": button press, icon pulse, light vibration. ≤300ms, meaningful only.
```css
.btn:active{ transform:scale(.97); }   /* visual tap feedback — always */
```
```js
if(navigator.vibrate) navigator.vibrate(10);   // Android; iOS Safari ignores → degrades quietly
```

## Stories / full-screen sections
Instagram format: full-screen tiles, progress bars on top, tap right/left = next/prev. Good for onboarding, step-by-step offers — focuses attention, fights endless scroll. Short (1 idea/tile), visible exit (X).

## Swipe actions
Swipe a list row → reveals delete/archive. Always also a visible button (gesture is invisible). Color = meaning (red = delete); reveal at ~30–40%; destructive needs confirm or Undo snackbar.

## FAB & pull-to-refresh
**FAB**: floating round button for the one most-important action (compose, add, +), in thumb reach; can expand 2–4 actions. Don't make it a junk drawer; keep it above the bottom nav. **Pull-to-refresh**: drag list down to refresh — feeds only, with feedback (spinner tightens with the gesture). Neither belongs on a static brochure page.

## Native browser APIs (feature-detect + degrade)
- **Web Share** — native share sheet (`navigator.share`); mobile yes.
- **capture** — `<input type="file" accept="image/*" capture="environment">` (snap a photo, e.g. client photographs a fault).
- **Geolocation** — nearest location.
- **Payment Request** — Apple Pay / Google Pay in one tap.
- **WebAuthn / passkeys** — Face/Touch ID login.
- **Screen Wake Lock** — keep screen on (all browsers since 2025).
- **Vibration** — Android only.
- **Web Push** — Android yes; iOS 16.4+ only as installed PWA.
- **prefers-color-scheme** — auto dark mode.
```js
if(navigator.share) navigator.share({title:document.title, url:location.href});
else navigator.clipboard.writeText(location.href);   // fallback
```

## PWA — installable like an app
HTTPS + manifest + service worker → add to home screen, own icon, standalone (no browser UI), offline.
```json
{ "name":"Brand","short_name":"Brand","start_url":"/","display":"standalone",
  "background_color":"#0b0e14","theme_color":"#6c8cff",
  "icons":[{"src":"/icon-512.png","sizes":"512x512","type":"image/png"}] }
```
```js
if('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js');
// sw.js: cache the app shell, serve offline:
self.addEventListener('fetch', e => e.respondWith(caches.match(e.request).then(r => r || fetch(e.request))));
```
Android may auto-prompt (`beforeinstallprompt` → show your own button). iOS has no prompt — show a Safari-only "Add to Home Screen" hint. Audit installability in Lighthouse.

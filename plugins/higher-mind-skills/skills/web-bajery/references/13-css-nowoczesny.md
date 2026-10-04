# 13 — Nowoczesne CSS-only (2024–2026): bajery bez JS

Najtańsze, najszybsze i najtrwalsze bajery — natywny CSS/HTML, zero zależności. Format: Nazwa (English) — `szukaj` — czym — wsparcie — 📱.

> Złota zasada 2025/26: zanim sięgniesz po GSAP/JS, sprawdź czy CSS już to robi. Coraz częściej tak. Dla rzeczy "Chromium-only" dawaj fallback (progressive enhancement).

### :has() — selektor rodzica/relacyjny
- `CSS :has() parent selector`, `quantity queries` — :has(>input:checked), :has(img); quantity queries — **Baseline Widely (>95%)** — ★☆☆ — 📱✅
- Bajer: karta/sekcja reaguje na swoją zawartość bez JS.

### @property — typowane custom props (animowalny gradient/kąt)
- `@property typed custom properties`, `@property gradient animation` — @property <angle> + @keyframes — **Baseline Newly VII.2024** — ★★☆ — 📱✅
- Bajer: obracający się gradient/animowana ramka, animowane liczby — bez JS.

### @starting-style + transition-behavior — animacja z/do display:none
- `@starting-style`, `transition-behavior allow-discrete` — fade modali/toastów/popoverów bez klas .is-open — **Baseline Newly (Chrome117/FF129/Safari17.5)** — ★★☆ — 📱✅

### Popover API (atrybut popover)
- `HTML popover attribute` — <div popover>+popovertarget; top-layer+focus; anim @starting-style — **Baseline Widely IV.2025** — ★☆☆ — 📱✅
- Bajer: tooltips, dropdowny, menu bez JS i bez z-index wars.

### Anchor Positioning
- `CSS anchor positioning`, `anchor-name position-anchor` — pozycjonowanie względem kotwicy; anchor() — Chrome125+/FF147+/Safari26; fallback Floating UI — ★★☆ — 📱✅

### Natywna karuzela CSS (::scroll-button + ::scroll-marker)
- `CSS carousel scroll-marker scroll-button` — scroll-snap + ::scroll-button + ::scroll-marker + scroll-marker-group; strzałki+kropki+klawiatura — Chrome 135+ only; fallback scroll-snap — ★★☆ — 📱⚠️
- Bajer: pełna karuzela BEZ Swipera.

### Detekcja "stuck" (scroll-state container queries)
- `CSS scroll-state stuck`, `@container scroll-state sticky` — cień na sticky headerze gdy przyklejony, bez IntersectionObserver — Chrome 133+ only — ★★☆ — 📱⚠️

### Ekskluzywny accordion (<details name>)
- `details name exclusive accordion` — otwarcie jednego zamyka resztę, zero JS — Chrome120/FF130/Safari17.2 — ★☆☆ — 📱✅

### Animacja height:auto (interpolate-size / calc-size)
- `interpolate-size allow-keywords`, `calc-size height auto` — accordion z płynną wysokością bez JS; fallback grid 0fr→1fr — Chrome 129+ only — ★★☆ — 📱⚠️

### color-mix() + relative color + light-dark()
- `color-mix() oklch`, `relative color syntax`, `CSS light-dark()` — tinty/hover/dark-mode z jednego tokenu bez Sass/JS — **Baseline** — ★☆☆/★★☆ — 📱✅
- Bajer: cały system kolorów i auto dark mode bez JS i media queries.

### offset-path (Motion Path)
- `CSS offset-path motion path`, `offset-distance` — ruch po krzywej/SVG path bez GSAP — **Baseline Widely** — ★★☆ — 📱✅

### Container queries (@container) + style queries
- `CSS container queries`, `@container style()` — komponent reaguje na kontener / na wartość custom prop (warianty) — size **Baseline**; style Chrome111+/Safari18 — ★★☆ — 📱✅/⚠️

### field-sizing: content (auto-grow textarea)
- `CSS field-sizing content` — textarea rośnie z treścią bez JS — Chrome 123+ only; fallback JS scrollHeight — ★☆☆ — 📱⚠️

### sibling-index() / inline --i (stagger w CSS)
- `CSS sibling-index stagger`, `--i nth-child delay` — animation-delay: calc(80ms*sibling-index()) (Chrome137+) lub inline style="--i:n" (wszędzie) — ★★☆/★☆☆ — 📱✅ (wariant inline)

### Glassmorphism (backdrop-filter)
- `backdrop-filter glassmorphism`, `blur` — backdrop-filter: blur()+saturate() + rgba bg — szeroko (uwaga clip-path/mask bugi) — ★☆☆ — 📱✅

### text-wrap: balance / pretty
- `text-wrap balance`, `text-wrap pretty` — nagłówki bez sierot; pretty dla akapitów — balance Baseline; pretty Chrome117+/Safari26 — ★☆☆ — 📱✅

### Reveal mask / clip-path (animacja)
- `clip-path reveal animation`, `mask-image animation` — odkrywanie treści/obrazu bez JS — clip-path Baseline; -webkit-mask Safari — ★★☆ — 📱✅

### CSS scroll-driven animations (przypomnienie)
- `css animation-timeline scroll() view()` — reveal/parallax/progress bez JS — Chrome/Edge/FF; fallback IntersectionObserver/polyfill dla Safari — ★★☆ — 📱✅
- (Szczegóły także w pliku 02.)

### @scope, CSS Nesting, subgrid, <dialog>
- `CSS @scope`, `CSS nesting native`, `CSS subgrid`, `HTML dialog modal` — enkapsulacja/zagnieżdżanie/siatka/modal natywnie — **Baseline (2024)** — ★☆☆–★★☆ — 📱✅

## Trend CSS 2025/26: CSS-first interaktywność (popover/details name/anchor/@starting-style = pełna warstwa interakcji bez JS); matematyka kolorów zastępuje Sass; natywne komponenty scroll (karuzela/sticky bez JS, Chromium-first); animacje bez bibliotek (GSAP traci monopol na prostych projektach); enkapsulacja bez Shadow DOM (@scope, style queries).

## Frazy: anchor positioning inset-area 2026; ::details-content accordion animation; view-timeline named ranges; @layer cascade layers; CSS masonry native 2026; accent-color form styling; conic-gradient progress ring no JS.

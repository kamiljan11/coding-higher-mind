# 11 — App-like web (strony jak natywne apki)

Wzorce, które sprawiają, że strona "czuje się jak aplikacja". Idą w parze ze skillem `mobile-optimization`. Format zwarty: Nazwa PL (English) — `szukaj` — czym — trudność — 📱.

> Najważniejsze 2025/26: natywny HTML/JS przejął wiele "bajerów" (dialog, popover, view transitions, anchor positioning, inert) — sięgaj po nie zanim dołożysz bibliotekę.

### Paleta komend (Command Palette / ⌘K)
- `command palette web`, `cmdk react`, `kbar` — cmdk (shadcn/ui) / kbar — ★★☆ — 📱⚠️ (na mobile przycisk/search zamiast skrótu)
- Co to: nakładkowe okno akcji ⌘K/Ctrl+K (Linear, Vercel, Figma). Gdzie: SaaS, dashboardy, power-tools.

### Arkusz dolny (Bottom Sheet)
- `bottom sheet web`, `vaul drawer react` — Vaul / CSS scroll-snap+overscroll-behavior:contain / <dialog>+Popover — ★★☆ — 📱✅ (natywny wzorzec; desktop→modal)
- Co to: panel wysuwany od dołu jak iOS/Android action sheet. Gdzie: filtry, akcje, mini-formularze.

### Optymistyczny UI (Optimistic UI)
- `optimistic UI`, `useOptimistic React 19`, `TanStack Query optimistic` — React 19 useOptimistic / TanStack Query onMutate+onError / SWR — ★★☆ — 📱✅
- Co to: UI aktualizuje się natychmiast, rollback przy błędzie. Gdzie: lajki, koszyk, toggle, komentarze.

### Pull to Refresh
- `pull to refresh web`, `overscroll-behavior-y` — touch + scrollTop===0 + overscroll-behavior-y:contain — ★★☆ — 📱✅ tylko mobile (desktop→przycisk)

### Wirtualizacja listy (List Virtualization / Windowing)
- `list virtualization react`, `tanstack virtual`, `react-window` — TanStack Virtual v3 / react-window — ★★☆ — 📱✅ krytyczne (RAM)
- Co to: render w DOM tylko widocznych wierszy. Gdzie: tabele tysięcy wierszy, feedy, autocomplete.

### Infinite Scroll
- `infinite scroll IntersectionObserver`, `useInfiniteQuery` — IntersectionObserver na sentinel + TanStack Query; łącz z wirtualizacją — ★☆☆ — 📱✅ (rozważ "Load more" dla a11y)

### Swipe Actions
- `swipe to delete web`, `react-swipeable`, `use-gesture` — react-swipeable / @use-gesture/react / PointerEvents+touchAction:none — ★★☆ — 📱✅ tylko mobile (desktop→hover/kebab)

### Long Press
- `long press gesture web`, `use-long-press` — use-long-press / setTimeout na pointerdown — ★★☆ — 📱✅ (desktop→prawy klik)

### Master-Detail / Multi-Pane
- `master detail layout responsive` — CSS Grid + container queries + nested routes — ★★☆ — 📱✅ jeden panel full-width
- Co to: lista + szczegóły; mobile jeden panel. Gdzie: email, settings, CRM.

### Skróty klawiaturowe + focus (Keyboard Shortcuts + Focus Management)
- `keyboard shortcuts web app`, `roving tabindex`, `focus-trap`, `inert attribute` — tinykeys (<400B) / hotkeys-js / focus-trap / natywny inert — ★★☆ — 📱⚠️ (brak klawiatury→gesty)

### Live Cursors / Presence (real-time)
- `live cursors web`, `liveblocks cursors`, `partykit` — Liveblocks / PartyKit (edge WS) / Yjs+WS — ★★★ — 📱⚠️ (ghost dot)
- Co to: kursory/zaznaczenia innych userów na żywo. Gdzie: edytory, whiteboard, review.

### Local-First / offline sync
- `local-first web`, `CRDTs browser`, `ElectricSQL PowerSync` — Yjs / Automerge 3 / PowerSync / TanStack DB — ★★★ — 📱✅ (kluczowy dla PWA)
- Co to: dane lokalnie, sync w tle, pełne offline.

### Streaming / Generative UI
- `generative UI streaming`, `Vercel AI SDK streamUI` — Vercel AI SDK (streamUI/streamObject) + RSC — ★★★ — 📱✅
- Co to: UI materializuje się progresywnie z LLM. Gdzie: AI chat/asystenci/search.

### PWA install + App Shell
- `beforeinstallprompt`, `app shell architecture`, `Workbox` — beforeinstallprompt + manifest screenshots; Workbox; vite-plugin-pwa — ★★☆ — 📱✅ (iOS: Add to Home Screen)

### App Badging API
- `App Badging API`, `navigator.setAppBadge` — setAppBadge(n)/clearAppBadge(), bez permission — ★☆☆ — 📱⚠️ (Android pokazuje z notyfikacji)

### Web Share + Share Target
- `navigator.share`, `Web Share Target manifest` — navigator.share({...}) (gesture); share_target w manifest+SW — ★☆☆/★★☆ — 📱✅ głównie mobile

### Contact Picker API
- `Contact Picker API`, `navigator.contacts.select` — navigator.contacts.select(...) Android Chrome, HTTPS+gesture — ★☆☆ — 📱✅ tylko Android

### Wake Lock (Screen Wake Lock API)
- `Screen Wake Lock API`, `navigator.wakeLock.request` — wakeLock.request('screen')+release(); Baseline III.2025 — ★☆☆ — 📱✅
- Gdzie: nawigacja, przepisy, prezentacje, wideo.

### Popover + Anchor Positioning (natywne)
- `Popover API`, `CSS anchor positioning` — <div popover>+popovertarget; position-anchor/anchor() — ★☆☆/★★☆ — 📱✅
- Gdzie: tooltips, dropdowny, menu, date pickery. (Więcej CSS-only → plik 13.)

### Drag & Drop + File Drop
- `dnd-kit`, `File System Access API drag drop` — dnd-kit (lider, touch+a11y); file: dataTransfer.items+getAsFileSystemHandle() — ★★☆ — 📱⚠️ (file drop niedostępny)

### View Transitions (shared element)
- `View Transitions API`, `view-transition-name`, `cross-document` — startViewTransition(); @view-transition{navigation:auto} — ★★☆ — 📱✅ GPU
- Gdzie: nawigacja, lista→detal, galerie. (Też w pliku 07.)

### Natywny dialog (<dialog>)
- `HTML dialog element`, `dialog showModal` — <dialog>+showModal(); ::backdrop; @starting-style — ★☆☆ — 📱✅

### Offline UX / Service Worker
- `Workbox caching strategies`, `offline page service worker` — Workbox / vite-plugin-pwa; /offline.html; IndexedDB — ★★☆ — 📱✅ krytyczne

### Bottom Navigation / Tab Bar
- `bottom navigation web`, `tab bar mobile web` — position:fixed;bottom:0 + safe-area-inset-bottom; aria-current — ★☆☆ — 📱✅ (desktop→sidebar)

### Przełącznik języka z flagami (Flag language switcher)
- `language switcher flags`, `country flag select` — inline SVG flagi (flag-icons / circle-flags) zamiast tekstu PL/EN/IS — ★☆☆ — 📱✅
- Co to: flagi zamiast napisów w przełączniku języka. Uwaga UX: flaga = kraj, nie język (PL↔polski ok; EN→którą flagę? rozważ flaga+kod "EN"). Daj `aria-label` z nazwą języka.

## Biblioteki: cmdk, kbar, Vaul, dnd-kit, TanStack Virtual, TanStack Query, Liveblocks, PartyKit, Yjs, Automerge 3, PowerSync, Workbox, vite-plugin-pwa, Vercel AI SDK, tinykeys, focus-trap, use-gesture, react-swipeable, flag-icons/circle-flags.

## Trend: AI jako rdzeń UI; local-first mainstream; natywny HTML zastępuje JS; ⌘K jako standard; gesty first-class na mobile.

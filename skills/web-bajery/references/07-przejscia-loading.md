# 07 — Przejścia stron i ładowanie (Transitions & loading)

Co użytkownik widzi między stanami: wejście na stronę, przejście między podstronami, czekanie na dane. Dobre przejścia = wrażenie "aplikacji", nie "klikania w linki".

> Uwaga na perf: preloader nie może sztucznie opóźniać LCP. Pokazuj treść szybko; przejścia mają maskować realny czas, nie dodawać go.

---

### Preloader / ekran ładowania (Preloader / loading screen)
- Co to: ekran startowy z logo i licznikiem % / paskiem, znika gdy strona gotowa.
- Szukaj: `preloader animation`, `loading screen percentage`, `intro loader`
- Czym zrobić: overlay `position:fixed` + animacja licznika (GSAP/JS), `fade/slide out` po `window.load`. Często łączony z intro hero.
- Trudność: ★★☆
- Gdzie: portfolio, premium, ciężkie strony (3D/wideo).
- 📱 Mobile: ⚠️ (krótki! max ~1-1.5s; nie blokuj treści sztucznie)

### Przejście strony — kurtyna/wipe (Page transition)
- Co to: przy zmianie podstrony panel zasuwa ekran i odsłania nową stronę (wipe, slide, kółko, pasy).
- Szukaj: `page transition effect`, `curtain page transition`, `wipe transition`
- Czym zrobić: **View Transitions API** (najnowocześniej, niżej), **Barba.js** (klasyk SPA-feel) + GSAP, albo overlay animowany między nawigacjami.
- Trudność: ★★☆
- Gdzie: portfolio, strony "appkowe", wielostronowe premium.
- 📱 Mobile: ✅ (lekkie wipe/fade działają dobrze)

### View Transitions API (View Transitions API)
- Co to: natywne, gładkie przejścia między stanami DOM **i między stronami** (MPA) — w tym "shared element" (element płynnie przelatuje ze starej do nowej strony).
- Szukaj: `view transitions api`, `cross-document view transitions`, `@view-transition`
- Czym zrobić: CSS `@view-transition { navigation: auto }` + `view-transition-name` na wspólnych elementach. Same-document = Baseline od X.2025; cross-document w Chrome/Edge/Safari 18.2+ (Firefox jeszcze nie — dawaj fallback).
- Trudność: ★★☆
- Gdzie: galerie→detal, lista→produkt, nowoczesne MPA.
- 📱 Mobile: ✅ (działa świetnie, "natywny" feel; brak wsparcia = po prostu zwykła zmiana)

### Intro reveal strony (Page load reveal / staggered intro)
- Co to: po wejściu elementy hero wjeżdżają po kolei (stagger), zasłony odsłaniają sekcje.
- Szukaj: `page load animation`, `staggered intro animation`, `reveal on load`
- Czym zrobić: GSAP timeline na `load` (stagger), albo CSS `@keyframes` z `animation-delay`. + scroll-driven dla reszty.
- Trudność: ★★☆
- Gdzie: hero każdej dobrej strony (oszczędnie).
- 📱 Mobile: ✅ (krótki, nie ukrywaj treści > 0.6s)

### Logo → nawigacja (Intro morph / logo to nav)
- Co to: na wejściu duże logo na środku, które kurczy się i "przechodzi" w logo w navbarze (trend 2026 "motion identity").
- Szukaj: `logo intro animation`, `logo to navbar transition`, `motion identity intro`
- Czym zrobić: GSAP Flip (darmowy) — animuje element między dwoma pozycjami/rozmiarami.
- Trudność: ★★★
- Gdzie: marki, agencje, premium.
- 📱 Mobile: ⚠️ (uprość — sam fade logo)

### Shared element / FLIP (Shared element transition / FLIP)
- Co to: element (zdjęcie, karta) płynnie "rośnie" z miniatury w pełny widok, zachowując ciągłość.
- Szukaj: `FLIP animation`, `shared element transition`, `GSAP Flip`
- Czym zrobić: **GSAP Flip** albo View Transitions (`view-transition-name`). W React: Framer Motion `layoutId`.
- Trudność: ★★★
- Gdzie: galeria→lightbox, lista→detal, dashboardy.
- 📱 Mobile: ✅

### Skeleton screens (Skeleton loading)
- Co to: zamiast spinnera — szary zarys układu treści, który "świeci" (shimmer), póki dane lecą.
- Szukaj: `skeleton screen`, `skeleton loader`, `content placeholder shimmer`
- Czym zrobić: szare bloki w kształcie treści + animowany gradient (shimmer) CSS.
- Trudność: ★☆☆
- Gdzie: dashboardy, feedy, sklepy, cokolwiek z ładowaniem danych.
- 📱 Mobile: ✅ (lepsze niż spinner — postrzegane jako szybsze)

### Blur-up / progresywne zdjęcia (Image blur-up / LQIP)
- Co to: najpierw maleńka rozmyta wersja zdjęcia, potem ostra — zero "skoku" layoutu.
- Szukaj: `image blur up`, `LQIP lazy load`, `progressive image loading`, `blurhash`
- Czym zrobić: malutki placeholder (base64/BlurHash) → zamiana na pełne `loading="lazy"`. Next/Nuxt mają to wbudowane.
- Trudność: ★★☆
- Gdzie: galerie, blog, sklep, hero.
- 📱 Mobile: ✅ (świetne dla wolnych sieci; pilnuj LCP hero)

### Spinner (Spinner / loader)
- Co to: kręcące się kółko/kropki na krótkie akcje.
- Szukaj: `css spinner`, `loading spinner`, `button loading state`
- Czym zrobić: CSS `@keyframes rotate`. Gotowce: loading.io, SpinKit.
- Trudność: ★☆☆
- Gdzie: przyciski w trakcie akcji, krótkie ładowania (<1s). Dłuższe → skeleton.
- 📱 Mobile: ✅

### Odsłona panelami (Reveal panels / shutter)
- Co to: kolorowe panele zsuwają się/rozjeżdżają odsłaniając stronę (często w przejściach).
- Szukaj: `panel reveal transition`, `shutter reveal`, `sliding panels intro`
- Czym zrobić: kilka `div`-paneli animowanych `transform` (GSAP stagger).
- Trudność: ★★☆
- Gdzie: intro, przejścia, portfolio.
- 📱 Mobile: ✅ (krótkie)

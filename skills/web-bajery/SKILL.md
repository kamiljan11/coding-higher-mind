---
name: web-bajery
description: 'Encyklopedia ~230 efektow webowych ("bajerow"): nazwany katalog z fraza do googlowania, biblioteka i tagiem mobile dla kazdego. Uzyj, gdy uzytkownik buduje/poprawia strone i chce dodac efekt, ruch, animacje albo "wow", lub nie wie jak dany efekt sie nazywa. Pokrywa: tekst, scroll/parallax, kursor/hover, tla i gradienty/SVG, slidery i hero slideshow, przelaczniki, micro-interakcje (glow CTA, pulse, floating), przejscia/preloadery, 3D/WebGL, shadery, app-like (Cmd+K, bottom sheet, PWA, streaming UI), nowosci CSS-only i trendy 2026 (Liquid Glass, bento, AR, voice). Laczy sie z mobile-optimization. Triggery: bajer, efekt, jaki efekt, animacja, jak to sie nazywa, marquee, parallax, custom cursor, hover, slider, hero slideshow, toggle, animated gradient, SVG background, particles, page transition, glow button, WebGL, shader, command palette, PWA, generative UI, Liquid Glass, scroll-driven, flagi jezyka. NIE: audyt mobile, pelna budowa strony.'
---

# Web Bajery — encyklopedia efektów webowych

Nazwany katalog wow-efektów do stron. Każdy efekt ma: **jak się nazywa po angielsku** (żeby dało się googlować), **czym go zrobić**, **trudność**, **gdzie pasuje** i **tag mobile**. Cel: zamienić "wiem że taki efekt istnieje, ale nie wiem jak go szukać" w "wiem nazwę, wiem bibliotekę, wklejam i działa".

## Co to jest "bajer" (szeroka definicja)

**Bajer = każdy świadomy zabieg wizualny, ruchowy albo interaktywny, który podnosi wrażenie ("wow"), prowadzi uwagę użytkownika albo dodaje stronie "życia".**

To nie tylko animacje. Bajer to wszystko z tych ośmiu rodzin:

1. **Tekst** — typografia która się rusza, składa, zmienia, świeci → `references/01-tekst.md`
2. **Scroll** — co się dzieje gdy przewijasz: parallax, reveal, pinning, poziomy scroll → `references/02-scroll-parallax.md`
3. **Kursor / hover / reakcja na myszkę** — custom cursor, magnetyczne, distortion, tilt → `references/03-kursor-hover.md`
4. **Tła sekcji** — animowane gradienty, SVG, particles, interaktywne SVG, mesh, aurora → `references/04-tla-svg.md`
5. **Slidery / karuzele / hero / przełączniki** — w tym przemieniające się slajdy w hero → `references/05-slidery-przelaczniki.md`
6. **Micro-interakcje** — glowing CTA, pulse, floating/fruwające obrazki, confetti, ripple → `references/06-microinteractions.md`
7. **Przejścia i ładowanie** — page transitions, preloadery, View Transitions, reveal → `references/07-przejscia-loading.md`
8. **3D / WebGL / generatywne** — Three.js, Spline, shadery, particle morph → `references/08-3d-webgl.md`

Plus dwa pliki-narzędziownie:
- **`references/09-biblioteki-toolbox.md`** — co która biblioteka robi, CDN, kiedy użyć, ile waży.
- **`references/10-inspiracje-zrodla.md`** — gdzie podglądać i znajdować nowe bajery samemu (Awwwards, Codrops, Godly...).

### v2 — rozszerzenie z multi-agent researchu (pliki 11–15)

Dogłębny research na 7 kątów (app-like, interaktywność, generative/WebGL, craft agencyjny, CSS-only, motion, emerging/AI) dorzucił pięć plików. Surowe, pełne findings (więcej niż tu) leżą w Obsidianie: `~/.claude/memory\Web Bajery Research\` (notatki 01–07 + _INDEX).

- **`references/11-app-like.md`** — strony jak natywne apki: ⌘K command palette, bottom sheet (Vaul), optimistic UI, pull-to-refresh, swipe actions, wirtualizacja, live cursors, local-first, streaming/generative UI, PWA (install/badge/share/wake lock), <dialog>, bottom nav, **flagi w przełączniku języka**.
- **`references/12-interaktywnosc-delight.md`** — zabawa: physics hero/ragdoll (Matter.js/rapier), Konami, mini-gry, audio-reactive, infinite canvas (tldraw), interaktywne 404, zdrapka, koło fortuny, cursor chat, sticker peel, scrollytelling, sound design.
- **`references/13-css-nowoczesny.md`** — bajery BEZ JS (2024–26): :has(), @property, @starting-style, Popover API, anchor positioning, natywna karuzela CSS, <details name>, color-mix/light-dark, offset-path, container queries, glassmorphism, scroll-driven.
- **`references/14-webgl-generative-craft.md`** — premium tier: shadery GLSL, mesh gradient, fluid sim, GPGPU/raymarching, dithering/halftone/CRT, post-processing + systemy agencyjne (Barba, Lenis+ScrollTrigger, infinite draggable grid, velocity marquee, GSAP→shader, SVG mask transitions).
- **`references/15-motion-emerging-ai.md`** — rzemiosło ruchu (spring vs easing, stagger, layoutId, Rive/Lottie state machines, icon morph, haptics, reduced-motion) + AI-era/immersive (streaming UI, Liquid Glass, bento 2.0, AR/WebXR, voice UI z falą, neobrutalizm, variable fonts, trendy 2026).

Łącznie skill pokrywa **~230 nazwanych bajerów**. Gdy budujesz, zacznij od decyzji w sekcji „Jak dobrać efekt", potem wejdź w odpowiedni plik.

## Jak czytać każdy wpis (format)

Każdy efekt w reference'ach ma ten sam układ — opisy po polsku, **nazwy i frazy do szukania po angielsku** (bo tak się googluje):

```
### Nazwa po polsku (English name)
- Co to: jedno zdanie o co chodzi
- Szukaj: `english search term`, `alt term`     ← wpisz w Google/YouTube/CodePen
- Czym zrobić: CSS / GSAP / nazwa biblioteki
- Trudność: ★☆☆ (CSS) → ★★★ (WebGL/shader)
- Gdzie: hero / sekcja / nav / CTA / cała strona
- 📱 Mobile: ✅ działa / ⚠️ zredukuj / ❌ tylko desktop (+ co dać zamiast)
```

## Jak dobrać efekt (decyzja, nie losowanie)

Nie sypać bajerami na oślep. Pytania w kolejności:

1. **Jaki cel ma sekcja?** Hero = jedno mocne wrażenie + czytelne CTA. Sekcja dowodów (logo/opinie) = ruch budujący zaufanie (marquee). Oferta = klikalność (hover, toggle). Stopka = spokój.
2. **Jeden bohater na ekran.** Maks jeden "duży" bajer na widok (hero ALBO tło ALBO kursor — nie wszystko naraz). Reszta to drobne micro-interakcje.
3. **Czy efekt prowadzi uwagę, czy ją kradnie?** Jeśli odciąga od CTA/treści — wyrzuć.
4. **Budżet wydajności.** Każdy WebGL/particles/custom-cursor kosztuje. Na proste strony → CSS-only. Premium/portfolio → można WebGL.
5. **Marka.** Neubrutalism i glitch pasują do odważnych marek; spokojny fade/parallax do premium/usługowych (jak strony, które robisz w agency-site).

## Desktop vs Mobile — i jak to gra z mobile-optimization

To są **dwa osobne, uzupełniające się skille**:

- **`web-bajery` (ten)** = *jaki efekt* dodać i *czym* go zrobić. Desktop-first, bo większość wow-efektów żyje na dużym ekranie z myszką.
- **`mobile-optimization`** = *jak* strona ma działać i czuć się na telefonie (audyt, Core Web Vitals, touch targety, wzorce app-like). To jest autorytet od mobile.

**Reguła pomostu — zanim odpalisz ciężki bajer, sprawdź tag 📱:**

| Tag | Znaczenie | Co robić |
|-----|-----------|----------|
| ✅ | działa na telefonie tak samo | nic, leci |
| ⚠️ | działa, ale kosztuje / męczy | zredukuj (mniej cząstek, krótszy ruch, prostszy wariant) |
| ❌ | nie na telefon (myszka/perf) | wyłącz i daj statyczny fallback |

**Trzy żelazne zasady mobilne dla KAŻDEGO bajera** (szczegóły → skill `mobile-optimization`):

1. **`prefers-reduced-motion`** — zawsze owijaj animacje; część ludzi ma to włączone i mocny ruch = mdłości.
   ```css
   @media (prefers-reduced-motion: reduce) {
     *, *::before, *::after { animation: none !important; transition: none !important; }
   }
   ```
2. **Efekty na myszkę (cursor, magnetic, tilt, distortion-hover) NIE istnieją na touchu** — telefon nie ma hovera. Zawsze daj wariant bez nich (`@media (hover: hover)` żeby włączać tylko gdy jest myszka).
3. **WebGL / particles / parallax na mobile = zabójca baterii i FPS.** Domyślnie redukuj albo wyłączaj poniżej 768px. Po wzorce wydajnościowe → `mobile-optimization`.

## Toolbox w pigułce (pełne w `references/09`)

| Biblioteka | Do czego | Waga | Status 2026 |
|-----------|----------|------|-------------|
| **GSAP** (+ScrollTrigger, SplitText, Flip, MorphSVG) | wszystko: timeline, scroll, tekst, morph SVG | ~50KB | **100% darmowy od IV.2025, łącznie z premium pluginami** |
| **Lenis** | smooth scroll (baza pod prawie każdy scroll-efekt) | ~3KB | standard |
| **Motion** (dawniej Framer Motion) | deklaratywne animacje, gesty, scroll (React + vanilla) | ~18KB | aktywny, motion.dev |
| **anime.js v4** | lekkie CSS/SVG/timeline | ~10KB | v4 od IV.2025 |
| **Swiper** | slidery/karuzele/hero slideshow, mnóstwo efektów | ~40KB | standard touch |
| **Embla** | minimalna karuzela z pełną kontrolą (silnik shadcn/ui) | ~4KB | rośnie |
| **Three.js** | 3D/WebGL od zera | ~150KB | standard 3D |
| **Spline** | 3D bez kodu (embed) | embed | popularny |
| **tsParticles** | particles, confetti, fireworks, tła | modularny | następca particles.js |
| **Vanta.js** 
# 09 — Toolbox bibliotek (co, kiedy, ile waży, CDN)

Ściąga "czym to zrobić". Zasada doboru: **najpierw CSS-only, dokładaj bibliotekę dopiero gdy CSS nie wystarcza** (timeline, sync ze scrollem, fizyka, WebGL). Mniej zależności = szybsza strona.

---

## Animacja — rdzeń

### GSAP (GreenSock) — KRÓL
- Do czego: wszystko — timeline, scroll (ScrollTrigger), tekst (SplitText, ScrambleText), morph SVG (MorphSVG), rysowanie (DrawSVG), FLIP (Flip), inercja (Inertia), ruch po ścieżce (MotionPath).
- Kiedy: gdy potrzebujesz kontroli, sekwencji, scroll-sync. Domyślny wybór do "poważnych" bajerów.
- Waga: rdzeń ~50KB; pluginy dokładają.
- **Status 2025/2026: 100% DARMOWY, łącznie z premium pluginami** (Webflow zwolnił po przejęciu GreenSock). To zmienia grę — SplitText/MorphSVG/DrawSVG za 0 zł komercyjnie.
- CDN: `cdnjs.cloudflare.com/ajax/libs/gsap/3.x/gsap.min.js` (+ osobno pluginy).

### Lenis — smooth scroll
- Do czego: maślany scroll = fundament pod parallax/reveal/pinning.
- Kiedy: prawie każda "premium" strona desktop.
- Waga: ~3KB.
- CDN: `unpkg.com/@studio-freight/lenis` (lub `lenis`).
- Mobile: zwykle zostaw natywny scroll.

### Motion (dawniej Framer Motion)
- Do czego: deklaratywne animacje, gesty, layout/shared-element (`layoutId`), scroll. Vanilla + React + Vue.
- Kiedy: projekty React/Next (stack uzytkownika), płynne animacje UI.
- Waga: ~18KB (vanilla mniej).
- Strona: motion.dev.

### anime.js v4
- Do czego: lekkie animacje CSS/SVG/DOM/obiektów, timeline, stagger.
- Kiedy: chcesz lekko, bez ciężaru GSAP, proste-średnie sekwencje.
- Waga: ~10KB. (v4 od IV.2025.)
- CDN: `cdnjs.cloudflare.com/ajax/libs/animejs`.

### Web Animations API (WAAPI) — natywne
- Do czego: `element.animate()` w czystym JS, bez biblioteki.
- Kiedy: proste animacje, gdy nie chcesz zależności.
- Waga: 0 (wbudowane w przeglądarkę).

---

## Scroll

| Lib | Do czego | Waga |
|-----|----------|------|
| **GSAP ScrollTrigger** | reveal, pin, parallax, scrub, horizontal scroll | plugin GSAP |
| **Lenis** | smooth scroll (baza) | ~3KB |
| **Locomotive Scroll** | smooth scroll + data-atrybuty (starsza alternatywa) | ~? |
| **AOS** (Animate On Scroll) | proste reveal przez `data-aos` | ~14KB |
| **ScrollReveal** | reveal konfigurowalny JS | ~17KB |
| **Rellax.js** | lekki parallax | ~2KB |
| **Scrollama** | scrollytelling (kroki danych) | mały |
| **CSS scroll-driven** | `animation-timeline: scroll()/view()` — reveal/progress bez JS | 0KB |

---

## Slidery / karuzele

| Lib | Do czego | Waga |
|-----|----------|------|
| **Swiper** | najbogatszy: efekty (fade/coverflow/cards), autoplay, thumbs, touch | ~40KB |
| **Embla** | minimalny silnik, pełna kontrola (używa go shadcn/ui) | ~4KB |
| **Keen Slider** | lekki, touch, bez narzuconych stylów | ~7KB |
| **Flickity** | drag z inercją, "flick" | ~25KB |
| **Splide** | lekka alternatywa Swipera | ~29KB |
| **img-comparison-slider** | before/after (web component) | mały |
| **GLightbox / PhotoSwipe** | lightbox galerii (PhotoSwipe = mobile-first, pinch) | mały/śr. |
| natywne **CSS scroll-snap** | prosty slider bez JS | 0KB |

---

## Tła / particles / gradienty

| Lib / narzędzie | Do czego | Uwaga |
|-----------------|----------|-------|
| **tsParticles** | particles, confetti, fireworks, sieci kropek | modularny; następca particles.js |
| **Vanta.js** | animowane tła 3D (waves/net/fog/birds/globe) w kilku liniach | potrzebuje Three.js lub p5 |
| **Whatamesh** | animowany mesh gradient à la Stripe | open-source |
| **Granim.js** | animowane gradienty na canvas | — |
| **canvas-confetti** | confetti jedną funkcją | ~? mały |
| **MagicPattern / fffuel / Haikei / getwaves.io** | generatory SVG (mesh, blob, fale, noise) | eksport SVG/PNG/CSS — statyczne, najlżejsze |
| **heropatterns.com** | powtarzalne wzory SVG | tło CSS |

---

## 3D / WebGL

| Lib | Do czego | Waga |
|-----|----------|------|
| **Three.js** | pełne 3D/WebGL | ~150KB |
| **React Three Fiber (R3F)** | Three.js jako komponenty React (modularne "dorabianie" 3D) | + Three |
| **@react-three/drei** | gotowce do R3F (`Float`, `Environment`, `OrbitControls`, `MeshDistortMaterial`) | — |
| **@react-three/rapier** | fizyka w R3F (grawitacja, kolizje) | — |
| **Spline** | 3D bez kodu, embed `<spline-viewer>` | scena bywa ciężka |
| **`<model-viewer>`** (Google) | wrzuć GLB, obracaj, AR na telefonie | web component |
| **cobe** | malutki interaktywny globus | bardzo lekki |
| **Curtains.js** | obrazy/wideo jako płótna WebGL (distortion) | ~120KB region |

---

## Ikony

| Set | Charakter |
|-----|-----------|
| **Lucide** | czyste, lekkie, ultra-popularne (fork Feather) |
| **Phosphor** | 6 wag (thin→fill), elastyczne |
| **Tabler** | 2900+ outline, spójne |
| **Heroicons** | od twórców Tailwind (outline + solid) |
| **Iconoir / Remix Icon** | darmowe, bogate |
| **Lordicon** | gotowe ANIMOWANE ikony |
| **Lottie** | animacje z After Effects (`lottie-web` / `dotlottie`) |
| **Rive** | interaktywne animacje ze state machine (GPU) |

> Zasada: jeden set na projekt. Inline SVG + `currentColor`. **Nie emoji jako ikony UI.** (Patrz `06`, sekcja E.)

---

## Inne przydatne

| Lib | Do czego |
|-----|----------|
| **Lottie** | bogate animacje wektorowe (ikony, ilustracje, sukcesy) |
| **Rive** | interaktywne, stanowe animacje (lżejsze i sterowalne niż Lottie) |
| **vanilla-tilt.js** | tilt 3D kart na hover |
| **Typed.js** | typewriter |
| **CountUp.js / Odometer** | liczniki |
| **noUiSlider** | suwaki zakresu (filtry, kalkulatory) |
| **Barba.js** | przejścia między stronami (SPA-feel) |
| **Toastify** | toasty/snackbary |
| **SVGOMG** | optymalizacja SVG (narzędzie, nie lib) |

---

## Decyzja w 10 sekund

1. Da się **czystym CSS**? (gradient, marquee, reveal scroll-driven, glow, pulse, float, hover, accordion) → rób CSS.
2. Trzeba **scroll-sync / timeline / tekst per-litera**? → GSAP (+ Lenis).
3. **Slider** → Swiper (bogaty) / Embla (lekki).
4. **Tło wow bez wysiłku** → generator SVG (statyczne) albo Vanta/tsParticles (animowane, pilnuj perf).
5. **3D** → model-viewer (najprościej) / Spline (no-code) / R3F (React, modularne).
6. **React/Next** UI motion → Motion (motion.dev).
7. Zawsze: `prefers-reduced-motion`, `@media (hover: hover)`, animuj `transform`/`opacity`.

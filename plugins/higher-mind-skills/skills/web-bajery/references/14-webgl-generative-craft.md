# 14 — WebGL, shadery, generative + craft agencyjny (high-end)

Najcięższa półka: efekty GPU i systemy produkcyjne nagradzanych studiów (Awwwards/FWA). Format: Nazwa (English) — `szukaj` — czym — trudność — 📱.

> Reguła: to "premium tier". Na strony usługowe zwykle za dużo — używaj na portfolio/marki premium, zawsze z fallbackiem i `prefers-reduced-motion`. Większość mobile ⚠️/❌ (perf, bateria).

## A) Shadery / generative / WebGL

### Shadery fragmentów GLSL (GLSL fragment shaders)
- `GLSL fragment shader web`, `ShaderMaterial` — Three.js ShaderMaterial / OGL / VFX-JS — ★★★ — 📱⚠️

### Shader / mesh gradient (animowany w GPU)
- `mesh gradient shader WebGL`, `@paper-design/shaders` — @paper-design/shaders (30+ presetów, ~8KB) / własny GLSL — ★☆☆–★★★ — 📱✅ (paper-design)
- Lżejsza, "żywa" alternatywa dla wideo w tle.

### Symulacja cieczy GPU (WebGL fluid simulation)
- `webgl-fluid-simulation`, `WebGL-Fluid-Enhanced` — WebGL-Fluid-Enhanced (MIT) — ★★☆ — 📱⚠️
- Atrament/kolor rozlewa się pod kursorem.

### GPGPU / FBO particles
- `GPGPU particles three.js`, `FBO particles`, `useFBO` — Three.js GPUComputationRenderer / R3F drei useFBO — ★★★ — 📱❌

### Raymarching / SDF
- `raymarching SDF WebGL`, `three-raymarcher` — three-raymarcher / GLSL fullscreen quad — ★★★ — 📱❌ (video fallback)

### Metaballe (metaballs)
- `metaballs GLSL`, `gooey metaballs shader` — Three.js+GLSL / 2D fallback: SVG feGaussianBlur+feColorMatrix (CSS-only!) — ★★☆ — 📱⚠️

### Flow field / curl noise particles
- `curl noise particles three.js`, `flow field WebGL` — Three.js+GPGPU+curl noise — ★★★ — 📱❌

### ASCII render
- `ASCII effect three.js`, `AsciiEffect` — Three.js AsciiEffect / Codrops "Efecto" (shader) — ★★☆ — 📱✅ (shader-based)

### Dithering Bayer / retro
- `Bayer dithering WebGL`, `ditherwave` — ditherwave (React <8KB) — ★★☆ — 📱✅ (<0.2ms 4K)
- Estetyka e-ink/8-bit; modne 2025/26.

### Halftone / dot-screen
- `halftone shader`, `HalftonePass three.js` — Three.js HalftonePass / r3f-postprocessing / paper-design — ★☆☆–★★☆ — 📱✅

### CRT / scanlines
- `CRT scanlines shader`, `crt-fx webgl` — stefanlegg/crt-fx / GLSL — ★★☆ — 📱✅ (wyłącz barrel distortion)

### Aberracja chromatyczna / RGB shift
- `chromatic aberration shader`, `RGB shift three.js` — @react-three/postprocessing ChromaticAberration — ★☆☆–★★☆ — 📱✅

### Post-processing (bloom / DOF / godrays)
- `react-three postprocessing bloom DOF`, `EffectComposer` — @react-three/postprocessing (Bloom/DepthOfField/GodRays/Vignette/Noise) — ★★☆ — 📱⚠️ (1-2 efekty)

### Displacement / warp
- `displacement map shader`, `fractal glass distortion` — Three ShaderMaterial / Pixi DisplacementFilter / VFX-JS — ★★☆ — 📱✅

### Point cloud / scatter
- `point cloud three.js`, `PointsMaterial` — Three.js Points+PointsMaterial — ★★☆ — 📱⚠️ (<50k)

### Particle morph / image→particles (deep)
- `particle morph GPGPU`, `image to particles shader` — Three.js GPGPU ping-pong + GLSL lerp — ★★★ — 📱❌

### Reaction-diffusion, kaleidoscope, pixel sorting, noise fields, godrays, VFX-JS na DOM
- `reaction diffusion gray scott`, `kaleidoscope shader`, `pixel sorting canvas`, `simplex noise GLSL`, `god rays pmndrs`, `vfx-js` — patrz Obsidian `03-generative-shadery-webgl` po szczegóły — ★★☆–★★★ — 📱 zależnie

## B) Systemy agencyjne (Awwwards-grade)

### System przejść stron (Page Transition System)
- `barba.js page transitions`, `taxi.js`, `swup.js` — Barba.js+GSAP / Swup / Taxi.js (@unseenco/taxi); Osmo boilerplate — ★★★ — 📱✅ (reinit scroll+touch)

### Lenis + ScrollTrigger choreography
- `lenis gsap scrolltrigger setup 2025` — lenis.on('scroll',ScrollTrigger.update)+gsap.ticker.add(lenis.raf) — ★★☆ — 📱⚠️ (wyłącz velocity na touch)
- Fundament agencyjnego scrolla.

### Preloader → hero handoff
- `gsap preloader hero timeline`, `preloader curtain reveal` — GSAP Timeline: licznik→clip-path exit→stagger hero — ★★☆ — 📱✅ (≤1.2s)

### WebGL hover distortion + image trail (Mouse Flowmap)
- `webgl hover distortion ogl`, `curtains.js distortion` — OGL (~5KB) flowmap / Curtains.js; GSAP→uMouse — ★★★ — 📱⚠️ (scale/opacity fallback)

### WebGL scroll-revealed gallery
- `webgl scroll gallery gsap three.js` — Three.js+ScrollTrigger scrub→uProgress (+Barba) — ★★★ — 📱⚠️

### Nieskończona siatka z momentum (Infinite Draggable Grid)
- `infinite draggable grid gsap inertia`, `active theory grid` — GSAP Draggable+InertiaPlugin, tiling modulo — ★★★ — 📱✅
- Całe portfolio jako przestrzeń do eksploracji.

### Elastyczny marquee ze scroll-velocity
- `gsap observer marquee scroll velocity` — ScrollTrigger.getVelocity()→timeScale(); kierunek=sign(velocity) — ★★☆ — 📱✅
- (Łączy się z multi-row marquee z pliku 05.)

### Sticky + skew na scroll velocity
- `gsap skew scroll velocity` — getVelocity()→skewY clamp, power3.out — ★★☆ — 📱⚠️ (±8°)

### SplitType + GSAP stagger reveal / scramble
- `splittype gsap line reveal`, `gsap scrambletext decode` — SplitType (~3KB) / GSAP SplitText (free 3.13+) / ScrambleTextPlugin (free) — ★★☆ — 📱✅

### Canvas image sequence scrubbing (Apple-scroll)
- `canvas image sequence scroll scrub`, `apple scroll sequence` — preload WebP→ScrollTrigger scrub→drawFrame — ★★★ — 📱⚠️ (50-100 klatek)

### Sticky horizontal showreel / stacking cards
- `gsap scrolltrigger horizontal pinned`, `sticky stacking cards` — pin+scrub + x:-totalWidth / position:sticky+scale — ★★☆ — 📱⚠️/✅

### GSAP Flip — layout morph (shared element)
- `gsap flip layout transition expand card` — Flip.getState→DOM change→Flip.from({nested:true}) — ★★☆ — 📱✅

### Fullscreen menu reveal (Overlay Nav Curtain)
- `gsap fullscreen menu stagger`, `nav curtain clip-path` — clipPath/scaleY + stagger <li> +SplitText — ★★☆ — 📱✅

### Film grain / noise overlay
- `svg feturbulence noise grain`, `grainy gradient` — SVG feTurbulence + filter na ::before / fffuel nnnoise — ★☆☆ — 📱✅
- Tani sposób na "drogi" wygląd; łamie banding gradientów.

### GSAP → shader uniforms bridge
- `animate webgl shaders gsap uniforms` — gsap.to(material.uniforms.uProgress,{value:1}) — ★★★ — 📱⚠️
- Wzorzec 2025/26: GSAP tweenuje, efekt żyje w GLSL.

### SVG mask + blind/grid transition
- `svg mask transitions gsap 2026`, `grid blind reveal svg` — <mask> z N rect/path + stagger + ScrollTrigger/Barba — ★★★ — 📱✅

## Biblioteki: Three.js (~170KB, WebGPU), OGL (~5KB), R3F + @react-three/postprocessing, @paper-design/shaders, VFX-JS, Pixi.js v8, p5.js, ditherwave, WebGL-Fluid-Enhanced, three-raymarcher | GSAP+ScrollTrigger (free; SplitText free 3.13+), SplitType (~3KB), Lenis (~3KB), Barba.js (~14KB), Swup, Taxi.js, Curtains.js, GSAP Draggable+InertiaPlugin, Osmo Vault.

## Trend 2025/26: WebGPU mainstream (~82%); shader-hero zamiast wideo; boom dithering/halftone/retro; GSAP jako "shader controller"; native CSS scroll-driven jako warstwa bazowa (GSAP do choreografii/WebGL); draggable grids/infinite canvas jako layout; Barba+Three.js pełny stack transitions; ziarno+gradienty. Pełne szczegóły → Obsidian `03-...` i `04-...`.

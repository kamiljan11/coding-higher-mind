# 15 — Motion craft + Emerging/AI-era/immersive (trendy 2026)

Rzemiosło ruchu (jak animować dobrze) + najświeższe wzorce AI-era i immersive. Format: Nazwa PL (English) — `szukaj` — czym — trudność — 📱.

## A) Motion craft / micro-interakcje (uzupełnia plik 06)

### Sprężyna vs krzywa (Spring vs Easing)
- `spring physics animation UI`, `when to use spring` — Motion spring() / react-spring / GSAP Elastic — ★★☆ — 📱✅
- Reguła: spring dla rzeczy "dotykanych" (drag, modale, gesty); easing dla prostych przejść.

### Choreografia / stagger (Orchestration)
- `stagger orchestration`, `Motion staggerChildren` — GSAP stagger / Motion variants / CSS nth-child — ★★☆ — 📱✅ (delay ~0.05s)

### Shared element / layout morph (layoutId)
- `Motion layoutId shared element`, `FLIP` — Motion layoutId (FLIP) / GSAP Flip — ★★★ — 📱✅
- Karta "rozkwita" w modal z własnej pozycji.

### Morph stanu przycisku (idle→loading→success)
- `button loading state animation`, `submit button morph` — Motion AnimatePresence+layout / GSAP — ★★☆ — 📱✅

### Auto-Animate (zero-config list)
- `auto-animate FormKit`, `@formkit/auto-animate` — @formkit/auto-animate (1 ref, ~3KB FLIP) — ★☆☆ — 📱✅
- Najszybszy ROI: dodanie/usunięcie/reorder dzieci animuje się samo.

### Drag & reorder z animacją
- `drag to reorder`, `Motion Reorder` — Motion Reorder.Group/Item / @dnd-kit/sortable — ★★☆ — 📱✅

### Rive State Machine (interaktywna anim sterowana inputem)
- `Rive state machine web`, `rive react-canvas` — Rive Editor + @rive-app/react-canvas — ★★★ — 📱✅ (~500KB GPU)
- "Żywy komponent" — maskotka/ikona ze stanami sterowanymi z kodu.

### Lottie interaktywne (scroll/hover segments)
- `Lottie interactivity scroll`, `dotLottie state machine` — @lottiefiles/lottie-interactivity + dotlottie-web — ★★☆ — 📱✅ (use .lottie)

### Icon morphing (play↔pause, ☀↔☾, hamburger→×)
- `icon morphing SVG`, `sun moon dark toggle`, `SVG path interpolation` — GSAP MorphSVG / Motion animate d: / stroke-dashoffset — ★★★ — 📱✅

### Number ticker / Odometer (warianty)
- `number ticker`, `odometer.js`, `rolling number` — Odometer.js / Motion useMotionValue / slot overflow:hidden+translateY — ★★☆ — 📱✅

### Toast / snackbar choreography
- `toast choreography`, `snackbar enter exit` — Motion AnimatePresence+layout / Sonner — ★★☆ — 📱✅ (swipe-to-dismiss)

### Skeleton shimmer (synchronized)
- `skeleton shimmer`, `synchronized skeleton` — wspólny ::after; transform nie background-position — ★★☆ — 📱✅

### Haptic feedback (Vibration API)
- `Vibration API haptics`, `navigator.vibrate` — navigator.vibrate(50)/[100,30,100]; wymaga gestu — ★☆☆ — 📱✅ (tylko Android Chrome)

### Reduced motion craft
- `prefers-reduced-motion best practices` — @media reduce z alternatywami (fade nie slide); Motion useReducedMotion() — ★★☆ — 📱✅ (obowiązek)
- Nie wyłączaj — zastąp subtelnym.

### Theatre.js (timeline jako narzędzie)
- `Theatre.js visual editor`, `Theatre.js R3F` — @theatre/core + @theatre/studio (dev), eksport JSON — ★★★ — 📱⚠️ (narzędzie dev)

## B) Emerging / AI-era / immersive

### Strumieniowanie tekstu AI (Streaming text)
- `AI streaming text UI`, `typewriter token stream` — Vercel AI SDK useChat / ReadableStream — ★★☆ — 📱✅

### Stan "myślenia" AI / shimmer
- `AI thinking animation`, `typing indicator dots` — CSS gradient sweep / Motion — ★☆☆ — 📱✅

### Wizualizacja tool-call agenta + cytaty źródeł
- `agent tool call UI`, `AI citations UI`, `Perplexity citation style` — Chainlit / CopilotKit / <Citation>+Popover; ShapeOfAI — ★★☆ — 📱⚠️

### Generatywny UI (AI renderuje komponenty)
- `generative UI React`, `AI SDK useObject`, `A2UI` — Vercel AI SDK streamUI/json-render / CopilotKit / AG-UI — ★★★ — 📱✅

### Command bar z AI (⌘K + AI)
- `cmdk AI integration`, `better-cmdk` — cmdk / better-cmdk — ★★☆ — 📱❌ (desktop-first)

### Bento 2.0 (Animated Bento Grid)
- `animated bento grid`, `bento framer motion 2026` — CSS Grid + Motion layout / Aceternity BentoGrid — ★★☆ — 📱✅
- Asymetryczne kafle, hover-expand, "squishy" mikro-animacje.

### Liquid Glass / spatial (visionOS / iOS 26)
- `liquid glass CSS`, `visionOS spatial UI web` — backdrop-filter + dynamiczne rgba + SVG feTurbulence/feDisplacementMap (refrakcja) — ★★☆ — 📱✅ native / ⚠️ web perf
- Trend baseline 2026 (Apple WWDC 2025).

### Glassmorphism 2.0 (frosted depth)
- `glassmorphism 2.0 dark UI`, `layered blur` — custom props + backdrop-filter + parallax warstw — ★★☆ — 📱⚠️

### AR "obejrzyj u siebie" (WebXR / model-viewer AR)
- `model-viewer AR button`, `WebXR hit-test`, `view in your space` — <model-viewer> (WebXR), iOS Quick Look; HTTPS — ★★★ — 📱✅ (Android natywnie)
- Mebel/produkt w pokoju klienta — przewaga mobilna.

### Konfigurator 3D produktu
- `R3F product configurator`, `three.js color picker model` — R3F + Valtio + drei (useGLTF/MeshTransmissionMaterial) — ★★★ — 📱⚠️

### Scrollytelling danych (Data scrollytelling)
- `scrollytelling D3.js`, `Flourish`, `Closeread` — Flourish (no-code) / D3+ScrollTrigger / Closeread — ★★★ — 📱⚠️

### Immersywna galeria przestrzenna
- `immersive gallery framer`, `3D gallery scroll transform` — Framer / Motion useScroll+useTransform / perspective preserve-3d — ★★☆ — 📱⚠️

### Neobrutalizm
- `neobrutalism web design`, `bold border offset shadow` — CSS+Tailwind shadow-[4px_4px_0_#000] / neobrutalism-ui — ★☆☆ — 📱✅

### Zmienna typografia / kinetic (Variable fonts)
- `variable font animation`, `font-variation-settings hover`, `kinetic variable font` — CSS font-variation-settings + @keyframes; Wakamaifondue — ★★☆ — 📱✅

### Voice UI z falą (waveform)
- `voice UI waveform React`, `audio visualizer`, `speech recognition streaming UI` — Web Audio AnalyserNode + Canvas; react-speech-recognition; ElevenLabs WS — ★★★ — 📱✅
- Pasuje do Twojego stacku voice (RetellAI/ElevenLabs).

### Dopaminowy design / Y2K + grain
- `dopamine design 2026`, `Y2K web revival`, `chrome gradient`, `CSS grain texture` — conic/linear-gradient metaliczny; SVG feTurbulence — ★☆☆–★★☆ — 📱✅

### Micro-3D tilt karty na hover
- `3D card tilt`, `Aceternity 3D card` — Aceternity 3d-card / vanilla-tilt.js / mousemove→rotateX/Y — ★★☆ — 📱❌

## Biblioteki: Motion (motion.dev), GSAP (free), react-spring, @formkit/auto-animate (~3KB), Rive, dotLottie, Lordicon, Theatre.js, Odometer.js, canvas-confetti, Sonner, ldrs | Vercel AI SDK, CopilotKit, json-render, cmdk/better-cmdk, Aceternity UI, Chainlit, model-viewer, vanilla-tilt.js, Flourish, ShapeOfAI.

## Trend 2026: AI-era UI jako nowy design system (streaming/shimmer/tool-call/citations/generative); Apple Liquid Glass baseline; koniec flat — głębia jako architektura; kontrreakcja na AI-design-fatigue (Y2K/grain/neobrutalizm/dopamine); motion jako tożsamość marki (animowane logo, variable fonts na scroll); voice jako primary input na mobile; reduced-motion jako feature; Rive/dotLottie state machines jako "żywe komponenty". Pełne szczegóły → Obsidian `06-...` i `07-...`.

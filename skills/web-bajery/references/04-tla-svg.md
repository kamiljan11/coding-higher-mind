# 04 — Tła sekcji, gradienty animowane, SVG i particles

Tło robi 80% "klimatu" sekcji przy 5% wysiłku. Kolejność od najtańszego (CSS) do najcięższego (WebGL). Większość tła rób jako warstwę pod treścią z `position:absolute` + `z-index:-1` i zawsze zadbaj o kontrast tekstu.

---

### Animowany gradient (Animated CSS gradient)
- Co to: gradient powoli przesuwa się/oddycha (kolory płyną).
- Szukaj: `animated gradient background css`, `moving gradient`, `gradient animation background-position`
- Czym zrobić: czysty CSS — duży `linear-gradient` (200% rozmiaru) + `@keyframes` na `background-position`. Zero JS.
- Trudność: ★☆☆
- Gdzie: hero, CTA, sekcje brandowe.
- 📱 Mobile: ✅ (najtańszy "wow")

### Mesh gradient (Gradient mesh / liquid gradient)
- Co to: kilka kolorowych plam zlewa się w miękką, "ciekłą" płaszczyznę (jak tła Stripe / iOS).
- Szukaj: `mesh gradient`, `mesh gradient generator`, `liquid gradient background`
- Czym zrobić: generator → **MagicPattern**, **fffuel ffflux** (SVG), **FWD Tools** (eksport SVG/CSS/PNG). Eksportuj jako SVG/PNG i wstaw jako tło.
- Trudność: ★☆☆ (z generatora) / ★★☆ (animowany na canvas)
- Gdzie: hero, karty, sekcje premium.
- 📱 Mobile: ✅ (statyczny SVG/PNG = idealnie lekki)

### Aurora / dryfujące bloby (Aurora gradient / blob background)
- Co to: rozmyte, kolorowe kule powoli dryfują (zorza polarna). Bardzo modne, "dreamy".
- Szukaj: `aurora background`, `blurred blobs background`, `gradient blobs floating`
- Czym zrobić: 2-4 `div`y z `radial-gradient`, mocny `filter: blur(80px)`, animacja `transform: translate` w pętli. CSS-only.
- Trudność: ★☆☆
- Gdzie: hero SaaS, sekcje "spokojne", tła pod glassmorphism.
- 📱 Mobile: ⚠️ (duży blur potrafi ciąć FPS — zmniejsz liczbę blobów / promień blura)

### Stripe-style animowany mesh (WebGL gradient)
- Co to: ten "żywy", falujący, kolorowy gradient ze strony Stripe — renderowany na WebGL.
- Szukaj: `stripe gradient animation`, `whatamesh`, `mesh gradient webgl`, `granim.js`
- Czym zrobić: lib **Whatamesh** (open-source klon Stripe) albo **Granim.js**.
- Trudność: ★★☆
- Gdzie: hero produktów tech/SaaS.
- 📱 Mobile: ⚠️ (działa, ale to WebGL — rozważ statyczny mesh PNG poniżej 768px)

### Szum / ziarno (Noise / grain overlay)
- Co to: subtelna warstwa "ziarna" na całości — natychmiast podnosi "drogość" i niweluje banding gradientów.
- Szukaj: `film grain overlay css`, `svg noise texture`, `feTurbulence noise background`
- Czym zrobić: SVG filtr `feTurbulence` jako `background-image` (data-URI), `opacity: 0.05`, `mix-blend-mode: overlay`. Animowany = przesuwaj warstwę.
- Trudność: ★☆☆
- Gdzie: cała strona (overlay), premium/editorial.
- 📱 Mobile: ✅

### Particles / cząsteczki (Particles background)
- Co to: drobiny/kropki unoszą się w tle, czasem łączą liniami.
- Szukaj: `particles background`, `tsparticles`, `particles.js`
- Czym zrobić: **tsParticles** (następca particles.js) — gotowe presety, też confetti i fireworks.
- Trudność: ★★☆
- Gdzie: hero tech, eventy, "kosmiczny" klimat.
- 📱 Mobile: ⚠️ (zmniejsz liczbę cząstek 3-4×; wyłącz linkowanie na touchu)

### Konstelacja reagująca na mysz (Constellation / interactive network)
- Co to: kropki połączone liniami, które reagują na kursor (linie ciągną się do myszki).
- Szukaj: `constellation background`, `interactive particle network`, `particles connect mouse`
- Czym zrobić: tsParticles preset "links" z interaktywnością onHover.
- Trudność: ★★☆
- Gdzie: hero tech/AI.
- 📱 Mobile: ❌ interakcja myszką → zostaw same cząstki bez reakcji albo statyczny obraz

### Animowane tła WebGL w 5 linijek (Vanta.js)
- Co to: gotowe efekty 3D w tle — fale, "net", mgła, ptaki, globus, komórki — z reakcją na mysz.
- Szukaj: `vanta.js`, `vanta waves background`, `animated webgl background`
- Czym zrobić: **Vanta.js** (potrzebuje Three.js albo p5). Dosłownie kilka linii konfiguracji.
- Trudność: ★☆☆ (użycie) / pod spodem WebGL
- Gdzie: hero gdy chcesz szybki "wow" bez pisania shaderów.
- 📱 Mobile: ⚠️ (bateria/FPS — wyłączaj < 768px, dawaj gradient fallback)

### Animowane fale SVG (Animated SVG waves)
- Co to: warstwy fal na granicy sekcji, które płyną; albo falujący dolny "divider".
- Szukaj: `animated svg waves`, `svg wave divider`, `getwaves.io`
- Czym zrobić: generator **getwaves.io** / **Haikei** → SVG, animacja przez `<animate>` albo CSS na ścieżce.
- Trudność: ★☆☆
- Gdzie: przejścia między sekcjami, stopka, "morskie"/playful marki.
- 📱 Mobile: ✅

### Morphing blob (Animated SVG blob)
- Co to: organiczna "kropla" płynnie zmienia kształt; często pod zdjęciem/ikoną.
- Szukaj: `svg blob morph`, `animated blob`, `blobmaker`, `blobs.app`
- Czym zrobić: generator kształtu **blobmaker.app**, animacja morphu **GSAP MorphSVG** (darmowy) albo lib `blobity`.
- Trudność: ★★☆
- Gdzie: sekcje "about", maski zdjęć, kreatywne marki.
- 📱 Mobile: ✅

### Siatka kropek / wzór (Dot grid / pattern background)
- Co to: subtelna siatka kropek/linii dająca głębię (jak Linear, Vercel).
- Szukaj: `dot grid background css`, `grid pattern background`, `hero pattern`
- Czym zrobić: CSS `radial-gradient` powtarzany (`background-size`), albo gotowce **heropatterns.com**. Maska radialna by znikało po brzegach.
- Trudność: ★☆☆
- Gdzie: tła tech/SaaS, pod treść.
- 📱 Mobile: ✅

### Rysowanie linii SVG (Animated stroke / line draw)
- Co to: ścieżka SVG "rysuje się" sama (kontur, podpis, wykres, ilustracja).
- Szukaj: `svg line draw animation`, `stroke-dashoffset animation`, `DrawSVG GSAP`
- Czym zrobić: CSS `stroke-dasharray`/`stroke-dashoffset`, albo **GSAP DrawSVG** (darmowy) dla kontroli na scroll.
- Trudność: ★★☆
- Gdzie: ilustracje, "jak to działa", animowane podpisy/logo.
- 📱 Mobile: ✅

### Interaktywne SVG (Interactive SVG)
- Co to: SVG reaguje na hover/scroll/klik — części się podświetlają, ruszają, animują (mapa, diagram, ikona ze stanami).
- Szukaj: `interactive svg`, `animated svg on hover`, `svg hover animation`, `interactive svg map`
- Czym zrobić: SVG inline + CSS `:hover` na elementach, albo JS (GSAP/anime.js) na poszczególnych `<path>`. Dla skomplikowanych stanów → **Rive**.
- Trudność: ★★☆
- Gdzie: diagramy, mapy, "explore" sekcje, ikony procesu.
- 📱 Mobile: ⚠️ (zamień hover na tap/auto-animację; `@media (hover: hover)`)

### Animowana ramka / glow border (Animated gradient border)
- Co to: świecąca, obracająca się ramka wokół karty/CTA (gradient krąży po obwodzie).
- Szukaj: `animated gradient border`, `glowing border css`, `conic gradient border animation`
- Czym zrobić: CSS `conic-gradient` + `@property --angle` animowany, albo maska `border` na pseudo-elemencie.
- Trudność: ★★☆
- Gdzie: karty premium, pricing "polecane", CTA.
- 📱 Mobile: ✅

### Reflektor podążający za myszką (Spotlight / cursor glow background)
- Co to: miękka poświata tła idzie za kursorem; albo karty rozjaśniają się tam gdzie mysz.
- Szukaj: `spotlight hover effect`, `mouse follow glow`, `card spotlight effect`
- Czym zrobić: CSS zmienne `--x/--y` ustawiane JS-em na `mousemove` + `radial-gradient` w tym punkcie.
- Trudność: ★★☆
- Gdzie: ciemne sekcje, siatki kart, pricing.
- 📱 Mobile: ❌ brak myszki → wyłącz, zostaw zwykłe tło

### Wielki tekst-marquee w tle (Background marquee text)
- Co to: ogromne, jadące słowa przewijają się za treścią (warstwa dekoracyjna).
- Szukaj: `background marquee text`, `scrolling text background`, `oversized type marquee`
- Czym zrobić: CSS marquee (translateX w pętli) z dużym `font-size`, niski kontrast/outline.
- Trudność: ★☆☆
- Gdzie: sekcje brandowe, "manifest", agencje.
- 📱 Mobile: ✅ (zmniejsz font)

### Pływające kształty parallax (Floating shapes / parallax blobs)
- Co to: geometryczne kształty/ikony unoszą się i lekko reagują na scroll/mysz (parallax warstw).
- Szukaj: `floating shapes background`, `parallax floating elements`, `decorative shapes animation`
- Czym zrobić: CSS `@keyframes` float (translateY) + ewentualnie parallax na scroll (Rellax.js / GSAP).
- Trudność: ★☆☆ / ★★☆
- Gdzie: hero playful, SaaS, onboarding.
- 📱 Mobile: ⚠️ (zostaw float, wyłącz parallax na mysz)

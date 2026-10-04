# 08 — 3D, WebGL i efekty generatywne

Najcięższa, ale najbardziej "wow" rodzina. Reguła: **3D ma być dodatkiem (décor/akcent), nie wymówką.** Jeden dobrze zrobiony obiekt 3D > cała scena, która zabija FPS. Na proste strony usługowe zwykle nie wchodzi; na portfolio/premium/produkt — tak.

> Powiązanie: scroll-driven 3D pod jeden produkt premium → skill **jack-3d-websites**. Tutaj jest szersza paleta + logika "dorabialnych" elementów 3D.

---

### "Dorabialne" elementy 3D / modularne décor 3D (Addable 3D elements — R3F)
- Co to: dorzucasz pojedyncze obiekty 3D (abstrakcyjny kształt, produkt, ikona 3D) do normalnej strony jak zwykłe komponenty — unoszą się, obracają, reagują na mysz/scroll. **To jest logika z kamiljan.com**: 3D jako komponent, który "dostawiasz" do sekcji, nie cała strona-gra.
- Szukaj: `react three fiber`, `@react-three/drei`, `r3f floating object`, `drei Float`
- Czym zrobić: **React Three Fiber** (Three.js jako komponenty React — idealne pod stack uzytkownika: React/TS/Vercel) + **drei** (gotowce: `<Float>`, `<Environment>`, `<OrbitControls>`, `<MeshDistortMaterial>`). Wrzucasz `<Canvas>` w sekcję i dodajesz obiekty jak JSX.
- Trudność: ★★★ (ale modularnie — raz ustawione, "dostawiasz" obiekty łatwo)
- Gdzie: hero, sekcje feature, akcenty między treścią, portfolio.
- 📱 Mobile: ⚠️ (ogranicz liczbę obiektów, niższe DPR, `frameloop="demand"`; poniżej 768px rozważ statyczny render/obrazek)

### Spline (3D bez kodu) (Spline embed)
- Co to: projektujesz scenę 3D w edytorze (jak Figma dla 3D), wrzucasz na stronę jednym embedem; obiekty reagują na mysz/scroll/klik. Najszybsza droga do "dorabiania" elementów 3D bez pisania shaderów.
- Szukaj: `spline 3d`, `spline react`, `spline web embed`
- Czym zrobić: **Spline** — eksport jako `<spline-viewer>` (web component) albo `@splinetool/react-spline`.
- Trudność: ★★☆ (logika prosta, waga sceny do pilnowania)
- Gdzie: hero, interaktywne maskotki/produkty, "wow" akcenty.
- 📱 Mobile: ⚠️ (sceny bywają ciężkie — optymalizuj albo dawaj fallback PNG)

### Three.js od zera (Three.js)
- Co to: pełna kontrola nad sceną 3D/WebGL (światła, materiały, kamera, shadery).
- Szukaj: `three.js`, `webgl scene`, `three.js boilerplate`
- Czym zrobić: **Three.js** (vanilla). Pod React → R3F (wyżej). Pod scroll → + GSAP ScrollTrigger.
- Trudność: ★★★
- Gdzie: custom doświadczenia, produkty, art.
- 📱 Mobile: ⚠️/❌ (zależnie od ciężkości; zawsze fallback)

### Wrzuć model i obracaj (model-viewer)
- Co to: wstawiasz gotowy model GLB/GLTF i użytkownik go obraca/zoomuje (z AR na telefonie!).
- Szukaj: `<model-viewer>`, `google model viewer`, `glb viewer web`
- Czym zrobić: web component **`<model-viewer>`** Google — dosłownie jeden tag + plik `.glb`. Wspiera AR (`ar` atrybut).
- Trudność: ★☆☆
- Gdzie: produkt do obejrzenia (meble, buty, sprzęt), "zobacz w swoim pokoju" (AR).
- 📱 Mobile: ✅ (AR to wręcz przewaga mobilna)

### Pływające obiekty 3D reagujące na mysz (Floating 3D décor)
- Co to: abstrakcyjne bryły (torus, kula, "płyn") unoszą się i przechylają za kursorem — tło/akcent, nie główny content.
- Szukaj: `floating 3d objects`, `drei Float`, `3d blob mouse`, `interactive 3d decoration`
- Czym zrobić: R3F + drei `<Float>` + lekki parallax na pointer; materiał `MeshDistortMaterial` dla "płynnej" bryły.
- Trudność: ★★★
- Gdzie: hero, akcenty sekcji (logika "dostaw obiekt gdzie chcesz").
- 📱 Mobile: ⚠️ (1 obiekt max, albo statyczny)

### Konfigurator 3D (3D product configurator)
- Co to: użytkownik zmienia kolor/wariant/części produktu w 3D na żywo.
- Szukaj: `3d product configurator`, `r3f configurator`, `three.js customizer`
- Czym zrobić: R3F/Three.js — podmiana materiałów/mesh na klik; stan w React.
- Trudność: ★★★
- Gdzie: sklep premium, produkt z wariantami, "zaprojektuj swój".
- 📱 Mobile: ⚠️ (uprość UI, większe kontrolki)

### Obraz w cząsteczki (Image-to-particles / particle morph)
- Co to: zdjęcie/logo rozsypuje się w cząstki i składa z powrotem, albo morfuje w inny kształt.
- Szukaj: `image to particles`, `particle morph three.js`, `gpgpu particles`
- Czym zrobić: Three.js + shader (GPGPU) — zaawansowane; gotowce na Codrops.
- Trudność: ★★★
- Gdzie: hero art, intro, marki kreatywne.
- 📱 Mobile: ❌ (statyczny obraz)

### Płynna bryła / iridescent blob (Distortion / iridescent 3D blob)
- Co to: lśniąca, "olejowa"/szklana bryła faluje i mieni się kolorami.
- Szukaj: `mesh distort material`, `iridescent blob`, `3d gooey sphere`, `distort sphere r3f`
- Czym zrobić: R3F + drei `MeshDistortMaterial` / `MeshTransmissionMaterial`.
- Trudność: ★★★
- Gdzie: hero abstrakcyjne, marki tech/beauty.
- 📱 Mobile: ⚠️

### Tekst 3D (3D text)
- Co to: napis wytłoczony w 3D, obraca się, reaguje na światło/mysz.
- Szukaj: `3d text web`, `troika three text`, `drei Text3D`
- Czym zrobić: drei `<Text3D>` / troika-three-text.
- Trudność: ★★☆
- Gdzie: hero typograficzne premium, logo 3D.
- 📱 Mobile: ⚠️

### Interaktywny globus (Interactive globe)
- Co to: obracający się glob 3D z punktami (klienci, lokalizacje, trasy) — często z połyskiem.
- Szukaj: `interactive globe`, `cobe globe`, `three-globe`, `webgl globe dots`
- Czym zrobić: **cobe** (malutki, ładny) albo **three-globe**.
- Trudność: ★★☆
- Gdzie: "działamy globalnie", sieć, dane geo (pasuje do marketplace-app/PG).
- 📱 Mobile: ✅ (cobe jest lekki)

### Fizyka / przeciągalne obiekty 3D (3D physics playground)
- Co to: obiekty 3D z grawitacją — możesz je chwytać, rzucać, zderzać (zabawa w hero).
- Szukaj: `r3f rapier physics`, `3d physics playground`, `draggable 3d objects gravity`
- Czym zrobić: R3F + **@react-three/rapier** (silnik fizyki).
- Trudność: ★★★
- Gdzie: hero "zabawne", marki produktowe, easter-eggi.
- 📱 Mobile: ⚠️ (ogranicz liczbę ciał)

---

## Kiedy 3D się opłaca (a kiedy nie)

- **Tak:** portfolio, marka premium, produkt fizyczny do pokazania, "motion identity", easter-egg który zapada w pamięć.
- **Nie:** strona usługowa lokalna gdzie liczy się szybkość i konwersja (project-c, większość agency-site) — tam 3D zwykłada LCP i baterię. Lepszy lekki bajer CSS.
- **Złoty środek:** jeden obiekt 3D (R3F/Spline/model-viewer) jako akcent w hero, z fallbackiem PNG na mobile i `prefers-reduced-motion`. To jest logika "dorabialnego 3D" — dostawiasz jeden mocny element, nie budujesz gry.

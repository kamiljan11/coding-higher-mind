# 01 — Efekty tekstu (Text effects)

Typografia, która się rusza, składa, zmienia albo świeci. Najtańszy sposób na "żywą" stronę — większość to czysty CSS albo lekki JS.

---

### Maszyna do pisania (Typewriter)
- Co to: tekst wypisuje się litera po literze, kursor mruga, czasem kasuje i pisze następny.
- Szukaj: `typewriter effect`, `typed text animation`, `Typed.js`
- Czym zrobić: **Typed.js** (gotowiec), albo CSS `steps()` + `@keyframes` dla jednej linii, albo GSAP `TextPlugin`.
- Trudność: ★☆☆
- Gdzie: hero, podtytuł, "I help with ___".
- 📱 Mobile: ✅ (krótkie frazy; nie rób długich akapitów na wąskim ekranie)

### Rotujące słowa (Rotating words / word rotator)
- Co to: część zdania stała, jedno słowo cyklicznie się podmienia (fade/slide w górę). TO jest efekt z mampomoc.pl ("Znajdziemy Ci **psychologa/coacha/terapeutę**").
- Szukaj: `rotating words css`, `word rotator`, `animated headline rotator`
- Czym zrobić: CSS `@keyframes` z translateY + overflow:hidden, albo GSAP, albo lib `react-rotating-text`.
- Trudność: ★☆☆ (CSS) / ★★☆ (płynny slide-mask)
- Gdzie: hero headline.
- 📱 Mobile: ✅ (uważaj by najdłuższe słowo nie łamało layoutu — zarezerwuj szerokość)

### Rozsypywanie/skanowanie liter (Text scramble / decode)
- Co to: litery "losują się" jak w Matrixie i ustawiają w docelowy tekst (efekt deszyfracji).
- Szukaj: `text scramble effect`, `decode text animation`, `scramble text GSAP`
- Czym zrobić: GSAP **ScrambleTextPlugin** (teraz darmowy) albo gotowe klasy JS "scramble".
- Trudność: ★★☆
- Gdzie: hero, nagłówki sekcji, hacker/tech klimat.
- 📱 Mobile: ⚠️ (działa, ale na słabszych telefonach migocze — skróć)

### Składanie tekstu ze staggerem (Split-text reveal)
- Co to: nagłówek wjeżdża per-litera albo per-słowo z opóźnieniem (stagger) — od dołu, z blura, z obrotu.
- Szukaj: `split text animation`, `SplitText GSAP`, `staggered text reveal`, `Splitting.js`
- Czym zrobić: **GSAP SplitText** (po przebudowie 2025: lżejszy, lepsza dostępność) albo **Splitting.js** + CSS.
- Trudność: ★★☆
- Gdzie: hero, wejścia sekcji (na scroll).
- 📱 Mobile: ✅ (per-słowo lepsze niż per-litera na małym ekranie)

### Animowany gradient w tekście (Animated gradient text)
- Co to: litery wypełnione gradientem, który płynie/przesuwa się.
- Szukaj: `animated gradient text css`, `gradient text background-clip`
- Czym zrobić: czysty CSS — `background: linear-gradient; -webkit-background-clip: text; color: transparent;` + animacja `background-position`.
- Trudność: ★☆☆
- Gdzie: jedno mocne słowo w headline, logo-tekst.
- 📱 Mobile: ✅

### Tekst-maska (Text mask / image przez tekst)
- Co to: przez litery widać wideo albo zdjęcie/gradient (tekst jest "okienkiem").
- Szukaj: `text mask video css`, `background-clip text image`, `knockout text`
- Czym zrobić: CSS `background-clip: text` z `background-image` (zdjęcie/wideo w tle elementu).
- Trudność: ★★☆
- Gdzie: hero (wielki napis z wideo w środku), sekcje brandowe.
- 📱 Mobile: ⚠️ (wideo w tle = waga; na mobile podmień na statyczny obraz)

### Podświetlanie tekstu na scroll (Scroll text highlight / fill)
- Co to: akapit jest szary, a w miarę scrolla słowa kolorują się jedno po drugim (jak Apple / Stripe).
- Szukaj: `scroll text highlight effect`, `word by word color on scroll`, `text fill on scroll`
- Czym zrobić: GSAP ScrollTrigger + SplitText (stagger po słowach), albo CSS scroll-driven `animation-timeline`.
- Trudność: ★★☆
- Gdzie: sekcja "manifest"/o nas, storytelling.
- 📱 Mobile: ✅ (lekki, działa dobrze)

### Glitch tekst (Glitch text)
- Co to: tekst "psuje się" — przesunięte kanały RGB, drganie, cięcia.
- Szukaj: `glitch text effect css`, `RGB split text`
- Czym zrobić: CSS `@keyframes` + `text-shadow` w 2 kolorach + `clip-path` (pseudo-elementy ::before/::after).
- Trudność: ★★☆
- Gdzie: marki tech/gaming/streetwear, 404.
- 📱 Mobile: ✅ (CSS, tani)

### Falujący / płynny tekst (Wavy text)
- Co to: litery falują góra-dół jak na wodzie (ciągły, miękki ruch).
- Szukaj: `wavy text animation`, `letters wave css`, `floating letters`
- Czym zrobić: CSS per-litera `animation-delay` (translateY sine), albo anime.js stagger.
- Trudność: ★★☆
- Gdzie: zabawne/dziecięce/kreatywne marki.
- 📱 Mobile: ✅

### Magnetyczne / odpychane litery (Magnetic / repel letters)
- Co to: litery uciekają od kursora albo przyciągają się do niego.
- Szukaj: `repel text cursor`, `magnetic letters`, `text follow mouse`
- Czym zrobić: JS (mouse position → transform per litera) + lerp; często z GSAP.
- Trudność: ★★★
- Gdzie: portfolio, hero kreatywne.
- 📱 Mobile: ❌ brak myszki → daj statyczny tekst (wariant `@media (hover: hover)`)

### Animacja zmienną czcionką (Variable font animation)
- Co to: grubość/szerokość liter zmienia się płynnie (na hover albo na scroll) — bo to jeden plik variable font.
- Szukaj: `variable font animation`, `animate font-weight`, `font-variation-settings animation`
- Czym zrobić: CSS animacja `font-variation-settings` (wght/wdth), zmienna czcionka (np. z Google Fonts).
- Trudność: ★★☆
- Gdzie: typograficzne hero, nagłówki premium.
- 📱 Mobile: ✅

### Tekst po ścieżce (Text on a path)
- Co to: napis biegnie po krzywej/okręgu (np. "scroll down" wokół kółka, które się obraca).
- Szukaj: `svg text on path`, `curved text`, `circular text badge`
- Czym zrobić: SVG `<textPath>` + CSS rotate dla obracającego się "badge".
- Trudność: ★★☆
- Gdzie: odznaki "★ available for work ★", dekoracje.
- 📱 Mobile: ✅

### Liczby lecące w górę / liczniki (Counting numbers / animated counters)
- Co to: statystyki ("94%", "1200+", ceny) odliczają od 0 i "ładują się" do wartości — zwykle gdy sekcja wejdzie w ekran.
- Szukaj: `count up animation`, `number counter on scroll`, `CountUp.js`, `odometer.js`, `rolling number animation`
- Czym zrobić: **CountUp.js** (gotowiec: formatowanie, separatory, easing) albo **Motion** `useMotionValue`+`animate()` albo GSAP (tween na obiekcie `{val:0}`→`{val:N}` z `onUpdate`). Odpal na wejściu przez **IntersectionObserver**/ScrollTrigger — raz (`once`).
- Warianty:
  - **Rolling / odometer** — cyfry przewijają się jak licznik auta → **Odometer.js** albo slot `overflow:hidden` + `translateY` na taśmie 0–9 (`number flip animation`).
  - **Split-flap / flip counter** — klapki jak tablica lotniska/zegar → `split flap display`, flip-clock / własne flipy CSS `rotateX`.
  - **Slot-machine roll** — kilka cyfr rolUje i zatrzymuje się po kolei (stagger na kolumnach) → `slot machine number roll`.
- Trudność: ★☆☆ (CountUp) / ★★☆ (rolling/flip własny)
- Gdzie: sekcja statystyk, "nasze liczby", dowody, pricing, dashboard, hero z metryką.
- 📱 Mobile: ✅ (lekki; animuj `transform`, nie przeliczaj DOM co klatkę; odpal raz)

### Połysk przejeżdżający po tekście (Shiny / shimmer text)
- Co to: smuga światła przejeżdża po napisie (jak refleks na metalu/chromie).
- Szukaj: `shiny text effect`, `shimmer text css`, `text shine sweep`
- Czym zrobić: CSS gradient-maska + animacja `background-position` (połysk pod kątem).
- Trudność: ★☆☆
- Gdzie: "Premium", "New", logo, odznaki.
- 📱 Mobile: ✅

### Kontur → wypełnienie na hover (Outline fill text)
- Co to: tekst jest tylko obrysem, a na hover wlewa się kolor.
# 02 — Scroll i parallax (Scroll effects)

To, co dzieje się gdy użytkownik przewija. Najmocniejsza rodzina bajerów na "drogie" wrażenie. **Baza pod prawie wszystko: smooth scroll (Lenis) + GSAP ScrollTrigger.** Od 2025 GSAP jest w 100% darmowy, więc to domyślny zestaw.

> Reguła: scroll-efekty kuszą, ale każdy dokłada do długości i wagi strony. Jeden mocny na 2-3 ekrany, nie na każdy.

---

### Płynny scroll (Smooth scroll — Lenis)
- Co to: scroll przestaje "skakać", staje się maślany — i to on synchronizuje wszystkie inne efekty.
- Szukaj: `lenis smooth scroll`, `smooth scroll library`, `locomotive scroll`
- Czym zrobić: **Lenis** (~3KB, dzisiejszy standard). Alternatywa: Locomotive Scroll.
- Trudność: ★☆☆
- Gdzie: cała strona — fundament pod parallax/reveal.
- 📱 Mobile: ⚠️ (na touchu zwykle zostaw natywny scroll; Lenis głównie desktop)

### Parallax (Parallax scrolling)
- Co to: tło rusza się wolniej niż treść → wrażenie głębi.
- Szukaj: `parallax scrolling effect`, `parallax background`, `rellax.js`
- Czym zrobić: CSS (`background-attachment: fixed` — proste), albo **Rellax.js**, albo GSAP ScrollTrigger (`y` zależne od scrolla).
- Trudność: ★☆☆ / ★★☆
- Gdzie: hero, sekcje ze zdjęciami, "warstwowe" tła.
- 📱 Mobile: ⚠️ (`background-attachment: fixed` bywa buggy na iOS — użyj transform albo wyłącz)

### Odsłanianie na scroll (Reveal on scroll / scroll reveal)
- Co to: elementy wjeżdżają (fade + slide/skala) gdy wchodzą w ekran.
- Szukaj: `reveal on scroll`, `AOS animate on scroll`, `scrollreveal`, `scroll-driven animation css`
- Czym zrobić: najlżej **CSS scroll-driven** `animation-timeline: view()` (zero JS, Chrome/FF; fallback do Safari). Gotowiec: **AOS**. Kontrola: GSAP ScrollTrigger.
- Trudność: ★☆☆
- Gdzie: każda sekcja przy wejściu (oszczędnie).
- 📱 Mobile: ✅ (ale skróć dystans i czas; nie ukrywaj treści zbyt długo)

### Pinning / przypięta sekcja (Pinned / sticky section)
- Co to: element "przykleja się" na środku ekranu, a obok niego scrolluje się treść/animacja.
- Szukaj: `pinned section scroll`, `GSAP pin`, `sticky scroll section`
- Czym zrobić: GSAP ScrollTrigger `pin: true`, albo CSS `position: sticky`.
- Trudność: ★★☆
- Gdzie: "jak to działa" (wizual stoi, kroki lecą), feature showcase.
- 📱 Mobile: ⚠️ (pinning bywa ciasny na małym ekranie — testuj, często lepiej rozłożyć w pionie)

### Poziomy scroll (Horizontal scroll section)
- Co to: scrollujesz w dół, a sekcja przesuwa się w bok (galeria/kroki jadą poziomo).
- Szukaj: `horizontal scroll on vertical scroll`, `GSAP horizontal scroll`, `scroll hijack horizontal`
- Czym zrobić: GSAP ScrollTrigger (translateX kontenera mapowany na scroll) + pin.
- Trudność: ★★☆
- Gdzie: portfolio, timeline, galeria produktów.
- 📱 Mobile: ⚠️ (zamień na natywny swipe/scroll-snap poziomy zamiast hijackowania)

### Karty układające się w stos (Sticky stacking cards)
- Co to: kolejne karty "wjeżdżają" i nakładają się jedna na drugą jak talia (każda przykleja się chwilę).
- Szukaj: `stacking cards scroll`, `sticky stacking cards`, `card stack on scroll`
- Czym zrobić: CSS `position: sticky` + `top` (+ lekka skala/rotacja per karta), albo GSAP.
- Trudność: ★★☆
- Gdzie: features, kroki oferty, "wartości".
- 📱 Mobile: ✅ (działa dobrze, jeden mocny scroll-bajer pasujący na telefon)

### Sekwencja klatek na scroll (Image sequence / scroll video)
- Co to: produkt obraca się / animacja gra klatka po klatce w rytm scrolla (efekt Apple AirPods).
- Szukaj: `scroll image sequence`, `apple airpods scroll animation`, `canvas image sequence scroll`
- Czym zrobić: ciąg PNG/JPG rysowany na `<canvas>` wg scroll progress (GSAP ScrollTrigger). Albo `<video>` z `currentTime = progress * duration`.
- Trudność: ★★★
- Gdzie: hero produktowe premium (patrz też skill jack-3d-websites).
- 📱 Mobile: ⚠️ (dużo klatek = waga; zmniejsz rozdzielczość/liczbę klatek albo statyczny obraz)

### Pasek postępu scrolla (Scroll progress bar)
- Co to: cienki pasek u góry pokazuje % przewinięcia strony/artykułu.
- Szukaj: `scroll progress bar`, `reading progress indicator`, `scroll-driven progress css`
- Czym zrobić: czysty CSS scroll-driven `animation-timeline: scroll()` (skalowanie paska). Zero JS.
- Trudność: ★☆☆
- Gdzie: blog, długie landingi, dokumentacja.
- 📱 Mobile: ✅

### Skos od prędkości scrolla (Scroll velocity skew)
- Co to: elementy/marquee lekko się pochylają i przyspieszają zależnie od tempa scrolla — "fizyczny" feel.
- Szukaj: `scroll velocity skew`, `skew on scroll`, `scroll speed marquee`
- Czym zrobić: GSAP ScrollTrigger + `scrollVelocity` mapowane na `skewY`/szybkość marquee.
- Trudność: ★★☆
- Gdzie: portfolio, galerie, "kreatywne" strony.
- 📱 Mobile: ⚠️ (subtelnie albo wyłącz)

### Odsłona przez clip-path / kurtyna (Clip-path reveal / curtain)
- Co to: obraz/sekcja odsłania się maską (kurtyna w górę, koło rośnie, pasy).
- Szukaj: `clip-path reveal scroll`, `curtain reveal effect`, `image mask reveal`
- Czym zrobić: CSS/GSAP animacja `clip-path` (inset/circle/polygon) na scroll.
- Trudność: ★★☆
- Gdzie: wejścia zdjęć, przejścia sekcji.
- 📱 Mobile: ✅

### Scrollytelling (Scrollytelling)
- Co to: wizual stoi przypięty, a obok lecą kolejne bloki tekstu — i wizual zmienia się pod każdy (mapa, wykres, produkt).
- Szukaj: `scrollytelling`, `scroll story`, `sticky graphic scroll steps`
- Czym zrobić: GSAP ScrollTrigger (pin wizualu + triggery per krok). Do danych: Scrollama.js.
- Trudność: ★★★
- Gdzie: case study, raporty, "jak to działa" z danymi.
- 📱 Mobile: ⚠️ (uprość: wizual nad tekstem, krótsze kroki)

### Zoom na scroll (Scroll zoom)
- Co to: zdjęcie/hero powoli się przybliża albo oddala gdy scrollujesz (czasem "wlatujesz" w obraz).
- Szukaj: `scroll zoom effect`, `image scale on scroll`, `zoom parallax`
- Czym zrobić: GSAP ScrollTrigger na `scale`, albo scroll-driven CSS.
- Trudność: ★★☆
- Gdzie: hero, przejście do następnej sekcji.
- 📱 Mobile: ✅ (delikatnie)

### Pełnoekranowy scroll-snap (Full-page scroll snap)
- Co to: strona "zatrzaskuje się" sekcja po sekcji (jeden ekran = jedna sekcja).
- Szukaj: `scroll snap fullpage`, `css scroll-snap`, `fullpage.js`
- Czym zrobić: CSS `scroll-snap-type: y mandatory` (natywne, lekkie). Gotowiec: fullPage.js.
- Trudność: ★☆☆ (CSS) / ★★☆ (lib)
- Gdzie: prezentacje, portfolio, landingi "slajdowe".
- 📱 Mobile: ⚠️ (testuj — bywa walka z natywnym scrollem; CSS scroll-snap OK)

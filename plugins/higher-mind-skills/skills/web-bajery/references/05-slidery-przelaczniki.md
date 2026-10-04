# 05 — Slidery, karuzele, hero slideshow i przełączniki

Wszystko co się "przewija po jednym" i wszystko co "przełącza widok". W tym przemieniające się slajdy w hero.

> Domyślny silnik: **Swiper** (najwięcej efektów, touch out-of-the-box) albo **Embla** (~4KB, pełna kontrola, silnik shadcn/ui). Keen Slider gdy chcesz lekkość bez stylów.

---

### Karuzela / slider (Carousel / slider)
- Co to: treści przewijane poziomo, po jednej/kilka na raz, ze strzałkami i kropkami.
- Szukaj: `carousel slider`, `swiper js`, `embla carousel`, `keen slider`
- Czym zrobić: **Swiper** (bogaty), **Embla** (lekki, kontrola), **Keen Slider** (touch). Natywnie: CSS `scroll-snap`.
- Trudność: ★☆☆ (CSS) / ★★☆ (lib)
- Gdzie: produkty, galerie, opinie.
- 📱 Mobile: ✅ (to wręcz wzorzec mobilny — swipe; CSS scroll-snap najlżejszy)

### Hero slideshow / przemieniające się slajdy (Hero slideshow)
- Co to: w hero zmieniają się całe slajdy (zdjęcie + tekst), automatycznie, z płynnym przejściem (crossfade/slide).
- Szukaj: `hero slideshow`, `fullscreen slider`, `swiper fade effect`, `hero carousel autoplay`
- Czym zrobić: **Swiper** z `effect: 'fade'` + `autoplay`. Każdy slajd = tło + nagłówek + CTA.
- Trudność: ★★☆
- Gdzie: hero stron usługowych, hotele, restauracje, agencje.
- 📱 Mobile: ✅ (skróć teksty, jeden CTA; rozważ wolniejszy autoplay)

### Ken Burns (Ken Burns / slow zoom slideshow)
- Co to: zdjęcia w hero powoli się przybliżają i przesuwają (kino-feel), z crossfade między nimi.
- Szukaj: `ken burns effect css`, `slow zoom slideshow`, `pan zoom hero images`
- Czym zrobić: CSS `@keyframes` `scale`+`translate` na zdjęciu, crossfade `opacity` między warstwami. Zero JS.
- Trudność: ★☆☆
- Gdzie: hero "klimatyczne" — turystyka, nieruchomości, gastro.
- 📱 Mobile: ✅ (lekki, ładny)

### Coverflow / karuzela 3D (Coverflow / 3D carousel)
- Co to: slajdy ustawione w 3D, środkowy z przodu, boczne obrócone (jak stary iTunes).
- Szukaj: `coverflow slider`, `3d carousel`, `swiper coverflow effect`
- Czym zrobić: **Swiper** `effect: 'coverflow'`.
- Trudność: ★★☆
- Gdzie: galerie, "wyróżnione", aplikacje/produkty.
- 📱 Mobile: ⚠️ (działa, ale pokaż mniej sąsiednich slajdów)

### Przeciągana karuzela (Draggable / flick carousel)
- Co to: chwytasz i rzucasz slajdy z inercją (momentum), bez strzałek.
- Szukaj: `draggable carousel`, `flickity`, `drag slider momentum`, `embla drag`
- Czym zrobić: **Embla** / **Keen** (drag wbudowany), **Flickity**, albo GSAP Draggable + InertiaPlugin (darmowy).
- Trudność: ★★☆
- Gdzie: portfolio, galerie, "przeglądaj".
- 📱 Mobile: ✅ (swipe natywnie)

### Suwak przed/po (Before/after slider)
- Co to: przeciągasz uchwyt i odsłaniasz "po" na tle "przed" (retusz, remont, efekt).
- Szukaj: `before after slider`, `image comparison slider`, `img-comparison-slider`
- Czym zrobić: web component **img-comparison-slider**, albo prosty JS na `clip-path`/szerokości.
- Trudność: ★☆☆
- Gdzie: project-c (remont przed/po!), retusz, beauty, case studies.
- 📱 Mobile: ✅ (działa na drag palcem)

### Marquee logotypów (Infinite logo marquee)
- Co to: loga klientów/partnerów jadą w nieskończonej pętli (czasem dwa rzędy w przeciwne strony).
- Szukaj: `logo marquee`, `infinite logo scroll`, `marquee opposite direction`
- Czym zrobić: CSS `@keyframes translateX` na zduplikowanej liście (bez szwu). Zero JS.
- Trudność: ★☆☆
- Gdzie: "zaufali nam", partnerzy, dowody.
- 📱 Mobile: ✅

### Marquee wielorzędowy / przeciwbieżny (Multi-row alternating marquee)
- Co to: kilka pasków jeden pod drugim, każdy jedzie w PRZECIWNĄ stronę (rząd 1 →, rząd 2 ←, rząd 3 →). Daje rytm i "żywą ścianę" ruchu. Wariant: różne prędkości per rząd dla głębi.
- Szukaj: `alternating marquee rows`, `opposing marquee`, `multi row marquee opposite direction`, `bidirectional marquee`
- Czym zrobić: CSS — ten sam keyframe `translateX`, a co drugi rząd dostaje `animation-direction: reverse` (albo ujemny kierunek). Płynniej ze scroll-velocity (patrz `02`) — tempo i kierunek pasków reagują na prędkość scrolla.
- Trudność: ★☆☆ (CSS) / ★★☆ (ze scroll-velocity)
- Gdzie: sekcja brandowa, "co robimy" (słowa/tagi/usługi), ściana zdjęć, social proof, stopka.
- 📱 Mobile: ✅ (zmniejsz font/wysokość rzędów; 2 rzędy zamiast 3)

### Slider opinii (Testimonial slider)
- Co to: cytaty/opinie przewijane, często z avatarami i auto-play.
- Szukaj: `testimonial slider`, `review carousel`, `quotes slider`
- Czym zrobić: Swiper/Embla; albo marquee kart dla "ściany opinii".
- Trudność: ★☆☆
- Gdzie: social proof, sekcja zaufania.
- 📱 Mobile: ✅

### Galeria z miniaturami / lightbox (Thumbnail gallery + lightbox)
- Co to: klik w miniaturę → duże zdjęcie w nakładce, przewijanie w lightboxie.
- Szukaj: `lightbox gallery`, `glightbox`, `photoswipe`, `thumbnail slider sync`
- Czym zrobić: **GLightbox** / **PhotoSwipe**; Swiper ma tryb thumbs (sync dwóch sliderów).
- Trudność: ★★☆
- Gdzie: portfolio, sklep, nieruchomości, galeria realizacji.
- 📱 Mobile: ✅ (PhotoSwipe jest mobile-first, pinch-zoom)

### Karty do "swipe'owania" (Swipe cards / Tinder stack)
- Co to: karty przerzucasz w lewo/prawo z talii.
- Szukaj: `swipe cards`, `tinder card stack`, `swiper cards effect`
- Czym zrobić: **Swiper** `effect: 'cards'`, albo GSAP Draggable.
- Trudność: ★★☆
- Gdzie: onboarding, quiz, "polub/pomiń".
- 📱 Mobile: ✅

---

## Przełączniki (Toggles / switches / segmented)

### Przełącznik on/off (Toggle switch)
- Co to: stylowany checkbox jako "suwak" (włącz/wyłącz), gałka jedzie z animacją.
- Szukaj: `toggle switch css`, `ios switch`, `animated toggle`
- Czym zrobić: CSS na `<input type="checkbox">` (`:checked` + `transform` na gałce). Zero JS.
- Trudność: ★☆☆
- Gdzie: ustawienia, dark mode, opcje.
- 📱 Mobile: ✅ (zadbaj o min. 44px tap target)

### Segmented control / pill toggle (Segmented control)
- Co to: 2-3 opcje w "pigułce", aktywne tło-wskaźnik płynnie jedzie pod zaznaczoną.
- Szukaj: `segmented control`, `pill toggle`, `sliding tab indicator`
- Czym zrobić: radio inputy + wskaźnik `position:absolute` animowany `transform`. (Patrz skill mobile-optimization: toggle na tabelach porównawczych.)
- Trudność: ★★☆
- Gdzie: filtry, "miesięcznie/rocznie", widoki.
- 📱 Mobile: ✅

### Toggle ceny mies./rok (Pricing billing toggle)
- Co to: przełącznik miesięcznie↔rocznie, ceny przeliczają się/animują (często "-20%").
- Szukaj: `pricing toggle monthly yearly`, `billing switch animation`
- Czym zrobić: toggle + JS podmieniający/animujący liczby (count-up), badge oszczędności.
- Trudność: ★★☆
- Gdzie: pricing.
- 📱 Mobile: ✅

### Taby z jadącym wskaźnikiem (Animated tabs / sliding underline)
- Co to: zakładki, pod aktywną płynnie przesuwa się podkreślenie/tło.
- Szukaj: `animated tabs`, `sliding tab indicator`, `magic line tabs`
- Czym zrobić: CSS/JS — wskaźnik animowany do szerokości/pozycji aktywnego taba.
- Trudność: ★★☆
- Gdzie: sekcje treści, dashboardy, FAQ kategorie.
- 📱 Mobile: ✅ (przewijane taby jeśli dużo)

### Suwak wartości (Range slider)
- Co to: interaktywny suwak (cena, ilość, kalkulator) z żywą wartością.
- Szukaj: `custom range slider`, `noUiSlider`, `range input styling`
- Czym zrobić: stylowany `<input type="range">`, albo **noUiSlider** (zakresy, dwa uchwyty).
- Trudność: ★★☆
- Gdzie: filtry sklepu, kalkulatory (np. wycena), konfiguratory.
- 📱 Mobile: ✅ (duży uchwyt pod palec)

# 03 — Kursor, hover i reakcja na myszkę (Cursor & hover)

Cała ta rodzina to **wyłącznie desktop** — telefon nie ma kursora ani hovera. ZAWSZE owijaj w `@media (hover: hover) and (pointer: fine)` i dawaj sensowny wariant bez nich. To powiedziawszy — to najszybszy sposób na "premium/agency" feel na dużym ekranie.

---

### Custom cursor (Custom cursor)
- Co to: domyślną strzałkę zastępuje kropka + pierścień, który leci za nią z opóźnieniem (lerp).
- Szukaj: `custom cursor`, `cursor follower`, `dot ring cursor`
- Czym zrobić: 1-2 `div`y pozycjonowane na `mousemove` z interpolacją (lerp); `cursor: none` na body. Lib: "mouse-animations".
- Trudność: ★★☆
- Gdzie: portfolio, agencje, premium.
- 📱 Mobile: ❌ przywróć systemowy kursor (i tak nie ma) — efekt nie istnieje na touchu

### Magnetyczne elementy (Magnetic buttons / magnetic elements)
- Co to: przycisk/ikona "przyciąga się" do kursora gdy się zbliżysz — i wraca po odejściu.
- Szukaj: `magnetic button`, `magnetic hover effect`, `magnetic elements library`
- Czym zrobić: JS — przesuwaj element o ułamek dystansu do kursora (GSAP `quickTo` jest idealny). Lib: "Magnetic Elements".
- Trudność: ★★☆
- Gdzie: główne CTA, ikony social, nav.
- 📱 Mobile: ❌ zostaw zwykły przycisk

### Blob / morfujący ślad kursora (Cursor blob / gooey trail)
- Co to: organiczna plama płynie za myszką, rozciąga się przy ruchu, zbiera w kółko gdy stoi.
- Szukaj: `cursor blob`, `gooey cursor`, `blob cursor trail`
- Czym zrobić: canvas + lerp + SVG `feGaussianBlur`+`feColorMatrix` ("gooey filter"). Lib: blobity.
- Trudność: ★★★
- Gdzie: kreatywne portfolio.
- 📱 Mobile: ❌

### Ślad cząstek (Particle / trail cursor)
- Co to: za kursorem zostaje znikający ślad kropek/iskier.
- Szukaj: `cursor trail effect`, `particle trail mouse`, `mouse trail`
- Czym zrobić: canvas, tablica punktów z zanikaniem; albo tsParticles "mouse trail".
- Trudność: ★★☆
- Gdzie: eventy, zabawne marki, święta.
- 📱 Mobile: ❌

### Reflektor / odwracanie (Spotlight / invert cursor)
- Co to: kursor jest "dziurą światła" w ciemnej nakładce, albo odwraca kolory pod sobą.
- Szukaj: `spotlight cursor`, `invert cursor effect`, `mask cursor`
- Czym zrobić: `radial-gradient` maska podążająca za myszką (CSS var --x/--y), albo `mix-blend-mode: difference`.
- Trudność: ★★☆
- Gdzie: ciemne hero, "odkrywanie" treści.
- 📱 Mobile: ❌

### Podgląd obrazka przy linku (Hover image reveal on links)
- Co to: najeżdżasz na pozycję listy/menu, a przy kursorze pojawia się miniatura/wideo tej pozycji.
- Szukaj: `hover image reveal links`, `cursor image preview`, `menu hover thumbnail`
- Czym zrobić: JS pokazujący obraz przy kursorze na `mouseenter`; często GSAP + lekki distortion.
- Trudność: ★★☆
- Gdzie: portfolio (lista projektów), menu, blog.
- 📱 Mobile: ❌ pokaż miniatury inline w liście

### Tilt 3D karty (3D tilt card)
- Co to: karta przechyla się w 3D śledząc kursor (jak trzymana w ręce), często z połyskiem.
- Szukaj: `tilt card effect`, `vanilla-tilt`, `3d tilt hover`
- Czym zrobić: **vanilla-tilt.js** (gotowiec) albo CSS `perspective` + `rotateX/Y` z JS.
- Trudność: ★★☆
- Gdzie: karty produktów, pricing, zdjęcia zespołu, karty NFT-style.
- 📱 Mobile: ❌ zostaw płaską kartę (ewentualnie tilt na żyroskop — rzadko warto)

### Distortion obrazka na hover (WebGL distortion hover)
- Co to: zdjęcie "faluje"/zniekształca się na najechanie albo płynnie przechodzi w inne (displacement).
- Szukaj: `webgl hover distortion`, `image distortion effect`, `hover.js displacement`, `curtains.js`
- Czym zrobić: **hover-effect** (hover.js, potrzebuje Three.js) z mapą przemieszczenia; albo **Curtains.js** + własny shader GLSL.
- Trudność: ★★★
- Gdzie: portfolio, galerie premium, hero produktowe.
- 📱 Mobile: ❌ zwykłe zdjęcie / prosty CSS crossfade

### Połysk po przycisku (Button shine / sweep)
- Co to: smuga światła przejeżdża po przycisku na hover.
- Szukaj: `button shine effect`, `button sweep hover`, `gloss hover`
- Czym zrobić: CSS pseudo-element z gradientem, `transform: translateX` na hover.
- Trudność: ★☆☆
- Gdzie: CTA, przyciski premium.
- 📱 Mobile: ⚠️ (na touch zostaw — można odpalać raz po wejściu w ekran)

### Ripple (Ripple / material ripple)
- Co to: fala rozchodzi się z punktu kliknięcia (jak Material Design).
- Szukaj: `ripple effect button`, `material ripple`, `click ripple css`
- Czym zrobić: JS dodający kółko skalujące się z punktu kliknięcia + CSS.
- Trudność: ★☆☆
- Gdzie: przyciski, karty klikalne, listy.
- 📱 Mobile: ✅ (działa na tap — jeden z niewielu "cursor-ish" co gra na mobile)

### Gooey hover (Gooey / liquid hover)
- Co to: tło przycisku/menu "rozlewa się" jak ciecz na hover.
- Szukaj: `gooey hover effect`, `liquid button`, `gooey menu svg filter`
- Czym zrobić: SVG gooey filter (`feGaussianBlur`+`feColorMatrix`) + animowane bloby pod tekstem.
- Trudność: ★★★
- Gdzie: odważne marki, nav.
- 📱 Mobile: ❌ zostaw zwykłe tło

### Podnoszenie / lift na hover (Hover lift / grow)
- Co to: karta unosi się, rośnie cień, lekko skaluje — klasyk "klikalności".
- Szukaj: `hover lift card`, `card hover shadow`, `hover grow`
- Czym zrobić: CSS `transform: translateY(-6px) scale(1.02)` + `box-shadow`, `transition`.
- Trudność: ★☆☆
- Gdzie: każda karta/CTA.
- 📱 Mobile: ⚠️ (przenieś "podniesienie" na stan `:active`/tap)

### Animowane podkreślenie linku (Animated underline)
- Co to: podkreślenie wjeżdża/rozjeżdża się spod linku na hover (od lewej, od środka, "elastyczne").
- Szukaj: `animated underline hover`, `link underline animation`, `text-decoration animation`
- Czym zrobić: CSS pseudo-element + `transform: scaleX` z `transform-origin`, albo `background-size`.
- Trudność: ★☆☆
- Gdzie: nav, linki w treści, stopka.
- 📱 Mobile: ⚠️ (zostaw widoczne podkreślenie statyczne)

### Hero reagujące na mysz (Mouse parallax / cursor-reactive hero)
- Co to: warstwy hero (tytuł, grafika, tło) przesuwają się delikatnie w stronę/od kursora — głębia 3D bez scrolla.
- Szukaj: `mouse parallax effect`, `cursor reactive hero`, `pointer move parallax`
- Czym zrobić: JS na `mousemove` → `translate` warstw o różny współczynnik; lerp dla gładkości.
- Trudność: ★★☆
- Gdzie: hero, sekcje "okładkowe".
- 📱 Mobile: ❌ statyczna kompozycja (albo subtelny ruch na żyroskopie)

### Siatka obrazów z distortion (Cursor grid distortion)
- Co to: cała siatka zdjęć/tekstur faluje wokół kursora (grid bend).
- Szukaj: `webgl grid distortion`, `cursor grid bend`, `image grid distortion hover`
- Czym zrobić: WebGL shader (gotowce na Codrops/Gumroad "grid distortion").
- Trudność: ★★★
- Gdzie: hero galeryjne, portfolio, "wow" landing.
- 📱 Mobile: ❌ statyczna siatka

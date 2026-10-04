# 06 — Micro-interakcje, elementy pływające/anchored i ikony

Drobne bajery, które dają stronie "życie" i poczucie jakości. Tanie, a robią ogromną różnicę. Tu też: pływające/przyklejone elementy (fruwające menu, sticky CTA) oraz custom ikony zamiast emoji.

---

## A) Przyciski i CTA

### Świecący CTA / glow button (Glowing CTA / neon button)
- Co to: na przycisku pojawia się poświata — stała, pulsująca, albo rozbłyskująca na hover.
- Szukaj: `glow button`, `neon button css`, `glowing cta`, `box-shadow glow pulse`
- Czym zrobić: CSS `box-shadow` w kolorze akcentu (kilka warstw) + na hover większy blur; pulsujący = `@keyframes` na shadow. Mocniejszy = rozmyty `::before` w gradiencie.
- Trudność: ★☆☆
- Gdzie: główne CTA, pricing "polecane", dark hero.
- 📱 Mobile: ✅ (statyczny glow OK; mocne pulsowanie ogranicz)

### Pulsujący akcent (Pulse / breathing)
- Co to: element delikatnie "oddycha" (skala/poświata) — przyciąga wzrok bez krzyku. Też: kropka powiadomienia z falą.
- Szukaj: `pulse animation css`, `breathing button`, `notification dot pulse`, `pulse ring`
- Czym zrobić: CSS `@keyframes` `scale`/`opacity`; fala = rozszerzający się `::after` z zanikiem.
- Trudność: ★☆☆
- Gdzie: CTA, "live", powiadomienia, mapa (pinezka).
- 📱 Mobile: ✅ (subtelnie)

### Magnetyczny / shine / ripple
- Patrz `03-kursor-hover.md` (magnetic button, button shine) i niżej (ripple). Na CTA łącz max 2 mikro-efekty, nie wszystkie.

---

## B) Ruch elementów

### Fruwające / lewitujące obrazki (Floating / levitating images)
- Co to: obrazki, karty, ikony unoszą się w górę-dół w pętli (czasem z cieniem "oddychającym") — wrażenie lekkości.
- Szukaj: `floating animation css`, `levitating image`, `float up down keyframes`
- Czym zrobić: CSS `@keyframes float { translateY(-12px) }`, różne `animation-delay` dla kilku elementów; cień animowany osobno.
- Trudność: ★☆☆
- Gdzie: hero (mockupy produktu), sekcje feature, ilustracje.
- 📱 Mobile: ✅ (zmniejsz amplitudę)

### Pływające + parallax na mysz
- Połączenie floata z reakcją na kursor → patrz `03` (mouse parallax) i `04` (floating shapes). Na mobile zostaw sam float.

---

## C) Elementy pływające / przyklejone (Floating & anchored)

### Sticky CTA / pasek akcji (Sticky CTA bar)
- Co to: przycisk/pasek "Zamów"/"Napisz" przykleja się na dole lub górze gdy scrollujesz.
- Szukaj: `sticky cta`, `floating action bar`, `sticky bottom button`
- Czym zrobić: CSS `position: sticky`/`fixed`; pojawienie po przewinięciu = JS (IntersectionObserver) + slide-in.
- Trudność: ★☆☆
- Gdzie: landing usługowy, sklep, mobile (kluczowe!).
- 📱 Mobile: ✅ (wręcz must — CTA zawsze w zasięgu kciuka; patrz mobile-optimization)

### Fruwające / chowane menu (Floating nav / smart sticky header)
- Co to: nawigacja "płynie" nad treścią (odklejona, glassmorphism), chowa się przy scrollu w dół i wraca przy scrollu w górę; czasem zmienia rozmiar/tło.
- Szukaj: `floating navbar`, `hide on scroll header`, `shrinking sticky header`, `morphing navbar`
- Czym zrobić: `position: fixed` + JS śledzący kierunek scrolla (toggle klasy translateY); zmiana tła/blura po progu.
- Trudność: ★★☆
- Gdzie: prawie każda nowoczesna strona.
- 📱 Mobile: ✅ (chowanie odzyskuje miejsce; pilnuj że hamburger działa)

### Pływający przycisk akcji / FAB (Floating Action Button)
- Co to: okrągły przycisk w rogu (kontakt, WhatsApp, "do góry", chat) — zawsze widoczny.
- Szukaj: `floating action button`, `FAB`, `whatsapp floating button`
- Czym zrobić: `position: fixed` w rogu, cień + hover-grow; rozwijane mini-menu opcjonalnie.
- Trudność: ★☆☆
- Gdzie: kontakt/WhatsApp (project-c!), chat, powrót do góry.
- 📱 Mobile: ✅ (nie zasłaniaj treści/CTA; trzymaj safe-area)

### Dock / pływający pasek (Floating dock / macOS dock)
- Co to: pasek ikon, które powiększają się przy najechaniu (jak dock w macOS).
- Szukaj: `floating dock`, `macos dock magnify`, `magnifying dock nav`
- Czym zrobić: JS skalujący ikony wg odległości od kursora (lub gotowiec z Aceternity/Magic UI).
- Trudność: ★★☆
- Gdzie: portfolio, nietypowa nawigacja, "appkowe" strony.
- 📱 Mobile: ❌ (efekt powiększania = hover) → zwykły pasek/bottom nav

### Powrót do góry (Scroll-to-top button)
- Co to: strzałka w rogu pojawiająca się po przewinięciu, klik = płynnie na górę.
- Szukaj: `scroll to top button`, `back to top fade in`
- Czym zrobić: `position: fixed` + IntersectionObserver (pokaż po 1 ekranie) + `scrollTo({behavior:'smooth'})`.
- Trudność: ★☆☆
- Gdzie: długie strony, blog.
- 📱 Mobile: ✅

### Anchored spis treści / scroll-spy (Sticky TOC / scroll-spy)
- Co to: boczny spis treści przyklejony, podświetla aktywną sekcję w miarę scrolla.
- Szukaj: `scrollspy`, `sticky table of contents`, `active section nav`
- Czym zrobić: `position: sticky` + IntersectionObserver podświetlający link aktywnej sekcji.
- Trudność: ★★☆
- Gdzie: dokumentacja, długie artykuły, oferty.
- 📱 Mobile: ⚠️ (zamień na rozwijany pasek u góry albo ukryj)

---

## D) Feedback (reakcja na akcję)

### Ripple (klik fala) — patrz `03-kursor-hover.md`. Działa też na tap (mobile ✅).

### Confetti / wystrzał (Confetti burst)
- Co to: kolorowe confetti wybucha po sukcesie (zapis, zakup, "dziękujemy").
- Szukaj: `confetti effect`, `canvas-confetti`, `tsparticles confetti`
- Czym zrobić: **canvas-confetti** (1 funkcja) albo tsParticles confetti.
- Trudność: ★☆☆
- Gdzie: potwierdzenia, "thank you", checkout, formularz wysłany.
- 📱 Mobile: ✅ (krótko)

### Wybuch serca / like (Like / heart burst)
- Co to: serce "pęka" w cząstki po polubieniu (jak Instagram/Twitter).
- Szukaj: `heart burst animation`, `like button animation`, `particle burst on click`
- Czym zrobić: CSS/JS — skala serca + rozlatujące się cząstki; gotowe Lottie.
- Trudność: ★★☆
- Gdzie: społeczność, blog, produkty.
- 📱 Mobile: ✅

### Rysujący się "ptaszek" (Animated checkmark / success)
- Co to: po sukcesie rysuje się fajka w kółku.
- Szukaj: `animated checkmark`, `success tick svg animation`, `stroke checkmark`
- Czym zrobić: SVG `stroke-dashoffset` animacja (CSS), albo Lottie.
- Trudność: ★☆☆
- Gdzie: formularze, płatność, onboarding.
- 📱 Mobile: ✅

### Toast / snackbar (Toast notification)
- Co to: mały komunikat wjeżdża z rogu ("Zapisano", "Skopiowano") i znika.
- Szukaj: `toast notification`, `snackbar`, `toastify`
- Czym zrobić: **Toastify JS** / własny `position:fixed` + slide+fade + auto-dismiss.
- Trudność: ★☆☆
- Gdzie: akcje, formularze, dashboard.
- 📱 Mobile: ✅ (nie zasłaniaj dolnego CTA)

### Kopiuj z potwierdzeniem (Copy-to-clipboard feedback)
- Co to: klik "kopiuj" → ikona zmienia się w ptaszka / "Skopiowano!".
- Szukaj: `copy to clipboard animation`, `copy button feedback`
- Czym zrobić: `navigator.clipboard.writeText` + zmiana ikony/tekstu na 1.5s.
- Trudność: ★☆☆
- Gdzie: kod, kupony, kontakt (email/telefon).
- 📱 Mobile: ✅

### Animowane pola formularza (Floating label / input focus)
- Co to: etykieta "wskakuje" nad pole na focus, podkreślenie/obwódka animuje, walidacja na żywo.
- Szukaj: `floating label input`, `input focus animation`, `material text field`
- Czym zrobić: CSS `:focus`/`:placeholder-shown` + transform etykiety; obwódka animowana.
- Trudność: ★★☆
- Gdzie: formularze kontaktu/wyceny, logowanie.
- 📱 Mobile: ✅ (PAMIĘTAJ: font inputa ≥16px, bo iOS zoomuje — patrz mobile-optimization)

---

## E) Ikonografia — custom ikony zamiast emoji

Zasada: **nie używaj emoji jako ikon UI.** Emoji renderują się różnie na każdym systemie (inny styl na iOS/Android/Windows), łamią spójność i wyglądają tanio. Zamiast tego spójny set SVG dopasowany do designu (grubość linii, róg, grid).

### Spójny set ikon SVG (Icon set / icon system)
- Co to: jedna rodzina ikon w całym projekcie (ta sama grubość linii, ten sam grid 24px).
- Szukaj: `lucide icons`, `phosphor icons`, `tabler icons`, `heroicons`, `iconoir`, `remix icon`
- Czym zrobić: **Lucide** (czyste, lekkie, mega popularne), **Phosphor** (3 wagi + fill), **Tabler** (2900+ outline), **Heroicons** (od twórców Tailwind), **Iconoir** (darmowe). Wstaw inline SVG (można kolorować `currentColor`, animować).
- Trudność: ★☆☆
- Gdzie: nav, listy feature, "jak to działa", przyciski.
- 📱 Mobile: ✅ (SVG skaluje się idealnie, ostre na retina)

### Własne ikony pod design (Custom icon design)
- Co to: ikony rysowane pod konkretny grid i język wizualny marki (unikalność, nie "stockowe").
- Szukaj: `custom icon set design`, `icon grid system 24px`, `stroke icon design`
- Czym zrobić: rysuj na siatce (24/2px stroke), eksport SVG, optymalizuj **SVGOMG**. Trzymaj jako sprite albo komponenty.
- Trudność: ★★☆
- Gdzie: marka premium, gdy spójność wizualna jest atutem (strony agency-site).
- 📱 Mobile: ✅

### Animowane ikony (Animated icons)
- Co to: ikona animuje się na hover/klik/stan (menu→X, play→pause, serce, dzwonek dzwoni).
- Szukaj: `animated icons`, `lordicon`, `lottie icons`, `rive icons`, `svg icon hover animation`
- Czym zrobić: **Lordicon** (gotowe animowane), **Lottie** (z After Effects), **Rive** (interaktywne ze stanami), albo własny SVG + CSS/GSAP.
- Trudność: ★★☆
- Gdzie: nav (hamburger morph), feature, toggle stanów, mikro-nagrody.
- 📱 Mobile: ✅ (animacja na tap zamiast hover)

### Sprite SVG / system ikon (SVG sprite)
- Co to: wszystkie ikony w jednym pliku, używane przez `<use>` — wydajnie i spójnie.
- Szukaj: `svg sprite`, `svg symbol use`, `icon sprite system`
- Czym zrobić: jeden `<svg>` z `<symbol id>`, wołasz `<use href="#ikona">`. Kolor przez `currentColor`.
- Trudność: ★★☆
- Gdzie: projekty z wieloma ikonami (wydajność, jeden request).
- 📱 Mobile: ✅

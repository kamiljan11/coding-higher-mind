# 10 — Gdzie szukać i podglądać bajery (inspiracja)

Rozwiązanie problemu "nie wiem jak tego szukać". Tu masz mapę: gdzie podglądać efekty, skąd brać gotowy kód, i **przepis na frazy wyszukiwania**.

---

## Pętla "nazwa → zobacz to → weź kod"

1. Masz nazwę efektu (z reference'ów 01-08) → wpisz ją na **CodePen** albo **Codrops**.
2. Zobacz 5-10 wariantów, wybierz styl.
3. Weź kod (CodePen) albo tutorial (Codrops) i dostosuj.

---

## Galerie inspiracji (co jest możliwe / trendy)

- **Awwwards** (awwwards.com) — najlepsze strony świata, codzienne nagrody. Filtruj po technologii/typie. Tu zobaczysz najnowsze bajery zanim staną się standardem.
- **Godly** (godly.website) — kuratorowane, mocno "nowoczesne/eksperymentalne".
- **Land-book** (land-book.com) — landing page'e, świetne do układów i hero.
- **SiteInspire** (siteinspire.com) — czysty, redakcyjny dobór.
- **Httpster** (httpster.net) — śmielsze, "indie" estetyki.
- **One Page Love** (onepagelove.com) — strony jednoekranowe.
- **Lapa Ninja / Curated.design / Minimal.gallery** — dodatkowe kuratorskie zbiory.
- **Mobbin** (mobbin.com) — wzorce UI (głównie apki) — dobre do micro-interakcji.

## Kod i tutoriale (jak to zrobić)

- **Codrops / Tympanus** (tympanus.net/codrops) — najlepsze tutoriale efektów (WebGL, scroll, tekst, hover) + "Playground". Szukaj tu zaawansowanych bajerów.
- **CodePen** (codepen.io) — wpisz nazwę efektu, masz setki działających dem do podejrzenia/forka.
- **Osmo** (osmo.supply) — gotowe, dopracowane komponenty/efekty (GSAP/Webflow) od topowych twórców.
- **Frontend Horse / Codrops Collective** — newsy o świeżych efektach.
- **GSAP Showcase + Docs** (gsap.com) — przykłady i dokumentacja (teraz wszystko darmowe).

## Gotowe komponenty (React/Tailwind — stack uzytkownika)

- **Aceternity UI** (ui.aceternity.com) — efektowne sekcje/hero z animacją (kopiuj-wklej).
- **Magic UI** (magicui.design) — animowane komponenty + marquee, particles, beams.
- **ReactBits** (reactbits.dev) — animowany tekst, tła, komponenty.
- **Hover.dev** — animowane UI (Framer Motion/Tailwind).
- **shadcn/ui** (ui.shadcn.com) — baza komponentów (karuzela = Embla pod spodem).
- **Cult UI / HyperUI / Motion Primitives** — dodatkowe zestawy.

## Generatory (klikasz → masz asset)

- Mesh/gradient: **MagicPattern**, **fffuel (ffflux)**, **FWD Tools**, **auroragradient.com**.
- Bloby: **blobmaker.app**, **blobs.app**.
- Fale/kształty SVG: **getwaves.io**, **Haikei**.
- Wzory tła: **heropatterns.com**, **pattern.monster**.
- Cienie/glow: **shadows.brumm.af**, **box-shadow generators**.
- Optymalizacja SVG: **SVGOMG**.
- Ease/spring: **easings.net**, **GSAP Ease Visualizer**.

---

## Przepis na frazy wyszukiwania (recipe)

Składaj: **[co to robi] + [medium/technologia] + [opcjonalnie: "effect"/"animation"]**. Po angielsku — tak jest 10× więcej wyników.

| Chcę... | Wpisz |
|---------|-------|
| tekst który się sam pisze | `typewriter effect codepen` |
| słowo które się zmienia w nagłówku | `rotating words css` / `animated headline` |
| coś co reaguje na scroll | `scroll triggered animation gsap` |
| efektowny kursor | `custom cursor effect codepen` |
| karta przechylająca się w 3D | `tilt card hover vanilla-tilt` |
| świecący przycisk | `glow button css` / `neon cta` |
| pływające obrazki | `floating animation css` |
| przeciwbieżne paski | `opposing marquee` / `alternating marquee rows` |
| animowane tło gradient | `animated gradient background` / `mesh gradient` |
| obiekt 3D do strony | `react three fiber float` / `spline 3d web` |
| gładkie przejścia podstron | `view transitions api` / `barba.js` |
| szkielet ładowania | `skeleton loading shimmer` |

**Trik:** dopisz rok (`2025`/`2026`) dla świeżych technik, albo `awwwards`/`codrops` dla wyższej półki.

---

## Trendy do obserwowania (2026)

- **Scroll-driven typografia** — litery skalują się/obracają na scroll (motion identity).
- **Anti-grid / broken grid** — celowo "rozsypane" układy.
- **Neubrutalism** — surowe, grube, kontrastowe, z mini-grami/easter-eggami.
- **Immersyjne 3D/WebGL** — "wchodzisz" w produkt zamiast scrollować płaską stronę.
- **Bento grid** — modułowe kafle (jak iOS/Apple keynote).
- **Natywny CSS przejmuje bajery** — scroll-driven animations, View Transitions, `@property`, `text-wrap: balance` → mniej JS, więcej za darmo.

---

## Jak tego używać z Claude

Nie musisz pamiętać kodu. Powiedz po prostu:
- "dodaj **rotating words** w hero, słowa: X, Y, Z"
- "zrób sekcję logo jako **multi-row alternating marquee**, 3 rzędy"
- "wrzuć **scroll progress bar** u góry"
- "hero z **floating 3D** obiektem (R3F), fallback PNG na mobile"

Ten skill (`web-bajery`) podpowie Claude nazwę, bibliotekę, wariant i tag mobile — a Claude zbuduje. Po dopracowanie pod telefon → skill `mobile-optimization`.

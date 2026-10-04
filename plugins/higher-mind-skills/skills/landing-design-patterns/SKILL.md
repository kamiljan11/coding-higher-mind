---
name: landing-design-patterns
description: >-
  Katalog sprawdzonych „bajerów” projektowych do landingów B2B (Next.js + Tailwind 4) z gotowym
  kodem: przycisk z wędrującym światłem po obrysie, skośne panele menu, lista 01-06 z panelem
  (ARIA tabs), talia kart sticky, karty procesu na tle z kropek z rosnącym paskiem, hero jako
  karuzela ekranów aplikacji z krokami procesu, pełnoszerokie pasy, ukryty e-mail z licznikiem.
  Użyj PROAKTYWNIE gdy: budujesz albo dopieszczasz landing/stronę firmową, użytkownik mówi
  „dodaj bajer”, „coś kreatywnego”, „jak na a B2B agency landing / kamiljan.com”, „żeby to żyło”,
  „efekt przy przewijaniu”, „animacja przycisku”, „menu z charakterem”, „przełączanie treści”,
  „nakładanie kart”, „tło z kropkami”. Wersja mobilna tych wzorców: skill mobile-optimization
  (references/landing-mobile-patterns.md). NIE gdy: aplikacja/panel (nie landing).
---

# Landing design patterns

Zasady: (1) każdy wzorzec ma powód w treści, nie jest ozdobą dla ozdoby; (2) ruch zawsze
wyłączony przy `prefers-reduced-motion`; (3) dostępność zweryfikowana axe (0 naruszeń) we
wszystkich stanach; (4) wzorce z cudzych stron odczytuj z żywego CSS (Playwright +
getComputedStyle), nie zgaduj. Źródło: a production B2B landing (2026-09), repo `docs/DESIGN-PATTERNS.md`.

## 1. Przycisk z wędrującym światłem (a B2B agency landing)
Obrys 1,5 px = warstwa pod treścią; 2 rozmyte plamki jadą po górnej/dolnej krawędzi (6 s, przesunięte
o 3 s); na hover plamki gasną, obrys = przesuwany gradient marki.
```tsx
<a className="glow-btn group relative inline-flex rounded-[14px] p-[1.5px]" href="#kontakt">
  <span aria-hidden className="absolute inset-0 rounded-[14px] bg-slate-200 transition-opacity duration-500 group-hover:opacity-0" />
  <span aria-hidden className="absolute inset-0 overflow-hidden rounded-[14px] transition-opacity duration-500 group-hover:opacity-0">
    <span className="glow-star glow-star-top" /><span className="glow-star glow-star-top [animation-delay:3s]" />
    <span className="glow-star glow-star-bottom" /><span className="glow-star glow-star-bottom [animation-delay:3s]" />
  </span>
  <span aria-hidden className="glow-shimmer absolute inset-0 rounded-[14px] opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
  <span className="relative z-10 inline-flex rounded-[12.5px] bg-white px-5 py-2.5 text-sm font-semibold">CTA</span>
</a>
```
```css
.glow-star{position:absolute;width:140px;height:45px;filter:blur(5px);background:radial-gradient(circle,var(--brand),transparent 70%)}
.glow-star-top{top:-15px;animation:glow-top 6s linear infinite}
.glow-star-bottom{bottom:-15px;animation:glow-bottom 6s linear infinite}
@keyframes glow-top{0%{opacity:0;transform:translateX(-150%)}20%,80%{opacity:.8}100%{opacity:0;transform:translateX(150%)}}
@keyframes glow-bottom{0%{opacity:0;transform:translateX(150%)}20%,80%{opacity:.8}100%{opacity:0;transform:translateX(-150%)}}
.glow-shimmer{background:linear-gradient(to right,var(--brand),#60a5fa,var(--brand-strong),#3b82f6,var(--brand));background-size:200% 100%}
.glow-btn:hover .glow-shimmer{animation:shimmer 3s linear infinite} @keyframes shimmer{to{background-position:200% center}}
```
Pułapka: komponent nie może narzucać `display` (`inline-flex`), gdy wywołujący chowa go `hidden sm:inline-flex`.

## 2. Skośne panele menu (a B2B agency landing) - tylko desktop
Panel `-skew-x-12` + treść `skew-x-12` (tekst prosto); dwa panele: logo | menu+CTA; „/” jako `<span aria-hidden>`.
Poniżej lg wrappery jako `contents` -> zwykły pasek. To skewX, nie clip-path.
```tsx
<div className="contents lg:flex lg:-skew-x-12 lg:rounded-xl lg:border lg:bg-white/70 lg:backdrop-blur-md lg:px-6 lg:py-3">
  <div className="contents lg:flex lg:skew-x-12 lg:items-center">{logo}</div>
</div>
```

## 3. Lista 01-06 + panel (kamiljan.com, „Jak mogę pomóc”)
Grid `minmax(0,.9fr) minmax(0,1.1fr)`; lewo `role=tablist aria-orientation=vertical`, przyciski z numerem
`01` (font mono, kolor marki gdy aktywny); prawo `role=tabpanel` (wszystkie w DOM, `hidden`), ciemny panel
z poświatą. Przełączanie kliknięciem + strzałki góra/dół/Home/End, NIE hoverem. Telefon: rozwijana lista
albo poziomy rząd chipów scroll-snap z maską zanikania.

## 4. Talia kart sticky (kamiljan.com/o-mnie) - tylko desktop
```tsx
<article style={{ "--deck-top": `calc(7rem + ${i * 14}px)` } as React.CSSProperties}
  className="lg:sticky lg:top-[var(--deck-top)] lg:shadow-[0_-16px_40px_rgb(10_20_48/0.08)]" />
```
Kontener `lg:flex lg:flex-col lg:gap-7 lg:max-w-3xl`. Cień w górę = głębia. Rodzic bez `overflow:hidden`
(clip OK). Na telefonie wyłączone (jak w oryginale).

## 5. Karty procesu (a B2B agency landing, „Proces, który daje przewidywalność”)
- Tło z kropek wygaszone ku brzegom:
```css
.dot-grid{background-image:radial-gradient(rgb(8 106 216/.18) 1px,transparent 1px);background-size:22px 22px;
  mask-image:radial-gradient(70% 60% at 50% 45%,#000 0%,transparent 75%)}
```
- Pasek u góry karty rośnie z krokiem: `<span class="absolute inset-x-0 top-0 h-[3px] bg-slate-100"><span style="width:{(i+1)/n*100}%" class="block h-full bg-gradient-to-r from-brand to-sky-400"/></span>`.
- Schodki: `flex items-end` + `minHeight: 220 + i*28px`. Blady numer: `absolute -bottom-4 right-3 text-8xl text-slate-900/[0.05]`.

## 6. Hero = karuzela ekranów aplikacji (zamiast jednej ilustracji)
Dane jako unia typów po `kind` (invoice | order | quote | ticket | chat), każdy rodzaj = inny ekran wzorowany
na narzędziu z rynku (Rossum: pola + pewność; mail -> ERP; szkic oferty z sumą; triage Zendesk: intencja/
priorytet/przypisanie; czat Intercom Fin z przekazaniem do człowieka). Na każdym slajdzie: kolor akcentu,
ikona, 3 kroki procesu zapalające się po kolei (animation-delay), zdanie po ludzku, plakietka wyniku na
krawędzi okna. Okno bez sztywnej karty (bg-white/70 + blur + poświata w kolorze slajdu). Stała wysokość
sceny (CLS 0), autoplay 3 s + pauza (WCAG 2.2.2), stop po wyborze kropki/poza ekranem. Test danych:
unikalne id/kolory/rodzaje, spójność z progiem pewności.

## 7. Pełnoszerokie pasy
Kontakt: `section.bg-navy` na całą szerokość + treść `max-w-6xl`, przechodzi w stopkę (`border-t white/10`).
Na telefonie ciemne karty zamieniaj w pełnoszerokie pasy (`-mx-4 rounded-none`).

## 8. Ukryty e-mail z licznikiem
Przycisk „Pokaż adres e-mail” -> adres + kopiuj + `window.dataLayer.push({event:"email_reveal", location})`.
Adres nie w HTML (jest w bundlu JS - uczciwie w komentarzu). Parametry zdarzeń bez PII.

## 9. Bento z ilustracjami SVG (a B2B agency landing, usługi)
Ilustracje = ręcznie rysowane inline SVG (okno przeglądarki z wykresem, telefon, kursor), płaskie wypełnienia
w kolorach marki, `absolute -bottom-8 -right-8 rotate-[4deg]`, na hover lekki ruch; karta flagowa ciemna
z siatką `linear-gradient` 28 px. Zero wagi obrazków.

## Checklist po wdrożeniu wzorca
tsc + lint + testy; axe we wszystkich stanach (zakładki, akordeony); zrzut 390 i 1440; brak overflow-x;
brak uciętych napisów (`scrollWidth > clientWidth` na `.truncate`); `prefers-reduced-motion`.

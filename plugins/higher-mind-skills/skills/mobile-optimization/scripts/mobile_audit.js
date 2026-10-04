/*
 * mobile_audit.js — reusable mobile audit measurement.
 *
 * HOW TO USE
 *   1. Open the target page in a browser tool at a mobile viewport (390x844).
 *        Playwright MCP:  browser_resize {width:390,height:844} -> browser_navigate {url}
 *        Claude in Chrome: navigate, then resize the window to ~390px wide.
 *   2. Pass the function below to the evaluate tool:
 *        Playwright MCP:  browser_evaluate { function: "<paste this whole function>" }
 *        Claude in Chrome: javascript_tool with the function body.
 *   3. Read the returned object once to learn its shape, then diagnose against
 *      references/standards.md.
 *
 * It measures only — it changes nothing on the page. Numbers, not opinions.
 * Run AFTER the page has settled (give SPA/JS sites a moment to render).
 */
() => {
  const vw = window.innerWidth, vh = window.innerHeight;
  const docW = document.documentElement.scrollWidth;
  const docH = document.documentElement.scrollHeight;
  const txt = el => (el.textContent || '').trim().slice(0, 22);
  const tag = el => el.tagName.toLowerCase();

  // --- viewport / meta -------------------------------------------------
  const vp = document.querySelector('meta[name=viewport]');
  const vpContent = vp ? vp.content : 'MISSING';
  const zoomBlocked = /user-scalable\s*=\s*no|maximum-scale\s*=\s*1(\D|$)/.test(vpContent);

  // --- horizontal overflow (sideways scroll = broken layout) -----------
  const overflowers = [];
  document.querySelectorAll('*').forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.width > vw + 1 && r.right > vw + 1) {
      overflowers.push(tag(el) + (typeof el.className === 'string' && el.className
        ? '.' + el.className.split(' ').slice(0, 2).join('.') : '') + ' w=' + Math.round(r.width));
    }
  });

  // --- touch targets (Apple 44, Material 48) ---------------------------
  const clickables = [...document.querySelectorAll('a,button,input,select,textarea,[role=button],[onclick]')];
  const small = [];
  clickables.forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;            // hidden — skip
    if (r.height < 44 || r.width < 44) {
      small.push(tag(el) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height) + ' "' + txt(el) + '"');
    }
  });

  // --- inputs: font < 16px triggers iOS zoom; missing attrs hurt UX ----
  const inputs = [...document.querySelectorAll('input,textarea,select')].map(i => ({
    type: i.type || tag(i),
    fontSize: getComputedStyle(i).fontSize,
    belowZoomThreshold: parseFloat(getComputedStyle(i).fontSize) < 16,
    inputmode: i.getAttribute('inputmode') || '-',
    autocomplete: i.getAttribute('autocomplete') || '-'
  }));

  // --- images: format, dimensions (CLS), oversized-for-viewport (LCP) --
  const imgs = [...document.querySelectorAll('img')];
  const fmt = { webp: 0, avif: 0, jpg: 0, png: 0, svg: 0, other: 0 };
  let noDim = 0, noAlt = 0, lazy = 0; const oversized = [];
  imgs.forEach(im => {
    const s = (im.currentSrc || im.src || '').toLowerCase();
    if (s.includes('.webp')) fmt.webp++;
    else if (s.includes('.avif')) fmt.avif++;
    else if (s.includes('.jpg') || s.includes('.jpeg')) fmt.jpg++;
    else if (s.includes('.png')) fmt.png++;
    else if (s.includes('.svg')) fmt.svg++;
    else fmt.other++;
    const cs = getComputedStyle(im);
    const hasAspect = cs.aspectRatio && cs.aspectRatio !== 'auto';
    if (!im.getAttribute('width') && !im.getAttribute('height') && !hasAspect) noDim++;
    if (!im.hasAttribute('alt')) noAlt++;
    if (im.loading === 'lazy') lazy++;
    const dispW = Math.round(im.getBoundingClientRect().width);
    if (im.naturalWidth && dispW && im.naturalWidth > dispW * 2.2) {
      oversized.push((s.split('/').pop() || '').slice(0, 30) + ' natural=' + im.naturalWidth + 'px shown=' + dispW + 'px');
    }
  });

  // --- structure / scroll length / sticky / PWA ------------------------
  const fixed = [];
  document.querySelectorAll('*').forEach(el => {
    const p = getComputedStyle(el).position;
    if ((p === 'fixed' || p === 'sticky')) {
      const r = el.getBoundingClientRect();
      if (r.height > 0 && r.height < 400) fixed.push(p + ' ' + tag(el) + ' h=' + Math.round(r.height) + ' "' + txt(el) + '"');
    }
  });
  const menu = [...document.querySelectorAll('button,[role=button]')].filter(b => {
    const a = (b.getAttribute('aria-label') || '').toLowerCase();
    const c = (b.className || '').toString().toLowerCase();
    return a.includes('menu') || b.hasAttribute('aria-expanded') || c.includes('menu') || c.includes('burger');
  }).map(b => tag(b) + ' aria-label="' + (b.getAttribute('aria-label') || '') + '" aria-expanded=' + b.getAttribute('aria-expanded'));

  return {
    // foundations
    title: document.title,
    lang: document.documentElement.lang || 'MISSING',
    viewportMeta: vpContent,
    zoomBlocked,                                    // true = accessibility problem
    bodyFontSize: getComputedStyle(document.body).fontSize,

    // layout
    viewport: vw + 'x' + vh,
    horizontalOverflow: docW > vw + 1,              // true = page scrolls sideways
    overflowElements: overflowers.slice(0, 8),
    documentHeightPx: docH,
    screensTall: +(docH / vh).toFixed(1),           // scroll length; >8 = probably too long

    // touch
    clickableCount: clickables.length,
    smallTapTargets: small.length,
    smallTapExamples: small.slice(0, 12),

    // forms
    inputCount: inputs.length,
    inputsBelow16px: inputs.filter(i => i.belowZoomThreshold).length,   // iOS zoom risk
    inputs,

    // images
    imageCount: imgs.length,
    imageFormats: fmt,                              // want webp/avif, not jpg/png
    imagesMissingDimensions: noDim,                 // CLS risk
    imagesMissingAlt: noAlt,                        // a11y
    imagesLazy: lazy,
    oversizedImages: oversized.slice(0, 6),         // LCP/bandwidth waste

    // structure / app-like signals
    h1Count: document.querySelectorAll('h1').length,
    headingOutline: [...document.querySelectorAll('h1,h2,h3')].map(h => h.tagName + ': ' + txt(h)).slice(0, 30),
    stickyFixedElements: fixed,
    menuButtons: menu,
    domNodes: document.querySelectorAll('*').length,

    // pwa / polish
    hasManifest: !!document.querySelector('link[rel=manifest]'),
    hasThemeColor: !!document.querySelector('meta[name=theme-color]'),
    prefersReducedMotionHonored: 'check CSS manually — not detectable from DOM'
  };
}

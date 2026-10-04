---
name: book-typesetting
description: Turn raw text/markdown (including messy webpage captures) into a professionally typeset, navigable book PDF — without changing a word of the author's content. Use when building or fixing book/ebook/guide PDFs, "złóż książkę", "napraw formatowanie PDF", "book layout", "typeset this", "PDF z nawigacją", chapter/TOC/widow-orphan problems, or when a generated book "rozsypuje się". Covers: cleaning web-capture junk, structure detection, ReportLab implementation (keepWithNext, widows/orphans, hyphenation, clickable TOC + PDF outline), image placement, and a mandatory render-and-look QA loop. Content is untouchable: fix FORM only; if a content edit slipped in, revert to the original.
---

# Book Typesetting

Build a real book from raw text. The author's words are read-only — every fix is form, never phrasing.

## Iron rules

1. **Content is untouchable.** No rewording, no "obvious typo" fixes, no dropped sentences of author prose. If you changed content earlier, revert to the original. The only removable text is **web furniture** (cookie banners, visitor counters, nav tiles, donation blocks, "Sign up" CTAs) — log every dropped line to a build report the author can review.
2. **Never ship unrendered.** After every build, render sample pages to images and LOOK at them (cover, TOC, first chapter, a mid-chapter spread, an image page, back matter). One pass = one fix list = one rebuild. Repeat until two consecutive passes are clean.
3. **One source of truth.** Keep the pipeline deterministic: source files → cleaner (logged) → structure model → renderer. Never hand-edit the PDF or intermediate; fix the pipeline.

## Structure detection (webpage captures)

Captured pages are line-per-block, not soft-wrapped: **one line = one paragraph**. Never join consecutive lines.
- Real headings: markdown `#`/`##`, or short Title-Case lines duplicated by the site's nav — dedupe against the chapter list (a heading with a near-empty body that reappears later with a real body is a nav tile → drop the tile, keep the real one).
- Nav strips: runs of ≥3 short punctuation-less lines → web furniture.
- Captions ("City 2023, …") stay with their image; if the image is gone, keep the caption as an italic caption line.
- Emoji in print: convert to typography (🔹→•, emoji-labeled callouts → styled boxes). Note the policy in the report.

## Typography rules (research-backed)

- Body: serif, 10–11 pt, leading ×1.45–1.55, **50–75 characters per line** (A5 with 16 mm margins ≈ 62 — good).
- **Justified body needs hyphenation** or it grows rivers: ReportLab `ParagraphStyle(hyphenationLang="en_US")` (needs `pyphen` installed). No more than 2–3 consecutive hyphenated line-ends — spot-check in QA.
- **Widows/orphans:** `allowWidows=0, allowOrphans=0` on every body style. A paragraph's last line alone at a page top is the cardinal sin.
- **Headings never strand:** `keepWithNext=1` on chapter/section/subhead styles, and on any rule/ornament flowable that follows a heading (`flowable.keepWithNext = 1`).
- Front matter order: cover → half-title → colophon (copyright, edition note, disclaimer, links) → contents → body. Page numbers start in body-ish territory; never number the cover.
- Chapter openers: page break before, generous head margin, a small ornament/rule; part dividers get their own centered page.
- Images: cap width to text measure, cap height ~60% of page, center, small space above/below; a full-bleed or plate-style cover image page; never let an image push a lone heading to the page bottom (heading keepWithNext covers this).

## Navigation (the "easy to use" half)

- **Clickable TOC**: ReportLab `TableOfContents` + `afterFlowable` notify with a 4-tuple `(level, text, page, key)`; anchor each heading with `<a name="key"/>` and `canvas.bookmarkPage(key)`.
- **PDF outline** (reader sidebar): `canvas.addOutlineEntry(text, key, level)` — outline levels must start at 0 and never jump; clamp and reset per multiBuild pass (`beforeDocument`).
- Multi-edition sets (short + full): cross-link them — edition note and any original "read the full chapter" lines become live links to the sibling edition's stable URL. Restore such lines with their **original wording**; only the styling and the href are yours.
- External links in teal/accent color so they're discoverable in print-styled text.

## ReportLab specifics (pitfalls already paid for)

- `multiBuild` runs multiple passes: reset outline-level state in `beforeDocument`, or pass 2 crashes with "can't jump from outline level -1".
- `bulletText="•"`, `leftIndent`≈14, detect list lines with `^([-*•]|\d{1,2}\.)\s` — cap ordinal at 2 digits or years become list items.
- Callout boxes: single-cell `Table` with `LINEBEFORE` accent + light background; `KeepTogether` only for image+caption pairs, not large images (big whitespace risk).
- Fonts: register TTFs (Windows: Georgia + Segoe UI ship free); `registerFontFamily` for `<b>/<i>`. Emoji won't render in base fonts — that's why the emoji policy exists.
- QA rendering: PyMuPDF `page.get_pixmap(dpi=110)` → PNG → actually read them.

## QA checklist (run every build)

- [ ] Cover, half-title, colophon each on their own page, no overflow
- [ ] TOC: dotted leaders, correct page numbers, entries clickable; outline present in sidebar
- [ ] No heading stranded at a page bottom; no widow lines at page tops
- [ ] No nav-tile residue, no cookie/counter/donation text anywhere
- [ ] Images: sized sane, near their anchor text, captions attached
- [ ] Justified text: no gaping rivers (hyphenation on), ≤3 consecutive hyphens
- [ ] Cross-edition links work; external links colored
- [ ] Build report lists every dropped line + policies — nothing silent

Sources: selfpublishingadvice.org (10 typesetting rules), ebookpbook.com (widows/orphans), docs.reportlab.com ch6 (allowWidows/allowOrphans/keepWithNext/hyphenationLang), writelightgroup.com (readability), clearsightbooks.com (layout mistakes).

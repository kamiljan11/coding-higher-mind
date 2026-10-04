# -*- coding: utf-8 -*-
"""v3: both books, real cover art, chapter images, clickable TOC + PDF outline,
support-block stripped. Formatting-only: author's prose untouched."""
import os, re, html, json
from PIL import Image as PILImage
from reportlab.lib.pagesizes import A5
from reportlab.lib.units import mm
from reportlab.lib.colors import HexColor
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_JUSTIFY, TA_CENTER, TA_LEFT
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, PageBreak,
                                Table, TableStyle, HRFlowable, Image as RLImage, KeepTogether)
from reportlab.platypus.tableofcontents import TableOfContents
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

SRC = r"~\Desktop\demo-site\src\content\spirituality"
OUT = r"~\Desktop\<second-domain> gold\web"
IMG = r"$TMP/claude"
os.makedirs(OUT, exist_ok=True)

for name, path in [("Georgia", r"C:\Windows\Fonts\georgia.ttf"), ("Georgia-Bold", r"C:\Windows\Fonts\georgiab.ttf"),
                   ("Georgia-Italic", r"C:\Windows\Fonts\georgiai.ttf"), ("Segoe", r"C:\Windows\Fonts\segoeui.ttf"),
                   ("Segoe-Bold", r"C:\Windows\Fonts\segoeuib.ttf")]:
    pdfmetrics.registerFont(TTFont(name, path))
pdfmetrics.registerFontFamily("Georgia", normal="Georgia", bold="Georgia-Bold", italic="Georgia-Italic", boldItalic="Georgia-Bold")

TEAL = HexColor("#0a7d8c"); INK = HexColor("#1d232a"); GREY = HexColor("#666666")

JUNK_EXACT = {"please accept cookies to access this content","total numbers of unique visitors",
 "here","this playlist.","videos will be successfully added to","short videos inspired by the guidebook's content",
 "ultra short videos inspired by the guidebook","buy me a coffee","sign up now","to begin your journey.",
 "elevate your consciousness","menu","click","click here"}

# Original CTA lines kept verbatim, restyled as live cross-edition links (form, not content)
BASE_URL = "https://kamiljan.com/books/"
FULL_URL = BASE_URL + "Simplified-Practical-Spirituality.pdf"
SHORT_URL = BASE_URL + "Simplified-Practical-Spirituality-Short.pdf"
CTA_TO_FULL = {"read the full chapter","read this chapter in the complete guidebook",
 "read the full chapter in the complete guidebook","read complete book here","read the complete book","read complete book"}
CTA_TO_SHORT = {"first time here? read short version","the simplified practical spirituality²"}
JUNK_SUBSTR = ["in the bottom right corner, you'll find an arrow",
 "this complete guidebook is approximately","the short version includes around"]
RE_SOURCE = re.compile(r"^\*Source: https?://.*\*$"); RE_DISC = re.compile(r"^DISCLAIMER\.", re.I)
EMOJI = re.compile("[\\U0001F000-\\U0001FAFF\\u2600-\\u27BF\\uFE0F\\u200D\\u2B00-\\u2BFF"
                   "\\u20E0-\\u20FF\\u2500-\\u25FF\\u2900-\\u297F"
                   "\\x00-\\x08\\x0b\\x0c\\x0e-\\x1f\\uE000-\\uF8FF\\uFFFC\\uFFFD]+")  # + PUA icon glyphs & controls
TYPO = {}  # content untouchable: author's original wording stays, typos included
SUPPORT_START = re.compile(r"Your support allows me to dedicate|Single Support Options|Support The Mission", re.I)
DONATION = re.compile(r"\bWise\b|Stripe|Buy Me|Monthly Support|bc1q|0x1dA9|Debit|Credit Card|PayPal|BITCOIN|Etherium|Multi.?Currency|wireTransfer|\bQR\b|Fair Exchange Model \(", re.I)
DISCLAIMER = [None]
report = {"dropped": {}, "support_stripped": {}, "images_placed": {}, "images_skipped": {}}

def read(p):
    with open(p, "r", encoding="utf-8-sig") as f: return f.read()

def strip_fm(t):
    if t.startswith("---"):
        e = t.find("\n---", 3)
        if e != -1: t = t[e+4:]
    return t.strip("\n")

def sanitize(t):
    t = EMOJI.sub("", t).lower()
    return " ".join(re.findall(r"[a-z0-9']+", t))

def clean(text, tag):
    out, dropped = [], []
    for raw in text.split("\n"):
        line = raw.rstrip()
        low = line.strip().lower().rstrip(":").strip()
        if not line.strip(): out.append(""); continue
        if low in JUNK_EXACT or any(s in low for s in JUNK_SUBSTR): dropped.append(line.strip()[:60]); continue
        if RE_SOURCE.match(line.strip()) or line.strip() == "---": continue
        if RE_DISC.match(line.strip()):
            DISCLAIMER[0] = line.strip(); continue
        line = re.sub(r"\(click\s+here?\s+to learn more\)", "", line, flags=re.I)
        line = re.sub(r"\s*\(click\s*$", "", line, flags=re.I)
        out.append(line)
    # strip support/donation block
    sidx = next((i for i, l in enumerate(out) if SUPPORT_START.search(l)), None)
    if sidx is not None:
        window = out[sidx:sidx+110]
        last = max((i for i, l in enumerate(window) if DONATION.search(l)), default=0)
        if last:
            report["support_stripped"][tag] = last + 1
            del out[sidx:sidx+last+1]
    # nav-tile strips: runs of >=3 short punctuation-less lines
    def is_tile(l):
        s = EMOJI.sub("", l).strip()
        return (s and len(s) < 48 and not re.search(r"[.!?;,]", s) and not s.endswith(":")
                and not re.match(r"^(#|[-*•]|\d+\.)", s))
    final, i = [], 0
    while i < len(out):
        if is_tile(out[i]):
            j = i
            while j < len(out) and (is_tile(out[j]) or not out[j].strip()): j += 1
            solid = [k for k in range(i, j) if out[k].strip()]
            if len(solid) >= 3:
                dropped.extend(out[k].strip()[:40] for k in solid); i = j; continue
        final.append(out[i]); i += 1
    # Rejoin sentences the capture split across "paragraphs" (form only — no word
    # is added, removed or reordered; only paragraph boundaries are restored).
    TERMINAL = ('.', '!', '?', ':', '"', '”', '’', ')', '…')
    joined, merges = [], 0
    for line in final:
        s = line.strip()
        if not s:
            joined.append(line); continue
        prev = joined[-1].strip() if joined else ""
        starts_lower = s[:1].islower()
        starts_close = s[:1] in ")],.;:%"
        prev_is_body = (prev and not re.match(r"^(#|[-*••]|\d{1,2}\.)", prev)
                        and not prev.startswith("\U0001F914") and len(prev.split()) > 1)
        prev_open = prev and not prev.endswith(TERMINAL)
        if joined and prev_is_body and (starts_close or (starts_lower and prev_open)):
            sep = "" if starts_close else " "
            joined[-1] = joined[-1].rstrip() + sep + s
            merges += 1
            continue
        joined.append(line)
    report.setdefault("continuation_merges", {})[tag] = merges
    report["dropped"][tag] = dropped
    return "\n".join(joined)

def parse_sections(text):
    secs, cur = [], [0, None, []]
    for line in text.split("\n"):
        m = re.match(r"^(#{1,3})\s+(.*)$", line)
        if m:
            secs.append(cur); t = m.group(2).strip(); cur = [len(m.group(1)), TYPO.get(t, t), []]
        else:
            cur[2].append(line)
    secs.append(cur); return secs

def bw(s): return len(" ".join(s[2]).split())

def drop_nav(secs):
    seen = {}
    for i, s in enumerate(secs):
        if s[1]: seen.setdefault(sanitize(s[1]), []).append((i, bw(s)))
    drop = set()
    for k, occ in seen.items():
        if len(occ) > 1:
            for idx, w in sorted(occ, key=lambda x: -x[1])[1:]:
                if w < 45: drop.add(idx)
    # an empty heading that never gets a body anywhere is nav residue too
    for i, s in enumerate(secs):
        if s[1] and bw(s) < 8 and i not in drop and not re.match(r"^part\s*\d", s[1].lower()):
            drop.add(i)
    for i, s in enumerate(secs):
        if s[1] and s[1].lower().startswith("table of contents"): drop.add(i)
    return [s for i, s in enumerate(secs) if i not in drop]

def dedupe_tiles(sections):
    titles = [sanitize(s[1]) for s in sections if s[1]]
    def covered(txt):
        w = sanitize(txt)
        if len(w) < 6: return False
        return any(w in t or t in w for t in titles if t)
    for sec in sections:
        lines = sec[2]; keep = [True]*len(lines)
        idxs = [k for k, l in enumerate(lines) if l.strip()]
        for a, k in enumerate(idxs):
            if not keep[k]: continue
            s = lines[k].strip()
            if not (is_subhead(s) or s.startswith("\U0001F914")): continue
            if sec[1] and sanitize(s) == sanitize(sec[1]): continue
            for win in (3, 2, 1):
                group = idxs[a:a+win]
                if len(group) < win: continue
                parts = [lines[g].strip() for g in group]
                if win > 1 and not all(is_subhead(p) or p.startswith("\U0001F914") for p in parts): continue
                if covered(" ".join(parts)):
                    for g in group: keep[g] = False
                    break
        sec[2] = [l for k2, l in enumerate(lines) if keep[k2]]
    return sections

def is_subhead(s):
    plain = EMOJI.sub("", s).strip()
    if not plain or len(plain) > 62 or re.search(r"[.!?;]$", plain): return False
    if re.search(r"[.!?;]", plain[:-1]): return False
    words = plain.split()
    if len(words) < 2: return False
    caps = sum(1 for w in words if w[:1].isupper() or w.isupper() or w.isdigit())
    return caps / len(words) >= 0.7

ARROWS = re.compile("([\\u2190-\\u21FF\\u2913\\u21E7])")

def mdrl(t):
    t = EMOJI.sub("", t)
    t = html.escape(t, quote=False)
    # Georgia lacks arrow glyphs; render them in Segoe (form only, same character)
    t = ARROWS.sub(r'<font name="Segoe">\1</font>', t)
    t = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", t)
    t = re.sub(r"(?<!\*)\*(?!\s)(.+?)(?<!\s)\*(?!\*)", r"<i>\1</i>", t)
    return t.strip()

try:
    import pyphen  # noqa: F401
    HYPH = "en_US"
except ImportError:
    HYPH = None

S = {}
S["body"] = ParagraphStyle("body", fontName="Georgia", fontSize=10.3, leading=15.6, alignment=TA_JUSTIFY,
    textColor=INK, spaceAfter=7, allowWidows=0, allowOrphans=0, hyphenationLang=HYPH)
S["bullet"] = ParagraphStyle("bullet", parent=S["body"], leftIndent=14, bulletIndent=3, spaceAfter=3.5)
S["linkline"] = ParagraphStyle("linkline", fontName="Segoe-Bold", fontSize=8.6, leading=12,
    textColor=TEAL, spaceBefore=1, spaceAfter=9)
S["caption"] = ParagraphStyle("caption", fontName="Georgia-Italic", fontSize=8.6, leading=12, alignment=TA_CENTER, textColor=GREY, spaceAfter=9)
S["Chapter"] = ParagraphStyle("Chapter", fontName="Georgia-Bold", fontSize=15.5, leading=19, textColor=INK, spaceAfter=2, keepWithNext=1)
S["PartKick"] = ParagraphStyle("PartKick", fontName="Segoe-Bold", fontSize=9, leading=12, alignment=TA_CENTER, textColor=TEAL, spaceAfter=6)
S["PartTitle"] = ParagraphStyle("PartTitle", fontName="Georgia-Bold", fontSize=19, leading=24, alignment=TA_CENTER, textColor=INK)
S["callout"] = ParagraphStyle("callout", parent=S["body"], fontSize=9.4, leading=14, alignment=TA_LEFT, spaceAfter=0)
S["calloutLbl"] = ParagraphStyle("calloutLbl", fontName="Segoe-Bold", fontSize=7.6, leading=10, textColor=TEAL, spaceAfter=2)
S["subhead"] = ParagraphStyle("subhead", fontName="Georgia-Bold", fontSize=11.3, leading=15, textColor=INK, spaceBefore=9, spaceAfter=4, keepWithNext=1)
S["coverTitle"] = ParagraphStyle("coverTitle", fontName="Georgia-Bold", fontSize=22, leading=27, alignment=TA_CENTER, textColor=INK)
S["coverSub"] = ParagraphStyle("coverSub", fontName="Georgia-Italic", fontSize=11.5, leading=15, alignment=TA_CENTER, textColor=HexColor("#555555"))
S["coverAuthor"] = ParagraphStyle("coverAuthor", fontName="Segoe-Bold", fontSize=12, leading=15, alignment=TA_CENTER, textColor=INK)
S["colophon"] = ParagraphStyle("colophon", fontName="Segoe", fontSize=7.6, leading=11, textColor=GREY, spaceAfter=5)
S["colophonSm"] = ParagraphStyle("colophonSm", fontName="Segoe", fontSize=6.4, leading=8.8, textColor=GREY)
S["tocH"] = ParagraphStyle("tocH", fontName="Georgia-Bold", fontSize=15, leading=19, spaceAfter=10)
toc_lvl0 = ParagraphStyle("toc0", fontName="Georgia-Bold", fontSize=10.5, leading=15, spaceBefore=6, textColor=INK)
toc_lvl1 = ParagraphStyle("toc1", fontName="Georgia", fontSize=9.5, leading=13.5, leftIndent=12, textColor=INK)

def callout(label, text, items=None):
    inner = [Paragraph(label, S["calloutLbl"])]
    if items:
        for it in items:
            inner.append(Paragraph(it, S["callout"], bulletText="•"))
    else:
        inner.append(Paragraph(text, S["callout"]))
    if items:
        inner[1].style = ParagraphStyle("cb", parent=S["callout"], leftIndent=11, bulletIndent=2, spaceAfter=4)
        for p in inner[1:]:
            p.style = ParagraphStyle("cb", parent=S["callout"], leftIndent=11, bulletIndent=2, spaceAfter=4)
    t = Table([[inner]], colWidths=[104*mm])
    t.setStyle(TableStyle([("BACKGROUND", (0,0), (-1,-1), HexColor("#f2f6f6")),
        ("LINEBEFORE", (0,0), (0,-1), 2, TEAL), ("LEFTPADDING", (0,0), (-1,-1), 8),
        ("RIGHTPADDING", (0,0), (-1,-1), 8), ("TOPPADDING", (0,0), (-1,-1), 6), ("BOTTOMPADDING", (0,0), (-1,-1), 7)]))
    return t

def img_flow(fname, max_w=112*mm, max_h=118*mm):
    p = os.path.join(IMG, fname)
    if not os.path.exists(p): return None
    with PILImage.open(p) as im: w, h = im.size
    scale = min(max_w / w, max_h / h, 1.0)
    fl = RLImage(p, width=w*scale, height=h*scale)
    fl.hAlign = "CENTER"
    return fl

CAPTION_PAT = re.compile(r"^(Toronto 2023|Rishikesh India)", re.I)

def body_flow(lines, images_by_anchor, placed, tag, link_map=None):
    link_map = link_map or {}
    flows, i = [], 0
    while i < len(lines):
        s = lines[i].strip(); i += 1
        if not s: continue
        low = EMOJI.sub("", s).lower().rstrip(":").strip()
        cta_hit = None
        for phrase, url in link_map.items():
            if low == phrase or low.startswith(phrase + " ") or low.startswith(phrase + " ("):
                cta_hit = (phrase, url); break
        if cta_hit:  # original CTA wording, restyled as a live cross-edition link (form only)
            phrase, url = cta_hit
            clean_s = EMOJI.sub("", s).strip()
            prefix, rest = clean_s[:len(phrase)], clean_s[len(phrase):].strip()
            if rest:
                flows.append(Paragraph(
                    f'<link href="{url}" color="#0a7d8c"><b>{mdrl(prefix)}</b></link> {mdrl(rest)}', S["body"]))
            else:
                flows.append(Paragraph(f'<link href="{url}" color="#0a7d8c">{mdrl(clean_s)}</link>', S["linkline"]))
            continue
        # anchor images: insert AFTER the line that contains the anchor fragment
        m = re.match(r"^(?:[-*•\U0001F539]|\d{1,2}\.)\s+(.*)$", s)
        if m:
            txt = mdrl(m.group(1))
            if txt: flows.append(Paragraph(txt, S["bullet"], bulletText="•"))
            continue
        if s.startswith("\U0001F914"):
            # gather this reflection and any that follow it back-to-back into ONE box
            qs = []
            while True:
                body = []
                while i < len(lines) and lines[i].strip() and not lines[i].strip().startswith("\U0001F914"):
                    nxt = lines[i].strip()
                    if re.match(r"^#{1,3}\s", nxt): break
                    body.append(nxt); i += 1
                    break
                if body: qs.append(mdrl(" ".join(body)))
                j = i
                while j < len(lines) and not lines[j].strip(): j += 1
                if j < len(lines) and lines[j].strip().startswith("\U0001F914"):
                    i = j + 1
                    continue
                break
            qs = [q for q in qs if q]
            # emit in page-safe chunks: max 5 questions or ~700 chars per box
            chunk, chunk_len = [], 0
            def emit(c):
                if not c: return
                if len(c) == 1: flows.append(callout("REFLECTION", c[0]))
                else: flows.append(callout("REFLECTION", None, items=list(c)))
            for q in qs:
                if chunk and (len(chunk) >= 5 or chunk_len + len(q) > 700):
                    emit(chunk); chunk, chunk_len = [], 0
                chunk.append(q); chunk_len += len(q)
            emit(chunk)
            continue
        if CAPTION_PAT.match(s):
            # photo caption: image (if mapped) above its caption
            for frag, fname in list(images_by_anchor.items()):
                if frag.startswith("CAPTION:") and sanitize(frag[8:]) in sanitize(s):
                    fl = img_flow(fname)
                    if fl:
                        flows.append(KeepTogether([fl, Paragraph(mdrl(s), S["caption"])]))
                        placed.append(fname); del images_by_anchor[frag]
                        break
            else:
                flows.append(Paragraph(mdrl(s), S["caption"]))
            continue
        if is_subhead(s):
            flows.append(Paragraph(mdrl(s), S["subhead"]))
        else:
            flows.append(Paragraph(mdrl(s), S["body"]))
        san = sanitize(s)
        for frag, fname in list(images_by_anchor.items()):
            if not frag.startswith("CAPTION:") and sanitize(frag) in san:
                fl = img_flow(fname)
                if fl:
                    flows.append(Spacer(1, 2*mm)); flows.append(fl); flows.append(Spacer(1, 3*mm))
                    placed.append(fname); del images_by_anchor[frag]
                break
    return flows

class BookDoc(SimpleDocTemplate):
    def beforeDocument(self):
        self._seen_l0 = False
    def afterFlowable(self, fl):
        key = getattr(fl, "_tockey", None)
        if key:
            level, text = fl._toclevel, fl._toctext
            self.canv.bookmarkPage(key)
            eff = level if (level == 0 or getattr(self, "_seen_l0", False)) else 0
            if eff == 0: self._seen_l0 = True
            self.canv.addOutlineEntry(text, key, eff, closed=(eff == 0))
            self.notify("TOCEntry", (level, text, self.page, key))

from reportlab.lib.utils import ImageReader

COVER = {"path": None}

def paint_cover(canvas, doc):
    """Full-bleed cover: fill the whole page, crop the overflow (no white frame)."""
    p = COVER["path"]
    if not p or not os.path.exists(p):
        return
    img = ImageReader(p)
    iw, ih = img.getSize()
    pw, ph = A5
    scale = max(pw / iw, ph / ih)
    w, h = iw * scale, ih * scale
    canvas.saveState()
    canvas.drawImage(img, (pw - w) / 2, (ph - h) / 2, width=w, height=h, mask="auto")
    canvas.restoreState()

def footer(canvas, doc):
    canvas.saveState(); canvas.setFont("Segoe", 7.5); canvas.setFillColor(GREY)
    canvas.drawCentredString(A5[0]/2, 11*mm, str(canvas.getPageNumber()))
    canvas.restoreState()

def heading(text, style, level, key):
    p = Paragraph(f'<a name="{key}"/>' + mdrl(text), style)
    p._tockey = key; p._toclevel = level; p._toctext = EMOJI.sub("", text).strip()
    return p

def build(title, sub, note, sections, out_pdf, cover_img, images_by_anchor, images_by_chapter, tag, link_map=None, sibling=None):
    placed = []
    flows = []
    # full-bleed cover painted straight onto page 1 (no margins, no white frame)
    COVER["path"] = os.path.join(IMG, cover_img) if cover_img else None
    if COVER["path"] and os.path.exists(COVER["path"]):
        flows += [Spacer(1, 1), PageBreak()]
        placed.append(cover_img)
    else:
        COVER["path"] = None
    # half-title
    flows += [Spacer(1, 48*mm), HRFlowable(width=30*mm, thickness=1.6, color=TEAL, hAlign="CENTER"),
              Spacer(1, 8*mm), Paragraph(html.escape(title), S["coverTitle"]),
              Spacer(1, 4*mm), Paragraph(html.escape(sub), S["coverSub"]),
              Spacer(1, 8*mm), HRFlowable(width=30*mm, thickness=1.6, color=TEAL, hAlign="CENTER"),
              Spacer(1, 20*mm), Paragraph("AUTHOR NAME", S["coverAuthor"]), PageBreak()]
    # colophon
    flows += [Spacer(1, 70*mm), Paragraph(html.escape(note), S["colophon"]),
              Paragraph('© <owner>. All rights reserved. · <a href="https://kamiljan.com" color="#0a7d8c">kamiljan.com</a>', S["colophon"])]
    if sibling:
        flows.append(Paragraph(f'{html.escape(sibling[0])}: <a href="{sibling[1]}" color="#0a7d8c">{html.escape(sibling[1])}</a>', S["colophon"]))
    if DISCLAIMER[0]:
        flows.append(Paragraph(html.escape(DISCLAIMER[0]), S["colophonSm"]))
    flows.append(PageBreak())
    # toc
    toc = TableOfContents(); toc.levelStyles = [toc_lvl0, toc_lvl1]
    toc.dotsMinLevel = 0  # dot leaders on part entries too, not just chapters
    flows += [Paragraph("Contents", S["tocH"]), toc, PageBreak()]
    kn = [0]
    def nextkey():
        kn[0] += 1; return f"k{kn[0]}"
    def brk():
        if flows and not isinstance(flows[-1], PageBreak): flows.append(PageBreak())
    for lvl, name, lines in sections:
        bf = body_flow(lines, images_by_anchor, placed, tag, link_map)
        if not name:
            flows += bf; continue
        if re.match(r"^part\s*\d", name.lower()):
            m = re.match(r"^(part\s*\d+)\s*[-–—]?\s*(.*)$", name, re.I)
            kick, rest = (m.group(1).upper(), m.group(2)) if m else (name.upper(), "")
            brk()
            flows += [Spacer(1, 55*mm), Paragraph(html.escape(kick), S["PartKick"]),
                      heading(rest or kick.title(), S["PartTitle"], 0, nextkey())]
            brk(); flows += bf; continue
        brk()
        flows.append(heading(name, S["Chapter"], 1, nextkey()))
        hr = HRFlowable(width=16*mm, thickness=1.4, color=TEAL, hAlign="LEFT", spaceBefore=2, spaceAfter=7)
        hr.keepWithNext = 1
        flows.append(hr)
        chap_img = None
        for kkey, fname in list(images_by_chapter.items()):
            if sanitize(kkey) == sanitize(name) or sanitize(kkey) in sanitize(name):
                chap_img = fname; del images_by_chapter[kkey]; break
        if chap_img:
            fl = img_flow(chap_img)
            if fl:
                flows += [Spacer(1, 2*mm), fl, Spacer(1, 4*mm)]
                placed.append(chap_img)
        flows += bf
    doc = BookDoc(out_pdf, pagesize=A5, leftMargin=16*mm, rightMargin=16*mm,
                  topMargin=17*mm, bottomMargin=19*mm, title=title, author="<owner>")
    doc.multiBuild(flows, onFirstPage=paint_cover, onLaterPages=footer)
    report["images_placed"][tag] = placed
    report["images_skipped"][tag] = list(images_by_anchor.values()) + list(images_by_chapter.values())
    return out_pdf

# ================= FULL BOOK =================
full = []
for i in range(1, 7):
    t = clean(strip_fm(read(os.path.join(SRC, f"sps-part-{i}.md"))), f"part-{i}")
    secs = parse_sections(t)
    for s in secs:
        if s[0] == 1: s[0], s[1] = 0, None  # demote book-title H1 to preamble, keep body
    full += secs
# dedupe ACROSS the whole assembled book: the site's nav/TOC listing repeats every
# chapter title with an empty body in part 1, while the real chapters live in parts 2-6
full = drop_nav(full)
full = dedupe_tiles(full)

FULL_ANCHORS = {
    "CAPTION:Toronto 2023": "67bf446952d4b_Untitleddesign1.jpg",
    "honour to explore and share": "67eea7c228bf1_At_Eternitys_Gate_-_Vincent_Van_Gogh.jpg",
    "transform suffering in our lines and the lives of others": "67eda8397d647_europe.mpi.p1.100.jpg",
    "who and what we truly are": "67ee8fffb5c3d_WilliamPrestonakaBro.WilliamPreston17421818-TheEyeOfProvidence..jpg",
    "very heart of existence itself": "67eee31f2c27a_ENBwGi2X0AAxG85-1424540358.jpeg",
    "unfold through different stages of development": "67eea0188fc9a_Jacobs-Dream-1805-2.webp",
    "ground the significance of our unfolding understanding": "67ee9ca45ca9e_The-Green-Lion-Devouring-the-Sun-D.-Stolcius-von-Stolcenberg-Viridarium-chymicum.webp",
    "expand on in the next chapter": "67eea5f6ec0f0_PainttheUniverse.jpg",
    "apply these ideas in your everyday life": "67eea7f0a692c_Emblem21MichaelMaierAtalantaFugiens1617.webp",
    "sacred sense of oneness with life": "67eecd95d0a3e_Michelangelo_-_Creation_of_Adam_cropped.jpg",
    "evolve your mindset and apply them in practice": "67eee6a2ef922_ScreenShot2021-11-22at10.01.42PM.png",
    "guiding your actions and interactions with the world": "67eed6f933414_Painting_WyckfollowerAlchemistSeated.jpg",
    "easier to stay consistent even on challenging days": "67eed90561a40_rembrant16thcentury.jpg",
    "practical roots into evolution of consciousness": "67eeddb5528d7_Caspar_David_Friedrich_-_Wanderer_above_the_Sea_of_Fog.jpeg",
    "key practices on the path of the evolution of consciousness": "67eef2b352fe5_628f6ba359bf5b540935d886.jpg",
    "transform them or quite them completely": "67eedf83a1fca_sun.jpg",
}
p1 = build("Simplified Practical Spirituality", "The Complete Guidebook",
           "Complete edition. Originally published at <second-domain>; book edition typeset 2026.",
           full, os.path.join(OUT, "Simplified-Practical-Spirituality.pdf"),
           "6857fcb59df54_Beztytułu.png", dict(FULL_ANCHORS), {}, "full",
           link_map={c: SHORT_URL for c in CTA_TO_SHORT},
           sibling=("Short version", SHORT_URL))

# ================= SHORT BOOK =================
t = clean(strip_fm(read(os.path.join(SRC, "sps2.md"))), "sps2")
secs = drop_nav(parse_sections(t))
for s in secs:
    if s[0] == 1: s[0], s[1] = 0, None  # demote H1 to preamble, keep intro body
secs = dedupe_tiles(secs)

SHORT_CHAPTERS = {
    "What Is The Essence of Suffering?": "685af2e564313_whatiscoreofsufferingfin.jpg",
    "What Is Spirituality?": "685af6cac5f67_spirituality.jpg",
    "What Is Consciousness?": "685af6d741941_concioussnes.jpg",
    "What Is The Evolution Of The Consciousness?": "685af6ea84dac_evolution.jpg",
    "What Are The Levels/Depth Of the Consciousness?": "685af721245c4_levels.jpg",
    "What Are The Peak Experiences?": "685af72fb4840_peak.jpg",
    "Why Evolution of Consciousness Should Be Central To Life?": "685b0321428de_central.jpg",
    "What Is The Complete Lasting Life Happiness?": "685efe8bc78a2_completelasting.jpg",
    "What Is The Practical/Pragmatic Spirituality?": "685effdf518c2_practicalspirituality.jpg",
    "The Practical Spiritual Path": "6863b6fb88085_pathfixed.jpg",
    "Activation Sessions": "686429b84e8da_sessions.jpg",
    "The Evolutionary Mindset": "6864313032e02_midset.jpg",
    "Always Try Your Very Best": "686436b92a88c_best.jpg",
    "Develop Formal Spiritual Practice": "686270e127181_12.jpg",
    "Practice Micro-Awareness": "686270fd5e121_13.jpg",
    "Engage in Deep Reflection": "6862710fa65fe_14.jpg",
    "Develop Conscious Healthy Lifestyle": "6866d601e02ad_healthyway.jpg",
    "Cultivate Spiritual Sensitivity": "68681cb009070_cultivate.jpg",
}
SHORT_ANCHORS = {
    "CAPTION:Rishikesh India": "photo.jpg",
    "expanded awareness and a more complete sense of reality itself": "684ee1640efb0_ChatGPTImageJun15202505_06_00PM.png",
    "making life simpler lighter and more meaningful": "684eeaf2962e3_ChatGPTImageJun15202505_46_45PM.png",
    "one that doesn't fade because it comes from within": "684edbe4ba0e7_ChatGPTImageJun15202504_42_35PM.png",
}
p2 = build("Simplified Practical Spirituality\u00b2",
           "The Short Version \u2014 read it in about an hour",
           "Short edition (\u00b2). Originally published at <second-domain>; book edition typeset 2026.",
           secs, os.path.join(OUT, "Simplified-Practical-Spirituality-Short.pdf"),
           "6857e82d4ad8b_Beztytułu.png", dict(SHORT_ANCHORS), dict(SHORT_CHAPTERS), "short",
           link_map={c: FULL_URL for c in CTA_TO_FULL},
           sibling=("Complete guidebook", FULL_URL))

import fitz
for p in [p1, p2]:
    d = fitz.open(p)
    print(os.path.basename(p), "pages:", d.page_count, f"{os.path.getsize(p)/1e6:.2f}MB",
          "| outline entries:", len(d.get_toc()))
    d.close()
print("placed full:", len(report["images_placed"]["full"]), "skipped:", report["images_skipped"]["full"])
print("placed short:", len(report["images_placed"]["short"]), "skipped:", report["images_skipped"]["short"])
print("support stripped:", report["support_stripped"])
with open(os.path.join(OUT, "_build_report.json"), "w", encoding="utf-8") as f:
    json.dump(report, f, ensure_ascii=False, indent=1)
print("DONE")

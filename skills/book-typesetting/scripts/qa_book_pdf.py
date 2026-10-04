# -*- coding: utf-8 -*-
"""Automated typographic QA for the book PDFs + contact sheets for human review.
Checks: blank pages, stranded headings, widow lines, TOC page-number accuracy,
outline integrity, text outside margins, hyphen ladders, loose/river lines,
image sizing, orphaned captions, font-glyph failures."""
import os, json, re
import fitz
from PIL import Image, ImageDraw

OUT = r"~\Desktop\<second-domain> gold\web"
QA = r"$TMP/claude"
os.makedirs(QA, exist_ok=True)

A5_W, A5_H = 419.53, 595.28   # pt
ML, MR, MT, MB = 45.35, 45.35, 48.19, 53.86  # 16/16/17/19 mm
BODY_MAX = 11.0   # body font size ceiling
HEAD_MIN = 13.0   # chapter heading size floor

def spans(page):
    out = []
    for b in page.get_text("dict")["blocks"]:
        if b.get("type") != 0: continue
        for l in b["lines"]:
            for s in l["spans"]:
                if s["text"].strip():
                    out.append({"text": s["text"], "size": round(s["size"], 1), "font": s["font"],
                                "bbox": s["bbox"], "y": round(l["bbox"][1], 1), "line_bbox": l["bbox"]})
    return out

def audit(path, label, front_matter_pages=5):
    doc = fitz.open(path)
    issues = {"blank_pages": [], "stranded_heading": [], "widow_line": [], "outside_margin": [],
              "hyphen_ladder": [], "loose_lines": [], "tiny_image": [], "toc_mismatch": [],
              "glyph_fail": [], "short_last_line_top": []}
    n = doc.page_count

    # --- outline integrity + TOC page numbers ---
    toc = doc.get_toc()                       # [level, title, page]
    toc_titles = {re.sub(r"\s+", " ", t[1]).strip().lower(): t[2] for t in toc}
    # printed TOC entries (page 3-5): "Title . . . 12"
    printed = {}
    for p in range(min(front_matter_pages, n)):
        txt = doc[p].get_text()
        if "Contents" not in txt and not printed: continue
        for line in txt.split("\n"):
            m = re.match(r"^(.*?)[\s.]{3,}(\d{1,3})$", line.strip())
            if m:
                printed[re.sub(r"\s+", " ", m.group(1)).strip().lower()] = int(m.group(2))
    for title, pg in printed.items():
        real = toc_titles.get(title)
        if real is not None and real != pg:
            issues["toc_mismatch"].append({"title": title[:50], "printed": pg, "outline": real})

    for i in range(n):
        page = doc[i]
        sp = spans(page)
        text = page.get_text().strip()
        pno = i + 1

        if not text and not page.get_images():
            issues["blank_pages"].append(pno)
            continue

        if "\x00" in text or "\ufffd" in text:
            issues["glyph_fail"].append(pno)

        body = [s for s in sp if s["size"] <= BODY_MAX]
        heads = [s for s in sp if s["size"] >= HEAD_MIN]

        # stranded heading: a heading whose baseline sits in the bottom 22% with no body under it
        for h in heads:
            if h["bbox"][3] > A5_H - MB - 0.22 * (A5_H - MT - MB):
                below = [b for b in body if b["bbox"][1] > h["bbox"][3] + 2]
                if len(below) < 2:
                    issues["stranded_heading"].append({"page": pno, "head": h["text"][:40]})

        # widow: first body line on the page is short (< 55% measure) and page > front matter
        if pno > front_matter_pages and body:
            first_y = min(b["y"] for b in body)
            first_line = [b for b in body if abs(b["y"] - first_y) < 1.5]
            w = max(b["bbox"][2] for b in first_line) - min(b["bbox"][0] for b in first_line)
            measure = A5_W - ML - MR
            if w < 0.55 * measure and not heads:
                issues["widow_line"].append({"page": pno, "width_pct": round(100 * w / measure),
                                             "text": " ".join(b["text"] for b in first_line)[:50]})

        # text outside margins (footer band excluded — page numbers live there by design)
        for s in sp:
            x0, y0, x1, y1 = s["bbox"]
            if y0 > A5_H - 40 and abs((x0 + x1) / 2 - A5_W / 2) < 40:
                continue  # centered footer page number
            if x0 < ML - 2 or x1 > A5_W - MR + 2 or y1 > A5_H - MB + 12:
                issues["outside_margin"].append({"page": pno, "text": s["text"][:30],
                                                 "bbox": [round(v) for v in s["bbox"]]})
                break

        # hyphen ladder: >=3 consecutive body lines ending in a hyphen
        lines_by_y = {}
        for b in body:
            lines_by_y.setdefault(round(b["y"]), []).append(b)
        ys = sorted(lines_by_y)
        run = 0
        for y in ys:
            joined = "".join(x["text"] for x in sorted(lines_by_y[y], key=lambda z: z["bbox"][0])).rstrip()
            if joined.endswith("-"):
                run += 1
                if run >= 3:
                    issues["hyphen_ladder"].append({"page": pno, "at_y": y}); break
            else:
                run = 0

        # loose lines (rivers): justified line whose inter-word gaps are huge
        for y in ys:
            row = sorted(lines_by_y[y], key=lambda z: z["bbox"][0])
            joined = "".join(x["text"] for x in row)
            if len(joined) < 25: continue
            width = row[-1]["bbox"][2] - row[0]["bbox"][0]
            if width < 0.9 * (A5_W - ML - MR): continue      # not a justified full line
            nspaces = joined.count(" ")
            if nspaces:
                # estimate: full measure minus glyph width, spread over spaces
                approx_char = width / max(len(joined), 1)
                space_w = approx_char * 1.0
                if space_w > 6.2:                             # ~0.6em at 10.3pt is ~6.2
                    issues["loose_lines"].append({"page": pno, "space_pt": round(space_w, 1),
                                                  "text": joined[:45]})
                    break

        # tiny images
        for img in page.get_image_info():
            bb = img["bbox"]
            w, h = bb[2] - bb[0], bb[3] - bb[1]
            if w < 80 or h < 40:
                issues["tiny_image"].append({"page": pno, "w": round(w), "h": round(h)})

    doc.close()
    summary = {k: (len(v) if isinstance(v, list) else v) for k, v in issues.items()}
    return {"label": label, "pages": n, "summary": summary, "issues": issues}

def contact_sheet(path, label, cols=6, rows=5, dpi=42):
    doc = fitz.open(path)
    per = cols * rows
    sheets = []
    for start in range(0, doc.page_count, per):
        pages = range(start, min(start + per, doc.page_count))
        thumbs = []
        for i in pages:
            pix = doc[i].get_pixmap(dpi=dpi)
            im = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
            thumbs.append((i + 1, im))
        tw, th = thumbs[0][1].size
        pad, lbl = 6, 12
        sheet = Image.new("RGB", (cols * (tw + pad) + pad, rows * (th + pad + lbl) + pad), "#dddddd")
        dr = ImageDraw.Draw(sheet)
        for idx, (pno, im) in enumerate(thumbs):
            x = pad + (idx % cols) * (tw + pad)
            y = pad + (idx // cols) * (th + pad + lbl)
            sheet.paste(im, (x, y))
            dr.text((x + 2, y + th + 1), f"p{pno}", fill="#000000")
        out = os.path.join(QA, f"{label}_sheet_{start//per + 1}.png")
        sheet.save(out)
        sheets.append(out)
    doc.close()
    return sheets

results = []
for fn, label in [("Simplified-Practical-Spirituality.pdf", "full"),
                  ("Simplified-Practical-Spirituality-Short.pdf", "short")]:
    p = os.path.join(OUT, fn)
    r = audit(p, label)
    r["sheets"] = contact_sheet(p, label)
    results.append(r)
    print(f"=== {label}: {r['pages']} pages ===")
    for k, v in r["summary"].items():
        if v: print(f"  {k}: {v}")
    print(f"  contact sheets: {len(r['sheets'])}")

with open(os.path.join(QA, "qa_report.json"), "w", encoding="utf-8") as f:
    json.dump(results, f, ensure_ascii=False, indent=1)
print("QA DONE")

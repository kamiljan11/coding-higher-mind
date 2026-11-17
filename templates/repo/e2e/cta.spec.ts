// CTA and links (web-design-rules R03/R51/R57): no dead hrefs, valid tel/sms/mailto, in-page anchors exist,
// tap targets >= 44px on mobile. OBSERVE: problems go to the report; CTA_ENFORCE=1 makes them fail.
import { test, expect } from "@playwright/test";

const pages = (process.env.E2E_PAGES ?? "/").split(",").map((p) => p.trim()).filter(Boolean);
const enforce = process.env.CTA_ENFORCE === "1";
const MIN_TAP = 44;

for (const path of pages) {
  test(`cta ${path}`, async ({ page }, info) => {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const problems = await page.evaluate((minTap) => {
      const out: string[] = [];
      const label = (el: Element) => (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40) || el.getAttribute("aria-label") || "?";
      const mobile = window.innerWidth < 768;
      for (const a of Array.from(document.querySelectorAll<HTMLAnchorElement>("a"))) {
        const href = (a.getAttribute("href") ?? "").trim();
        if (!href || href === "#" || /^javascript:/i.test(href)) { out.push(`dead link "${label(a)}" href="${href}"`); continue; }
        if (/^tel:/i.test(href) && !/^tel:\+?[\d\s().%-]{6,}([;,].*)?$/i.test(href)) out.push(`bad tel "${href}"`);
        if (/^sms:/i.test(href) && !/^sms:\+?[\d\s().-]{6,}/i.test(href)) out.push(`bad sms "${href}"`);
        if (/^mailto:/i.test(href) && !/^mailto:[^@\s]+@[^@\s]+\.[^@\s]+/i.test(href)) out.push(`bad mailto "${href}"`);
        if (href.startsWith("#") && href.length > 1 && href.toLowerCase() !== "#top") {
          let id = href.slice(1);
          try { id = decodeURIComponent(id); } catch { /* malformed escape: compare raw */ }
          if (!document.getElementById(id) && !document.getElementsByName(id).length) out.push(`anchor without target "${href}"`);
        }
      }
      if (mobile) {
        for (const el of Array.from(document.querySelectorAll<HTMLElement>("a, button, [role=button], input[type=submit]"))) {
          const r = el.getBoundingClientRect();
          const visible = el.checkVisibility ? el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) : true;
          const onScreen = r.right > 0 && r.left < window.innerWidth;
          // WCAG 2.5.8 exemption: links inside running text only.
          const inline = el.tagName === "A" && getComputedStyle(el).display === "inline" && el.closest("p");
          if (visible && onScreen && r.width > 1 && r.height > 1 && !inline && (r.width < minTap || r.height < minTap)) out.push(`tap target ${Math.round(r.width)}x${Math.round(r.height)} "${label(el)}"`);
        }
      }
      return out;
    }, MIN_TAP);
    info.annotations.push({ type: enforce ? "cta-enforce" : "cta-observe", description: problems.join(" | ") || "0 problems" });
    if (enforce) expect(problems.length, `CTA/link problems:\n${problems.join("\n")}`).toBe(0);
  });
}

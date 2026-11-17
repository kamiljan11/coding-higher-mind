// a11y (axe, WCAG 2.1 A/AA) on the pages in E2E_PAGES (default "/"). OBSERVE: violations are attached to the report;
// with A11Y_ENFORCE=1 serious/critical violations fail the test. Promote to enforce after a clean month (ADR-0008).
// Needs devDependency @axe-core/playwright; without it the test is skipped (loaded dynamically, so CI stays green).
import { test, expect } from "@playwright/test";

const pages = (process.env.E2E_PAGES ?? "/").split(",").map((p) => p.trim()).filter(Boolean);
const enforce = process.env.A11Y_ENFORCE === "1";
const AXE_MODULE = "@axe-core/playwright";
const axe = await import(AXE_MODULE).catch(() => null);
type Violation = { id: string; impact?: string | null; help: string; nodes: unknown[] };

for (const path of pages) {
  test(`a11y ${path}`, async ({ page }, info) => {
    test.skip(!axe, "@axe-core/playwright not installed: npm i -D @axe-core/playwright");
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const res = await new axe.default({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    const violations: Violation[] = res.violations;
    const serious = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    const summary = violations.map((v) => `${v.impact} ${v.id} (${v.nodes.length}): ${v.help}`);
    await info.attach("axe-violations.json", { body: JSON.stringify(res.violations, null, 2), contentType: "application/json" });
    info.annotations.push({ type: enforce ? "a11y-enforce" : "a11y-observe", description: summary.join(" | ") || "0 violations" });
    if (enforce) expect(serious.length, `serious/critical axe violations:\n${summary.join("\n")}`).toBe(0);
  });
}

// Playwright for this repo (PG T6, 2026-11-07). Runs e2e/*.spec.ts: smoke, a11y (axe), cta.
// Server: E2E_WEB_SERVER (default = Vite build + preview on 4173); E2E_BASE_URL to test an already running URL.
// a11y and cta start in OBSERVE mode: they report, and fail only with A11Y_ENFORCE=1 / CTA_ENFORCE=1.
import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.E2E_PORT ?? 4173);
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${port}`;

export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["line"], ["json", { outputFile: "e2e-results.json" }]] : "list",
  use: { baseURL, trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "mobile", use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } } },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: process.env.E2E_WEB_SERVER ?? `npm run build && npm run preview -- --port ${port} --strictPort`,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});

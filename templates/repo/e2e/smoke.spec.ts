// E2E smoke — minimalny test dymny: strona wstaje, renderuje sie, konsola czysta.
// Wymaga playwright.config.ts z ustawionym baseURL (dev server albo preview).
import { test, expect } from '@playwright/test';

test('strona glowna wstaje i renderuje bez bledow konsoli', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  await page.goto('/');
  await page.waitForLoadState('networkidle');

  // Cos sie wyrenderowalo (root nie jest pusty)
  await expect(page.locator('body')).not.toBeEmpty();
  await expect(page).toHaveTitle(/.+/);

  // Zero bledow JS/konsoli na starcie
  expect(errors, `Bledy konsoli:\n${errors.join('\n')}`).toHaveLength(0);
});

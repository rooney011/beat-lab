import { expect, test } from '@playwright/test';

// These run against the production build served by `vite preview`, the same artefact Vercel deploys,
// so the service worker, manifest and precache are the real ones.

test('the app ships an installable manifest with icons', async ({ page }) => {
  await page.goto('/');
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).toBeTruthy();
  const manifest = await page.evaluate(async (url) => (await fetch(url as string)).json(), href);
  expect(manifest.name).toBe('BEAT LAB');
  expect(manifest.display).toBe('standalone');
  expect(manifest.icons.some((i: { sizes: string }) => i.sizes === '512x512')).toBe(true);
  expect(manifest.icons.some((i: { purpose?: string }) => i.purpose === 'maskable')).toBe(true);
});

test('the installed app opens offline', async ({ page, context }) => {
  await page.goto('/');
  // Wait for the service worker to install, activate and take control of the page.
  await page.waitForFunction(() => !!navigator.serviceWorker?.controller, null, { timeout: 30_000 });

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#cover')).toBeVisible();
  await context.setOffline(false);
});

import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const fixture = (p: string): string => fileURLToPath(new URL(`../fixtures/${p}`, import.meta.url));

test('the nav routes between Live input and Library', async ({ page }) => {
  await page.goto('/?debug');
  await expect(page.locator('#nav')).toBeVisible();

  await page.locator('#navLibrary').click();
  await expect(page.locator('[data-testid="library"]')).toBeVisible();
  await expect(page.locator('#navLibrary')).toHaveAttribute('aria-pressed', 'true');

  await page.locator('#navLive').click();
  await expect(page.locator('#cover')).toBeVisible();
  await expect(page.locator('[data-testid="library"]')).toBeHidden();
  await expect(page.locator('#navLive')).toHaveAttribute('aria-pressed', 'true');
});

test('the mini player shows on the library screen and opens Now Playing', async ({ page }) => {
  await page.goto('/?debug');
  await page.locator('#navLibrary').click();
  await expect(page.locator('[data-testid="library"]')).toBeVisible();

  await page.locator('.lib-import input[type="file"]').setInputFiles(fixture('audio/grit-150.flac'));
  await page.getByRole('tab', { name: 'Songs' }).click();
  await expect(page.locator('.lib-row')).toHaveCount(1, { timeout: 30_000 });

  // Playing a track leaves for Now Playing; come back to the library via the nav.
  await page.locator('.lib-row').nth(0).click();
  await expect(page.locator('[data-testid="library"]')).toBeHidden();
  await page.locator('#navLibrary').click();

  await expect(page.locator('#mini')).toBeVisible();
  await expect(page.locator('#miniTitle')).toHaveText('grit-150');

  await page.locator('#miniOpen').click();
  await expect(page.locator('[data-testid="library"]')).toBeHidden();
});

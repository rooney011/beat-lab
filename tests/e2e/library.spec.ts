import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const fixture = (p: string): string => fileURLToPath(new URL(`../fixtures/${p}`, import.meta.url));

const THREE = [
  fixture('tags/The Test Pressings - Midnight Signal.mp3'),
  fixture('audio/hype-128.flac'),
  fixture('audio/grit-150.flac'),
];

async function openLibrary(page: import('@playwright/test').Page): Promise<void> {
  await page.locator('#coverLibrary').click();
  await expect(page.locator('[data-testid="library"]')).toBeVisible();
}

test('imported songs appear under the library, survive a reload, and search finds them', async ({ page }) => {
  await page.goto('/?debug');
  await openLibrary(page);

  await page.locator('.lib-import input[type="file"]').setInputFiles(THREE);

  // The three tracks fill in as the scan writes them.
  await page.getByRole('tab', { name: 'Songs' }).click();
  await expect(page.locator('.lib-row')).toHaveCount(3, { timeout: 30_000 });

  // They persist across a reload (IndexedDB + OPFS).
  await page.reload();
  await openLibrary(page);
  await page.getByRole('tab', { name: 'Songs' }).click();
  await expect(page.locator('.lib-row')).toHaveCount(3);

  // Search narrows to the tagged MP3 by its title.
  await page.getByRole('tab', { name: 'Search' }).click();
  await page.locator('#lib-search').fill('midnight');
  await expect(page.locator('.lib-row')).toHaveCount(1);
  await expect(page.locator('.lib-row__title').first()).toHaveText('Midnight Signal');
});

test('a track plays from the library and opens the Now Playing stage', async ({ page }) => {
  await page.goto('/?debug');
  await openLibrary(page);
  await page.locator('.lib-import input[type="file"]').setInputFiles(THREE);
  await page.getByRole('tab', { name: 'Songs' }).click();
  await expect(page.locator('.lib-row')).toHaveCount(3, { timeout: 30_000 });

  await page.locator('.lib-row', { hasText: 'Midnight Signal' }).click();

  // The library closes, the stage takes over, and the chosen track is now playing.
  await expect(page.locator('[data-testid="library"]')).toBeHidden();
  await expect(page.locator('#npTitle')).toHaveText('Midnight Signal', { timeout: 15_000 });
});

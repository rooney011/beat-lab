import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const fixture = (p: string): string => fileURLToPath(new URL(`../fixtures/${p}`, import.meta.url));

const THREE = [
  fixture('tags/The Test Pressings - Midnight Signal.mp3'),
  fixture('audio/hype-128.flac'),
  fixture('audio/grit-150.flac'),
];

async function importThree(page: Page): Promise<void> {
  await page.goto('/?debug');
  await page.locator('#coverLibrary').click();
  await expect(page.locator('[data-testid="library"]')).toBeVisible();
  await page.locator('.lib-import input[type="file"]').setInputFiles(THREE);
  await page.getByRole('tab', { name: 'Songs' }).click();
  await expect(page.locator('.lib-row')).toHaveCount(3, { timeout: 30_000 });
}

const npTitle = (page: Page): Promise<string> =>
  page
    .locator('#npTitle')
    .innerText()
    .then((t) => t.trim());

test('playing a song forms a queue; next and previous move through it', async ({ page }) => {
  await importThree(page);
  const rows = page.locator('.lib-row');
  const first = (await rows.nth(0).locator('.lib-row__title').innerText()).trim();

  await rows.nth(0).click();
  await expect(page.locator('[data-testid="library"]')).toBeHidden();
  await expect(page.locator('#npTitle')).toHaveText(first, { timeout: 15_000 });

  await page.locator('#btnNext').click();
  await expect(page.locator('#npTitle')).not.toHaveText(first);

  await page.locator('#btnPrev').click();
  await expect(page.locator('#npTitle')).toHaveText(first);
});

test('shuffle plays every queued track once before repeating', async ({ page }) => {
  await importThree(page);
  await page.locator('.lib-row').nth(0).click();
  await expect(page.locator('#npTitle')).not.toHaveText('No track yet', { timeout: 15_000 });

  await page.locator('#btnShuffle').click();
  await expect(page.locator('#btnShuffle')).toHaveAttribute('aria-pressed', 'true');

  const seen = new Set<string>();
  let prev = await npTitle(page);
  seen.add(prev);
  for (let i = 0; i < 2; i++) {
    await page.locator('#btnNext').click();
    await expect.poll(() => npTitle(page)).not.toBe(prev);
    prev = await npTitle(page);
    seen.add(prev);
  }
  expect(seen.size).toBe(3); // no repeats within one pass of the queue
});

test('the queue survives a reload', async ({ page }) => {
  await importThree(page);
  await page.locator('.lib-row').nth(0).click();
  await expect(page.locator('#npTitle')).not.toHaveText('No track yet', { timeout: 15_000 });

  await page.waitForTimeout(1800); // let the debounced play-state save land
  await page.reload();

  await page.locator('#coverLibrary').click();
  await expect(page.locator('[data-testid="library"]')).toBeVisible();
  await page.getByRole('tab', { name: 'Queue' }).click();
  await expect(page.locator('.lib-row')).toHaveCount(3);
});

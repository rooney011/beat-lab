import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const fixture = (p: string): string => fileURLToPath(new URL(`../fixtures/${p}`, import.meta.url));

/**
 * Milestone 2.4: once a library track is analysed in the background, the Now Playing seek bar turns
 * into the energy curve (the `has-viz` state). This also exercises the whole Phase 2 pipeline —
 * import → background analysis worker → stored TrackAnalysis → nowPlayingAnalysis — end to end.
 */
test('the seek bar becomes the energy curve once the track is analysed', async ({ page }, info) => {
  test.skip(info.project.name === 'phone', 'covered on desktop');
  await page.goto('/?debug');
  await page.locator('#coverLibrary').click();
  await expect(page.locator('[data-testid="library"]')).toBeVisible();

  await page.locator('.lib-import input[type="file"]').setInputFiles([fixture('audio/hype-128.flac')]);
  await page.getByRole('tab', { name: 'Songs' }).click();
  await expect(page.locator('.lib-row')).toHaveCount(1, { timeout: 30_000 });

  await page.locator('.lib-row').first().click();
  await expect(page.locator('[data-testid="library"]')).toBeHidden();

  // The background analysis of the playing track completes and the seek bar switches to the curve.
  await expect(page.locator('#scrubWrap')).toHaveClass(/has-viz/, { timeout: 30_000 });
});

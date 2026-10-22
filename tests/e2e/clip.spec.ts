import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const fixture = (p: string): string => fileURLToPath(new URL(`../fixtures/${p}`, import.meta.url));

type ClipApp = {
  startClip: (o: { durationSec: number }) => void;
  state: { clip: { phase: string; url: string | null } };
};
const app = (page: Page): Promise<ClipApp['state']> =>
  page.evaluate(() => (window as unknown as { beatLab: ClipApp }).beatLab.state);

/**
 * Milestone 3.1: recording produces a real, shareable clip. We record a short (2 s) clip of a fixture
 * via the debug `window.beatLab` hook and check the preview <video> decodes a real frame.
 */
test('records a short clip with a supported type and non-zero size', async ({ page }, info) => {
  test.skip(info.project.name === 'phone', 'covered on desktop');
  await page.goto('/?debug');
  await page.locator('#file').setInputFiles(fixture('audio/hype-128.flac'));
  await expect.poll(() => app(page).then((s) => s.clip.phase)).toBe('idle');

  await page.evaluate(() => (window as unknown as { beatLab: ClipApp }).beatLab.startClip({ durationSec: 2 }));

  // 3 s countdown + 2 s capture + encode.
  await expect.poll(() => app(page).then((s) => s.clip.phase), { timeout: 30_000 }).toBe('preview');

  // The preview <video> is wired to the blob (media-src allows blob:; connect-src does not, so we
  // can't fetch it). A decoded frame (videoWidth > 0) proves a real, non-empty clip was produced.
  const probe = await page.evaluate(async () => {
    const v = document.getElementById('clipVideo') as HTMLVideoElement | null;
    if (!v?.src) return { ok: false, w: 0, dur: 0 };
    if (v.readyState < 1) {
      await new Promise<void>((res) => {
        v.onloadedmetadata = () => res();
        v.onerror = () => res();
        setTimeout(res, 5000);
      });
    }
    return { ok: v.readyState >= 1, w: v.videoWidth, dur: Number.isFinite(v.duration) ? v.duration : 0 };
  });

  expect(probe.ok).toBe(true);
  expect(probe.w).toBeGreaterThan(0);
  await expect(page.locator('#clip')).toBeVisible();
  await expect(page.locator('#clipVideo')).toBeVisible();
});

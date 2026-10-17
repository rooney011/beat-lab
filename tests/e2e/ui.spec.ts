import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const fixture = (p: string): string => fileURLToPath(new URL(`../fixtures/${p}`, import.meta.url));

/** Evaluate an expression against the app's debug handle `a` (the page is opened with ?debug). */
const read = <T = unknown>(page: Page, expr: string): Promise<T> =>
  page.evaluate(`(a => (${expr}))(window.beatLab)`) as Promise<T>;

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return errors;
}

test.beforeEach(async ({ page }) => {
  // Keep the tests hermetic: answer lyrics lookups locally.
  await page.route('https://lrclib.net/**', (route) =>
    route.fulfill({
      json: {
        trackName: 'Mock Song',
        artistName: 'Mock Artist',
        duration: 20,
        syncedLyrics: '[00:00.50]first mocked line\n[00:03.00]second mocked line',
      },
    }),
  );
});

test('cover → open a file → live stage, with no errors', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?debug');
  await expect(page.locator('#coverTitle')).toBeVisible();
  await page.locator('#file').setInputFiles(fixture('audio/hype-128.flac'));
  await expect.poll(() => read(page, 'a.state.screen')).toBe('live');
  await expect(page.locator('#cover')).toBeHidden();
  await expect(page.locator('#npTitle')).toHaveText('hype-128');
  await expect.poll(() => read(page, 'a.stats.beats'), { timeout: 20_000 }).toBeGreaterThan(4);
  await expect(page.locator('#npChips')).toContainText('Lyrics · LRCLIB');
  expect(errors).toEqual([]);
});

test('the cover primary button and Play with no source open the file picker', async ({ page }) => {
  await page.goto('/?debug');
  const primary = page.getByRole('button', { name: 'Open a file' });
  await expect(primary).toBeVisible();
  const picker = page.waitForEvent('filechooser');
  await primary.click();
  expect(await picker).toBeTruthy();
  // With no source, togglePlay (Space / the play button) falls back to the picker too.
  const picker2 = page.waitForEvent('filechooser');
  await read(page, 'a.togglePlay()');
  expect(await picker2).toBeTruthy();
});

test('keyboard: dimensions, settings, shortcut sheet', async ({ page }, info) => {
  test.skip(info.project.name === 'phone', 'keyboard flow is desktop-only');
  await page.goto('/?debug');
  await page.locator('#file').setInputFiles(fixture('audio/hype-128.flac'));
  await expect.poll(() => read(page, 'a.state.screen')).toBe('live');
  await page.keyboard.press('4');
  await expect.poll(() => read(page, 'a.state.dim')).toBe(3);
  await expect(page.locator('#btnAuto')).toHaveAttribute('aria-checked', 'false');
  await page.keyboard.press('a');
  await expect(page.locator('#btnAuto')).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('s');
  await expect(page.locator('#drawer')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#drawer')).toBeHidden();
  await page.keyboard.press('?');
  await expect(page.getByRole('dialog')).toContainText('Shortcuts');
  await page.keyboard.press('Escape');
  await expect(page.locator('#scrim')).toBeHidden();
  await page.keyboard.press('.');
  await expect(page.locator('.dims [data-sync-val]')).toHaveText(/ms$/);
  await expect.poll(() => read(page, 'a.state.syncMs')).not.toBeNull();
});

test('a tagged MP3 shows its title, artist, cover art and looked-up lyrics', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?debug');
  await page.locator('#file').setInputFiles(fixture('tags/The Test Pressings - Midnight Signal.mp3'));
  await expect(page.locator('#npTitle')).toHaveText('Midnight Signal');
  await expect(page.locator('#npArtist')).toHaveText('The Test Pressings');
  await expect(page.locator('#npAlbum')).toHaveText('Proof Sheets · 2024');
  await expect.poll(() => read(page, 'a.state.hasArt')).toBe(true);
  await expect(page.locator('#npChips')).toContainText('Lyrics · LRCLIB');
  await expect(page.locator('#npChips')).toContainText('MP3');
  expect(errors).toEqual([]);
});

test('a song dropped with its .lrc uses the file, not the lookup', async ({ page }) => {
  let lookups = 0;
  await page.route('https://lrclib.net/**', (route) => {
    lookups++;
    return route.abort();
  });
  await page.goto('/?debug');
  await page
    .locator('#file')
    .setInputFiles([fixture('audio/hype-128.flac'), fixture('audio/Night Press - Hype Test.lrc')]);
  await expect(page.locator('#npChips')).toContainText('Lyrics · LRC file');
  expect(lookups).toBe(0);
});

test('settings survive a reload', async ({ page }) => {
  await page.goto('/?debug');
  await page.locator('#file').setInputFiles(fixture('audio/hype-128.flac'));
  await expect.poll(() => read(page, 'a.state.screen')).toBe('live');
  await page.locator('#btnCalm').click();
  await page.locator('#btnCrew').click();
  await page.waitForTimeout(500);
  await page.reload();
  await expect.poll(() => read(page, '[a.state.reduce, a.state.fx.dancers]')).toEqual([true, false]);
});

test('microphone input (fake device)', async ({ page }, info) => {
  test.skip(info.project.name === 'phone', 'covered on desktop');
  await page.goto('/?debug');
  await page.getByRole('button', { name: 'Use mic' }).click();
  await expect(page.getByRole('dialog')).toContainText('Let it hear the room');
  await page.getByRole('button', { name: 'Allow mic' }).click();
  await expect
    .poll(() => read(page, '[a.state.source, a.state.playing, a.state.screen]'))
    .toEqual(['mic', true, 'live']);
  await expect(page.locator('#npTitle')).toHaveText('Microphone');
});

test('phone: the Tab source is shown but unavailable and opens the help card', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone', 'phone-only behaviour');
  // The test Chromium uses a desktop UA, which reports tab capture as supported; a real phone
  // cannot capture another tab's audio, so remove the API to reproduce that.
  await page.addInitScript(() => {
    try {
      Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', { configurable: true, value: undefined });
    } catch {}
  });
  await page.goto('/?debug');
  const tab = page.locator('#coverTab');
  await expect(tab).toBeVisible();
  await expect(tab).toHaveClass(/is-off/);
  await tab.tap();
  await expect(page.getByRole('alertdialog')).toContainText("another tab's audio");
});

test("the page CSP has no eval; the model's permission is worker-scoped only", async ({ page }) => {
  const resp = await page.goto('/?debug');
  const pageCsp = resp?.headers()['content-security-policy'] ?? '';
  expect(pageCsp).toContain("script-src 'self'");
  // Neither 'unsafe-eval' nor 'wasm-unsafe-eval' may be on the page itself.
  expect(pageCsp).not.toContain('unsafe-eval');
});

test('on-device model: the AI mood read takes over for a file', async ({ page }, info) => {
  test.skip(info.project.name === 'phone', 'the model is heavy; covered on desktop');
  await page.goto('/?debug');
  await page.locator('#file').setInputFiles(fixture('audio/hype-128.flac'));
  await expect.poll(() => read(page, 'a.state.screen')).toBe('live');
  // The quick rule-based read lands first; the model (running under the /workers/ CSP, which grants
  // eval) then takes over — proof the worker-scoped exception works while the page stays strict.
  await expect(page.locator('#npChips')).toContainText('Mood · AI', { timeout: 60_000 });
  await expect.poll(() => read(page, 'a.state.aiActive')).toBe(true);
  await expect.poll(() => read(page, 'a.aiRead ? a.aiRead.inferenceMs >= 0 : false')).toBe(true);
});

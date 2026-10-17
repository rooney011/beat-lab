import { defineConfig, devices } from '@playwright/test';

const CI = !!process.env.CI;
// Use a preinstalled Chromium when one is provided (e.g. offline sandboxes); CI installs its own.
const executablePath = process.env.CHROMIUM_PATH || undefined;
const chrome = {
  ...devices['Desktop Chrome'],
  launchOptions: {
    executablePath,
    args: [
      '--autoplay-policy=no-user-gesture-required',
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
    ],
  },
};

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  reporter: CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: 'http://localhost:4173', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...chrome, viewport: { width: 1440, height: 900 } } },
    {
      name: 'phone',
      testMatch: /ui\.spec/,
      use: { ...chrome, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: false },
    },
  ],
  webServer: [
    // The production build, exactly as deployed.
    {
      command: 'npm run build && npm run preview -- --strictPort',
      url: 'http://localhost:4173',
      reuseExistingServer: !CI,
      timeout: 120_000,
    },
    // The dev server, for the offline analysis harness in tests/harness (never shipped).
    {
      command: 'npx vite --port 5173 --strictPort',
      url: 'http://localhost:5173/tests/harness/sync.html',
      reuseExistingServer: !CI,
      timeout: 120_000,
    },
  ],
});

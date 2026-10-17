import { defineConfig } from 'vitest/config';
import vercel from './vercel.json';

// `vite preview` serves the same security headers as production (vercel.json), so the
// end-to-end tests run under the real Content-Security-Policy.
const siteHeaders = Object.fromEntries(
  (vercel.headers.find((h) => h.source === '/(.*)')?.headers ?? []).map((h) => [h.key, h.value]),
);

export default defineConfig({
  build: {
    target: 'es2022',
    sourcemap: true,
    assetsInlineLimit: 0,
  },
  preview: {
    headers: siteHeaders,
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});

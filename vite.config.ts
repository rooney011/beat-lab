import type { PreviewServer } from 'vite';
import { defineConfig } from 'vitest/config';
import vercel from './vercel.json';

// Compile each vercel.json header rule's `source` into a matcher, so `vite preview` serves exactly
// the per-path headers production does — including the page vs. /workers/ CSP split the end-to-end
// tests rely on.
const rules = vercel.headers.map((h) => ({
  test: new RegExp('^' + h.source + '$'),
  headers: h.headers,
}));

function applyHeaders(url: string, set: (key: string, value: string) => void): void {
  const path = url.split('?')[0];
  for (const rule of rules) if (rule.test.test(path)) for (const h of rule.headers) set(h.key, h.value);
}

// A dedicated worker runs under the CSP delivered with its own response, not the page's, so this
// middleware is what lets the model worker get 'unsafe-eval' while the page stays strict.
const perPathHeaders = {
  name: 'per-path-headers',
  configurePreviewServer(server: PreviewServer) {
    server.middlewares.use((req, res, next) => {
      applyHeaders(req.url ?? '/', (k, v) => res.setHeader(k, v));
      next();
    });
  },
};

export default defineConfig({
  plugins: [perPathHeaders],
  build: {
    target: 'es2022',
    sourcemap: true,
    assetsInlineLimit: 0,
  },
  worker: {
    // Classic worker (it uses importScripts for the vendored libs); emit it at a predictable
    // /workers/ path so the per-path CSP in vercel.json can target it.
    format: 'iife',
    rollupOptions: {
      output: { entryFileNames: 'workers/[name]-[hash].js' },
    },
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});

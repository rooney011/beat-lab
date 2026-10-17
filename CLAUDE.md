# BEAT LAB — notes for coding agents

Static TypeScript site (Vite, Canvas 2D, Web Audio). No framework and no npm runtime deps; the optional on-device mood model self-hosts Essentia.js + TensorFlow.js under `public/models` and runs in a Web Worker.

## Commands

- `npm run dev` — dev server on :5173
- `npm run check` — typecheck, lint, unit tests (run before every commit)
- `npm run test:e2e` — builds, serves the production build on :4173 and runs Playwright (UI flows + beat-sync regression). Set `CHROMIUM_PATH` to use a preinstalled Chromium.
- `npm run format` — Prettier

## Architecture

- `src/app.ts` is the controller. Per frame: `FeatureExtractor.update` (live audio) → `MoodReader.observe` + `DimensionDirector.update` (live) → `SyncDelay.apply` → `Stage.events` + `Stage.render` (delayed).
- State lives in one `Store<AppState>`; `src/ui/shell.ts` renders it into the static markup in `index.html`.
- Layers in `src/render/layers/` draw through a `DrawContext` and keep their own short-lived state.
- `src/ai/` is the on-device mood model: a lazy Web Worker (`public/mood-worker.js`) runs Essentia.js + TF.js off the render thread. `MoodReader` gives the instant quick read at 8 s; the model's read takes over when it arrives (`App.applyAiRead`). It is best-effort — any load/decode failure falls back silently to the quick read.

## Rules

- Anything in `src/analysis/` must stay deterministic for a given input: the beat-sync tests in `tests/e2e/analysis.spec.ts` compare against fixed numbers. Run them after any change there. The AI mood model must never touch beat detection.
- Photosensitivity guards (`src/render/safety.ts`) must not become optional.
- Keep the CSP in `vercel.json` strict: no inline scripts or styles in markup (setting `element.style` from code is fine), and `script-src` stays `'self'` (no third-party or inline script sources). The AI model adds `worker-src 'self' blob:` plus `'wasm-unsafe-eval'` and `'unsafe-eval'` in `script-src` — Essentia.js is compiled with emscripten embind, which builds its bindings with `new Function(...)` and so needs `'unsafe-eval'` (not just `'wasm-unsafe-eval'`). Don't broaden `script-src` further.
- Audio must never be uploaded. The only network call is the LRCLIB lookup, and it is user-switchable. The AI model and its files are all self-hosted under `public/models`; nothing is fetched from third parties.
- The AI mood model is `AGPL-3.0` (Essentia.js) and its model files are `CC BY-NC-ND 4.0` (non-commercial). The repo licence is `AGPL-3.0-only`; keep attribution in `public/models/ATTRIBUTION.md`.

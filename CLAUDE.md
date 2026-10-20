# BEAT LAB — notes for coding agents

Static TypeScript site (Vite, Canvas 2D, Web Audio). The stage/visualizer is framework-free; the music **library/player** screens (started in milestone 1.1, see `docs/ROADMAP.md`) use Preact + `@preact/signals`, with `idb` for IndexedDB and `music-metadata` for tag/cover reading. The optional on-device mood model self-hosts Essentia.js + TensorFlow.js under `public/models` and runs in a Web Worker.

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
- `src/library/` is the music library (milestone 1.1): `db.ts` (IndexedDB via `idb`), `scan.ts` (folder walk + rescan diff — pure, so the unit tests drive it with a fake directory handle), `files.ts` (OPFS imports + content hashing + linked-folder access), `meta.ts` (lazy `music-metadata`), `thumb.ts` (256 px cover), `store.ts` (Preact signals + import/scan/play actions), and `ui/LibraryApp.tsx` (Preact). The shell mounts it lazily into `#library-root` and plays a chosen track through `App.playLibraryFile` (the existing single-file path; the queue/deck engine is milestone 1.2). `music-metadata` runs on the **main thread**, not in a worker: the one existing worker is classic/IIFE, and music-metadata's dynamic-import code-splitting can't bundle into an IIFE worker without changing the global `worker.format` that worker relies on. The scan loop yields between files to stay responsive.

## Rules

- Anything in `src/analysis/` must stay deterministic for a given input: the beat-sync tests in `tests/e2e/analysis.spec.ts` compare against fixed numbers. Run them after any change there. The AI mood model must never touch beat detection.
- Photosensitivity guards (`src/render/safety.ts`) must not become optional.
- Keep the CSP in `vercel.json` strict: no inline scripts or styles in markup (setting `element.style` from code is fine). The **page** policy keeps `script-src 'self'` with no `eval` of any kind. The only exception is the AI model worker: Essentia.js is compiled with emscripten embind, which builds its bindings with `new Function(...)` and so needs `'unsafe-eval'` (plus `'wasm-unsafe-eval'` for WASM). A dedicated worker runs under the CSP of its own response, so that permission is scoped to `/workers/*` only — the page rule uses source `/((?!workers/).*)` to exclude it, and nothing on the main thread may load Essentia or TF.js. `vite.config.ts` has a preview middleware that serves these per-path headers so `vite preview` matches production. If you touch this, keep `'unsafe-eval'` out of the page policy.
- Audio must never be uploaded. The only network call is the LRCLIB lookup, and it is user-switchable. The AI model and its files are all self-hosted under `public/models`; nothing is fetched from third parties.
- The AI mood model is `AGPL-3.0` (Essentia.js) and its model files are `CC BY-NC-ND 4.0` (non-commercial). The repo licence is `AGPL-3.0-only`; keep attribution in `public/models/ATTRIBUTION.md`.

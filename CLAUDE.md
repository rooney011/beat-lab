# BEAT LAB — notes for coding agents

Static TypeScript site (Vite, Canvas 2D, Web Audio). No framework, no runtime dependencies.

## Commands

- `npm run dev` — dev server on :5173
- `npm run check` — typecheck, lint, unit tests (run before every commit)
- `npm run test:e2e` — builds, serves the production build on :4173 and runs Playwright (UI flows + beat-sync regression). Set `CHROMIUM_PATH` to use a preinstalled Chromium.
- `npm run format` — Prettier

## Architecture

- `src/app.ts` is the controller. Per frame: `FeatureExtractor.update` (live audio) → `MoodReader.observe` + `DimensionDirector.update` (live) → `SyncDelay.apply` → `Stage.events` + `Stage.render` (delayed).
- State lives in one `Store<AppState>`; `src/ui/shell.ts` renders it into the static markup in `index.html`.
- Layers in `src/render/layers/` draw through a `DrawContext` and keep their own short-lived state.

## Rules

- Anything in `src/analysis/` must stay deterministic for a given input: the beat-sync tests in `tests/e2e/analysis.spec.ts` compare against fixed numbers. Run them after any change there.
- Photosensitivity guards (`src/render/safety.ts`) must not become optional.
- Keep the CSP in `vercel.json` strict: no inline scripts or styles in markup (setting `element.style` from code is fine).
- Audio must never be uploaded. The only network call is the LRCLIB lookup, and it is user-switchable.

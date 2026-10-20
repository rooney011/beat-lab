# BEAT LAB

**Play music and watch a comic-book print run misfire in time with it.**

BEAT LAB is an audio-reactive visualizer for the browser. It listens to a song, your microphone or a browser tab, finds the beats, reads the song's mood, and prints the result as halftone comic art: misregistered ink plates, panel cuts on big hits, sound words, synced lyric captions and a small crew of ink figures dancing on the beat.

![The stage in Static Bloom](docs/stage-static-bloom.jpg)

| Cover                    | Pressline                              | Phone                    |
| ------------------------ | -------------------------------------- | ------------------------ |
| ![Cover](docs/cover.jpg) | ![Pressline](docs/stage-pressline.jpg) | ![Phone](docs/phone.jpg) |

## Features

- **Three inputs.** Your own files (MP3, M4A, WAV, OGG, FLAC), the microphone, or a shared browser tab (Chrome and Edge on desktop).
- **Beat detection** tuned for kicks: spectral flux over 20–280 Hz with an adaptive threshold, gated by kick-band share and a 2-frame power rise. Snares and hi-hats drive their own effects.
- **Four "dimensions"** that step up with the song's energy (Inkfall → Riso Heat → Pressline → Static Bloom). Each step adds layers rather than turning the same ones up. Changes land on a strong beat.
- **Mood reading, two ways.** A quick read with no model lands at 8 s (tempo, onset density and punch give arousal; spectral tilt gives valence). Then, on by default, a real pre-trained model runs on your device — Essentia.js MusiCNN mood classifiers in a Web Worker — hears the audio and takes over. A chip shows which read is live ("Mood · AI" or "Mood · quick read"). The mood picks the background, the dancers' style and how lyrics animate.
- **Synced lyrics** from a `.lrc` file you drop with the song, or looked up on [LRCLIB](https://lrclib.net) by artist and title. Words light up on their own timing or on an eighth-note grid.
- **Now-playing card** with title, artist, album and embedded cover art (ID3, MP4 and FLAC tags), or a generated comic cover.
- **Visual sync delay** for Bluetooth headphones: estimated from the output latency the browser reports, adjustable in 20 ms steps.
- **Photosensitivity guards** that can't be switched off: full-frame flashes are rationed to 3 per second (1 in strict mode), and a luminance monitor dims the stage if it flickers too much. Calm mode limits motion and effects.
- **Keyboard-first**: press `?` on the stage for every shortcut. Settings persist across visits.

## How it works

```mermaid
flowchart LR
  S["Sources<br/>file · mic · tab"] --> E["AudioEngine<br/>input → 2 AnalyserNodes"]
  E --> F["FeatureExtractor<br/>beats · pulse · bands · bars · string"]
  F --> M["MoodReader<br/>tempo · arousal · valence"]
  F --> L["DimensionDirector<br/>auto ladder"]
  F --> D["SyncDelay<br/>hold frames for output latency"]
  D --> R["Stage<br/>layers → camera → panels → lyrics → safety"]
```

Each animation frame the app reads both analysers, turns them into a `Features` record (`src/analysis/features.ts`), lets the mood reader and the dimension ladder react to the live audio, then passes the frame through the sync delay so the picture can be held back to match what you hear. The `Stage` (`src/render/stage.ts`) draws the layers into an off-screen scene under a "camera" (beat shake, slow roll, pulse zoom), composites it whole or re-cut into comic panels, then adds lyrics, dimension wipes and the safety checks.

**Beats.** Positive spectral flux in the low band must clear `mean × 1.5 + 0.01` of the last 42 frames, the kick band (30–150 Hz) must carry more than −28 dB of total power, and kick power must have risen at least 1.5 dB over two frames. A 230 ms refractory window applies, but a clearly stronger onset replaces a weaker one inside it.

**Dancers.** The ink crew dances on a beat clock: a phase-locked loop that free-runs at the estimated tempo and is pulled toward each detected beat.

**Audio stays on your device.** Nothing is recorded or uploaded. The only network request is the optional lyrics lookup, which sends artist, title and duration to LRCLIB (switch it off in Settings).

## Tech

TypeScript (strict), Vite, Canvas 2D and the Web Audio API. No npm runtime dependencies besides the self-hosted fonts; the optional on-device mood model self-hosts Essentia.js and TensorFlow.js (loaded in a Web Worker) under `public/models`. Unit tests run on Vitest; end-to-end and beat-sync tests run on Playwright in Chromium.

```
src/
  app.ts               controller: sources, frame loop, actions
  audio/               AudioEngine, file / mic / tab sources
  ai/                  on-device mood model: resampler, mapping, worker manager
  analysis/            features, mood, sync delay, dimension ladder
  lyrics/              LRC parser, LRCLIB client, caption renderer
  meta/                tag parser (ID3, MP4, FLAC), cover art
  render/              stage, layers, patterns, safety, band strip
  ui/                  DOM shell, dialogs
tests/
  unit/                Vitest
  e2e/                 Playwright: UI flows and beat-sync regression
  harness/             offline analysis page used by the beat-sync tests
  fixtures/            synthetic test tracks and tagged files
```

## Run it locally

Requires Node 20.19 or later.

```bash
npm ci
npm run dev          # http://localhost:5173
```

```bash
npm run check        # typecheck + lint + unit tests
npx playwright install chromium
npm run test:e2e     # builds the site, then runs UI and beat-sync tests
```

`npm run dev` also serves the **Scene Lab** at <http://localhost:5173/tools/scene-lab/>, a dev-only page for previewing every background scene against a simulated beat or a real song.
It is not part of `vite build` — see [`docs/scenes.md`](docs/scenes.md) for how scenes are chosen.

The beat-sync tests render each fixture track sample-accurately through an `OfflineAudioContext` and score the real analysis code against the known kick grid:

| Track     | Kicks caught | Mean latency | Extra beats | Dancer clock error |
| --------- | ------------ | ------------ | ----------- | ------------------ |
| Hype, 128 | 100%         | 14 ms        | 1           | 16 ms              |
| Grit, 150 | 100%         | 27 ms        | 3           | 26 ms              |
| Dreamy    | no kicks     | —            | 0           | —                  |

## Deploy

The site is fully static. On **Vercel**: import the repository, keep the detected Vite settings, deploy. `vercel.json` adds caching and security headers. The **page** Content-Security-Policy stays strict — `script-src 'self'`, no `eval`, no inline scripts, and only `lrclib.net` allowed for lyrics. The on-device model needs `eval` (Essentia.js is built with emscripten embind, which uses `new Function`), so its Web Worker is emitted to `/workers/` and served a **separate, worker-only** CSP with `'unsafe-eval' 'wasm-unsafe-eval'`; a dedicated worker runs under the policy of its own response, so that permission never reaches the page. The page rule excludes `/workers/` (`source: "/((?!workers/).*)"`) so the two policies don't stack. `vite preview` serves the same per-path headers (via a small middleware in `vite.config.ts`) so the end-to-end tests run under them.

Any other static host works too: run `npm run build` and publish `dist/`. If the site lives under a sub-path (a GitHub Pages project site, say), build with `npx vite build --base=/beat-lab/`. Serve it over HTTPS, because browsers only allow microphone and tab capture on secure origins.

## Browser support

|                          | Chrome / Edge (desktop) | Firefox | Safari  | Mobile browsers |
| ------------------------ | ----------------------- | ------- | ------- | --------------- |
| Files, mic               | yes                     | yes     | yes     | yes             |
| Tab audio                | yes                     | no      | no      | no              |
| Auto sync-delay estimate | yes                     | yes     | partial | varies          |

Where the browser doesn't report output latency, set the sync delay by hand with `,` and `.`.

## Credits

All artwork is procedural and original. The listening globe is inspired by [thinking-orbs](https://github.com/RareFormLabs/thinking-orbs) by Jakub Antalik (MIT); no code was copied, so no licence file is needed. Fonts: [Archivo](https://github.com/Omnibus-Type/Archivo), [Dela Gothic One](https://fonts.google.com/specimen/Dela+Gothic+One) and [Space Mono](https://fonts.google.com/specimen/Space+Mono), all under the SIL Open Font License. Synced lyrics courtesy of [LRCLIB](https://lrclib.net).

## Licences

BEAT LAB's code is released under the **GNU Affero General Public License v3.0** (`AGPL-3.0-only`); see [LICENSE](LICENSE). The project is AGPL because the on-device mood model depends on Essentia.js (AGPL-3.0).

The AI mood reading runs entirely in your browser; nothing is fetched from third parties at runtime. It bundles, self-hosted under `public/models`:

- **[Essentia.js](https://mtg.github.io/essentia.js/)** — feature extraction and the TensorFlow.js model add-on, by the **Music Technology Group, Universitat Pompeu Fabra (MTG/UPF)**. Licence: **AGPL-3.0**.
- Four pre-trained **MusiCNN-MSD mood classifiers** (`mood_happy`, `mood_sad`, `mood_aggressive`, `mood_relaxed`) from the [Essentia models](https://essentia.upf.edu/models.html) collection, by MTG/UPF. Licence: **Creative Commons Attribution-NonCommercial-NoDerivatives 4.0 (CC BY-NC-ND 4.0) — non-commercial use only.** Total model download ≈ **12.8 MB** (four files, ~3.2 MB each), fetched once and cached.
- **[TensorFlow.js](https://www.tensorflow.org/js)** 3.5.0 (core + WASM backend), by Google. Licence: Apache-2.0.

Attribution and full terms: [`public/models/ATTRIBUTION.md`](public/models/ATTRIBUTION.md) and [`public/models/LICENSE`](public/models/LICENSE).

Because the models are non-commercial, this project as a whole is for non-commercial use.

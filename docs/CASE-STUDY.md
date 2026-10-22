# BEAT LAB — case study & interview guide

A guide to explaining BEAT LAB: what it is, the hard problems, how they were solved, and the decisions behind them. Skim the **Elevator pitch** and **Hard problems** first; the rest is there to answer follow-ups.

---

## Elevator pitch (30 seconds)

> BEAT LAB is a music player that runs entirely in the browser — no backend, your audio never leaves the device — and turns each song into live comic-print visuals. The interesting part: it analyses every track once on-device (beat grid, song sections, drops, key) and then plays the visuals from a _script_, so instead of reacting a frame late it builds tension through a riser and cuts on the exact beat of the drop. It also beat-matches tracks into each other like a DJ. It's ~15k lines of strict TypeScript, Canvas 2D and Web Audio, with the DSP written by hand so it stays deterministic and unit-tested.

**One-sentence version:** _"A fully client-side, privacy-first music player whose visuals anticipate the music, using on-device audio analysis I wrote from scratch."_

---

## The problem & why it's interesting

A normal visualizer only _reacts_ — it reads the current frame of audio and draws it, so a visual "hit" always lands a frame or two after the sound. The goal here was to make visuals that **anticipate**: to know a drop is coming and land the cut on the beat you hear. That turns a rendering toy into three real engineering problems:

1. **Analyse music in the browser** — beats, structure, drops, key — accurately and cheaply, without a server and without blocking playback.
2. **Schedule visuals against audio you don't control precisely** — HTML media playback isn't sample-accurate, and there's output latency between "the sample plays" and "you hear it."
3. **Do all of it under hard constraints**: 60 fps, no audio uploads, a strict Content-Security-Policy, and photosensitivity safety that can't be disabled.

Everything else (library, queue, clips, auto-mix) is a real music app built around that core.

---

## Architecture at a glance

Two loops, decoupled:

- **Live render loop** (`src/app.ts`, per `requestAnimationFrame`): sources → one Web Audio mix bus → two `AnalyserNode`s → `FeatureExtractor` (beats, bands) → mood + the dimension ladder → `SyncDelay` → `Stage` (Canvas 2D). When the playing track has stored analysis, a **`ScriptDirector`** drives the stage instead of the reactive ladder.
- **Background analysis** (`src/library/analysis.ts`): a throttled one-at-a-time runner decodes each library track, hands the mono signal to a **pure-DSP Web Worker**, and stores a `TrackAnalysis` in IndexedDB. The render loop reads it back.

State is Preact signals in `src/library/store.ts` (library/queue/playback) plus a plain `Store<AppState>` for the stage shell. Storage: track metadata + analysis in **IndexedDB** (`idb`), imported audio in **OPFS**.

---

## The hard problems (what to talk about)

### 1. On-device music analysis — written from scratch

**What:** For each track, one decode produces a beat grid + confidence, downbeats (4/4 phase), a per-beat energy curve, sections with labels, drops, musical key, and integrated loudness.

**How (`src/analysis/extract/`):**

- A small **radix-2 FFT** (`fft.ts`) and STFT, since a Web Worker has no `AnalyserNode`.
- **Onsets** via spectral flux → **tempo** by weighted autocorrelation (log-normal prior around 120 BPM, with **sub-lag parabolic interpolation** so a 128 BPM track reads 128, not the 123/129 you'd get from integer lags) → **beat grid** by Ellis-style dynamic-programming beat tracking.
- **Sections** by the Foote method: beat-synchronous chroma + MFCC → self-similarity → novelty with a checkerboard kernel. Crucially, I also fold in **energy-step boundaries**, because L2-normalised novelty is amplitude-invariant and would miss an EDM drop that keeps the same timbre.
- **Drops** detected directly on the energy curve (a sharp sustained jump at a bar line) — decoupled from the fragile section labels.
- **Key** by Krumhansl–Schmuckler chroma correlation → tonic/scale/Camelot.

**The key decision:** I did _not_ use Essentia's `RhythmExtractor2013`/`KeyExtractor`, even though the project already bundles Essentia for mood. The vendored Essentia WASM is the MusiCNN-mood build only; pulling in the full core build is multiple MB, and — more importantly — the repo's rule is that analysis stays _deterministic and unit-tested against fixed numbers_. Hand-written DSP lets a synthetic 128 BPM click track assert `128 ± 1` in a unit test. Trade-off: my key detection is simpler than Essentia's, and mood extraction stayed on the existing Essentia model.

### 2. Playing the stage from a script (anticipation)

**What:** During a build the dimension ladder _holds_ and tension ramps (camera push-in, growing misregistration, count-in lettering); on the drop the stage hard-cuts to the most intense "dimension" **on the beat**.

**How:** A pure `ScriptDirector` (`src/analysis/script.ts`) takes the analysis + a **latency-compensated song clock** and returns per-frame directives. The clock is `deck.currentTime + AudioContext.outputLatency` so the cut is scheduled for when the drop is _heard_, not when the sample plays. The drop cut is **edge-triggered** — it fires on the first frame at or past the drop time, exactly once — which is what makes it unit-testable frame by frame. Fallbacks everywhere: no analysis, or beat confidence < 0.5, or live mic/tab input → the old reactive behaviour, unchanged.

### 3. Beat-matched transitions

**What:** On shuffle/playlist, tempo-compatible tracks blend like a DJ set.

**How:** A pure `planTransition` (`src/analysis/mix.ts`) picks the mix-out phrase in A and the mix-in downbeat in B, and computes a tempo-match **rate at the nearest octave** — so a 70 BPM track under a 140 BPM one plays at rate ≈ 1.0 (double-time aligned), not stretched 2×. The deck engine (`src/audio/decks.ts`) runs it: `playbackRate` with `preservesPitch`, an equal-power crossfade, a low-shelf **bass swap** on a downbeat, and — because `play()` isn't sample-accurate — a short **phase-lock loop** that measures B against A's grid and nudges `playbackRate` by ≤ ±0.5 % until they're within 10 ms (`phaselock.ts`, unit-tested to converge). Anything over 6 % apart, or low-confidence, falls back to a clean crossfade.

### 4. Staying at 60 fps under load

- Analysis runs in a **Web Worker**, one job at a time, and **pauses when the tab is hidden** or (on phones) while Now Playing is drawing — so it never fights playback for the main thread.
- The stage's render loop **stops entirely when Now Playing isn't visible** (the biggest battery saving); audio analysis keeps running.
- Library lists are **virtualised** (10k songs at 60 fps); adaptive render-scale drops resolution if frames run long.
- Clip recording reuses the live frame's computed analysis to drive a second stage at 30 fps rather than doubling the work.

### 5. Security & privacy as hard constraints

- **Audio never uploads.** The only network call is the optional LRCLIB lyrics lookup. This is a product decision (copyright, storage, trust) that also simplifies the architecture.
- **Strict CSP.** The page runs `script-src 'self'`, no `eval`. Essentia.js _needs_ `eval` (emscripten embind uses `new Function`), so its worker alone is served a scoped `'unsafe-eval'` policy from `/workers/`; a dedicated worker runs under its own response's CSP, so the permission never reaches the page. My own analysis worker is pure DSP with no `eval`. (Trade-off I'd flag honestly: Vite emits _all_ bundled workers to `/workers/`, so my pure worker also sits under the scoped policy — unused `unsafe-eval` — rather than the strict page policy. Splitting that cleanly would mean relocating the Essentia worker; out of scope for now.)

### 6. Photosensitivity safety

A flash budget rations full-frame flashes (3/s, 1/s in strict mode and while recording — clips get posted publicly) and a luminance monitor dims the stage if it flickers too much. These guards are deliberately **not** switchable off. Good example of "accessibility as a non-negotiable invariant."

---

## Key decisions & trade-offs

| Decision                                                           | Why                                                                       | Trade-off                                                        |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| No backend; everything client-side                                 | Privacy, zero hosting cost, no copyright exposure                         | No cross-device sync (that's the optional Phase 5)               |
| Own deterministic DSP, not Essentia core for beats/key             | Unit-testable against fixed numbers; lean bundle                          | More code; key detection simpler than Essentia's                 |
| Preact only for library/player screens; stage stays framework-free | Virtual scrolling/routing need a framework; the hot render path shouldn't | Two UI idioms in one app                                         |
| `<audio>` decks, not fully decoded buffers                         | Stream from disk; lock-screen controls; ~little memory                    | `play()` isn't sample-accurate → the phase-lock loop             |
| Edge-triggered, pure directors (script, transition, ordering)      | Deterministic ⇒ frame-by-frame unit tests                                 | Real-time quality (beat-match feel) still needs device listening |
| Mood via a pre-trained model; everything else hand-DSP             | Mood is perceptual/hard to rule-code; rhythm/structure are tractable      | Model is AGPL + non-commercial, which sets the project's licence |

---

## Testing

- **Determinism is the testing strategy.** Everything in `src/analysis/` is pure, so synthetic signals pin exact numbers: a 128 BPM click → `128 ± 1`; a synthetic build→drop → a drop on the right bar; a flat track → no drop; a C-major triad → C major / 8B; the phase-lock loop converges a 40 ms error to < 10 ms.
- **Unit (Vitest):** ~160 tests — scanner, search, queue/shuffle, loudness (EBU R128 compliance), extraction, script, transition planner, phase-lock, ordering, clip format.
- **End-to-end (Playwright):** import → browse → play → queue → Media Session → offline reload → record a clip; plus a **beat-sync regression** that runs the real analysis sample-accurately through an `OfflineAudioContext` and scores it against a known kick grid.
- **A CSP test** asserts the page policy has no `eval`. **CI is the source of truth** for e2e (it installs the pinned browser).

---

## Validation (and being honest about it)

The analyser is scored against a hand-annotated set (the Scene Lab's annotate mode + `docs/analysis-results.md`): tempo accuracy (±4 %, half/double counted separately), drop hit-rate (±1 beat, with false-drops-per-track), section recall (±1 bar), and per-track analysis time. The target is ≥ 70 % drop hit-rate with ≤ 1 false drop per three tracks. **The real numbers depend on hand-annotating a genre spread** — a thing to say in an interview: _"I built the measurement harness and the synthetic-audio tests; the drop-hit-rate on real tracks is the next thing to fill in, and I'd publish it failures-included."_

---

## Known limitations / what's next

- **Offline mood read deferred.** Mood during playback comes from the live quick-read + model; folding the 3-window mood into the offline analysis is a small follow-up.
- **Beat-match drift on long blends** is possible; the phase-lock loop is bounded to the first bars.
- **Clip recording is real-time**, so slow phones can drop frames — the roadmap's offline WebCodecs render (Phase 3.3) is the fix if needed.
- **Phase 5 (backend sync)** is designed but unbuilt: offline-first outbox, UUIDv7 + tombstones, one `POST /sync` endpoint; it would sync playlists/settings/analysis, never audio.

---

## Likely interview questions

- **"Why no library for the audio analysis?"** → Determinism + testability + bundle size; see decision table. The vendored Essentia is the mood build only, and the repo rule is that analysis stays unit-tested against fixed numbers.
- **"How do you land a visual on the beat if HTML audio isn't sample-accurate?"** → Latency-compensated song clock (`currentTime + outputLatency`) + edge-triggered cut; for mixing, a phase-lock loop nudging `playbackRate`.
- **"How does it stay at 60 fps while analysing?"** → Analysis in a worker, one job at a time, paused when hidden/drawing; the stage render loop stops when Now Playing is hidden; virtualised lists; adaptive render scale.
- **"Why a strict CSP, and how does the model fit?"** → Defence in depth; Essentia needs `eval`, so only its worker gets a scoped policy — the page never does.
- **"What would you do differently / next?"** → The validation numbers, the pure/`/workers/` CSP split, offline mood, and Phase 5 sync.

---

## Stack

TypeScript (strict) · Vite · Canvas 2D · Web Audio API · Web Workers · Preact + `@preact/signals` · IndexedDB (`idb`) + OPFS · `music-metadata` · Essentia.js + TensorFlow.js (on-device mood) · MediaRecorder + `canvas.captureStream` (clips) · Vitest + Playwright · deployed static on Vercel with a strict CSP. ~15k lines, no runtime backend.

See [README.md](../README.md) for features and [docs/ROADMAP.md](ROADMAP.md) for the full plan.

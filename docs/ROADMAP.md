# BEAT LAB roadmap: from visualizer to music player

This is the plan for turning BEAT LAB from a visualizer into a music player that knows each song's structure.
It's written for two readers: you, and Claude Code. Keep it at `docs/ROADMAP.md` and point Claude Code at one
milestone at a time (see [Working with Claude Code](#working-with-claude-code)).

**The five phases, in order:**

1. **Player core**: library, playback, lock-screen controls, installable app, new layout.
2. **See the drop coming**: analyse each track once, then choreograph the visuals ahead of time.
3. **Share a clip**: record 15 seconds of the visualizer with audio as a video.
4. **Auto-mix**: beat-matched crossfades and an "order by mood and energy" shuffle.
5. **Backend (optional)**: accounts and sync for playlists, settings and analysis. Never music files.

Every phase ends with something you can ship. Don't start a phase until the one before it is merged and deployed.

---

## Contents

- [Where BEAT LAB is today](#where-beat-lab-is-today)
- [Rules for every phase](#rules-for-every-phase)
- [Decisions to make first](#decisions-to-make-first)
- [Phase 1: Player core](#phase-1-player-core)
- [Phase 2: See the drop coming](#phase-2-see-the-drop-coming)
- [Phase 3: Share a clip](#phase-3-share-a-clip)
- [Phase 4: Auto-mix](#phase-4-auto-mix)
- [Phase 5: Backend (optional)](#phase-5-backend-optional)
- [Browser support](#browser-support)
- [Testing strategy](#testing-strategy)
- [Risks](#risks)
- [Licences](#licences)
- [Timeline](#timeline)
- [Working with Claude Code](#working-with-claude-code)
- [Appendix: data model](#appendix-data-model)

---

## Where BEAT LAB is today

- **Stack:** Vite + TypeScript (strict), no UI framework. Canvas 2D renderer. Vitest unit tests, Playwright
  end-to-end tests (desktop and phone projects), GitHub Actions CI, deployed on Vercel with a strict
  Content-Security-Policy.
- **Audio in:** one file at a time, microphone, or a captured browser tab. Everything goes through a Web Audio
  graph into two `AnalyserNode`s; `FeatureExtractor` turns them into beats, snares, hats, levels and 48 spectrum bars.
- **Mood:** on-device AI mood through Essentia.js in a worker (with a scoped `'unsafe-eval'`), plus the
  rule-based fallback.
- **Visuals:** four dimensions (Inkfall, Riso Heat, Pressline, Static Bloom) chosen live by the dimension ladder;
  mood-based background scenes with the listening globe; a flash budget and calm mode for safety.
- **Licence:** AGPL-3.0 (because of Essentia.js).

What's missing for a "real player": a library, a queue, anything that survives a reload, and any knowledge of a
song before it plays. The visuals only react; they never anticipate.

---

## Rules for every phase

1. **Music never leaves the device.** No uploads, no streaming, no server-side copies. That keeps you clear of
   copyright problems and storage bills, and it's a selling point.
2. **The live inputs stay.** Mic and tab capture keep working as "Live input" mode. Library features are
   added next to them, not in place of them.
3. **Safety rules don't bend.** Every new effect respects the flash budget, calm mode and reduced motion.
4. **Performance budget.** 60 fps on desktop, at least 30 fps on a mid-range phone. No main-thread task over
   50 ms while music plays. Background work (scanning, analysis) yields often and pauses when the tab is hidden.
5. **The CSP stays strict.** Any new script, worker, manifest or API origin is added to `vercel.json`
   deliberately, with a comment saying why.
6. **One milestone per branch.** Each milestone gets a branch, a pull request, a green CI run, and a check on a
   real phone through the Vercel preview before merging.
7. **Tests come with the feature.** Each milestone below lists its tests. A milestone isn't done without them.

---

## Decisions to make first

These shape everything after them. My recommendation is first in each row.

| #   | Decision                                            | Recommendation                                                                        | Alternative                       | Why                                                                                                                                                                                                                                  |
| --- | --------------------------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1  | UI for the library and player                       | **Preact + `@preact/signals`** for the new screens; the stage stays plain canvas code | Stay framework-free               | A library has virtual scrolling, search, playlists, a reorderable queue and routing. Doing that by hand means a lot of DOM bookkeeping. Preact is about 4 KB, needs no `eval`, and uses the React API that's already on your resume. |
| D2  | Where library data lives                            | **IndexedDB through `idb`** (tiny wrapper)                                            | Dexie                             | `idb` is small and typed. You'll only have a few stores.                                                                                                                                                                             |
| D3  | Where imported songs live (phones, Safari, Firefox) | **Origin Private File System (OPFS)**, written from a worker                          | Blobs in IndexedDB                | OPFS is built for large files and works in all current engines.                                                                                                                                                                      |
| D4  | Reading tags and covers                             | **`music-metadata` (`parseBlob`)**, loaded lazily inside the scan worker              | Extend your own `tags.ts`         | It already handles ID3v1/v2, MP4/M4A, FLAC, Ogg, WAV, cover art and ReplayGain tags. Keep `tags.ts` for the single-file path until the library replaces it.                                                                          |
| D5  | Playback engine                                     | **Two `<audio>` "decks" routed into the Web Audio graph**                             | Decode every track into memory    | Media elements stream from disk, work with lock-screen controls, and cost little memory. Fully decoded tracks cost about 100 MB each for 5 minutes of stereo audio.                                                                  |
| D6  | Routing                                             | **Hash routes** (`#/albums`, `#/now`)                                                 | History API plus a Vercel rewrite | Hash routes need no server config and work offline as-is.                                                                                                                                                                            |

---

## Phase 1: Player core

**Goal:** BEAT LAB becomes the music app you'd actually open: your songs are there next time, it plays a queue
properly, it responds to media keys and the lock screen, and it installs like an app.

Phase 1 is big, so it's four milestones. Ship each one separately.

### 1.1 Library and storage

**What you get:** add your music once and it's there next time. Browse by album, artist or song, and search.

**Two ways in:**

|                 | Link a folder                                                                                                                                                                                                                      | Import songs                                                                                         |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Where           | Chrome and Edge on a computer. Recent Chrome on Android also lists support (check it on your phone).                                                                                                                               | Everywhere, and the only way on iPhone, Safari and Firefox.                                          |
| How             | `showDirectoryPicker({ id: 'music', mode: 'read' })`                                                                                                                                                                               | `<input type="file" multiple accept="audio/*">`, plus `webkitdirectory` for folder import on desktop |
| What's stored   | The folder handle (in IndexedDB) and a list of tracks. The files stay where they are.                                                                                                                                              | A copy of each file in OPFS, plus the track list.                                                    |
| Next visit      | Ask for permission again with `handle.requestPermission({ mode: 'read' })`. This needs a click, so show a "Reconnect your music folder" button. Chrome 122+ offers "Allow on every visit", and installed apps keep the permission. | Nothing to do.                                                                                       |
| Changes on disk | A "Rescan" button. Compare relative path + size + last-modified to find new, changed and removed files.                                                                                                                            | Not applicable.                                                                                      |

**Scanning:**

- Walk the folder recursively and keep audio files only: `.mp3 .m4a .aac .flac .ogg .opus .wav`.
- Parse tags in a **worker** with `music-metadata`. Read headers only; don't read whole files.
- Covers: hash each picture so 12 songs from one album store one cover. Make a 256 px thumbnail in the worker
  (`createImageBitmap` + `OffscreenCanvas`), and store the thumbnail and the original.
- Write to IndexedDB in batches of about 200 tracks, so the library fills in as the scan runs and stays usable.
- Show progress ("Scanning 1,240 of 3,000"), allow cancel, and resume after a reload.
- Tracks without cover art get the generated comic cover you already have.

**Track identity:**

- `id`: stable per library entry. For a linked folder, a hash of folder id + relative path. For an import, a UUID.
- `fileHash`: SHA-256 of the file size + the first 256 KB. It finds duplicates, and in Phase 5 it lets two
  devices agree that they have the same file.

**Browsing:**

- **Albums:** grouped by album artist + album, sorted by artist then year.
- **Artists:** each artist with their albums.
- **Songs:** a sortable table (title, artist, album, length, date added).
- **Recently added** and **Recently played**.
- **Search:** one box for title, artist and album. Normalise text (lowercase, strip accents with `NFD`) and match
  substrings in memory. 10,000 tracks filter in a few milliseconds, so no search library is needed yet.

**Storage safety:**

- Call `navigator.storage.persist()` after the first import, and show space used from `navigator.storage.estimate()`.
- Safari can clear stored data for sites that haven't been opened in a while. Adding BEAT LAB to the Home Screen
  makes this less likely. Say so in the import screen on iPhone, and make re-importing easy.

**Tests:**

- Unit: the folder scanner against a fake directory handle (a small object with `entries()`), covering nested
  folders, non-audio files and rescans with added, changed and removed files.
- Unit: search normalisation ("Beyoncé" matches "beyonce").
- e2e: import three tagged fixture files with `setInputFiles`. They appear under Albums, survive a reload, and
  search finds each one. (Playwright can't drive the native folder picker, so the folder path is covered by the
  unit tests.)

**Done when:**

- [ ] A 2,000-track folder imports on Chrome desktop in under 2 minutes, and the library is usable during the scan. _(pending a large-library benchmark; small imports are instant and the scan yields between files)_
- [x] Closing and reopening the browser keeps the library. The reconnect button restores folder access.
- [x] On an iPhone, 20 imported songs survive a reload.
- [x] All the tests above pass in CI.

### 1.2 Playback engine

**What you get:** a queue, playlists, shuffle and repeat, smooth handovers between tracks, and songs at the same
loudness.

**The audio graph:**

```
deck A: <audio> → MediaElementSource → trim gain (loudness) → fade gain ─┐
                                                                         ├→ mix bus → analysers (visuals)
deck B: <audio> → MediaElementSource → trim gain (loudness) → fade gain ─┘        → safety limiter → speakers
```

- Two decks. The current song plays on one; the next song loads on the other about 20 seconds before the end.
- Files play through object URLs (`URL.createObjectURL(file)`), revoked when the deck unloads.
- The visualizer analyses the **mix bus**, so it always shows what you hear, crossfades included.
- The safety limiter is a `DynamicsCompressorNode` set like a limiter (threshold −1 dB, high ratio, fast attack).
  It only matters when loudness levelling boosts a quiet track.

**Handovers:**

| Mode                        | When                                                                  | How                                                                                                                                                                                                                                                                     |
| --------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Crossfade                   | Default for shuffle and playlists (0–12 s, user setting, default 4 s) | Start deck B, ramp both fade gains with equal-power curves (`setValueCurveAtTime`).                                                                                                                                                                                     |
| Near-gapless                | Albums (crossfade 0)                                                  | Start deck B as deck A reaches its end. Expect a gap of tens of milliseconds, because `play()` doesn't start at a sample-exact time.                                                                                                                                    |
| True gapless (stretch goal) | Albums that run into each other (live albums, DJ mixes) on desktop    | Decode the next track with `decodeAudioData` and start it with `AudioBufferSourceNode.start(when)` at the exact boundary: the approach the Gapless-5 library uses. Only when the track is under about 12 minutes and the device has memory to spare. Skip it on phones. |

Be honest in the UI: call it "gapless" only where it really is.

**Loudness levelling:**

- **Target:** −14 LUFS integrated (the common streaming level).
- **Source 1, ReplayGain tags:** ReplayGain 2 tags are relative to −18 LUFS, so gain to −14 LUFS =
  `REPLAYGAIN_TRACK_GAIN + 4 dB`. Opus files use `R128_TRACK_GAIN` instead.
- **Source 2, measure it yourself** (ITU-R BS.1770 / EBU R128): K-weighting filter, 400 ms blocks with 75%
  overlap, absolute gate −70 LUFS, relative gate −10 LU. Run it in the background job queue that Phase 2 builds
  on: decode the file, measure, store `{ lufs, peak }` on the track.
- **Clamp:** never boost past a peak of −1 dBFS, and never by more than +9 dB.
- **Album mode:** when an album plays in order, use album gain so quiet tracks stay quiet relative to loud ones.
- Until a track is measured, play it at 0 dB. Don't guess.

**Queue and playlists:**

- The queue is a list of track ids plus a position. Actions: play now, play next, add to queue, remove, and
  drag to reorder.
- **Shuffle:** a Fisher–Yates shuffle of the remaining tracks. Keep history, so Previous goes back to what
  actually played.
- **Repeat:** off, all, one.
- **Playlists:** create, rename, delete, add and remove tracks, reorder. Store track ids plus title, artist and
  length, so a playlist can still be matched if a file is re-imported later.
- Save the queue, position and current time every few seconds and on `pagehide`. Reopening the app resumes
  where you left off, paused.

**Tests:**

- Unit: queue operations, shuffle history and repeat modes (pure functions, no audio).
- Unit: the loudness meter. EBU Tech 3341 test 1: a 1 kHz stereo sine at −23 dBFS must read −23.0 ± 0.1 LUFS.
  Add a gating test: the same tone with silence in between must still read −23.
- Unit: ReplayGain parsing and the clamp rules.
- e2e: play a fixture album; Next and Previous work; shuffle never repeats until every track has played; the
  queue survives a reload.

**Done when:**

- [x] A whole album plays through with no clicks, and handovers are near-gapless.
- [x] Crossfade works, and the visualizer follows it.
- [x] Measured tracks play within ±1 LU of the target.
- [x] The queue and position survive a reload.

### 1.3 Feels like a real app

**What you get:** lock-screen and notification controls on phones, media keys on keyboards, an installable app
that opens offline.

**Media Session:**

- Set `navigator.mediaSession.metadata` (title, artist, album, artwork from the cover thumbnail) whenever the
  track changes.
- Handle `play`, `pause`, `previoustrack`, `nexttrack`, `seekto`, `seekbackward`, `seekforward` and `stop`.
- Call `setPositionState({ duration, position, playbackRate })` on play, pause, seek and track change.
- Keyboard media keys on desktop Chrome and Edge go through the same handlers.

**iPhone background audio (test this first):** BEAT LAB routes audio through Web Audio for the visuals. iOS has
had bugs where audio routed through an `AudioContext` stops when the screen locks. WebKit bug 261554 was fixed in
iOS 17.5, but it regressed before that. **Day 1 of this milestone: lock a real iPhone with music playing.** If audio
stops, see the iOS risk in [Risks](#risks) for the fallback.

**Installable and offline:**

- Web app manifest: name, short name, icons (192 px, 512 px and a maskable icon), `display: standalone`, theme and
  background colours, `start_url` and `scope`.
- Service worker through `vite-plugin-pwa` (Workbox): precache the app shell, and cache the Essentia model files
  the first time they load.
- When a new version is available, show an "Update available" toast and reload only when the user taps it.
- CSP: add `worker-src 'self'` and `manifest-src 'self'`. Check that the scoped CSP on the Essentia worker still
  applies when the worker is served from the service-worker cache.
- Nice extra on desktop Chrome and Edge: `file_handlers` in the manifest, so "Open with BEAT LAB" works on audio
  files once installed.

**Tests:**

- e2e: after a track change, `navigator.mediaSession.metadata.title` matches the song.
- e2e: load the app, go offline (`context.setOffline(true)`), reload; the app and library still load.
- Manual checklist: Android lock screen, iPhone lock screen, keyboard media keys, install on desktop and Android,
  Add to Home Screen on iPhone.

**Done when:**

- [ ] Lock-screen controls work on Android and iPhone, and music keeps playing with the screen locked.
- [ ] The app installs on desktop and Android, and opens offline.

### 1.4 Layout

**What you get:** the library is a grid of comic-style covers; the visualizer becomes the full-screen Now Playing
view.

**Screens:**

- **Library:** Albums (default), Artists, Songs, Playlists, Search.
- **Album page:** big cover, a header coloured from the cover palette (reuse `extractPalette`), track list, Play
  and Shuffle buttons.
- **Now Playing:** the visualizer, full screen, with transport controls that fade out after 3 seconds without
  input.
- **Mini player:** cover, title, play/pause, next and a progress line, on every screen except Now Playing. Tap
  it to open Now Playing.
- **Queue:** a side drawer on desktop and a bottom sheet on phones.

**Layout by device:** a left sidebar on desktop; a bottom tab bar with the mini player above it on phones.

**Comic-style covers:** print each cover with a light halftone overlay and a two-pixel offset second ink. On hover
or focus the offset grows, as if the print slipped. Generated comic covers fill in for missing art.

**Performance:**

- Virtualise the album grid and the songs table: only render rows near the viewport. 10,000 songs must scroll
  smoothly.
- **Stop the stage's render loop when Now Playing isn't visible.** Keep audio analysis running if mood or
  analysis needs it, but don't draw. This is the biggest battery saving in the whole phase.

**Keyboard:** Space play/pause, ←/→ seek 5 s, Shift+←/→ previous/next, `/` focus search, `N` open Now Playing,
`Q` open the queue.

**Accessibility:** covers are links with the album and artist as their label; focus moves to the page heading on
route change; reduced motion turns off the hover misprint and grid animations.

**Done when:**

- [ ] Every screen works on a 360 px wide phone and a 1440 px desktop.
- [ ] Scrolling 10,000 songs holds 60 fps on desktop.
- [ ] With Now Playing closed, the stage draws nothing.
- [ ] The existing e2e flows (mic, tab, file) still pass, now reached from a "Live input" entry.

---

## Phase 2: See the drop coming

**Goal:** analyse each track once, in the background, and save its beat grid, sections, energy curve and mood.
The stage then plays from a script: it builds tension before a drop and cuts to Static Bloom on the exact
beat, instead of reacting a moment late.

This is the most original part of the project, and the part interviewers will ask about. Measure how well it works
(see [Validation](#validation)) so you can quote real numbers.

### 2.1 The analysis queue

- **Priority:** the playing track first, then the next tracks in the queue, then the rest of the library while
  the app is idle.
- **Throttling:** one job at a time. Pause while the tab is hidden. On phones, pause while Now Playing is
  drawing.
- **Decoding:** `OfflineAudioContext` isn't available in workers, so decode on the main thread with
  `decodeAudioData` (it's asynchronous), at 22,050 Hz to halve memory. Downmix to mono and send the samples to a
  worker as a transferable `Float32Array`. A 4-minute track is then about 21 MB.
- **Versioning:** every result carries `ANALYSIS_VERSION`. Bump it when an algorithm changes, and old results
  are redone in the background.
- **Budget:** a 4-minute track should analyse in under 3 seconds on a desktop and under 10 seconds on a mid-range
  phone, with no long tasks on the main thread.

### 2.2 What gets computed

All of this runs in the worker on the decoded mono signal (1024-sample frames, 512-sample hop, about 43 frames
per second).

| Output                     | How                                                                                                                                                                     | Notes                                                                                  |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| **Tempo and beats**        | Essentia.js `RhythmExtractor2013` (an algorithm, so AGPL like the rest of Essentia.js, with no non-commercial model licence)                                            | Proven, and Essentia.js is already in the project for mood. Keep its confidence value. |
| **Downbeats (bar starts)** | Assume 4/4. Of the four possible phases, pick the one where bass onsets and harmonic changes line up best.                                                              | Your own code. Store the index of the first downbeat.                                  |
| **Energy curve**           | Short-term loudness (3 s window, K-weighted) per beat, plus low-band energy and onset density, scaled 0–1 within the track                                              | Also used by the seek bar in 2.4.                                                      |
| **Sections**               | Beat-synchronous MFCC + chroma → self-similarity matrix → novelty curve (checkerboard kernel, 16–32 beats) → peaks snapped to bar lines, preferring multiples of 8 bars | Your own code, the classic Foote method.                                               |
| **Section labels**         | intro, verse, build, drop, breakdown, outro, from each section's mean energy, energy slope, onset density and position                                                  | Heuristics, each with a confidence score.                                              |
| **Drops**                  | A boundary where energy jumps sharply (for example, more than 35% of the track's range) right after a rising section, and the bass returns                              | The headline feature. Store time + confidence.                                         |
| **Mood**                   | Your Essentia mood models on three windows (around 30%, 50% and 70% through the track)                                                                                  | Moves the AI mood off the live path: it's ready before the song plays.                 |
| **Key** (for Phase 4)      | Essentia `KeyExtractor`                                                                                                                                                 | Store key, scale and Camelot code.                                                     |
| **Loudness**               | The BS.1770 meter from Phase 1                                                                                                                                          | One decode, two results.                                                               |

**Stored per track** (about 10–30 KB): see `TrackAnalysis` in the [appendix](#appendix-data-model).

### 2.3 Playing from the script

**The song clock:**

- Song position = the deck's `currentTime`, smoothed against `AudioContext.currentTime` so it doesn't jitter
  between `timeupdate` events.
- Subtract the output delay: `AudioContext.outputLatency` where the browser has it, otherwise `baseLatency`, plus
  your existing user sync-delay setting.

**Before a drop** (the build: from the detected build start, or 16 bars before the drop):

- Tension `τ` goes from 0 to 1 across the build.
- The dimension ladder holds; nothing climbs early.
- The colours drain toward Inkfall, the misregistration jitter grows, speed lines tighten, the camera pushes in
  slowly, and the burst shrinks as if charging.
- On the last bar, comic lettering counts it in ("3… 2… 1…" or "WAIT FOR IT").

**On the drop:**

- Schedule the cut for the exact beat: on the first frame where position ≥ drop time − half a frame, hard-cut to
  Static Bloom with no wipe, plus a big burst and a camera kick.
- The cut's flash spends from the flash budget like any other flash, and calm mode replaces it with a cut
  without the flash.

**After the drop:** hold Static Bloom for the drop section, then let section labels steer the ladder (a breakdown
falls back to Riso Heat, an outro to Inkfall).

**Fallbacks:**

- No analysis yet, or beat confidence under 0.5: the current reactive behaviour.
- Analysis finishes mid-song: switch to the script at the next section boundary, never mid-bar.
- Live input (mic or tab) is always reactive. There's nothing to analyse ahead.

### 2.4 Show it in the player

- **Seek bar:** draw the energy curve as the progress bar, with section boundaries as ticks and drops as small
  starbursts. People can literally see the drop coming, and jump to it.
- **Track info:** BPM, key, mood and "Drop at 1:12".

### Validation

Without numbers this is just a demo. With them, it's a project you can defend.

- **Annotation tool:** add a mode to the Scene Lab (dev-only) where you press `D` at each drop and `S` at each
  section change while a song plays, and it saves JSON.
- **Dataset:** 20–30 tracks across genres, marked by hand. Keep annotations of copyrighted songs on your machine.
  Commit only annotations of CC-licensed tracks, with their sources.
- **Metrics** (write the results into `docs/analysis-results.md`):
  - Tempo accuracy: within 4% of the true tempo, counting half/double tempo separately.
  - Beat F-measure: a beat counts as a hit within ±70 ms.
  - Drop hit rate: within ±1 beat. Also report false drops per track.
  - Analysis time per track, on desktop and phone.
- **Unit tests** with synthetic audio: a click track at 128 BPM measures 128 ± 1. A synthetic build (rising noise
  and a snare roll) into a loud section is detected as a drop on the right bar. A track with no big change reports
  no drop.

**Done when:**

- [ ] On your annotated set, the drop hit rate is at least 70%, with at most one false drop per three tracks.
      Write the real numbers down either way.
- [ ] The visuals cut on the beat: visually checked on 10 tracks, and within one frame in a recorded check.
- [ ] Nothing in the UI stutters while analysis runs.
- [ ] Unanalysed tracks and live input behave exactly as before.

**What to say about it in interviews:** a music-analysis pipeline that runs entirely in the browser; beat tracking
plus your own downbeat and section detection; latency compensation so a visual lands on a beat you hear; and an
honest evaluation with numbers and known failure cases.

---

## Phase 3: Share a clip

**Goal:** one tap records 15 seconds of Now Playing with its audio, as a video people can post.

### 3.1 Recording (first version)

- **Video:** a dedicated recording canvas in the clip's shape (9:16 at 1080 × 1920 on desktop, 720 × 1280 on
  phones; 1:1 as an option). The stage draws a "clip layout" into it: centred composition, song title and artist
  as a comic caption, and a small "BEAT LAB" credit.
- **Capture:** `recordCanvas.captureStream(30)` for video, plus a `MediaStreamAudioDestinationNode` fed from the
  mix bus for audio. Combine both tracks into one `MediaStream` and record it with `MediaRecorder`.
- **Format:** pick the first type `MediaRecorder.isTypeSupported()` accepts:
  1. `video/mp4;codecs=avc1.42E01E,mp4a.40.2` (H.264 + AAC, the most shareable)
  2. `video/mp4;codecs=avc1.42E01E,opus`
  3. `video/mp4`
  4. `video/webm;codecs=vp9,opus`
  5. `video/webm`

  Safari records MP4. Chrome can record MP4 too, but H.264 and AAC depend on the operating system, and audio may
  fall back to Opus. Firefox records WebM. WebM won't post to some social apps, so tell people when that's what
  they got.

- **Bitrate:** about 8 Mbps at 1080 × 1920 and 5 Mbps at 720 × 1280.
- **UI:** a record button in Now Playing; a 3-2-1 countdown; a ring that fills over 15 seconds; then a preview with
  Share, Save and Discard.
- **Share:** if `navigator.canShare({ files: [file] })` is true, use `navigator.share`. That works on phones.
  Otherwise, download. Name the file `beatlab-<song>-<date>.mp4`.

### 3.2 Clip the drop (uses Phase 2)

- A "Clip the drop" button seeks to 5 seconds before the track's main drop and records from there. This is the
  clip people will actually want.

### 3.3 Offline render (stretch goal)

- Real-time recording drops frames on slow phones. The fix is to render offline: encode frames with WebCodecs
  `VideoEncoder` and `AudioEncoder`, then write an MP4 with **Mediabunny** (MPL-2.0).
- This needs the stage to run from a fixed timestep, with audio features computed from the decoded samples rather
  than live analysers. It's real work. Only do it if real-time clips look bad on your phone.

### 3.4 Rules

- **Copyright:** the clip contains the song. Show a one-line note that posting copyrighted music is the user's
  responsibility, and offer "Visuals only (no audio)".
- **Safety:** clips get posted where anyone can watch them, so recording always uses the strict flash budget
  (1 flash per second).

**Tests:**

- e2e (Chromium): record a 2-second clip of a fixture track. The result has a supported type, a non-zero size,
  and a duration of about 2 seconds when loaded into a `<video>`.
- Manual: share to WhatsApp and Instagram from Android and iPhone; open the file on a desktop.

**Done when:**

- [ ] A 15-second clip records on Chrome desktop, Android Chrome and iPhone Safari, with audio in sync.
- [ ] The clip shares from phones without leaving the app.
- [ ] "Clip the drop" starts the clip 5 seconds before the drop.

---

## Phase 4: Auto-mix

**Goal:** songs flow into each other like a DJ set (beats lined up, bass swapped cleanly), and a shuffle that
orders songs by mood and energy.

Requires Phase 2's beat grids, sections and keys.

### 4.1 Beat-matched transitions

**Planning a transition** from track A into track B:

1. **Mix-out point in A:** the start of A's outro, or the last 8-bar phrase boundary at least 16 bars before the
   end, where energy is falling.
2. **Mix-in point in B:** B's first downbeat, or the start of its intro.
3. **Length:** 8, 16 or 32 bars, whichever fits in both A's outro and B's intro.
4. **Tempo:** if B's BPM is within 6% of A's (also try half and double), play B at `playbackRate = bpmA / bpmB`
   with `preservesPitch = true` so the key doesn't shift. Supported in current Chrome, Edge, Firefox and Safari.
5. **Phase lock:** start B so its downbeat lands on A's downbeat. `play()` timing isn't exact, so for the first
   few bars measure the phase error between the two beat grids every frame and nudge B's `playbackRate` by up
   to ±0.5% until the error is under 10 ms.
6. **EQ:** each deck gets a low-shelf filter (`BiquadFilterNode`). Halfway through, on a downbeat, swap the bass:
   cut A's lows and bring B's in. Volumes follow equal-power curves.
7. **After A is gone:** ease B's `playbackRate` back to 1.0 over 8 bars.

**When not to beat-match:** tempos more than 6% apart, beat confidence under 0.5, or no analysis. Fall back to a
normal crossfade at a phrase boundary, or to a clean cut on a downbeat. A plain crossfade is better than a
trainwreck.

**Optional:** prefer transitions between compatible keys (neighbours on the Camelot wheel).

### 4.2 Order by mood and energy

- **Energy arcs** to choose from: Warm up → peak → cool down; Steady; Build all the way.
- **Ordering:** a beam search (width 5) from a starting track, picking each next track by the lowest cost:

  ```
  cost(a → b) = 1.0 · tempo distance
              + 0.6 · key distance (Camelot)
              + 1.5 · |energy(b) − arc target at this position|
              + 0.8 · mood distance
              + 2.0 · (same artist as the last 2 tracks)
  ```

- The weights above are a starting point. Tune them by listening, then write down why you landed where you did.
- Seed it, so the same playlist and arc give the same order.

**Tests:**

- Unit: transition planning on synthetic beat grids (picks phrase boundaries, refuses tempo gaps over 6%, handles
  half/double tempo).
- Unit: the phase-lock maths (given two grids and an offset, converges under 10 ms).
- Unit: ordering follows the arc and never puts the same artist three times in a row.
- Manual: a 10-track mix on desktop and phone. Note every transition that sounds wrong and why.

**Done when:**

- [ ] On tracks within 6% tempo, transitions stay beat-matched, with no audible flamming.
- [ ] Mismatched tracks fall back cleanly.
- [ ] "Order by mood and energy" produces an order you'd actually play.

---

## Phase 5: Backend (optional)

**Goal:** sign in on a second device and find your playlists, settings and analysis waiting. No music files ever
touch the server.

Do this only if Phases 1–3 are done and you want backend work on the project too. It's valuable for your resume,
but it isn't what makes BEAT LAB interesting.

### 5.1 Scope

- **Synced:** playlists, queue, settings, play counts, analysis results.
- **Never synced:** audio files, cover images (regenerated from files on each device), folder paths.

### 5.2 Matching songs across devices

The same song can be a different file on each device. Use two levels:

1. **Exact:** `fileHash` (Phase 1), when the same file was copied to both devices.
2. **Fuzzy:** normalised title + artist, and duration within ±2 seconds.

Playlist items store both, so a playlist made on a laptop finds the right songs on a phone.

### 5.3 Stack

- **API:** NestJS + Prisma + PostgreSQL. You keep TypeScript on both sides and can share types. FastAPI +
  SQLModel works just as well if you'd rather show Python.
- **Auth:** Auth0, which you've used, or passkeys through a hosted provider. The API only verifies tokens.
- **Hosting:** the API on Render, Fly.io or Railway; Postgres on Neon or Supabase. Check their current free tiers
  before you pick.
- **Frontend:** stays on Vercel. Add the API origin to the CSP's `connect-src`.

### 5.4 Sync

- **Offline first:** every change is written locally, then sent from an outbox when online.
- Records have UUIDv7 ids, `updated_at`, and a `deleted` flag (tombstones), so deletes sync too.
- **One endpoint:** `POST /sync { cursor, changes[] }` applies the changes (last write wins per record) and returns
  everything that changed since `cursor`, plus a new cursor.
- **Tables:** `users`, `devices`, `tracks` (per-user fingerprints and tags), `playlists`, `playlist_items`,
  `settings`, `analysis`, `plays`.

### 5.5 Privacy and security

- What someone listens to is personal. Offer export (JSON) and delete-account from day one. No third-party
  analytics.
- Analysis results stay per user. A shared cache across users would save computing, but it would reveal who owns
  which songs. If you ever add one, make it opt-in.
- Rate limiting, CORS locked to your app's origin, and input validation on every endpoint.
- Licence: the frontend is AGPL. A separate backend repo can use any licence you choose.

**Done when:**

- [ ] Sign in on two devices: a playlist made on one appears on the other within a few seconds, with songs matched.
- [ ] Changes made offline sync once you're back online.
- [ ] Export and delete-account work.

---

## Browser support

What to expect, per feature. "Check" means confirm it on a real device before relying on it.

| Feature                                    | Chrome / Edge (computer)                    | Chrome (Android)              | Firefox                        | Safari (Mac)      | Safari (iPhone)                                      |
| ------------------------------------------ | ------------------------------------------- | ----------------------------- | ------------------------------ | ----------------- | ---------------------------------------------------- |
| Link a music folder                        | Yes (persistent permission from Chrome 122) | Listed from Chrome 132: check | No                             | No                | No                                                   |
| Import into browser storage                | Yes                                         | Yes                           | Yes                            | Yes               | Yes (install to Home Screen to reduce data clearing) |
| Lock-screen and media keys (Media Session) | Yes                                         | Yes                           | Yes                            | Yes               | Yes                                                  |
| Background audio through Web Audio         | Yes                                         | Yes                           | Yes                            | Yes               | Fixed in iOS 17.5; check                             |
| Install as an app                          | Yes                                         | Yes                           | No install prompt on computers | Yes (Add to Dock) | Add to Home Screen                                   |
| `preservesPitch` (Phase 4)                 | Yes                                         | Yes                           | Yes                            | Yes (17+)         | Yes (17+)                                            |
| Record MP4 clips                           | Yes; H.264/AAC depend on the OS             | Yes; check codecs             | WebM only                      | Yes               | Yes                                                  |
| Share a file from the app                  | Varies; offer download                      | Yes                           | Varies; offer download         | Yes               | Yes                                                  |

---

## Testing strategy

- **Unit (Vitest):** everything that's pure logic: scanner, search, queue, shuffle, loudness meter, ReplayGain,
  analysis algorithms on synthetic signals, transition planner, ordering.
- **End-to-end (Playwright, desktop + phone projects):** import, browse, play, queue, Media Session metadata,
  offline reload, clip recording.
- **Fixtures:** a handful of tiny tagged CC0 files (MP3, M4A, FLAC, Ogg; a second or two each) committed under
  `tests/fixtures/audio/`, plus WAV files generated in the tests themselves for synthetic signals.
- **Manual device checklist** for every phase, kept in `docs/device-checklist.md`: Android Chrome and iPhone
  Safari at minimum.
- **CI is the source of truth.** Local runs can use a different browser build (`CHROMIUM_PATH`); CI installs the
  pinned one.

---

## Risks

| Risk                                                                 | Likelihood | Impact                  | What to do                                                                                                                                                                                                                                                    |
| -------------------------------------------------------------------- | ---------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| iPhone stops audio routed through Web Audio when the screen locks    | Medium     | High                    | Test on day 1 of milestone 1.3. Fallback: on iOS, play through a plain `<audio>` element that isn't routed into Web Audio, and drive the visuals from Phase 2's saved analysis (store a small 48-bar spectrogram at 30 fps, about 350 KB per 4-minute track). |
| Safari clears imported songs                                         | Medium     | Medium                  | Request persistent storage, encourage Home Screen install, make re-import easy, and never treat the browser's copy as the only copy.                                                                                                                          |
| Gapless isn't truly gapless                                          | High       | Low                     | Crossfade by default. Sell near-gapless honestly, and make true gapless a desktop-only stretch goal.                                                                                                                                                          |
| Drop detection misses on some genres                                 | High       | Medium                  | Confidence thresholds plus the reactive fallback. Publish real numbers, failures included.                                                                                                                                                                    |
| Phones slow down with library UI, analysis and the stage all running | Medium     | High                    | Stop the stage when hidden, pause analysis while drawing, virtualise lists, and test on a mid-range Android.                                                                                                                                                  |
| The service worker breaks the CSP or the Essentia worker             | Medium     | Medium                  | e2e tests run against the production build with real headers. Test offline reload.                                                                                                                                                                            |
| **Essentia models are CC BY-NC-ND 4.0 (non-commercial)**             | Certain    | High if you ever charge | Fine for a free portfolio project. Before any paid feature, replace the models or get a licence.                                                                                                                                                              |
| Scope creep                                                          | High       | High                    | One milestone per branch. Phases 1–3 are the core. Phases 4–5 are optional.                                                                                                                                                                                   |

---

## Licences

| Component                         | Licence         | Notes                                                                   |
| --------------------------------- | --------------- | ----------------------------------------------------------------------- |
| BEAT LAB                          | AGPL-3.0        | Because of Essentia.js                                                  |
| Essentia.js (code and algorithms) | AGPL-3.0        | Already in use                                                          |
| Essentia models (mood)            | CC BY-NC-ND 4.0 | Non-commercial only. See [Risks](#risks).                               |
| Preact, `@preact/signals`         | MIT             |                                                                         |
| `idb`                             | ISC             |                                                                         |
| `music-metadata`                  | MIT             |                                                                         |
| `vite-plugin-pwa` / Workbox       | MIT             |                                                                         |
| Mediabunny (Phase 3 stretch)      | MPL-2.0         | File-level copyleft. Fine to use as a dependency.                       |
| Gapless-5                         | MIT             | Approach referenced only, not used                                      |
| thinking-orbs                     | MIT             | Listening globe inspired by it; no code copied. Credited in the README. |

---

## Timeline

Rough estimates, assuming about 12–15 hours a week with Claude Code doing most of the typing and you reviewing,
testing on devices and making the calls.

| Phase                  | Milestones                                          | Estimate    |
| ---------------------- | --------------------------------------------------- | ----------- |
| 1. Player core         | 1.1 library, 1.2 playback, 1.3 app feel, 1.4 layout | 4–5 weeks   |
| 2. See the drop coming | queue, analysis, script, seek bar, validation       | 3–4 weeks   |
| 3. Share a clip        | recording, share, clip the drop                     | 1–1.5 weeks |
| 4. Auto-mix            | transitions, ordering                               | 2 weeks     |
| 5. Backend             | sync, auth, deploy                                  | 2–3 weeks   |

**If interview season is close:** do Phases 1–3, then stop and write the case study: what you built, the Phase 2
numbers, what failed, and what you'd do next. A finished project with real numbers is worth more than five
half-finished phases.

---

## Working with Claude Code

**One milestone per session.** Paste this, changing the milestone:

```
Read docs/ROADMAP.md, especially "Rules for every phase" and milestone 1.1.

1. Plan first: list the files you'll add or change, any new dependencies (with licence and size), and
   any CSP changes. Wait for my OK before writing code.
2. Implement milestone 1.1 only, on a new branch feat/library-storage.
3. Add every test listed under 1.1. Keep `npm run check`, `npm run format:check` and the e2e suite green.
4. Don't start the next milestone.
5. When done, tell me what changed, anything you did differently from the roadmap and why, and what I should
   check by hand on my phone.
```

**After each milestone:**

1. Push, open a pull request, and wait for green CI.
2. Open the Vercel preview on your phone and run the device checklist.
3. Merge, then tick the milestone's "Done when" boxes in this file.

**When the plan turns out wrong**, update this file in the same pull request, so it stays the source of truth.

---

## Appendix: data model

IndexedDB stores (through `idb`). Shapes in TypeScript:

```ts
type TrackId = string;

interface Track {
  id: TrackId;
  source: 'folder' | 'import';
  folderId?: string; // linked folder this came from
  path?: string; // relative path inside the linked folder
  opfsName?: string; // file name inside OPFS, for imports
  fileHash: string; // SHA-256 of size + first 256 KB
  size: number;
  lastModified: number;
  title: string;
  artist: string;
  album: string;
  albumArtist: string;
  trackNo?: number;
  discNo?: number;
  year?: number;
  duration: number; // seconds
  coverId?: string; // → covers store
  replayGain?: { track?: number; album?: number; trackPeak?: number; albumPeak?: number };
  loudness?: { lufs: number; peak: number };
  addedAt: number;
  lastPlayedAt?: number;
  playCount: number;
}

interface Cover {
  id: string; // hash of the image bytes
  thumb: Blob; // 256 px
  full: Blob;
  palette: CoverPalette | null;
}

interface LinkedFolder {
  id: string;
  name: string;
  handle: FileSystemDirectoryHandle;
  lastScanAt?: number;
}

interface Playlist {
  id: string;
  name: string;
  items: { trackId: TrackId; fileHash: string; title: string; artist: string; duration: number }[];
  createdAt: number;
  updatedAt: number;
}

interface PlayState {
  queue: TrackId[];
  index: number;
  position: number; // seconds into the current track
  shuffle: boolean;
  repeat: 'off' | 'all' | 'one';
  history: TrackId[];
}

interface TrackAnalysis {
  trackId: TrackId;
  fileHash: string;
  version: number; // ANALYSIS_VERSION
  bpm: number;
  beatConfidence: number; // 0..1
  beats: Float32Array; // seconds
  firstDownbeat: number; // index into beats
  energy: Uint8Array; // 0..255 per beat
  sections: {
    start: number; // seconds
    end: number;
    kind: 'intro' | 'verse' | 'build' | 'drop' | 'breakdown' | 'outro' | 'other';
    energy: number; // 0..1
    confidence: number; // 0..1
  }[];
  drops: { time: number; confidence: number }[];
  mood: { id: MoodId; arousal: number; valence: number; confidence: number };
  key?: { tonic: string; scale: 'major' | 'minor'; camelot: string };
  spectrogram?: Uint8Array; // optional 48 bars × 30 fps, for the iOS fallback
  analysedAt: number;
}
```

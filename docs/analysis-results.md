# Analysis results

How well the Phase 2 analyser (beats, sections, drops, key) actually works, measured on a hand-annotated
set. Without numbers this is just a demo; with them it's defensible. See `docs/ROADMAP.md` §Phase 2
"Validation".

> **Status:** tooling is in place; the numbers below are placeholders until the annotated set is collected.
> The synthetic-audio unit tests (`tests/unit/analysis-extract.test.ts`) already pin the deterministic cases
> (128 BPM click → 128 ± 1, build→drop detected, flat → no drop, C-major triad → C major / 8B).

## How to collect the numbers

1. `npm run dev`, open **`/tools/scene-lab/`** (dev-only; excluded from `vite build`).
2. Under **Audio → Play a song**, load a track.
3. Turn **Annotate** on. While it plays, press **`D`** at each drop and **`S`** at each section change.
   (Optionally type the track's true BPM.)
4. **Export JSON** to save the annotation next to your notes. **Score** runs the real analyser on the same
   file and prints BPM, drop recall/precision + false drops, section recall, and the analysis time.
5. Repeat for 20–30 tracks across genres. **Commit only annotations of CC-licensed tracks**, with their
   sources; keep annotations of copyrighted songs on your machine.

The scoring maths is pure and unit-tested in `src/analysis/metrics.ts` (`matchEvents`, `scoreTempo`,
`beatTolerance`) — the Scene Lab just wires it to the UI.

## Metrics

- **Tempo accuracy** — within 4% of the true tempo; half/double counted separately as an "octave error",
  not a miss.
- **Drop hit rate** — a detected drop within **±1 beat** of an annotated one counts as a hit. Report recall,
  precision and **false drops per track**.
- **Section boundaries** — a detected boundary within **±1 bar** of an annotated one. Report recall.
- **Analysis time** — wall-clock for `analyseSignal` on the decoded track, on desktop and on a mid-range phone.
- **Beat F-measure** (±70 ms) — needs tapped beats, which the D/S tool doesn't capture; the synthetic click
  tests stand in for now. Add a beat-tap mode here if a real-track F-measure is needed.

## Target (ROADMAP "Done when")

- Drop hit rate ≥ **70%**, with at most **one false drop per three tracks**. Write the real numbers down
  either way, failures included.

## Results

_Fill in from the Scene Lab "Score" readout. One row per track; keep copyrighted titles local._

| Track (CC source) | Genre | True BPM | Detected BPM | Tempo | Drops ref | Drops hit | False drops | Section recall | Analysis (desktop) | Analysis (phone) |
| ----------------- | ----- | -------- | ------------ | ----- | --------- | --------- | ----------- | -------------- | ------------------ | ---------------- |
| _…_               |       |          |              |       |           |           |             |                |                    |                  |

**Summary:** drop hit rate _…%_, false drops/track _…_, tempo within-4% _…%_ (octave errors _…_), median
analysis time _… ms_ desktop / _… ms_ phone.

### Known failure cases

_Note the genres/tracks where drops are missed or spurious, so the write-up is honest._

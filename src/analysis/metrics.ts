/**
 * Validation metrics for the analysis (docs/ROADMAP.md §2 Validation). Pure functions comparing the
 * extractor's output against a hand-made annotation (drops and section boundaries tapped in the
 * Scene Lab), so the Scene Lab can show live scores and the numbers are unit-tested. See
 * docs/analysis-results.md for how to produce an annotated set.
 */

/** A hand annotation of one track: drop times and section-boundary times in seconds (+ optional true BPM). */
export interface Annotation {
  drops: number[];
  sections: number[];
  trueBpm?: number;
}

export interface MatchScore {
  /** Reference items matched by a detection. */
  hits: number;
  refCount: number;
  detected: number;
  /** hits / refCount (0 when nothing to match). */
  recall: number;
  /** hits / detected (0 when nothing detected). */
  precision: number;
  /** Detections that matched no reference (per this track). */
  falsePositives: number;
}

/**
 * Greedy nearest-match within `tolSec`: each reference item claims the closest unused detection. Used
 * for drops (tol ≈ one beat) and section boundaries (tol ≈ one bar).
 */
export function matchEvents(ref: readonly number[], detected: readonly number[], tolSec: number): MatchScore {
  const used = new Array<boolean>(detected.length).fill(false);
  let hits = 0;
  for (const r of ref) {
    let best = -1;
    let bestDist = tolSec;
    for (let i = 0; i < detected.length; i++) {
      if (used[i]) continue;
      const d = Math.abs(detected[i] - r);
      if (d <= bestDist) {
        bestDist = d;
        best = i;
      }
    }
    if (best >= 0) {
      used[best] = true;
      hits++;
    }
  }
  return {
    hits,
    refCount: ref.length,
    detected: detected.length,
    recall: ref.length ? hits / ref.length : 0,
    precision: detected.length ? hits / detected.length : 0,
    falsePositives: detected.length - hits,
  };
}

export interface TempoScore {
  bpm: number;
  trueBpm: number;
  /** Within 4% of the true tempo. */
  within4pct: boolean;
  /** Off by a factor of 2 or 3 (half/double/third) but otherwise within 4% — reported separately. */
  octaveError: boolean;
}

/** Tempo accuracy with the roadmap's half/double handling: an octave error is counted, not a miss. */
export function scoreTempo(bpm: number, trueBpm: number): TempoScore {
  const close = (a: number, b: number): boolean => b > 0 && Math.abs(a - b) / b <= 0.04;
  const within4pct = close(bpm, trueBpm);
  const octaveError = !within4pct && [0.5, 2, 1 / 3, 3].some((m) => close(bpm, trueBpm * m));
  return { bpm, trueBpm, within4pct, octaveError };
}

/** One beat's worth of tolerance in seconds for the drop hit-rate (±1 beat at `bpm`). */
export function beatTolerance(bpm: number): number {
  return bpm > 0 ? 60 / bpm : 0.5;
}

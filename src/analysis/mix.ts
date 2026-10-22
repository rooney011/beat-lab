/**
 * Planning a beat-matched transition from track A into track B (docs/ROADMAP.md §4.1). Pure and
 * deterministic: picks the mix-out phrase in A, the mix-in downbeat in B, a blend length in bars, and
 * the playback rate that makes B's tempo match A's — or returns null when the two don't match (the
 * caller then falls back to a plain crossfade). The deck engine (src/audio/decks.ts) executes a plan.
 */
import type { TrackAnalysis } from '../library/types';

export interface TransitionPlan {
  /** Seconds into A where the blend begins (mix-out). */
  outStart: number;
  /** Seconds into B where it enters (mix-in), before rate stretching. */
  inStart: number;
  /** Blend length in seconds (at A's tempo). */
  lengthSec: number;
  /** Blend length in bars (8, 16 or 32). */
  bars: number;
  /** Playback rate for B so its beats align with A's; always within ±6% of 1. */
  rate: number;
}

export interface PlanOptions {
  /** Longest blend to attempt, in bars. */
  maxBars?: number;
}

/** Minimum beat confidence on both tracks before we'll beat-match at all. */
export const MIN_BEATMATCH_CONFIDENCE = 0.5;
const TEMPO_TOLERANCE = 0.06;

/**
 * The rate to play B at so it beats with A, choosing the nearest octave (half/double) so the rate
 * stays near 1 — e.g. a 70 BPM track under a 140 BPM track plays at rate 1.0 (double-time aligned),
 * not stretched 2×. Returns null when even the best octave is more than 6% off.
 */
export function tempoMatchRate(bpmA: number, bpmB: number): number | null {
  if (bpmA <= 0 || bpmB <= 0) return null;
  let bestRate: number | null = null;
  let bestErr = Infinity;
  for (const k of [-1, 0, 1]) {
    const octave = bpmB * 2 ** k;
    const err = Math.abs(octave - bpmA) / bpmA;
    if (err < bestErr) {
      bestErr = err;
      bestRate = bpmA / octave;
    }
  }
  return bestErr <= TEMPO_TOLERANCE ? bestRate : null;
}

/** Parse a Camelot code like "8B" into { n: 1..12, letter: 'A'|'B' }, or null. */
function parseCamelot(code: string | undefined): { n: number; ab: 'A' | 'B' } | null {
  if (!code) return null;
  const m = /^(\d{1,2})([AB])$/.exec(code);
  if (!m) return null;
  return { n: Number(m[1]), ab: m[2] as 'A' | 'B' };
}

/** 0 = same key, 1 = a Camelot neighbour (±1 hour, or relative major/minor), else 2. Soft preference. */
export function camelotDistance(a: string | undefined, b: string | undefined): number {
  const pa = parseCamelot(a);
  const pb = parseCamelot(b);
  if (!pa || !pb) return 2;
  if (pa.n === pb.n && pa.ab === pb.ab) return 0;
  const hourDist = Math.min(Math.abs(pa.n - pb.n), 12 - Math.abs(pa.n - pb.n));
  if (pa.ab === pb.ab && hourDist === 1) return 1;
  if (pa.n === pb.n && pa.ab !== pb.ab) return 1;
  return 2;
}

/** Last beat time, or 0 when the grid is empty. */
function endOf(a: TrackAnalysis): number {
  return a.beats.length ? a.beats[a.beats.length - 1] : 0;
}

/** Snap a time to the nearest A downbeat at or before it. */
function snapDownbeat(a: TrackAnalysis, time: number): number {
  if (!a.beats.length) return Math.max(0, time);
  const barBeats = 4;
  let best = a.beats[a.firstDownbeat] ?? a.beats[0];
  for (let i = a.firstDownbeat; i < a.beats.length; i += barBeats) {
    if (a.beats[i] <= time) best = a.beats[i];
    else break;
  }
  return best;
}

/**
 * Plan A → B, or null to fall back to a plain crossfade. Beat-matches only when both tracks are
 * confidently analysed and their tempos line up within 6% at some octave.
 */
export function planTransition(a: TrackAnalysis, b: TrackAnalysis, opts: PlanOptions = {}): TransitionPlan | null {
  if (a.beatConfidence < MIN_BEATMATCH_CONFIDENCE || b.beatConfidence < MIN_BEATMATCH_CONFIDENCE) return null;
  const rate = tempoMatchRate(a.bpm, b.bpm);
  if (rate === null) return null;

  const aEnd = endOf(a);
  const barSecA = (4 * 60) / a.bpm;
  if (!(aEnd > 0) || !(barSecA > 0)) return null;

  // Mix-out: A's outro if it has one, else a downbeat ~16 bars before the end.
  const outro = a.sections.find((s) => s.kind === 'outro');
  const outStart = outro ? snapDownbeat(a, outro.start) : snapDownbeat(a, aEnd - 16 * barSecA);
  // Don't beat-match a track too short to leave ~16 bars played before the blend (also guards short
  // fixtures whose `aEnd − 16 bars` would clamp near 0 and transition almost immediately).
  if (outStart < 16 * barSecA) return null;

  // Mix-in: B's first downbeat (or its intro start, or the very start).
  const bIntro = b.sections.find((s) => s.kind === 'intro');
  const inStart = b.beats.length ? b.beats[b.firstDownbeat] : (bIntro?.start ?? 0);
  const bEnd = endOf(b) || b.beats.length;

  // Largest bar length that fits both A's tail and B's head.
  const maxBars = opts.maxBars ?? 32;
  const aRoom = aEnd - outStart;
  const bRoom = (bEnd - inStart) / rate; // B is stretched by `rate`
  let bars = 0;
  for (const cand of [32, 16, 8]) {
    if (cand > maxBars) continue;
    const secs = cand * barSecA;
    if (secs <= aRoom && secs <= bRoom) {
      bars = cand;
      break;
    }
  }
  if (bars === 0) return null;

  return { outStart, inStart, lengthSec: bars * barSecA, bars, rate };
}

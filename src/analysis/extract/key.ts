/**
 * Key detection by the Krumhansl–Schmuckler method: correlate the track's average chroma against the
 * 24 major/minor key profiles and take the best match. Returns tonic, scale and Camelot code (for
 * Phase 4's harmonic mixing). Deterministic — a synthetic triad resolves to its key.
 */
import type { AnalysisKey } from '../../library/types';
import { chromagram, type Spectrogram } from './spectral';

const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// Krumhansl–Kessler key profiles.
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

// Camelot codes indexed by tonic (C..B).
const CAMELOT_MAJOR = ['8B', '3B', '10B', '5B', '12B', '7B', '2B', '9B', '4B', '11B', '6B', '1B'];
const CAMELOT_MINOR = ['5A', '12A', '7A', '2A', '9A', '4A', '11A', '6A', '1A', '8A', '3A', '10A'];

function correlate(a: readonly number[], b: readonly number[]): number {
  const n = a.length;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i];
    mb += b[i];
  }
  ma /= n;
  mb /= n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma;
    const y = b[i] - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  const den = Math.sqrt(da * db);
  return den > 0 ? num / den : 0;
}

export function detectKey(spec: Spectrogram): AnalysisKey | undefined {
  const chroma = chromagram(spec);
  if (!chroma.length) return undefined;
  const avg = new Array<number>(12).fill(0);
  for (const c of chroma) for (let k = 0; k < 12; k++) avg[k] += c[k];
  let total = 0;
  for (let k = 0; k < 12; k++) total += avg[k];
  if (total <= 0) return undefined;

  let best = -Infinity;
  let bestTonic = 0;
  let bestMajor = true;
  for (let tonic = 0; tonic < 12; tonic++) {
    const rotMajor = MAJOR.map((_, i) => MAJOR[(i - tonic + 12) % 12]);
    const rotMinor = MINOR.map((_, i) => MINOR[(i - tonic + 12) % 12]);
    const cMaj = correlate(avg, rotMajor);
    const cMin = correlate(avg, rotMinor);
    if (cMaj > best) {
      best = cMaj;
      bestTonic = tonic;
      bestMajor = true;
    }
    if (cMin > best) {
      best = cMin;
      bestTonic = tonic;
      bestMajor = false;
    }
  }
  return {
    tonic: NOTES[bestTonic],
    scale: bestMajor ? 'major' : 'minor',
    camelot: (bestMajor ? CAMELOT_MAJOR : CAMELOT_MINOR)[bestTonic],
  };
}

/**
 * Song structure: a per-beat energy curve, section boundaries, heuristic labels, and drops. Section
 * boundaries come from two cues snapped to bar lines — timbral/harmonic self-similarity novelty
 * (Foote) and sharp energy steps (EDM drops often keep the timbre but jump in level, which the
 * L2-normalised novelty misses). Drops are detected directly from the energy curve: a bar line where
 * energy jumps sharply into a sustained loud region. All deterministic.
 */
import type { AnalysisDrop, AnalysisSection, SectionKind } from '../../library/types';
import { chromagram, mfccs, type Spectrogram } from './spectral';

/** Minimum spacing between section boundaries, in beats (2 bars of 4/4). */
const MIN_GAP = 8;
/** Look-ahead/behind window for energy-step and drop detection, in beats. */
const WINDOW = 8;

/** Broadband energy per STFT frame (∝ loudness; Parseval on the magnitude spectrum). */
function frameEnergy(spec: Spectrogram): Float32Array {
  return Float32Array.from(spec.mag, (m) => {
    let e = 0;
    for (let i = 0; i < m.length; i++) e += m[i] * m[i];
    return e;
  });
}

/** Average a per-frame series over each beat interval. */
function perBeat(series: Float32Array, beats: Float32Array, fps: number): Float32Array {
  const out = new Float32Array(beats.length);
  for (let i = 0; i < beats.length; i++) {
    const a = Math.round(beats[i] * fps);
    const b = i + 1 < beats.length ? Math.round(beats[i + 1] * fps) : a + Math.round(fps / 2);
    let sum = 0;
    let n = 0;
    for (let f = a; f < b && f < series.length; f++) {
      sum += series[f];
      n++;
    }
    out[i] = n ? sum / n : 0;
  }
  return out;
}

/** Per-beat energy, scaled 0..1 within the track (robust 5th–95th percentile) then to 0..255. */
export function energyCurve(spec: Spectrogram, beats: Float32Array): Uint8Array {
  const raw = perBeat(frameEnergy(spec), beats, spec.fps);
  if (!raw.length) return new Uint8Array(0);
  // Compress with sqrt (closer to perceived loudness) before scaling.
  for (let i = 0; i < raw.length; i++) raw[i] = Math.sqrt(raw[i]);
  const sorted = Float32Array.from(raw).sort();
  const lo = sorted[Math.floor(sorted.length * 0.05)];
  const hi = sorted[Math.floor(sorted.length * 0.95)] || lo + 1e-9;
  const range = hi - lo || 1e-9;
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    out[i] = Math.max(0, Math.min(255, Math.round(((raw[i] - lo) / range) * 255)));
  }
  return out;
}

/** Normalised per-beat feature vectors (chroma + MFCC) for self-similarity. */
function beatFeatures(spec: Spectrogram, beats: Float32Array): Float32Array[] {
  const chroma = chromagram(spec);
  const mfcc = mfccs(spec);
  const dim = 12 + (mfcc[0]?.length ?? 0);
  const feats: Float32Array[] = [];
  for (let i = 0; i < beats.length; i++) {
    const a = Math.round(beats[i] * spec.fps);
    const b = i + 1 < beats.length ? Math.round(beats[i + 1] * spec.fps) : a + 1;
    const v = new Float32Array(dim);
    let n = 0;
    for (let f = a; f < b && f < chroma.length; f++) {
      for (let k = 0; k < 12; k++) v[k] += chroma[f][k];
      for (let k = 0; k < mfcc[f].length; k++) v[12 + k] += mfcc[f][k];
      n++;
    }
    if (n) for (let k = 0; k < dim; k++) v[k] /= n;
    let norm = 0;
    for (let k = 0; k < dim; k++) norm += v[k] * v[k];
    norm = Math.sqrt(norm) || 1;
    for (let k = 0; k < dim; k++) v[k] /= norm;
    feats.push(v);
  }
  return feats;
}

/** Foote novelty along the SSM diagonal with a checkerboard kernel of half-size L beats. */
function noveltyCurve(feats: Float32Array[], L: number): Float32Array {
  const n = feats.length;
  const nov = new Float32Array(n);
  const dot = (a: Float32Array, b: Float32Array): number => {
    let s = 0;
    for (let k = 0; k < a.length; k++) s += a[k] * b[k];
    return s;
  };
  for (let c = 0; c < n; c++) {
    let score = 0;
    for (let i = -L; i < L; i++) {
      for (let j = -L; j < L; j++) {
        const a = c + i;
        const b = c + j;
        if (a < 0 || b < 0 || a >= n || b >= n) continue;
        const sign = i < 0 === j < 0 ? 1 : -1;
        score += sign * dot(feats[a], feats[b]);
      }
    }
    nov[c] = Math.max(0, score);
  }
  return nov;
}

const e01 = (energy: Uint8Array, i: number): number => (energy[Math.min(energy.length - 1, Math.max(0, i))] ?? 0) / 255;

function meanEnergy(energy: Uint8Array, a: number, b: number): number {
  let s = 0;
  let c = 0;
  for (let i = Math.max(0, a); i < Math.min(energy.length, b); i++) {
    s += energy[i];
    c++;
  }
  return c ? s / c / 255 : 0;
}

interface Candidate {
  beat: number;
  /** 3 = drop (loud jump), 2 = energy step, 1 = timbral/harmonic novelty. Higher wins ties. */
  priority: number;
}

/**
 * Section boundaries as beat indices (always including 0 and the last beat). Candidates are drops and
 * energy steps (from the energy curve) plus novelty peaks; a priority-aware greedy pass keeps the most
 * salient boundary when two fall within MIN_GAP, so a real drop never loses to a nearby novelty blip.
 */
function boundaries(nov: Float32Array, energy: Uint8Array, firstDownbeat: number): number[] {
  const n = nov.length;
  if (n < 8) return [0, Math.max(1, n - 1)];
  const cand: Candidate[] = [];

  // Energy-based candidates on the bar grid.
  for (let k = firstDownbeat; k < n; k += 4) {
    if (k < 4 || k + 4 > n) continue;
    const w = Math.min(WINDOW, k, n - k);
    const before = meanEnergy(energy, k - w, k);
    const after = meanEnergy(energy, k, k + w);
    const diff = after - before;
    if (diff > 0.35 && after > 0.6) cand.push({ beat: k, priority: 3 });
    else if (Math.abs(diff) > 0.3) cand.push({ beat: k, priority: 2 });
  }

  // Novelty peaks, snapped to the nearest bar line.
  let max = 0;
  for (let i = 0; i < n; i++) max = Math.max(max, nov[i]);
  const thresh = max * 0.25;
  for (let i = 2; i < n - 2; i++) {
    if (nov[i] < thresh) continue;
    if (nov[i] >= nov[i - 1] && nov[i] >= nov[i + 1] && nov[i] > nov[i - 2] && nov[i] > nov[i + 2]) {
      const snapped = firstDownbeat + Math.round((i - firstDownbeat) / 4) * 4;
      cand.push({ beat: Math.max(1, Math.min(n - 1, snapped)), priority: 1 });
    }
  }

  cand.sort((a, b) => a.beat - b.beat);
  const picks: Candidate[] = [];
  for (const c of cand) {
    const last = picks[picks.length - 1];
    if (last && c.beat - last.beat < MIN_GAP) {
      if (c.priority > last.priority) picks[picks.length - 1] = c; // the stronger cue wins the slot
    } else {
      picks.push(c);
    }
  }
  const beats = picks.map((c) => c.beat).filter((b) => b > 0 && b < n - 1);
  return [0, ...beats, n - 1];
}

/** Bar lines where energy jumps sharply into a sustained loud region — the drops. */
function detectDrops(energy: Uint8Array, beats: Float32Array, firstDownbeat: number): AnalysisDrop[] {
  const n = energy.length;
  const bars: { beat: number; jump: number }[] = [];
  for (let k = firstDownbeat; k < n; k += 4) {
    if (k < 4 || k + 4 > n) continue;
    const w = Math.min(WINDOW, k, n - k);
    const before = meanEnergy(energy, k - w, k);
    const after = meanEnergy(energy, k, k + w);
    const jump = after - before;
    if (jump > 0.35 && after > 0.6) bars.push({ beat: k, jump });
  }
  // Merge runs of adjacent drop bars, keeping the strongest in each.
  const drops: AnalysisDrop[] = [];
  let last = -MIN_GAP;
  let bestInRun: { beat: number; jump: number } | null = null;
  const flush = (): void => {
    if (bestInRun) drops.push({ time: beats[bestInRun.beat] ?? 0, confidence: Math.min(1, bestInRun.jump) });
    bestInRun = null;
  };
  for (const b of bars) {
    if (b.beat - last >= MIN_GAP) flush();
    if (!bestInRun || b.jump > bestInRun.jump) bestInRun = b;
    last = b.beat;
  }
  flush();
  return drops;
}

function labelFor(meanE: number, slope: number, pos: number, prevKind: SectionKind | null): [SectionKind, number] {
  if (pos < 0.12 && meanE < 0.5) return ['intro', 0.7];
  if (pos > 0.85 && meanE < 0.55) return ['outro', 0.6];
  if (meanE > 0.72) return ['drop', 0.65];
  if (slope > 0.25 && meanE < 0.8) return ['build', 0.6];
  if (meanE < 0.35 && prevKind === 'drop') return ['breakdown', 0.6];
  if (meanE >= 0.4 && meanE <= 0.72) return ['verse', 0.5];
  return ['other', 0.4];
}

export interface StructureResult {
  sections: AnalysisSection[];
  drops: AnalysisDrop[];
}

/** Sections + drops from the beat grid and energy curve. */
export function structure(
  spec: Spectrogram,
  beats: Float32Array,
  energy: Uint8Array,
  firstDownbeat: number,
): StructureResult {
  if (beats.length < 8) return { sections: [], drops: [] };
  const feats = beatFeatures(spec, beats);
  const L = Math.max(4, Math.min(16, Math.floor(beats.length / 8)));
  const nov = noveltyCurve(feats, L);
  const bounds = boundaries(nov, energy, firstDownbeat);
  const drops = detectDrops(energy, beats, firstDownbeat);
  const dropBeats = new Set(
    drops.map((d) => {
      // Nearest bar beat index to each drop time (for labelling the section that starts there).
      let idx = 0;
      let best = Infinity;
      for (let i = 0; i < beats.length; i++) {
        const dist = Math.abs(beats[i] - d.time);
        if (dist < best) {
          best = dist;
          idx = i;
        }
      }
      return idx;
    }),
  );

  const sections: AnalysisSection[] = [];
  const dur = beats[beats.length - 1];
  let prevKind: SectionKind | null = null;
  for (let s = 0; s < bounds.length - 1; s++) {
    const bi = bounds[s];
    const ei = bounds[s + 1];
    let sum = 0;
    for (let i = bi; i < ei; i++) sum += e01(energy, i);
    const meanE = sum / Math.max(1, ei - bi);
    const slope = e01(energy, ei - 1) - e01(energy, bi);
    const start = beats[bi];
    const end = beats[Math.min(beats.length - 1, ei)];
    const pos = dur ? (start + end) / 2 / dur : 0;
    let [kind, confidence] = labelFor(meanE, slope, pos, prevKind);
    // A section that opens on a detected drop and stays loud is the drop section.
    if (dropBeats.has(bi) && meanE > 0.55) {
      kind = 'drop';
      confidence = Math.max(confidence, 0.7);
    }
    sections.push({ start, end, kind, energy: Math.round(meanE * 100) / 100, confidence });
    prevKind = kind;
  }
  return { sections, drops };
}

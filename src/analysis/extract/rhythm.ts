/**
 * Tempo and beats, from an onset envelope. Tempo is picked by weighted autocorrelation of the
 * envelope; beats are then placed by Ellis-style dynamic programming (a steady period favoured by a
 * log transition cost, plus local onset strength). Downbeats assume 4/4 and pick the bar phase whose
 * beats carry the most bass. All deterministic, so a synthetic click track lands on an exact BPM.
 */
import type { Spectrogram } from './spectral';

export interface Tempo {
  bpm: number;
  /** 0..1 — how clearly one period dominates the autocorrelation. */
  confidence: number;
}

/**
 * Spectral-flux onset strength per frame: the summed positive change in magnitude across bins, then
 * lightly smoothed and mean-subtracted so quiet passages sit near zero.
 */
export function onsetEnvelope(spec: Spectrogram): Float32Array {
  const { mag } = spec;
  const n = mag.length;
  const flux = new Float32Array(n);
  for (let t = 1; t < n; t++) {
    const cur = mag[t];
    const prev = mag[t - 1];
    let s = 0;
    for (let i = 0; i < cur.length; i++) {
      const d = cur[i] - prev[i];
      if (d > 0) s += d;
    }
    flux[t] = s;
  }
  // Subtract a local mean (moving average) to flatten slow loudness drift, then half-wave rectify.
  const win = Math.max(1, Math.round(spec.fps * 0.1));
  const out = new Float32Array(n);
  let acc = 0;
  for (let t = 0; t < n; t++) {
    acc += flux[t];
    if (t >= win) acc -= flux[t - win];
    const avg = acc / Math.min(t + 1, win);
    out[t] = Math.max(0, flux[t] - avg);
  }
  return out;
}

/** Weighted autocorrelation tempo estimate over 40..240 BPM, with a log-normal prior around 120. */
export function estimateTempo(onset: Float32Array, fps: number): Tempo {
  const n = onset.length;
  const minLag = Math.max(1, Math.floor((fps * 60) / 240));
  const maxLag = Math.min(n - 1, Math.floor((fps * 60) / 40));
  if (maxLag <= minLag) return { bpm: 0, confidence: 0 };
  let best = -Infinity;
  let bestLag = minLag;
  let sum = 0;
  let count = 0;
  const weighted = new Float32Array(maxLag + 1);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let ac = 0;
    for (let i = lag; i < n; i++) ac += onset[i] * onset[i - lag];
    const bpm = (60 * fps) / lag;
    const prior = Math.exp(-0.5 * (Math.log2(bpm / 120) / 0.5) ** 2);
    const v = ac * prior;
    weighted[lag] = v;
    sum += v;
    count++;
    if (v > best) {
      best = v;
      bestLag = lag;
    }
  }
  const mean = count ? sum / count : 0;
  // Parabolic interpolation around the peak for sub-lag precision (the true period rarely falls on
  // an integer number of frames, so lag 20 vs 21 at 43 fps is the difference between 129 and 123 BPM).
  let refinedLag = bestLag;
  if (bestLag > minLag && bestLag < maxLag) {
    const y0 = weighted[bestLag - 1];
    const y1 = weighted[bestLag];
    const y2 = weighted[bestLag + 1];
    const denom = y0 - 2 * y1 + y2;
    if (denom !== 0) refinedLag = bestLag + Math.max(-0.5, Math.min(0.5, (0.5 * (y0 - y2)) / denom));
  }
  const bpm = (60 * fps) / refinedLag;
  // Confidence: how far the winning peak stands above the average lag response.
  const confidence = mean > 0 ? Math.max(0, Math.min(1, best / mean / 6)) : 0;
  return { bpm: Math.round(bpm * 10) / 10, confidence };
}

/**
 * Ellis dynamic-programming beat tracker. Returns beat times in seconds. `tightness` sets how
 * strongly the tracker holds the global period against local onset evidence.
 */
export function trackBeats(onset: Float32Array, fps: number, bpm: number, tightness = 100): Float32Array {
  const n = onset.length;
  if (n === 0 || bpm <= 0) return new Float32Array(0);
  const period = (60 / bpm) * fps;
  if (!(period > 1)) return new Float32Array(0);
  const score = new Float32Array(n);
  const back = new Int32Array(n).fill(-1);
  for (let t = 0; t < n; t++) {
    const lo = Math.max(0, Math.floor(t - 2 * period));
    const hi = Math.floor(t - period / 2);
    let best = -Infinity;
    let bestIdx = -1;
    for (let tau = lo; tau <= hi; tau++) {
      const interval = t - tau;
      if (interval <= 0) continue;
      const cost = -tightness * Math.log(interval / period) ** 2;
      const s = score[tau] + cost;
      if (s > best) {
        best = s;
        bestIdx = tau;
      }
    }
    score[t] = onset[t] + (bestIdx >= 0 ? best : 0);
    back[t] = bestIdx;
  }
  // Start the backtrace from the strongest score in the final period.
  let last = -1;
  let bestScore = -Infinity;
  for (let t = n - 1; t >= Math.max(0, n - Math.ceil(period)); t--) {
    if (score[t] > bestScore) {
      bestScore = score[t];
      last = t;
    }
  }
  const frames: number[] = [];
  for (let t = last; t >= 0; t = back[t]) {
    frames.push(t);
    if (back[t] < 0) break;
  }
  frames.reverse();
  const beats = new Float32Array(frames.length);
  for (let i = 0; i < frames.length; i++) beats[i] = frames[i] / fps;
  return beats;
}

/** How well the placed beats line up with onset peaks, 0..1 — folded into the stored confidence. */
export function beatStrength(onset: Float32Array, beats: Float32Array, fps: number): number {
  if (!beats.length) return 0;
  let atBeat = 0;
  for (const b of beats) {
    const f = Math.round(b * fps);
    let peak = 0;
    for (let d = -1; d <= 1; d++) {
      const i = f + d;
      if (i >= 0 && i < onset.length) peak = Math.max(peak, onset[i]);
    }
    atBeat += peak;
  }
  atBeat /= beats.length;
  let mean = 0;
  for (let i = 0; i < onset.length; i++) mean += onset[i];
  mean /= Math.max(1, onset.length);
  return mean > 0 ? Math.max(0, Math.min(1, atBeat / (mean * 4))) : 0;
}

/**
 * First-downbeat phase (0..3) for assumed 4/4: the phase whose beats carry the most bass energy —
 * kicks land on bar starts. Returns the index into `beats` of the first downbeat.
 */
export function detectDownbeat(spec: Spectrogram, beats: Float32Array): number {
  if (beats.length < 4) return 0;
  const bassBin = Math.max(1, Math.floor((150 / spec.sr) * spec.frameSize)); // bins up to ~150 Hz
  const bass = new Float32Array(beats.length);
  for (let i = 0; i < beats.length; i++) {
    const f = Math.min(spec.mag.length - 1, Math.round(beats[i] * spec.fps));
    const m = spec.mag[f];
    let e = 0;
    for (let b = 1; b <= bassBin && b < m.length; b++) e += m[b];
    bass[i] = e;
  }
  let bestPhase = 0;
  let bestSum = -Infinity;
  for (let p = 0; p < 4; p++) {
    let s = 0;
    for (let i = p; i < beats.length; i += 4) s += bass[i];
    if (s > bestSum) {
      bestSum = s;
      bestPhase = p;
    }
  }
  return bestPhase;
}

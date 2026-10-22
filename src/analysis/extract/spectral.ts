/**
 * STFT and the two mid-level features the analysis leans on: a 12-bin chromagram (for key and
 * harmonic self-similarity) and MFCCs (for timbral self-similarity / section boundaries). All pure
 * and deterministic — computed once per track in the worker and shared by the rhythm, structure and
 * key stages.
 */
import { hann, magnitude } from './fft';

export interface Spectrogram {
  /** Per-frame magnitude spectrum, each of length frameSize/2 + 1. */
  mag: Float32Array[];
  frameSize: number;
  hop: number;
  sr: number;
  /** Frames per second = sr / hop. */
  fps: number;
}

/** Short-time Fourier magnitude. frameSize must be a power of two (1024 at 22.05 kHz ≈ 46 ms). */
export function computeSpectrogram(signal: Float32Array, sr: number, frameSize = 1024, hop = 512): Spectrogram {
  const win = hann(frameSize);
  const re = new Float32Array(frameSize);
  const im = new Float32Array(frameSize);
  const framed = new Float32Array(frameSize);
  const mag: Float32Array[] = [];
  for (let start = 0; start + frameSize <= signal.length; start += hop) {
    for (let i = 0; i < frameSize; i++) framed[i] = signal[start + i] * win[i];
    mag.push(magnitude(framed, re, im));
  }
  // Guarantee at least one frame for very short inputs (pad with zeros).
  if (!mag.length) {
    framed.fill(0);
    for (let i = 0; i < Math.min(frameSize, signal.length); i++) framed[i] = signal[i] * win[i];
    mag.push(magnitude(framed, re, im));
  }
  return { mag, frameSize, hop, sr, fps: sr / hop };
}

/**
 * Per-frame 12-bin chroma (pitch-class energy), folding all octaves of each note together. Bins
 * outside ~55–5000 Hz are ignored (sub-bass rumble and high noise don't carry the key).
 */
export function chromagram(spec: Spectrogram): Float32Array[] {
  const { mag, frameSize, sr } = spec;
  const bins = frameSize / 2 + 1;
  // Precompute each FFT bin's pitch class (or -1 to skip).
  const pc = new Int8Array(bins).fill(-1);
  for (let i = 1; i < bins; i++) {
    const f = (i * sr) / frameSize;
    if (f < 55 || f > 5000) continue;
    const midi = 69 + 12 * Math.log2(f / 440);
    pc[i] = ((Math.round(midi) % 12) + 12) % 12;
  }
  return mag.map((m) => {
    const c = new Float32Array(12);
    for (let i = 1; i < bins; i++) if (pc[i] >= 0) c[pc[i]] += m[i] * m[i];
    return c;
  });
}

function hzToMel(f: number): number {
  return 2595 * Math.log10(1 + f / 700);
}
function melToHz(m: number): number {
  return 700 * (10 ** (m / 2595) - 1);
}

/** Triangular mel filterbank: edges[nMels+2] bin positions spanning fmin..fmax. */
function melFilterbank(bins: number, sr: number, frameSize: number, nMels: number): Float32Array[] {
  const fmax = sr / 2;
  const mMin = hzToMel(0);
  const mMax = hzToMel(fmax);
  const edges = new Float32Array(nMels + 2);
  for (let i = 0; i < edges.length; i++) {
    const hz = melToHz(mMin + ((mMax - mMin) * i) / (nMels + 1));
    edges[i] = (hz / sr) * frameSize; // → FFT bin index (fractional)
  }
  const filters: Float32Array[] = [];
  for (let m = 1; m <= nMels; m++) {
    const f = new Float32Array(bins);
    const lo = edges[m - 1];
    const mid = edges[m];
    const hi = edges[m + 1];
    for (let i = 0; i < bins; i++) {
      let w = 0;
      if (i >= lo && i <= mid && mid > lo) w = (i - lo) / (mid - lo);
      else if (i > mid && i <= hi && hi > mid) w = (hi - i) / (hi - mid);
      f[i] = w;
    }
    filters.push(f);
  }
  return filters;
}

/**
 * Per-frame MFCCs (coefficients 1..numCoeffs, dropping the energy term c0) for timbral similarity.
 */
export function mfccs(spec: Spectrogram, nMels = 32, numCoeffs = 13): Float32Array[] {
  const bins = spec.frameSize / 2 + 1;
  const fb = melFilterbank(bins, spec.sr, spec.frameSize, nMels);
  return spec.mag.map((m) => {
    const log = new Float32Array(nMels);
    for (let j = 0; j < nMels; j++) {
      let e = 0;
      const f = fb[j];
      for (let i = 0; i < bins; i++) e += m[i] * m[i] * f[i];
      log[j] = Math.log(e + 1e-10);
    }
    // DCT-II, keep coefficients 1..numCoeffs.
    const out = new Float32Array(numCoeffs);
    for (let k = 1; k <= numCoeffs; k++) {
      let s = 0;
      for (let j = 0; j < nMels; j++) s += log[j] * Math.cos((Math.PI * k * (j + 0.5)) / nMels);
      out[k - 1] = s;
    }
    return out;
  });
}

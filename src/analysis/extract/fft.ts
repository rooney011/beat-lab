/**
 * A small, deterministic radix-2 FFT and the windowing helpers the offline analysis builds on. The
 * live path uses the browser's AnalyserNode; the worker has none, so it brings its own. Kept pure
 * and allocation-light (in-place, reusable scratch) and unit-tested against known transforms.
 */

/** Smallest power of two >= n. */
export function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/** A periodic Hann window of length n (periodic, for STFT overlap-add correctness). */
export function hann(n: number): Float32Array {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  return w;
}

/**
 * In-place iterative radix-2 Cooley–Tukey FFT. `re` and `im` must have the same power-of-two length;
 * on return they hold the transform. Forward transform (negative exponent).
 */
export function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  // Bit-reversal permutation.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let k = 0; k < half; k++) {
        const aRe = re[i + k];
        const aIm = im[i + k];
        const idx = i + k + half;
        const bRe = re[idx] * curRe - im[idx] * curIm;
        const bIm = re[idx] * curIm + im[idx] * curRe;
        re[i + k] = aRe + bRe;
        im[i + k] = aIm + bIm;
        re[idx] = aRe - bRe;
        im[idx] = aIm - bIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
}

/**
 * Magnitude spectrum (bins 0..N/2) of one already-windowed real frame. `scratchRe`/`scratchIm` are
 * caller-owned buffers of length N, reused across frames to avoid per-frame allocation.
 */
export function magnitude(frame: Float32Array, scratchRe: Float32Array, scratchIm: Float32Array): Float32Array {
  const n = scratchRe.length;
  scratchRe.set(frame);
  scratchIm.fill(0);
  fft(scratchRe, scratchIm);
  const bins = (n >> 1) + 1;
  const out = new Float32Array(bins);
  for (let i = 0; i < bins; i++) out[i] = Math.hypot(scratchRe[i], scratchIm[i]);
  return out;
}

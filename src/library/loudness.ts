/**
 * Loudness levelling. Two sources of truth, same target (-14 LUFS, the common streaming level):
 *  - ReplayGain / R128 tags when present (read by meta.ts), and
 *  - an ITU-R BS.1770 / EBU R128 integrated-loudness meter for everything else.
 *
 * The meter is pure (Float32Array channels + sample rate in, LUFS + dBFS peak out) so it runs in a
 * background decode/measure job and is unit-tested against EBU Tech 3341. The K-weighting biquad
 * coefficients are derived for the given sample rate (BS.1770 analog prototype + bilinear transform,
 * the pyloudnorm formulation), so measuring the roadmap's 22 050 Hz decodes is correct, not just 48k.
 */

export const TARGET_LUFS = -14;
/** RG2 (MP3/FLAC) tags are referenced to -18 LUFS; Opus R128 tags to -23 LUFS. */
export const RG2_REFERENCE_LUFS = -18;
export const R128_REFERENCE_LUFS = -23;

export interface LoudnessResult {
  /** Integrated loudness in LUFS, or -Infinity for silence. */
  lufs: number;
  /** Sample peak in dBFS, or -Infinity for silence. */
  peak: number;
}

interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

function highShelf(fs: number): Biquad {
  const fc = 1681.9744509555319;
  const Q = 0.7071752369554196;
  const G = 3.999843853973347;
  const K = Math.tan((Math.PI * fc) / fs);
  const Vh = Math.pow(10, G / 20);
  const Vb = Math.pow(Vh, 0.499666774155);
  const a0 = 1 + K / Q + K * K;
  return {
    b0: (Vh + (Vb * K) / Q + K * K) / a0,
    b1: (2 * (K * K - Vh)) / a0,
    b2: (Vh - (Vb * K) / Q + K * K) / a0,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / Q + K * K) / a0,
  };
}

function highPass(fs: number): Biquad {
  const fc = 38.13547087613982;
  const Q = 0.5003270373253953;
  const K = Math.tan((Math.PI * fc) / fs);
  const a0 = 1 + K / Q + K * K;
  return { b0: 1, b1: -2, b2: 1, a1: (2 * (K * K - 1)) / a0, a2: (1 - K / Q + K * K) / a0 };
}

/** Direct-form-I biquad over a copy of the signal. */
function applyBiquad(x: Float32Array, f: Biquad): Float32Array {
  const y = new Float32Array(x.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const xi = x[i];
    const yi = f.b0 * xi + f.b1 * x1 + f.b2 * x2 - f.a1 * y1 - f.a2 * y2;
    x2 = x1;
    x1 = xi;
    y2 = y1;
    y1 = yi;
    y[i] = yi;
  }
  return y;
}

function kWeight(channel: Float32Array, fs: number): Float32Array {
  return applyBiquad(applyBiquad(channel, highShelf(fs)), highPass(fs));
}

const ABSOLUTE_GATE_LUFS = -70;

/** ITU-R BS.1770 integrated loudness with the two-stage EBU R128 gating. */
export function measureLoudness(channels: Float32Array[], sampleRate: number): LoudnessResult {
  if (!channels.length || !channels[0].length) return { lufs: -Infinity, peak: -Infinity };

  let maxAbs = 0;
  for (const ch of channels) for (let i = 0; i < ch.length; i++) maxAbs = Math.max(maxAbs, Math.abs(ch[i]));

  const weighted = channels.map((ch) => kWeight(ch, sampleRate));
  const blockLen = Math.round(0.4 * sampleRate);
  const hop = Math.round(0.1 * sampleRate);
  const len = weighted[0].length;

  // Per block: the channel-summed mean square (G = 1.0 for mono/stereo front channels).
  const blockEnergy: number[] = [];
  for (let start = 0; start + blockLen <= len; start += hop) {
    let sum = 0;
    for (const w of weighted) {
      let ms = 0;
      for (let i = start; i < start + blockLen; i++) ms += w[i] * w[i];
      sum += ms / blockLen;
    }
    blockEnergy.push(sum);
  }
  if (!blockEnergy.length) return { lufs: -Infinity, peak: dbfs(maxAbs) };

  const loudness = (energy: number): number => -0.691 + 10 * Math.log10(energy);

  // Absolute gate at -70 LUFS.
  const absKept = blockEnergy.filter((e) => e > 0 && loudness(e) >= ABSOLUTE_GATE_LUFS);
  if (!absKept.length) return { lufs: -Infinity, peak: dbfs(maxAbs) };

  // Relative gate: 10 LU below the mean of the absolute-gated blocks.
  const relativeThreshold = loudness(mean(absKept)) - 10;
  const relKept = absKept.filter((e) => loudness(e) >= relativeThreshold);
  const gated = relKept.length ? relKept : absKept;

  return { lufs: loudness(mean(gated)), peak: dbfs(maxAbs) };
}

function mean(xs: number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

function dbfs(amplitude: number): number {
  return amplitude > 0 ? 20 * Math.log10(amplitude) : -Infinity;
}

/** Clamp a proposed gain: never boost more than +9 dB, never push the peak past -1 dBFS. */
export function clampGainDb(gainDb: number, peakDbfs: number, maxBoostDb = 9, ceilingDbfs = -1): number {
  let g = Math.min(gainDb, maxBoostDb);
  if (Number.isFinite(peakDbfs)) g = Math.min(g, ceilingDbfs - peakDbfs);
  return g;
}

/** Gain (dB) to bring a measured track to the target. 0 dB when the measurement is unknown. */
export function measuredGainDb(r: LoudnessResult, target = TARGET_LUFS): number {
  if (!Number.isFinite(r.lufs)) return 0;
  return clampGainDb(target - r.lufs, r.peak);
}

/** Gain (dB) from a ReplayGain/R128 tag, accounting for its reference level, then clamped. */
export function replayGainDb(
  tagGainDb: number,
  tagPeakRatio: number | undefined,
  target = TARGET_LUFS,
  referenceLufs = RG2_REFERENCE_LUFS,
): number {
  const base = tagGainDb + (target - referenceLufs);
  const peakDbfs = tagPeakRatio && tagPeakRatio > 0 ? 20 * Math.log10(tagPeakRatio) : -Infinity;
  return clampGainDb(base, peakDbfs);
}

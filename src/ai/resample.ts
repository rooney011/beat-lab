/**
 * Audio preparation for the on-device model: down-mix to mono and down-sample to the model's
 * input rate (16 kHz). Kept as pure functions so they can be unit-tested and reused in the worker.
 */

/** Average two channels into one. A single channel is returned as-is. */
export function toMono(channels: readonly Float32Array[]): Float32Array {
  if (channels.length === 0) return new Float32Array(0);
  if (channels.length === 1) return channels[0];
  const n = channels[0].length;
  const out = new Float32Array(n);
  const k = 1 / channels.length;
  for (let c = 0; c < channels.length; c++) {
    const ch = channels[c];
    for (let i = 0; i < n; i++) out[i] += ch[i] * k;
  }
  return out;
}

/**
 * Box-average down-sampler. Each output sample is the mean of the input samples that fall in its
 * window, which is a cheap low-pass that avoids aliasing well enough for a 16 kHz mel front-end.
 * Only down-samples: if the output rate is >= the input rate the input is returned unchanged.
 */
export function downsampleTo(input: Float32Array, rateIn: number, rateOut: number): Float32Array {
  if (!(rateIn > 0) || !(rateOut > 0)) throw new RangeError('sample rates must be positive');
  if (rateOut >= rateIn) return input;
  const ratio = rateIn / rateOut;
  const outLen = Math.round(input.length / ratio);
  const out = new Float32Array(outLen);
  let posIn = 0;
  for (let i = 0; i < outLen; i++) {
    const nextIn = Math.round((i + 1) * ratio);
    let sum = 0;
    let count = 0;
    for (let j = posIn; j < nextIn && j < input.length; j++) {
      sum += input[j];
      count++;
    }
    out[i] = count ? sum / count : 0;
    posIn = nextIn;
  }
  return out;
}

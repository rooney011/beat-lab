import { describe, expect, it } from 'vitest';
import { clampGainDb, measuredGainDb, measureLoudness, replayGainDb } from '../../src/library/loudness';

const FS = 48000;

function sine(freq: number, peak: number, seconds: number, fs = FS): Float32Array {
  const n = Math.round(seconds * fs);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = peak * Math.sin((2 * Math.PI * freq * i) / fs);
  return out;
}

function concat(...parts: Float32Array[]): Float32Array {
  const n = parts.reduce((s, p) => s + p.length, 0);
  const out = new Float32Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

describe('measureLoudness (BS.1770 / EBU R128)', () => {
  // EBU Tech 3341 test 1: a stereo 997 Hz sine at -23 dBFS reads -23.0 LUFS (±0.1).
  it('reads -23.0 LUFS for a -23 dBFS 997 Hz stereo sine', () => {
    const peak = Math.pow(10, -23 / 20);
    const ch = sine(997, peak, 4);
    const r = measureLoudness([ch, ch], FS);
    expect(r.lufs).toBeCloseTo(-23.0, 1);
    expect(r.peak).toBeCloseTo(-23.0, 1);
  });

  // Silence between tones must be gated out: the reading stays near -23, not dragged toward -26+.
  // (Hard tone<->silence boundary blocks keep it a few tenths below the pure-tone -23.0.)
  it('gates silence so it does not drag the integrated loudness down', () => {
    const peak = Math.pow(10, -23 / 20);
    const tone = sine(997, peak, 3);
    const silence = new Float32Array(3 * FS);
    const sig = concat(tone, silence, tone);
    const r = measureLoudness([sig, sig], FS);
    expect(r.lufs).toBeGreaterThan(-23.5);
    expect(r.lufs).toBeLessThan(-22.5);
  });

  it('returns -Infinity for silence', () => {
    const r = measureLoudness([new Float32Array(FS)], FS);
    expect(r.lufs).toBe(-Infinity);
  });

  it('measures correctly at the 22 050 Hz decode rate too', () => {
    const peak = Math.pow(10, -23 / 20);
    const ch = sine(997, peak, 4, 22050);
    const r = measureLoudness([ch, ch], 22050);
    expect(r.lufs).toBeCloseTo(-23.0, 1);
  });
});

describe('clampGainDb', () => {
  it('caps boost at +9 dB', () => {
    expect(clampGainDb(12, -20)).toBe(9);
  });

  it('never pushes the peak past -1 dBFS', () => {
    expect(clampGainDb(9, -6)).toBe(5); // -1 - (-6) = 5
  });

  it('allows attenuation of loud tracks', () => {
    expect(clampGainDb(-9, -1)).toBe(-9);
  });
});

describe('measuredGainDb', () => {
  it('brings a -23 LUFS track up toward -14, within headroom', () => {
    // peak -23 dBFS leaves 22 dB of headroom, so the full +9 target gain applies.
    expect(measuredGainDb({ lufs: -23, peak: -23 })).toBe(9);
  });

  it('does nothing when loudness is unknown', () => {
    expect(measuredGainDb({ lufs: -Infinity, peak: -Infinity })).toBe(0);
  });
});

describe('replayGainDb', () => {
  it('shifts an RG2 (-18 ref) tag to the -14 target', () => {
    // -6 dB tag + (−14 − −18) = −6 + 4 = −2 dB, peak ratio 0.5 leaves headroom.
    expect(replayGainDb(-6, 0.5)).toBeCloseTo(-2, 5);
  });

  it('respects the -1 dBFS ceiling from the tag peak', () => {
    // base +4; peak ratio ~1.0 (0 dBFS) forces ceiling -1 - 0 = -1.
    expect(replayGainDb(4, 1.0)).toBeCloseTo(-1, 5);
  });

  it('handles Opus R128 (-23 ref)', () => {
    // -6 dB tag + (−14 − −23) = −6 + 9 = +3 dB.
    expect(replayGainDb(-6, undefined, -14, -23)).toBeCloseTo(3, 5);
  });
});

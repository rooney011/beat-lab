import { describe, expect, it } from 'vitest';
import { analyseSignal } from '../../src/analysis/extract';
import { detectKey } from '../../src/analysis/extract/key';
import { estimateTempo, onsetEnvelope, trackBeats } from '../../src/analysis/extract/rhythm';
import { computeSpectrogram } from '../../src/analysis/extract/spectral';

const SR = 22_050;

/** Deterministic noise in −1..1 so the synthetic signals (and the numbers we assert) are stable. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return (s / 4294967296) * 2 - 1;
  };
}

/** A click track: a short noise burst on every beat, each beat's amplitude from `ampAt`. */
function clickTrack(bpm: number, seconds: number, ampAt: (beat: number) => number): Float32Array {
  const n = Math.floor(seconds * SR);
  const sig = new Float32Array(n);
  const period = (60 / bpm) * SR;
  const burst = Math.round(0.015 * SR);
  const rnd = lcg(42);
  for (let b = 0; b * period < n; b++) {
    const start = Math.round(b * period);
    const amp = ampAt(b);
    for (let i = 0; i < burst && start + i < n; i++) sig[start + i] = rnd() * amp * (1 - i / burst);
  }
  return sig;
}

describe('tempo + beats', () => {
  it('measures a 128 BPM click track within 1 BPM', () => {
    const sig = clickTrack(128, 12, () => 0.9);
    const { bpm, beatConfidence } = analyseSignal(sig, SR);
    expect(Math.abs(bpm - 128)).toBeLessThanOrEqual(1);
    expect(beatConfidence).toBeGreaterThan(0.5);
  });

  it('places beats about one period apart', () => {
    const sig = clickTrack(128, 12, () => 0.9);
    const spec = computeSpectrogram(sig, SR);
    const beats = trackBeats(onsetEnvelope(spec), spec.fps, 128);
    expect(beats.length).toBeGreaterThan(18);
    const gaps: number[] = [];
    for (let i = 1; i < beats.length; i++) gaps.push(beats[i] - beats[i - 1]);
    gaps.sort((a, b) => a - b);
    const median = gaps[gaps.length >> 1];
    expect(median).toBeCloseTo(60 / 128, 1); // ≈ 0.469 s
  });

  it('rejects half/double tempo via the prior', () => {
    const { bpm } = estimateTempo(
      onsetEnvelope(
        computeSpectrogram(
          clickTrack(128, 12, () => 0.9),
          SR,
        ),
      ),
      SR / 512,
    );
    expect(bpm).toBeGreaterThan(110);
    expect(bpm).toBeLessThan(150);
  });
});

describe('drops', () => {
  it('detects a drop where a build jumps into a loud section', () => {
    // 32 beats: quiet (0.12) through bar 3, a 4-beat build, then loud (0.9) from beat 16 (≈7.5 s).
    const sig = clickTrack(128, 15, (b) => (b < 12 ? 0.12 : b < 16 ? 0.12 + ((b - 11) / 5) * 0.5 : 0.9));
    const { drops, sections } = analyseSignal(sig, SR);
    expect(drops.length).toBeGreaterThanOrEqual(1);
    const near = drops.some((d) => Math.abs(d.time - 7.5) < 1.5);
    expect(near).toBe(true);
    expect(sections.some((s) => s.kind === 'drop')).toBe(true);
  });

  it('reports no drop for a steady track', () => {
    const sig = clickTrack(128, 15, () => 0.6);
    expect(analyseSignal(sig, SR).drops.length).toBe(0);
  });
});

describe('key', () => {
  it('reads a C major triad as C major', () => {
    const n = 3 * SR;
    const sig = new Float32Array(n);
    const freqs = [261.63, 329.63, 392.0]; // C4 E4 G4
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (const f of freqs) s += Math.sin((2 * Math.PI * f * i) / SR);
      sig[i] = (s / 3) * 0.8;
    }
    const key = detectKey(computeSpectrogram(sig, SR));
    expect(key?.scale).toBe('major');
    expect(key?.tonic).toBe('C');
    expect(key?.camelot).toBe('8B');
  });
});

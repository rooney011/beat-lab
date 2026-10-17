import { describe, expect, it } from 'vitest';
import type { Spectrum } from '../../src/analysis/features';
import { MoodReader, classifyMood, estimateTempo } from '../../src/analysis/mood';
import type { Features } from '../../src/types';

const beats = (bpm: number, n: number, jitterMs = 0, start = 1000): number[] =>
  Array.from({ length: n }, (_, i) => start + (i * 60000) / bpm + (jitterMs ? Math.sin(i * 12.9898) * jitterMs : 0));

describe('estimateTempo', () => {
  it.each([90, 100, 128, 150, 174])('finds %i BPM from clean onsets', (bpm) => {
    expect(estimateTempo(beats(bpm, 24), 120).bpm).toBeCloseTo(bpm, -0.5);
  });

  it('tolerates ±15 ms of timing jitter', () => {
    expect(Math.abs(estimateTempo(beats(128, 32, 15), 120).bpm - 128)).toBeLessThanOrEqual(1);
  });

  it('needs at least six onsets', () => {
    expect(estimateTempo(beats(120, 5))).toEqual({ bpm: 0, conf: 0 });
  });

  it('a slower prior pulls ambiguous half-time patterns down', () => {
    const ts = beats(144, 24);
    expect(estimateTempo(ts, 90).bpm).toBeLessThan(estimateTempo(ts, 120).bpm + 1);
  });
});

describe('classifyMood', () => {
  it('maps arousal × valence to four moods', () => {
    expect(classifyMood(0.8, 0.8)).toBe('hype');
    expect(classifyMood(0.8, 0.2)).toBe('grit');
    expect(classifyMood(0.2, 0.8)).toBe('dreamy');
    expect(classifyMood(0.2, 0.2)).toBe('brooding');
  });
});

describe('MoodReader', () => {
  const frame = (over: Partial<Features>): Features => ({
    beat: false,
    strong: false,
    snare: false,
    replaced: false,
    spark: 0,
    pulse: 0,
    mids: 0,
    highs: 0,
    intensity: 0.5,
    db: -20,
    silent: false,
    bands: new Float32Array(8),
    ...over,
  });

  // A bright spectrum: highs louder than lows → positive tilt → high valence.
  const bright: Spectrum = {
    bytes: new Uint8Array(1024).map((_, i) => (i < 12 ? 80 : i > 46 && i < 186 ? 230 : 120)),
    hz: 44100 / 2048,
    bins: 1024,
    dbRange: 70,
  };

  it('gives each song a stable seeded look', () => {
    const m = new MoodReader();
    const a = m.reset('song-a');
    const b = new MoodReader().reset('song-a');
    expect([a.swap, a.angle, a.rayExtra]).toEqual([b.swap, b.angle, b.rayExtra]);
    expect([0, 2, 4]).toContain(a.rayExtra);
  });

  it('decides after 8 s of audio, then refines once after 30 s', () => {
    const m = new MoodReader();
    m.reset('fast-bright');
    const dt = 1 / 60;
    const decisions = [];
    for (let i = 0; i < 60 * 32; i++) {
      const t = i * dt * 1000;
      const onBeat = i % 28 === 0; // ~128 BPM
      const d = m.observe(frame({ beat: onBeat, strong: onBeat, db: onBeat ? -8 : -22 }), dt, t, bright);
      if (d) decisions.push({ at: (i + 1) * dt, ...d });
    }
    expect(decisions.length).toBe(2);
    expect(decisions[0].at).toBeGreaterThan(7.99);
    expect(decisions[0].at).toBeLessThan(8.1);
    expect(decisions[0].first).toBe(true);
    expect(decisions[1].at).toBeGreaterThan(30);
    expect(decisions[0].mood).toBe('hype');
    expect(decisions[0].bpm).toBeGreaterThan(120);
    expect(decisions[0].bpm).toBeLessThan(135);
  });

  it('ignores frames with no live audio', () => {
    const m = new MoodReader();
    const p = m.reset('quiet');
    for (let i = 0; i < 600; i++) m.observe(frame({}), 1 / 60, i * 16, null);
    expect(p.t).toBe(0);
  });
});

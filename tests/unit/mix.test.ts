import { describe, expect, it } from 'vitest';
import { camelotDistance, planTransition, tempoMatchRate } from '../../src/analysis/mix';
import type { AnalysisSection, TrackAnalysis } from '../../src/library/types';

function beats(bpm: number, seconds: number): Float32Array {
  const step = 60 / bpm;
  const out: number[] = [];
  for (let t = 0; t < seconds; t += step) out.push(Math.round(t * 1000) / 1000);
  return Float32Array.from(out);
}

function analysis(over: Partial<TrackAnalysis> & { bpm: number; seconds: number }): TrackAnalysis {
  const { seconds, bpm, ...rest } = over;
  return {
    trackId: 't',
    fileHash: 'h',
    version: 1,
    beats: beats(bpm, seconds),
    bpm,
    beatConfidence: 0.8,
    firstDownbeat: 0,
    energy: new Uint8Array(0),
    sections: [],
    drops: [],
    analysedAt: 0,
    ...rest,
  };
}

describe('tempoMatchRate', () => {
  it('matches close tempos with a rate near 1', () => {
    const r = tempoMatchRate(128, 130);
    expect(r).not.toBeNull();
    expect(r!).toBeCloseTo(128 / 130, 4);
  });

  it('aligns half/double at rate ~1 instead of stretching 2×', () => {
    expect(tempoMatchRate(140, 70)).toBeCloseTo(1, 4); // B plays at its own speed, double-time aligned
  });

  it('refuses tempos more than 6% apart at every octave', () => {
    expect(tempoMatchRate(120, 140)).toBeNull();
  });
});

describe('camelotDistance', () => {
  it('scores same / neighbour / far', () => {
    expect(camelotDistance('8B', '8B')).toBe(0);
    expect(camelotDistance('8B', '9B')).toBe(1); // ±1 hour
    expect(camelotDistance('8B', '8A')).toBe(1); // relative major/minor
    expect(camelotDistance('8B', '1B')).toBe(2);
    expect(camelotDistance(undefined, '8B')).toBe(2);
  });
});

describe('planTransition', () => {
  const outro: AnalysisSection = { start: 160, end: 180, kind: 'outro', energy: 0.3, confidence: 0.6 };

  it('plans a beat-matched blend ending in A’s outro', () => {
    const a = analysis({ bpm: 128, seconds: 180, sections: [outro] });
    const b = analysis({ bpm: 128, seconds: 180 });
    const plan = planTransition(a, b)!;
    expect(plan).not.toBeNull();
    expect(plan.rate).toBeCloseTo(1, 4);
    expect([8, 16, 32]).toContain(plan.bars);
    expect(plan.outStart).toBeLessThanOrEqual(160);
    expect(plan.inStart).toBe(0);
    expect(plan.lengthSec).toBeCloseTo((plan.bars * 4 * 60) / 128, 3);
  });

  it('falls back (null) when tempos are too far apart', () => {
    expect(planTransition(analysis({ bpm: 120, seconds: 180 }), analysis({ bpm: 140, seconds: 180 }))).toBeNull();
  });

  it('falls back (null) when either track is not confidently analysed', () => {
    const a = analysis({ bpm: 128, seconds: 180, beatConfidence: 0.4 });
    expect(planTransition(a, analysis({ bpm: 128, seconds: 180 }))).toBeNull();
  });
});

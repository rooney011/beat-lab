import { describe, expect, it } from 'vitest';
import { beatTolerance, matchEvents, scoreTempo } from '../../src/analysis/metrics';

describe('matchEvents', () => {
  it('matches each reference to the nearest detection within tolerance', () => {
    const s = matchEvents([10, 30, 60], [10.2, 29.8, 100], 0.5);
    expect(s.hits).toBe(2);
    expect(s.recall).toBeCloseTo(2 / 3, 5);
    expect(s.precision).toBeCloseTo(2 / 3, 5);
    expect(s.falsePositives).toBe(1); // the 100 s detection matched nothing
  });

  it('does not match beyond tolerance', () => {
    expect(matchEvents([10], [11], 0.5).hits).toBe(0);
  });

  it("doesn't let two references claim the same detection", () => {
    const s = matchEvents([10, 10.1], [10.05], 0.5);
    expect(s.hits).toBe(1);
    expect(s.detected).toBe(1);
  });

  it('is empty-safe', () => {
    expect(matchEvents([], [], 0.5)).toMatchObject({ hits: 0, recall: 0, precision: 0 });
  });
});

describe('scoreTempo', () => {
  it('accepts a tempo within 4%', () => {
    expect(scoreTempo(128, 128).within4pct).toBe(true);
    expect(scoreTempo(130, 128).within4pct).toBe(true); // ~1.6%
  });

  it('flags a half/double tempo as an octave error, not a plain miss', () => {
    const half = scoreTempo(64, 128);
    expect(half.within4pct).toBe(false);
    expect(half.octaveError).toBe(true);
    const dbl = scoreTempo(256, 128);
    expect(dbl.octaveError).toBe(true);
  });

  it('flags a genuine miss', () => {
    const s = scoreTempo(100, 128);
    expect(s.within4pct).toBe(false);
    expect(s.octaveError).toBe(false);
  });
});

describe('beatTolerance', () => {
  it('is one beat at the given tempo', () => {
    expect(beatTolerance(120)).toBeCloseTo(0.5, 5);
    expect(beatTolerance(0)).toBe(0.5);
  });
});

import { describe, expect, it } from 'vitest';
import { MAX_NUDGE, nudgeRate, phaseErrorMs, wrapPhaseMs } from '../../src/analysis/phaselock';

function grid(period: number, seconds: number, offset = 0): Float32Array {
  const out: number[] = [];
  for (let t = offset; t < seconds; t += period) out.push(t);
  return Float32Array.from(out);
}

describe('wrapPhaseMs', () => {
  it('wraps into ±half a beat', () => {
    expect(wrapPhaseMs(10, 500)).toBe(10);
    expect(wrapPhaseMs(480, 500)).toBe(-20); // nearly a full beat late ≈ 20 ms early
  });
});

describe('phaseErrorMs', () => {
  it('is ~0 for aligned grids and signed for an offset', () => {
    const a = grid(0.5, 30);
    expect(Math.abs(phaseErrorMs(a, grid(0.5, 30), 10))).toBeLessThan(1);
    expect(phaseErrorMs(a, grid(0.5, 30, 0.02), 10)).toBeCloseTo(20, 0); // B 20 ms late
  });
});

describe('nudgeRate', () => {
  it('clamps to ±0.5% and speeds up when B is late', () => {
    expect(nudgeRate(1000, 1)).toBeCloseTo(1 + MAX_NUDGE, 6); // huge error → saturate
    expect(nudgeRate(-1000, 1)).toBeCloseTo(1 - MAX_NUDGE, 6);
    expect(nudgeRate(0, 0.99)).toBeCloseTo(0.99, 6); // aligned → base rate unchanged
  });

  it('converges a 40 ms phase error to under 10 ms within a few bars', () => {
    const periodMs = 500;
    let err = 40; // B 40 ms late
    let bars = 0;
    for (; bars < 60; bars++) {
      const rate = nudgeRate(err, 1);
      err -= (rate - 1) * periodMs; // speeding B up eats into its lateness each bar
      if (Math.abs(err) < 10) break;
    }
    expect(Math.abs(err)).toBeLessThan(10);
    expect(bars).toBeLessThan(40);
  });
});

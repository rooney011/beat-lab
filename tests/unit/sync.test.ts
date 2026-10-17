import { describe, expect, it } from 'vitest';
import { SyncDelay, autoDelay } from '../../src/analysis/sync';
import type { Analysis } from '../../src/types';

const analysis = (): Analysis => ({
  f: {
    beat: false,
    strong: false,
    snare: false,
    replaced: false,
    spark: 0,
    pulse: 0,
    mids: 0,
    highs: 0,
    intensity: 0,
    db: -90,
    silent: false,
    bands: new Float32Array(8),
  },
  bars: new Float32Array(48),
  peaks: new Float32Array(48),
  wave: new Float32Array(160),
});

describe('autoDelay', () => {
  it('subtracts the visuals’ built-in lag and rounds to 10 ms', () => {
    expect(autoDelay(0)).toBe(0);
    expect(autoDelay(42)).toBe(0);
    expect(autoDelay(213)).toBe(170);
    expect(autoDelay(9999)).toBe(400);
  });
});

describe('SyncDelay', () => {
  it('passes frames straight through at 0 ms', () => {
    const s = new SyncDelay();
    const a = analysis();
    expect(s.apply(a, 0, 0)).toBe(a);
  });

  it.each([60, 144])('delays beats by the set amount at %i fps', (fps) => {
    const s = new SyncDelay();
    const live = analysis();
    const step = 1000 / fps;
    const shownAt: number[] = [];
    const beatAt = [500, 1000, 1500];
    for (let t = 0; t < 2400; t += step) {
      live.f.beat = beatAt.some((b) => t >= b && t - b < step);
      live.bars[0] = t; // tag the frame
      const out = s.apply(live, t, 200);
      if (out.f.beat) shownAt.push(t);
    }
    expect(shownAt.length).toBe(3);
    shownAt.forEach((t, i) => {
      expect(t - beatAt[i]).toBeGreaterThanOrEqual(200 - step);
      expect(t - beatAt[i]).toBeLessThan(200 + 2 * step);
    });
  });

  it('shows the delayed arrays, not the live ones', () => {
    const s = new SyncDelay();
    const live = analysis();
    let out = live;
    for (let t = 0; t <= 1000; t += 10) {
      live.bars[0] = t;
      out = s.apply(live, t, 300);
    }
    expect(out.bars).not.toBe(live.bars);
    expect(out.bars[0]).toBe(700);
  });

  it('merges hits from frames it skips over, so none are lost', () => {
    const s = new SyncDelay();
    const live = analysis();
    // Hits at 250 and 260 ms are still inside the 100 ms line when the next frame jumps far
    // ahead; the jump skips their snapshots, but their flags must still come out.
    for (let t = 0; t < 300; t += 10) {
      live.f.snare = t === 250;
      live.f.spark = t === 260 ? 5 : 0;
      s.apply(live, t, 100);
    }
    live.f.snare = false;
    live.f.spark = 0;
    const out = s.apply(live, 1000, 100);
    expect(out.f.snare).toBe(true);
    expect(out.f.spark).toBe(5);
    // …and only once.
    expect(s.apply(live, 1010, 100).f.snare).toBe(false);
  });

  it('stays bounded', () => {
    const s = new SyncDelay();
    const live = analysis();
    for (let t = 0; t < 20000; t += 4) s.apply(live, t, 400);
    expect(s.buffered).toBeLessThanOrEqual(102);
  });
});

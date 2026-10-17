import { describe, expect, it } from 'vitest';
import { DimensionDirector } from '../../src/analysis/ladder';
import type { Features } from '../../src/types';

const f = (intensity: number, beat = false, strong = false): Features => ({
  beat,
  strong,
  snare: false,
  replaced: false,
  spark: 0,
  pulse: 0,
  mids: 0,
  highs: 0,
  intensity,
  db: -20,
  silent: false,
  bands: new Float32Array(8),
});

const input = { playing: true, live: true, auto: true, moodTh: 0 };

function setup(): { d: DimensionDirector; queued: number[]; applied: number[] } {
  const queued: number[] = [];
  const applied: number[] = [];
  const d = new DimensionDirector(
    (to) => queued.push(to),
    (dim) => applied.push(dim),
  );
  d.reset(0, 0);
  return { d, queued, applied };
}

describe('DimensionDirector', () => {
  it('holds the first 6 s, then climbs after four beats above the next threshold', () => {
    const { d, queued } = setup();
    let t = 0;
    for (; t < 5900; t += 16) d.update(f(0.9, t % 500 < 16), t, 0.016, input);
    expect(queued).toEqual([]);
    for (; t < 9000 && !queued.length; t += 16) d.update(f(0.9, t % 500 < 16), t, 0.016, input);
    expect(queued).toEqual([1]);
  });

  it('lands a queued change on the next strong beat, via a wipe that swaps at 50%', () => {
    const { d, applied } = setup();
    let t = 6100;
    for (let i = 0; i < 4; i++, t += 500) d.update(f(0.9, true), t, 0.5, input);
    expect(d.pending).toBe(1);
    d.update(f(0.9, true, true), t, 0.016, input);
    expect(d.wipe).not.toBeNull();
    expect(d.advanceWipe(t + 100, 640)).not.toBeNull();
    expect(d.now).toBe(0);
    d.advanceWipe(t + 330, 640);
    expect(d.now).toBe(1);
    expect(applied.at(-1)).toBe(1);
    expect(d.advanceWipe(t + 700, 640)).toBeNull();
  });

  it('steps down after 3 s below the current threshold', () => {
    const { d, queued } = setup();
    d.now = 2;
    let t = 7000;
    for (; t < 11000 && !queued.length; t += 16) d.update(f(0.1), t, 0.016, input);
    expect(queued).toEqual([1]);
    expect(t - 7000).toBeGreaterThan(2900);
  });

  it('never moves on its own when Auto is off', () => {
    const { d, queued } = setup();
    for (let t = 7000; t < 20000; t += 16) d.update(f(1, true), t, 0.016, { ...input, auto: false });
    expect(queued).toEqual([]);
  });

  it('a manual pick wipes straight there', () => {
    const { d } = setup();
    d.pick(3, 100);
    d.advanceWipe(500, 640);
    expect(d.now).toBe(3);
  });
});

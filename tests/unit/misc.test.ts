import { describe, expect, it, vi } from 'vitest';
import { FlashBudget } from '../../src/render/safety';
import { DEFAULT_FX, sanitize } from '../../src/settings';
import { Store } from '../../src/store';
import { formatTime, slam } from '../../src/util/math';
import { hash, seededRandom } from '../../src/util/rand';

describe('FlashBudget', () => {
  it('allows 3 flashes per second, 1 in strict mode', () => {
    const b = new FlashBudget();
    expect([0, 10, 20, 30].map((t) => b.take(t, false))).toEqual([true, true, true, false]);
    expect(b.take(1001, false)).toBe(true);
    const s = new FlashBudget();
    expect([0, 500, 1001].map((t) => s.take(t, true))).toEqual([true, false, true]);
  });
});

describe('Store', () => {
  it('notifies only on real changes', () => {
    const st = new Store({ a: 1, b: 'x' });
    const fn = vi.fn();
    st.subscribe(fn);
    st.set({ a: 1 });
    expect(fn).not.toHaveBeenCalled();
    st.set({ a: 2 });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn.mock.calls[0][0]).toEqual({ a: 2, b: 'x' });
    expect(fn.mock.calls[0][1]).toEqual({ a: 1, b: 'x' });
  });
});

describe('sanitize (stored settings)', () => {
  it('keeps valid values and drops junk', () => {
    expect(sanitize({ dose: 42, motion: 'on', syncMs: 120, quality: 'low' })).toEqual({
      dose: 40,
      motion: 'on',
      syncMs: 120,
      quality: 'low',
    });
    expect(
      sanitize({ dose: 900 as number, motion: 'sideways' as 'on', syncMs: -5, quality: 'ultra' as 'low' }),
    ).toEqual({});
    expect(sanitize({ fx: { cuts: false, bogus: true } as unknown as typeof DEFAULT_FX }).fx).toEqual({
      ...DEFAULT_FX,
      cuts: false,
    });
  });
});

describe('utils', () => {
  it('formats mm:ss', () => {
    expect(formatTime(0)).toBe('00:00');
    expect(formatTime(75.9)).toBe('01:15');
  });
  it('slam overshoots then settles at 1', () => {
    expect(slam(0)).toBeCloseTo(0);
    expect(slam(1)).toBeCloseTo(1);
    expect(Math.max(...Array.from({ length: 50 }, (_, i) => slam(i / 49)))).toBeGreaterThan(1);
  });
  it('seeded random is reproducible', () => {
    const a = seededRandom(hash('x'));
    const b = seededRandom(hash('x'));
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});

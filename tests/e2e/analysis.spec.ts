/**
 * Beat-sync regression tests. Each fixture is a synthetic track with kicks on a known grid; the
 * harness runs the real analysis code sample-accurately and we score it against the grid.
 */
import { expect, test, type Page } from '@playwright/test';
import type { ProbeOptions, ProbeRow } from '../harness/sync';

const HARNESS = 'http://localhost:5173/tests/harness/sync.html';

async function run(page: Page, fixture: string, opts: ProbeOptions = {}): Promise<ProbeRow[]> {
  await page.goto(HARNESS);
  await page.waitForFunction(() => 'probe' in window);
  return page.evaluate(
    ([url, o]) => (window as unknown as { probe: (u: string, o: ProbeOptions) => Promise<ProbeRow[]> }).probe(url, o),
    [`/tests/fixtures/audio/${fixture}`, opts] as const,
  );
}

interface Score {
  hitRate: number;
  latencyMs: number;
  extraBeats: number;
  /** Burst pulse right after a kick vs 180–300 ms later. */
  pulseOnOff: number;
  /** String amplitude right after a kick vs 180–300 ms later. */
  stringOnOff: number;
  /** Dancers' clock error vs the true beat, second half of the track. */
  clockMs: number;
}

function score(rows: ProbeRow[], bpm: number): Score {
  const P = 60 / bpm;
  const L = rows.filter((r) => r.t > 3 && r.t < 18.5);
  const kicks: number[] = [];
  for (let k = 0; k * P < 19; k++) if (k * P > 3.2 && k * P < 18) kicks.push(k * P);
  const beats = L.filter((r) => r.beat).map((r) => r.t);
  const near = (x: number, kt: number): boolean => x - kt > -0.02 && x - kt < 0.1;
  const lat: number[] = [];
  let miss = 0;
  for (const kt of kicks) {
    const d = beats.filter((x) => near(x, kt)).map((x) => x - kt);
    if (d.length) lat.push(Math.min(...d));
    else miss++;
  }
  const extra = beats.filter((x) => !kicks.some((kt) => near(x, kt))).length;
  const win = (a0: number, a1: number, key: 'pulse' | 'amp'): number => {
    const v: number[] = [];
    for (const kt of kicks) for (const r of L) if (r.t - kt >= a0 && r.t - kt < a1) v.push(r[key]);
    return v.reduce((a, x) => a + x, 0) / Math.max(1, v.length);
  };
  const err = kicks.map((kt) => {
    const best = L.reduce((b, r) => (Math.abs(r.t - kt) < Math.abs(b.t - kt) ? r : b), L[0]);
    const fr = best.ph - Math.floor(best.ph);
    return fr > 0.5 ? fr - 1 : fr;
  });
  const tail = err.slice(Math.floor(err.length / 2));
  return {
    hitRate: (kicks.length - miss) / kicks.length,
    latencyMs: Math.round((lat.reduce((a, x) => a + x, 0) / Math.max(1, lat.length)) * 1000),
    extraBeats: extra,
    pulseOnOff: win(0, 0.06, 'pulse') / Math.max(1e-6, win(0.18, 0.3, 'pulse')),
    stringOnOff: win(0, 0.06, 'amp') / Math.max(1e-6, win(0.18, 0.3, 'amp')),
    clockMs: Math.round((tail.reduce((a, x) => a + Math.abs(x), 0) / tail.length) * P * 1000),
  };
}

test.describe('beat detection', () => {
  test('hype, 128 BPM: every kick, fast, almost no false beats', async ({ page }) => {
    const s = score(await run(page, 'hype-128.flac'), 128);
    console.log('hype', JSON.stringify(s));
    expect(s.hitRate).toBe(1);
    expect(s.latencyMs).toBeLessThanOrEqual(30);
    expect(s.extraBeats).toBeLessThanOrEqual(2);
    expect(s.pulseOnOff).toBeGreaterThan(1.5);
    expect(s.stringOnOff).toBeGreaterThan(1.5);
    expect(s.clockMs).toBeLessThanOrEqual(30);
  });

  test('grit, 150 BPM: every kick through a dense mix', async ({ page }) => {
    const s = score(await run(page, 'grit-150.flac'), 150);
    console.log('grit', JSON.stringify(s));
    expect(s.hitRate).toBe(1);
    expect(s.latencyMs).toBeLessThanOrEqual(40);
    expect(s.extraBeats).toBeLessThanOrEqual(4);
    expect(s.clockMs).toBeLessThanOrEqual(40);
  });

  test('dreamy: no kicks, so no false beats', async ({ page }) => {
    const rows = await run(page, 'dreamy.flac');
    expect(rows.filter((r) => r.t > 3 && r.beat).length).toBe(0);
  });

  test('brooding, 72 BPM: kicks are found, dancers stay near the beat', async ({ page }) => {
    const s = score(await run(page, 'brooding-72.flac'), 72);
    console.log('brooding', JSON.stringify(s));
    expect(s.hitRate).toBeGreaterThanOrEqual(0.5);
    expect(s.latencyMs).toBeLessThanOrEqual(40);
    expect(s.clockMs).toBeLessThanOrEqual(90);
  });
});

test.describe('visual sync delay', () => {
  for (const fps of [60, 144]) {
    test(`beats reach the picture 200 ms later at ${fps} fps`, async ({ page }) => {
      const rows = await run(page, 'hype-128.flac', { fps, delayMs: 200, seconds: 12 });
      const live = rows.filter((r) => r.beat).map((r) => r.t * 1000);
      const shown = rows.filter((r) => r.shown).map((r) => r.t * 1000);
      // Every beat that had time to come out did, and only once.
      const due = live.filter((t) => t + 200 < rows[rows.length - 1].t * 1000);
      const lags = due.map((t) => Math.min(...shown.filter((s) => s >= t).map((s) => s - t)));
      expect(shown.length).toBeGreaterThanOrEqual(due.length - 3); // re-triggers within one frame merge
      for (const lag of lags) {
        expect(lag).toBeGreaterThanOrEqual(180);
        expect(lag).toBeLessThanOrEqual(225);
      }
    });
  }
});

import { describe, expect, it } from 'vitest';
import { DIMS } from '../../src/config/dims';
import type { DrawContext } from '../../src/render/context';
import { BROODING } from '../../src/render/scenes/brooding';
import { GlobeBuffer, SCAN, layoutGlobe, ringBar, type GlobeParams } from '../../src/render/scenes/globe';
import { LookTracker, newLook } from '../../src/render/scenes/look';
import { extractPalette, mix, parseHex, tintDim } from '../../src/render/scenes/palette';
import { SCENES, sceneIndexForDim, sceneSet, scenesFor } from '../../src/render/scenes/registry';
import type { SceneInput } from '../../src/render/scenes/types';
import type { Analysis, Features, MoodId } from '../../src/types';

const MOODS: MoodId[] = ['hype', 'grit', 'dreamy', 'brooding'];

/** A synthetic "cover": vertical blocks of the given colours. */
function cover(colours: [number, number, number][], size = 48): Uint8ClampedArray {
  const px = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const c = colours[Math.floor((x / size) * colours.length)];
      px.set([c[0], c[1], c[2], 255], (y * size + x) * 4);
    }
  }
  return px;
}

const hue = (hex: string): number => {
  const [r, g, b] = parseHex(hex).map((v) => v / 255);
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  if (mx === mn) return 0;
  const d = mx - mn;
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return h * 60;
};

describe('scene registry', () => {
  it('has a unique id per scene and three scenes for every mood', () => {
    expect(new Set(SCENES.map((s) => s.id)).size).toBe(SCENES.length);
    for (const m of MOODS) expect(scenesFor(m)).toHaveLength(3);
    expect(scenesFor(null).map((s) => s.id)).toEqual(['rays', 'globe']);
  });

  it('plays the listening globe until a mood is read', () => {
    expect(sceneSet(null, 42)).toEqual(['globe']);
  });

  it('gives the same song the same set, and varies the set across songs', () => {
    expect(sceneSet('grit', 123)).toEqual(sceneSet('grit', 123));
    const leads = new Set(Array.from({ length: 40 }, (_, s) => sceneSet('hype', s * 7919)[0]));
    expect(leads.size).toBe(3);
  });

  it('maps dimensions onto the set', () => {
    expect([0, 1, 2, 3].map((d) => sceneIndexForDim(d, 3))).toEqual([0, 0, 1, 2]);
    expect(sceneIndexForDim(3, 1)).toBe(0);
  });
});

describe('extractPalette', () => {
  it('pulls the cover’s hues as inks', () => {
    const p = extractPalette(
      cover([
        [220, 30, 40],
        [30, 60, 210],
        [240, 210, 20],
        [10, 10, 12],
      ]),
    );
    expect(p).not.toBeNull();
    const hues = p!.inks.map(hue);
    const near = (target: number): boolean =>
      hues.some((h) => Math.min(Math.abs(h - target), 360 - Math.abs(h - target)) < 25);
    expect(near(357)).toBe(true); // red
    expect(near(229)).toBe(true); // blue
    expect(near(52)).toBe(true); // yellow
  });

  it('returns null for greyscale covers, so the dimension keeps its plates', () => {
    expect(
      extractPalette(
        cover([
          [20, 20, 20],
          [128, 128, 128],
          [240, 240, 240],
        ]),
      ),
    ).toBeNull();
  });

  it('fills in missing inks for a one-colour cover', () => {
    const p = extractPalette(
      cover([
        [200, 40, 160],
        [12, 10, 14],
      ]),
    );
    expect(p?.inks).toHaveLength(3);
    expect(new Set(p?.inks).size).toBe(3);
  });

  it('is deterministic', () => {
    const px = cover([
      [200, 120, 30],
      [40, 160, 140],
      [90, 20, 120],
    ]);
    expect(extractPalette(px)).toEqual(extractPalette(px));
  });
});

describe('tintDim', () => {
  it('moves plates toward the cover inks by the given strength', () => {
    const p = { inks: ['#FF0000', '#00FF00', '#0000FF'] as [string, string, string], ray: '#FF0000', stage: '#100000' };
    const D = DIMS[1];
    expect(tintDim(D, p, 0).plates).toEqual(D.plates.map((c) => mix(c, c, 0)));
    expect(tintDim(D, p, 1).plates).toEqual(['#FF0000', '#00FF00', '#0000FF']);
  });
});

describe('look', () => {
  it('is seeded from the song key', () => {
    expect(newLook('a').angle).toBe(newLook('a').angle);
    expect(newLook('a').seed).not.toBe(newLook('b').seed);
  });

  it('glides energy and brightness toward a new mood read', () => {
    const tr = new LookTracker('song');
    tr.setMood(1, 0, 128);
    tr.update(0.1);
    expect(tr.look.energy).toBeGreaterThan(0.5);
    expect(tr.look.energy).toBeLessThan(0.7);
    for (let i = 0; i < 300; i++) tr.update(1 / 60);
    expect(tr.look.energy).toBeCloseTo(1, 2);
    expect(tr.look.brightness).toBeCloseTo(0, 2);
    expect(tr.look.bpm).toBe(128);
  });
});

describe('listening globe', () => {
  const base: GlobeParams = {
    cx: 0,
    cy: 0,
    R: 100,
    rings: 20,
    density: 40,
    yaw: 0.4,
    tilt: 0.38,
    dot: 3,
    levels: null,
    swell: 0.16,
    wave: 0,
    scan: Number.NaN,
  };
  const reach = (b: GlobeBuffer): number => {
    let m = 0;
    for (let i = 0; i < b.n; i++) m = Math.max(m, Math.hypot(b.x[i], b.y[i]));
    return m;
  };

  it('lays out the same dots every time and stays inside its radius', () => {
    const a = new GlobeBuffer();
    const b = new GlobeBuffer();
    layoutGlobe(base, a);
    layoutGlobe(base, b);
    expect(a.n).toBeGreaterThan(400);
    expect(Array.from(a.x.subarray(0, a.n))).toEqual(Array.from(b.x.subarray(0, b.n)));
    expect(reach(a)).toBeLessThan(100);
  });

  it('pushes loud rings outward', () => {
    const quiet = new GlobeBuffer();
    const loud = new GlobeBuffer();
    layoutGlobe(base, quiet);
    layoutGlobe({ ...base, levels: new Float32Array(21).fill(1) }, loud);
    expect(reach(loud)).toBeGreaterThan(reach(quiet) * 1.1);
  });

  it('only marks scan dots while a scan is running', () => {
    const count = (b: GlobeBuffer): number => Array.from(b.g.subarray(0, b.n)).filter((g) => g === SCAN).length;
    const off = new GlobeBuffer();
    const on = new GlobeBuffer();
    layoutGlobe(base, off);
    layoutGlobe({ ...base, scan: 0 }, on);
    expect(count(off)).toBe(0);
    expect(count(on)).toBeGreaterThan(10);
  });

  it('never writes past the buffer', () => {
    const small = new GlobeBuffer(50);
    layoutGlobe(base, small);
    expect(small.n).toBe(50);
  });

  it('gives the equator the bass and the poles the treble', () => {
    const bars = Float32Array.from({ length: 48 }, (_, i) => i);
    expect(ringBar(10, 20, bars)).toBe(0);
    expect(ringBar(0, 20, bars)).toBe(36);
    expect(ringBar(20, 20, bars)).toBe(36);
  });
});

describe('rain lightning gate', () => {
  // The scenes draw with Path2D and a 2D context, neither of which exists in the node test env.
  // Stub them out: the test only cares whether flash() is asked for, not what gets painted.
  const noop = (): void => {};
  class FakePath2D {
    moveTo = noop;
    lineTo = noop;
    arc = noop;
    ellipse = noop;
    rect = noop;
    closePath = noop;
  }
  (globalThis as { Path2D: typeof Path2D }).Path2D = FakePath2D as unknown as typeof Path2D;
  const fakeCtx = new Proxy({}, { get: () => noop, set: () => true }) as CanvasRenderingContext2D;

  const features = (): Features => ({
    beat: true,
    strong: true,
    snare: true,
    replaced: false,
    spark: 0,
    pulse: 0.5,
    mids: 0.5,
    highs: 0.5,
    intensity: 0.6,
    db: -10,
    silent: false,
    bands: new Float32Array(8),
  });

  const input = (calm: boolean, t: number, flash: () => boolean): SceneInput => {
    const f = features();
    const a: Analysis = { f, bars: new Float32Array(48), peaks: new Float32Array(48), wave: new Float32Array(160) };
    const dc = {
      c: fakeCtx,
      W: 390,
      H: 844,
      k: 1,
      md: 390,
      cx: 195,
      cy: 300,
      R: 60,
      off: 2,
      dose: 0.7,
      tr: 1,
      calm,
      mob: true,
      t,
      dt: 1 / 60,
      D: DIMS[3],
      dim: 3,
      a,
      f,
      pat: { dots: () => '#000' } as unknown as DrawContext['pat'],
      jit: new Float32Array(40),
      motion: 1,
    } satisfies DrawContext;
    return { dc, look: { ...newLook('rain'), energy: 1 }, alpha: 0.5, kick: 0.2, rings: [], flash };
  };

  const rain = () => BROODING.find((s) => s.id === 'rain')!.create(newLook('rain'));

  it('never asks for a flash in calm mode, even on strong beats', () => {
    const scene = rain();
    let flashed = false;
    for (let i = 0; i < 40; i++) scene.draw(input(true, i * 2000, () => ((flashed = true), true)));
    expect(flashed).toBe(false);
  });

  it('does ask for a flash on strong beats when not calm', () => {
    const scene = rain();
    let flashed = false;
    for (let i = 0; i < 60 && !flashed; i++) scene.draw(input(false, i * 2000, () => ((flashed = true), true)));
    expect(flashed).toBe(true);
  });
});

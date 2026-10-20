/**
 * The listening globe: a dotted 3D sphere whose latitude rings follow the spectrum. It plays while
 * a song's mood is being read, so the app visibly listens before it picks a look.
 *
 * The idea of an honest-3D dotted orb (rotated, depth-shaded dots) comes from thinking-orbs by
 * Jakub Antalik (MIT). This is a separate implementation in BEAT LAB's print style: the dots are
 * grouped by depth and filled one group at a time, so a full-screen globe costs a handful of fills
 * instead of one per dot.
 */
import { PAPER } from '../../config/dims';
import type { Scene, SceneDef, SceneInput, SongLook } from './types';
import { approach, beatSeconds, clamp01, sceneRandom } from './util';

/** Dot groups, filled in this order (far to near). */
export const FAR = 0;
export const BACK = 1;
export const MID = 2;
export const NEAR = 3;
/** Front dots on a loud ring. */
export const HOT = 4;
/** Front dots under the scan band. */
export const SCAN = 5;
export const GROUPS = 6;

export interface GlobeParams {
  cx: number;
  cy: number;
  /** Sphere radius in px. */
  R: number;
  /** Latitude steps pole to pole; there are rings + 1 rings, poles included. */
  rings: number;
  /** Dots on the equator; other rings scale with their circumference. */
  density: number;
  yaw: number;
  tilt: number;
  /** Radius of the nearest dot at rest, px. */
  dot: number;
  /** Level 0..1 per ring (index 0 = south pole). null = quiet. */
  levels: ArrayLike<number> | null;
  /** How far a ring at level 1 pushes out, as a fraction of R. */
  swell: number;
  /** Phase of the slow breathing wave that keeps the sphere alive when it's quiet. */
  wave: number;
  /** sin(latitude) of the scan band's centre, or NaN for no scan. */
  scan: number;
}

/** Reusable dot storage, so laying out a frame allocates nothing. */
export class GlobeBuffer {
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly r: Float32Array;
  readonly g: Uint8Array;
  n = 0;

  constructor(readonly cap = 1400) {
    this.x = new Float32Array(cap);
    this.y = new Float32Array(cap);
    this.r = new Float32Array(cap);
    this.g = new Uint8Array(cap);
  }
}

/** Project every dot of the globe into the buffer: position, radius and depth group. */
export function layoutGlobe(p: GlobeParams, out: GlobeBuffer): void {
  const sy = Math.sin(p.yaw);
  const cyw = Math.cos(p.yaw);
  const st = Math.sin(p.tilt);
  const ct = Math.cos(p.tilt);
  let n = 0;
  for (let ri = 0; ri <= p.rings && n < out.cap; ri++) {
    const lat = -Math.PI / 2 + (ri / p.rings) * Math.PI;
    const cl = Math.cos(lat);
    const sl = Math.sin(lat);
    const lv = p.levels ? clamp01(p.levels[ri] ?? 0) : 0;
    const breath = 0.022 * Math.sin(p.wave - ri * 0.55) + 0.014 * Math.sin(p.wave * 0.61 + ri * 0.9);
    const rr = p.R * (1 - p.swell * 0.5 + p.swell * lv + breath);
    const count = Math.max(1, Math.round(Math.abs(cl) * p.density));
    const hot = lv > 0.72;
    const scanned = Math.abs(sl - p.scan) < 0.09;
    // Alternate rings are offset by half a step, like a halftone screen.
    const stagger = (ri % 2) * 0.5;
    for (let j = 0; j < count && n < out.cap; j++) {
      const lon = ((j + stagger) / count) * Math.PI * 2;
      const x = cl * Math.cos(lon);
      const z = cl * Math.sin(lon);
      // Yaw about the vertical axis, then tilt toward the viewer.
      const x1 = x * cyw + z * sy;
      const z1 = -x * sy + z * cyw;
      const y1 = sl * ct - z1 * st;
      const z2 = sl * st + z1 * ct;
      const depth = (z2 + 1) / 2;
      out.x[n] = p.cx + x1 * rr;
      out.y[n] = p.cy - y1 * rr;
      out.r[n] = p.dot * (0.3 + 0.7 * depth) * (1 + 0.45 * lv);
      out.g[n] =
        scanned && depth > 0.35
          ? SCAN
          : hot && depth > 0.5
            ? HOT
            : depth < 0.3
              ? FAR
              : depth < 0.5
                ? BACK
                : depth < 0.75
                  ? MID
                  : NEAR;
      n++;
    }
  }
  out.n = n;
}

/** Fill each depth group with its colour and alpha (null colour or ~0 alpha skips the group). */
export function fillGlobe(
  c: CanvasRenderingContext2D,
  b: GlobeBuffer,
  colors: readonly (string | null)[],
  alphas: readonly number[],
): void {
  for (let grp = 0; grp < GROUPS; grp++) {
    const col = colors[grp];
    const a = alphas[grp] ?? 0;
    if (!col || a <= 0.01) continue;
    c.beginPath();
    let any = false;
    for (let i = 0; i < b.n; i++) {
      if (b.g[i] !== grp) continue;
      const r = Math.max(0.4, b.r[i]);
      c.moveTo(b.x[i] + r, b.y[i]);
      c.arc(b.x[i], b.y[i], r, 0, Math.PI * 2);
      any = true;
    }
    if (!any) continue;
    c.globalAlpha = Math.min(1, a);
    c.fillStyle = col;
    c.fill();
  }
}

/** Spectrum bar for a ring: the equator listens to the bass, the poles to the treble. */
export function ringBar(ri: number, rings: number, bars: ArrayLike<number>): number {
  const u = Math.abs((2 * ri) / rings - 1);
  return bars[Math.min(bars.length - 1, Math.round(u * 36))] ?? 0;
}

const GAIN = 4.5;

class ListeningGlobe implements Scene {
  private readonly buf = new GlobeBuffer(1400);
  private readonly levels = new Float32Array(40);
  private yaw: number;
  private readonly tiltPh: number;
  private push = 0;
  private wave = 0;
  private clock = 0;
  private scanT0 = -1e9;

  constructor(look: SongLook) {
    const r = sceneRandom(look.seed, 'globe');
    this.yaw = r() * Math.PI * 2;
    this.tiltPh = r() * Math.PI * 2;
  }

  draw(i: SceneInput): void {
    const { c, cx, cy, f, D, dt, t, calm, mob, md, a, off } = i.dc;
    const bps = beatSeconds(i.look.bpm);
    const mo = calm ? 0.35 : i.dc.motion;
    const rings = mob ? 20 : 26;
    // A kick turns the globe a little further, like the sunburst's half-ray kick.
    if (f.beat && !calm) this.push = f.strong ? 1 : 0.6;
    // A strong beat sends a scan band up the globe over two beats.
    if (f.strong && !calm) this.scanT0 = t;
    this.push = approach(this.push, 0, dt, 0.25);
    this.yaw += dt * (((Math.PI * 2) / (16 * bps)) * mo * (0.6 + 0.6 * i.look.energy) + this.push * 0.9);
    this.wave += dt * (2 + 2 * i.look.energy) * mo;
    this.clock += dt * mo;
    for (let ri = 0; ri <= rings; ri++) {
      const target = Math.pow(ringBar(ri, rings, a.bars), 0.85) * (calm ? 0.5 : 1);
      const cur = this.levels[ri];
      this.levels[ri] = approach(cur, target, dt, target > cur ? 0.03 : 0.2);
    }
    const g = Math.min(1, i.alpha * GAIN);
    if (g <= 0.01) return;

    const R = md * (mob ? 0.46 : 0.42) * (1 + 0.04 * i.kick);
    const spacing = (Math.PI * R) / rings;
    const sp = (t - this.scanT0) / 1000 / (2 * bps);
    layoutGlobe(
      {
        cx,
        cy,
        R,
        rings,
        density: rings * 2,
        yaw: this.yaw,
        tilt: 0.38 + 0.08 * Math.sin(this.clock * 0.3 + this.tiltPh),
        dot: spacing * 0.17,
        levels: this.levels,
        swell: 0.16,
        wave: this.wave,
        scan: sp >= 0 && sp < 1 ? -1.1 + 2.2 * sp : NaN,
      },
      this.buf,
    );

    // Inkfall is paper on black with one red: keep the back of the globe grey and loud rings red.
    const inkfall = D.id === 'inkfall';
    const back = inkfall ? D.plates[2] : D.plates[1];
    const front = D.plates[0];
    const hot = inkfall ? D.accent : D.plates[2];
    // Misregistered second ink under the front of the globe.
    c.save();
    c.translate(off, 0);
    fillGlobe(c, this.buf, [null, null, back, back, back, null], [0, 0, g * 0.35, g * 0.45, g * 0.5, 0]);
    c.restore();
    fillGlobe(
      c,
      this.buf,
      [back, back, front, front, hot, PAPER],
      [g * 0.28, g * 0.48, g * 0.66, g * 0.88, g, Math.min(1, g * 1.3)],
    );
    c.globalAlpha = 1;
  }
}

export const LISTENING: SceneDef[] = [
  {
    id: 'globe',
    mood: null,
    name: 'Listening globe',
    blurb:
      'A dotted 3D globe while the mood is read: the equator swells with the bass, the poles with the treble, and strong beats send a scan up it.',
    create: (l) => new ListeningGlobe(l),
  },
];

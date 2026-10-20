/** Dreamy scenes: slow drift, soft breathing, hi-hats sparkle. */
import { PAPER } from '../../config/dims';
import type { Scene, SceneDef, SceneInput, SongLook } from './types';
import { approach, beatSeconds, sceneRandom, star4 } from './util';

const motion = (i: SceneInput): number => (i.dc.calm ? 0.35 : i.dc.motion);

interface Star {
  x: number;
  y: number;
  s: number;
  ph: number;
  flare: number;
}

function makeStars(r: () => number, n: number, maxY: number): Star[] {
  return Array.from({ length: n }, () => ({ x: r(), y: r() * maxY, s: 0.4 + r(), ph: r() * Math.PI * 2, flare: 0 }));
}

/** Stars twinkle slowly; each hi-hat sparkle makes a few flare. */
function drawStars(i: SceneInput, stars: Star[], g: number, rand: () => number): void {
  const { c, W, H, k, f, D, dt, t, calm } = i.dc;
  if (f.spark && !calm)
    for (let n = 0; n < Math.min(4, f.spark); n++) stars[Math.floor(rand() * stars.length)].flare = 1;
  const dim = new Path2D();
  const bright = new Path2D();
  for (const s of stars) {
    s.flare = approach(s.flare, 0, dt, 0.25);
    const tw = 0.5 + 0.5 * Math.sin(t * 0.0018 + s.ph);
    const size = (1.5 + s.s * 2 + s.flare * 7) * k;
    star4(s.flare > 0.15 ? bright : dim, s.x * W, s.y * H, size * (0.7 + 0.3 * tw));
  }
  c.globalAlpha = g * 0.6;
  c.fillStyle = D.plates[2];
  c.fill(dim);
  c.globalAlpha = Math.min(1, g * 1.6);
  c.fillStyle = PAPER;
  c.fill(bright);
}

interface Cloud {
  x: number;
  y: number;
  sc: number;
  puffs: [number, number, number][];
  /** [puff, from, to]: the stretches of each puff's top arc that sit on the cloud's outline. */
  rims: [number, number, number][];
}

/**
 * The parts of each puff's upper arc that no other puff covers, so the paper rim traces the
 * cloud's outline instead of every overlapping circle. Puffs scale uniformly, so this is computed once.
 */
function exposedRims(puffs: [number, number, number][]): [number, number, number][] {
  const out: [number, number, number][] = [];
  const A0 = Math.PI * 1.05;
  const N = 14;
  const step = (Math.PI * 0.9) / N;
  puffs.forEach(([x, y, r], p) => {
    let from = -1;
    for (let s = 0; s <= N; s++) {
      let open = false;
      if (s < N) {
        const a = A0 + step * (s + 0.5);
        const px = x + Math.cos(a) * r;
        const py = y + Math.sin(a) * r;
        open = !puffs.some(([qx, qy, qr], q) => q !== p && Math.hypot(px - qx, py - qy) < qr);
      }
      if (open && from < 0) from = s;
      if (!open && from >= 0) {
        out.push([p, A0 + step * from, A0 + step * s]);
        from = -1;
      }
    }
  });
  return out;
}

/** Halftone cloud banks drifting at three depths past a big moon (or sun, for brighter songs). */
class Clouds implements Scene {
  private readonly layers: Cloud[][] = [];
  private readonly stars: Star[];
  private readonly moonX: number;
  private drift = [0, 0, 0];
  private readonly rand: () => number;

  constructor(look: SongLook) {
    const r = sceneRandom(look.seed, 'clouds');
    this.rand = r;
    this.moonX = 0.18 + r() * 0.64;
    this.stars = makeStars(r, 70, 0.6);
    for (let L = 0; L < 3; L++) {
      const clouds: Cloud[] = [];
      const n = 4 + L;
      for (let j = 0; j < n; j++) {
        const puffs: [number, number, number][] = [];
        const m = 5 + Math.floor(r() * 4);
        for (let q = 0; q < m; q++) {
          const u = q / (m - 1) - 0.5;
          puffs.push([
            u * 1.8 + (r() - 0.5) * 0.2,
            -Math.abs(Math.cos(u * Math.PI)) * 0.5 * (0.6 + r() * 0.6),
            0.35 + r() * 0.35 * (1 - Math.abs(u)),
          ]);
        }
        clouds.push({
          x: ((j + r() * 0.6) / n) * 1.4,
          y: 0.16 + L * 0.2 + (r() - 0.5) * 0.08,
          sc: 0.07 + L * 0.035 + r() * 0.03,
          puffs,
          rims: exposedRims(puffs),
        });
      }
      this.layers.push(clouds);
    }
  }

  draw(i: SceneInput): void {
    const { c, W, H, k, f, D, dt, md, pat } = i.dc;
    const sp = motion(i) * (0.5 + 0.7 * i.look.energy);
    for (let L = 0; L < 3; L++) this.drift[L] = (this.drift[L] + dt * (0.006 + L * 0.008) * sp) % 1.4;
    const g = Math.min(1, i.alpha * 2.4);
    if (g <= 0.01) return;
    drawStars(i, this.stars, g, this.rand);

    // Moon (crescent) or sun.
    const R = md * 0.15 * (1 + 0.04 * f.pulse);
    const mx = W * this.moonX;
    const my = H * 0.24;
    const sunny = i.look.brightness > 0.6;
    c.globalAlpha = g;
    c.beginPath();
    c.arc(mx, my, R, 0, Math.PI * 2);
    c.fillStyle = pat.dots(sunny ? D.plates[2] : D.ray, 3.2 * k, 7 * k, 15);
    c.fill();
    if (!sunny) {
      c.beginPath();
      c.arc(mx - R * 0.38, my - R * 0.12, R * 0.82, 0, Math.PI * 2);
      c.fillStyle = D.stage;
      c.fill();
    }

    for (let L = 0; L < 3; L++) {
      const body = new Path2D();
      const rim = new Path2D();
      for (const cl of this.layers[L]) {
        for (const shift of [0, 1.4]) {
          const x = ((cl.x - this.drift[L] + shift) % 2.8) * W - W * 0.2;
          if (x < -W * 0.4 || x > W * 1.4) continue;
          const y = H * cl.y;
          const s = md * cl.sc * 2.2 * (1 + 0.03 * f.pulse);
          for (const [dx, dy, r] of cl.puffs) {
            const px = x + dx * s;
            const py = y + dy * s;
            body.moveTo(px + r * s, py);
            body.arc(px, py, r * s, 0, Math.PI * 2);
          }
          for (const [p, a0, a1] of cl.rims) {
            const [dx, dy, r] = cl.puffs[p];
            const px = x + dx * s;
            const py = y + dy * s;
            rim.moveTo(px + Math.cos(a0) * r * s, py + Math.sin(a0) * r * s);
            rim.arc(px, py, r * s, a0, a1);
          }
        }
      }
      // Rim first, then occlude: the body covers the rim's inner half and every arc where clouds
      // overlap, so only a lit edge along the bank's outline survives. Then print the cloud.
      c.globalAlpha = g * 0.75;
      c.lineWidth = (3 + L) * k;
      c.strokeStyle = PAPER;
      c.stroke(rim);
      c.globalAlpha = Math.min(1, g * 1.6);
      c.fillStyle = D.stage;
      c.fill(body);
      c.globalAlpha = g * (0.45 + L * 0.12);
      c.fillStyle = pat.dots(D.plates[L % 3], (1.4 + L * 0.4) * k, 7 * k, 15 + L * 30);
      c.fill(body);
    }
    c.globalAlpha = 1;
  }
}

interface Ribbon {
  y: number;
  th: number;
  freq: [number, number, number];
  amp: [number, number, number];
  ph: number;
  plate: number;
}

/** Slow aurora curtains with vertical striations over a dark ridge line. */
class Aurora implements Scene {
  private readonly ribbons: Ribbon[] = [];
  private readonly stars: Star[];
  private readonly ridge: number[];
  private clock = 0;
  private glow = 0;
  private readonly rand: () => number;

  constructor(look: SongLook) {
    const r = sceneRandom(look.seed, 'aurora');
    this.rand = r;
    this.stars = makeStars(r, 50, 0.7);
    for (let j = 0; j < 4; j++) {
      this.ribbons.push({
        y: 0.16 + j * 0.08 + r() * 0.05,
        th: 0.07 + r() * 0.08,
        freq: [1 + r() * 1.5, 2.5 + r() * 2, 5 + r() * 3],
        amp: [0.05 + r() * 0.04, 0.02 + r() * 0.02, 0.008 + r() * 0.008],
        ph: r() * 10,
        plate: j % 3,
      });
    }
    this.ridge = Array.from({ length: 24 }, () => r());
  }

  draw(i: SceneInput): void {
    const { c, W, H, k, f, D, dt, pat } = i.dc;
    this.clock += (dt / beatSeconds(i.look.bpm)) * 0.08 * motion(i) * (0.5 + 0.8 * i.look.energy);
    this.glow = approach(this.glow, f.mids, dt, 0.4);
    const g = Math.min(1, i.alpha * 2.4);
    if (g <= 0.01) return;
    drawStars(i, this.stars, g * 0.8, this.rand);
    const steps = 48;
    for (const rb of this.ribbons) {
      const yAt = (u: number): number =>
        H *
        (rb.y +
          rb.amp[0] * Math.sin(u * rb.freq[0] * 6.28 + this.clock + rb.ph) +
          rb.amp[1] * Math.sin(u * rb.freq[1] * 6.28 - this.clock * 1.3) +
          rb.amp[2] * Math.sin(u * rb.freq[2] * 6.28 + this.clock * 2));
      const thAt = (u: number): number =>
        H * rb.th * (0.6 + 0.4 * Math.sin(u * 9 + this.clock * 0.7 + rb.ph)) * (0.8 + 0.6 * this.glow);
      const path = new Path2D();
      for (let s = 0; s <= steps; s++) {
        const u = s / steps;
        if (s) path.lineTo(u * W, yAt(u));
        else path.moveTo(0, yAt(0));
      }
      for (let s = steps; s >= 0; s--) {
        const u = s / steps;
        path.lineTo(u * W, yAt(u) + thAt(u));
      }
      path.closePath();
      c.globalAlpha = g * (0.55 + 0.35 * i.kick);
      c.fillStyle = pat.dots(D.plates[rb.plate], (1.8 + this.glow * 1.6) * k, 7 * k, 15 + rb.plate * 30);
      c.fill(path);
      // Curtain folds: thin vertical strokes clipped to the ribbon.
      c.save();
      c.clip(path);
      c.globalAlpha = g * 0.4;
      c.strokeStyle = PAPER;
      c.lineWidth = 1.2 * k;
      // Only stroke the band the ribbon can occupy; the clip does the rest.
      const reach = rb.amp[0] + rb.amp[1] + rb.amp[2];
      const top = H * (rb.y - reach);
      const bottom = H * (rb.y + reach + rb.th * 1.4);
      c.beginPath();
      for (let x = (this.clock * 40 * k) % (11 * k); x < W; x += 11 * k) {
        c.moveTo(x, top);
        c.lineTo(x, bottom);
      }
      c.stroke();
      c.restore();
    }
    // A dark ridge line along the horizon gives the sky depth.
    const ridge = new Path2D();
    ridge.moveTo(0, H);
    this.ridge.forEach((v, j) => ridge.lineTo((j / (this.ridge.length - 1)) * W, H * (0.78 + v * 0.08)));
    ridge.lineTo(W, H);
    ridge.closePath();
    c.globalAlpha = g;
    c.fillStyle = D.stage;
    c.fill(ridge);
    c.globalAlpha = g * 0.35;
    c.fillStyle = pat.dots(D.plates[1], 1.2 * k, 6 * k, 45);
    c.fill(ridge);
    c.globalAlpha = g * 0.6;
    c.lineWidth = 2 * k;
    c.strokeStyle = PAPER;
    c.stroke(ridge);
    c.globalAlpha = 1;
  }
}

export const DREAMY: SceneDef[] = [
  {
    id: 'clouds',
    mood: 'dreamy',
    name: 'Cloud banks',
    blurb:
      'Halftone clouds drift at three depths past a crescent moon (a sun for brighter songs); hi-hats make stars flare.',
    create: (l) => new Clouds(l),
  },
  {
    id: 'aurora',
    mood: 'dreamy',
    name: 'Aurora',
    blurb: 'Slow aurora curtains over a dark ridge; they swell with the mids and glow on the kick.',
    create: (l) => new Aurora(l),
  },
];

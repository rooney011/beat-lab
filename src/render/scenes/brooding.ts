/** Brooding scenes: dark, heavy, weather and light in the fog. */
import { PAPER } from '../../config/dims';
import type { Scene, SceneDef, SceneInput, SongLook } from './types';
import { approach, beatSeconds, jagged, sceneRandom } from './util';

const motion = (i: SceneInput): number => (i.dc.calm ? 0.35 : i.dc.motion);

interface Drop {
  x: number;
  y: number;
  len: number;
  v: number;
}

interface Bolt {
  t0: number;
  path: Path2D;
}

interface Splash {
  x: number;
  t0: number;
}

/**
 * Slanted rain under a low cloud bank. Snares throw up splashes; on strong hits there's a chance of
 * lightning, which spends one flash from the photosensitivity budget (never in Calm mode).
 */
class Rain implements Scene {
  private readonly drops: Drop[];
  private readonly wind: number;
  private readonly cloud: number[];
  private bolt: Bolt | null = null;
  private lastBolt = -9999;
  private splashes: Splash[] = [];
  private readonly rand: () => number;

  constructor(look: SongLook) {
    const r = sceneRandom(look.seed, 'rain');
    this.rand = r;
    this.wind = 0.12 + r() * 0.25;
    this.drops = Array.from({ length: 260 }, () => ({
      x: r() * 1.3 - 0.15,
      y: r(),
      len: 0.02 + r() * 0.04,
      v: 0.9 + r() * 0.8,
    }));
    this.cloud = jagged(r, 40, 1);
  }

  private strike(i: SceneInput): void {
    const { W, H, t } = i.dc;
    const r = this.rand;
    const p = new Path2D();
    const branch = (x: number, y: number, len: number, depth: number): void => {
      p.moveTo(x, y);
      let cx = x;
      let cy = y;
      const steps = 10 + Math.floor(r() * 6);
      for (let s = 0; s < steps; s++) {
        cx += (r() - 0.5) * W * 0.05;
        cy += (len / steps) * (0.7 + r() * 0.6);
        p.lineTo(cx, cy);
        if (depth < 2 && r() < 0.18) branch(cx, cy, len * 0.4, depth + 1);
        p.moveTo(cx, cy);
      }
    };
    branch(W * (0.15 + r() * 0.7), H * 0.12, H * (0.45 + r() * 0.25), 0);
    this.bolt = { t0: t, path: p };
    this.lastBolt = t;
  }

  draw(i: SceneInput): void {
    const { c, W, H, k, f, D, dt, t, calm, dim, pat, off } = i.dc;
    const e = i.look.energy;
    if (f.strong && !calm && t - this.lastBolt > 1600 && this.rand() < 0.2 + 0.4 * e && i.flash()) this.strike(i);
    if (f.snare && !calm) for (let n = 0; n < 3; n++) this.splashes.push({ x: this.rand(), t0: t });
    this.splashes = this.splashes.filter((s) => t - s.t0 < 320);
    const sp = motion(i) * (0.7 + 0.6 * e);
    for (const d of this.drops) {
      d.y += dt * d.v * 1.6 * sp;
      d.x += dt * d.v * 1.6 * sp * this.wind;
      if (d.y > 1.05) {
        d.y -= 1.1;
        d.x = this.rand() * 1.3 - 0.15;
      }
    }
    const g = Math.min(1, i.alpha * 2.4);
    if (g <= 0.01) return;

    // Lightning lights the whole sky briefly (the flash was paid for when it struck).
    const b = this.bolt;
    const bp = b ? (t - b.t0) / 180 : 1;
    if (b && bp >= 1) this.bolt = null;
    if (b && bp < 1) {
      c.globalAlpha = 0.16 * (1 - bp);
      c.fillStyle = PAPER;
      c.fillRect(0, 0, W, H);
    }

    // Low cloud bank.
    const cloud = new Path2D();
    cloud.moveTo(0, 0);
    this.cloud.forEach((v, j) => cloud.lineTo((j / (this.cloud.length - 1)) * W, H * (0.16 + v * 0.08)));
    cloud.lineTo(W, 0);
    cloud.closePath();
    c.globalAlpha = g;
    c.fillStyle = pat.dots(D.ray, 2.8 * k, 8 * k, 45);
    c.fill(cloud);

    // Rain: thin slanted strokes, one misregistered plate under paper.
    const count = Math.round(this.drops.length * Math.min(1, 0.3 + 0.45 * e + 0.08 * dim) * (calm ? 0.5 : 1));
    const rain = new Path2D();
    for (let j = 0; j < count; j++) {
      const d = this.drops[j];
      const x = d.x * W;
      const y = d.y * H;
      const l = d.len * H * (1 + 0.6 * e);
      rain.moveTo(x, y);
      rain.lineTo(x - this.wind * l, y - l);
    }
    c.lineCap = 'round';
    c.globalAlpha = g * 0.45;
    c.lineWidth = 2.2 * k;
    c.strokeStyle = D.plates[1];
    c.save();
    c.translate(off * 1.2, 0);
    c.stroke(rain);
    c.restore();
    c.globalAlpha = g * 0.7;
    c.lineWidth = 1.3 * k;
    c.strokeStyle = PAPER;
    c.stroke(rain);

    // Splashes on the ground line.
    if (this.splashes.length) {
      const sp2 = new Path2D();
      for (const s of this.splashes) {
        const p = (t - s.t0) / 320;
        const x = s.x * W;
        const r = (6 + 22 * p) * k;
        sp2.moveTo(x - r, H * 0.97);
        sp2.ellipse(x, H * 0.97, r, r * 0.3, 0, Math.PI, 0);
      }
      c.globalAlpha = g * 0.8;
      c.lineWidth = 2 * k;
      c.strokeStyle = PAPER;
      c.stroke(sp2);
    }

    if (b && bp < 1) {
      c.globalAlpha = 0.5 * (1 - bp);
      c.lineWidth = 12 * k;
      c.strokeStyle = D.plates[0];
      c.stroke(b.path);
      c.globalAlpha = 1 - bp;
      c.lineWidth = 3.5 * k;
      c.strokeStyle = PAPER;
      c.stroke(b.path);
    }
    c.lineCap = 'butt';
    c.globalAlpha = 1;
  }
}

interface Beam {
  x: number;
  base: number;
  sweep: number;
  beats: number;
  ph: number;
  width: number;
  plate: number;
}

/** Searchlight beams sweeping through drifting fog, flaring on the kick. */
class Searchlights implements Scene {
  private readonly beams: Beam[] = [];
  private readonly fog: { y: number; amp: number; ph: number; th: number }[] = [];
  private clock = 0;
  private drift = 0;
  private flare = 0;

  constructor(look: SongLook) {
    const r = sceneRandom(look.seed, 'search');
    const n = 3;
    for (let j = 0; j < n; j++) {
      this.beams.push({
        x: (j + 0.5 + (r() - 0.5) * 0.6) / n,
        base: -Math.PI / 2 + (r() - 0.5) * 0.5,
        sweep: 0.22 + r() * 0.3,
        beats: 8 + Math.floor(r() * 9),
        ph: r() * Math.PI * 2,
        width: 0.06 + r() * 0.05,
        plate: j % 3,
      });
    }
    for (let j = 0; j < 4; j++)
      this.fog.push({
        y: 0.3 + j * 0.16 + (r() - 0.5) * 0.06,
        amp: 0.02 + r() * 0.03,
        ph: r() * 6,
        th: 0.06 + r() * 0.05,
      });
  }

  draw(i: SceneInput): void {
    const { c, W, H, k, f, D, dt, calm, pat } = i.dc;
    const bps = beatSeconds(i.look.bpm);
    this.clock += (dt / bps) * motion(i);
    this.drift += dt * 0.02 * motion(i) * (0.5 + i.look.energy);
    if (f.beat && !calm) this.flare = f.strong ? 1 : 0.6;
    this.flare = approach(this.flare, 0, dt, 0.2);
    const g = Math.min(1, i.alpha * 2.4);
    if (g <= 0.01) return;
    const L = Math.hypot(W, H) * 1.2;

    for (const bm of this.beams) {
      const a = bm.base + Math.sin((this.clock / bm.beats) * Math.PI * 2 + bm.ph) * bm.sweep;
      const w = bm.width * (1 + 0.35 * this.flare);
      const sx = bm.x * W;
      const sy = H * 1.04;
      const cone = (half: number): Path2D => {
        const p = new Path2D();
        p.moveTo(sx, sy);
        p.lineTo(sx + Math.cos(a - half) * L, sy + Math.sin(a - half) * L);
        p.lineTo(sx + Math.cos(a + half) * L, sy + Math.sin(a + half) * L);
        p.closePath();
        return p;
      };
      c.globalAlpha = g * (0.6 + 0.4 * this.flare);
      c.fillStyle = pat.dots(D.plates[bm.plate], 2 * k, 7 * k, 15 + bm.plate * 30);
      c.fill(cone(w));
      c.globalAlpha = g * (0.35 + 0.5 * this.flare);
      c.fillStyle = pat.dots(PAPER, 1.4 * k, 5 * k, 45);
      c.fill(cone(w * 0.35));
    }

    // Fog bands drifting across the beams.
    for (const fg of this.fog) {
      const p = new Path2D();
      const steps = 32;
      for (let s = 0; s <= steps; s++) {
        const u = s / steps;
        const y = H * (fg.y + fg.amp * Math.sin(u * 7 + this.drift * 6 + fg.ph));
        if (s) p.lineTo(u * W, y);
        else p.moveTo(0, y);
      }
      for (let s = steps; s >= 0; s--) {
        const u = s / steps;
        p.lineTo(u * W, H * (fg.y + fg.th + fg.amp * Math.sin(u * 5 - this.drift * 4 + fg.ph)));
      }
      p.closePath();
      c.globalAlpha = g * 0.5;
      c.fillStyle = pat.dots(D.ray, 1.3 * k, 6 * k, 60);
      c.fill(p);
    }
    c.globalAlpha = 1;
  }
}

export const BROODING: SceneDef[] = [
  {
    id: 'rain',
    mood: 'brooding',
    name: 'Rain',
    blurb: 'Slanted rain under a low cloud bank; snares splash, strong hits can bring flash-budgeted lightning.',
    create: (l) => new Rain(l),
  },
  {
    id: 'searchlights',
    mood: 'brooding',
    name: 'Searchlights',
    blurb: 'Beams sweep through drifting fog on a slow beat cycle and flare on every kick.',
    create: (l) => new Searchlights(l),
  },
];

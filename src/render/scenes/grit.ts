/** Grit scenes: heavy, street-level, snares hit hard. */
import { INK, PAPER } from '../../config/dims';
import type { Scene, SceneDef, SceneInput, SongLook } from './types';
import { approach, jagged, sceneRandom } from './util';

const motion = (i: SceneInput): number => (i.dc.calm ? 0.35 : i.dc.motion);

type Roof = 'flat' | 'step' | 'spire' | 'tank';
interface Building {
  x: number;
  w: number;
  h: number;
  row: 0 | 1;
  roof: Roof;
  bar: number;
  /** Per-window random thresholds, rows × cols. */
  win: Float32Array;
  cols: number;
  rows: number;
}

/**
 * A generic city skyline (no real landmarks). Each building's windows light up with its slice of
 * the spectrum; snares flicker them. A halftone sun (bright songs) or crescent moon (dark songs)
 * sits behind, and the whole block drifts slowly sideways.
 */
class Skyline implements Scene {
  private readonly blds: Building[] = [];
  private readonly sunX: number;
  private scroll = 0;
  private flicker = 0;
  private flickSeed = 0;
  private readonly rand: () => number;

  constructor(look: SongLook) {
    const r = sceneRandom(look.seed, 'skyline');
    this.rand = r;
    this.sunX = 0.2 + r() * 0.6;
    const span = 1.25; // generated wider than the screen so it can scroll and wrap
    for (const row of [0, 1] as const) {
      let x = 0;
      while (x < span) {
        const w = row === 0 ? 0.04 + r() * 0.05 : 0.05 + r() * 0.07;
        const h = row === 0 ? 0.26 + r() * 0.26 : 0.14 + r() * 0.22;
        const rv = r();
        const roof: Roof = rv < 0.5 ? 'flat' : rv < 0.72 ? 'step' : rv < 0.86 ? 'spire' : 'tank';
        const cols = Math.max(2, Math.round(w * 52));
        const rows = Math.max(3, Math.round(h * 34));
        const win = new Float32Array(cols * rows).map(() => r());
        this.blds.push({ x, w, h, row, roof, bar: Math.floor(r() * 40), win, cols, rows });
        x += w + (row === 0 ? 0.004 : 0.008) + r() * 0.012;
      }
    }
  }

  draw(i: SceneInput): void {
    const { c, W, H, k, f, D, dt, calm, md, pat, off } = i.dc;
    const bars = i.dc.a.bars;
    const { energy, brightness } = i.look;
    this.scroll = (this.scroll + dt * (0.004 + 0.012 * energy) * motion(i)) % 1.25;
    if (f.snare && !calm) {
      this.flicker = 1;
      this.flickSeed = Math.floor(this.rand() * 1e6);
    }
    this.flicker = approach(this.flicker, 0, dt, 0.12);
    const g = Math.min(1, i.alpha * 2.6);
    if (g <= 0.01) return;

    // Sky: halftone bands getting denser toward the horizon.
    for (let b = 0; b < 5; b++) {
      c.globalAlpha = g * (0.18 + b * 0.08);
      c.fillStyle = pat.dots(D.plates[0], (0.6 + b * 0.45) * k, 8 * k, 45);
      c.fillRect(0, H * (0.3 + b * 0.1), W, H * 0.1);
    }

    // Sun or moon behind the city.
    const sunR = md * 0.17 * (1 + 0.05 * f.pulse);
    const sx = W * this.sunX;
    const sy = H * 0.36;
    c.globalAlpha = g;
    c.beginPath();
    c.arc(sx, sy, sunR, 0, Math.PI * 2);
    c.fillStyle = pat.dots(brightness > 0.55 ? D.plates[2] : D.ray, 3 * k, 7 * k, 15);
    c.fill();
    if (brightness <= 0.55) {
      c.beginPath();
      c.arc(sx + sunR * 0.35, sy - sunR * 0.18, sunR * 0.86, 0, Math.PI * 2);
      c.fillStyle = D.stage;
      c.fill();
    }

    // Buildings, back row first. Drawn twice across the wrap seam.
    const base = H * 1.0;
    for (const row of [0, 1] as const) {
      const body = new Path2D();
      const lit = new Path2D();
      const wx = 6 * k;
      const wy = 8 * k;
      for (const b of this.blds) {
        if (b.row !== row) continue;
        for (const shift of [0, 1.25]) {
          const x0 = (b.x - this.scroll + shift) * W;
          const bw = b.w * W;
          if (x0 > W || x0 + bw < 0) continue;
          const bh = b.h * H * (row === 0 ? 1 : 0.95);
          const top = base - bh;
          body.rect(x0, top, bw, bh);
          if (b.roof === 'step') body.rect(x0 + bw * 0.2, top - bh * 0.08, bw * 0.6, bh * 0.08);
          if (b.roof === 'spire') {
            body.rect(x0 + bw * 0.46, top - bh * 0.22, Math.max(2 * k, bw * 0.08), bh * 0.22);
          }
          if (b.roof === 'tank') {
            body.rect(x0 + bw * 0.2, top - bh * 0.1, bw * 0.3, bh * 0.07);
            body.rect(x0 + bw * 0.24, top - bh * 0.03, 2 * k, bh * 0.03);
            body.rect(x0 + bw * 0.44, top - bh * 0.03, 2 * k, bh * 0.03);
          }
          // Windows: lit when this building's band is loud enough.
          const level = Math.pow(bars[b.bar] ?? 0, 0.7) * (0.55 + 0.45 * energy) + 0.08;
          const gx = bw / b.cols;
          const gy = (bh * 0.92) / b.rows;
          for (let r = 0; r < b.rows; r++) {
            for (let q = 0; q < b.cols; q++) {
              let thr = b.win[r * b.cols + q];
              if (this.flicker > 0.05 && (r * 31 + q * 17 + this.flickSeed) % 7 === 0) thr = 1 - thr;
              if (thr < level) lit.rect(x0 + q * gx + (gx - wx) / 2, top + bh * 0.06 + r * gy + (gy - wy) / 2, wx, wy);
            }
          }
        }
      }
      c.globalAlpha = g * (row === 0 ? 0.75 : 1);
      c.fillStyle = row === 0 ? pat.dots(D.plates[1], 2.2 * k, 6 * k, 75) : INK;
      c.fill(body);
      c.lineWidth = (row === 0 ? 1.2 : 2) * k;
      c.strokeStyle = PAPER;
      c.globalAlpha = g * (row === 0 ? 0.35 : 0.6);
      c.stroke(body);
      c.globalAlpha = Math.min(1, g * 1.35);
      c.fillStyle = row === 0 ? D.plates[0] : D.plates[2];
      c.save();
      c.translate(off * 0.6, 0);
      c.fill(lit);
      c.restore();
    }
    c.globalAlpha = 1;
  }
}

interface Band {
  y: number;
  th: number;
  ang: number;
  plate: number;
  top: number[];
  bot: number[];
  ph: number;
  amp: number;
  tape: number;
}

/** Layered strips of torn paper sliding past each other; snares jolt them, kicks knock the inks loose. */
class TornPaper implements Scene {
  private readonly bands: Band[] = [];
  private shake = 0;
  private dir = 1;
  private clock = 0;
  private readonly rand: () => number;

  constructor(look: SongLook) {
    const r = sceneRandom(look.seed, 'torn');
    this.rand = r;
    const n = 5;
    for (let j = 0; j < n; j++) {
      this.bands.push({
        y: (j + 0.5 + (r() - 0.5) * 0.5) / n,
        th: 0.07 + r() * 0.09,
        ang: (r() - 0.5) * 0.22 + (look.angle - Math.PI / 2) * 0.05,
        plate: j % 3,
        top: jagged(r, 64, 1),
        bot: jagged(r, 64, 1),
        ph: r() * Math.PI * 2,
        amp: 0.02 + r() * 0.05,
        tape: r(),
      });
    }
  }

  draw(i: SceneInput): void {
    const { c, W, H, k, f, D, dt, calm, pat, off } = i.dc;
    if (f.snare && !calm) {
      this.shake = 1;
      this.dir = this.rand() < 0.5 ? -1 : 1;
    }
    this.shake = approach(this.shake, 0, dt, 0.18);
    this.clock += dt * motion(i) * (0.4 + 0.8 * i.look.energy);
    const g = Math.min(1, i.alpha * 2.4);
    if (g <= 0.01) return;
    const L = Math.hypot(W, H);
    for (const b of this.bands) {
      const slide = Math.sin(this.clock * 0.9 + b.ph) * b.amp * W + this.dir * this.shake * 14 * k * (b.plate + 1);
      const th = b.th * H;
      const path = new Path2D();
      const top = new Path2D();
      const n = b.top.length;
      const x0 = -L * 0.6;
      const span = L * 1.2;
      for (let j = 0; j < n; j++) {
        const x = x0 + (span * j) / (n - 1);
        const y = -th / 2 + b.top[j] * th * 0.5;
        if (j) {
          path.lineTo(x, y);
          top.lineTo(x, y);
        } else {
          path.moveTo(x, y);
          top.moveTo(x, y);
        }
      }
      for (let j = n - 1; j >= 0; j--) path.lineTo(x0 + (span * j) / (n - 1), th / 2 + b.bot[j] * th * 0.5);
      path.closePath();
      c.save();
      c.translate(W / 2 + slide, H * b.y);
      c.rotate(b.ang);
      // Loose second ink, knocked further out of register by the kick.
      c.globalAlpha = g * 0.45;
      c.save();
      c.translate(-(off * 1.5 + i.kick * 6 * k), off + i.kick * 4 * k);
      c.fillStyle = D.plates[(b.plate + 1) % 3];
      c.fill(path);
      c.restore();
      c.globalAlpha = g;
      c.fillStyle = pat.dots(D.plates[b.plate], 2.6 * k, 7 * k, 15 + b.plate * 30);
      c.fill(path);
      // The white fibre line of the tear.
      c.lineWidth = 2.5 * k;
      c.strokeStyle = PAPER;
      c.globalAlpha = g * 0.85;
      c.stroke(top);
      // A strip of tape.
      c.globalAlpha = g * 0.5;
      c.fillStyle = PAPER;
      c.save();
      c.translate((b.tape - 0.5) * W * 0.7, 0);
      c.rotate(0.5 - b.tape);
      c.fillRect(-th * 0.35, -th * 0.65, th * 0.7, th * 1.3);
      c.restore();
      c.restore();
    }
    c.globalAlpha = 1;
  }
}

export const GRIT: SceneDef[] = [
  {
    id: 'skyline',
    mood: 'grit',
    name: 'Skyline',
    blurb: 'A generic city whose windows light up with the spectrum and flicker on snares.',
    create: (l) => new Skyline(l),
  },
  {
    id: 'torn',
    mood: 'grit',
    name: 'Torn paper',
    blurb: 'Torn poster strips slide past each other; snares jolt them, kicks knock the inks loose.',
    create: (l) => new TornPaper(l),
  },
];

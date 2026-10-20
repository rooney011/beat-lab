/** Hype scenes: fast, centre-focused, every kick lands visibly. */
import { PAPER } from '../../config/dims';
import type { Scene, SceneDef, SceneInput, SongLook } from './types';
import { approach, beatSeconds, sceneRandom, shuffle } from './util';

const GAIN = 2.4;
const motion = (i: SceneInput): number => (i.dc.calm ? 0.35 : i.dc.motion);

/** Manga speed lines rushing in from the edges toward the burst; kicks make them lunge. */
class SpeedLines implements Scene {
  private readonly ang: Float32Array;
  private readonly len: Float32Array;
  private readonly wid: Float32Array;
  private readonly hot: Uint8Array;
  private rot = 0;
  private lunge = 0;
  private readonly rand: () => number;

  constructor(look: SongLook) {
    const r = sceneRandom(look.seed, 'speed');
    this.rand = r;
    const N = 180;
    this.ang = new Float32Array(N);
    this.len = new Float32Array(N);
    this.wid = new Float32Array(N);
    this.hot = new Uint8Array(N);
    // Shuffle the order so lowering the count thins lines evenly round the circle.
    const order = shuffle(
      Array.from({ length: N }, (_, j) => j),
      r,
    );
    order.forEach((slot, j) => {
      this.ang[j] = ((slot + r() * 0.7) / N) * Math.PI * 2;
      this.len[j] = r();
      this.wid[j] = 0.3 + r() * 1.4;
    });
  }

  draw(i: SceneInput): void {
    const { c, cx, cy, W, H, k, f, D, dt, calm, dim, md, pat, off } = i.dc;
    if (f.beat && !calm) {
      this.lunge = f.strong ? 1 : 0.6;
      for (let j = 0; j < this.hot.length; j++) this.hot[j] = this.rand() < (f.strong ? 0.16 : 0.08) ? 1 : 0;
    }
    this.lunge = approach(this.lunge, 0, dt, 0.16);
    this.rot += dt * 0.025 * motion(i);
    const g = Math.min(1, i.alpha * GAIN);
    if (g <= 0.01) return;
    const far =
      Math.max(Math.hypot(cx, cy), Math.hypot(W - cx, cy), Math.hypot(cx, H - cy), Math.hypot(W - cx, H - cy)) * 1.02;
    const clear = md * (0.3 - 0.08 * this.lunge);
    const count = Math.min(this.ang.length, Math.round(this.ang.length * (0.35 + 0.4 * i.look.energy + 0.08 * dim)));
    const body = new Path2D();
    const hot = new Path2D();
    for (let j = 0; j < count; j++) {
      const a = this.ang[j] + this.rot;
      const reach = (0.12 + 0.62 * this.len[j]) * (1 - 0.45 * this.lunge * this.len[j]);
      const rIn = clear + (far - clear) * reach;
      const w = (1.6 + 4.5 * this.wid[j]) * k * (0.8 + 0.6 * i.look.energy);
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const p = this.hot[j] ? hot : body;
      p.moveTo(cx + ca * rIn, cy + sa * rIn);
      p.lineTo(cx + ca * far - sa * w, cy + sa * far + ca * w);
      p.lineTo(cx + ca * far + sa * w, cy + sa * far - ca * w);
      p.closePath();
    }
    // Misregistered second plate, then the main plate, then the paper-white hot lines.
    c.globalAlpha = g * 0.55;
    c.save();
    c.translate(off * 1.4, -off * 0.6);
    c.fillStyle = pat.dots(D.plates[1], 2.2 * k, 6 * k, 75);
    c.fill(body);
    c.restore();
    c.globalAlpha = g;
    c.fillStyle = pat.dots(D.plates[0], 2.4 * k, 6 * k, 15);
    c.fill(body);
    if (this.lunge > 0.02) {
      c.globalAlpha = Math.min(1, g * 1.5) * this.lunge;
      c.fillStyle = PAPER;
      c.fill(hot);
    }
    c.globalAlpha = 1;
  }
}

interface Frame {
  s: number;
  rot: number;
  plate: number;
}

/** A tunnel of comic panel frames that spawn on the kick and rush past the viewer. */
class PanelTunnel implements Scene {
  private frames: Frame[] = [];
  private sinceSpawn = 0;
  private n = 0;
  private readonly rand: () => number;

  constructor(look: SongLook) {
    this.rand = sceneRandom(look.seed, 'tunnel');
    for (let j = 0; j < 6; j++)
      this.frames.push({ s: 0.08 * Math.pow(1.6, j), rot: (this.rand() - 0.5) * 0.1, plate: j % 3 });
  }

  private spawn(): void {
    this.frames.push({ s: 0.06, rot: (this.rand() - 0.5) * 0.14, plate: this.n++ % 3 });
    this.sinceSpawn = 0;
  }

  draw(i: SceneInput): void {
    const { c, cx, cy, W, H, k, f, D, dt, calm, pat } = i.dc;
    const bps = beatSeconds(i.look.bpm);
    const rate = (Math.log(2) / (2 * bps)) * motion(i) * (0.7 + 0.6 * i.look.energy);
    for (const fr of this.frames) fr.s *= Math.exp(rate * dt * (calm ? 0.5 : 1));
    this.frames = this.frames.filter((fr) => fr.s < 2.8);
    this.sinceSpawn += dt;
    if ((f.beat && !calm && this.sinceSpawn > bps * 0.45) || this.sinceSpawn > bps * 2) this.spawn();
    const g = Math.min(1, i.alpha * GAIN);
    if (g <= 0.01) return;
    const rect = (p: Path2D, fr: Frame): void => {
      const hw = (W * fr.s) / 2;
      const hh = (H * fr.s) / 2;
      const ca = Math.cos(fr.rot);
      const sa = Math.sin(fr.rot);
      const pts: [number, number][] = [
        [-hw, -hh],
        [hw, -hh],
        [hw, hh],
        [-hw, hh],
      ];
      pts.forEach(([x, y], j) => {
        const X = cx + x * ca - y * sa;
        const Y = cy + x * sa + y * ca;
        if (j) p.lineTo(X, Y);
        else p.moveTo(X, Y);
      });
      p.closePath();
    };
    const sorted = [...this.frames].sort((a, b) => b.s - a.s);
    for (let j = 0; j < sorted.length; j++) {
      const outer = sorted[j];
      const inner = sorted[j + 1];
      // Fade in from the vanishing point and out as the frame leaves the screen.
      const fade = Math.min(1, outer.s / 0.3, (2.8 - outer.s) / 0.9);
      // Fill every other gap between frames, so the tunnel reads as alternating panels.
      if (outer.plate !== 1) {
        const band = new Path2D();
        rect(band, outer);
        if (inner) rect(band, inner);
        c.globalAlpha = g * fade * 0.55;
        c.fillStyle = pat.dots(
          D.plates[outer.plate],
          (1.1 + Math.min(1, outer.s) * 1.1) * k,
          8 * k,
          15 + outer.plate * 30,
        );
        c.fill(band, 'evenodd');
      }
      const edge = new Path2D();
      rect(edge, outer);
      c.globalAlpha = g * fade;
      c.lineJoin = 'miter';
      c.lineWidth = Math.max(1.5, 7 * outer.s) * k;
      c.strokeStyle = PAPER;
      c.stroke(edge);
      c.lineWidth = Math.max(0.8, 2.5 * outer.s) * k;
      c.strokeStyle = D.stage;
      c.stroke(edge);
    }
    c.globalAlpha = 1;
  }
}

export const HYPE: SceneDef[] = [
  {
    id: 'speedlines',
    mood: 'hype',
    name: 'Speed lines',
    blurb: 'Manga speed lines rush toward the burst; kicks make them lunge and flash white.',
    create: (l) => new SpeedLines(l),
  },
  {
    id: 'tunnel',
    mood: 'hype',
    name: 'Panel tunnel',
    blurb: 'Comic panel frames spawn on the kick and fly past, doubling in size every two beats.',
    create: (l) => new PanelTunnel(l),
  },
];

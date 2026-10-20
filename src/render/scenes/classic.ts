/**
 * The original five backgrounds, ported to the scene interface unchanged:
 * sunburst rays (no mood yet), chevrons (hype), hazard stripes (grit), ripple rings (dreamy)
 * and the dot matrix (brooding).
 */
import type { Scene, SceneDef, SceneInput, SongLook } from './types';

const speed = (i: SceneInput): number => (i.dc.calm ? 0.35 : i.dc.motion);

class Rays implements Scene {
  private rot = 0;
  private target = 0;
  private n = 12;
  constructor(private readonly look: SongLook) {}
  draw(i: SceneInput): void {
    const { c, cx, cy, W, H, k, f, D, dt, calm, dim, pat } = i.dc;
    if (f.beat && !calm) this.target += (Math.PI / this.n) * 0.5;
    this.target += dt * (calm ? 0.01 : (0.02 + 0.05 * f.intensity) * speed(i));
    this.rot += (this.target - this.rot) * Math.min(1, dt * 10);
    if (i.alpha <= 0.004) return;
    const L = Math.hypot(W, H);
    const n = [12, 14, 18, 24][dim] + this.look.rayExtra;
    const r0 = this.rot + this.look.angle;
    this.n = n;
    c.globalAlpha = Math.min(1, i.alpha);
    c.beginPath();
    for (let j = 0; j < n; j++) {
      const a0 = r0 + (j * Math.PI * 2) / n;
      c.moveTo(cx, cy);
      c.arc(cx, cy, L * 1.1, a0, a0 + Math.PI / n);
      c.closePath();
    }
    c.fillStyle = pat.dots(D.ray, 2.6 * k, 10 * k, 30);
    c.fill();
    c.globalAlpha = 1;
  }
}

class Chevrons implements Scene {
  private off = 0;
  draw(i: SceneInput): void {
    const { c, W, H, k, f, D, dt, calm, md, pat } = i.dc;
    this.off += dt * (14 + 60 * f.intensity) * speed(i) * k + (calm ? 0 : i.kick * 3 * k);
    if (i.alpha <= 0.004) return;
    const h = md * 0.09;
    const amp = h * 0.55;
    const wv = h * 1.2;
    const off = this.off % (h * 2);
    const m = Math.ceil((W + wv * 2) / wv) + 1;
    c.globalAlpha = Math.min(1, i.alpha);
    c.beginPath();
    for (let y0 = -h * 2 + (h * 2 - off); y0 < H + h * 2; y0 += h * 2) {
      for (let j = 0; j < m; j++) {
        const x = -wv + j * wv;
        const y = y0 + (j % 2 ? amp : 0);
        if (j) c.lineTo(x, y);
        else c.moveTo(x, y);
      }
      for (let j = m - 1; j >= 0; j--) c.lineTo(-wv + j * wv, y0 + h + (j % 2 ? amp : 0));
      c.closePath();
    }
    c.fillStyle = pat.dots(D.ray, 2.6 * k, 9 * k, 60);
    c.fill();
    c.globalAlpha = 1;
  }
}

class Stripes implements Scene {
  private off = 0;
  constructor(private readonly look: SongLook) {}
  draw(i: SceneInput): void {
    const { c, cx, cy, W, H, k, f, D, dt, calm, pat } = i.dc;
    this.off += dt * (14 + 60 * f.intensity) * speed(i) * k + (calm ? 0 : i.kick * 3 * k);
    if (i.alpha <= 0.004) return;
    const L = Math.hypot(W, H);
    const bw = L / 16;
    const off = this.off % (bw * 2);
    c.globalAlpha = Math.min(1, i.alpha);
    c.save();
    c.translate(cx, cy);
    c.rotate(-0.6 + this.look.angle * 0.25);
    c.beginPath();
    for (let x = -L - bw * 2 + off; x < L; x += bw * 2) c.rect(x, -L, bw, L * 2);
    c.fillStyle = pat.dots(D.ray, 2.8 * k, 9 * k, 45);
    c.fill();
    c.restore();
    c.globalAlpha = 1;
  }
}

class Ripples implements Scene {
  private ph = 0;
  draw(i: SceneInput): void {
    const { c, cx, cy, W, H, k, f, D, dt, md, pat } = i.dc;
    this.ph += dt * (12 + 46 * f.intensity) * speed(i) * k;
    if (i.alpha <= 0.004) return;
    const s = md * 0.085;
    const maxR = Math.hypot(W, H) * 0.75;
    const ph = this.ph % (s * 2);
    c.globalAlpha = Math.min(1, i.alpha);
    c.beginPath();
    for (let r = ph; r < maxR; r += s * 2) {
      c.moveTo(cx + r + s, cy);
      c.arc(cx, cy, r + s, 0, Math.PI * 2);
      c.moveTo(cx + r, cy);
      c.arc(cx, cy, r, 0, Math.PI * 2, true);
    }
    c.fillStyle = pat.dots(D.ray, 2.6 * k, 9 * k, 15);
    c.fill();
    c.globalAlpha = 1;
  }
}

class DotMatrix implements Scene {
  draw(i: SceneInput): void {
    if (i.alpha <= 0.004) return;
    const { c, cx, cy, W, H, k, D, calm, t } = i.dc;
    const bars = i.dc.a.bars;
    const q = Math.max(16 * k, W / 70);
    const maxD = Math.hypot(W, H) * 0.6;
    c.globalAlpha = Math.min(1, i.alpha * 1.8);
    c.beginPath();
    for (let x = q / 2; x < W; x += q) {
      const v = bars[Math.min(bars.length - 1, Math.floor((x / W) * bars.length))];
      for (let y = q / 2; y < H; y += q) {
        let rip = 0;
        if (!calm) {
          const d = Math.hypot(x - cx, y - cy);
          for (const ring of i.rings) {
            const pp = (t - ring.t0) / 650;
            if (pp < 1) rip += Math.exp(-Math.pow((d - pp * maxD) / (q * 2.5), 2)) * (1 - pp);
          }
        }
        const r = q * 0.42 * Math.min(1, 0.12 + 0.55 * v * (1 - Math.abs(y / H - 0.5)) + 0.6 * rip);
        if (r > 0.6 * k) {
          c.moveTo(x + r, y);
          c.arc(x, y, r, 0, Math.PI * 2);
        }
      }
    }
    c.fillStyle = D.ray;
    c.fill();
    c.globalAlpha = 1;
  }
}

export const CLASSIC: SceneDef[] = [
  {
    id: 'rays',
    mood: null,
    name: 'Sunburst',
    blurb: 'Rotating halftone rays; a half-ray kick on every beat.',
    create: (l) => new Rays(l),
  },
  {
    id: 'chevrons',
    mood: 'hype',
    name: 'Chevrons',
    blurb: 'Zig-zag bands marching down, pushed by every kick.',
    create: () => new Chevrons(),
  },
  {
    id: 'stripes',
    mood: 'grit',
    name: 'Hazard stripes',
    blurb: 'Diagonal warning stripes sliding with the energy.',
    create: (l) => new Stripes(l),
  },
  {
    id: 'rings',
    mood: 'dreamy',
    name: 'Ripple rings',
    blurb: 'Concentric halftone rings drifting outward.',
    create: () => new Ripples(),
  },
  {
    id: 'grid',
    mood: 'brooding',
    name: 'Dot matrix',
    blurb: 'A dot field that swells with the spectrum and ripples with each beat.',
    create: () => new DotMatrix(),
  },
];

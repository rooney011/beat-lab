import type { BgStyle } from '../../types';
import type { DrawContext } from '../context';
import type { Ring } from './rings';

export interface BgSeed {
  angle: number;
  rayExtra: number;
}

/**
 * Halftone backgrounds, one per mood: sunburst rays (no mood yet), chevrons (hype), hazard
 * stripes (grit), ripple rings (dreamy) and a dot matrix (brooding). Style changes crossfade over 1.2 s.
 */
export class Background {
  private style: BgStyle = 'rays';
  private from: BgStyle | null = null;
  private fadeT = 0;
  private rayRot = 0;
  private rayTarget = 0;
  private stripeOff = 0;
  private ringPh = 0;
  rayCount = 12;

  setStyle(style: BgStyle, t: number): void {
    if (style === this.style) return;
    this.from = this.style;
    this.fadeT = t;
    this.style = style;
  }

  /** Kick the sunburst round by half a ray. */
  kick(): void {
    this.rayTarget += (Math.PI / (this.rayCount || 12)) * 0.5;
  }

  draw(dc: DrawContext, opts: { kick: number; alpha: number; seed: BgSeed; rings: readonly Ring[] }): void {
    const { dt, calm, f, k, t } = dc;
    const sp = calm ? 0.35 : dc.motion;
    this.rayTarget += dt * (calm ? 0.01 : (0.02 + 0.05 * f.intensity) * sp);
    this.rayRot += (this.rayTarget - this.rayRot) * Math.min(1, dt * 10);
    this.stripeOff += dt * (14 + 60 * f.intensity) * sp * k + (calm ? 0 : opts.kick * 3 * k);
    this.ringPh += dt * (12 + 46 * f.intensity) * sp * k;
    const base = [0.14, 0.22, 0.24, 0.18][dc.dim] * (0.75 + 0.5 * f.pulse) * opts.alpha;
    let p = 1;
    if (this.from) {
      p = Math.min(1, (t - this.fadeT) / 1200);
      if (p >= 1) this.from = null;
    }
    if (this.from) this.drawOne(this.from, dc, base * (1 - p), opts);
    this.drawOne(this.style, dc, base * p, opts);
  }

  private drawOne(style: BgStyle, dc: DrawContext, a: number, opts: { seed: BgSeed; rings: readonly Ring[] }): void {
    if (a <= 0.004) return;
    const { c, cx, cy, W, H, k, D, md, pat, calm, t } = dc;
    const P = opts.seed;
    const L = Math.hypot(W, H);
    c.globalAlpha = Math.min(1, a);
    if (style === 'stripes') {
      const bw = L / 16;
      const off = this.stripeOff % (bw * 2);
      c.save();
      c.translate(cx, cy);
      c.rotate(-0.6 + P.angle * 0.25);
      c.beginPath();
      for (let x = -L - bw * 2 + off; x < L; x += bw * 2) c.rect(x, -L, bw, L * 2);
      c.fillStyle = pat.dots(D.ray, 2.8 * k, 9 * k, 45);
      c.fill();
      c.restore();
    } else if (style === 'rings') {
      const s = md * 0.085;
      const maxR = L * 0.75;
      const ph = this.ringPh % (s * 2);
      c.beginPath();
      for (let r = ph; r < maxR; r += s * 2) {
        c.moveTo(cx + r + s, cy);
        c.arc(cx, cy, r + s, 0, Math.PI * 2);
        c.moveTo(cx + r, cy);
        c.arc(cx, cy, r, 0, Math.PI * 2, true);
      }
      c.fillStyle = pat.dots(D.ray, 2.6 * k, 9 * k, 15);
      c.fill();
    } else if (style === 'grid') {
      const q = Math.max(16 * k, W / 70);
      const maxD = L * 0.6;
      const bars = dc.a.bars;
      c.globalAlpha = Math.min(1, a * 1.8);
      c.beginPath();
      for (let x = q / 2; x < W; x += q) {
        const v = bars[Math.min(bars.length - 1, Math.floor((x / W) * bars.length))];
        for (let y = q / 2; y < H; y += q) {
          let rip = 0;
          if (!calm) {
            const d = Math.hypot(x - cx, y - cy);
            for (const ring of opts.rings) {
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
    } else if (style === 'chevrons') {
      const h = md * 0.09;
      const amp = h * 0.55;
      const wv = h * 1.2;
      const off = this.stripeOff % (h * 2);
      const m = Math.ceil((W + wv * 2) / wv) + 1;
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
    } else {
      const n = [12, 14, 18, 24][dc.dim] + P.rayExtra;
      const big = L * 1.1;
      const r0 = this.rayRot + P.angle;
      this.rayCount = n;
      c.beginPath();
      for (let i = 0; i < n; i++) {
        const a0 = r0 + (i * Math.PI * 2) / n;
        c.moveTo(cx, cy);
        c.arc(cx, cy, big, a0, a0 + Math.PI / n);
        c.closePath();
      }
      c.fillStyle = pat.dots(D.ray, 2.6 * k, 10 * k, 30);
      c.fill();
    }
    c.globalAlpha = 1;
  }
}

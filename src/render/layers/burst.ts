import { PAPER } from '../../config/dims';
import type { DrawContext } from '../context';

/**
 * The centre burst: a spiky star whose points follow the spectrum, printed in two offset halftone
 * plates, with a core disc whose dot size follows the low bands.
 */
export class Burst {
  private rot = Math.random() * Math.PI;

  draw(dc: DrawContext): void {
    const { c, cx, cy, R, D, k, off, mob, dose, calm, f, dt, pat, jit } = dc;
    const bars = dc.a.bars;
    this.rot += dt * (0.05 + 0.15 * f.intensity) * (calm ? 0.5 : dc.motion);
    const M = mob ? 20 : 24;
    const amp = calm ? 0.25 : 0.35 + 0.45 * dose;
    const p = new Path2D();
    for (let j = 0; j < M; j++) {
      const idx = j < M / 2 ? j : M - 1 - j;
      const v = bars[Math.min(bars.length - 1, Math.floor((idx / (M / 2)) * bars.length * 0.7))];
      const a = this.rot + (j / M) * Math.PI * 2;
      const ai = a + Math.PI / M;
      const ro = R * (j % 2 === 0 ? 1.12 + v * amp : 0.98 + v * amp * 0.6) * (1 + 0.04 * jit[j % 40]);
      const ri = R * (0.74 + 0.03 * jit[(j + 9) % 40]);
      const x1 = cx + Math.cos(a) * ro;
      const y1 = cy + Math.sin(a) * ro;
      if (j) p.lineTo(x1, y1);
      else p.moveTo(x1, y1);
      p.lineTo(cx + Math.cos(ai) * ri, cy + Math.sin(ai) * ri);
    }
    p.closePath();
    const core = new Path2D();
    core.arc(cx, cy, R * 0.5 * (1 + 0.18 * f.bands[1]), 0, Math.PI * 2);
    c.globalCompositeOperation = 'screen';
    c.save();
    c.translate(off * 0.9, off * 0.5);
    c.fillStyle = pat.dots(D.plates[1], 2.8 * k, 8 * k, 45);
    c.fill(p);
    c.restore();
    c.fillStyle = pat.dots(D.plates[0], (1.6 + f.pulse * 2.6) * k, 7 * k, 15);
    c.fill(p);
    c.save();
    c.translate(-off * 0.5, -off * 0.8);
    c.fillStyle = pat.dots(D.plates[2], (1.2 + f.bands[2] * 2.4) * k, 6 * k, 75);
    c.fill(core);
    c.restore();
    c.globalCompositeOperation = 'source-over';
    c.lineJoin = 'miter';
    c.lineWidth = 3 * k;
    c.strokeStyle = PAPER;
    c.stroke(p);
    c.lineWidth = 2 * k;
    c.stroke(core);
  }
}

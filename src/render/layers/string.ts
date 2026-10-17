import { PAPER } from '../../config/dims';
import type { DrawContext } from '../context';

/** Vertical position of the string as a fraction of stage height (dancers stand on it). */
export const stringY = (mob: boolean): number => (mob ? 0.52 : 0.66);

/** The plucked string across the stage, printed in two offset plates plus a paper key line. */
export function drawString(dc: DrawContext, envelope: Float32Array): void {
  const { c, W, H, k, D, off, mob, dose, jit } = dc;
  const w = dc.a.wave;
  const n = w.length;
  const y0 = H * stringY(mob);
  const amp = H * (mob ? 0.07 : 0.13) * (0.6 + dose * 0.6);
  const p = new Path2D();
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * W;
    const y = y0 + w[i] * amp + jit[i % 40] * 0.8 * k * envelope[i];
    if (i) p.lineTo(x, y);
    else p.moveTo(x, y);
  }
  const ink = D.id === 'inkfall';
  const st = D.id === 'static';
  const lw = (ink ? 7 : 5) * k;
  c.lineJoin = 'round';
  c.lineCap = 'round';
  c.globalCompositeOperation = 'screen';
  c.globalAlpha = 0.75;
  c.save();
  c.translate(-off, off * 0.5);
  c.lineWidth = lw;
  c.strokeStyle = st ? '#FF2E93' : D.plates[1];
  c.stroke(p);
  c.restore();
  c.save();
  c.translate(off, -off * 0.3);
  c.lineWidth = lw;
  c.strokeStyle = st ? '#3EE6FF' : D.plates[0];
  c.stroke(p);
  c.restore();
  c.globalCompositeOperation = 'source-over';
  c.globalAlpha = 1;
  c.lineWidth = 2 * k;
  c.strokeStyle = PAPER;
  c.stroke(p);
  c.lineCap = 'butt';
  c.lineJoin = 'miter';
}

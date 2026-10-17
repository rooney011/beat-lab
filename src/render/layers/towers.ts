import { PAPER } from '../../config/dims';
import type { DrawContext } from '../context';

/** Spectrum "towers" along the bottom (and a ceiling mirror from Pressline up on desktop). */
export function drawTowers(dc: DrawContext, heightScale: number): void {
  const { c, W, H, k, D, off, mob, dim, pat } = dc;
  const { bars, peaks } = dc.a;
  const n = mob ? 24 : 48;
  const step = mob ? 2 : 1;
  const segs = D.id === 'static';
  const x0 = W * 0.03;
  const span = W * 0.94;
  const gap = (mob ? 4 : 3) * k;
  const bw = span / n - gap;
  const base = H * (mob ? 0.79 : 0.985);
  const maxH = H * (mob ? 0.15 : 0.3) * heightScale;
  const ceiling = dim >= 2 && !mob;
  const path = new Path2D();
  const caps = new Path2D();
  const top = new Path2D();
  for (let i = 0; i < n; i++) {
    const v = bars[i * step];
    const h = Math.max(2 * k, v * maxH);
    const x = x0 + i * (bw + gap);
    if (segs) {
      const sh = 6 * k;
      const sg = 3 * k;
      for (let y = base - sh; y > base - h - sh; y -= sh + sg) path.rect(x, y, bw, sh);
    } else path.rect(x, base - h, bw, h);
    caps.rect(x, base - peaks[i * step] * maxH - 7 * k, bw, 3 * k);
    if (ceiling) top.rect(x, H * 0.015, bw, Math.max(1, v * maxH * 0.45));
  }
  c.globalCompositeOperation = 'screen';
  c.save();
  c.translate(off, -off * 0.5);
  c.fillStyle = pat.dots(D.plates[1], 2.6 * k, 7 * k, 45);
  c.fill(path);
  c.restore();
  c.fillStyle = pat.dots(D.plates[0], 3 * k, 7 * k, 15);
  c.fill(path);
  if (ceiling) {
    c.globalAlpha = 0.55;
    c.fill(top);
    c.globalAlpha = 1;
  }
  c.globalCompositeOperation = 'source-over';
  c.lineWidth = 1.5 * k;
  c.strokeStyle = PAPER;
  c.stroke(path);
  c.fillStyle = D.id === 'inkfall' ? '#FF3B2F' : PAPER;
  c.fill(caps);
}

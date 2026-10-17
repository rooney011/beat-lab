import { PAPER } from '../../config/dims';
import type { DrawContext } from '../context';
import { FONT_DISPLAY } from '../fonts';

/** The giant outlined word behind everything: the demo's section, the song's mood, or the dimension name. */
export class GiantWord {
  private cache = { text: '', size: 0, W: 0, t: -9999 };

  draw(dc: DrawContext, word: string, alpha: number): void {
    const { c, t, W, H, k, f, D, off } = dc;
    const wc = this.cache;
    if (word !== wc.text || W !== wc.W || t - wc.t > 2000) {
      let size = H * 0.4;
      c.font = `${size}px ${FONT_DISPLAY}`;
      const w = c.measureText(word).width;
      if (w > W * 0.92) size *= (W * 0.92) / w;
      this.cache = { text: word, size, W, t };
    }
    c.save();
    c.font = `${this.cache.size}px ${FONT_DISPLAY}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    const s = 1 + f.pulse * 0.06;
    c.translate(W / 2, H * 0.48);
    c.scale(s, s);
    c.lineJoin = 'miter';
    c.lineWidth = 3 * k;
    c.globalAlpha = 0.22 * alpha;
    c.strokeStyle = D.plates[1];
    c.strokeText(word, -off * 1.4, off);
    c.globalAlpha = 0.2 * alpha;
    c.strokeStyle = PAPER;
    c.strokeText(word, 0, 0);
    c.restore();
    c.globalAlpha = 1;
  }

  /** Force a re-measure (fonts finished loading). */
  invalidate(): void {
    this.cache.t = -9999;
  }
}

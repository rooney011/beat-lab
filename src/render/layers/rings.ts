import type { DrawContext } from '../context';

export interface Ring {
  t0: number;
  strong: boolean;
}

/** Halftone shock rings pushed out from the burst on every beat (650 ms life, max 6). */
export class Rings {
  readonly list: Ring[] = [];

  spawn(t: number, strong: boolean): void {
    if (this.list.length >= 6) this.list.shift();
    this.list.push({ t0: t, strong });
  }

  draw(dc: DrawContext): void {
    const { c, t, cx, cy, R, D, k, pat } = dc;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const r = this.list[i];
      const p = (t - r.t0) / 650;
      if (p >= 1) {
        this.list.splice(i, 1);
        continue;
      }
      c.globalAlpha = 1 - p * 0.8;
      c.lineWidth = (r.strong ? 18 : 10) * k * (1 - p * 0.85);
      c.strokeStyle = pat.dots(r.strong ? D.plates[0] : D.plates[2], 2.8 * k, 7 * k, 20);
      c.beginPath();
      c.arc(cx, cy, R * (1.15 + p * (r.strong ? 3.6 : 2.6)), 0, Math.PI * 2);
      c.stroke();
    }
    c.globalAlpha = 1;
  }
}

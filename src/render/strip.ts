import type { Dim } from '../config/dims';
import { INK, PAPER } from '../config/dims';

/** The eight-band level strip on the stage edge, with a beat LED. Vertical on desktop, horizontal otherwise. */
export class BandStrip {
  private sized = '';

  constructor(private readonly canvas: HTMLCanvasElement) {}

  draw(bands: Float32Array, D: Dim, horizontal: boolean, paused: boolean, beatLit: boolean): void {
    const c = this.canvas;
    const cw = horizontal ? 252 : 16;
    const ch = horizontal ? 16 : 252;
    const k = Math.min(window.devicePixelRatio || 1, 2);
    const key = `${cw}x${ch}@${k}`;
    if (this.sized !== key) {
      c.width = Math.round(cw * k);
      c.height = Math.round(ch * k);
      this.sized = key;
    }
    const x = c.getContext('2d');
    if (!x) return;
    x.setTransform(k, 0, 0, k, 0, 0);
    x.clearRect(0, 0, cw, ch);
    x.lineWidth = 1;
    x.strokeStyle = PAPER;
    for (let i = 0; i < 8; i++) {
      const v = Math.max(0, Math.min(1, bands[i]));
      const col = paused ? '#5B5568' : D.plates[i % 3];
      if (!horizontal) {
        const y = ch - (i + 1) * 28 + 4;
        x.fillStyle = INK;
        x.fillRect(0.5, y + 0.5, 15, 23);
        x.fillStyle = col;
        const hh = 23 * v;
        x.fillRect(0.5, y + 0.5 + 23 - hh, 15, hh);
        x.strokeRect(0.5, y + 0.5, 15, 23);
      } else {
        const xx = i * 28;
        x.fillStyle = INK;
        x.fillRect(xx + 0.5, 0.5, 23, 15);
        x.fillStyle = col;
        x.fillRect(xx + 0.5, 0.5, 23 * v, 15);
        x.strokeRect(xx + 0.5, 0.5, 23, 15);
      }
    }
    const bx = horizontal ? 232 : 8;
    x.beginPath();
    x.arc(bx, 8, 7, 0, Math.PI * 2);
    x.fillStyle = beatLit && !paused ? D.accent : '#1E1B27';
    x.fill();
    x.stroke();
  }
}

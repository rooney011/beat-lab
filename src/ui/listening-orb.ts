import { GlobeBuffer, fillGlobe, layoutGlobe, ringBar } from '../render/scenes/globe';

const RINGS = 6;

/**
 * A tiny listening globe for the "Reading mood" chip: the same dotted sphere as the background
 * scene, small enough to sit next to text. The caller drives it from its frame loop, so it never
 * runs a loop of its own; it draws nothing while it's not in the document.
 */
export class ListeningOrb {
  readonly el: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly buf = new GlobeBuffer(160);
  private readonly levels = new Float32Array(RINGS + 1);
  private yaw = 0.6;
  private wave = 0;
  private last = 0;

  /** size: CSS pixels. */
  constructor(size = 14) {
    const dpr = Math.min(2, (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1);
    this.el = document.createElement('canvas');
    this.el.width = this.el.height = Math.round(size * dpr);
    this.el.style.width = this.el.style.height = `${size}px`;
    this.el.className = 'listening-orb';
    // The chip's text already says what's happening.
    this.el.setAttribute('aria-hidden', 'true');
    this.ctx = this.el.getContext('2d');
  }

  /**
   * Draw one frame. bars: the 48 spectrum bars, or null when there's no audio.
   * still: reduced motion; draws a static globe.
   */
  draw(t: number, bars: ArrayLike<number> | null, color: string, still = false): void {
    const c = this.ctx;
    if (!c || !this.el.isConnected) return;
    const dt = this.last ? Math.min(0.1, Math.max(0, (t - this.last) / 1000)) : 0;
    this.last = t;
    if (!still) {
      this.yaw += dt * 1.6;
      this.wave += dt * 3;
      for (let ri = 0; ri <= RINGS; ri++) {
        const target = bars ? Math.pow(ringBar(ri, RINGS, bars), 0.85) : 0;
        this.levels[ri] += (target - this.levels[ri]) * Math.min(1, dt * (target > this.levels[ri] ? 25 : 6));
      }
    }
    const s = this.el.width;
    const R = s * 0.38;
    layoutGlobe(
      {
        cx: s / 2,
        cy: s / 2,
        R,
        rings: RINGS,
        density: RINGS * 2,
        yaw: this.yaw,
        tilt: 0.4,
        dot: ((Math.PI * R) / RINGS) * 0.26,
        levels: still ? null : this.levels,
        swell: 0.24,
        wave: still ? 0 : this.wave,
        scan: Number.NaN,
      },
      this.buf,
    );
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalAlpha = 1;
    c.clearRect(0, 0, s, s);
    fillGlobe(c, this.buf, [color, color, color, color, color, color], [0.22, 0.42, 0.75, 1, 1, 1]);
    c.globalAlpha = 1;
  }
}

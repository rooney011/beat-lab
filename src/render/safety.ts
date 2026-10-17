/**
 * Photosensitivity guards.
 *
 * 1. Flash budget: full-frame flashes (panel-cut flash, inverted panels) are rationed to 3 per
 *    second, or 1 in strict mode. The budget cannot be switched off.
 * 2. Luminance clamp: every other frame the stage is shrunk to 32×18 and its mean luminance
 *    measured; six swings of ≥ 10% within one second dim the stage for 2 s.
 */
export class FlashBudget {
  private log: number[] = [];

  /** Spend one flash if the budget allows it. */
  take(t: number, strict: boolean): boolean {
    const budget = strict ? 1 : 3;
    this.log = this.log.filter((x) => t - x < 1000);
    if (this.log.length < budget) {
      this.log.push(t);
      return true;
    }
    return false;
  }

  /** Flashes spent in the last second. */
  count(t: number): number {
    return this.log.filter((x) => t - x < 1000).length;
  }
}

export class LuminanceClamp {
  private readonly probe: HTMLCanvasElement;
  private readonly px: CanvasRenderingContext2D | null;
  private log: number[] = [];
  private prev: number | null = null;
  private frame = 0;
  clampUntil = 0;
  clamps = 0;

  constructor() {
    this.probe = document.createElement('canvas');
    this.probe.width = 32;
    this.probe.height = 18;
    this.px = this.probe.getContext('2d', { willReadFrequently: true });
  }

  /** True while the stage must be dimmed. */
  active(t: number): boolean {
    return t < this.clampUntil;
  }

  /** Measure the finished frame (call after drawing). */
  measure(source: HTMLCanvasElement, t: number): void {
    if (this.active(t)) {
      this.prev = null;
      return;
    }
    this.frame = (this.frame + 1) % 2;
    if (this.frame !== 0 || !this.px) return;
    try {
      this.px.drawImage(source, 0, 0, 32, 18);
      const d = this.px.getImageData(0, 0, 32, 18).data;
      let s = 0;
      for (let i = 0; i < d.length; i += 4) s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      const L = s / (576 * 255);
      if (this.prev !== null && Math.abs(L - this.prev) >= 0.1) this.log.push(t);
      this.prev = L;
      this.log = this.log.filter((x) => t - x < 1000);
      if (this.log.length >= 6) {
        this.clampUntil = t + 2000;
        this.clamps++;
        this.log = [];
      }
    } catch {}
  }
}

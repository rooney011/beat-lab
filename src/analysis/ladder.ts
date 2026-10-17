import { DIMS } from '../config/dims';
import type { Features } from '../types';

export interface Wipe {
  t0: number;
  to: number;
  swapped: boolean;
}

export interface LadderInput {
  playing: boolean;
  live: boolean;
  auto: boolean;
  /** Mood offset added to every threshold. */
  moodTh: number;
}

/**
 * Decides which dimension is on stage. In AUTO it climbs when intensity holds above the next
 * threshold (4 beats, or 2 s with no beats) and falls after 3 s below the current one; a change
 * is queued and lands on the next strong beat (or after 1.5 s). Changes are at least 6 s apart.
 */
export class DimensionDirector {
  /** Dimension currently drawn (changes halfway through a wipe). */
  now = 0;
  wipe: Wipe | null = null;
  pending: number | null = null;
  private pendT = 0;
  lastShift = -9999;
  private upHold = 0;
  private upBeats = 0;
  private dnHold = 0;

  constructor(
    /** Called when a change is queued (-1 = none) and when a wipe lands. */
    private readonly onQueue: (to: number) => void,
    private readonly onApply: (dim: number) => void,
  ) {}

  /** Jump straight to a dimension with no wipe (new song, cover exit). */
  reset(dim: number, t: number): void {
    this.now = dim;
    this.wipe = null;
    this.pending = null;
    this.lastShift = t;
    this.onApply(dim);
  }

  /** Manual pick: wipe to it now. */
  pick(dim: number, t: number): void {
    this.pending = null;
    this.onQueue(-1);
    if (dim !== this.now || this.wipe) this.shiftTo(dim, t);
  }

  private shiftTo(to: number, t: number): void {
    this.lastShift = t;
    this.wipe = { t0: t, to, swapped: false };
  }

  update(f: Features, t: number, dt: number, input: LadderInput): void {
    if (!input.playing || !input.live) {
      this.upHold = 0;
      this.upBeats = 0;
      this.dnHold = 0;
      return;
    }
    if (this.wipe) return;
    if (this.pending !== null) {
      if (f.strong || t - this.pendT > 1500) {
        const to = this.pending;
        this.pending = null;
        this.shiftTo(to, t);
      }
      return;
    }
    if (!input.auto || t - this.lastShift < 6000) return;
    const cur = this.now;
    const I = f.intensity;
    const mo = input.moodTh;
    if (cur < 3 && I > DIMS[cur + 1].th + mo) {
      this.upHold += dt;
      if (f.beat) this.upBeats++;
    } else {
      this.upHold = 0;
      this.upBeats = 0;
    }
    if (cur > 0 && I < DIMS[cur].th + mo - 0.06) this.dnHold += dt;
    else this.dnHold = 0;
    let to = -1;
    if (this.upBeats >= 4 || (this.upHold >= 2 && this.upBeats === 0)) to = cur + 1;
    else if (this.dnHold >= 3) to = cur - 1;
    if (to >= 0) {
      this.pending = to;
      this.pendT = t;
      this.upHold = 0;
      this.upBeats = 0;
      this.dnHold = 0;
      this.onQueue(to);
    }
  }

  /** Advance the wipe; returns its progress 0..1 and target, or null when idle. Swaps dimension at 50%. */
  advanceWipe(t: number, durationMs: number): { p: number; to: number } | null {
    const w = this.wipe;
    if (!w) return null;
    const p = (t - w.t0) / durationMs;
    if (p >= 0.5 && !w.swapped) {
      w.swapped = true;
      this.now = w.to;
      this.onApply(w.to);
    }
    if (p >= 1) {
      this.wipe = null;
      return null;
    }
    return { p, to: w.to };
  }
}

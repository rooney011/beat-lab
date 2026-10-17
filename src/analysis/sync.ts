import type { Analysis, Features } from '../types';

interface Snapshot {
  t: number;
  id: number;
  f: Features;
  bars: Float32Array;
  peaks: Float32Array;
  wave: Float32Array;
}

/** The visuals already trail the audio by about this much (onset detection plus one display frame). */
export const BUILT_IN_LAG_MS = 40;
export const MAX_DELAY_MS = 400;

/** Suggested delay from the output latency the browser reports, rounded to 10 ms. */
export function autoDelay(outputLatencyMs: number): number {
  return Math.max(0, Math.min(MAX_DELAY_MS, Math.round((outputLatencyMs - BUILT_IN_LAG_MS) / 10) * 10));
}

const copyInto = (dst: Float32Array | undefined, src: Float32Array): Float32Array => {
  if (!dst || dst.length !== src.length) return Float32Array.from(src);
  dst.set(src);
  return dst;
};

/**
 * A delay line for analysis frames, so the picture can be held back to match audio output latency
 * (Bluetooth headphones are often 150–250 ms late).
 *
 * Every frame stores a snapshot; the renderer gets the newest one that is at least `delayMs` old.
 * Beat, snare and spark flags from snapshots skipped over are merged in, so no hit is ever lost.
 * Snapshot buffers are recycled, so steady state allocates nothing.
 */
export class SyncDelay {
  private ring: Snapshot[] = [];
  private pool: Snapshot[] = [];
  private nextId = 1;
  private lastId = 0;
  private readonly out: Features = {
    beat: false,
    strong: false,
    snare: false,
    replaced: false,
    spark: 0,
    pulse: 0,
    mids: 0,
    highs: 0,
    intensity: 0,
    db: -90,
    silent: false,
    bands: new Float32Array(8),
  };

  apply(live: Analysis, t: number, delayMs: number): Analysis {
    if (delayMs <= 0) {
      if (this.ring.length) {
        this.pool.push(...this.ring);
        this.ring = [];
      }
      return live;
    }
    const ring = this.ring;
    const r: Snapshot =
      this.pool.pop() ??
      ({
        f: { ...live.f, bands: new Float32Array(8) },
        bars: new Float32Array(0),
        peaks: new Float32Array(0),
        wave: new Float32Array(0),
      } as Snapshot);
    r.t = t;
    r.id = this.nextId++;
    const bands = copyInto(r.f.bands, live.f.bands);
    Object.assign(r.f, live.f);
    r.f.bands = bands;
    r.bars = copyInto(r.bars, live.bars);
    r.peaks = copyInto(r.peaks, live.peaks);
    r.wave = copyInto(r.wave, live.wave);
    ring.push(r);

    let pi = 0;
    for (let i = ring.length - 1; i >= 0; i--) {
      if (ring[i].t <= t - delayMs) {
        pi = i;
        break;
      }
    }
    const pick = ring[pi];
    const from = this.lastId;
    const f = this.out;
    Object.assign(f, pick.f);
    f.beat = false;
    f.strong = false;
    f.snare = false;
    f.replaced = false;
    f.spark = 0;
    for (let i = 0; i <= pi; i++) {
      const q = ring[i];
      if (q.id <= from) continue;
      f.beat ||= q.f.beat;
      f.strong ||= q.f.strong;
      f.snare ||= q.f.snare;
      f.spark = Math.max(f.spark, q.f.spark);
    }
    this.lastId = Math.max(from, pick.id);
    for (let i = 0; i < pi; i++) this.pool.push(ring.shift() as Snapshot);
    while (ring.length > 400) this.pool.push(ring.shift() as Snapshot);
    return { f, bars: pick.bars, peaks: pick.peaks, wave: pick.wave };
  }

  /** Frames currently buffered (for diagnostics and tests). */
  get buffered(): number {
    return this.ring.length;
  }
}

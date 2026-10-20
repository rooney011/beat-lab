import { hash, seededRandom } from '../../util/rand';
import type { CoverPalette } from './palette';
import type { SongLook } from './types';
import { approach } from './util';

/** A neutral look for a new song, before the mood is read. */
export function newLook(key: string): SongLook {
  const seed = hash(key);
  const r = seededRandom(seed);
  r(); // keep the same sequence as the old profile: swap, angle, rayExtra
  return {
    key,
    seed,
    energy: 0.5,
    brightness: 0.5,
    bpm: 0,
    angle: r() * Math.PI,
    rayExtra: Math.floor(r() * 3) * 2,
    palette: null,
  };
}

/**
 * Keeps a SongLook current: mood reads set targets, and energy/brightness glide there over ~2 s
 * so a late AI result never makes the background jump.
 */
export class LookTracker {
  look: SongLook;
  private target = { energy: 0.5, brightness: 0.5 };

  constructor(key = 'idle') {
    this.look = newLook(key);
  }

  /** New song or input. */
  reset(key: string): SongLook {
    this.look = newLook(key);
    this.target = { energy: 0.5, brightness: 0.5 };
    return this.look;
  }

  /** A mood read arrived (rule-based or AI): arousal → energy, valence → brightness. */
  setMood(arousal: number, valence: number, bpm: number): void {
    this.target = { energy: Math.max(0, Math.min(1, arousal)), brightness: Math.max(0, Math.min(1, valence)) };
    if (bpm > 0) this.look.bpm = bpm;
  }

  setPalette(p: CoverPalette | null): void {
    this.look.palette = p;
  }

  /** Call once per frame. */
  update(dt: number): void {
    this.look.energy = approach(this.look.energy, this.target.energy, dt, 0.7);
    this.look.brightness = approach(this.look.brightness, this.target.brightness, dt, 0.7);
  }
}

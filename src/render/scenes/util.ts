import { seededRandom } from '../../util/rand';

/** A seeded random stream for one scene of one song (salted so scenes don't share layouts). */
export const sceneRandom = (seed: number, salt: string): (() => number) => {
  let h = seed >>> 0;
  for (let i = 0; i < salt.length; i++) h = Math.imul(h ^ salt.charCodeAt(i), 2654435761) >>> 0;
  return seededRandom(h || 1);
};

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Seconds per beat at the song's tempo (120 BPM when unknown). */
export const beatSeconds = (bpm: number): number => 60 / (bpm > 40 ? bpm : 120);

/** Jagged edge: n points of 0..1 offsets, smoothed a little so tears look torn, not noisy. */
export function jagged(rand: () => number, n: number, roughness = 1): number[] {
  const raw = Array.from({ length: n }, () => (rand() - 0.5) * roughness);
  return raw.map((v, i) => (raw[Math.max(0, i - 1)] + v * 2 + raw[Math.min(n - 1, i + 1)]) / 4);
}

/** Four-point star (spark/twinkle) path. */
export function star4(c: CanvasRenderingContext2D | Path2D, x: number, y: number, s: number): void {
  c.moveTo(x, y - s);
  c.lineTo(x + s * 0.24, y - s * 0.24);
  c.lineTo(x + s, y);
  c.lineTo(x + s * 0.24, y + s * 0.24);
  c.lineTo(x, y + s);
  c.lineTo(x - s * 0.24, y + s * 0.24);
  c.lineTo(x - s, y);
  c.lineTo(x - s * 0.24, y - s * 0.24);
  c.closePath();
}

/** Exponential ease toward a target, frame-rate independent. */
export const approach = (cur: number, target: number, dt: number, seconds: number): number =>
  cur + (target - cur) * (1 - Math.exp(-dt / Math.max(1e-3, seconds)));

/** Fisher–Yates shuffle with a seeded stream (same order in every browser). */
export function shuffle<T>(list: readonly T[], rand: () => number): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

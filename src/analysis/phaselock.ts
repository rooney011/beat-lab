/**
 * Phase-locking a beat-matched transition (docs/ROADMAP.md §4.1). `play()` timing isn't sample-exact,
 * so for the first few bars we measure how far B's beats sit from A's and nudge B's playback rate by
 * up to ±0.5% to pull them into line. Pure maths so the convergence is unit-tested.
 */

/** Largest rate nudge, ±0.5%. */
export const MAX_NUDGE = 0.005;
/** Proportional gain: saturates the nudge at ~25 ms of error. */
const GAIN = 0.0002;

/** Wrap a phase error into ±half a beat period (ms). */
export function wrapPhaseMs(errorMs: number, periodMs: number): number {
  if (periodMs <= 0) return errorMs;
  const half = periodMs / 2;
  let e = errorMs % periodMs;
  if (e > half) e -= periodMs;
  if (e < -half) e += periodMs;
  return e;
}

function nearest(grid: Float32Array, t: number): number | null {
  if (!grid.length) return null;
  let best = grid[0];
  let bestD = Math.abs(grid[0] - t);
  for (let i = 1; i < grid.length; i++) {
    const d = Math.abs(grid[i] - t);
    if (d < bestD) {
      bestD = d;
      best = grid[i];
    } else if (grid[i] > t) {
      break; // grids are sorted; distance only grows past the probe
    }
  }
  return best;
}

function localPeriodMs(grid: Float32Array, t: number): number {
  if (grid.length < 2) return 500;
  let i = 0;
  while (i < grid.length - 1 && grid[i + 1] < t) i++;
  return (grid[Math.min(i + 1, grid.length - 1)] - grid[Math.max(0, i)]) * 1000 || 500;
}

/**
 * Phase error in ms between B's nearest beat and A's nearest beat around `probeSec`, wrapped to
 * ±half a beat. Positive means B is late (its beat falls after A's) — speed B up to correct.
 */
export function phaseErrorMs(aGrid: Float32Array, bGrid: Float32Array, probeSec: number): number {
  const na = nearest(aGrid, probeSec);
  const nb = nearest(bGrid, probeSec);
  if (na === null || nb === null) return 0;
  return wrapPhaseMs((nb - na) * 1000, localPeriodMs(aGrid, probeSec));
}

/** Nudge B's rate to pull its beats onto A's, clamped to ±0.5% of `baseRate`. */
export function nudgeRate(errorMs: number, baseRate: number): number {
  const adj = Math.max(-MAX_NUDGE, Math.min(MAX_NUDGE, GAIN * errorMs));
  return baseRate * (1 + adj);
}

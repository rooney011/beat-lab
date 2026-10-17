/** Clamp a number into [lo, hi]. */
export const clamp = (x: number, lo = 0, hi = 1): number => Math.max(lo, Math.min(hi, x));

/** Back-out easing used for every "slam" entrance on the stage (overshoots, then settles). */
export function slam(p: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2);
}

/** Cubic in-out easing. */
export const easeInOutCubic = (p: number): number => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);

/** Format seconds as mm:ss. */
export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds || 0));
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}

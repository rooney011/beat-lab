import type { Dim } from '../config/dims';
import type { Analysis, Features } from '../types';
import type { Patterns } from './patterns';

/** Everything a layer needs to draw one frame. Built once per frame by the Stage. */
export interface DrawContext {
  c: CanvasRenderingContext2D;
  /** Canvas size in device pixels. */
  W: number;
  H: number;
  /** Device-pixel scale: multiply CSS-pixel sizes by this. */
  k: number;
  /** min(W, H). */
  md: number;
  /** Burst centre and radius. */
  cx: number;
  cy: number;
  R: number;
  /** Plate misregistration offset in device pixels. */
  off: number;
  /** FX Dose 0..1 and its response curve. */
  dose: number;
  tr: number;
  calm: boolean;
  mob: boolean;
  t: number;
  dt: number;
  /** Current dimension (plates possibly swapped for this song). */
  D: Dim;
  dim: number;
  a: Analysis;
  f: Features;
  pat: Patterns;
  /** Shared per-point jitter, refreshed every third frame. */
  jit: Float32Array;
  /** Mood motion multiplier. */
  motion: number;
}

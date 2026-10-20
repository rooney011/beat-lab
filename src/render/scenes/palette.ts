import type { Dim } from '../../config/dims';

/** Inks pulled from a song's cover art. */
export interface CoverPalette {
  /** Three print-ready inks, most characteristic first. */
  inks: [string, string, string];
  /** The brightest ink, for rays and highlights. */
  ray: string;
  /** A near-black tinted with the cover's dominant hue, for the stage paper. */
  stage: string;
}

type RGB = [number, number, number];
type HSL = [number, number, number];

const hex = ([r, g, b]: RGB): string =>
  '#' +
  [r, g, b]
    .map((v) =>
      Math.round(Math.max(0, Math.min(255, v)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')
    .toUpperCase();

export const parseHex = (h: string): RGB => {
  const s = h.replace('#', '');
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
};

function rgbToHsl([r, g, b]: RGB): HSL {
  r /= 255;
  g /= 255;
  b /= 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h /= 6;
  return [h * 360, s, l];
}

function hslToRgb([h, s, l]: HSL): RGB {
  h = (((h % 360) + 360) % 360) / 360;
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number): number => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}

const hueDist = (a: number, b: number): number => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

/** Mix two hex colours in RGB. */
export function mix(a: string, b: string, t: number): string {
  const x = parseHex(a);
  const y = parseHex(b);
  return hex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
}

/** Push a colour into the "printing ink" range: saturated, mid-light. */
function toInk(rgb: RGB): string {
  const [h, s, l] = rgbToHsl(rgb);
  return hex(hslToRgb([h, Math.max(0.62, Math.min(1, s * 1.25)), Math.max(0.52, Math.min(0.66, l))]));
}

/**
 * Pull three inks from cover-art pixels (RGBA, any size; 48×48 is plenty).
 * k-means in RGB with a deterministic start, then pick the three most colourful, well-separated
 * clusters. Returns null for near-greyscale covers, so the dimension keeps its own plates.
 */
export function extractPalette(rgba: Uint8ClampedArray | Uint8Array): CoverPalette | null {
  const px: RGB[] = [];
  for (let i = 0; i + 3 < rgba.length; i += 4) if (rgba[i + 3] > 128) px.push([rgba[i], rgba[i + 1], rgba[i + 2]]);
  if (px.length < 16) return null;

  // Deterministic start: centres spread across the luminance order.
  const K = 6;
  const byLum = [...px].sort(
    (a, b) => a[0] * 0.3 + a[1] * 0.59 + a[2] * 0.11 - (b[0] * 0.3 + b[1] * 0.59 + b[2] * 0.11),
  );
  let centres: RGB[] = Array.from(
    { length: K },
    (_, i) => [...byLum[Math.floor(((i + 0.5) / K) * byLum.length)]] as RGB,
  );
  let counts = new Array<number>(K).fill(0);
  for (let it = 0; it < 10; it++) {
    const sum = Array.from({ length: K }, () => [0, 0, 0]);
    counts = new Array<number>(K).fill(0);
    for (const p of px) {
      let best = 0;
      let bd = Infinity;
      for (let k = 0; k < K; k++) {
        const c = centres[k];
        const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2;
        if (d < bd) {
          bd = d;
          best = k;
        }
      }
      sum[best][0] += p[0];
      sum[best][1] += p[1];
      sum[best][2] += p[2];
      counts[best]++;
    }
    centres = centres.map((c, k) =>
      counts[k] ? [sum[k][0] / counts[k], sum[k][1] / counts[k], sum[k][2] / counts[k]] : c,
    );
  }

  const clusters = centres
    .map((c, k) => ({ rgb: c, share: counts[k] / px.length, hsl: rgbToHsl(c) }))
    .filter((c) => c.share > 0.01);
  const colourful = clusters
    .filter((c) => c.hsl[1] > 0.22 && c.hsl[2] > 0.12 && c.hsl[2] < 0.92)
    .sort((a, b) => b.hsl[1] * Math.sqrt(b.share) - a.hsl[1] * Math.sqrt(a.share));
  if (!colourful.length) return null;

  // Up to three inks with hues at least 28° apart; fill the rest by rotating the lead hue.
  const picked: HSL[] = [];
  for (const c of colourful) if (picked.every((p) => hueDist(p[0], c.hsl[0]) >= 28)) picked.push(c.hsl);
  const lead = picked[0];
  while (picked.length < 3) {
    const n = picked.length;
    picked.push([lead[0] + (n === 1 ? 150 : 210), Math.max(0.6, lead[1]), 0.58]);
  }
  const inks = picked.slice(0, 3).map((h) => toInk(hslToRgb(h))) as [string, string, string];
  const ray = [...inks].sort((a, b) => rgbToHsl(parseHex(b))[2] - rgbToHsl(parseHex(a))[2])[0];
  const dominant = [...clusters].sort((a, b) => b.share - a.share)[0];
  const stage = hex(hslToRgb([dominant.hsl[0], Math.min(0.45, dominant.hsl[1]), 0.055]));
  return { inks, ray, stage };
}

/** Draw a bitmap small and read its pixels (browser only). */
export function pixelsOf(source: CanvasImageSource, size = 48): Uint8ClampedArray | null {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const x = c.getContext('2d', { willReadFrequently: true });
  if (!x) return null;
  x.drawImage(source, 0, 0, size, size);
  return x.getImageData(0, 0, size, size).data;
}

/**
 * Tint a dimension toward the cover's inks. Strength 0 keeps the dimension, 1 replaces its plates.
 * Inkfall should stay mostly monochrome (≈0.35); the colour dimensions take ≈0.6.
 */
export function tintDim(D: Dim, p: CoverPalette, strength: number): Dim {
  return {
    ...D,
    plates: [
      mix(D.plates[0], p.inks[0], strength),
      mix(D.plates[1], p.inks[1], strength),
      mix(D.plates[2], p.inks[2], strength),
    ],
    ray: mix(D.ray, p.ray, strength),
    stage: mix(D.stage, p.stage, Math.min(1, strength * 0.8)),
  };
}

/**
 * Halftone dot patterns: one tiny canvas per (colour, dot radius, pitch), cached and reused.
 * Rotating the pattern gives the classic screen angles (15°, 45°, 75°) for each ink plate.
 */
export class Patterns {
  private cache = new Map<string, CanvasPattern>();
  private readonly hasTransform = typeof DOMMatrix !== 'undefined';

  constructor(private readonly host: CanvasRenderingContext2D) {}

  dots(color: string, radius: number, pitch: number, angleDeg = 0): CanvasPattern | string {
    const p0 = Math.max(3, Math.round(pitch));
    const r = Math.min(p0 * 0.5, Math.max(0.5, Math.round(radius * 2) / 2));
    const key = `${color}|${r}|${p0}`;
    let p = this.cache.get(key);
    if (!p) {
      if (this.cache.size > 240) this.cache.clear();
      const c = document.createElement('canvas');
      c.width = p0;
      c.height = p0;
      const x = c.getContext('2d');
      if (!x) return color;
      x.fillStyle = color;
      x.beginPath();
      x.arc(p0 / 2, p0 / 2, r, 0, Math.PI * 2);
      x.fill();
      const made = this.host.createPattern(c, 'repeat');
      if (!made) return color;
      p = made;
      this.cache.set(key, p);
    }
    if (this.hasTransform) {
      try {
        p.setTransform(new DOMMatrix().rotateSelf(angleDeg));
      } catch {}
    }
    return p;
  }
}

/** Paper grain and CRT scanline textures. */
export function makeTextures(host: CanvasRenderingContext2D): {
  grain: CanvasPattern | null;
  scan: CanvasPattern | null;
} {
  const g = document.createElement('canvas');
  g.width = 128;
  g.height = 128;
  const gx = g.getContext('2d');
  let grain: CanvasPattern | null = null;
  if (gx) {
    const img = gx.createImageData(128, 128);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.random() < 0.5 ? 0 : 255;
      img.data[i] = v;
      img.data[i + 1] = v;
      img.data[i + 2] = v;
      img.data[i + 3] = Math.floor(Math.random() * 90);
    }
    gx.putImageData(img, 0, 0);
    grain = host.createPattern(g, 'repeat');
  }
  const s = document.createElement('canvas');
  s.width = 1;
  s.height = 3;
  const sx = s.getContext('2d');
  let scan: CanvasPattern | null = null;
  if (sx) {
    sx.fillStyle = '#000000';
    sx.fillRect(0, 2, 1, 1);
    scan = host.createPattern(s, 'repeat');
  }
  return { grain, scan };
}

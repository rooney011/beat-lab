import type { Dim } from '../config/dims';
import { INK, PAPER } from '../config/dims';
import { FONT_DISPLAY, FONT_MONO } from '../render/fonts';
import { extractPalette, pixelsOf, type CoverPalette } from '../render/scenes';
import { hash, seededRandom } from '../util/rand';
import type { Picture } from './tags';

const SIZE = 240;

/**
 * The now-playing cover: the track's embedded art when there is one, otherwise a generated
 * comic cover (sunburst, halftone moon, initials, issue number) seeded from title + artist.
 */
export class CoverArt {
  private bitmap: ImageBitmap | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private token = 0;
  /** Inks pulled from the decoded embedded art, or null (greyscale art, or a generated cover). */
  palette: CoverPalette | null = null;

  attach(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
    canvas.width = SIZE;
    canvas.height = SIZE;
  }

  get hasArt(): boolean {
    return this.bitmap !== null;
  }

  clear(): void {
    this.token++;
    this.bitmap?.close();
    this.bitmap = null;
    this.palette = null;
  }

  /** Decode embedded art. Resolves true when it was decoded and is still current. */
  async load(pic: Picture | undefined): Promise<boolean> {
    const token = ++this.token;
    if (!pic || pic.data.length < 100 || typeof createImageBitmap !== 'function') return false;
    try {
      const bmp = await createImageBitmap(new Blob([pic.data as BlobPart], { type: pic.mime }));
      if (token !== this.token) {
        bmp.close();
        return false;
      }
      this.bitmap?.close();
      this.bitmap = bmp;
      // Pull the cover's inks now, while the bitmap is fresh. Never done for generated covers.
      const px = pixelsOf(bmp);
      this.palette = px ? extractPalette(px) : null;
      return true;
    } catch {
      return false;
    }
  }

  draw(D: Dim, title: string, artist: string): void {
    const el = this.canvas;
    const c = el?.getContext('2d');
    if (!el || !c) return;
    const sz = SIZE;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
    if (this.bitmap) {
      const b = this.bitmap;
      const s = Math.max(sz / b.width, sz / b.height);
      c.drawImage(b, (sz - b.width * s) / 2, (sz - b.height * s) / 2, b.width * s, b.height * s);
      return;
    }
    const name = title || 'BEAT LAB';
    const seed = hash(name + '|' + artist);
    const r = seededRandom(seed);
    c.fillStyle = D.stage;
    c.fillRect(0, 0, sz, sz);
    const cx = sz * (0.3 + r() * 0.4);
    const cy = sz * (0.32 + r() * 0.36);
    const n = 10 + Math.floor(r() * 8);
    const rot = r() * Math.PI;
    c.beginPath();
    for (let i = 0; i < n; i++) {
      const a0 = rot + (i * Math.PI * 2) / n;
      c.moveTo(cx, cy);
      c.arc(cx, cy, sz * 1.5, a0, a0 + Math.PI / n);
      c.closePath();
    }
    c.globalAlpha = 0.5;
    c.fillStyle = D.plates[1];
    c.fill();
    c.globalAlpha = 1;
    const R = sz * (0.24 + r() * 0.12);
    c.fillStyle = D.plates[0];
    c.beginPath();
    for (let y = 4; y < sz; y += 8) {
      for (let x = 4; x < sz; x += 8) {
        const rr = 3.6 * (1 - Math.hypot(x - cx, y - cy) / (R * 1.7));
        if (rr > 0.4) {
          c.moveTo(x + rr, y);
          c.arc(x, y, rr, 0, Math.PI * 2);
        }
      }
    }
    c.fill();
    const words = name
      .replace(/[^A-Za-z0-9 ]/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    const ini = (words.length > 1 ? words[0][0] + words[1][0] : (words[0] || 'BL').slice(0, 2)).toUpperCase();
    c.font = `${Math.round(sz * 0.4)}px ${FONT_DISPLAY}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.lineJoin = 'round';
    c.fillStyle = D.plates[1] === D.caption ? '#2F6BFF' : D.plates[1];
    c.fillText(ini, sz / 2 - 7, sz * 0.58 + 5);
    c.lineWidth = 9;
    c.strokeStyle = INK;
    c.strokeText(ini, sz / 2, sz * 0.58);
    c.fillStyle = D.caption;
    c.fillText(ini, sz / 2, sz * 0.58);
    c.fillStyle = INK;
    c.fillRect(0, 0, 84, 28);
    c.fillStyle = PAPER;
    c.font = `bold 15px ${FONT_MONO}`;
    c.textAlign = 'left';
    c.fillText('No.' + String(seed % 100).padStart(2, '0'), 8, 15);
  }
}

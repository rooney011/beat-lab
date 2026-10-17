import type { Dim } from '../config/dims';
import { INK } from '../config/dims';
import { FONT_DISPLAY, FONT_UI } from '../render/fonts';
import type { Layout, LyricStyle } from '../types';
import { slam } from '../util/math';
import type { LyricLine } from './lrc';
import { wordTimes } from './lrc';

interface LaidWord {
  w: string;
  em: boolean;
  font: string;
  wd: number;
  x: number;
  row: number;
}

interface Layout2 {
  key: string;
  items: LaidWord[];
  rows: number;
  lh: number;
  w: number;
  widths: number[];
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  pad: number;
  fs: number;
  rot: number;
}

interface CaptionLine extends LyricLine {
  wt?: number[] | null;
  lay?: Layout2 | null;
  box?: Box | null;
}

export interface CaptionFrame {
  c: CanvasRenderingContext2D;
  /** Song time in seconds, already shifted by the visual sync delay. */
  songTime: number;
  t: number;
  W: number;
  H: number;
  k: number;
  D: Dim;
  layout: Layout;
  calm: boolean;
  style: LyricStyle;
  bpm: number;
  /** Plate-kick amount 0..1, shakes the caption. */
  kick: number;
}

/**
 * Lyrics as comic caption boxes. Each line pops in as a box; words light up on their own times
 * (or on an eighth-note grid), with an entrance per mood: stamp, shake, float or typewriter.
 */
export class LyricsCaption {
  private lines: CaptionLine[] | null = null;
  private idx = -1;
  private prev: { box: Box; line: CaptionLine; t0: number } | null = null;
  private side = 1;
  private start = 0;

  set(lines: LyricLine[] | null): void {
    this.lines = lines && lines.length ? (lines as CaptionLine[]) : null;
    this.idx = -1;
    this.prev = null;
  }

  get active(): boolean {
    return this.lines !== null;
  }

  get count(): number {
    return this.lines ? this.lines.filter((l) => l.text).length : 0;
  }

  /** Word timing depends on tempo; call when the BPM estimate changes. */
  retime(): void {
    if (this.lines) for (const l of this.lines) l.wt = null;
  }

  private times(line: CaptionLine, bpm: number): number[] {
    if (!line.wt) line.wt = wordTimes(line, bpm);
    return line.wt;
  }

  private layout(c: CanvasRenderingContext2D, line: CaptionLine, fs: number, maxW: number): Layout2 {
    const key = fs + '|' + maxW;
    if (line.lay && line.lay.key === key) return line.lay;
    const shout = line.text === line.text.toUpperCase() && /[A-Z]/.test(line.text);
    const fUi = `800 ${fs}px ${FONT_UI}`;
    const fD = `${Math.round(fs * 1.12)}px ${FONT_DISPLAY}`;
    c.font = fUi;
    const space = c.measureText(' ').width;
    const items: LaidWord[] = line.words.map((w) => {
      const em = shout || /!$/.test(w.w);
      c.font = em ? fD : fUi;
      return { w: w.w, em, font: em ? fD : fUi, wd: c.measureText(w.w).width, x: 0, row: 0 };
    });
    const rows: LaidWord[][] = [[]];
    let rw = 0;
    for (const it of items) {
      const cur = rows[rows.length - 1];
      const add = (cur.length ? space : 0) + it.wd;
      if (rw + add > maxW && cur.length) {
        rows.push([]);
        rw = 0;
      }
      const r = rows[rows.length - 1];
      it.x = rw + (r.length ? space : 0);
      r.push(it);
      rw = it.x + it.wd;
    }
    const widths = rows.map((r) => (r.length ? r[r.length - 1].x + r[r.length - 1].wd : 0));
    rows.forEach((r, ri) => r.forEach((it) => (it.row = ri)));
    line.lay = { key, items, rows: rows.length, lh: fs * 1.3, w: Math.max(...widths), widths };
    return line.lay;
  }

  draw(fr: CaptionFrame): void {
    const Ls = this.lines;
    if (!Ls) return;
    const { c, t, W, H, k, calm, layout } = fr;
    const mob = layout === 'mobile';
    const lt = fr.songTime;
    let idx = -1;
    for (let i = Ls.length - 1; i >= 0; i--) {
      if (Ls[i].t <= lt + 0.02) {
        idx = i;
        break;
      }
    }
    if (idx !== this.idx) {
      const old = this.idx >= 0 ? Ls[this.idx] : null;
      this.prev = old && old.text && old.box ? { box: old.box, line: old, t0: t } : null;
      this.idx = idx;
      this.side = idx % 2 ? 1 : -1;
      this.start = t;
    }
    if (this.prev) {
      const p = (t - this.prev.t0) / 260;
      if (p >= 1 || calm) this.prev = null;
      else this.box(fr, this.prev.line, this.prev.box, 1e9, -p * 26 * k, 1 - p, true, 1);
    }
    const line = idx >= 0 && lt < Ls[idx].end && Ls[idx].text ? Ls[idx] : null;
    if (!line) return;
    const md = Math.min(W, H);
    const fs = Math.round(Math.max(20 * k, Math.min(44 * k, md * (mob ? 0.058 : 0.045))));
    const maxW = mob ? W - 56 * k : Math.min(W * 0.5, 860 * k);
    const lay = this.layout(c, line, fs, maxW);
    const pad = Math.round(fs * 0.55);
    const bw = lay.w + pad * 2;
    const bh = lay.rows * lay.lh + pad * 1.4;
    const yc = mob ? H * 0.5 : Math.min(H * (layout === 'tablet' ? 0.56 : 0.71), H - 280 * k - bh / 2);
    const xc = W * 0.5 + (mob ? 0 : this.side * W * 0.05);
    line.box = { x: xc - bw / 2, y: yc - bh / 2, w: bw, h: bh, pad, fs, rot: this.side * 0.02 };
    const age = t - this.start;
    const inS = calm ? 1 : age < 160 ? 0.9 + 0.1 * slam(Math.min(1, age / 160)) : 1;
    this.box(fr, line, line.box, lt, 0, 1, false, inS);
  }

  private box(
    fr: CaptionFrame,
    line: CaptionLine,
    b: Box,
    lt: number,
    dy: number,
    alpha: number,
    done: boolean,
    inS: number,
  ): void {
    const lay = line.lay;
    if (!lay) return;
    const { c, k, D, calm, style } = fr;
    const wt = this.times(line, fr.bpm);
    const jx = calm ? 0 : fr.kick * 2 * k * (style === 'shake' ? 2 : 1);
    c.save();
    c.globalAlpha = alpha;
    c.translate(b.x + b.w / 2 + jx, b.y + b.h / 2 + dy);
    c.rotate(b.rot);
    c.scale(inS, inS);
    c.translate(-b.w / 2, -b.h / 2);
    c.fillStyle = D.plates[1] === '#F3EEE3' ? '#FF2E93' : D.plates[1];
    c.fillRect(-3 * k, 2 * k, b.w, b.h);
    c.fillStyle = D.accent;
    c.fillRect(6 * k, 6 * k, b.w, b.h);
    c.fillStyle = D.caption;
    c.fillRect(0, 0, b.w, b.h);
    c.lineWidth = 3 * k;
    c.strokeStyle = INK;
    c.strokeRect(0, 0, b.w, b.h);
    c.textBaseline = 'middle';
    c.textAlign = 'left';
    let lastOn = -1;
    for (let i = 0; i < wt.length; i++) if (done || wt[i] <= lt) lastOn = i;
    for (let i = 0; i < lay.items.length; i++) {
      const it = lay.items[i];
      const on = i <= lastOn;
      const rowW = lay.widths[it.row];
      const x = b.pad + (lay.w - rowW) / 2 + it.x;
      const y = b.pad * 0.7 + lay.lh * (it.row + 0.5);
      c.font = it.font;
      if (!on) {
        c.globalAlpha = alpha * 0.16;
        c.fillStyle = INK;
        c.fillText(it.w, x, y);
        c.globalAlpha = alpha;
        continue;
      }
      const age = done ? 9999 : (lt - wt[i]) * 1000;
      let sc = 1;
      let ox = 0;
      let oy = 0;
      let chars = it.w.length;
      let a = 1;
      if (!calm && age < 260) {
        const p = Math.min(1, age / (style === 'float' ? 260 : 130));
        if (style === 'float') {
          a = p;
          oy = (1 - p) * 10 * k;
        } else if (style === 'type') chars = Math.max(1, Math.ceil(it.w.length * Math.min(1, age / 160)));
        else {
          sc = 1.45 - 0.45 * slam(p);
          if (style === 'shake' && age < 160) {
            ox = (Math.random() - 0.5) * 4 * k;
            oy = (Math.random() - 0.5) * 4 * k;
          }
        }
      }
      if (i === lastOn && !done && age < 600) {
        c.fillStyle = D.accent;
        c.fillRect(x - 3 * k, y - b.fs * 0.58, it.wd + 6 * k, b.fs * 1.16);
      }
      c.globalAlpha = alpha * a;
      c.fillStyle = INK;
      if (sc !== 1) {
        c.save();
        c.translate(x + it.wd / 2 + ox, y + oy);
        c.scale(sc, sc);
        c.fillText(it.w, -it.wd / 2, 0);
        c.restore();
      } else c.fillText(chars < it.w.length ? it.w.slice(0, chars) : it.w, x + ox, y + oy);
      c.globalAlpha = alpha;
    }
    c.restore();
  }
}

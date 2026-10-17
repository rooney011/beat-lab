import type { Dim, Panel } from '../config/dims';
import { DIMS, INK, LAYERS, PANEL_LAYOUTS, PAPER, CREW_COUNT } from '../config/dims';
import type { SongProfile } from '../analysis/mood';
import type { Analysis, AppState, Features, MoodId, Quality } from '../types';
import { easeInOutCubic, slam } from '../util/math';
import type { DrawContext } from './context';
import { Background } from './layers/background';
import { Burst } from './layers/burst';
import { Crew } from './layers/crew';
import { Hits, type StageBox } from './layers/hits';
import { Rings } from './layers/rings';
import { drawString } from './layers/string';
import { drawTowers } from './layers/towers';
import { GiantWord } from './layers/word';
import { Patterns, makeTextures } from './patterns';
import { FlashBudget, LuminanceClamp } from './safety';

export interface StageFrame {
  a: Analysis;
  t: number;
  dt: number;
  s: AppState;
  /** Dimension currently on stage. */
  dim: number;
  profile: SongProfile | null;
  motion: number;
  /** Giant background word. */
  word: string;
  /** Advances the dimension wipe; returns progress and target, or null. */
  wipe: (durationMs: number) => { p: number; to: number } | null;
  /** Draws lyrics on the composited frame (after panel cuts, so captions never get cut up). */
  drawLyrics: (c: CanvasRenderingContext2D, D: Dim, k: number, kick: number) => void;
  /** Envelope for the string's jitter (first standing-wave mode). */
  envelope: Float32Array;
}

type Eased = { bg: number; word: number; towers: number };

/**
 * The stage renderer. Layers are drawn into an off-screen scene canvas under a "camera"
 * (beat shake, slow roll, pulse zoom), then composited to the visible canvas: whole, slam-zoomed,
 * or re-cut into comic panels. Static Bloom adds slice glitch and scanlines; lyrics, dimension
 * wipes and the photosensitivity guards go on top.
 */
export class Stage {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly scene = document.createElement('canvas');
  private readonly sx: CanvasRenderingContext2D;
  private readonly temp = document.createElement('canvas');
  private readonly tx: CanvasRenderingContext2D;
  private readonly pat: Patterns;
  private readonly grain: CanvasPattern | null;
  private readonly scan: CanvasPattern | null;
  private readonly jit = new Float32Array(40);
  private frameNo = 0;
  /** Device-pixel scale. */
  k = 1;

  /** Plate kick (0..1), decays over 160 ms. */
  kick = 0;
  private camKick = 0;
  private camDir = 0;
  private panels: Panel[] | null = null;
  private layoutIdx = -1;
  private lastCut = -9999;
  private cutT = -9999;
  private cutFlash = false;
  private invertOK = false;
  private glitchFrames = 0;
  private readonly eased: Eased = { bg: 1, word: 1, towers: 1 };
  private readonly swapCache = new Map<string, Dim>();
  /** Time of the last beat the viewer saw (drives the strip LED). */
  lastBeatSeen = -9999;

  readonly background = new Background();
  readonly word = new GiantWord();
  readonly rings = new Rings();
  readonly burst = new Burst();
  readonly crew = new Crew();
  readonly hits = new Hits();
  readonly flashes = new FlashBudget();
  readonly clamp = new LuminanceClamp();

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d', { alpha: false });
    const sx = this.scene.getContext('2d');
    const tx = this.temp.getContext('2d');
    if (!ctx || !sx || !tx) throw new Error('Canvas 2D is not available');
    this.ctx = ctx;
    this.sx = sx;
    this.tx = tx;
    this.pat = new Patterns(sx);
    const tex = makeTextures(sx);
    this.grain = tex.grain;
    this.scan = tex.scan;
    for (let i = 0; i < this.jit.length; i++) this.jit[i] = Math.random() * 2 - 1;
  }

  /** Size the canvases for a CSS box. Render scale is capped at 1.5× device pixels, times quality. */
  resize(cssW: number, cssH: number, qualityScale: number): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5) * qualityScale;
    const W = Math.max(4, Math.round(cssW * dpr));
    const H = Math.max(4, Math.round(cssH * dpr));
    if (this.canvas.width !== W || this.canvas.height !== H || this.scene.width !== W || this.scene.height !== H) {
      for (const c of [this.canvas, this.scene, this.temp]) {
        c.width = W;
        c.height = H;
      }
    }
    this.k = dpr;
  }

  static qualityScale(q: Quality, auto: number): number {
    return q === 'high' ? 1 : q === 'low' ? 0.6 : auto;
  }

  private box(s: AppState): StageBox {
    return { W: this.canvas.width, H: this.canvas.height, mob: s.layout === 'mobile' };
  }

  /** React to this frame's onsets: spawn rings, stamps, splats, cuts and sound words. */
  events(f: Features, t: number, s: AppState, dim: number): void {
    if (!s.playing || s.screen !== 'live') return;
    const tr = Math.pow(s.dose / 100, 1.4) * 1.25;
    const calm = s.reduce;
    const LY = LAYERS[dim];
    const box = this.box(s);
    if (f.beat) {
      this.lastBeatSeen = t;
      if (s.fx.plates) this.kick = 1;
      if (!calm) {
        this.camKick = f.strong ? 1 : 0.55;
        this.camDir = Math.random() * Math.PI * 2;
        this.background.kick();
        if (LY.rings) this.rings.spawn(t, f.strong);
        if (LY.fx && s.fx.stamps && tr > 0.15 && (f.strong || (f.intensity > 0.6 && Math.random() < 0.35)))
          this.hits.spawnStamp(t, box);
      }
    }
    if (f.snare && !calm && LY.fx && s.fx.stamps && tr > 0.1) {
      this.hits.spawnSplat(t, box);
      this.hits.spawnStreak(t, box);
    }
    if (f.strong && s.fx.cuts && !calm && dim >= 2 && t - this.lastCut >= 450 && Math.random() < 0.25 + 0.48 * tr)
      this.cut(t, s.strict);
    if (this.panels && t - this.lastCut > 4000) this.panels = null;
    if (f.strong && s.fx.letters && !calm && LY.letters && t - this.hits.lastLetter > 1200 && tr > 0.3)
      this.hits.spawnLetter(t, box);
  }

  /** Re-cut the stage into a random panel layout (or back to one frame). Costs one flash. */
  private cut(t: number, strict: boolean): void {
    const i = Math.floor(Math.random() * (PANEL_LAYOUTS.length + 1));
    if (i >= PANEL_LAYOUTS.length || i === this.layoutIdx) {
      this.panels = null;
      this.layoutIdx = -1;
    } else {
      this.layoutIdx = i;
      this.panels = PANEL_LAYOUTS[i];
    }
    this.cutT = t;
    this.lastCut = t;
    this.cutFlash = this.flashes.take(t, strict);
    this.invertOK = this.cutFlash;
  }

  private dimFor(dim: number, profile: SongProfile | null): Dim {
    const D0 = DIMS[dim];
    if (!profile?.swap) return D0;
    let D = this.swapCache.get(D0.id);
    if (!D) {
      D = { ...D0, plates: [D0.plates[1], D0.plates[0], D0.plates[2]] };
      this.swapCache.set(D0.id, D);
    }
    return D;
  }

  render(fr: StageFrame): void {
    const cv = this.canvas;
    const ctx = this.ctx;
    const sc = this.sx;
    if (cv.width < 4 || this.scene.width !== cv.width) return;
    const { a, t, dt, s, dim } = fr;
    const f = a.f;
    const W = cv.width;
    const H = cv.height;
    const k = this.k;
    const D = this.dimFor(dim, fr.profile);
    const dose = s.dose / 100;
    const tr = Math.pow(dose, 1.4) * 1.25;
    const calm = s.reduce;
    const mob = s.layout === 'mobile';
    const cover = s.screen === 'cover';
    const live = s.screen === 'live';
    const cx = W * (cover ? (mob ? 0.5 : 0.68) : mob ? 0.5 : 0.56);
    const cy = H * (mob ? 0.36 : cover ? 0.4 : 0.44);
    const md = Math.min(W, H);
    this.kick = Math.max(0, this.kick - dt / 0.16);
    this.camKick = Math.max(0, this.camKick - dt / 0.22);
    this.frameNo = (this.frameNo + 1) % 3;
    if (this.frameNo === 0) for (let i = 0; i < this.jit.length; i++) this.jit[i] = Math.random() * 2 - 1;
    this.crew.updateClock(dt, t, f, { playing: s.playing, live, clockBpm: fr.profile?.clockBpm ?? 0, bpm: s.bpm });
    const off =
      (s.fx.plates ? (calm ? Math.min(3, 1 + f.highs * 2) : 2 + this.kick * (4 + 6 * tr) + f.highs * 12 * tr) : 1) *
      k *
      (D.id === 'riso' ? 1.6 : 1);
    const R = md * (mob ? 0.2 : 0.16) * (1 + f.pulse * 0.1 * (0.5 + dose));
    const dc: DrawContext = {
      c: sc,
      W,
      H,
      k,
      md,
      cx,
      cy,
      R,
      off,
      dose,
      tr,
      calm,
      mob,
      t,
      dt,
      D,
      dim,
      a,
      f,
      pat: this.pat,
      jit: this.jit,
      motion: fr.motion,
    };

    // Scene, under the camera.
    sc.setTransform(1, 0, 0, 1, 0, 0);
    sc.globalCompositeOperation = 'source-over';
    sc.globalAlpha = 1;
    sc.fillStyle = D.stage;
    sc.fillRect(0, 0, W, H);
    const ck = calm ? 0 : this.camKick * Math.max(0.4, tr);
    const shx = Math.cos(this.camDir) * ck * 10 * k;
    const shy = Math.sin(this.camDir) * ck * 10 * k;
    const camZ = 1 + ck * 0.035 + (calm ? 0 : f.pulse * 0.015);
    const camR = calm ? 0 : Math.sin(t * 0.00025) * 0.015 + ck * 0.01;
    sc.save();
    sc.translate(W / 2 + shx, H / 2 + shy);
    sc.rotate(camR);
    sc.scale(camZ, camZ);
    sc.translate(-W / 2, -H / 2);
    const budget = LAYERS[dim];
    const ea = Math.min(1, dt * 3);
    this.eased.bg += (budget.bg - this.eased.bg) * ea;
    this.eased.word += (budget.word - this.eased.word) * ea;
    this.eased.towers += (budget.towers - this.eased.towers) * ea;
    this.background.draw(dc, {
      kick: this.kick,
      alpha: this.eased.bg,
      seed: fr.profile ?? { angle: 0, rayExtra: 0 },
      rings: this.rings.list,
    });
    if (this.eased.word > 0.01) this.word.draw(dc, fr.word, this.eased.word);
    if (this.eased.towers > 0.01) drawTowers(dc, this.eased.towers);
    drawString(dc, fr.envelope);
    if (s.fx.dancers && live) {
      const [desk, phone] = CREW_COUNT[dim];
      const count = budget.crew ? (mob ? phone : desk) : 0;
      this.crew.draw(dc, {
        songKey: fr.profile?.key ?? 'idle',
        count,
        mood: s.mood as MoodId | null,
        playing: s.playing,
      });
    }
    if (!calm) this.rings.draw(dc);
    this.burst.draw(dc);
    if (s.fx.stamps && !calm) this.hits.drawImpacts(dc);
    this.hits.drawSparks(dc, s.playing && live ? f.spark : 0);
    this.hits.drawLetter(dc);
    sc.restore();
    const vg = sc.createRadialGradient(cx, cy, md * 0.3, cx, cy, Math.hypot(W, H) * 0.62);
    vg.addColorStop(0, 'rgba(5,4,8,0)');
    vg.addColorStop(1, 'rgba(5,4,8,0.7)');
    sc.fillStyle = vg;
    sc.fillRect(0, 0, W, H);
    if (s.fx.grain && this.grain) {
      sc.globalAlpha = D.id === 'riso' ? 0.2 : 0.08;
      sc.fillStyle = this.grain;
      sc.save();
      sc.translate(-Math.random() * 128, -Math.random() * 128);
      sc.fillRect(0, 0, W + 128, H + 128);
      sc.restore();
      sc.globalAlpha = 1;
    }

    // Composite: whole frame (with a slam zoom right after a cut) or comic panels.
    const since = t - this.cutT;
    const slamZ = since < 120 && !calm ? 1 + 0.06 * (1 - slam(since / 120)) : 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    const P = this.panels;
    if (!P) {
      if (slamZ !== 1) {
        const sw = W / slamZ;
        const sh = H / slamZ;
        ctx.drawImage(this.scene, (W - sw) / 2, (H - sh) / 2, sw, sh, 0, 0, W, H);
      } else ctx.drawImage(this.scene, 0, 0);
    } else {
      ctx.fillStyle = D.stage;
      ctx.fillRect(0, 0, W, H);
      for (const tl of P) {
        ctx.save();
        polyPath(ctx, tl.poly, W, H);
        ctx.clip();
        const bx = tl.bb[0] * W;
        const by = tl.bb[1] * H;
        const bw = Math.max(2, tl.bb[2] * W);
        const bh = Math.max(2, tl.bb[3] * H);
        const z = Math.max(1, tl.z * slamZ);
        const sw = Math.min(W, bw / z);
        const sh = Math.min(H, bh / z);
        const fx = cx + tl.ox * W;
        const fy = cy + tl.oy * H;
        const sx0 = Math.max(0, Math.min(W - sw, fx - sw / 2));
        const sy0 = Math.max(0, Math.min(H - sh, fy - sh / 2));
        ctx.drawImage(this.scene, sx0, sy0, sw, sh, bx, by, bw, bh);
        if (tl.mode === 'invert' && this.invertOK && !calm) {
          ctx.globalCompositeOperation = 'difference';
          ctx.fillStyle = PAPER;
          ctx.fillRect(bx, by, bw, bh);
          ctx.globalCompositeOperation = 'saturation';
          ctx.fillStyle = '#808080';
          ctx.fillRect(bx, by, bw, bh);
          ctx.globalCompositeOperation = 'source-over';
        } else if (tl.mode === 'duo' || tl.mode === 'invert') {
          ctx.globalCompositeOperation = 'color';
          ctx.fillStyle = D.accent;
          ctx.fillRect(bx, by, bw, bh);
          ctx.globalCompositeOperation = 'source-over';
        }
        ctx.restore();
      }
      ctx.lineWidth = 8 * k;
      ctx.lineJoin = 'miter';
      ctx.strokeStyle = PAPER;
      for (const tl of P) {
        polyPath(ctx, tl.poly, W, H);
        ctx.stroke();
      }
    }

    if (D.id === 'static') {
      if (!calm && s.fx.glitch && s.playing) {
        if (this.glitchFrames > 0) {
          this.tx.globalCompositeOperation = 'copy';
          this.tx.drawImage(cv, 0, 0);
          const n = 3 + Math.floor(Math.random() * 7);
          for (let i = 0; i < n; i++) {
            const y = Math.random() * H;
            const h = Math.max(1, Math.min((6 + Math.random() * 56) * k, H - y));
            const dx = (Math.random() * 2 - 1) * W * 0.04 * Math.max(0.3, tr);
            ctx.drawImage(this.temp, 0, y, W, h, dx, y, W, h);
          }
          this.glitchFrames--;
        } else if ((f.highs > 0.75 && Math.random() < 0.2) || f.strong)
          this.glitchFrames = 2 + Math.floor(Math.random() * 3);
      }
      if (this.scan) {
        ctx.globalAlpha = 0.18;
        ctx.fillStyle = this.scan;
        ctx.fillRect(0, 0, W, H);
        ctx.globalAlpha = 1;
      }
    }

    if (s.fx.lyrics && live && s.source) fr.drawLyrics(ctx, D, k, this.kick);

    const w = fr.wipe(calm ? 400 : 640);
    if (w) {
      const p = w.p;
      if (!calm) {
        const Dn = DIMS[w.to];
        const e = easeInOutCubic(p);
        const bw = W * 0.26;
        const sl = H * 0.3;
        const x0 = -bw + e * (W + bw + sl);
        ctx.beginPath();
        ctx.moveTo(x0, 0);
        ctx.lineTo(x0 + bw, 0);
        ctx.lineTo(x0 + bw - sl, H);
        ctx.lineTo(x0 - sl, H);
        ctx.closePath();
        ctx.fillStyle = Dn.stage;
        ctx.fill();
        ctx.fillStyle = this.pat.dots(Dn.accent, 3 * k, 9 * k, 45);
        ctx.fill();
        ctx.lineWidth = 4 * k;
        ctx.strokeStyle = Dn.accent;
        ctx.stroke();
      } else {
        ctx.globalAlpha = 0.35 * Math.sin(Math.PI * p);
        ctx.fillStyle = INK;
        ctx.fillRect(0, 0, W, H);
        ctx.globalAlpha = 1;
      }
    }

    if (this.cutFlash) {
      this.cutFlash = false;
      if (!calm) {
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = PAPER;
        ctx.fillRect(0, 0, W, H);
        ctx.globalAlpha = 1;
      }
    }
    if (this.clamp.active(t)) {
      ctx.globalAlpha = 0.45;
      ctx.fillStyle = '#4A4752';
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }
    this.clamp.measure(cv, t);
  }
}

function polyPath(c: CanvasRenderingContext2D, poly: [number, number][], W: number, H: number): void {
  c.beginPath();
  poly.forEach(([x, y], i) => (i ? c.lineTo(x * W, y * H) : c.moveTo(x * W, y * H)));
  c.closePath();
}

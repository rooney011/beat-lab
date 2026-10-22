/**
 * Records ~15 s of Now Playing as a shareable portrait video (docs/ROADMAP.md §3.1). A second Stage
 * renders into an offscreen clip canvas, composed for portrait; the mix bus feeds a
 * MediaStreamAudioDestinationNode; the two tracks are muxed by MediaRecorder. The App drives the clip
 * render from its own frame loop (one `renderFrame` per frame) so the heavy per-frame analysis is
 * shared. Recording always uses the strict flash budget — clips get posted where anyone can watch.
 */
import { Stage, type StageFrame } from '../render/stage';
import { clipBitrate, clipFileName, isWebm, pickMimeType } from './format';

export type ClipPhase = 'countdown' | 'recording' | 'preview' | 'error';

export interface ClipState {
  phase: ClipPhase;
  /** Countdown 1→0, then recording 0→1 (fraction of the clip captured). */
  progress: number;
  webm: boolean;
}

export interface ClipResult {
  blob: Blob;
  url: string;
  type: string;
  webm: boolean;
}

export interface ClipOptions {
  size: { w: number; h: number };
  visualsOnly: boolean;
  durationSec: number;
  title: string;
  artist: string;
}

const COUNTDOWN_MS = 3000;
const RENDER_FPS = 30;

export class ClipStudio {
  readonly stage: Stage;
  private readonly canvas: HTMLCanvasElement;
  private readonly overlayCtx: CanvasRenderingContext2D;
  private readonly dest: MediaStreamAudioDestinationNode | null = null;
  private readonly recorder: MediaRecorder | null = null;
  private readonly chunks: Blob[] = [];
  private readonly type: string;
  private phase: ClipPhase = 'countdown';
  private readonly startT = performance.now();
  private recStartT = 0;
  private lastRenderT = 0;
  private result: ClipResult | null = null;

  constructor(
    ctx: AudioContext,
    mixBus: AudioNode,
    live: Stage,
    private readonly opts: ClipOptions,
    private readonly onState: (s: ClipState) => void,
    private readonly onDone: (r: ClipResult | null) => void,
  ) {
    this.canvas = document.createElement('canvas');
    const octx = this.canvas.getContext('2d', { alpha: false });
    if (!octx) throw new Error('Canvas 2D is not available');
    this.overlayCtx = octx;
    this.stage = new Stage(this.canvas);
    this.stage.setExactSize(opts.size.w, opts.size.h);
    this.stage.syncLook(live);

    const videoTracks = this.canvas.captureStream(RENDER_FPS).getVideoTracks();
    const stream = new MediaStream(videoTracks);
    if (!opts.visualsOnly) {
      this.dest = ctx.createMediaStreamDestination();
      mixBus.connect(this.dest);
      for (const tr of this.dest.stream.getAudioTracks()) stream.addTrack(tr);
    }
    this.type = typeof MediaRecorder !== 'undefined' ? pickMimeType((t) => MediaRecorder.isTypeSupported(t)) : '';
    try {
      this.recorder = new MediaRecorder(
        stream,
        this.type ? { mimeType: this.type, videoBitsPerSecond: clipBitrate(opts.size) } : undefined,
      );
      this.recorder.ondataavailable = (e) => {
        if (e.data.size) this.chunks.push(e.data);
      };
      this.recorder.onstop = () => this.finish();
      this.recorder.onerror = () => this.fail();
    } catch {
      this.recorder = null;
      queueMicrotask(() => this.fail());
    }
  }

  /** Called once per App frame. Renders the clip stage (throttled to 30 fps) and runs the phase clock. */
  renderFrame(frame: StageFrame, t: number): void {
    if (this.phase === 'preview' || this.phase === 'error') return;
    if (t - this.lastRenderT >= 1000 / RENDER_FPS) {
      this.lastRenderT = t;
      this.stage.events(frame.a.f, t, frame.s, frame.dim);
      this.stage.render(frame);
      this.drawOverlay(t);
    }
    this.clock(t);
  }

  private clock(t: number): void {
    if (this.phase === 'countdown') {
      const left = COUNTDOWN_MS - (t - this.startT);
      if (left <= 0) {
        this.phase = 'recording';
        this.recStartT = t;
        this.recorder?.start();
      }
      this.onState({
        phase: 'countdown',
        progress: Math.max(0, Math.min(1, left / COUNTDOWN_MS)),
        webm: isWebm(this.type),
      });
      return;
    }
    if (this.phase === 'recording') {
      const elapsed = (t - this.recStartT) / 1000;
      const progress = Math.max(0, Math.min(1, elapsed / this.opts.durationSec));
      this.onState({ phase: 'recording', progress, webm: isWebm(this.type) });
      if (elapsed >= this.opts.durationSec && this.recorder?.state === 'recording') this.recorder.stop();
    }
  }

  // ---------------------------------------------------------------- overlay

  private drawOverlay(t: number): void {
    const c = this.overlayCtx;
    const { w, h } = this.opts.size;
    if (this.phase === 'countdown') {
      const n = Math.ceil((COUNTDOWN_MS - (t - this.startT)) / 1000);
      if (n > 0) {
        c.save();
        c.fillStyle = 'rgba(0,0,0,0.35)';
        c.fillRect(0, 0, w, h);
        c.fillStyle = '#F3EEE3';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.font = `700 ${Math.round(w * 0.28)}px 'Dela Gothic One', sans-serif`;
        c.fillText(String(n), w / 2, h / 2);
        c.restore();
      }
    }
    // Song caption + credit, bottom third.
    c.save();
    c.textAlign = 'left';
    c.textBaseline = 'alphabetic';
    const pad = Math.round(w * 0.06);
    const title = this.opts.title || 'BEAT LAB';
    c.font = `700 ${Math.round(w * 0.065)}px 'Dela Gothic One', sans-serif`;
    c.fillStyle = '#F3EEE3';
    c.shadowColor = 'rgba(0,0,0,0.6)';
    c.shadowBlur = Math.round(w * 0.02);
    c.fillText(title.slice(0, 28), pad, h - pad - Math.round(w * 0.07));
    if (this.opts.artist) {
      c.font = `700 ${Math.round(w * 0.04)}px 'Archivo Variable', sans-serif`;
      c.fillText(this.opts.artist.slice(0, 32), pad, h - pad - Math.round(w * 0.015));
    }
    c.font = `700 ${Math.round(w * 0.028)}px 'Space Mono', monospace`;
    c.textAlign = 'right';
    c.globalAlpha = 0.85;
    c.fillText('BEAT LAB', w - pad, h - pad);
    c.restore();
  }

  // ---------------------------------------------------------------- output

  private finish(): void {
    const type = this.recorder?.mimeType || this.type || 'video/webm';
    const blob = new Blob(this.chunks, { type });
    const url = URL.createObjectURL(blob);
    this.result = { blob, url, type, webm: isWebm(type) };
    this.phase = 'preview';
    this.onState({ phase: 'preview', progress: 1, webm: this.result.webm });
    this.onDone(this.result);
  }

  private fail(): void {
    if (this.phase === 'error') return;
    this.phase = 'error';
    this.onState({ phase: 'error', progress: 0, webm: false });
    this.onDone(null);
  }

  /** Finish early (stopped before the ring filled): stop the recorder → onstop → preview. */
  stop(): void {
    if (this.phase === 'recording' && this.recorder?.state === 'recording') this.recorder.stop();
  }

  /** Share the clip if the platform can, otherwise download it. */
  async share(): Promise<void> {
    if (!this.result) return;
    const name = clipFileName(this.opts.title, new Date(), this.result.type);
    const file = new File([this.result.blob], name, { type: this.result.type });
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    if (nav.canShare?.({ files: [file] }) && nav.share) {
      try {
        await nav.share({ files: [file], title: this.opts.title });
        return;
      } catch {
        /* cancelled or unsupported — fall through to download */
      }
    }
    this.save();
  }

  /** Download the clip. */
  save(): void {
    if (!this.result) return;
    const a = document.createElement('a');
    a.href = this.result.url;
    a.download = clipFileName(this.opts.title, new Date(), this.result.type);
    a.click();
  }

  /** Stop and release everything (discard, or teardown on song change). */
  dispose(): void {
    try {
      if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
    } catch {
      /* ignore */
    }
    this.dest?.disconnect();
    if (this.result) URL.revokeObjectURL(this.result.url);
    this.phase = 'error';
  }
}

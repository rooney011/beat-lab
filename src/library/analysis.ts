/**
 * The background analysis runner (docs/ROADMAP.md §2.1). One job at a time: decode a track on the
 * main thread, down-mix to mono and down-sample to 22 050 Hz, hand the samples to the pure analysis
 * worker, and write the result back through the injected callbacks. The playing track is analysed
 * first, then the upcoming queue, then the rest of the library — see src/analysis/queue.ts.
 *
 * It pauses while the tab is hidden, and while an injected `isBusy()` says the render thread is
 * under load (on phones the host sets this while Now Playing is drawing), so analysis never fights
 * playback for the main thread. Best-effort: a decode or worker failure just marks that track done
 * so the loop moves on.
 *
 * Milestone 2.1 only produces loudness (folded in here so the whole library gets measured over idle
 * time, not just the playing track); 2.2 returns the full TrackAnalysis from the same decode.
 */
import { downsampleTo, toMono } from '../ai/resample';
import type { AnalyseRequest, AnalysisWorkerOut } from '../analysis/analysis-worker';
import { analysisWorklist } from '../analysis/queue';
import { measureLoudness, type LoudnessResult } from './loudness';
import type { Track } from './types';

/** The analysis decode rate: mono at 22 050 Hz halves memory (~21 MB for a 4-minute track). */
const DECODE_RATE = 22_050;

export interface AnalysisDeps {
  /** Resolve a track's audio file (linked folder, OPFS or blob store); null when unavailable. */
  getFile: (track: Track) => Promise<File | null>;
  /** A measured loudness landed — persist it and apply the trim if the track is playing. */
  onLoudness: (track: Track, loudness: LoudnessResult) => void;
  /** The render thread is under load; hold off starting the next job. */
  isBusy: () => boolean;
}

export interface AnalysisContext {
  tracks: readonly Track[];
  playingId: string | null;
  /** Upcoming queue order (next tracks). */
  queued: readonly string[];
}

/** A track is "done" once it has a measured or tag-declared loudness (milestone 2.1). */
function hasLoudness(t: Track): boolean {
  return !!t.loudness || t.replayGain?.track !== undefined;
}

export class AnalysisRunner {
  private worker: Worker | null = null;
  private workerBroken = false;
  private reqSeq = 0;
  private pending: { resolve: (r: AnalysisWorkerOut) => void } | null = null;
  private running = false;
  private tracks: readonly Track[] = [];
  private playingId: string | null = null;
  private queued: readonly string[] = [];
  private byId = new Map<string, Track>();
  /** Ids tried this session that failed to decode/analyse — skip so the loop can't spin on them. */
  private readonly failed = new Set<string>();
  private decodeCtx: OfflineAudioContext | null = null;
  private readonly onVisibility = (): void => {
    if (!document.hidden) this.pump();
  };

  constructor(private readonly deps: AnalysisDeps) {
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVisibility);
  }

  /** Feed the latest library/queue state and (re)start the loop. */
  sync(ctx: AnalysisContext): void {
    this.tracks = ctx.tracks;
    this.playingId = ctx.playingId;
    this.queued = ctx.queued;
    this.byId = new Map(ctx.tracks.map((t) => [t.id, t]));
    this.pump();
  }

  dispose(): void {
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisibility);
    this.worker?.terminate();
    this.worker = null;
    this.pending = null;
  }

  // ---------------------------------------------------------------- loop

  private paused(): boolean {
    return (typeof document !== 'undefined' && document.hidden) || this.deps.isBusy();
  }

  private done(id: string): boolean {
    if (this.failed.has(id)) return true;
    const t = this.byId.get(id);
    return !t || hasLoudness(t);
  }

  private async pump(): Promise<void> {
    if (this.running || this.paused()) return;
    this.running = true;
    try {
      while (!this.paused()) {
        const list = analysisWorklist({
          all: this.tracks.map((t) => t.id),
          playingId: this.playingId,
          queued: this.queued,
          done: (id) => this.done(id),
        });
        const id = list[0];
        if (!id) break;
        await this.analyseOne(id);
        // Yield to the event loop between tracks so the UI stays responsive.
        await new Promise<void>((r) => setTimeout(r, 0));
      }
    } finally {
      this.running = false;
    }
  }

  // ---------------------------------------------------------------- one job

  private async analyseOne(id: string): Promise<void> {
    const track = this.byId.get(id);
    if (!track) {
      this.failed.add(id);
      return;
    }
    try {
      const file = await this.deps.getFile(track);
      if (!file) {
        this.failed.add(id);
        return;
      }
      const mono = await this.decodeMono(file);
      if (!mono) {
        this.failed.add(id);
        return;
      }
      const loudness = await this.measure(mono);
      if (loudness && Number.isFinite(loudness.lufs)) this.deps.onLoudness(track, loudness);
      else this.failed.add(id);
    } catch {
      this.failed.add(id);
    }
  }

  private async decodeMono(file: File): Promise<Float32Array | null> {
    try {
      this.decodeCtx ??= new OfflineAudioContext(1, 1, 44_100);
      const buf = await this.decodeCtx.decodeAudioData(await file.arrayBuffer());
      const channels: Float32Array[] = [];
      for (let c = 0; c < buf.numberOfChannels; c++) channels.push(buf.getChannelData(c));
      return downsampleTo(toMono(channels), buf.sampleRate, DECODE_RATE);
    } catch {
      return null;
    }
  }

  /** Measure in the worker; fall back to the main thread if the worker can't run. */
  private async measure(mono: Float32Array): Promise<LoudnessResult | null> {
    const w = this.ensureWorker();
    if (w) {
      try {
        const res = await this.post(w, mono);
        if (res.type === 'result') return res.loudness;
      } catch {
        this.workerBroken = true;
      }
    }
    try {
      return measureLoudness([mono], DECODE_RATE);
    } catch {
      return null;
    }
  }

  private ensureWorker(): Worker | null {
    if (this.workerBroken || typeof Worker === 'undefined') return null;
    if (this.worker) return this.worker;
    try {
      // Vite's global worker config emits every bundled worker as a classic/IIFE file under
      // /workers/ (so the Essentia worker, which needs importScripts, gets its scoped CSP). This
      // pure-DSP worker rides the same path: it has no eval, so the scoped 'unsafe-eval' goes
      // unused, and because /workers/ is excluded from the SW precache, offline analysis falls back
      // to the main-thread measure() below. Vite inlines the measureLoudness import at build time.
      const w = new Worker(new URL('../analysis/analysis-worker.ts', import.meta.url), { type: 'classic' });
      w.onmessage = (e: MessageEvent<AnalysisWorkerOut>) => {
        this.pending?.resolve(e.data);
        this.pending = null;
      };
      w.onerror = () => {
        this.workerBroken = true;
        this.pending = null;
      };
      this.worker = w;
      return w;
    } catch {
      this.workerBroken = true;
      return null;
    }
  }

  private post(w: Worker, mono: Float32Array): Promise<AnalysisWorkerOut> {
    return new Promise<AnalysisWorkerOut>((resolve, reject) => {
      const reqId = ++this.reqSeq;
      const timer = setTimeout(() => {
        if (this.pending) {
          this.pending = null;
          reject(new Error('analysis worker timeout'));
        }
      }, 30_000);
      this.pending = {
        resolve: (r) => {
          clearTimeout(timer);
          resolve(r);
        },
      };
      // `mono` is transferred; the runner has no further use for it after posting.
      const msg: AnalyseRequest = { type: 'analyse', reqId, mono, sampleRate: DECODE_RATE };
      w.postMessage(msg, [mono.buffer]);
    });
  }
}

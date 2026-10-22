/**
 * The background analysis runner (docs/ROADMAP.md §Phase 2). One job at a time: decode a track on
 * the main thread, down-mix to mono and down-sample to 22 050 Hz, hand the samples to the pure
 * analysis worker, and persist the returned TrackAnalysis (beat grid, downbeats, energy, sections,
 * drops, key) plus its loudness through the injected callback. The playing track goes first, then
 * the upcoming queue, then the rest of the library — see src/analysis/queue.ts.
 *
 * It pauses while the tab is hidden, and while an injected `isBusy()` says the render thread is
 * under load (on phones the host sets this while Now Playing is drawing), so analysis never fights
 * playback for the main thread. Best-effort: a decode or worker failure just marks that track done
 * so the loop moves on. "One decode, two results": loudness comes from the same pass.
 */
import { analyseSignal } from '../analysis/extract';
import type { AnalyseRequest, AnalysisWorkerOut } from '../analysis/analysis-worker';
import type { ExtractResult } from '../analysis/extract';
import { analysisWorklist } from '../analysis/queue';
import { downsampleTo, toMono } from '../ai/resample';
import { getAnalysisVersions } from './db';
import type { LoudnessResult } from './loudness';
import { ANALYSIS_VERSION, type Track, type TrackAnalysis } from './types';

/** The analysis decode rate: mono at 22 050 Hz halves memory (~21 MB for a 4-minute track). */
const DECODE_RATE = 22_050;

export interface AnalysisDeps {
  /** Resolve a track's audio file (linked folder, OPFS or blob store); null when unavailable. */
  getFile: (track: Track) => Promise<File | null>;
  /** A result landed — persist the analysis + loudness, and apply the trim if the track is playing. */
  onResult: (track: Track, analysis: TrackAnalysis, loudness: LoudnessResult) => void;
  /** The render thread is under load; hold off starting the next job. */
  isBusy: () => boolean;
}

export interface AnalysisContext {
  tracks: readonly Track[];
  playingId: string | null;
  /** Upcoming queue order (next tracks). */
  queued: readonly string[];
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
  /** trackId → stored version; a track is done when its version is current. */
  private analysed = new Map<string, number>();
  /** Ids tried this session that failed to decode/analyse — skip so the loop can't spin on them. */
  private readonly failed = new Set<string>();
  private decodeCtx: OfflineAudioContext | null = null;
  private ready = false;
  private readonly onVisibility = (): void => {
    if (!document.hidden) void this.pump();
  };

  constructor(private readonly deps: AnalysisDeps) {
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVisibility);
    void this.load();
  }

  /** Feed the latest library/queue state and (re)start the loop. */
  sync(ctx: AnalysisContext): void {
    this.tracks = ctx.tracks;
    this.playingId = ctx.playingId;
    this.queued = ctx.queued;
    this.byId = new Map(ctx.tracks.map((t) => [t.id, t]));
    void this.pump();
  }

  dispose(): void {
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisibility);
    this.worker?.terminate();
    this.worker = null;
    this.pending = null;
  }

  // ---------------------------------------------------------------- loop

  private async load(): Promise<void> {
    try {
      this.analysed = await getAnalysisVersions();
    } catch {
      this.analysed = new Map();
    }
    this.ready = true;
    void this.pump();
  }

  private paused(): boolean {
    return (typeof document !== 'undefined' && document.hidden) || this.deps.isBusy();
  }

  private done(id: string): boolean {
    return this.failed.has(id) || !this.byId.has(id) || this.analysed.get(id) === ANALYSIS_VERSION;
  }

  private async pump(): Promise<void> {
    if (!this.ready || this.running || this.paused()) return;
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
      const mono = file ? await this.decodeMono(file) : null;
      const result = mono ? await this.extract(mono) : null;
      if (!result || !Number.isFinite(result.loudness.lufs)) {
        this.failed.add(id);
        return;
      }
      const analysis: TrackAnalysis = {
        trackId: track.id,
        fileHash: track.fileHash,
        version: ANALYSIS_VERSION,
        beats: result.beats,
        bpm: result.bpm,
        beatConfidence: result.beatConfidence,
        firstDownbeat: result.firstDownbeat,
        energy: result.energy,
        sections: result.sections,
        drops: result.drops,
        key: result.key,
        analysedAt: Date.now(),
      };
      this.analysed.set(id, ANALYSIS_VERSION);
      this.deps.onResult(track, analysis, result.loudness);
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

  /** Extract in the worker; fall back to the main thread if the worker can't run. */
  private async extract(mono: Float32Array): Promise<ExtractResult | null> {
    const w = this.ensureWorker();
    if (w) {
      try {
        const res = await this.post(w, mono);
        if (res.type === 'result') return res.result;
      } catch {
        this.workerBroken = true;
      }
    }
    try {
      return analyseSignal(mono, DECODE_RATE);
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
      // to the main-thread extract() below. Vite inlines the extraction code at build time.
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
      }, 60_000);
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

import type { MoodId } from '../types';
import { readMood, type MoodProbs } from './mood-map';

/** One AI read: arousal/valence (0..1), the mood quadrant, and how long inference took. */
export interface AiMoodResult {
  arousal: number;
  valence: number;
  mood: MoodId;
  inferenceMs: number;
}

interface WorkerMsg {
  type: 'ready' | 'result' | 'error';
  reqId?: number;
  probs?: MoodProbs;
  inferenceMs?: number;
  message?: string;
}

const READY_TIMEOUT_MS = 20_000;
/** Longest clip we post for the refine pass; keeps the transfer and inference bounded. */
const REFINE_SECONDS = 90;
const LIVE_WINDOW_SECONDS = 10;
const LIVE_EVERY_MS = 3000;

/**
 * Owns the inference worker and the audio it is fed. The rule-based `MoodReader` stays the instant
 * fallback; this adds a real pre-trained read on top. Everything is best-effort: if the worker or a
 * model fails to load, or the worker never signals ready, it goes quiet and the app keeps the quick
 * read. Loaded lazily — the worker is only created once a source actually starts.
 */
export class AiMood {
  private worker: Worker | null = null;
  private ready = false;
  private failed = false;
  private enabled = true;
  private reqSeq = 0;
  private key = '';
  private readonly pending = new Map<number, string>();
  private captureNode: AudioWorkletNode | null = null;
  private liveInput: AudioNode | null = null;
  private rolling: Float32Array | null = null;
  private rollLen = 0;
  private liveSr = 16000;
  private liveTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly onRead: (r: AiMoodResult, songKey: string) => void) {}

  get isEnabled(): boolean {
    return this.enabled && !this.failed;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) this.stop();
  }

  /** Decode a file, read the first ~30 s quickly, then refine over the next slice of the track. */
  async analyzeFile(ctx: BaseAudioContext, file: File, key: string): Promise<void> {
    if (!this.isEnabled || !this.ensureWorker()) return;
    this.key = key;
    let buf: AudioBuffer;
    try {
      buf = await ctx.decodeAudioData(await file.arrayBuffer());
    } catch {
      return;
    }
    if (this.key !== key) return;
    const sr = buf.sampleRate;
    const mono = this.monoOf(buf);
    const quick = Math.min(mono.length, Math.floor(30 * sr));
    this.post([mono.slice(0, quick)], sr, key);
    const refine = Math.min(mono.length, Math.floor(REFINE_SECONDS * sr));
    if (refine > quick) this.post([mono.slice(0, refine)], sr, key);
  }

  /** Attach a capture worklet to a live source and run the model on a rolling window. */
  async analyzeLive(ctx: AudioContext, input: AudioNode, key: string): Promise<void> {
    if (!this.isEnabled || !this.ensureWorker()) return;
    this.key = key;
    this.liveSr = ctx.sampleRate;
    this.rolling = new Float32Array(Math.ceil(LIVE_WINDOW_SECONDS * this.liveSr));
    this.rollLen = 0;
    try {
      await ctx.audioWorklet.addModule('/capture-worklet.js');
    } catch {
      return;
    }
    if (this.key !== key) return;
    const node = new AudioWorkletNode(ctx, 'capture-processor');
    node.port.onmessage = (e) => this.pushLive(e.data as Float32Array);
    input.connect(node);
    node.connect(ctx.destination); // produces silence; keeps the node pulled by the graph
    this.captureNode = node;
    this.liveInput = input;
    this.liveTimer = setInterval(() => this.flushLive(key), LIVE_EVERY_MS);
  }

  /** Forget the current run: detach live capture and ignore any in-flight results. */
  stop(): void {
    this.key = '';
    this.pending.clear();
    if (this.liveTimer) {
      clearInterval(this.liveTimer);
      this.liveTimer = null;
    }
    if (this.captureNode) {
      try {
        this.liveInput?.disconnect(this.captureNode);
        this.captureNode.disconnect();
        this.captureNode.port.onmessage = null;
      } catch {
        /* already gone */
      }
      this.captureNode = null;
      this.liveInput = null;
    }
    this.rolling = null;
    this.rollLen = 0;
  }

  dispose(): void {
    this.stop();
    this.worker?.terminate();
    this.worker = null;
  }

  // ---------------------------------------------------------------- internals

  private ensureWorker(): Worker | null {
    if (this.failed || !this.enabled) return null;
    if (this.worker) return this.worker;
    try {
      const w = new Worker('/mood-worker.js');
      w.onmessage = (e) => this.onMessage(e.data as WorkerMsg);
      w.onerror = () => this.fail();
      setTimeout(() => {
        if (!this.ready) this.fail();
      }, READY_TIMEOUT_MS);
      this.worker = w;
      return w;
    } catch {
      this.fail();
      return null;
    }
  }

  /** Silent fallback: drop the worker so the app keeps the rule-based read. */
  private fail(): void {
    this.failed = true;
    this.stop();
    this.worker?.terminate();
    this.worker = null;
  }

  private onMessage(d: WorkerMsg): void {
    if (d.type === 'ready') {
      this.ready = true;
      return;
    }
    if (d.type === 'error') {
      // A model that won't run at all is a load failure; drop to the quick read.
      if (!this.ready || this.pending.size === 0) this.fail();
      if (d.reqId !== undefined) this.pending.delete(d.reqId);
      return;
    }
    if (d.type === 'result' && d.probs && d.reqId !== undefined) {
      const forKey = this.pending.get(d.reqId);
      this.pending.delete(d.reqId);
      if (!forKey || forKey !== this.key) return; // stale: the source changed
      const r = readMood(d.probs);
      this.onRead({ ...r, inferenceMs: d.inferenceMs ?? 0 }, forKey);
    }
  }

  private post(channels: Float32Array[], sampleRate: number, key: string): void {
    const w = this.worker;
    if (!w) return;
    const reqId = ++this.reqSeq;
    this.pending.set(reqId, key);
    w.postMessage(
      { type: 'pcm', reqId, channels, sampleRate },
      channels.map((c) => c.buffer),
    );
  }

  private monoOf(buf: AudioBuffer): Float32Array {
    if (buf.numberOfChannels === 1) return buf.getChannelData(0).slice(0);
    const n = buf.length;
    const out = new Float32Array(n);
    const k = 1 / buf.numberOfChannels;
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const ch = buf.getChannelData(c);
      for (let i = 0; i < n; i++) out[i] += ch[i] * k;
    }
    return out;
  }

  private pushLive(chunk: Float32Array): void {
    const buf = this.rolling;
    if (!buf) return;
    const L = buf.length;
    if (chunk.length >= L) {
      buf.set(chunk.subarray(chunk.length - L));
      this.rollLen = L;
      return;
    }
    if (this.rollLen + chunk.length > L) {
      const shift = this.rollLen + chunk.length - L;
      buf.copyWithin(0, shift, this.rollLen);
      this.rollLen -= shift;
    }
    buf.set(chunk, this.rollLen);
    this.rollLen += chunk.length;
  }

  private flushLive(key: string): void {
    if (this.key !== key || !this.rolling || this.rollLen < this.liveSr * 3) return;
    this.post([this.rolling.slice(0, this.rollLen)], this.liveSr, key);
  }
}

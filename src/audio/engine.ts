/**
 * Owns the AudioContext and the analysis graph.
 *
 *   sources ──► input ──┬──► analyser (bytes, smoothing 0.5) ──┐
 *                       ├──► analyser (float dB, no smoothing) ─┴──► mute ──► destination
 *                       └──► monitor ──► destination   (1 for file, 0 for mic/tab)
 *
 * Mic and tab audio must never be routed to the speakers (feedback, double audio), so
 * playback goes through a separate monitor gain instead of through the analysers.
 */
export interface AnalyserPair {
  bytes: AnalyserNode;
  floats: AnalyserNode;
}

export function createAnalysers(ctx: BaseAudioContext, input: AudioNode): AnalyserPair {
  const bytes = ctx.createAnalyser();
  bytes.fftSize = 2048;
  bytes.smoothingTimeConstant = 0.5;
  const floats = ctx.createAnalyser();
  floats.fftSize = 2048;
  floats.smoothingTimeConstant = 0;
  const mute = ctx.createGain();
  mute.gain.value = 0;
  input.connect(bytes);
  input.connect(floats);
  bytes.connect(mute);
  floats.connect(mute);
  mute.connect(ctx.destination);
  return { bytes, floats };
}

export class AudioEngine {
  ctx: AudioContext | null = null;
  input: GainNode | null = null;
  analysers: AnalyserPair | null = null;
  private monitor: GainNode | null = null;

  /** Create (once) and resume the context. Must be called from a user gesture the first time. */
  ensure(): AudioContext | null {
    try {
      if (!this.ctx) {
        const Ctor: typeof AudioContext | undefined =
          window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return null;
        const ctx = new Ctor({ latencyHint: 'interactive' });
        const input = ctx.createGain();
        input.gain.value = 0.9;
        const monitor = ctx.createGain();
        input.connect(monitor);
        monitor.connect(ctx.destination);
        this.ctx = ctx;
        this.input = input;
        this.monitor = monitor;
        this.analysers = createAnalysers(ctx, input);
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return this.ctx;
    } catch {
      return null;
    }
  }

  /** Hear the analysed signal (file) or keep it silent (mic, tab). */
  setMonitor(on: boolean): void {
    if (!this.monitor || !this.ctx) return;
    this.monitor.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.01);
  }

  get running(): boolean {
    return this.ctx?.state === 'running';
  }

  /** Output latency the browser reports, in ms (Bluetooth is typically 150–250). */
  latencyMs(): number {
    const ctx = this.ctx;
    if (!ctx) return 0;
    return ((ctx.outputLatency || 0) + (ctx.baseLatency || 0)) * 1000;
  }
}

/**
 * The demo beat: a 32-bar, 118 BPM track synthesised live with Web Audio
 * (intro, build, drop, peak, break), scheduled 120 ms ahead on a 25 ms timer.
 */
export type Section = 'intro' | 'build' | 'drop' | 'peak' | 'break';

const BPM = 118;
const STEPS = 512; // 32 bars of 16th notes

export const STEP_SECONDS = 60 / BPM / 4;

export function sectionOf(bar: number): Section {
  return bar < 8 ? 'intro' : bar < 16 ? 'build' : bar < 24 ? 'drop' : bar < 28 ? 'peak' : 'break';
}

const mtof = (n: number): number => 440 * Math.pow(2, (n - 69) / 12);

export class DemoSynth {
  /** 0..1 loudness hint for the current section; blended into intensity so the ladder follows the song form. */
  hint = 0.12;
  private bus: GainNode | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private step = 0;
  private next = 0;
  private baseStep = 0;
  private baseTime = 0;
  private readonly noise: AudioBuffer;

  constructor(
    private readonly ctx: AudioContext,
    private readonly out: AudioNode,
  ) {
    const len = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  start(): void {
    this.stop();
    const bus = this.ctx.createGain();
    bus.gain.value = 0.5;
    bus.connect(this.out);
    this.bus = bus;
    const t0 = this.ctx.currentTime + 0.08;
    this.step = 0;
    this.next = t0;
    this.baseStep = 0;
    this.baseTime = t0;
    this.hint = 0.12;
    this.resume();
  }

  stop(): void {
    this.pause();
    const b = this.bus;
    if (!b) return;
    try {
      b.gain.setTargetAtTime(0, this.ctx.currentTime, 0.02);
    } catch {}
    setTimeout(() => {
      try {
        b.disconnect();
      } catch {}
    }, 200);
    this.bus = null;
  }

  pause(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  resume(): void {
    if (!this.bus) return;
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => this.schedule(), 25);
  }

  get active(): boolean {
    return this.bus !== null;
  }

  /** The 16th-note step that is audible right now. */
  audibleStep(): number {
    const n = Math.floor((this.ctx.currentTime - this.baseTime) / STEP_SECONDS);
    return (((this.baseStep + Math.max(0, n)) % STEPS) + STEPS) % STEPS;
  }

  /** Song position in seconds, wrapped to the 32-bar loop (drives the demo lyrics). */
  songTime(): number {
    const st = (this.ctx.currentTime - this.baseTime) / STEP_SECONDS + this.baseStep;
    return (((st % STEPS) + STEPS) % STEPS) * STEP_SECONDS;
  }

  private schedule(): void {
    if (!this.bus) return;
    while (this.next < this.ctx.currentTime + 0.12) {
      this.playStep(this.step, this.next);
      this.next += STEP_SECONDS;
      this.step = (this.step + 1) % STEPS;
    }
  }

  private env(g: GainNode, t: number, a: number, peak: number, d: number): void {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  private playStep(step: number, t: number): void {
    const bar = Math.floor(step / 16);
    const st = step % 16;
    const sec = sectionOf(bar);
    const ch = bar % 4;
    const roots = [33, 29, 36, 31];
    const spb = STEP_SECONDS;
    this.hint =
      sec === 'intro'
        ? 0.12
        : sec === 'build'
          ? 0.32 + ((bar - 8) / 8) * 0.3
          : sec === 'drop'
            ? 0.72
            : sec === 'peak'
              ? 0.95
              : 0.14;
    if (sec === 'intro') {
      if (bar >= 4 && st % 4 === 0) this.kick(t, 0.5);
    } else if (sec === 'build') {
      if (st % 4 === 0) this.kick(t, 0.75);
      if (bar === 15 && st >= 8 && st % 2 === 0) this.kick(t, 0.55);
    } else if (sec === 'drop' || sec === 'peak') {
      if (st % 4 === 0) this.kick(t, 0.95);
    } else if (st === 0 && bar % 2 === 0) this.kick(t, 0.4);
    if ((sec === 'build' || sec === 'drop' || sec === 'peak') && (st === 4 || st === 12))
      this.snare(t, sec === 'build' ? 0.5 : 0.8);
    if (sec === 'build' && bar === 15 && st >= 8) this.snare(t, 0.2 + (st - 8) * 0.06);
    if (sec === 'intro' || sec === 'break') {
      if (st % 4 === 2) this.hat(t, 0.18, false);
    } else if (sec === 'build') {
      if (st % 2 === 1) this.hat(t, 0.24, false);
    } else this.hat(t, st % 2 ? 0.26 : 0.14, st % 8 === 6);
    if (sec !== 'break' && [0, 3, 6, 10, 12, 14].includes(st))
      this.bass(t, roots[ch] + (st === 10 ? 12 : 0), sec === 'intro' ? 0.28 : 0.5, spb * 1.8);
    if (sec === 'drop' || sec === 'peak' || (sec === 'build' && bar >= 12)) {
      const tones = [
        [69, 72, 76, 81],
        [65, 69, 72, 77],
        [72, 76, 79, 84],
        [67, 71, 74, 79],
      ][ch];
      if (sec !== 'build' || st % 2 === 0)
        this.lead(t, tones[st % 4] + (st >= 8 ? 12 : 0), sec === 'build' ? 0.06 : 0.09);
    }
    if (sec === 'peak' && st % 4 === 3) this.stab(t);
    if (bar === 12 && st === 0) this.riser(t, 64 * spb);
    if ((bar === 16 || bar === 24) && st === 0) this.crash(t);
    if ((sec === 'intro' || sec === 'break') && st === 0 && bar % 2 === 0) this.pad(t, ch, 32 * spb);
  }

  private noiseSrc(t: number, dur: number, loop = false): AudioBufferSourceNode {
    const n = this.ctx.createBufferSource();
    n.buffer = this.noise;
    n.loop = loop;
    n.start(t, Math.random() * 0.5);
    n.stop(t + dur);
    return n;
  }

  private connect(...chain: AudioNode[]): void {
    for (let i = 0; i < chain.length - 1; i++) chain[i].connect(chain[i + 1]);
    if (this.bus) chain[chain.length - 1].connect(this.bus);
  }

  private kick(t: number, v: number): void {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    this.env(g, t, 0.004, v, 0.36);
    this.connect(o, g);
    o.start(t);
    o.stop(t + 0.42);
  }

  private snare(t: number, v: number): void {
    const n = this.noiseSrc(t, 0.25);
    const f = this.ctx.createBiquadFilter();
    const g = this.ctx.createGain();
    f.type = 'bandpass';
    f.frequency.value = 1800;
    f.Q.value = 0.8;
    this.env(g, t, 0.002, v * 0.6, 0.18);
    this.connect(n, f, g);
    const o = this.ctx.createOscillator();
    const og = this.ctx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(190, t);
    this.env(og, t, 0.002, v * 0.4, 0.09);
    this.connect(o, og);
    o.start(t);
    o.stop(t + 0.12);
  }

  private hat(t: number, v: number, open: boolean): void {
    const d = open ? 0.24 : 0.045;
    const n = this.noiseSrc(t, d + 0.05);
    const f = this.ctx.createBiquadFilter();
    const g = this.ctx.createGain();
    f.type = 'highpass';
    f.frequency.value = 7000;
    this.env(g, t, 0.001, v, d);
    this.connect(n, f, g);
  }

  private bass(t: number, note: number, v: number, dur: number): void {
    const o = this.ctx.createOscillator();
    const f = this.ctx.createBiquadFilter();
    const g = this.ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(mtof(note), t);
    f.type = 'lowpass';
    f.Q.value = 5;
    f.frequency.setValueAtTime(900, t);
    f.frequency.exponentialRampToValueAtTime(220, t + dur);
    this.env(g, t, 0.008, v, dur);
    this.connect(o, f, g);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private lead(t: number, note: number, v: number): void {
    const o = this.ctx.createOscillator();
    const f = this.ctx.createBiquadFilter();
    const g = this.ctx.createGain();
    o.type = 'square';
    o.frequency.setValueAtTime(mtof(note), t);
    f.type = 'lowpass';
    f.frequency.value = 3600;
    this.env(g, t, 0.004, v, 0.14);
    this.connect(o, f, g);
    o.start(t);
    o.stop(t + 0.2);
  }

  private stab(t: number): void {
    const o = this.ctx.createOscillator();
    const f = this.ctx.createBiquadFilter();
    const g = this.ctx.createGain();
    o.type = 'square';
    o.frequency.setValueAtTime(3520, t);
    o.frequency.exponentialRampToValueAtTime(5200, t + 0.05);
    f.type = 'highpass';
    f.frequency.value = 2500;
    this.env(g, t, 0.002, 0.07, 0.06);
    this.connect(o, f, g);
    o.start(t);
    o.stop(t + 0.1);
  }

  private riser(t: number, dur: number): void {
    const n = this.noiseSrc(t, dur, true);
    const f = this.ctx.createBiquadFilter();
    const g = this.ctx.createGain();
    f.type = 'bandpass';
    f.Q.value = 2;
    f.frequency.setValueAtTime(400, t);
    f.frequency.exponentialRampToValueAtTime(8000, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + dur);
    this.connect(n, f, g);
  }

  private crash(t: number): void {
    const n = this.noiseSrc(t, 1.6, true);
    const f = this.ctx.createBiquadFilter();
    const g = this.ctx.createGain();
    f.type = 'highpass';
    f.frequency.value = 5000;
    this.env(g, t, 0.002, 0.25, 1.4);
    this.connect(n, f, g);
  }

  private pad(t: number, ch: number, dur: number): void {
    const notes = [
      [57, 60, 64],
      [53, 57, 60],
      [60, 64, 67],
      [55, 59, 62],
    ][ch];
    const f = this.ctx.createBiquadFilter();
    const g = this.ctx.createGain();
    f.type = 'lowpass';
    f.frequency.value = 900;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05, t + 0.6);
    g.gain.setValueAtTime(0.05, t + dur - 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    this.connect(f, g);
    notes.forEach((nn, i) => {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = mtof(nn);
      o.detune.value = (i - 1) * 7;
      o.connect(f);
      o.start(t);
      o.stop(t + dur + 0.05);
    });
  }
}

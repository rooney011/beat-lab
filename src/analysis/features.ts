import type { Analysis, Features } from '../types';
import type { AnalyserPair } from '../audio/engine';

/** Spectrum of the current frame, shared with the mood reader. */
export interface Spectrum {
  bytes: Uint8Array;
  /** Hz per bin. */
  hz: number;
  bins: number;
  /** dB span represented by 0..255 in the byte spectrum. */
  dbRange: number;
}

export interface FrameInput {
  /** The context is running and a source is playing: analyse real audio. */
  live: boolean;
  playing: boolean;
  hasSource: boolean;
  /** Section loudness hint from the demo synth, blended into intensity. */
  demoHint: number | null;
}

export const NUM_BARS = 48;
export const WAVE_POINTS = 160;
const STRING_MODES = 5;
const BAND_EDGES = [20, 60, 250, 500, 2000, 4000, 6000, 10000, 16000];

/**
 * Turns two AnalyserNodes into per-frame features.
 *
 * Beats: positive spectral flux over 20–280 Hz above an adaptive threshold (mean × 1.5 + 0.01),
 * gated by the kick band's share of total power (> −28 dB) and a 2-frame rise of ≥ 1.5 dB.
 * A 230 ms refractory window applies, except that a clearly stronger onset replaces a weaker one.
 */
export class FeatureExtractor {
  readonly f: Features = {
    beat: false,
    strong: false,
    snare: false,
    replaced: false,
    spark: 0,
    pulse: 0,
    mids: 0,
    highs: 0,
    intensity: 0,
    db: -90,
    silent: false,
    bands: new Float32Array(8),
  };
  readonly bars = new Float32Array(NUM_BARS);
  readonly peaks = new Float32Array(NUM_BARS);
  readonly wave = new Float32Array(WAVE_POINTS);
  /** First string mode (half sine) — also the envelope the renderer jitters along. */
  readonly sinT: Float32Array[] = [];

  private an: AnalyserPair | null = null;
  private sampleRate = 44100;
  private fb = new Uint8Array(1024);
  private tb = new Uint8Array(2048);
  private prev = new Float32Array(1024);
  private ff = new Float32Array(1024);
  private readonly rb = new Float32Array(8);
  private readonly peak = new Float32Array(8);
  private readonly bands = new Float32Array(8);
  private readonly peakVel = new Float32Array(NUM_BARS);
  private fluxLow: number[] = [];
  private fluxMid: number[] = [];
  private fluxHigh: number[] = [];
  private kickHist: number[] = [];
  private lastBeat = -9999;
  private lastFlux = 0;
  private lastSnare = -9999;
  private pulse = 0;
  private peakK = 1e-9;
  private loudLin = 0;
  private peakL = 1e-4;
  private lvl = 0;
  private hist: number[] = [];
  private histT = 0;
  private silentFor = 0;
  private readonly strPh = new Float32Array(STRING_MODES);
  private readonly strA = new Float32Array(STRING_MODES);
  private readonly trig = new Float32Array(WAVE_POINTS);
  private pluck = 0;
  /** Last analysed spectrum (valid after a live frame). */
  spectrum: Spectrum | null = null;
  /** Long-window loudness; exposed for the HUD. */
  get level(): number {
    return this.lvl;
  }

  constructor() {
    for (let m = 0; m < STRING_MODES; m++) {
      const row = new Float32Array(WAVE_POINTS);
      for (let i = 0; i < WAVE_POINTS; i++) row[i] = Math.sin(((m + 1) * Math.PI * i) / (WAVE_POINTS - 1));
      this.sinT.push(row);
    }
  }

  attach(an: AnalyserPair, sampleRate: number): void {
    this.an = an;
    this.sampleRate = sampleRate;
    this.fb = new Uint8Array(an.bytes.frequencyBinCount);
    this.tb = new Uint8Array(an.bytes.fftSize);
    this.prev = new Float32Array(an.bytes.frequencyBinCount);
    this.ff = new Float32Array(an.floats.frequencyBinCount);
  }

  /** Forget the loudness history so a new song is judged on its own range. */
  newSong(): void {
    this.hist = [];
    this.lvl = 0.1;
  }

  update(t: number, dt: number, input: FrameInput): Analysis {
    const f = this.f;
    f.beat = false;
    f.strong = false;
    f.spark = 0;
    f.snare = false;
    f.replaced = false;
    const an = this.an;
    if (!input.live || !an) {
      const b = 0.5 + 0.5 * Math.sin(t * 0.0012);
      this.pulse += (0.1 + 0.12 * b - this.pulse) * 0.05;
      for (let i = 0; i < 8; i++) {
        const v = (0.1 + 0.07 * Math.sin(t * 0.001 + i)) * (input.hasSource ? 0.4 : 1);
        this.bands[i] += (v - this.bands[i]) * 0.05;
        f.bands[i] = this.bands[i];
      }
      f.pulse = this.pulse;
      f.mids = 0.15 + 0.1 * b;
      f.highs = 0.05;
      f.intensity = this.lvl;
      f.db = -90;
      f.silent = false;
      this.spectrum = null;
      this.updateBars(null, 0, 0, dt, t, input);
      this.updateString(null, t, dt, input.playing);
      return this.out();
    }

    const fb = this.fb;
    const tb = this.tb;
    const prev = this.prev;
    an.bytes.getByteFrequencyData(fb);
    an.bytes.getByteTimeDomainData(tb);
    const N = fb.length;
    const hz = this.sampleRate / an.bytes.fftSize;
    const raw = (lo: number, hi: number): number => {
      const i0 = Math.max(1, Math.floor(lo / hz));
      let i1 = Math.min(N - 1, Math.ceil(hi / hz));
      if (i1 < i0) i1 = i0;
      let s = 0;
      for (let i = i0; i <= i1; i++) s += fb[i];
      return s / ((i1 - i0 + 1) * 255);
    };
    const rb = this.rb;
    for (let i = 0; i < 8; i++) {
      const v = raw(BAND_EDGES[i], BAND_EDGES[i + 1]);
      rb[i] = v;
      this.peak[i] = Math.max(v, this.peak[i] * 0.995);
      this.bands[i] = Math.min(1, v / Math.max(this.peak[i], 0.12));
      f.bands[i] = this.bands[i];
    }

    // Positive spectral flux in three regions.
    const iL = Math.max(2, Math.ceil(280 / hz));
    const iH0 = Math.floor(2000 / hz);
    const iH1 = Math.min(N - 1, Math.ceil(16000 / hz));
    const iM0 = Math.floor(300 / hz);
    const iM1 = Math.min(N - 1, Math.ceil(4000 / hz));
    let fl = 0;
    let fh = 0;
    let fm = 0;
    for (let i = 1; i < N; i++) {
      const v = fb[i] / 255;
      const d = v - prev[i];
      if (d > 0) {
        if (i <= iL) fl += d;
        if (i >= iM0 && i <= iM1) fm += d;
        if (i >= iH0 && i <= iH1) fh += d;
      }
      prev[i] = v;
    }
    fl /= iL;
    fh /= iH1 - iH0 + 1;
    fm /= iM1 - iM0 + 1;

    // Kick-band (30–150 Hz) power from the unsmoothed float spectrum.
    const ff = this.ff;
    const hzF = this.sampleRate / an.floats.fftSize;
    an.floats.getFloatFrequencyData(ff);
    let kE = 0;
    let tot = 0;
    const k0 = Math.max(1, Math.floor(30 / hzF));
    const k1 = Math.min(ff.length - 1, Math.ceil(150 / hzF));
    for (let i = 1; i < ff.length; i++) {
      const e = Math.pow(10, ff[i] / 10);
      tot += e;
      if (i >= k0 && i <= k1) kE += e;
    }
    const share = 10 * Math.log10((kE + 1e-12) / (tot + 1e-12));
    const lk = 10 * Math.log10(kE + 1e-12);
    const kh = this.kickHist;
    kh.push(lk);
    if (kh.length > 3) kh.shift();
    const rise2 = kh.length === 3 ? lk - Math.min(kh[0], kh[1]) : 0;

    const h1 = this.fluxLow;
    h1.push(fl);
    if (h1.length > 42) h1.shift();
    let m = 0;
    for (let i = 0; i < h1.length; i++) m += h1[i];
    m /= h1.length;
    const thr = m * 1.5 + 0.01;
    const since = t - this.lastBeat;
    if (h1.length > 8 && fl > thr && share > -28 && rise2 > 1.5) {
      if (since > 230) {
        f.beat = true;
      } else if (fl > this.lastFlux * 1.3) {
        f.beat = true;
        f.replaced = true;
      }
      if (f.beat) {
        this.lastBeat = t;
        this.lastFlux = fl;
        f.strong = fl / thr >= 1.8;
      }
    }

    const h3 = this.fluxMid;
    h3.push(fm);
    if (h3.length > 42) h3.shift();
    let mm = 0;
    for (let i = 0; i < h3.length; i++) mm += h3[i];
    mm /= h3.length;
    const thrM = mm * 1.6 + 0.006;
    if (h3.length > 8 && fm > thrM && t - this.lastSnare > 180 && !f.beat) {
      f.snare = true;
      this.lastSnare = t;
    }

    const h2 = this.fluxHigh;
    h2.push(fh);
    if (h2.length > 42) h2.shift();
    let mh = 0;
    for (let i = 0; i < h2.length; i++) mh += h2[i];
    mh /= h2.length;
    const thrH = mh * 1.4 + 0.004;
    if (h2.length > 8 && fh > thrH) f.spark = Math.min(8, 1 + Math.round((fh / thrH - 1) * 6));

    let ss = 0;
    for (let i = 0; i < tb.length; i++) {
      const v = (tb[i] - 128) / 128;
      ss += v * v;
    }
    const rms = Math.sqrt(ss / tb.length);
    const db = 20 * Math.log10(rms + 1e-9);

    // Pulse: kick power over its slow-decaying peak; 10 ms attack, 120 ms release; forced up on beats.
    this.peakK = Math.max(kE, this.peakK * 0.997);
    const target = Math.sqrt(kE / this.peakK);
    this.loudLin = rms;
    this.peakL = Math.max(rms, this.peakL * 0.998);
    this.pulse += (target - this.pulse) * (1 - Math.exp(-dt / (target > this.pulse ? 0.01 : 0.12)));
    if (f.beat) this.pulse = Math.max(this.pulse, f.strong ? 1 : 0.85);

    // Intensity: long-window loudness, rescaled against this song's own 10th–95th percentile.
    const rmsN = Math.max(0, Math.min(1, (db + 42) / 36));
    let e = 0.6 * rmsN + 0.25 * Math.min(1, (rb[3] + rb[4]) * 1.6) + 0.15 * Math.min(1, (rb[5] + rb[6] + rb[7]) * 2.2);
    if (input.demoHint !== null) e = 0.55 * e + 0.45 * input.demoHint;
    this.lvl += (e - this.lvl) * (1 - Math.exp(-dt / 1.5));
    if (t - this.histT > 250) {
      this.histT = t;
      this.hist.push(this.lvl);
      if (this.hist.length > 120) this.hist.shift();
    }
    let I = this.lvl;
    if (this.hist.length >= 24) {
      const srt = this.hist.slice().sort((x, y) => x - y);
      const p10 = srt[Math.floor(srt.length * 0.1)];
      const p95 = srt[Math.min(srt.length - 1, Math.floor(srt.length * 0.95))];
      I = 0.5 * this.lvl + 0.5 * Math.max(0, Math.min(1, (this.lvl - p10) / (p95 - p10 + 0.05)));
    }
    this.silentFor = db < -55 ? this.silentFor + dt : 0;
    f.pulse = this.pulse;
    f.mids = this.bands[3];
    f.highs = Math.max(this.bands[5], this.bands[6]);
    f.intensity = I;
    f.db = db;
    f.silent = this.silentFor > 4;
    this.spectrum = { bytes: fb, hz, bins: N, dbRange: an.bytes.maxDecibels - an.bytes.minDecibels };
    this.updateBars(fb, hz, N, dt, t, input);
    this.updateString(tb, t, dt, input.playing);
    return this.out();
  }

  private out(): Analysis {
    return { f: this.f, bars: this.bars, peaks: this.peaks, wave: this.wave };
  }

  /** 48 log-spaced bars (40 Hz – 14 kHz), fast rise, linear fall, with falling peak caps. */
  private updateBars(fb: Uint8Array | null, hz: number, N: number, dt: number, t: number, input: FrameInput): void {
    const nb = NUM_BARS;
    const lo = 40;
    const hi = 14000;
    const b = this.bars;
    const pk = this.peaks;
    const pv = this.peakVel;
    for (let i = 0; i < nb; i++) {
      let v: number;
      if (fb) {
        const f0 = lo * Math.pow(hi / lo, i / nb);
        const f1 = lo * Math.pow(hi / lo, (i + 1) / nb);
        const i0 = Math.max(1, Math.floor(f0 / hz));
        const i1 = Math.min(N - 1, Math.max(i0, Math.ceil(f1 / hz)));
        let mx = 0;
        for (let j = i0; j <= i1; j++) if (fb[j] > mx) mx = fb[j];
        v = Math.min(1, Math.pow(mx / 255, 1.6) * (1 + (i / nb) * 0.9));
      } else {
        v =
          Math.max(0, 0.12 + 0.1 * Math.sin(t * 0.002 + i * 0.35) + 0.06 * Math.sin(t * 0.0013 - i * 0.6)) *
          (input.hasSource && !input.playing ? 0.4 : 1);
      }
      if (v > b[i]) b[i] += (v - b[i]) * 0.6;
      else b[i] = Math.max(0, b[i] - dt * 1.6);
      if (b[i] > pk[i]) {
        pk[i] = b[i];
        pv[i] = 0;
      } else {
        pv[i] += dt * 2.2;
        pk[i] = Math.max(0, pk[i] - pv[i] * dt);
      }
    }
  }

  /**
   * The "plucked string": five standing-wave modes (4 + 3m Hz) weighted by the spectrum, phases reset
   * on every beat so the whole string snaps on the kick, plus a 10% trace of the real waveform.
   */
  private updateString(tb: Uint8Array | null, t: number, dt: number, playing: boolean): void {
    const n = WAVE_POINTS;
    const w = this.wave;
    const M = STRING_MODES;
    dt = dt || 0.016;
    this.pluck *= Math.exp(-dt / 0.15);
    if (this.f.beat && playing) {
      this.pluck = Math.max(this.pluck, this.f.strong ? 1 : 0.7);
      this.strPh.fill(0);
    }
    const per = NUM_BARS / M;
    for (let m = 0; m < M; m++) {
      let g = 0;
      for (let b = Math.floor(m * per); b < Math.floor((m + 1) * per); b++) g += this.bars[b];
      this.strA[m] += (g / per - this.strA[m]) * 0.3;
      this.strPh[m] += dt * 2 * Math.PI * (4 + 3 * m);
    }
    if (tb) {
      let i0 = 0;
      let best = -1;
      const span = n * 6;
      for (let i = 1; i < tb.length - span - 1 && i < tb.length / 2; i++) {
        const a0 = tb[i - 1] - 128;
        const a1 = tb[i + 1] - 128;
        if (a0 < 0 && a1 >= 0 && a1 - a0 > best) {
          best = a1 - a0;
          i0 = i;
        }
      }
      let mx = 1e-3;
      for (let i = 0; i < n; i++) {
        const v = (tb[i0 + i * 6] - 128) / 128;
        this.trig[i] = v;
        mx = Math.max(mx, Math.abs(v));
      }
      for (let i = 0; i < n; i++) this.trig[i] /= mx;
    } else for (let i = 0; i < n; i++) this.trig[i] *= 0.9;
    const loud = tb && this.peakL ? Math.min(1, this.loudLin / this.peakL) : 0.25;
    const A = playing ? 0.1 + 0.27 * loud + 1.0 * this.pluck : 0.15;
    let sa = 0;
    for (let m = 0; m < M; m++) sa += 0.25 + this.strA[m];
    for (let i = 0; i < n; i++) {
      let y = 0;
      for (let m = 0; m < M; m++)
        y += (0.25 + this.strA[m]) * this.sinT[m][i] * Math.cos(this.strPh[m] + (playing ? 0 : t * 0.002 * (m + 1)));
      w[i] = A * (y / sa) + 0.1 * loud * this.trig[i] * this.sinT[0][i];
    }
  }
}

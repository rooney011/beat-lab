import type { Features, MoodId } from '../types';
import { hash, seededRandom } from '../util/rand';
import type { Spectrum } from './features';

/** Per-song state: a seeded look plus the running statistics the mood is read from. */
export interface SongProfile {
  key: string;
  /** Swap the first two ink plates for this song. */
  swap: boolean;
  /** Background angle offset (radians). */
  angle: number;
  /** Extra sunburst rays: 0, 2 or 4. */
  rayExtra: number;
  t: number;
  n: number;
  tilt: number;
  env: number;
  punch: number;
  onsets: number;
  beatTs: number[];
  decided: number;
  lastEst: number;
  /** Tempo estimate used by the dancers' beat clock, refreshed every 2 s after 4 s. */
  clockBpm: number;
  // Read-outs after a decision:
  A: number;
  V: number;
  conf: number;
  punchV: number;
  rate: number;
  tiltDb: number;
}

export interface MoodDecision {
  mood: MoodId;
  /** Shown only when the tempo estimate is confident and the track is punchy. 0 = hide. */
  bpm: number;
  first: boolean;
}

export interface TempoEstimate {
  bpm: number;
  conf: number;
}

/** Weight per beat multiple (1 = one beat apart, 2 = two beats, …). Favours 1, 2 and 4. */
const MULTIPLE_WEIGHTS = [0, 1, 0.6, 0.15, 0.35, 0.05, 0.1, 0.03, 0.2];

/**
 * Tempo from onset times: score every BPM in 70–180 by how well all pairwise inter-onset intervals
 * (up to 4 s) land on integer multiples of its period, times a log-gaussian prior around `center`.
 */
export function estimateTempo(ts: readonly number[], center = 120): TempoEstimate {
  if (ts.length < 6) return { bpm: 0, conf: 0 };
  const d: number[] = [];
  for (let i = 0; i < ts.length; i++) {
    for (let j = i + 1; j < ts.length; j++) {
      const x = (ts[j] - ts[i]) / 1000;
      if (x > 4) break;
      d.push(x);
    }
  }
  let best = 0;
  let bestS = -1;
  for (let bpm = 70; bpm <= 180; bpm++) {
    const T = 60 / bpm;
    let sc = 0;
    for (let i = 0; i < d.length; i++) {
      const m = Math.round(d[i] / T);
      if (m < 1 || m > 8) continue;
      const e = d[i] - m * T;
      sc += Math.exp(-(e * e) / 0.00125) * MULTIPLE_WEIGHTS[m];
    }
    sc *= Math.exp(-0.5 * Math.pow(Math.log2(bpm / center), 2));
    if (sc > bestS) {
      bestS = sc;
      best = bpm;
    }
  }
  return { bpm: best, conf: bestS / Math.max(1, d.length) };
}

const cl = (x: number): number => Math.max(0, Math.min(1, x));

/** Arousal × valence → one of four moods. */
export function classifyMood(arousal: number, valence: number): MoodId {
  return arousal >= 0.5 ? (valence >= 0.5 ? 'hype' : 'grit') : valence >= 0.5 ? 'dreamy' : 'brooding';
}

/**
 * Reads a song's mood without a model: arousal from onset rate, tempo (× confidence) and punch;
 * valence from spectral tilt (2–8 kHz vs 60–250 Hz). Decided at 8 s and refined at 30 s.
 */
export class MoodReader {
  profile: SongProfile | null = null;

  reset(key: string): SongProfile {
    const r = seededRandom(hash(key));
    this.profile = {
      key,
      swap: r() < 0.5,
      angle: r() * Math.PI,
      rayExtra: Math.floor(r() * 3) * 2,
      t: 0,
      n: 0,
      tilt: 0,
      env: 0,
      punch: 0,
      onsets: 0,
      beatTs: [],
      decided: 0,
      lastEst: 0,
      clockBpm: 0,
      A: 0,
      V: 0,
      conf: 0,
      punchV: 0,
      rate: 0,
      tiltDb: 0,
    };
    return this.profile;
  }

  /** Feed one analysed frame (skip frames with no live audio). Returns a decision at 8 s and again at 30 s. */
  observe(f: Features, dt: number, t: number, spec: Spectrum | null): MoodDecision | null {
    const P = this.profile;
    if (!P || !spec) return null;
    if (f.replaced && P.beatTs.length) P.beatTs.pop();
    P.t += dt;
    if (f.db > -50) {
      const { bytes, hz, bins } = spec;
      const band = (lo: number, hi: number): number => {
        const i0 = Math.max(1, Math.floor(lo / hz));
        const i1 = Math.min(bins - 1, Math.ceil(hi / hz));
        let s = 0;
        for (let i = i0; i <= i1; i++) s += bytes[i];
        return s / (i1 - i0 + 1);
      };
      P.tilt += (band(2000, 8000) - band(60, 250)) * (spec.dbRange / 255);
      P.n++;
      const lin = Math.pow(10, f.db / 20);
      P.env = P.env ? P.env + (lin - P.env) * (1 - Math.exp(-dt / 0.4)) : lin;
      P.punch += Math.abs(lin - P.env) / (P.env + 1e-4);
    }
    if (f.beat) {
      P.beatTs.push(t);
      if (P.beatTs.length > 96) P.beatTs.shift();
    }
    if (P.t > 4 && P.t - P.lastEst > 2) {
      P.lastEst = P.t;
      const pn = P.punch / Math.max(1, P.n);
      const e = estimateTempo(P.beatTs, pn < 0.12 ? 90 : 120);
      if (e.conf > 0.06) P.clockBpm = e.bpm;
    }
    if (f.beat || f.snare) P.onsets++;
    if ((P.decided === 0 && P.t > 8) || (P.decided === 1 && P.t > 30)) return this.decide(P);
    return null;
  }

  private decide(P: SongProfile): MoodDecision {
    const tilt = P.tilt / Math.max(1, P.n);
    const rate = P.onsets / Math.max(1, P.t);
    const punch = P.punch / Math.max(1, P.n);
    const est = estimateTempo(P.beatTs, punch < 0.12 ? 90 : 120);
    const A = cl(
      0.3 * cl(rate / 4.5) + 0.3 * cl((est.bpm - 70) / 90) * cl(est.conf / 0.35) + 0.4 * cl((punch - 0.05) / 0.25),
    );
    const V = cl((tilt + 30) / 20);
    Object.assign(P, { A, V, rate, conf: est.conf, punchV: punch, tiltDb: tilt });
    const first = P.decided === 0;
    P.decided++;
    const showBpm = est.conf >= 0.1 && punch >= 0.1;
    return { mood: classifyMood(A, V), bpm: showBpm ? Math.round(est.bpm) : 0, first };
  }
}

/**
 * Two-deck playback. The current track plays on one deck, the next loads on the other, and an
 * equal-power crossfade swaps between them. Each deck is `<audio>` → trim gain (loudness levelling)
 * → fade gain → the shared analysis input, so the visualizer sees exactly what is heard — crossfades
 * included. Single-track playback (file open, or a library track with no crossfade) just uses the
 * active deck, mirroring the old FileSource behaviour.
 *
 * Milestone 4.1 adds a per-deck low-shelf EQ and tempo-stretch (`playbackRate`, `preservesPitch`) so
 * `beatMatch` can run a DJ-style transition: start B on A's downbeat at a matched rate, phase-lock it
 * for a few bars, swap the bass on a downbeat, then ease B's rate back to 1.0.
 */
import type { TransitionPlan } from '../analysis/mix';
import { nudgeRate } from '../analysis/phaselock';

export interface DeckTrack {
  /** Library track id, or null for an ad-hoc file. */
  id: string | null;
  /** Loudness trim in dB (0 = unity). */
  gainDb: number;
}

interface Deck {
  el: HTMLAudioElement;
  src: MediaElementAudioSourceNode;
  trim: GainNode;
  /** Low-shelf for the beat-matched bass swap (0 dB normally). */
  eq: BiquadFilterNode;
  fade: GainNode;
  url: string | null;
  id: string | null;
}

/** Low-shelf corner and the cut depth used when swapping bass between decks (dB). */
const BASS_HZ = 220;
const BASS_CUT_DB = -24;

function makeDeck(ctx: AudioContext, out: AudioNode): Deck {
  const el = new Audio();
  el.preload = 'auto';
  el.preservesPitch = true; // tempo-stretch for beat-matching must not shift the key
  const src = ctx.createMediaElementSource(el);
  const trim = ctx.createGain();
  const eq = ctx.createBiquadFilter();
  eq.type = 'lowshelf';
  eq.frequency.value = BASS_HZ;
  eq.gain.value = 0;
  const fade = ctx.createGain();
  fade.gain.value = 0;
  src.connect(trim);
  trim.connect(eq);
  eq.connect(fade);
  fade.connect(out);
  return { el, src, trim, eq, fade, url: null, id: null };
}

/** Equal-power ramp curve. `rising` fades in (sin), otherwise fades out (cos). */
function powerCurve(rising: boolean): Float32Array {
  const n = 64;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    c[i] = rising ? Math.sin((t * Math.PI) / 2) : Math.cos((t * Math.PI) / 2);
  }
  return c;
}
const FADE_IN = powerCurve(true);
const FADE_OUT = powerCurve(false);

export class PlaybackEngine {
  private readonly decks: [Deck, Deck];
  private cur = 0;
  /** Drives the beat-match phase-lock + rate ease-back (JS, since playbackRate isn't an AudioParam). */
  private lockTimer: ReturnType<typeof setInterval> | null = null;
  /** The current track ended on its own (advance the queue). */
  onEnded: (() => void) | null = null;
  onError: (() => void) | null = null;

  constructor(
    private readonly ctx: AudioContext,
    out: AudioNode,
  ) {
    this.decks = [makeDeck(ctx, out), makeDeck(ctx, out)];
    for (const d of this.decks) {
      d.el.addEventListener('ended', () => {
        if (this.active === d) this.onEnded?.();
      });
      d.el.addEventListener('error', () => {
        if (this.active === d) this.onError?.();
      });
    }
  }

  private get active(): Deck {
    return this.decks[this.cur];
  }
  private get idle(): Deck {
    return this.decks[this.cur ^ 1];
  }

  get currentId(): string | null {
    return this.active.id;
  }
  get el(): HTMLAudioElement {
    return this.active.el;
  }
  get currentTime(): number {
    return this.active.el.currentTime;
  }
  set currentTime(v: number) {
    try {
      this.active.el.currentTime = Math.max(0, v);
    } catch {
      /* not seekable yet */
    }
  }
  get duration(): number {
    const d = this.active.el.duration;
    return Number.isFinite(d) ? d : 0;
  }
  get paused(): boolean {
    return this.active.el.paused;
  }

  /** Resolve the active track's duration once metadata is known (0 if it never arrives). */
  durationReady(): Promise<number> {
    const el = this.active.el;
    if (Number.isFinite(el.duration) && el.duration > 0) return Promise.resolve(el.duration);
    return new Promise((resolve) => {
      const done = (): void => resolve(Number.isFinite(el.duration) ? el.duration : 0);
      el.addEventListener('loadedmetadata', done, { once: true });
      el.addEventListener('error', () => resolve(0), { once: true });
    });
  }

  private loadInto(d: Deck, file: File, track: DeckTrack): void {
    if (d.url) URL.revokeObjectURL(d.url);
    d.url = URL.createObjectURL(file);
    d.el.src = d.url;
    d.id = track.id;
    d.trim.gain.setValueAtTime(Math.pow(10, track.gainDb / 20), this.ctx.currentTime);
  }

  /** Start a track now on the active deck, stopping the other. No crossfade. */
  play(file: File, track: DeckTrack): Promise<void> {
    this.stopDeck(this.idle);
    const d = this.active;
    this.loadInto(d, file, track);
    const now = this.ctx.currentTime;
    d.fade.gain.cancelScheduledValues(now);
    d.fade.gain.setValueAtTime(1, now);
    return d.el.play();
  }

  /** Crossfade into a new track on the idle deck over `seconds` (<= 0 = near-gapless swap). */
  async crossfade(file: File, track: DeckTrack, seconds: number): Promise<void> {
    const from = this.active;
    const to = this.idle;
    this.loadInto(to, file, track);
    const now = this.ctx.currentTime;
    if (seconds <= 0) {
      to.fade.gain.setValueAtTime(1, now);
      from.fade.gain.setValueAtTime(0, now);
    } else {
      to.fade.gain.cancelScheduledValues(now);
      to.fade.gain.setValueAtTime(0, now);
      to.fade.gain.setValueCurveAtTime(FADE_IN, now, seconds);
      from.fade.gain.cancelScheduledValues(now);
      from.fade.gain.setValueCurveAtTime(FADE_OUT, now, seconds);
    }
    this.cur ^= 1;
    try {
      await to.el.play();
    } catch {
      /* autoplay may defer until a gesture */
    }
    window.setTimeout(() => this.stopDeck(from), Math.max(0, seconds) * 1000 + 60);
  }

  /**
   * DJ-style beat-matched transition into B on the idle deck (docs/ROADMAP.md §4.1): start B at the
   * plan's rate from its mix-in point, equal-power blend over the plan length, swap the bass at the
   * midpoint, phase-lock B to A's grid for the first bars, then ease B's rate back to 1.0.
   */
  async beatMatch(
    file: File,
    track: DeckTrack,
    plan: TransitionPlan,
    gridA: Float32Array,
    gridB: Float32Array,
  ): Promise<void> {
    const from = this.active;
    const to = this.idle;
    this.loadInto(to, file, track);
    to.el.playbackRate = plan.rate;
    try {
      to.el.currentTime = plan.inStart;
    } catch {
      /* not seekable yet; the phase-lock loop still pulls it in */
    }
    const now = this.ctx.currentTime;
    const len = Math.max(0.1, plan.lengthSec);
    const mid = now + len / 2;
    // Equal-power volume blend.
    to.fade.gain.cancelScheduledValues(now);
    to.fade.gain.setValueAtTime(0, now);
    to.fade.gain.setValueCurveAtTime(FADE_IN, now, len);
    from.fade.gain.cancelScheduledValues(now);
    from.fade.gain.setValueCurveAtTime(FADE_OUT, now, len);
    // Bass swap on the mid downbeat: B's lows start cut, A's lows cut as B's come in.
    to.eq.gain.setValueAtTime(BASS_CUT_DB, now);
    to.eq.gain.setTargetAtTime(0, mid, 0.3);
    from.eq.gain.setValueAtTime(0, now);
    from.eq.gain.setTargetAtTime(BASS_CUT_DB, mid, 0.3);
    this.cur ^= 1;
    try {
      await to.el.play();
      to.el.currentTime = plan.inStart;
    } catch {
      /* autoplay may defer */
    }
    this.runPhaseLock(from, to, plan, gridA, gridB);
  }

  /**
   * For the first few bars, nudge B's rate so its beats track A's; after the blend, ease it back to
   * 1.0 over ~8 bars; then stop the outgoing deck and reset EQ. Runs off a short interval because
   * `playbackRate` isn't an AudioParam.
   */
  private runPhaseLock(from: Deck, to: Deck, plan: TransitionPlan, gridA: Float32Array, gridB: Float32Array): void {
    if (this.lockTimer) clearInterval(this.lockTimer);
    const barSec = plan.lengthSec / plan.bars;
    const lockUntil = performance.now() + Math.min(plan.lengthSec, 4 * barSec) * 1000;
    const easeEnd = performance.now() + (plan.lengthSec + 8 * barSec) * 1000;
    const beatOffset = (grid: Float32Array, pos: number): number => {
      if (!grid.length) return 0;
      let near = grid[0];
      for (let i = 0; i < grid.length; i++) {
        if (Math.abs(grid[i] - pos) < Math.abs(near - pos)) near = grid[i];
        else if (grid[i] > pos) break;
      }
      return pos - near;
    };
    const beatMs = (plan.lengthSec / plan.bars / 4) * 1000; // one beat at A's tempo
    this.lockTimer = setInterval(() => {
      const nowMs = performance.now();
      if (to.el.paused || nowMs >= easeEnd) {
        if (this.lockTimer) clearInterval(this.lockTimer);
        this.lockTimer = null;
        to.el.playbackRate = 1;
        to.eq.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2);
        this.stopDeck(from);
        return;
      }
      if (nowMs < lockUntil) {
        const aErr = beatOffset(gridA, from.el.currentTime);
        const bErr = beatOffset(gridB, to.el.currentTime);
        let err = (bErr - aErr) * 1000;
        while (err > beatMs / 2) err -= beatMs;
        while (err < -beatMs / 2) err += beatMs;
        to.el.playbackRate = nudgeRate(err, plan.rate);
      } else {
        // Ease the rate back toward 1.0 over the remaining window.
        to.el.playbackRate += (1 - to.el.playbackRate) * 0.1;
      }
    }, 100);
  }

  pause(): void {
    this.active.el.pause();
  }
  resume(): Promise<void> {
    return this.active.el.play();
  }

  /** Stop and clear both decks (switching away to a live input, or on teardown). */
  stopAll(): void {
    if (this.lockTimer) {
      clearInterval(this.lockTimer);
      this.lockTimer = null;
    }
    this.stopDeck(this.decks[0]);
    this.stopDeck(this.decks[1]);
  }

  /** Update the active deck's loudness trim (e.g. when a measurement arrives mid-play). */
  setGainDb(db: number): void {
    this.active.trim.gain.setTargetAtTime(Math.pow(10, db / 20), this.ctx.currentTime, 0.05);
  }

  private stopDeck(d: Deck): void {
    try {
      d.el.pause();
    } catch {
      /* ignore */
    }
    d.el.removeAttribute('src');
    try {
      d.el.load();
    } catch {
      /* ignore */
    }
    if (d.url) {
      URL.revokeObjectURL(d.url);
      d.url = null;
    }
    d.id = null;
    d.el.playbackRate = 1;
    const now = this.ctx.currentTime;
    d.fade.gain.cancelScheduledValues(now);
    d.fade.gain.setValueAtTime(0, now);
    d.eq.gain.cancelScheduledValues(now);
    d.eq.gain.setValueAtTime(0, now);
  }

  dispose(): void {
    this.onEnded = null;
    this.onError = null;
    if (this.lockTimer) {
      clearInterval(this.lockTimer);
      this.lockTimer = null;
    }
    for (const d of this.decks) {
      this.stopDeck(d);
      try {
        d.src.disconnect();
        d.trim.disconnect();
        d.eq.disconnect();
        d.fade.disconnect();
      } catch {
        /* ignore */
      }
    }
  }
}

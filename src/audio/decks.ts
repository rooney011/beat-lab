/**
 * Two-deck playback. The current track plays on one deck, the next loads on the other, and an
 * equal-power crossfade swaps between them. Each deck is `<audio>` → trim gain (loudness levelling)
 * → fade gain → the shared analysis input, so the visualizer sees exactly what is heard — crossfades
 * included. Single-track playback (file open, or a library track with no crossfade) just uses the
 * active deck, mirroring the old FileSource behaviour.
 */

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
  fade: GainNode;
  url: string | null;
  id: string | null;
}

function makeDeck(ctx: AudioContext, out: AudioNode): Deck {
  const el = new Audio();
  el.preload = 'auto';
  const src = ctx.createMediaElementSource(el);
  const trim = ctx.createGain();
  const fade = ctx.createGain();
  fade.gain.value = 0;
  src.connect(trim);
  trim.connect(fade);
  fade.connect(out);
  return { el, src, trim, fade, url: null, id: null };
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

  pause(): void {
    this.active.el.pause();
  }
  resume(): Promise<void> {
    return this.active.el.play();
  }

  /** Stop and clear both decks (switching away to a live input, or on teardown). */
  stopAll(): void {
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
    const now = this.ctx.currentTime;
    d.fade.gain.cancelScheduledValues(now);
    d.fade.gain.setValueAtTime(0, now);
  }

  dispose(): void {
    this.onEnded = null;
    this.onError = null;
    for (const d of this.decks) {
      this.stopDeck(d);
      try {
        d.src.disconnect();
        d.trim.disconnect();
        d.fade.disconnect();
      } catch {
        /* ignore */
      }
    }
  }
}

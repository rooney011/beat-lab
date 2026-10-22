import { PlaybackEngine, type DeckTrack } from './audio/decks';
import type { PlayMeta } from './library/store';
import { AudioEngine } from './audio/engine';
import { LiveSource, LiveSourceError, type LiveKind } from './audio/sources';
import { AiMood, type AiMoodResult } from './ai/aimood';
import { FeatureExtractor } from './analysis/features';
import { DimensionDirector } from './analysis/ladder';
import { MoodReader } from './analysis/mood';
import { DROP_DIM, MIN_CONFIDENCE, ScriptDirector } from './analysis/script';
import type { TrackAnalysis } from './library/types';
import { SyncDelay, autoDelay, MAX_DELAY_MS } from './analysis/sync';
import { DIMS } from './config/dims';
import { MOODS, moodLook } from './config/moods';
import { LyricsCaption } from './lyrics/caption';
import { parseLRC, type LyricLine } from './lyrics/lrc';
import { findSyncedLyrics } from './lyrics/lrclib';
import { CoverArt } from './meta/cover';
import { guessFromFilename, readFileTags, type Tags } from './meta/tags';
import { loadCanvasFonts } from './render/fonts';
import { sceneDef } from './render/scenes';
import { Stage } from './render/stage';
import { BandStrip } from './render/strip';
import { DEFAULT_FX, loadSettings, sanitize, saveSettings, settingsChanged } from './settings';
import { Store } from './store';
import type {
  Analysis,
  AppState,
  CardId,
  Features,
  FxFlags,
  Layout,
  MoodId,
  MotionPref,
  Quality,
  SourceId,
  TrackMeta,
} from './types';
import { formatTime } from './util/math';

/**
 * Per-mood (energy, brightness) the background scenes glide to when only the quick rule-based read
 * is available. The AI path supplies real arousal/valence instead.
 */
const MOOD_AV: Record<MoodId, [number, number]> = {
  hype: [0.85, 0.7],
  grit: [0.7, 0.35],
  dreamy: [0.3, 0.75],
  brooding: [0.35, 0.2],
};

export function initialState(): AppState {
  return {
    screen: 'cover',
    leaving: false,
    source: null,
    playing: false,
    requesting: null,
    micDenied: false,
    card: null,
    drawer: false,
    hud: false,
    dim: 2,
    auto: true,
    queued: -1,
    dose: 70,
    toast: null,
    motion: 'system',
    reduce: false,
    strict: false,
    fx: { ...DEFAULT_FX },
    mood: null,
    aiActive: false,
    aiMood: true,
    coverColours: true,
    bpm: 0,
    lyricSrc: '',
    lyricsOnline: true,
    syncMs: null,
    meta: {},
    hasArt: false,
    title: '',
    timeL: '',
    timeR: '',
    scrub: 0,
    scrubMax: 1,
    autoHide: true,
    shortcuts: true,
    quality: 'auto',
    idle: false,
    clean: false,
    layout: 'desktop',
    status: 'ready',
    flashes: 0,
    clamps: 0,
    scale: 1,
    suspended: false,
    dragging: false,
    ...sanitize(loadSettings()),
  };
}

export interface AppElements {
  root: HTMLElement;
  stage: HTMLCanvasElement;
  strip: HTMLCanvasElement;
  art: HTMLCanvasElement;
  fileInput: HTMLInputElement;
}

/**
 * The controller: owns the audio graph, the analysis pipeline and the renderer, runs the
 * animation loop, and exposes the actions the UI calls.
 *
 * Per frame: features (live) → mood + dimension ladder (live) → sync delay → events + render (delayed).
 */
export class App {
  readonly store = new Store<AppState>(initialState());
  readonly audio = new AudioEngine();
  readonly features = new FeatureExtractor();
  readonly mood = new MoodReader();
  readonly sync = new SyncDelay();
  readonly director: DimensionDirector;
  readonly stage: Stage;
  readonly cover = new CoverArt();
  readonly lyrics = new LyricsCaption();
  readonly stats = { beats: 0, strong: 0, snares: 0, intensity: 0 };
  /** Plays the stage from the track's analysis — builds tension, cuts to Static Bloom on the drop. */
  readonly script = new ScriptDirector();
  /** The playing track's analysis (pushed by the library controller); null for live/unanalysed. */
  private analysis: TrackAnalysis | null = null;
  /** Count-in lettering the script wants on the giant word this frame (e.g. "3", "WAIT FOR IT"). */
  private scriptWord: string | null = null;
  /** The on-device mood model (lazy worker; silent fallback to the quick read). */
  readonly ai: AiMood;
  /** The latest AI read, for the tuning readout. */
  aiRead: AiMoodResult | null = null;
  /** Called every frame with what the viewer sees (for DOM meters). */
  onFrame: ((a: Analysis) => void) | null = null;
  /** Average frame time in ms. */
  frameMs = 16;

  private readonly strip: BandStrip;
  private playback: PlaybackEngine | null = null;
  /** Set by the library's playback controller to drive the queue on track-end and on file-open. */
  queueHooks: { ended: () => boolean; external: () => void } | null = null;
  private live: LiveSource | null = null;
  private lyricsAbort: AbortController | null = null;
  private pendingLrc: File | null = null;
  private songKey = '';
  private sysReduce = false;
  private last = 0;
  private raf = 0;
  private alive = false;
  private uiT = 0;
  private lastInput = 0;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private q = 1;
  private perfT = 0;
  private goodFor = 0;
  private lowered = false;
  private errLogged = false;
  private resizeObs: ResizeObserver | null = null;

  constructor(private readonly el: AppElements) {
    this.stage = new Stage(el.stage);
    this.strip = new BandStrip(el.strip);
    this.cover.attach(el.art);
    this.director = new DimensionDirector(
      (to) => this.set({ queued: to }),
      (dim) => this.set({ dim, queued: -1 }),
    );
    this.director.now = this.state.dim;
    this.ai = new AiMood((r, key) => this.applyAiRead(r, key));
    this.ai.setEnabled(this.state.aiMood);
    this.store.subscribe((s, prev) => this.onState(s, prev));
  }

  get state(): AppState {
    return this.store.get();
  }

  set(patch: Partial<AppState>): void {
    this.store.set(patch);
  }

  // ---------------------------------------------------------------- lifecycle

  start(): void {
    try {
      const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      this.sysReduce = mq.matches;
      mq.addEventListener('change', (e) => {
        this.sysReduce = e.matches;
        this.setMotion(this.state.motion);
      });
    } catch {}
    this.setMotion(this.state.motion);
    this.applyTheme();
    this.resize();
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(this.el.root);
    this.drawCover();
    void loadCanvasFonts().then(() => {
      this.stage.word.invalidate();
      this.lyrics.retime();
      this.drawCover();
    });
    this.alive = true;
    this.last = performance.now();
    const loop = (t: number): void => {
      if (!this.alive) return;
      this.raf = requestAnimationFrame(loop);
      try {
        this.frame(t);
      } catch (err) {
        if (!this.errLogged) {
          this.errLogged = true;
          console.error(err);
        }
      }
    };
    this.raf = requestAnimationFrame(loop);
  }

  destroy(): void {
    this.alive = false;
    cancelAnimationFrame(this.raf);
    this.resizeObs?.disconnect();
    this.stopSources();
    this.playback?.dispose();
    this.playback = null;
    this.ai.dispose();
    void this.audio.ctx?.close();
  }

  private onState(s: AppState, prev: AppState): void {
    if (s.aiMood !== prev.aiMood) {
      this.ai.setEnabled(s.aiMood);
      if (!s.aiMood && s.aiActive) this.set({ aiActive: false });
    }
    if (s.coverColours !== prev.coverColours) this.stage.tracker.setPalette(s.coverColours ? this.cover.palette : null);
    if (s.dim !== prev.dim) this.applyTheme();
    if (!this.cover.hasArt && (s.dim !== prev.dim || s.meta !== prev.meta)) this.drawCover();
    if (s.quality !== prev.quality) {
      if (s.quality !== 'auto') this.q = 1;
      this.resize();
    }
    if (settingsChanged(s, prev)) {
      if (this.saveTimer) clearTimeout(this.saveTimer);
      this.saveTimer = setTimeout(() => saveSettings(this.state), 300);
    }
  }

  private applyTheme(): void {
    const D = DIMS[this.state.dim];
    const st = this.el.root.style;
    st.setProperty('--accent', D.accent);
    st.setProperty('--caption', D.caption);
    st.setProperty('--stage', D.stage);
    st.setProperty('--p1', D.plates[0]);
    st.setProperty('--p2', D.plates[1]);
    st.setProperty('--p3', D.plates[2]);
  }

  private resize(): void {
    const w = this.el.root.clientWidth || window.innerWidth;
    const h = this.el.root.clientHeight || window.innerHeight;
    const qs = Stage.qualityScale(this.state.quality, this.q);
    this.stage.resize(w, h, qs);
    const layout: Layout = w < 768 ? 'mobile' : w < 1200 ? 'tablet' : 'desktop';
    this.set({ layout, scale: Math.round(qs * 100) / 100 });
  }

  private drawCover(): void {
    const s = this.state;
    this.cover.draw(DIMS[s.dim], s.meta.title || s.title, s.meta.artist || '');
  }

  // ---------------------------------------------------------------- audio sources

  private ensureAudio(): AudioContext | null {
    const fresh = !this.audio.ctx;
    const ctx = this.audio.ensure();
    if (!ctx) {
      this.toast('Web Audio is not available in this browser', 'warn');
      return null;
    }
    if (fresh && this.audio.analysers) {
      this.features.attach(this.audio.analysers, ctx.sampleRate);
      ctx.addEventListener('statechange', () =>
        this.set({ suspended: ctx.state === 'suspended' && this.state.playing }),
      );
    }
    if (!this.playback && this.audio.input) {
      this.playback = new PlaybackEngine(ctx, this.audio.input);
      this.playback.onEnded = () => this.onTrackEnded();
      this.playback.onError = () => this.onTrackError();
    }
    return ctx;
  }

  /** The current track ended: let the queue advance, otherwise just stop. */
  private onTrackEnded(): void {
    if (this.queueHooks?.ended()) return;
    this.set({ playing: false });
  }

  private onTrackError(): void {
    this.stopSources();
    this.set({ card: 'err-file', source: null, playing: false, title: '' });
  }

  private stopSources(): void {
    this.playback?.stopAll();
    this.live?.dispose();
    this.live = null;
    this.lyricsAbort?.abort();
    this.lyricsAbort = null;
    this.ai.stop();
    this.aiRead = null;
  }

  /** Common reset when a new song or input starts. */
  private beginRun(key: string, fromCover: boolean): void {
    const t = performance.now();
    this.songKey = key;
    this.features.newSong();
    this.stats.beats = this.stats.strong = this.stats.snares = 0;
    this.mood.reset(key);
    // The script only engages once the library pushes this song's analysis; start reactive.
    this.script.newSong(key);
    this.analysis = null;
    this.scriptWord = null;
    this.stage.tension = 0;
    // Back to the listening globe with fresh, seeded layouts until the mood is read.
    this.stage.director.setSong(this.stage.tracker.reset(key), t);
    this.set({ mood: null, bpm: 0, aiActive: false });
    if (this.state.auto || this.state.screen === 'cover') this.director.reset(0, t);
    if (!fromCover && this.state.screen === 'cover') this.set({ screen: 'live' });
    this.lastInput = t;
  }

  /** Cover → stage transition: sparks burst, cover slides away, stage starts at Inkfall. */
  private leaveCover(): void {
    this.stage.hits.sparkBurstPending = true;
    this.set({ leaving: true });
    setTimeout(() => {
      this.director.reset(0, performance.now());
      this.set({ screen: 'live', leaving: false });
    }, 420);
  }

  openFilePicker(): void {
    this.ensureAudio();
    this.el.fileInput.click();
  }

  /** Open the library screen (lazily mounted by the shell). */
  openLibrary(): void {
    this.poke();
    this.set({ screen: 'library', drawer: false, card: null, clean: false });
  }

  /** Transport entry for the library queue controller: play a resolved file on the deck engine. */
  playTrackFile(file: File, deck: DeckTrack, crossfadeSec = 0, startSec = 0, meta?: PlayMeta, focus = false): void {
    this.ensureAudio();
    // Only an explicit pick pulls you to Now Playing; an auto-advance must not yank you off the library.
    if (focus) this.set({ screen: 'live' });
    void this.loadFile(file, deck, crossfadeSec, startSec, meta);
  }

  /** The deck engine's live position/length, for the queue controller's resume state and crossfade. */
  playbackTime(): number {
    return this.playback?.currentTime ?? 0;
  }
  playbackDuration(): number {
    return this.playback?.duration ?? 0;
  }
  /** Apply a loudness trim mid-play (smoothed), e.g. when a measurement arrives. */
  setPlaybackGain(db: number): void {
    this.playback?.setGainDb(db);
  }

  /** The library controller pushes the playing track's analysis (or null) so the script can run. */
  setAnalysis(a: TrackAnalysis | null): void {
    this.analysis = a;
  }

  /** Files from the picker or a drop: one audio file, optionally with its .lrc. */
  takeFiles(list: FileList | File[]): void {
    const files = Array.from(list);
    const isLrc = (f: File): boolean => /\.(lrc|txt)$/i.test(f.name);
    const lrc = files.find(isLrc) ?? null;
    const song = files.find((f) => !isLrc(f));
    if (song) {
      this.pendingLrc = lrc;
      void this.loadFile(song);
    } else if (lrc) {
      if (this.state.source === 'file') this.loadLrcFile(lrc);
      else this.toast('Load a song first, then its .lrc', 'warn');
    }
  }

  private async loadFile(
    file: File,
    deck: DeckTrack = { id: null, gainDb: 0 },
    crossfadeSec = 0,
    startSec = 0,
    lib?: PlayMeta,
  ): Promise<void> {
    const ctx = this.ensureAudio();
    if (!ctx || !this.audio.input || !this.playback) return;
    const probe = document.createElement('audio');
    if (file.type && !file.type.startsWith('audio/') && !file.type.startsWith('video/')) {
      this.set({ card: 'err-file' });
      return;
    }
    if (file.type && probe.canPlayType(file.type) === '') {
      this.set({ card: 'err-file' });
      return;
    }
    if (ctx.state === 'suspended') void ctx.resume();
    const engine = this.playback;
    const key = `file:${file.name}:${file.size}`;
    // A direct file open (no library id) takes over from any active queue.
    if (deck.id === null) this.queueHooks?.external();
    // Crossfade only when a track is already playing on the deck; otherwise hard-start.
    const fading = crossfadeSec > 0 && !engine.paused && this.state.source === 'file';
    if (fading) {
      this.lyricsAbort?.abort();
      this.lyricsAbort = null;
      this.ai.stop();
      this.aiRead = null;
      engine.crossfade(file, deck, crossfadeSec).catch(() => {});
    } else {
      this.stopSources();
      this.audio.setMonitor(true);
      engine.play(file, deck).catch(() => {
        if (this.songKey === key) this.set({ playing: false });
      });
    }
    this.set({
      source: 'file',
      playing: true,
      title: lib?.title || file.name,
      card: null,
      requesting: null,
      scrub: 0,
      scrubMax: 1,
    });
    this.beginRun(key, false);
    this.setLyrics(null, '');
    const guess = guessFromFilename(file.name);
    this.setMeta(this.metaFrom({}, file, lib));
    void this.ai.analyzeFile(ctx, file, key);
    const lrc = this.pendingLrc;
    this.pendingLrc = null;
    const [tags, duration] = await Promise.all([readFileTags(file), engine.durationReady()]);
    if (this.songKey !== key) return;
    if (startSec > 0) {
      engine.currentTime = startSec;
      this.set({ scrub: Math.floor(startSec) });
    }
    const meta = this.metaFrom(tags, file, lib);
    this.setMeta(meta);
    void this.cover.load(tags.pic).then((ok) => {
      if (ok && this.songKey === key) {
        this.set({ hasArt: true });
        // Tint the dimension toward the cover's inks (unless the viewer turned that off).
        this.stage.tracker.setPalette(this.state.coverColours ? this.cover.palette : null);
        this.drawCover();
      }
    });
    if (lrc) this.loadLrcFile(lrc);
    else if (this.state.lyricsOnline) {
      // Prefer the library's resolved tags (the OPFS copy's own tags are the same, its name is not).
      const artist = lib?.artist || tags.artist;
      const title = lib?.title || tags.title || guess.title;
      void this.fetchLyrics(key, artist ? { artist, title, q: `${artist} ${title}` } : guess, duration);
    } else this.toast('Tip: pick the song and its .lrc together for synced lyrics');
  }

  private metaFrom(tags: Tags, file: File, lib?: PlayMeta): TrackMeta {
    const g = guessFromFilename(file.name);
    const ext = (file.name.split('.').pop() || '').toUpperCase();
    return {
      // The library already resolved these from the original file's tags; prefer them, since the
      // OPFS copy is named by id and loses the tags the quick file read would otherwise rely on.
      title: lib?.title || tags.title || g.title || file.name,
      artist: lib?.artist || tags.artist || g.artist || '',
      album: lib?.album || tags.album || '',
      year: (lib?.year ? String(lib.year) : '') || tags.year || '',
      fmt: ext.length <= 4 ? ext : 'FILE',
      mb: file.size ? (file.size / 1048576).toFixed(1) : '',
    };
  }

  private setMeta(meta: TrackMeta): void {
    this.cover.clear();
    this.set({ meta, title: meta.title || '', hasArt: false });
    this.drawCover();
  }

  pickSource(id: SourceId): void {
    this.poke();
    if (id === 'file') this.openFilePicker();
    else if (id === 'mic') this.set({ card: this.state.micDenied ? 'err-mic-denied' : 'perm-mic' });
    else this.set({ card: LiveSource.tabSupported() ? 'perm-tab' : 'err-tab-unsupported' });
  }

  /** Called from the permission card's button (a user gesture, so the browser prompt can open). */
  async startLive(kind: LiveKind): Promise<void> {
    const ctx = this.ensureAudio();
    if (!ctx || !this.audio.input) return;
    if (ctx.state === 'suspended') void ctx.resume();
    this.set({ card: null, requesting: kind });
    let src: LiveSource;
    try {
      src = kind === 'mic' ? await LiveSource.mic(ctx, this.audio.input) : await LiveSource.tab(ctx, this.audio.input);
    } catch (e) {
      const code = e instanceof LiveSourceError ? e.code : 'failed';
      const card: CardId | null =
        code === 'denied'
          ? 'err-mic-denied'
          : code === 'missing'
            ? 'err-mic-missing'
            : code === 'no-audio'
              ? 'err-tab-noaudio'
              : code === 'unsupported'
                ? 'err-tab-unsupported'
                : null;
      this.set({
        requesting: null,
        card,
        micDenied: kind === 'mic' && code === 'denied' ? true : this.state.micDenied,
      });
      if (code === 'cancelled') this.toast('Sharing cancelled');
      else if (code === 'failed')
        this.toast(kind === 'mic' ? "Couldn't open the microphone" : "Couldn't capture that tab", 'warn');
      return;
    }
    this.stopSources();
    this.live = src;
    this.audio.setMonitor(false);
    src.onEnded = () => {
      if (this.live !== src) return;
      this.stopSources();
      this.set({ source: null, playing: false });
      this.toast(kind === 'tab' ? 'Tab sharing stopped' : 'Microphone disconnected', 'warn');
    };
    this.set({
      source: kind,
      playing: true,
      requesting: null,
      micDenied: kind === 'mic' ? false : this.state.micDenied,
    });
    const key = `${kind}:${Date.now()}`;
    this.beginRun(key, this.state.screen === 'cover');
    void this.ai.analyzeLive(ctx, this.audio.input, key);
    this.setMeta(
      kind === 'mic'
        ? { title: 'Microphone', artist: 'Live input', fmt: 'LIVE' }
        : { title: 'Shared tab', artist: src.label || 'Live tab audio', fmt: 'LIVE' },
    );
    this.setLyrics(null, '');
    if (this.state.screen === 'cover') this.leaveCover();
  }

  togglePlay(): void {
    const s = this.state;
    this.poke();
    if (!s.source) {
      this.openFilePicker();
      return;
    }
    const ctx = this.audio.ctx;
    if (s.source === 'file' && this.playback) {
      if (this.playback.paused) {
        if (ctx?.state === 'suspended') void ctx.resume();
        this.playback.resume().catch(() => {});
        this.set({ playing: true });
      } else {
        this.playback.pause();
        this.set({ playing: false });
      }
      return;
    }
    if (!ctx) return;
    if (s.playing) {
      void ctx.suspend();
      this.set({ playing: false });
    } else {
      void ctx.resume();
      this.set({ playing: true });
    }
  }

  seek(seconds: number): void {
    if (!this.playback || this.state.source !== 'file') return;
    this.playback.currentTime = Math.max(0, seconds);
    this.set({ scrub: Math.floor(this.playback.currentTime) });
  }

  seekBy(delta: number): void {
    if (this.playback && this.state.source === 'file') this.seek(this.playback.currentTime + delta);
  }

  resumeAudio(): void {
    void this.audio.ctx?.resume();
  }

  // ---------------------------------------------------------------- lyrics

  private setLyrics(lines: LyricLine[] | null, src: string): void {
    this.lyrics.set(lines);
    this.set({ lyricSrc: lines && lines.length ? src : '' });
  }

  private loadLrcFile(f: File): void {
    const key = this.songKey;
    f.text()
      .then((txt) => {
        if (this.songKey !== key) return;
        const lines = parseLRC(txt);
        if (!lines.length) {
          this.toast('No timed lines in that .lrc file', 'warn');
          return;
        }
        this.lyricsAbort?.abort();
        this.setLyrics(lines, 'LRC file');
        this.toast(`Lyrics loaded: ${this.lyrics.count} synced lines`);
      })
      .catch(() => this.toast("Couldn't read that .lrc file", 'warn'));
  }

  private async fetchLyrics(
    key: string,
    q: { artist: string; title: string; q: string },
    duration: number,
  ): Promise<void> {
    this.lyricsAbort?.abort();
    const ac = new AbortController();
    this.lyricsAbort = ac;
    this.set({ lyricSrc: 'Searching' });
    const stale = (): boolean => this.songKey !== key || ac.signal.aborted;
    try {
      const hit = await findSyncedLyrics({ ...q, duration }, ac.signal);
      if (stale()) return;
      const lines = hit ? parseLRC(hit.syncedLyrics) : [];
      if (hit && lines.length) {
        this.setLyrics(lines, 'LRCLIB');
        this.toast('Synced lyrics: ' + (hit.artistName ? hit.artistName + ' — ' : '') + (hit.trackName || q.title));
      } else {
        this.set({ lyricSrc: '' });
        this.toast('No synced lyrics found. Drop the song with its .lrc file.', 'warn');
      }
    } catch {
      if (stale()) return;
      this.set({ lyricSrc: '' });
      this.toast("Couldn't reach the lyrics service. Drop the song with its .lrc file.", 'warn');
    }
  }

  /** Song position in seconds for lyrics, or -1 when the source has no timeline. */
  private songTime(): number {
    const s = this.state;
    if (s.source === 'file' && this.playback) return this.playback.currentTime;
    return -1;
  }

  /**
   * Latency-compensated song position for the script clock: the sound at the deck's `currentTime`
   * reaches the ears ~outputLatency later, so advancing the clock by it lands the scripted drop cut
   * on the beat the listener actually hears. -1 when there's no file timeline.
   */
  private scriptPos(): number {
    if (this.state.source !== 'file' || !this.playback) return -1;
    const ctx = this.audio.ctx;
    const latency = ctx ? ctx.outputLatency || ctx.baseLatency || 0 : 0;
    return this.playback.currentTime + latency;
  }

  // ---------------------------------------------------------------- settings and dimensions

  pickDim(i: number): void {
    this.poke();
    this.set({ auto: false });
    this.director.pick(i, performance.now());
    this.toast('Dimension locked: ' + DIMS[i].name);
  }

  toggleAuto(): void {
    const on = !this.state.auto;
    this.poke();
    this.set({ auto: on });
    this.toast(on ? 'Auto dimensions on' : 'Dimension locked: ' + DIMS[this.director.now].name);
  }

  setMotion(m: MotionPref): void {
    this.set({ motion: m, reduce: m === 'on' || (m === 'system' && this.sysReduce) });
  }

  toggleCalm(): void {
    const on = !this.state.reduce;
    this.set({ motion: on ? 'on' : 'system', reduce: on || this.sysReduce, strict: on });
  }

  setDose(v: number): void {
    this.set({ dose: Math.max(0, Math.min(100, Math.round(v / 5) * 5)) });
  }

  toggleFx(key: keyof FxFlags): void {
    const fx = { ...this.state.fx, [key]: !this.state.fx[key] };
    this.set({ fx });
  }

  setQuality(q: Quality): void {
    this.set({ quality: q });
  }

  /** Visual delay in ms: the manual value, or the auto estimate from output latency. */
  syncDelay(): number {
    const v = this.state.syncMs;
    return v === null ? autoDelay(this.audio.latencyMs()) : v;
  }

  nudgeSync(dv: number): void {
    const v = Math.max(0, Math.min(MAX_DELAY_MS, this.syncDelay() + dv));
    this.set({ syncMs: v });
    this.toast(`Visuals delayed ${v} ms`);
  }

  toggleSyncAuto(): void {
    this.set({ syncMs: this.state.syncMs === null ? this.syncDelay() : null });
  }

  fullscreen(): void {
    const fail = (): void => this.toast("Fullscreen isn't available here", 'warn');
    try {
      if (document.fullscreenElement) void document.exitFullscreen();
      else if (this.el.root.requestFullscreen) this.el.root.requestFullscreen().catch(fail);
      else fail();
    } catch {
      fail();
    }
  }

  poke(): void {
    this.lastInput = performance.now();
    if (this.state.idle) this.set({ idle: false });
  }

  toast(msg: string, tone: 'info' | 'warn' = 'info'): void {
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.set({ toast: { msg, tone } });
    this.toastTimer = setTimeout(() => this.set({ toast: null }), 4000);
  }

  // ---------------------------------------------------------------- frame loop

  private frame(t: number): void {
    const dt = Math.min(0.05, Math.max(0.001, (t - this.last) / 1000));
    this.last = t;
    const s = this.state;
    const isLive = s.playing && s.source !== null && this.audio.running;
    const live = this.features.update(t, dt, {
      live: isLive,
      playing: s.playing,
      hasSource: s.source !== null,
    });
    const lf = live.f;
    if (s.playing && isLive) {
      if (lf.beat) this.stats.beats++;
      if (lf.strong) this.stats.strong++;
      if (lf.snare) this.stats.snares++;
    }
    this.stats.intensity = lf.intensity;
    if (s.screen === 'live') this.onMood(lf, dt, t);
    this.drive(lf, t, dt, s);

    const delay = this.syncDelay();
    const a = this.sync.apply(live, t, delay);
    const st = this.state;
    // The library screen fully covers the stage, so painting it there is wasted work — skip all
    // drawing while it's hidden (the biggest battery saving in 1.4). Audio analysis, mood and the
    // mini-player meter above keep running; only the canvas goes quiet.
    const draw = st.screen !== 'library';
    if (draw) this.stage.events(a.f, t, st, this.director.now);
    const songT = this.songTime();
    if (draw)
      this.stage.render({
        a,
        t,
        dt,
        s: st,
        dim: this.director.now,
        profile: this.mood.profile,
        motion: moodLook(st.mood).motion,
        word: this.giantWord(st),
        wipe: (ms) => this.director.advanceWipe(t, ms),
        envelope: this.features.sinT[0],
        drawLyrics: (c, D, k, kick) => {
          if (songT < 0 || !this.lyrics.active) return;
          this.lyrics.draw({
            c,
            songTime: songT - delay / 1000,
            t,
            W: c.canvas.width,
            H: c.canvas.height,
            k,
            D,
            layout: st.layout,
            calm: st.reduce,
            style: moodLook(st.mood).lyric,
            bpm: st.bpm,
            kick,
          });
        },
      });
    if (draw)
      this.strip.draw(
        a.f.bands,
        DIMS[this.director.now],
        st.layout !== 'desktop',
        !st.playing,
        t - this.stage.lastBeatSeen < 120,
      );
    this.perf(dt, t);
    this.tick(t, lf);
    this.onFrame?.(a);
  }

  /**
   * Choose the dimension ladder for this frame: the script when the playing file has confident
   * analysis and AUTO is on (it holds through a build and hard-cuts to Static Bloom on the drop),
   * otherwise the reactive ladder. Live inputs, unanalysed tracks and a locked dimension all keep
   * today's reactive behaviour exactly.
   */
  private drive(lf: Features, t: number, dt: number, s: AppState): void {
    const scriptOn =
      s.auto &&
      s.playing &&
      s.screen === 'live' &&
      s.source === 'file' &&
      !!this.analysis &&
      this.analysis.beatConfidence >= MIN_CONFIDENCE;
    const pos = scriptOn ? this.scriptPos() : -1;
    if (scriptOn && pos >= 0) {
      const fr = this.script.update(this.analysis, pos, dt, this.director.now);
      this.stage.tension = fr.tension;
      this.scriptWord = fr.countIn;
      if (fr.cut) {
        this.director.reset(DROP_DIM, t); // hard jump to Static Bloom, no wipe
        this.stage.dropCut(t, s.strict, s.reduce);
      } else if (fr.targetDim !== this.director.now && !this.director.wipe && this.director.pending === null) {
        this.director.pick(fr.targetDim, t); // wipe toward the section's dimension
      }
      return;
    }
    this.stage.tension = 0;
    this.scriptWord = null;
    this.director.update(lf, t, dt, {
      playing: s.playing,
      live: s.screen === 'live',
      auto: s.auto,
      moodTh: moodLook(s.mood).th,
    });
  }

  private onMood(f: Features, dt: number, t: number): void {
    const dec = this.mood.observe(f, dt, t, this.features.spectrum);
    if (!dec) return;
    if (this.state.aiActive) {
      // The model's read is driving the look; keep the tempo fresh but don't override the mood.
      if (dec.bpm) this.set({ bpm: dec.bpm });
      return;
    }
    const look = MOODS[dec.mood];
    const prev = this.state.mood;
    this.feedLook(dec.mood, dec.bpm || this.mood.profile?.clockBpm || 0, t);
    this.lyrics.retime();
    this.set({ mood: dec.mood, bpm: dec.bpm });
    const bg = sceneDef(this.stage.director.current).name;
    if (dec.first) this.toast(`Quick mood read: ${look.label}${dec.bpm ? ` · ${dec.bpm} BPM` : ''} · ${bg} background`);
    else if (prev !== dec.mood) this.toast('Mood shifted: ' + look.label);
  }

  /** Point the background at a mood: pick its scene set and glide the look's energy/brightness. */
  private feedLook(mood: MoodId, bpm: number, t: number, av?: { arousal: number; valence: number }): void {
    const [energy, brightness] = av ? [av.arousal, av.valence] : MOOD_AV[mood];
    this.stage.tracker.setMood(energy, brightness, bpm);
    this.stage.director.setMood(mood, t);
  }

  /** A read from the on-device model: feed it in exactly where the quick read goes, and take over. */
  private applyAiRead(r: AiMoodResult, key: string): void {
    if (key !== this.songKey || !this.state.aiMood) return;
    this.aiRead = r;
    const look = MOODS[r.mood];
    const prev = this.state.mood;
    const firstAi = !this.state.aiActive;
    const t = performance.now();
    // The model gives real arousal/valence: feed them straight to the look.
    this.feedLook(r.mood, this.state.bpm || this.mood.profile?.clockBpm || 0, t, {
      arousal: r.arousal,
      valence: r.valence,
    });
    this.lyrics.retime();
    this.set({ mood: r.mood, aiActive: true });
    const bg = sceneDef(this.stage.director.current).name;
    if (firstAi) this.toast(`AI mood: ${look.label} · ${bg} background`);
    else if (prev !== r.mood) this.toast('AI mood shifted: ' + look.label);
  }

  private giantWord(s: AppState): string {
    if (this.scriptWord) return this.scriptWord; // scripted count-in on the last build bar
    if (s.source && s.mood) return MOODS[s.mood].label;
    return DIMS[this.director.now].name.toUpperCase();
  }

  /** Adaptive quality: drop render scale when frames run long, restore it after 10 s of headroom. */
  private perf(dt: number, t: number): void {
    this.frameMs += (dt * 1000 - this.frameMs) * 0.05;
    if (!this.state.playing || this.state.quality !== 'auto' || t - this.perfT < 2000) return;
    this.perfT = t;
    if (this.frameMs > 20 && this.q > 0.5) {
      this.q = Math.max(0.5, this.q * 0.75);
      this.resize();
      this.goodFor = 0;
      if (!this.lowered) {
        this.lowered = true;
        this.toast('Lowered quality to keep it smooth', 'warn');
      }
    } else if (this.frameMs < 12 && this.q < 1) {
      this.goodFor += 2;
      if (this.goodFor >= 10) {
        this.q = Math.min(1, this.q / 0.75);
        this.resize();
        this.goodFor = 0;
      }
    }
  }

  /** UI-rate updates (8 per second): clock text, status, idle, safety counters. */
  private tick(t: number, f: Features): void {
    if (t - this.uiT < 125) return;
    this.uiT = t;
    const s = this.state;
    const up: Partial<AppState> = {};
    let timeL = '';
    let timeR = '';
    if (s.source === 'file' && this.playback) {
      const cur = this.playback.currentTime;
      const d = this.playback.duration;
      timeL = formatTime(cur);
      timeR = '−' + formatTime(Math.max(0, d - cur));
      up.scrub = Math.floor(cur);
      up.scrubMax = Math.max(1, Math.floor(d));
    } else if (s.source === 'mic' || s.source === 'tab') {
      timeL = 'LIVE';
      timeR = s.playing ? Math.max(-90, Math.round(f.db)) + ' DB' : 'PAUSED';
    }
    Object.assign(up, { timeL, timeR });
    let status: AppState['status'] = 'ready';
    if (s.source) status = !s.playing ? 'paused' : f.silent ? 'no-signal' : 'listening';
    else if (s.micDenied) status = 'blocked';
    up.status = status;
    up.idle = s.autoHide && s.playing && s.screen === 'live' && !s.drawer && !s.card && t - this.lastInput > 2500;
    up.flashes = this.stage.flashes.count(t);
    up.clamps = this.stage.clamp.clamps;
    up.suspended = s.playing && this.audio.ctx?.state === 'suspended';
    this.set(up);
  }

  // ---------------------------------------------------------------- keyboard

  onKey(e: KeyboardEvent): void {
    const s = this.state;
    const tag = (e.target as HTMLElement | null)?.tagName ?? '';
    this.poke();
    if (e.key === 'Escape') {
      if (s.card) this.set({ card: null });
      else if (s.drawer) this.set({ drawer: false });
      else if (s.screen === 'library') this.set({ screen: s.source ? 'live' : 'cover' });
      else if (s.clean) this.set({ clean: false });
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (!s.shortcuts || tag === 'INPUT' || tag === 'TEXTAREA' || s.card) return;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (s.screen !== 'live') return;
    switch (key) {
      case ' ':
        if (tag === 'BUTTON') return;
        e.preventDefault();
        this.togglePlay();
        break;
      case '1':
      case '2':
      case '3':
      case '4':
        this.pickDim(Number(key) - 1);
        break;
      case 'a':
        this.toggleAuto();
        break;
      case 'h':
        this.set({ clean: !s.clean });
        break;
      case ',':
        this.nudgeSync(-20);
        break;
      case '.':
        this.nudgeSync(20);
        break;
      case 'c':
        this.toggleFx('dancers');
        this.toast(this.state.fx.dancers ? 'Ink crew on' : 'Ink crew off');
        break;
      case 'l':
        this.toggleFx('lyrics');
        this.toast(this.state.fx.lyrics ? 'Lyrics on' : 'Lyrics off');
        break;
      case 's':
        this.set({ drawer: !s.drawer });
        break;
      case 'o':
        this.openFilePicker();
        break;
      case 'm':
        this.pickSource('mic');
        break;
      case 't':
        this.pickSource('tab');
        break;
      case ']':
        this.setDose(s.dose + 10);
        break;
      case '[':
        this.setDose(s.dose - 10);
        break;
      case 'f':
        this.fullscreen();
        break;
      case '?':
        this.set({ card: 'keys' });
        break;
      case 'ArrowLeft':
        this.seekBy(-5);
        break;
      case 'ArrowRight':
        this.seekBy(5);
        break;
    }
  }
}

export type SourceId = 'demo' | 'file' | 'mic' | 'tab';
export type MoodId = 'hype' | 'grit' | 'dreamy' | 'brooding';
export type Layout = 'desktop' | 'tablet' | 'mobile';
export type BgStyle = 'rays' | 'chevrons' | 'stripes' | 'rings' | 'grid';
export type LyricStyle = 'stamp' | 'shake' | 'float' | 'type';
export type MotionPref = 'system' | 'on' | 'off';
export type Quality = 'auto' | 'high' | 'low';
export type Status = 'ready' | 'listening' | 'paused' | 'no-signal' | 'blocked';
export type CardId =
  | 'perm-mic'
  | 'perm-tab'
  | 'err-mic-denied'
  | 'err-mic-missing'
  | 'err-tab-noaudio'
  | 'err-tab-unsupported'
  | 'err-file'
  | 'keys';

/** One frame of audio features. All levels are normalised to 0..1 unless noted. */
export interface Features {
  /** A kick-like onset landed this frame. */
  beat: boolean;
  /** The onset was well above the running threshold. */
  strong: boolean;
  /** A mid-band (snare/clap) onset landed this frame. */
  snare: boolean;
  /** This beat replaced a weaker one inside the refractory window. */
  replaced: boolean;
  /** Hi-hat sparkle count, 0..8. */
  spark: number;
  /** Kick-band envelope: fast attack, 120 ms release. */
  pulse: number;
  mids: number;
  highs: number;
  /** Long-window loudness, normalised against this song's own range. */
  intensity: number;
  /** RMS level in dBFS. */
  db: number;
  /** No signal for more than four seconds. */
  silent: boolean;
  /** Eight log-spaced band levels. */
  bands: Float32Array;
}

/** Everything the renderer reads about the audio for one frame. */
export interface Analysis {
  f: Features;
  /** 48 log-spaced spectrum bars with fall-off. */
  bars: Float32Array;
  /** Peak caps for the bars. */
  peaks: Float32Array;
  /** 160-point "plucked string" waveform. */
  wave: Float32Array;
}

export interface FxFlags {
  cuts: boolean;
  plates: boolean;
  letters: boolean;
  stamps: boolean;
  lyrics: boolean;
  dancers: boolean;
  glitch: boolean;
  grain: boolean;
}

export interface TrackMeta {
  title?: string;
  artist?: string;
  album?: string;
  year?: string;
  fmt?: string;
  mb?: string;
}

export interface Toast {
  msg: string;
  tone: 'info' | 'warn';
}

export interface AppState {
  screen: 'cover' | 'live';
  leaving: boolean;
  source: SourceId | null;
  playing: boolean;
  requesting: SourceId | null;
  micDenied: boolean;
  card: CardId | null;
  drawer: boolean;
  hud: boolean;
  dim: number;
  auto: boolean;
  queued: number;
  dose: number;
  toast: Toast | null;
  motion: MotionPref;
  reduce: boolean;
  strict: boolean;
  fx: FxFlags;
  mood: MoodId | null;
  bpm: number;
  lyricSrc: string;
  lyricsOnline: boolean;
  syncMs: number | null;
  meta: TrackMeta;
  hasArt: boolean;
  title: string;
  timeL: string;
  timeR: string;
  section: string;
  scrub: number;
  scrubMax: number;
  autoHide: boolean;
  shortcuts: boolean;
  quality: Quality;
  idle: boolean;
  clean: boolean;
  layout: Layout;
  status: Status;
  flashes: number;
  clamps: number;
  scale: number;
  suspended: boolean;
  dragging: boolean;
}

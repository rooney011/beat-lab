import type { MoodId } from '../../types';
import type { DrawContext } from '../context';
import type { Ring } from '../layers/rings';
import type { CoverPalette } from './palette';

export type SceneId =
  | 'rays'
  | 'chevrons'
  | 'speedlines'
  | 'tunnel'
  | 'stripes'
  | 'skyline'
  | 'torn'
  | 'rings'
  | 'clouds'
  | 'aurora'
  | 'grid'
  | 'rain'
  | 'searchlights'
  | 'globe';

/**
 * Everything about the current song that shapes its backgrounds. Built once per song and
 * updated as the mood read improves; scenes read it every frame, so changes show up smoothly.
 */
export interface SongLook {
  /** Stable song key (file name + size, or the live source). */
  key: string;
  /** 32-bit seed derived from the key. Scenes derive their own layout from it. */
  seed: number;
  /** 0..1 — the mood's arousal (AI model when available, else the rule-based read). Eased. */
  energy: number;
  /** 0..1 — the mood's valence (bright/happy vs dark/sad). Eased. */
  brightness: number;
  /** Tempo, or 0 when unknown. */
  bpm: number;
  /** Seeded rotation offset in radians (kept from the old background system). */
  angle: number;
  /** Seeded 0, 2 or 4 extra sunburst rays (kept from the old background system). */
  rayExtra: number;
  /** Inks pulled from the cover art, or null to use the dimension's own plates. */
  palette: CoverPalette | null;
}

export interface SceneInput {
  dc: DrawContext;
  look: SongLook;
  /**
   * How present the background should be, 0..1: the dimension's layer budget × the beat-pulse
   * breathing × the crossfade. The classic scenes use it directly as alpha; the richer new
   * scenes scale it by their own gain.
   */
  alpha: number;
  /** Plate kick, 1 on a beat and decaying over 160 ms. */
  kick: number;
  /** Live shock rings (some scenes ripple with them). */
  rings: readonly Ring[];
  /** Spend one full-frame flash from the photosensitivity budget. Returns false if not allowed. */
  flash: () => boolean;
}

export interface Scene {
  draw(input: SceneInput): void;
}

export interface SceneDef {
  id: SceneId;
  /** null = not in any mood's rotation (the listening scene, and spares like Sunburst). */
  mood: MoodId | null;
  name: string;
  /** One line for docs and the Scene Lab. */
  blurb: string;
  /** Build a scene instance for one song (layouts are seeded from look.seed). */
  create(look: SongLook): Scene;
}

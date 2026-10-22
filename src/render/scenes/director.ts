import type { MoodId } from '../../types';
import { LISTENING_SCENE, sceneDef, sceneIndexForDim, sceneSet } from './registry';
import type { Scene, SceneDef, SceneId, SceneInput, SongLook } from './types';

interface Live {
  def: SceneDef;
  scene: Scene;
}

const FADE_MS = 1200;

/**
 * Chooses and draws the background scene. Replaces the old single-style Background layer:
 * a song starts on the listening globe, then gets a seeded set of scenes for its mood, steps through them as the dimension climbs,
 * and every change crossfades over 1.2 s.
 */
export class SceneDirector {
  private look: SongLook;
  private set: SceneId[] = [LISTENING_SCENE];
  private mood: MoodId | null = null;
  private dim = 0;
  private cur: Live;
  private prev: Live | null = null;
  private fadeT = 0;
  /** Force one scene (Scene Lab, debugging). null = automatic. */
  pinned: SceneId | null = null;

  constructor(look: SongLook) {
    this.look = look;
    this.cur = this.make(LISTENING_SCENE);
  }

  get current(): SceneId {
    return this.cur.def.id;
  }

  get sceneIds(): readonly SceneId[] {
    return this.set;
  }

  private make(id: SceneId): Live {
    const def = sceneDef(id);
    return { def, scene: def.create(this.look) };
  }

  private switchTo(id: SceneId, t: number, fade = true): void {
    if (id === this.cur.def.id) return;
    this.prev = fade ? this.cur : null;
    this.fadeT = t;
    this.cur = this.make(id);
  }

  private target(): SceneId {
    if (this.pinned) return this.pinned;
    return this.set[sceneIndexForDim(this.dim, this.set.length)];
  }

  /** New song: fresh layouts, back to the listening globe until the mood is read. */
  setSong(look: SongLook, t: number): void {
    this.look = look;
    this.mood = null;
    this.set = [LISTENING_SCENE];
    this.prev = this.cur;
    this.fadeT = t;
    this.cur = this.make(this.target());
  }

  setMood(mood: MoodId | null, t: number): void {
    if (mood === this.mood) return;
    this.mood = mood;
    this.set = sceneSet(mood, this.look.seed);
    this.switchTo(this.target(), t);
  }

  setDim(dim: number, t: number): void {
    if (dim === this.dim) return;
    this.dim = dim;
    this.switchTo(this.target(), t);
  }

  pin(id: SceneId | null, t: number): void {
    this.pinned = id;
    this.switchTo(this.target(), t);
  }

  /**
   * Adopt another director's mood/set/dim and show its current scene with no crossfade, bound to the
   * given look object (the clip stage's own tracker look). Lets a second stage start already matched.
   */
  copyFrom(o: SceneDirector, t: number, look: SongLook): void {
    this.look = look;
    this.set = o.set.slice();
    this.mood = o.mood;
    this.dim = o.dim;
    this.pinned = o.pinned;
    this.prev = null;
    this.fadeT = t;
    this.cur = this.make(o.cur.def.id);
  }

  /** Draw with the background's overall alpha; handles the crossfade. */
  draw(input: Omit<SceneInput, 'look'>, t: number): void {
    let p = 1;
    if (this.prev) {
      p = Math.min(1, (t - this.fadeT) / FADE_MS);
      if (p >= 1) this.prev = null;
    }
    if (this.prev) this.prev.scene.draw({ ...input, look: this.look, alpha: input.alpha * (1 - p) });
    this.cur.scene.draw({ ...input, look: this.look, alpha: input.alpha * p });
  }
}

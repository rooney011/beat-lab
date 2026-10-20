import type { MoodId } from '../../types';
import { BROODING } from './brooding';
import { CLASSIC } from './classic';
import { DREAMY } from './dreamy';
import { LISTENING } from './globe';
import { GRIT } from './grit';
import { HYPE } from './hype';
import type { SceneDef, SceneId } from './types';
import { sceneRandom, shuffle } from './util';

/** Every background scene. Add a new one here and it joins its mood's rotation. */
export const SCENES: readonly SceneDef[] = [...CLASSIC, ...LISTENING, ...HYPE, ...GRIT, ...DREAMY, ...BROODING];

/** Plays while a song's mood is being read, and whenever there is no mood. */
export const LISTENING_SCENE: SceneId = 'globe';

const BY_ID = new Map<SceneId, SceneDef>(SCENES.map((s) => [s.id, s]));

export function sceneDef(id: SceneId): SceneDef {
  const d = BY_ID.get(id);
  if (!d) throw new Error(`Unknown scene ${id}`);
  return d;
}

export const scenesFor = (mood: MoodId | null): SceneDef[] => SCENES.filter((s) => s.mood === mood);

/**
 * The ordered scenes a song moves through as it climbs the dimensions. Seeded, so the same
 * song always gets the same set in the same order, and different songs lead with different scenes.
 */
export function sceneSet(mood: MoodId | null, seed: number): SceneId[] {
  if (!mood) return [LISTENING_SCENE];
  const pool = scenesFor(mood).map((s) => s.id);
  if (!pool.length) return [LISTENING_SCENE];
  return shuffle(pool, sceneRandom(seed, `set:${mood}`));
}

/** Inkfall and Riso Heat show the first scene, Pressline the second, Static Bloom the third. */
export function sceneIndexForDim(dim: number, setLength: number): number {
  const idx = dim <= 1 ? 0 : dim === 2 ? 1 : 2;
  return idx % Math.max(1, setLength);
}

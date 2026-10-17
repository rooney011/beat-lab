import { classifyMood } from '../analysis/mood';
import type { MoodId } from '../types';

/** The four mood-classifier activations (each 0..1), as returned by the on-device model. */
export interface MoodProbs {
  happy: number;
  sad: number;
  aggressive: number;
  relaxed: number;
}

/** Arousal and valence, each in 0..1, plus the quadrant mood they fall into. */
export interface AiMoodRead {
  arousal: number;
  valence: number;
  mood: MoodId;
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/**
 * Place the four classifier activations on the arousal/valence circumplex:
 * aggressive and happy are activating, sad and relaxed are calming; happy and relaxed are
 * positive, aggressive and sad are negative. The ± span is 2, so a 0.25 scale keeps the result
 * inside 0..1 for clean 0/1 activations.
 */
export function moodsToArousalValence(p: MoodProbs): { arousal: number; valence: number } {
  const arousal = clamp01(0.5 + 0.25 * (p.aggressive + p.happy - (p.sad + p.relaxed)));
  const valence = clamp01(0.5 + 0.25 * (p.happy + p.relaxed - (p.aggressive + p.sad)));
  return { arousal, valence };
}

/** Full read: classifier activations → arousal/valence → one of the four moods. */
export function readMood(p: MoodProbs): AiMoodRead {
  const { arousal, valence } = moodsToArousalValence(p);
  return { arousal, valence, mood: classifyMood(arousal, valence) };
}

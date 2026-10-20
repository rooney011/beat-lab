import type { LyricStyle, MoodId } from '../types';

export interface MoodLook {
  label: string;
  /** Motion multiplier for backgrounds and the burst. */
  motion: number;
  /** Offset added to the dimension-ladder thresholds. */
  th: number;
  lyric: LyricStyle;
}

export const NO_MOOD: MoodLook = { label: '', motion: 1, th: 0, lyric: 'stamp' };

export const MOODS: Record<MoodId, MoodLook> = {
  hype: { label: 'HYPE', motion: 1.2, th: -0.05, lyric: 'stamp' },
  grit: { label: 'GRIT', motion: 1.15, th: -0.03, lyric: 'shake' },
  dreamy: { label: 'DREAMY', motion: 0.7, th: 0.08, lyric: 'float' },
  brooding: { label: 'BROODING', motion: 0.85, th: 0.05, lyric: 'type' },
};

export const moodLook = (id: MoodId | null): MoodLook => (id ? MOODS[id] : NO_MOOD);

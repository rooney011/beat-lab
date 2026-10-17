import type { BgStyle, LyricStyle, MoodId } from '../types';

export interface MoodLook {
  label: string;
  bg: BgStyle;
  bgName: string;
  /** Motion multiplier for backgrounds and the burst. */
  motion: number;
  /** Offset added to the dimension-ladder thresholds. */
  th: number;
  lyric: LyricStyle;
}

export const NO_MOOD: MoodLook = { label: '', bg: 'rays', bgName: 'sunburst', motion: 1, th: 0, lyric: 'stamp' };

export const MOODS: Record<MoodId, MoodLook> = {
  hype: { label: 'HYPE', bg: 'chevrons', bgName: 'chevron', motion: 1.2, th: -0.05, lyric: 'stamp' },
  grit: { label: 'GRIT', bg: 'stripes', bgName: 'hazard stripe', motion: 1.15, th: -0.03, lyric: 'shake' },
  dreamy: { label: 'DREAMY', bg: 'rings', bgName: 'ripple ring', motion: 0.7, th: 0.08, lyric: 'float' },
  brooding: { label: 'BROODING', bg: 'grid', bgName: 'dot matrix', motion: 0.85, th: 0.05, lyric: 'type' },
};

export const moodLook = (id: MoodId | null): MoodLook => (id ? MOODS[id] : NO_MOOD);

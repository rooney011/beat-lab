/**
 * Playing from the script (docs/ROADMAP.md §2.3). Given a track's stored analysis and the current
 * song position, this decides what the stage should do ahead of time instead of reacting a beat
 * late: hold the dimension ladder through a build, raise tension, count the drop in, and hard-cut to
 * Static Bloom on the exact beat of the drop. After the drop it follows the section labels.
 *
 * Pure and deterministic given the sequence of positions it's fed — the drop cut is edge-triggered
 * (fires once, on the first frame at or past the drop) so it's unit-tested frame by frame. The host
 * (src/app.ts) owns the song clock and applies these directives to the DimensionDirector and Stage.
 */
import type { SectionKind, TrackAnalysis } from '../library/types';

/** Static Bloom is dimension 3 — the drop lands here. */
export const DROP_DIM = 3;

/** Where each section kind sits on the dimension ladder (Inkfall 0 … Static Bloom 3). */
const SECTION_DIM: Record<SectionKind, number> = {
  intro: 0,
  outro: 0,
  breakdown: 1,
  verse: 2,
  build: 2,
  drop: 3,
  other: 2,
};

/** The minimum beat confidence before the script steers at all; below it, the stage stays reactive. */
export const MIN_CONFIDENCE = 0.5;

export interface ScriptFrame {
  /** The script is steering this frame (confident analysis, within the track). */
  active: boolean;
  /** Dimension the ladder should hold/move to (0..3). */
  targetDim: number;
  /** Hard-cut to Static Bloom this frame — the drop landed. Edge-triggered: true on one frame only. */
  cut: boolean;
  /** Build tension, 0..1 (drives the camera push-in and misregistration). */
  tension: number;
  /** Comic count-in lettering on the last bar before a drop, or null. */
  countIn: string | null;
}

const idle: ScriptFrame = { active: false, targetDim: 0, cut: false, tension: 0, countIn: null };

export class ScriptDirector {
  /** Drop times already cut, so the hard-cut fires exactly once per drop. */
  private readonly fired = new Set<number>();
  private key = '';

  /** Reset for a new song (keyed, so re-seeking the same song keeps its fired drops). */
  newSong(key: string): void {
    if (key === this.key) return;
    this.key = key;
    this.fired.clear();
  }

  /**
   * Decide this frame's directive. `pos` is the latency-compensated song position in seconds, `dt`
   * the frame delta (to place the cut within half a frame of the drop), `currentDim` the dimension
   * on stage now (so a build can hold it rather than climb early).
   */
  update(analysis: TrackAnalysis | null, pos: number, dt: number, currentDim: number): ScriptFrame {
    if (!analysis || analysis.beatConfidence < MIN_CONFIDENCE || analysis.bpm <= 0) return idle;
    const beatLen = 60 / analysis.bpm;
    const barLen = beatLen * 4;

    // The next drop at or after now (within a lookahead), and the one we may have just passed.
    const drop = this.dropAround(analysis, pos, barLen);
    if (drop) {
      const buildStart = this.buildStart(analysis, drop.time, barLen);
      // Fire the cut on the first frame at/after the drop (within half a frame).
      if (pos >= drop.time - dt / 2 && pos < drop.time + barLen && !this.fired.has(drop.time)) {
        this.fired.add(drop.time);
        return { active: true, targetDim: DROP_DIM, cut: true, tension: 1, countIn: null };
      }
      // In the build: hold the ladder, ramp tension, count the last bar in.
      if (pos >= buildStart && pos < drop.time) {
        const tension = Math.max(0, Math.min(1, (pos - buildStart) / Math.max(1e-3, drop.time - buildStart)));
        const toDrop = drop.time - pos;
        let countIn: string | null = null;
        if (toDrop <= beatLen * 3.5) {
          const beatsLeft = Math.max(1, Math.round(toDrop / beatLen));
          countIn = beatsLeft <= 3 ? String(beatsLeft) : null;
        } else if (toDrop <= barLen * 2) {
          countIn = 'WAIT FOR IT';
        }
        return { active: true, targetDim: currentDim, cut: false, tension, countIn };
      }
      // Just after a drop we haven't fired (analysis arrived late): still snap to Static Bloom.
      if (pos >= drop.time && pos < drop.time + barLen) {
        this.fired.add(drop.time);
        return { active: true, targetDim: DROP_DIM, cut: false, tension: 0, countIn: null };
      }
    }

    // Otherwise follow the section we're in.
    const kind = this.sectionKindAt(analysis, pos);
    return {
      active: true,
      targetDim: kind === null ? currentDim : SECTION_DIM[kind],
      cut: false,
      tension: 0,
      countIn: null,
    };
  }

  // ---------------------------------------------------------------- helpers

  /** The drop whose build/impact window contains `pos` (next drop within ~16 bars, or one just passed). */
  private dropAround(a: TrackAnalysis, pos: number, barLen: number): { time: number; confidence: number } | null {
    const lookahead = barLen * 16;
    let best: { time: number; confidence: number } | null = null;
    for (const d of a.drops) {
      if (pos >= d.time - lookahead && pos < d.time + barLen) {
        if (!best || Math.abs(d.time - pos) < Math.abs(best.time - pos)) best = d;
      }
    }
    return best;
  }

  /** Where the build into `dropTime` starts: the preceding "build" section, else 8 bars before. */
  private buildStart(a: TrackAnalysis, dropTime: number, barLen: number): number {
    const build = a.sections.find(
      (s) => s.kind === 'build' && s.end <= dropTime + barLen && s.end >= dropTime - barLen,
    );
    if (build) return build.start;
    return Math.max(0, dropTime - barLen * 8);
  }

  private sectionKindAt(a: TrackAnalysis, pos: number): SectionKind | null {
    for (const s of a.sections) if (pos >= s.start && pos < s.end) return s.kind;
    return null;
  }
}

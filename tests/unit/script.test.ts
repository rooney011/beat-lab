import { describe, expect, it } from 'vitest';
import { DROP_DIM, ScriptDirector } from '../../src/analysis/script';
import type { TrackAnalysis } from '../../src/library/types';

/** A track at 120 BPM (beat 0.5 s, bar 2 s) with a 5 s build into a drop at 10 s. */
function analysis(confidence = 0.8): TrackAnalysis {
  return {
    trackId: 't',
    fileHash: 'h',
    version: 1,
    beats: new Float32Array(0),
    bpm: 120,
    beatConfidence: confidence,
    firstDownbeat: 0,
    energy: new Uint8Array(0),
    sections: [
      { start: 0, end: 5, kind: 'intro', energy: 0.1, confidence: 0.6 },
      { start: 5, end: 10, kind: 'build', energy: 0.4, confidence: 0.6 },
      { start: 10, end: 18, kind: 'drop', energy: 0.9, confidence: 0.7 },
    ],
    drops: [{ time: 10, confidence: 0.8 }],
    analysedAt: 0,
  };
}

const DT = 1 / 60;

describe('ScriptDirector', () => {
  it('stays inactive below the confidence threshold', () => {
    const s = new ScriptDirector();
    s.newSong('a');
    expect(s.update(analysis(0.3), 7, DT, 2).active).toBe(false);
  });

  it('fires the drop cut exactly once, within half a frame of the drop', () => {
    const s = new ScriptDirector();
    s.newSong('a');
    const a = analysis();
    const cutPositions: number[] = [];
    for (let pos = 9.8; pos <= 10.4; pos += DT) {
      const fr = s.update(a, pos, DT, 2);
      if (fr.cut) cutPositions.push(pos);
    }
    expect(cutPositions).toHaveLength(1);
    expect(cutPositions[0]).toBeGreaterThanOrEqual(10 - DT);
    expect(cutPositions[0]).toBeLessThanOrEqual(10 + DT);
  });

  it('ramps tension across the build and holds the ladder', () => {
    const s = new ScriptDirector();
    s.newSong('a');
    const a = analysis();
    expect(s.update(a, 5.1, DT, 2).tension).toBeLessThan(0.1);
    const mid = s.update(a, 7.5, DT, 2);
    expect(mid.tension).toBeCloseTo(0.5, 1);
    expect(mid.targetDim).toBe(2); // held at the current dim, not climbing
    expect(s.update(a, 9.6, DT, 2).tension).toBeGreaterThan(0.85);
  });

  it('counts the last bar in', () => {
    const s = new ScriptDirector();
    s.newSong('a');
    const a = analysis();
    expect(s.update(a, 7.0, DT, 2).countIn).toBe('WAIT FOR IT');
    expect(s.update(a, 8.5, DT, 2).countIn).toBe('3');
    expect(s.update(a, 9.0, DT, 2).countIn).toBe('2');
    expect(s.update(a, 9.5, DT, 2).countIn).toBe('1');
  });

  it('holds Static Bloom through the drop section, then follows sections', () => {
    const s = new ScriptDirector();
    s.newSong('a');
    const a = analysis();
    // Pass the drop so it's fired, then sit inside the drop section.
    s.update(a, 10, DT, 2);
    expect(s.update(a, 12, DT, 3).targetDim).toBe(DROP_DIM);
    // Back in the intro region → Inkfall (0).
    expect(s.update(a, 2, DT, 3).targetDim).toBe(0);
  });
});

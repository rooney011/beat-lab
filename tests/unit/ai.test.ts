import { describe, expect, it } from 'vitest';
import { moodsToArousalValence, readMood } from '../../src/ai/mood-map';
import { downsampleTo, toMono } from '../../src/ai/resample';

describe('moodsToArousalValence → mood', () => {
  it('maps each classifier corner to the expected quadrant', () => {
    // aggressive: high arousal, low valence → grit
    expect(readMood({ happy: 0, sad: 0, aggressive: 1, relaxed: 0 }).mood).toBe('grit');
    // happy: high arousal, high valence → hype
    expect(readMood({ happy: 1, sad: 0, aggressive: 0, relaxed: 0 }).mood).toBe('hype');
    // relaxed: low arousal, high valence → dreamy
    expect(readMood({ happy: 0, sad: 0, aggressive: 0, relaxed: 1 }).mood).toBe('dreamy');
    // sad: low arousal, low valence → brooding
    expect(readMood({ happy: 0, sad: 1, aggressive: 0, relaxed: 0 }).mood).toBe('brooding');
  });

  it('keeps arousal and valence inside 0..1 and centres a flat read', () => {
    const flat = moodsToArousalValence({ happy: 0, sad: 0, aggressive: 0, relaxed: 0 });
    expect(flat).toEqual({ arousal: 0.5, valence: 0.5 });
    const full = moodsToArousalValence({ happy: 1, sad: 1, aggressive: 1, relaxed: 1 });
    expect(full.arousal).toBeGreaterThanOrEqual(0);
    expect(full.arousal).toBeLessThanOrEqual(1);
    expect(full.valence).toBeGreaterThanOrEqual(0);
    expect(full.valence).toBeLessThanOrEqual(1);
  });

  it('raises arousal with aggression and valence with happiness', () => {
    expect(moodsToArousalValence({ happy: 0, sad: 0, aggressive: 0.8, relaxed: 0 }).arousal).toBeGreaterThan(0.5);
    expect(moodsToArousalValence({ happy: 0.8, sad: 0, aggressive: 0, relaxed: 0 }).valence).toBeGreaterThan(0.5);
  });
});

describe('toMono', () => {
  it('passes a single channel through and averages a stereo pair', () => {
    const l = Float32Array.from([1, 1, 1]);
    expect(toMono([l])).toBe(l);
    const r = Float32Array.from([-1, 0, 3]);
    expect(Array.from(toMono([l, r]))).toEqual([0, 0.5, 2]);
  });
});

describe('downsampleTo', () => {
  it('returns the input unchanged when not down-sampling', () => {
    const x = Float32Array.from([1, 2, 3]);
    expect(downsampleTo(x, 16000, 16000)).toBe(x);
    expect(downsampleTo(x, 16000, 44100)).toBe(x);
  });

  it('halves the length and averages pairs when rate halves', () => {
    const x = Float32Array.from([0, 2, 4, 8]);
    const out = downsampleTo(x, 32000, 16000);
    expect(out.length).toBe(2);
    expect(Array.from(out)).toEqual([1, 6]);
  });

  it('produces roughly rateOut/rateIn as many samples for 44.1k → 16k', () => {
    const x = new Float32Array(44100);
    const out = downsampleTo(x, 44100, 16000);
    expect(out.length).toBe(Math.round(44100 / (44100 / 16000)));
    expect(Math.abs(out.length - 16000)).toBeLessThanOrEqual(1);
  });
});

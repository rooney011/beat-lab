import { describe, expect, it } from 'vitest';
import { demoLyrics, parseLRC, wordTimes } from '../../src/lyrics/lrc';

describe('parseLRC', () => {
  it('reads timed lines, sorts them and gives each an end time', () => {
    const lines = parseLRC('[00:05.00]second\n[00:01.50]first line\n[ar:Someone]\nnot a lyric');
    expect(lines.map((l) => [l.t, l.text])).toEqual([
      [1.5, 'first line'],
      [5, 'second'],
    ]);
    expect(lines[0].end).toBe(5);
    expect(lines[1].end).toBe(10);
  });

  it('caps a line at 6.5 s when the next one is far away', () => {
    const [a] = parseLRC('[00:00.00]long\n[00:30.00]later');
    expect(a.end).toBe(6.5);
  });

  it('repeats a line for every leading time tag', () => {
    const lines = parseLRC('[00:10.00][00:20.00]chorus');
    expect(lines.map((l) => l.t)).toEqual([10, 20]);
  });

  it('applies the [offset] tag (positive offset shows lyrics earlier)', () => {
    const [l] = parseLRC('[offset:+500]\n[00:02.00]hello');
    expect(l.t).toBeCloseTo(1.5);
  });

  it('reads enhanced LRC word times', () => {
    const [l] = parseLRC('[00:03.20]<00:03.20>every <00:03.60>word <00:04.00>lands');
    expect(l.text).toBe('every word lands');
    expect(l.words.map((w) => w.t)).toEqual([3.2, 3.6, 4]);
  });

  it('accepts mm:ss:xx and three-digit minutes', () => {
    expect(parseLRC('[01:02:50]x')[0].t).toBeCloseTo(62.5);
    expect(parseLRC('[100:00.00]x')[0].t).toBe(6000);
  });
});

describe('wordTimes', () => {
  it('keeps known word times and interpolates the gaps', () => {
    const [l] = parseLRC('[00:00.00]<00:00.00>a b <00:01.00>c');
    expect(wordTimes(l, 120)).toEqual([0, 0.5, 1]);
  });

  it('spreads untimed words on an eighth-note grid', () => {
    const [l] = parseLRC('[00:00.00]one two three four\n[00:04.00]next');
    const t = wordTimes(l, 120);
    const grid = 0.25;
    for (const x of t) expect(Math.abs(x / grid - Math.round(x / grid))).toBeLessThan(1e-9);
    expect(t).toEqual([...t].sort((a, b) => a - b));
    expect(t[t.length - 1]).toBeLessThanOrEqual(l.t + (l.end - l.t) * 0.7);
  });
});

describe('demoLyrics', () => {
  it('is in order and every word is timed', () => {
    const L = demoLyrics();
    expect(L.length).toBe(15);
    for (let i = 1; i < L.length; i++) expect(L[i].t).toBeGreaterThan(L[i - 1].t);
    for (const l of L) for (const w of l.words) expect(w.t).not.toBeNull();
  });
});

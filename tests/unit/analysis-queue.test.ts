import { describe, expect, it } from 'vitest';
import { analysisWorklist, nextToAnalyse, type WorklistContext } from '../../src/analysis/queue';

const ALL = ['a', 'b', 'c', 'd', 'e'];
const none = (): boolean => false;

function ctx(over: Partial<WorklistContext> = {}): WorklistContext {
  return { all: ALL, playingId: null, queued: [], done: none, ...over };
}

describe('analysisWorklist', () => {
  it('orders playing first, then the queue, then the rest of the library', () => {
    const list = analysisWorklist(ctx({ playingId: 'c', queued: ['e', 'd'] }));
    expect(list).toEqual(['c', 'e', 'd', 'a', 'b']);
  });

  it('deduplicates: the playing and queued tracks appear once', () => {
    const list = analysisWorklist(ctx({ playingId: 'b', queued: ['b', 'a', 'a'] }));
    expect(list).toEqual(['b', 'a', 'c', 'd', 'e']);
  });

  it('skips tracks that are already done', () => {
    const doneSet = new Set(['a', 'c']);
    const list = analysisWorklist(ctx({ done: (id) => doneSet.has(id) }));
    expect(list).toEqual(['b', 'd', 'e']);
  });

  it('never reconsiders a done track even when it is the playing track', () => {
    const list = analysisWorklist(ctx({ playingId: 'a', done: (id) => id === 'a' }));
    expect(list).toEqual(['b', 'c', 'd', 'e']);
  });

  it('returns an empty list when everything is done', () => {
    expect(analysisWorklist(ctx({ done: () => true }))).toEqual([]);
  });

  it('tolerates a playing/queued id that is not in the library', () => {
    const list = analysisWorklist(ctx({ all: [], playingId: 'x', queued: ['y'] }));
    expect(list).toEqual(['x', 'y']);
  });
});

describe('nextToAnalyse', () => {
  it('returns the head of the worklist', () => {
    expect(nextToAnalyse(ctx({ playingId: 'd' }))).toBe('d');
  });

  it('returns null when nothing needs analysis', () => {
    expect(nextToAnalyse(ctx({ done: () => true }))).toBeNull();
  });
});

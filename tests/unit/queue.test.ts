import { describe, expect, it } from 'vitest';
import {
  addToQueue,
  currentId,
  emptyQueue,
  move,
  next,
  playNext,
  playNow,
  previous,
  type QueueState,
  removeAt,
  setRepeat,
  setShuffle,
  shuffle,
} from '../../src/library/queue';

const IDS = ['a', 'b', 'c', 'd'];

/** A tiny deterministic RNG so shuffles are reproducible. */
function rng(seed = 1): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

function start(ids = IDS, startId: string | null = null, shuffleOn = false): QueueState {
  return playNow({ ...emptyQueue(), shuffle: shuffleOn }, ids, startId, rng());
}

describe('playNow / currentId', () => {
  it('plays the chosen track first', () => {
    const q = start(IDS, 'c');
    expect(currentId(q)).toBe('c');
    expect(q.order).toEqual(IDS);
  });

  it('shuffled playback keeps the chosen track at the front', () => {
    const q = start(IDS, 'b', true);
    expect(q.order[0]).toBe('b');
    expect([...q.order].sort()).toEqual([...IDS].sort());
  });
});

describe('next / repeat', () => {
  it('advances and stops at the end with repeat off', () => {
    let q = start(IDS, 'a');
    q = next(q);
    expect(currentId(q)).toBe('b');
    q = next(next(q)); // c, d
    expect(currentId(q)).toBe('d');
    q = next(q); // past the end
    expect(q.index).toBe(-1);
    expect(currentId(q)).toBeNull();
  });

  it('wraps with repeat all', () => {
    let q = setRepeat(start(IDS, 'd'), 'all');
    q = next(q);
    expect(currentId(q)).toBe('a');
  });

  it('stays put with repeat one', () => {
    const q = setRepeat(start(IDS, 'b'), 'one');
    expect(currentId(next(q))).toBe('b');
  });
});

describe('previous', () => {
  it('walks back the order that actually played', () => {
    let q = start(IDS, 'a');
    q = next(q); // b
    q = next(q); // c
    expect(currentId(q)).toBe('c');
    q = previous(q);
    expect(currentId(q)).toBe('b');
    q = previous(q);
    expect(currentId(q)).toBe('a');
  });
});

describe('queue edits', () => {
  it('play-next inserts right after the current track', () => {
    const q = playNext(start(IDS, 'a'), 'z');
    expect(q.order[1]).toBe('z');
    expect(currentId(q)).toBe('a');
  });

  it('add-to-queue appends', () => {
    const q = addToQueue(start(IDS, 'a'), 'z');
    expect(q.order[q.order.length - 1]).toBe('z');
  });

  it('removing a track before the current one keeps the current track current', () => {
    let q = start(IDS, 'a');
    q = next(q); // current = b (index 1)
    q = removeAt(q, 0); // drop 'a'
    expect(currentId(q)).toBe('b');
    expect(q.order).toEqual(['b', 'c', 'd']);
  });

  it('reorder keeps the current track current', () => {
    const q = move(start(IDS, 'b'), 3, 0); // move 'd' to the front
    expect(q.order[0]).toBe('d');
    expect(currentId(q)).toBe('b');
  });
});

describe('shuffle', () => {
  it('is a permutation (Fisher–Yates)', () => {
    const out = shuffle(IDS, rng(7));
    expect([...out].sort()).toEqual([...IDS].sort());
  });

  it('plays every track once before repeating', () => {
    let q = start(IDS, 'a', true);
    const seen = [currentId(q)];
    for (let i = 0; i < IDS.length - 1; i++) {
      q = next(q);
      seen.push(currentId(q));
    }
    expect(new Set(seen).size).toBe(IDS.length); // no repeats within one pass
    expect([...seen].sort()).toEqual([...IDS].sort());
  });

  it('reshuffles only the not-yet-played remainder when turned on mid-queue', () => {
    let q = start(IDS, 'a');
    q = next(q); // played a, b; current = b
    q = setShuffle(q, true, rng(3));
    expect(q.order.slice(0, 2)).toEqual(['a', 'b']); // already-played stay put
    expect([...q.order].sort()).toEqual([...IDS].sort());
  });
});

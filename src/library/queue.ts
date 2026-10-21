/**
 * The play queue: pure state transitions, no audio. The deck engine (src/audio/decks.ts) and the
 * persisted PlayState build on this. Shuffle keeps a history of what actually played so Previous
 * walks back the real order, and a shuffled order plays every track once before any repeats.
 */

export type RepeatMode = 'off' | 'all' | 'one';

export interface QueueState {
  /** Track ids in the order they'll play (already shuffled when `shuffle` is on). */
  order: string[];
  /** Index into `order` of the current track, or -1 when the queue is empty. */
  index: number;
  /** Ids in the order they were actually played, newest last — drives Previous. */
  history: string[];
  shuffle: boolean;
  repeat: RepeatMode;
}

export function emptyQueue(): QueueState {
  return { order: [], index: -1, history: [], shuffle: false, repeat: 'off' };
}

export function currentId(q: QueueState): string | null {
  return q.index >= 0 && q.index < q.order.length ? q.order[q.index] : null;
}

/** Fisher–Yates with an injectable RNG, so ordering is deterministic in tests (and seedable). */
export function shuffle<T>(items: readonly T[], rnd: () => number = Math.random): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const tmp = a[i];
    a[i] = a[j];
    a[j] = tmp;
  }
  return a;
}

/** Start a fresh queue from `ids`, playing `startId` first (shuffled tracks keep it at the front). */
export function playNow(
  q: QueueState,
  ids: string[],
  startId: string | null = null,
  rnd: () => number = Math.random,
): QueueState {
  const start = startId && ids.includes(startId) ? startId : (ids[0] ?? null);
  let order = ids.slice();
  if (q.shuffle && start) {
    const rest = shuffle(
      ids.filter((id) => id !== start),
      rnd,
    );
    order = [start, ...rest];
  }
  const index = start ? order.indexOf(start) : order.length ? 0 : -1;
  return { ...q, order, index, history: start ? [start] : [] };
}

/** Advance. Returns the same state (with a flag via index) when the queue has ended. */
export function next(q: QueueState): QueueState {
  if (q.index < 0 || !q.order.length) return q;
  if (q.repeat === 'one') return pushHistory(q, currentId(q));
  const atEnd = q.index >= q.order.length - 1;
  if (atEnd && q.repeat !== 'all') return { ...q, index: -1 }; // stopped
  const index = atEnd ? 0 : q.index + 1;
  return pushHistory({ ...q, index }, q.order[index]);
}

/** Step back through what actually played; falls back to the previous slot in `order`. */
export function previous(q: QueueState): QueueState {
  if (q.history.length > 1) {
    const history = q.history.slice(0, -1);
    const prevId = history[history.length - 1];
    const index = q.order.indexOf(prevId);
    return { ...q, index: index >= 0 ? index : q.index, history };
  }
  if (q.index > 0) return { ...q, index: q.index - 1 };
  return q;
}

function pushHistory(q: QueueState, id: string | null): QueueState {
  if (!id) return q;
  return { ...q, history: [...q.history, id] };
}

export function playNext(q: QueueState, id: string): QueueState {
  const order = q.order.slice();
  const at = q.index < 0 ? order.length : q.index + 1;
  order.splice(at, 0, id);
  return { ...q, order, index: q.index < 0 ? 0 : q.index };
}

export function addToQueue(q: QueueState, id: string): QueueState {
  const order = [...q.order, id];
  return { ...q, order, index: q.index < 0 ? 0 : q.index };
}

export function removeAt(q: QueueState, at: number): QueueState {
  if (at < 0 || at >= q.order.length) return q;
  const order = q.order.slice();
  order.splice(at, 1);
  let index = q.index;
  if (at < q.index) index -= 1;
  else if (at === q.index) index = order.length ? Math.min(index, order.length - 1) : -1;
  return { ...q, order, index };
}

/** Drag-to-reorder: move the item at `from` to `to`, keeping the current track current. */
export function move(q: QueueState, from: number, to: number): QueueState {
  if (from === to || from < 0 || from >= q.order.length || to < 0 || to >= q.order.length) return q;
  const curId = currentId(q);
  const order = q.order.slice();
  const [item] = order.splice(from, 1);
  order.splice(to, 0, item);
  return { ...q, order, index: curId ? order.indexOf(curId) : q.index };
}

/** Toggle shuffle, reshuffling the not-yet-played remainder while keeping the current track put. */
export function setShuffle(q: QueueState, on: boolean, rnd: () => number = Math.random): QueueState {
  if (on === q.shuffle) return q;
  const curId = currentId(q);
  if (!on) {
    // Can't restore the original order without storing it; keep the current order, drop the flag.
    return { ...q, shuffle: false };
  }
  if (!curId) return { ...q, shuffle: true };
  const played = new Set(q.order.slice(0, q.index + 1));
  const rest = shuffle(
    q.order.filter((id) => !played.has(id)),
    rnd,
  );
  const order = [...q.order.slice(0, q.index + 1), ...rest];
  return { ...q, shuffle: true, order };
}

export function setRepeat(q: QueueState, repeat: RepeatMode): QueueState {
  return { ...q, repeat };
}

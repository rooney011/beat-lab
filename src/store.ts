type Listener<S> = (state: S, prev: S) => void;

/** A tiny typed state container: immutable snapshots, shallow patches, synchronous listeners. */
export class Store<S extends object> {
  private state: S;
  private readonly listeners = new Set<Listener<S>>();

  constructor(initial: S) {
    this.state = initial;
  }

  get(): S {
    return this.state;
  }

  set(patch: Partial<S> | ((s: S) => Partial<S>)): void {
    const prev = this.state;
    const p = typeof patch === 'function' ? patch(prev) : patch;
    let changed = false;
    for (const key in p) {
      if (!Object.is(p[key], prev[key])) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    this.state = { ...prev, ...p };
    for (const fn of this.listeners) fn(this.state, prev);
  }

  subscribe(fn: Listener<S>): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

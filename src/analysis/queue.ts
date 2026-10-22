/**
 * The background analysis queue: which track to analyse next, and in what order. Pure state — the
 * decode, the worker and IndexedDB live in the runner (src/library/analysis.ts) — so the ordering
 * is unit-tested without touching audio. See docs/ROADMAP.md §2.1.
 *
 * Priority: the playing track first (so its result is ready soonest), then the upcoming queue in
 * order, then the rest of the library. Each id appears once, and anything `done` is skipped.
 */

export interface WorklistContext {
  /** All library track ids, in display order. */
  all: readonly string[];
  /** The currently playing track id, highest priority. */
  playingId: string | null;
  /** Upcoming queue order (the next tracks), second priority. */
  queued: readonly string[];
  /** True when the track already has an up-to-date result (or was tried and failed) — skip it. */
  done: (id: string) => boolean;
}

/** The ids to analyse, in priority order, deduplicated and with `done` ones removed. */
export function analysisWorklist(ctx: WorklistContext): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (id: string | null | undefined): void => {
    if (!id || seen.has(id)) return;
    seen.add(id); // mark before the `done` check so a skipped id is never reconsidered later
    if (!ctx.done(id)) out.push(id);
  };
  push(ctx.playingId);
  for (const id of ctx.queued) push(id);
  for (const id of ctx.all) push(id);
  return out;
}

/** The next track to analyse, or null when everything is up to date. */
export function nextToAnalyse(ctx: WorklistContext): string | null {
  return analysisWorklist(ctx)[0] ?? null;
}

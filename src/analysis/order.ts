/**
 * "Order by mood and energy" (docs/ROADMAP.md §4.2): a seeded beam search that sequences tracks along
 * an energy arc, keeping tempo/key/mood transitions smooth and avoiding the same artist back-to-back.
 * Pure and deterministic for a given seed, so the same playlist + arc always gives the same order.
 */
import { seededRandom } from '../util/rand';
import { camelotDistance } from './mix';

export type EnergyArc = 'warmup' | 'steady' | 'build';

export interface OrderItem {
  id: string;
  bpm: number;
  /** Camelot key code, if known. */
  camelot?: string;
  /** Mean track energy, 0..1. */
  energy: number;
  /** Mood arousal/valence 0..1 when analysed (optional — the offline mood read was deferred). */
  mood?: { arousal: number; valence: number };
  artist: string;
}

const BEAM_WIDTH = 5;

/** The energy the arc wants at fractional position `pos` (0..1 through the set). */
export function arcTargetAt(arc: EnergyArc, pos: number): number {
  if (arc === 'steady') return 0.6;
  if (arc === 'build') return 0.2 + 0.8 * pos;
  return 1 - Math.abs(2 * pos - 1); // warm up → peak → cool down
}

/** Cost of placing `b` after `prev` (roadmap weights); `prev2` is two tracks back (artist spacing). */
function stepCost(prev: OrderItem | null, prev2: OrderItem | null, b: OrderItem, posTarget: number): number {
  const tempo = prev ? Math.abs(prev.bpm - b.bpm) / 120 : 0;
  const key = prev ? camelotDistance(prev.camelot, b.camelot) : 0;
  const energy = Math.abs(b.energy - posTarget);
  const mood =
    prev && prev.mood && b.mood
      ? Math.hypot(prev.mood.arousal - b.mood.arousal, prev.mood.valence - b.mood.valence) / Math.SQRT2
      : 0;
  const sameArtist = (prev && prev.artist === b.artist) || (prev2 && prev2.artist === b.artist) ? 1 : 0;
  return 1.0 * tempo + 0.6 * key + 1.5 * energy + 0.8 * mood + 2.0 * sameArtist;
}

interface Beam {
  order: string[];
  used: Set<string>;
  cost: number;
  last: OrderItem | null;
  last2: OrderItem | null;
}

/** Order `items` along `arc`. Returns the track ids in play order. Deterministic for `seed`. */
export function orderByArc(items: readonly OrderItem[], arc: EnergyArc, seed = 1): string[] {
  const n = items.length;
  if (n <= 1) return items.map((i) => i.id);
  const target = (k: number): number => arcTargetAt(arc, k / (n - 1));

  // Start from one of the three best fits to the arc's opening energy (seeded for reproducible variety).
  const starts = [...items].sort((a, b) => Math.abs(a.energy - target(0)) - Math.abs(b.energy - target(0)));
  const rnd = seededRandom(seed);
  const start = starts[Math.floor(rnd() * Math.min(3, starts.length))];

  let beams: Beam[] = [
    {
      order: [start.id],
      used: new Set([start.id]),
      cost: 1.5 * Math.abs(start.energy - target(0)),
      last: start,
      last2: null,
    },
  ];
  for (let k = 1; k < n; k++) {
    const next: Beam[] = [];
    const posTarget = target(k);
    for (const beam of beams) {
      for (const it of items) {
        if (beam.used.has(it.id)) continue;
        const used = new Set(beam.used);
        used.add(it.id);
        next.push({
          order: [...beam.order, it.id],
          used,
          cost: beam.cost + stepCost(beam.last, beam.last2, it, posTarget),
          last: it,
          last2: beam.last,
        });
      }
    }
    // Keep the cheapest beams; a stable id tiebreak keeps the result deterministic.
    next.sort((a, b) => a.cost - b.cost || a.order.join(',').localeCompare(b.order.join(',')));
    beams = next.slice(0, BEAM_WIDTH);
  }
  return beams[0].order;
}

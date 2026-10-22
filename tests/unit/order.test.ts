import { describe, expect, it } from 'vitest';
import { arcTargetAt, orderByArc, type OrderItem } from '../../src/analysis/order';

function item(id: string, energy: number, artist = id, bpm = 128): OrderItem {
  return { id, energy, artist, bpm };
}

describe('arcTargetAt', () => {
  it('shapes each arc', () => {
    expect(arcTargetAt('build', 0)).toBeCloseTo(0.2, 5);
    expect(arcTargetAt('build', 1)).toBeCloseTo(1, 5);
    expect(arcTargetAt('warmup', 0.5)).toBeCloseTo(1, 5); // peak in the middle
    expect(arcTargetAt('warmup', 0)).toBeCloseTo(0, 5);
    expect(arcTargetAt('steady', 0.3)).toBeCloseTo(0.6, 5);
  });
});

describe('orderByArc', () => {
  const energies = [0.1, 0.3, 0.5, 0.7, 0.9];
  const items = energies.map((e, i) => item(`t${i}`, e));

  it('builds from low to high energy for the "build" arc', () => {
    const order = orderByArc(items, 'build');
    const seq = order.map((id) => items.find((i) => i.id === id)!.energy);
    expect(seq[0]).toBeLessThan(seq[seq.length - 1]);
    expect(seq[0]).toBeCloseTo(0.1, 5);
    expect(seq[seq.length - 1]).toBeCloseTo(0.9, 5);
  });

  it('peaks in the middle for the "warmup" arc', () => {
    const order = orderByArc(items, 'warmup');
    const seq = order.map((id) => items.find((i) => i.id === id)!.energy);
    const mid = seq[Math.floor(seq.length / 2)];
    expect(mid).toBeGreaterThan(seq[0]);
    expect(mid).toBeGreaterThan(seq[seq.length - 1]);
  });

  it('never places the same artist three in a row', () => {
    // Four artists, three tracks each, random-ish energies.
    const many: OrderItem[] = [];
    const artists = ['A', 'B', 'C', 'D'];
    for (let i = 0; i < 12; i++) many.push(item(`x${i}`, (i % 5) / 5, artists[i % 4]));
    const order = orderByArc(many, 'steady');
    const art = order.map((id) => many.find((i) => i.id === id)!.artist);
    for (let i = 2; i < art.length; i++) expect(art[i] === art[i - 1] && art[i] === art[i - 2]).toBe(false);
  });

  it('is deterministic for a seed', () => {
    expect(orderByArc(items, 'build', 7)).toEqual(orderByArc(items, 'build', 7));
  });

  it('is a permutation of the input ids', () => {
    const order = orderByArc(items, 'warmup');
    expect([...order].sort()).toEqual(items.map((i) => i.id).sort());
  });
});

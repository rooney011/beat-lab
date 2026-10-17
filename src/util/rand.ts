/** FNV-1a 32-bit hash. Used to give every song a stable seed. */
export function hash(input: string): number {
  let h = 2166136261;
  const s = String(input ?? '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Mulberry32 PRNG. Same seed, same sequence: per-song looks are reproducible. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** n uniform random numbers in [0, 1). */
export const randomList = (n: number): number[] => Array.from({ length: n }, () => Math.random());

/** Pick a random element. */
export const pick = <T>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)];

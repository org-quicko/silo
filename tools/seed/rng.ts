/**
 * A seeded PRNG (mulberry32), so a run is reproducible. `Math.random` would
 * make every run a different corpus, and "it only fails on some data" is not a
 * bug report anyone can act on.
 */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = (seed >>> 0) || 0x9e3779b9;
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Inclusive on both ends. */
  int(min: number, max: number): number {
    if (max <= min) return min;
    return min + Math.floor(this.next() * (max - min + 1));
  }

  decimal(min: number, max: number, places = 2): number {
    const factor = 10 ** places;
    return Math.round((min + this.next() * (max - min)) * factor) / factor;
  }

  chance(probability: number): boolean {
    return this.next() < probability;
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(0, items.length - 1)] as T;
  }

  /** `n` distinct members, in a shuffled order, capped at what exists. */
  sample<T>(items: readonly T[], n: number): T[] {
    const pool = [...items];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      [pool[i], pool[j]] = [pool[j] as T, pool[i] as T];
    }
    return pool.slice(0, Math.max(0, Math.min(n, pool.length)));
  }
}

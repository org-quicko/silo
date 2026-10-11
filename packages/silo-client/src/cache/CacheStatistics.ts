/** A snapshot across this client's cache policies. Clear and explicit invalidation preserve counters. */
export class CacheStatistics {
  constructor(
    readonly hits: number,
    readonly misses: number,
    readonly evictions: number,
    readonly size: number,
  ) {}

  requests(): number {
    return this.hits + this.misses;
  }

  hitRate(): number {
    return this.requests() === 0 ? 0 : this.hits / this.requests();
  }
}

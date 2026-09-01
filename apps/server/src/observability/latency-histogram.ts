/** A bounded latency distribution with approximate percentiles. */
export class LatencyHistogram {
  static readonly Boundaries = [1, 5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000] as const;

  private readonly counts = new Array<number>(LatencyHistogram.Boundaries.length + 1).fill(0);
  private count = 0;
  private sum = 0;
  private max = 0;

  observe(raw: number): void {
    const value = Number.isFinite(raw) ? Math.max(0, raw) : 0;
    this.count++;
    this.sum += value;
    this.max = Math.max(this.max, value);

    const index = LatencyHistogram.Boundaries.findIndex((boundary) => value <= boundary);
    this.counts[index < 0 ? this.counts.length - 1 : index]++;
  }

  snapshot(): {
    avg_ms: number;
    p50_ms: number;
    p95_ms: number;
    p99_ms: number;
    max_ms: number;
    buckets: { le_ms: number | null; count: number }[];
  } {
    let cumulative = 0;
    const buckets = this.counts.map((count, index) => {
      cumulative += count;
      return {
        le_ms: index < LatencyHistogram.Boundaries.length
          ? LatencyHistogram.Boundaries[index]
          : null,
        count: cumulative,
      };
    });

    return {
      avg_ms: this.count === 0 ? 0 : this.sum / this.count,
      p50_ms: this.percentile(0.5),
      p95_ms: this.percentile(0.95),
      p99_ms: this.percentile(0.99),
      max_ms: this.max,
      buckets,
    };
  }

  /**
   * The upper bound of the bucket the percentile falls in, **clamped to the
   * slowest request actually observed**.
   *
   * Without the clamp a bucket boundary is reported as if it were a
   * measurement, and on a healthy instance almost every request lands in the
   * 1–5ms buckets: ten requests of 3ms each answered `p95 = 5` beside
   * `max = 3`, which the endpoints table prints side by side. A percentile
   * above the maximum is not a conservative estimate, it is an impossible one.
   */
  private percentile(fraction: number): number {
    if (this.count === 0) return 0;
    const target = Math.ceil(this.count * fraction);
    let cumulative = 0;
    for (let index = 0; index < this.counts.length; index++) {
      cumulative += this.counts[index];
      if (cumulative < target) continue;
      return index < LatencyHistogram.Boundaries.length
        ? Math.min(LatencyHistogram.Boundaries[index], this.max)
        : this.max;
    }
    return this.max;
  }
}

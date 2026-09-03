import { describe, expect, test } from "bun:test";
import { LatencyHistogram } from "../../src/observability/latency-histogram";

describe("the latency histogram", () => {
  test("never reports a percentile above the slowest request it saw", () => {
    const histogram = new LatencyHistogram();
    for (let index = 0; index < 10; index++) histogram.observe(3);

    const snapshot = histogram.snapshot();
    // 3ms falls in the "<=5ms" bucket, and the bucket's boundary is not a
    // measurement: reporting it unclamped put p95 above max in one table row.
    expect(snapshot.max_ms).toBe(3);
    expect(snapshot.p50_ms).toBe(3);
    expect(snapshot.p95_ms).toBe(3);
    expect(snapshot.p99_ms).toBe(3);
    expect(snapshot.avg_ms).toBe(3);
  });

  test("still reports the bucket boundary when the maximum is beyond it", () => {
    const histogram = new LatencyHistogram();
    histogram.observe(4);
    histogram.observe(80);

    const snapshot = histogram.snapshot();
    // The clamp binds only where the maximum is the tighter of the two: 4ms
    // still reads as its bucket's "<=5ms", because 80ms says nothing about it.
    expect(snapshot.p50_ms).toBe(5);
    expect(snapshot.p95_ms).toBe(80);
    expect(snapshot.max_ms).toBe(80);
  });

  test("counts a request slower than every boundary in the overflow bucket", () => {
    const histogram = new LatencyHistogram();
    histogram.observe(9_000);

    const snapshot = histogram.snapshot();
    expect(snapshot.p99_ms).toBe(9_000);
    expect(snapshot.max_ms).toBe(9_000);
    const overflow = snapshot.buckets[snapshot.buckets.length - 1]!;
    expect(overflow.le_ms).toBeNull();
    expect(overflow.count).toBe(1);
  });

  test("answers zero for every statistic before it has seen a request", () => {
    const snapshot = new LatencyHistogram().snapshot();
    expect(snapshot).toMatchObject({ avg_ms: 0, p50_ms: 0, p95_ms: 0, p99_ms: 0, max_ms: 0 });
    expect(snapshot.buckets.every((bucket) => bucket.count === 0)).toBe(true);
  });
});

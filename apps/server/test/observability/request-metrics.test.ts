import { describe, expect, test } from "bun:test";
import { RequestMetrics } from "../../src/observability/request-metrics";

describe("request metrics", () => {
  test("groups normalized routes and reports errors and latency", () => {
    let now = Date.parse("2026-09-01T10:30:00.000Z");
    const metrics = new RequestMetrics(() => now);
    metrics.record({ completedAt: now, method: "get", route: "/api/items/:id", status: 200, durationMs: 4, internal: false });
    metrics.record({ completedAt: now, method: "GET", route: "/api/items/:id", status: 503, durationMs: 80, internal: true });

    const snapshot = metrics.snapshot();
    expect(snapshot.total).toBe(2);
    expect(snapshot.errors).toBe(1);
    expect(snapshot.error_rate).toBe(0.5);
    expect(snapshot.internal).toBe(1);
    expect(snapshot.status.success).toBe(1);
    expect(snapshot.status.server_error).toBe(1);
    expect(snapshot.endpoints).toHaveLength(1);
    expect(snapshot.endpoints[0]).toMatchObject({
      method: "GET",
      route: "/api/items/:id",
      hits: 2,
      errors: 1,
      internal: 1,
    });
    // The 80ms request is the slowest seen, so p95 reports it rather than its
    // bucket's 100ms boundary — a percentile is never above the maximum.
    expect(snapshot.latency.p95_ms).toBe(80);
  });

  test("keeps a zero-filled rolling sixty-minute chart", () => {
    let now = Date.parse("2026-09-01T10:00:30.000Z");
    const metrics = new RequestMetrics(() => now);
    metrics.record({ completedAt: now, method: "GET", route: "/api/health", status: 200, durationMs: 2, internal: false });
    now += 2 * 60_000;

    const timeline = metrics.snapshot().timeline;
    expect(timeline).toHaveLength(3);
    expect(timeline.map((entry) => entry.requests)).toEqual([1, 0, 0]);

    now += 70 * 60_000;
    const rolled = metrics.snapshot().timeline;
    expect(rolled).toHaveLength(60);
    expect(rolled.every((entry) => entry.requests === 0)).toBe(true);
  });

  test("folds unexpected route cardinality into one bounded series", () => {
    let now = 1_700_000_000_000;
    const metrics = new RequestMetrics(() => now);
    for (let index = 0; index < RequestMetrics.MaxEndpoints + 12; index++) {
      metrics.record({ completedAt: now, method: "GET", route: `/api/generated/${index}`, status: 200, durationMs: 1, internal: false });
    }
    const snapshot = metrics.snapshot();
    expect(snapshot.endpoints.length).toBeLessThanOrEqual(RequestMetrics.TopEndpoints);
    expect(snapshot.total).toBe(RequestMetrics.MaxEndpoints + 12);
  });
});

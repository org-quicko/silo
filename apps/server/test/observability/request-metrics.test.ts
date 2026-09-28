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

  describe("named series (D99)", () => {
    const pattern = "/api/projects/:project/environments/:env/collections/:name";
    const named = (project: string, collection: string) => ({
      route: `/api/projects/${project}/environments/prod/collections/${collection}`,
      pattern,
      scope: { project, env: "prod", collection },
    });

    test("a caller that reaches the scope sees the names, and one that does not sees the pattern with every count", () => {
      const now = Date.parse("2026-09-01T10:30:00.000Z");
      const metrics = new RequestMetrics(() => now);
      metrics.record({ completedAt: now, method: "GET", ...named("acme", "posts"), status: 200, durationMs: 4, internal: false });
      metrics.record({ completedAt: now, method: "GET", ...named("beta", "pages"), status: 200, durationMs: 90, internal: false });
      metrics.record({ completedAt: now, method: "GET", route: pattern, status: 404, durationMs: 2, internal: false });

      const acmeOnly = metrics.snapshot(now, (scope) => scope.project === "acme").endpoints;
      expect(acmeOnly).toEqual(expect.arrayContaining([
        expect.objectContaining({ route: "/api/projects/acme/environments/prod/collections/posts", hits: 1 }),
        // beta's request joins the failed one under the pattern: two hits, one error, beta's latency kept.
        expect.objectContaining({ route: pattern, hits: 2, errors: 1, max_ms: 90 }),
      ]));
      expect(JSON.stringify(acmeOnly)).not.toContain("beta");

      // The default reveals nothing.
      const nobody = metrics.snapshot(now).endpoints;
      expect(nobody).toEqual([expect.objectContaining({ route: pattern, hits: 3, errors: 1 })]);
      // Folding never changed what is stored.
      expect(metrics.snapshot(now, () => true).endpoints).toHaveLength(3);
    });

    test("with the table full, a new named series is counted under its pattern, not <other>", () => {
      const now = 1_700_000_000_000;
      const metrics = new RequestMetrics(() => now);
      // The pattern's own series, then fillers up to the cap.
      metrics.record({ completedAt: now, method: "GET", route: pattern, status: 404, durationMs: 1, internal: false });
      for (let index = 1; index < RequestMetrics.MaxEndpoints; index++) {
        metrics.record({ completedAt: now, method: "GET", route: `/api/filler/${index}`, status: 200, durationMs: 1, internal: false });
      }
      metrics.record({ completedAt: now, method: "GET", ...named("acme", "late"), status: 200, durationMs: 1, internal: false });
      metrics.record({ completedAt: now, method: "GET", ...named("acme", "late"), status: 200, durationMs: 1, internal: false });

      const endpoints = metrics.snapshot(now, () => true).endpoints;
      expect(JSON.stringify(endpoints)).not.toContain("late");
      expect(JSON.stringify(endpoints)).not.toContain("<other>");
      expect(endpoints[0]).toMatchObject({ route: pattern, hits: 3 });
    });
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

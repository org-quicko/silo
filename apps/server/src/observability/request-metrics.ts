import { LatencyHistogram } from "./latency-histogram";

interface RequestObservation {
  completedAt: number;
  method: string;
  route: string;
  status: number;
  durationMs: number;
  internal: boolean;
}

interface EndpointMetric {
  method: string;
  route: string;
  hits: number;
  errors: number;
  internal: number;
  latency: LatencyHistogram;
}

interface MinuteMetric {
  requests: number;
  errors: number;
  duration: number;
}

/** Process-lifetime API counters plus a bounded sixty-minute chart window. */
export class RequestMetrics {
  static readonly MaxEndpoints = 256;
  static readonly TimelineMinutes = 60;
  static readonly TopEndpoints = 25;

  private readonly startedAt: number;
  private readonly now: () => number;
  private readonly latency = new LatencyHistogram();
  private readonly endpoints = new Map<string, EndpointMetric>();
  private readonly minutes = new Map<number, MinuteMetric>();
  private readonly status = {
    informational: 0,
    success: 0,
    redirect: 0,
    client_error: 0,
    server_error: 0,
  };
  private total = 0;
  private errors = 0;
  private internal = 0;

  constructor(now: () => number = Date.now) {
    this.now = now;
    this.startedAt = now();
  }

  record(observation: RequestObservation): void {
    const method = RequestMetrics.method(observation.method);
    const route = RequestMetrics.route(observation.route);
    const status = Number.isInteger(observation.status) ? observation.status : 500;
    const duration = Number.isFinite(observation.durationMs)
      ? Math.max(0, observation.durationMs)
      : 0;
    const error = status >= 400;

    this.total++;
    if (error) this.errors++;
    if (observation.internal) this.internal++;
    this.latency.observe(duration);
    this.incrementStatus(status);

    const endpoint = this.endpoint(method, route);
    endpoint.hits++;
    if (error) endpoint.errors++;
    if (observation.internal) endpoint.internal++;
    endpoint.latency.observe(duration);

    const minute = Math.floor(observation.completedAt / 60_000);
    const bucket = this.minutes.get(minute) ?? { requests: 0, errors: 0, duration: 0 };
    bucket.requests++;
    if (error) bucket.errors++;
    bucket.duration += duration;
    this.minutes.set(minute, bucket);
    this.prune(Math.floor(this.now() / 60_000));
  }

  snapshot(at = this.now()) {
    const latency = this.latency.snapshot();
    const currentMinute = Math.floor(at / 60_000);
    this.prune(currentMinute);

    const firstMinute = Math.max(
      Math.floor(this.startedAt / 60_000),
      currentMinute - RequestMetrics.TimelineMinutes + 1,
    );
    const timeline = [];
    for (let minute = firstMinute; minute <= currentMinute; minute++) {
      const bucket = this.minutes.get(minute) ?? { requests: 0, errors: 0, duration: 0 };
      timeline.push({
        at: new Date(minute * 60_000).toISOString(),
        requests: bucket.requests,
        errors: bucket.errors,
        avg_ms: bucket.requests === 0 ? 0 : bucket.duration / bucket.requests,
      });
    }

    const endpoints = [...this.endpoints.values()]
      .sort((left, right) => right.hits - left.hits || left.method.localeCompare(right.method) || left.route.localeCompare(right.route))
      .slice(0, RequestMetrics.TopEndpoints)
      .map((endpoint) => {
        const distribution = endpoint.latency.snapshot();
        return {
          method: endpoint.method,
          route: endpoint.route,
          hits: endpoint.hits,
          errors: endpoint.errors,
          error_rate: endpoint.hits === 0 ? 0 : endpoint.errors / endpoint.hits,
          internal: endpoint.internal,
          avg_ms: distribution.avg_ms,
          p95_ms: distribution.p95_ms,
          max_ms: distribution.max_ms,
        };
      });

    return {
      total: this.total,
      errors: this.errors,
      error_rate: this.total === 0 ? 0 : this.errors / this.total,
      internal: this.internal,
      status: { ...this.status },
      latency: {
        avg_ms: latency.avg_ms,
        p50_ms: latency.p50_ms,
        p95_ms: latency.p95_ms,
        p99_ms: latency.p99_ms,
        max_ms: latency.max_ms,
      },
      endpoints,
      timeline,
      latency_buckets: latency.buckets,
    };
  }

  since(): string {
    return new Date(this.startedAt).toISOString();
  }

  private endpoint(method: string, route: string): EndpointMetric {
    let key = `${method} ${route}`;
    if (!this.endpoints.has(key) && this.endpoints.size >= RequestMetrics.MaxEndpoints) {
      key = "* <other>";
      method = "*";
      route = "<other>";
    }
    let metric = this.endpoints.get(key);
    if (!metric) {
      metric = { method, route, hits: 0, errors: 0, internal: 0, latency: new LatencyHistogram() };
      this.endpoints.set(key, metric);
    }
    return metric;
  }

  private incrementStatus(status: number): void {
    if (status < 200) this.status.informational++;
    else if (status < 300) this.status.success++;
    else if (status < 400) this.status.redirect++;
    else if (status < 500) this.status.client_error++;
    else this.status.server_error++;
  }

  private prune(currentMinute: number): void {
    const earliest = currentMinute - RequestMetrics.TimelineMinutes + 1;
    for (const minute of this.minutes.keys()) {
      if (minute < earliest || minute > currentMinute) this.minutes.delete(minute);
    }
  }

  private static method(raw: string): string {
    const value = String(raw || "UNKNOWN").toUpperCase();
    return value.length <= 16 ? value : value.slice(0, 16);
  }

  private static route(raw: string): string {
    const value = String(raw || "/api/*");
    return value.length <= 256 ? value : `${value.slice(0, 253)}…`;
  }
}

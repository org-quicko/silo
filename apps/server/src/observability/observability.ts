import { RequestMetrics } from "./request-metrics";
import { StorageMetrics } from "./storage-metrics";

interface ObservabilityOptions {
  dataDirectory?: string;
  mediaDirectory?: string;
  storageDriver?: string;
  blobDriver?: string;
  now?: () => number;
}

/** Bounded process-local operating metrics; no content or identity enters it. */
export class Observability {
  private readonly now: () => number;
  private readonly requests: RequestMetrics;
  private readonly storage: StorageMetrics;

  constructor(options: ObservabilityOptions = {}) {
    this.now = options.now ?? Date.now;
    this.requests = new RequestMetrics(this.now);
    this.storage = new StorageMetrics(options);
  }

  record(observation: {
    completedAt: number;
    method: string;
    route: string;
    status: number;
    durationMs: number;
    internal: boolean;
  }): void {
    this.requests.record(observation);
  }

  snapshot() {
    const generatedAt = this.now();
    const memory = process.memoryUsage();
    const cpu = process.cpuUsage();
    return {
      generated_at: new Date(generatedAt).toISOString(),
      since: this.requests.since(),
      requests: this.requests.snapshot(generatedAt),
      process: {
        uptime_seconds: process.uptime(),
        rss_bytes: memory.rss,
        heap_used_bytes: memory.heapUsed,
        heap_total_bytes: memory.heapTotal,
        external_bytes: memory.external,
        cpu_user_seconds: cpu.user / 1_000_000,
        cpu_system_seconds: cpu.system / 1_000_000,
      },
      storage: this.storage.snapshot(),
    };
  }

  /** Exposed for deterministic tests and diagnostics; snapshots never wait on a scan. */
  async refreshStorage() {
    return await this.storage.refresh();
  }
}

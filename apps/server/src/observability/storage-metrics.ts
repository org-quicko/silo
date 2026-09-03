import fs from "fs/promises";
import path from "node:path";

interface DirectoryMetric {
  bytes: number;
  files: number;
  truncated: boolean;
}

interface FilesystemMetric {
  total_bytes: number;
  free_bytes: number;
  available_bytes: number;
}

interface StorageMetricsOptions {
  dataDirectory?: string;
  mediaDirectory?: string;
  storageDriver?: string;
  blobDriver?: string;
  now?: () => number;
}

/** Cached, path-free local storage measurements. */
export class StorageMetrics {
  static readonly CacheMs = 30_000;
  static readonly MaxEntries = 50_000;

  private readonly options: StorageMetricsOptions;
  private readonly now: () => number;
  private cached: ReturnType<StorageMetrics["empty"]> | null = null;
  private pending: Promise<ReturnType<StorageMetrics["empty"]>> | null = null;

  constructor(options: StorageMetricsOptions = {}) {
    this.options = options;
    this.now = options.now ?? Date.now;
  }

  snapshot() {
    const configured = Boolean(this.options.dataDirectory || this.options.mediaDirectory);
    if (!configured) return StorageMetrics.public(this.empty());
    const stale = !this.cached || this.now() - this.cached.sampled_at_ms >= StorageMetrics.CacheMs;
    // Fire-and-forget, so a snapshot never waits on a scan — and caught here
    // rather than left to the process, since the only caller of this branch has
    // nowhere to put a rejection. A failed sample simply leaves `cached` as it
    // was, and the next snapshot tries again.
    if (stale && !this.pending) void this.refresh().catch(() => undefined);
    if (this.cached) return StorageMetrics.public(this.cached);
    return StorageMetrics.public({
      ...this.empty(),
      state: this.pending ? "sampling" : "unavailable",
    });
  }

  async refresh() {
    if (this.pending) return StorageMetrics.public(await this.pending);
    this.pending = this.sample();
    try {
      this.cached = await this.pending;
      return StorageMetrics.public(this.cached);
    } finally {
      this.pending = null;
    }
  }

  private async sample() {
    const dataRoot = this.options.dataDirectory ? path.resolve(this.options.dataDirectory) : null;
    const mediaRoot = this.options.mediaDirectory ? path.resolve(this.options.mediaDirectory) : null;
    // The media library lives *under* the data directory unless an operator
    // pinned it elsewhere, so the two probes overlap by default. See `contains`.
    const nested = dataRoot !== null && mediaRoot !== null && StorageMetrics.contains(dataRoot, mediaRoot);

    const [dataDirectory, mediaDirectory, filesystem] = await Promise.all([
      dataRoot ? StorageMetrics.directory(dataRoot, nested ? mediaRoot : null) : null,
      mediaRoot ? StorageMetrics.directory(mediaRoot) : null,
      dataRoot ? StorageMetrics.filesystem(dataRoot) : null,
    ]);
    const expected = Number(Boolean(this.options.dataDirectory)) + Number(Boolean(this.options.mediaDirectory));
    const available = Number(dataDirectory !== null) + Number(mediaDirectory !== null);
    const state = expected === 0 || available === 0 ? "unavailable" : available < expected ? "partial" : "ready";
    return {
      ...this.empty(),
      state,
      sampled_at: new Date(this.now()).toISOString(),
      sampled_at_ms: this.now(),
      data_directory: dataDirectory,
      media_directory: mediaDirectory,
      filesystem,
    };
  }

  private empty() {
    return {
      state: "unavailable",
      sampled_at: null as string | null,
      sampled_at_ms: 0,
      storage_driver: this.options.storageDriver ?? "unknown",
      blob_driver: this.options.blobDriver ?? "unknown",
      data_directory: null as DirectoryMetric | null,
      media_directory: null as DirectoryMetric | null,
      filesystem: null as FilesystemMetric | null,
    };
  }

  private static public(value: ReturnType<StorageMetrics["empty"]>) {
    const { sampled_at_ms: _sampledAtMs, ...answer } = value;
    return answer;
  }

  /**
   * Bytes and files under `root`, with `excluded` — when given — left out of
   * the walk entirely rather than subtracted afterwards.
   *
   * Skipping the subtree keeps `files` and `truncated` honest too, which a
   * subtraction of `bytes` alone could not: the entry budget is not spent
   * twice on the same files, so a large media library no longer pushes the
   * data scan into its own cap.
   */
  private static async directory(
    root: string,
    excluded: string | null = null,
  ): Promise<DirectoryMetric | null> {
    const metric: DirectoryMetric = { bytes: 0, files: 0, truncated: false };
    const stack = [root];
    let visited = 0;
    try {
      while (stack.length > 0) {
        const current = stack.pop()!;
        const entries = await fs.readdir(current, { withFileTypes: true });
        for (const entry of entries) {
          visited++;
          if (visited > StorageMetrics.MaxEntries) {
            metric.truncated = true;
            return metric;
          }
          const child = path.join(current, entry.name);
          if (entry.isDirectory()) {
            if (child !== excluded) stack.push(child);
          } else if (entry.isFile()) {
            const stat = await fs.stat(child);
            metric.bytes += stat.size;
            metric.files++;
          }
          // Symlinks and special files are deliberately not followed: a data
          // directory must not turn this bounded probe into a scan of its host.
        }
      }
      return metric;
    } catch {
      return null;
    }
  }

  /**
   * Whether `child` is a strict descendant of `parent`, both already resolved.
   *
   * `[blob_storage] path` defaults to `<storage.path>/media`, so on an ordinary
   * install every media byte sits inside the data directory. Reported as two
   * peer figures they read as two disjoint totals — a 40 GiB library showed as
   * "data 42 GiB" beside "media 40 GiB", and the obvious sum was nearly double
   * the real footprint. The data figure therefore excludes the media subtree,
   * which is what the panel's two cards already imply.
   *
   * Strict: an operator who pointed both at the *same* directory has not nested
   * anything, and excluding it there would report the data directory as empty.
   */
  private static contains(parent: string, child: string): boolean {
    return child !== parent && child.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep);
  }

  private static async filesystem(root: string): Promise<FilesystemMetric | null> {
    try {
      const stat = await fs.statfs(root);
      return {
        total_bytes: Number(stat.blocks) * Number(stat.bsize),
        free_bytes: Number(stat.bfree) * Number(stat.bsize),
        available_bytes: Number(stat.bavail) * Number(stat.bsize),
      };
    } catch {
      return null;
    }
  }
}

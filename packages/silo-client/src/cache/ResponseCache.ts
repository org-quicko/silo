import { TTLCache } from "@isaacs/ttlcache";
import type { TransportQueryValue } from "../transport/transport-request.js";
import { CacheKey } from "./CacheKey.js";
import type { CacheOptions } from "./CacheOptions.js";
import type { CachePolicy } from "./CachePolicy.js";
import { CacheStatistics } from "./CacheStatistics.js";

/** Decoded JSON held by one transport, with a separate cache per resolved TTL and capacity. */
export class ResponseCache {
  private readonly options: CacheOptions;
  private readonly caches = new Map<string, TTLCache<string, unknown>>();
  private hits = 0;
  private misses = 0;
  private evictions = 0;

  constructor(options?: CacheOptions) {
    this.options = options ?? { enabled: false };
  }

  isEnabled(): boolean {
    return this.options.enabled;
  }

  async get<T>(
    declared: CachePolicy,
    method: string,
    path: string,
    query: Record<string, TransportQueryValue> | undefined,
    load: () => Promise<T>,
  ): Promise<T> {
    if (!this.isEnabled()) return load();
    const cache = this.held(declared);
    const key = CacheKey.of(method, path, query);
    // Expiry through get() is reported as an explicit delete by TTLCache.
    cache.purgeStale();
    const stored = cache.get(key);
    // A key always names the same decoded response shape within this transport.
    if (stored !== undefined) {
      this.hits += 1;
      return structuredClone(stored) as T;
    }

    this.misses += 1;
    const fetched = await load();
    if (fetched !== undefined) cache.set(key, structuredClone(fetched));
    return fetched;
  }

  /** Drops entries and pages at or below the collection path, without matching sibling names. */
  invalidate(pathPrefix: string | undefined): void {
    if (pathPrefix === undefined) return;
    for (const cache of this.caches.values()) {
      for (const key of cache.keys()) {
        if (CacheKey.matches(key, pathPrefix)) cache.delete(key);
      }
    }
  }

  /** Removes stored responses. Pending reads can populate the cache after this call. */
  clear(): void {
    for (const cache of this.caches.values()) cache.clear();
  }

  statistics(): CacheStatistics {
    let size = 0;
    for (const cache of this.caches.values()) size += cache.size;
    return new CacheStatistics(this.hits, this.misses, this.evictions, size);
  }

  private held(declared: CachePolicy): TTLCache<string, unknown> {
    const ttl = declared.ttl ?? this.options.ttl;
    const maxSize = declared.maxSize ?? this.options.maxSize;
    if (ttl === undefined || maxSize === undefined) {
      throw new TypeError("Caching requires ttl and maxSize on @Cache() or SiloOptions.cache");
    }
    const policyKey = `${ttl}:${maxSize}`;
    let cache = this.caches.get(policyKey);
    if (!cache) {
      cache = new TTLCache({
        ttl,
        max: maxSize,
        dispose: (_value, _key, reason) => {
          if (reason === "stale" || reason === "evict") this.evictions += 1;
        },
      });
      this.caches.set(policyKey, cache);
    }
    return cache;
  }
}

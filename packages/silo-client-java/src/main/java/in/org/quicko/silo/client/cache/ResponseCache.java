package in.org.quicko.silo.client.cache;

import com.fasterxml.jackson.databind.JsonNode;
import com.github.benmanes.caffeine.cache.Caffeine;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Supplier;

/**
 * The responses one {@code Transport} is holding, as one Caffeine cache per
 * {@link CachePolicy} in force.
 *
 * <p>A write invalidates by path prefix and not by key, because the caller that
 * replaced one entry cannot name the pages that entry appeared on.
 *
 * <p>Held per transport, so {@code withKey} and {@code withUrl} start empty:
 * one key's reads are not another key's to serve.
 */
public final class ResponseCache {
  private final CacheOptions options;
  private final Map<CachePolicy, com.github.benmanes.caffeine.cache.Cache<CacheKey, JsonNode>>
      caches = new ConcurrentHashMap<>();

  public ResponseCache(CacheOptions options) {
    this.options = options == null ? CacheOptions.off() : options;
  }

  public boolean isEnabled() {
    return options.enabled();
  }

  /**
   * The stored response, or what {@code load} answers. A load that throws stores
   * nothing, so a failed read is never remembered.
   *
   * <p>Read then write, rather than Caffeine's loading {@code get}: that one
   * computes inside {@code ConcurrentHashMap.compute} and would hold a bin lock
   * across the request. The cost is that two concurrent misses both fetch.
   */
  public JsonNode get(
      CachePolicy declared,
      String method,
      String path,
      Map<String, Object> query,
      Supplier<JsonNode> load) {
    CachePolicy policy = options.inForce(declared);
    if (policy == null) return load.get();

    CacheKey key = CacheKey.of(method, path, query);
    com.github.benmanes.caffeine.cache.Cache<CacheKey, JsonNode> held = held(policy);
    JsonNode stored = held.getIfPresent(key);
    if (stored != null) return stored;

    JsonNode fetched = load.get();
    held.put(key, fetched);
    return fetched;
  }

  /** Drops every stored response addressed at, or below, this path. */
  public void invalidate(String pathPrefix) {
    if (pathPrefix == null) return;
    for (com.github.benmanes.caffeine.cache.Cache<CacheKey, JsonNode> cache : caches.values()) {
      cache.asMap().keySet().removeIf(stored -> stored.matches(pathPrefix));
    }
  }

  /** Drops everything — the escape hatch after a write this client did not make. */
  public void clear() {
    caches.values().forEach(com.github.benmanes.caffeine.cache.Cache::invalidateAll);
  }

  public CacheStatistics statistics() {
    CacheStatistics total = CacheStatistics.Empty;
    for (com.github.benmanes.caffeine.cache.Cache<CacheKey, JsonNode> cache : caches.values()) {
      com.github.benmanes.caffeine.cache.stats.CacheStats stats = cache.stats();
      total = total.plus(new CacheStatistics(
          stats.hitCount(), stats.missCount(), stats.evictionCount(), cache.estimatedSize()));
    }
    return total;
  }

  private com.github.benmanes.caffeine.cache.Cache<CacheKey, JsonNode> held(CachePolicy policy) {
    return caches.computeIfAbsent(policy, this::build);
  }

  private com.github.benmanes.caffeine.cache.Cache<CacheKey, JsonNode> build(CachePolicy policy) {
    Caffeine<Object, Object> builder = Caffeine.newBuilder()
        .expireAfterWrite(policy.ttl())
        .maximumSize(policy.maxSize())
        .recordStats();
    if (options.ticker() != null) builder.ticker(options.ticker());
    return builder.build();
  }
}

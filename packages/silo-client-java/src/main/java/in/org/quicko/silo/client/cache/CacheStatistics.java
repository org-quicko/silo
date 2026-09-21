package in.org.quicko.silo.client.cache;

/**
 * What the cache has done so far, summed over every cache it holds. A hit rate
 * near zero means the reads are not repeating inside their ttl.
 */
public record CacheStatistics(long hits, long misses, long evictions, long size) {
  public static final CacheStatistics Empty = new CacheStatistics(0, 0, 0, 0);

  public long requests() {
    return hits + misses;
  }

  public double hitRate() {
    return requests() == 0 ? 0 : (double) hits / requests();
  }

  CacheStatistics plus(CacheStatistics other) {
    return new CacheStatistics(
        hits + other.hits, misses + other.misses, evictions + other.evictions, size + other.size);
  }
}

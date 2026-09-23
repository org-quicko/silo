/// A snapshot across every store in one cache. Clearing keeps the counters.
final class CacheStatistics {
  const CacheStatistics(this.hits, this.misses, this.evictions, this.size);

  final int hits;
  final int misses;
  final int evictions;
  final int size;

  int get requests => hits + misses;

  double get hitRate => requests == 0 ? 0 : hits / requests;
}

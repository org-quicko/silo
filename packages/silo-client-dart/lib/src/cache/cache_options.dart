/// Whether entry reads are cached, and the ttl and bound a read does not state
/// itself. Off unless asked for: a cached read can carry a stale `rev`.
final class CacheOptions {
  const CacheOptions.on({this.ttl, this.maxSize}) : enabled = true;

  const CacheOptions.off() : enabled = false, ttl = null, maxSize = null;

  final bool enabled;
  final Duration? ttl;

  /// Responses held per ttl and bound before the oldest is evicted.
  final int? maxSize;
}

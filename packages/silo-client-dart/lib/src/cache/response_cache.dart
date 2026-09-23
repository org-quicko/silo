import 'package:clock/clock.dart';

import 'cache_key.dart';
import 'cache_options.dart';
import 'cache_policy.dart';
import 'cache_statistics.dart';

typedef _Stored = ({String body, DateTime storedAt});

/// The JSON one client holds, in one store per ttl and bound in force. A store
/// is insertion-ordered, so its oldest entry is both next to expire and next
/// to evict. Time comes from `package:clock`, so tests use `withClock`.
final class ResponseCache {
  ResponseCache(this._options);

  final CacheOptions _options;
  final Map<(Duration, int), Map<String, _Stored>> _stores = {};
  int _hits = 0;
  int _misses = 0;
  int _evictions = 0;

  bool get isEnabled => _options.enabled;

  CacheStatistics get statistics =>
      CacheStatistics(_hits, _misses, _evictions, _stores.values.fold(0, (size, store) => size + store.length));

  /// The stored body, or what [load] answers. A failed load stores nothing,
  /// and two concurrent misses both load.
  Future<String?> get(
    CachePolicy declared,
    String method,
    String path,
    Map<String, Object?> query,
    Future<String?> Function() load,
  ) async {
    if (!isEnabled) return load();

    final (ttl, maxSize) = _inForce(declared);
    final store = _stores.putIfAbsent((ttl, maxSize), () => {});
    _expire(store, ttl);

    final key = CacheKey.of(method, path, query);
    if (store[key] case final stored?) {
      _hits++;
      return stored.body;
    }

    _misses++;
    final fetched = await load();
    if (fetched != null) {
      store.remove(key);
      while (store.length >= maxSize) {
        store.remove(store.keys.first);
        _evictions++;
      }
      store[key] = (body: fetched, storedAt: clock.now());
    }
    return fetched;
  }

  /// Drops everything stored at or below [pathPrefix].
  void invalidate(String? pathPrefix) {
    if (pathPrefix == null) return;
    for (final store in _stores.values) {
      store.removeWhere((key, _) => CacheKey.matches(key, pathPrefix));
    }
  }

  /// The escape hatch after a write this client did not make.
  void clear() {
    for (final store in _stores.values) {
      store.clear();
    }
  }

  (Duration, int) _inForce(CachePolicy declared) {
    final ttl = declared.ttl ?? _options.ttl;
    final maxSize = declared.maxSize ?? _options.maxSize;
    if (ttl == null || maxSize == null) {
      throw StateError('a cached read needs a ttl and a maxSize, on its CachePolicy or on CacheOptions');
    }
    if (ttl <= Duration.zero || maxSize <= 0) {
      throw ArgumentError('a cache ttl and maxSize have to be positive');
    }
    return (ttl, maxSize);
  }

  void _expire(Map<String, _Stored> store, Duration ttl) {
    final now = clock.now();
    while (store.isNotEmpty && now.difference(store.values.first.storedAt) >= ttl) {
      store.remove(store.keys.first);
      _evictions++;
    }
  }
}

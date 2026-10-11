import '../transport/query_string.dart';

/// A response's key: the method, the path and every query parameter, sorted.
abstract final class CacheKey {
  static String of(String method, String path, Map<String, Object?> query) {
    final sorted = {for (final name in query.keys.toList()..sort()) name: query[name]};
    return '$method $path${QueryString.build(sorted)}';
  }

  /// Whether a write to [pathPrefix] makes [key] stale, without matching a
  /// sibling such as `posts-archive`.
  static bool matches(String key, String pathPrefix) {
    final target = key.substring(key.indexOf(' ') + 1);
    return target == pathPrefix || target.startsWith('$pathPrefix/') || target.startsWith('$pathPrefix?');
  }
}

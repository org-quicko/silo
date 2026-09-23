import '../cache/cache_policy.dart';
import '../request_options.dart';

/// One request through `Transport`. [cachePolicy] marks a cacheable read;
/// [evicts] is the path prefix a successful write makes stale.
final class TransportRequest {
  const TransportRequest(
    this.method,
    this.path, {
    this.query = const {},
    this.body,
    this.options = const RequestOptions(),
    this.cachePolicy,
    this.evicts,
  });

  final String method;
  final String path;
  final Map<String, Object?> query;
  final Object? body;
  final RequestOptions options;
  final CachePolicy? cachePolicy;
  final String? evicts;
}

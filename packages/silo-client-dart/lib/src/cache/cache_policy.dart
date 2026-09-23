/// A read's own ttl and bound. A null one comes from `CacheOptions`.
///
/// Dart cannot read annotations at runtime on AOT or the web, so a read passes
/// its policy to the request instead of declaring `@Cache`.
final class CachePolicy {
  const CachePolicy({this.ttl, this.maxSize});

  final Duration? ttl;
  final int? maxSize;
}

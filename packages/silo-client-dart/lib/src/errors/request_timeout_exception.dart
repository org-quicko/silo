/// The deadline passed before an answer came back.
final class RequestTimeoutException implements Exception {
  const RequestTimeoutException(this.method, this.path, this.timeout);

  final String method;
  final String path;
  final Duration timeout;

  @override
  String toString() => 'RequestTimeoutException: $method $path timed out after ${timeout.inMilliseconds}ms';
}

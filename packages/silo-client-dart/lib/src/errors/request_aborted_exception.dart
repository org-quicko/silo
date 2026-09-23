/// The caller's `CancellationSignal` fired.
final class RequestAbortedException implements Exception {
  const RequestAbortedException(this.method, this.path);

  final String method;
  final String path;

  @override
  String toString() => 'RequestAbortedException: $method $path was aborted by the caller';
}

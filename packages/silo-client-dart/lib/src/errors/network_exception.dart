/// The request never reached the server. Not a `SiloException`: nothing
/// answered, so a write may still have landed. Reconcile before retrying.
final class NetworkException implements Exception {
  const NetworkException(this.method, this.path, this.cause);

  final String method;
  final String path;
  final Object cause;

  @override
  String toString() =>
      'NetworkException: network error on $method $path: the request never reached the server ($cause)';
}

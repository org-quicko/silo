/// Something silo answered and refused. [status] and [code] are the wire's.
class SiloException implements Exception {
  const SiloException(this.status, this.code, this.message, this.method, this.path);

  final int status;
  final String code;
  final String message;
  final String method;
  final String path;

  @override
  String toString() => '$runtimeType: $message ($method $path, $status $code)';
}

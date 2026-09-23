/// A `2xx` whose body is not the JSON its route promises.
final class InvalidResponseException implements Exception {
  const InvalidResponseException(this.method, this.path, this.contentType);

  final String method;
  final String path;
  final String contentType;

  @override
  String toString() => 'InvalidResponseException: $method $path answered with content-type "$contentType", not JSON';
}

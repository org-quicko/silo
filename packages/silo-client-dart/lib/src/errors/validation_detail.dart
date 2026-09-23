/// One rejected field: a JSON Pointer and the validator's message.
final class ValidationDetail {
  const ValidationDetail(this.path, this.message);

  final String path;
  final String message;
}

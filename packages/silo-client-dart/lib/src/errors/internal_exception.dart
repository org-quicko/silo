import 'silo_exception.dart';

/// A `500` with no more specific code.
final class InternalException extends SiloException {
  const InternalException(String message, String method, String path) : super(500, 'internal', message, method, path);
}

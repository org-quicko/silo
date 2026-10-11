import 'silo_exception.dart';

/// A `404`.
final class NotFoundException extends SiloException {
  const NotFoundException(String message, String method, String path) : super(404, 'not_found', message, method, path);
}

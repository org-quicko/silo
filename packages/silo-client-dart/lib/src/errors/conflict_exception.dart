import 'silo_exception.dart';

/// A `409`, usually a stale revision.
class ConflictException extends SiloException {
  const ConflictException(String message, String method, String path, [String code = 'conflict'])
    : super(409, code, message, method, path);
}

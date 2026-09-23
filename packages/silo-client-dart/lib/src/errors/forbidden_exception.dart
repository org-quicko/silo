import 'silo_exception.dart';

/// A `403`: the key lacks the claim this call needs.
final class ForbiddenException extends SiloException {
  const ForbiddenException(String message, String method, String path) : super(403, 'forbidden', message, method, path);
}

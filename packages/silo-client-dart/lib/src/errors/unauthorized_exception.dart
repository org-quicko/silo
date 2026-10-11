import 'silo_exception.dart';

/// A `401`: no key, or one the server does not recognise.
final class UnauthorizedException extends SiloException {
  const UnauthorizedException(String message, String method, String path)
    : super(401, 'unauthorized', message, method, path);
}

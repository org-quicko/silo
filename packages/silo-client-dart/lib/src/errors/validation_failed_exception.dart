import 'silo_exception.dart';
import 'validation_detail.dart';

/// A `400`, with one detail per rejected field.
final class ValidationFailedException extends SiloException {
  const ValidationFailedException(String message, String method, String path, this.details)
    : super(400, 'validation_failed', message, method, path);

  factory ValidationFailedException.fromWire(String message, String method, String path, Object? details) =>
      ValidationFailedException(message, method, path, [
        if (details is List)
          for (final detail in details)
            if (detail case {'path': final String pointer, 'message': final String text})
              ValidationDetail(pointer, text),
      ]);

  final List<ValidationDetail> details;
}

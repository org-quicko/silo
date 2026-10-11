import 'dart:convert';

import 'conflict_exception.dart';
import 'forbidden_exception.dart';
import 'internal_exception.dart';
import 'media_delete_stalled_exception.dart';
import 'media_in_use_exception.dart';
import 'not_found_exception.dart';
import 'silo_exception.dart';
import 'unauthorized_exception.dart';
import 'validation_failed_exception.dart';

/// Maps a non-2xx body to its exception: by the wire's `code`, then by status.
abstract final class ErrorFactory {
  static SiloException fromResponseBody(int status, String method, String path, String rawBody) {
    final error = _parse(rawBody);
    if (error == null) {
      final message = rawBody.trim().isNotEmpty ? rawBody : 'request failed with status $status';
      return _byStatus(status, message, method, path);
    }

    final message = error['message'] is String ? error['message'] as String : 'request failed with status $status';
    final details = error['details'];
    return switch (error['code']) {
      'validation_failed' => ValidationFailedException.fromWire(message, method, path, details),
      'unauthorized' => UnauthorizedException(message, method, path),
      'forbidden' => ForbiddenException(message, method, path),
      'not_found' => NotFoundException(message, method, path),
      'conflict' => ConflictException(message, method, path),
      'media_in_use' => MediaInUseException.fromWire(message, method, path, details),
      'media_delete_stalled' => MediaDeleteStalledException.fromWire(message, method, path, details),
      'internal' => InternalException(message, method, path),
      _ => _byStatus(status, message, method, path),
    };
  }

  static SiloException _byStatus(int status, String message, String method, String path) => switch (status) {
    400 => ValidationFailedException(message, method, path, const []),
    401 => UnauthorizedException(message, method, path),
    403 => ForbiddenException(message, method, path),
    404 => NotFoundException(message, method, path),
    409 => ConflictException(message, method, path),
    _ => SiloException(status, 'unknown', message, method, path),
  };

  static Map<String, Object?>? _parse(String rawBody) {
    try {
      if (jsonDecode(rawBody) case {'error': final Map<String, Object?> error}) return error;
      return null;
    } on FormatException {
      return null;
    }
  }
}

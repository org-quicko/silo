import '../media/media_usage.dart';
import '../transport/json_values.dart';
import 'conflict_exception.dart';

/// A `409` refusing to delete an asset entries still reference.
final class MediaInUseException extends ConflictException {
  const MediaInUseException(
    String message,
    String method,
    String path, {
    required this.usageCount,
    required this.visibleCount,
    required this.visibleCapped,
    required this.referrers,
  }) : super(message, method, path, 'media_in_use');

  factory MediaInUseException.fromWire(String message, String method, String path, Object? details) {
    final object = details is Map<String, Object?> ? details : const <String, Object?>{};
    return MediaInUseException(
      message,
      method,
      path,
      usageCount: object['usage_count'] is int ? object['usage_count'] as int : 0,
      visibleCount: object['visible_count'] is int ? object['visible_count'] as int : 0,
      visibleCapped: object['visible_capped'] == true,
      referrers: JsonValues.objects(object['referrers']).map(MediaUsage.fromJson).toList(),
    );
  }

  final int usageCount;
  final int visibleCount;
  final bool visibleCapped;
  final List<MediaUsage> referrers;
}

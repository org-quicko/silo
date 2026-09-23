import '../transport/json_values.dart';
import 'media_usage.dart';

/// One id a bulk delete could not remove. The counts and [referrers] are set
/// only for `media_in_use`.
final class MediaDeleteFailure {
  const MediaDeleteFailure({
    required this.id,
    required this.code,
    required this.message,
    this.usageCount,
    this.visibleCount,
    this.visibleCapped,
    this.referrers,
  });

  factory MediaDeleteFailure.fromJson(Map<String, Object?> json) => MediaDeleteFailure(
    id: '${json['id']}',
    code: '${json['code']}',
    message: '${json['message']}',
    usageCount: json['usage_count'] as int?,
    visibleCount: json['visible_count'] as int?,
    visibleCapped: json['visible_capped'] as bool?,
    referrers: json['referrers'] is List
        ? JsonValues.objects(json['referrers']).map(MediaUsage.fromJson).toList()
        : null,
  );

  final String id;
  final String code;
  final String message;
  final int? usageCount;
  final int? visibleCount;
  final bool? visibleCapped;
  final List<MediaUsage>? referrers;
}

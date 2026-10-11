import '../transport/json_values.dart';
import 'media_delete_failure.dart';

/// Every id's outcome in a bulk delete. A partial success is a value, not a throw.
final class MediaDeleteReport {
  const MediaDeleteReport(this.deleted, this.failed);

  factory MediaDeleteReport.fromJson(Map<String, Object?> json) => MediaDeleteReport(
    JsonValues.strings(json['deleted']),
    JsonValues.objects(json['failed']).map(MediaDeleteFailure.fromJson).toList(),
  );

  final List<String> deleted;
  final List<MediaDeleteFailure> failed;
}

import '../transport/json_values.dart';

/// The records one receipt parked, untyped, as the server stores them: each
/// has a `kind` and the `record` it held.
final class TrashParkedRecords {
  const TrashParkedRecords(this.records, this.total);

  factory TrashParkedRecords.fromJson(Map<String, Object?> json) =>
      TrashParkedRecords(JsonValues.objects(json['items']), json['total'] as int? ?? 0);

  final List<Map<String, Object?>> records;
  final int total;
}

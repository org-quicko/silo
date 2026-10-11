import 'json_values.dart';

/// A list body. Entries and search use `data`; everything else uses `items`.
/// [limit] and [offset] are null when the route echoed no window.
final class PagePayload {
  factory PagePayload.read(Map<String, Object?> body) {
    final rows = JsonValues.objects(body['data'] ?? body['items']);
    return PagePayload._(
      rows,
      body['total'] is int ? body['total'] as int : rows.length,
      body['limit'] as int?,
      body['offset'] as int?,
    );
  }

  const PagePayload._(this.rows, this.total, this.limit, this.offset);

  final List<Map<String, Object?>> rows;
  final int total;
  final int? limit;
  final int? offset;
}

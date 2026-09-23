import '../transport/timestamps.dart';

/// A collection as the listing answers it, without its schema.
final class CollectionSummary {
  const CollectionSummary({
    required this.id,
    required this.name,
    required this.entries,
    required this.requiresAuth,
    required this.createdAt,
    required this.updatedAt,
  });

  factory CollectionSummary.fromJson(Map<String, Object?> json) => CollectionSummary(
    id: json['id'] as String,
    name: json['name'] as String,
    entries: json['entries'] as int,
    requiresAuth: json['requires_auth'] as bool,
    createdAt: Timestamps.parse(json['created_at']),
    updatedAt: Timestamps.parse(json['updated_at']),
  );

  final String id;
  final String name;
  final int entries;
  final bool requiresAuth;
  final DateTime createdAt;
  final DateTime updatedAt;
}

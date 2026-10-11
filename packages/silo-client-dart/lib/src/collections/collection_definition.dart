import 'json_schema.dart';

/// A collection with its schema, `silo://` refs already resolved.
final class CollectionDefinition {
  const CollectionDefinition(this.id, this.name, this.schema);

  factory CollectionDefinition.fromJson(Map<String, Object?> json) =>
      CollectionDefinition(json['id'] as String, json['name'] as String, json['schema'] as JsonSchema);

  final String id;
  final String name;
  final JsonSchema schema;
}

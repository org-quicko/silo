/// Who deleted it. silo authenticates keys, so "who" is a key.
final class TrashActor {
  const TrashActor(this.kind, {this.id, this.label});

  factory TrashActor.fromJson(Map<String, Object?> json) =>
      TrashActor(json['kind'] as String, id: json['id'] as String?, label: json['label'] as String?);

  /// `key`, `cli` or `system`.
  final String kind;

  /// The key's id, for a `key` only.
  final String? id;

  /// The key's label when it made the delete.
  final String? label;
}

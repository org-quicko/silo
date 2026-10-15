import 'trash_kind.dart';

/// The container that has to come back first. [trashId] is set when that
/// container is itself in the trash, and null when it was purged.
final class TrashBlocker {
  const TrashBlocker(this.kind, this.name, this.trashId);

  factory TrashBlocker.fromJson(Map<String, Object?> json) =>
      TrashBlocker(TrashKind.of(json['kind']), json['name'] as String, json['trash_id'] as String?);

  final TrashKind kind;
  final String name;
  final String? trashId;
}

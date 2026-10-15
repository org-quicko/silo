import '../transport/json_values.dart';
import '../transport/timestamps.dart';
import 'trash_actor.dart';
import 'trash_blocker.dart';
import 'trash_contents.dart';
import 'trash_kind.dart';
import 'trash_origin.dart';
import 'trash_state.dart';

/// One explicitly deleted thing. A collection deleted with 300 entries is one
/// of these, not 301.
final class TrashRecord {
  const TrashRecord({
    required this.id,
    required this.kind,
    required this.origin,
    required this.subjectId,
    required this.subjectName,
    required this.deletedAt,
    required this.deletedBy,
    required this.expiresAt,
    required this.contents,
    required this.mediaRefs,
    required this.state,
    required this.restorable,
    this.blockedBy,
  });

  factory TrashRecord.fromJson(Map<String, Object?> json) => TrashRecord(
    id: json['id'] as String,
    kind: TrashKind.of(json['kind']),
    origin: TrashOrigin.fromJson(json['origin'] as Map<String, Object?>? ?? const {}),
    subjectId: json['subject_id'] as String,
    subjectName: json['subject_name'] as String,
    deletedAt: Timestamps.parse(json['deleted_at']),
    deletedBy: TrashActor.fromJson(json['deleted_by'] as Map<String, Object?>),
    expiresAt: json['expires_at'] == null ? null : Timestamps.parse(json['expires_at']),
    contents: TrashContents.fromJson(json['contents'] as Map<String, Object?>? ?? const {}),
    mediaRefs: JsonValues.strings(json['media_refs']),
    state: TrashState.of(json['state']),
    restorable: json['restorable'] == true,
    blockedBy: switch (json['blocked_by']) {
      final Map<String, Object?> blocker => TrashBlocker.fromJson(blocker),
      _ => null,
    },
  );

  final String id;
  final TrashKind kind;
  final TrashOrigin origin;
  final String subjectId;
  final String subjectName;
  final DateTime deletedAt;
  final TrashActor deletedBy;

  /// Null when the instance keeps trash with no time limit.
  final DateTime? expiresAt;
  final TrashContents contents;

  /// The media ids the parked content refers to.
  final List<String> mediaRefs;
  final TrashState state;

  /// False while [blockedBy] is set.
  final bool restorable;
  final TrashBlocker? blockedBy;
}

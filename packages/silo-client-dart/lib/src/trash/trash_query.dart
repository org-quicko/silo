import 'trash_kind.dart';

/// What `Trash.list` accepts. With nothing set, it is everything this key may
/// see, newest first. [project], [environment] and [collection] match names.
final class TrashQuery {
  const TrashQuery({
    this.kind,
    this.project,
    this.environment,
    this.collection,
    this.deletedAfter,
    this.deletedBefore,
    this.text,
    this.limit,
    this.offset,
  });

  final TrashKind? kind;
  final String? project;
  final String? environment;
  final String? collection;
  final DateTime? deletedAfter;
  final DateTime? deletedBefore;

  /// Case-insensitive substring of the subject's name.
  final String? text;
  final int? limit;
  final int? offset;

  /// Without the window, which each page adds.
  Map<String, Object?> toWire() => {
    'kind': ?kind?.wire,
    'project': ?project,
    'env': ?environment,
    'collection': ?collection,
    'deleted_after': ?deletedAfter?.toUtc().toIso8601String(),
    'deleted_before': ?deletedBefore?.toUtc().toIso8601String(),
    'q': ?text,
  };
}

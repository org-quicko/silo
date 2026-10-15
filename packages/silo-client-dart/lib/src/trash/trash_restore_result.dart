import '../transport/json_values.dart';

/// What a restore put back, and what it could not fix.
final class TrashRestoreResult {
  const TrashRestoreResult({
    required this.restored,
    required this.projects,
    required this.environments,
    required this.collections,
    required this.entries,
    required this.assets,
    required this.brokenMediaRefs,
    this.renamedTo,
  });

  factory TrashRestoreResult.fromJson(Map<String, Object?> json) => TrashRestoreResult(
    restored: JsonValues.strings(json['restored']),
    projects: json['projects'] as int? ?? 0,
    environments: json['environments'] as int? ?? 0,
    collections: json['collections'] as int? ?? 0,
    entries: json['entries'] as int? ?? 0,
    assets: json['assets'] as int? ?? 0,
    brokenMediaRefs: JsonValues.strings(json['broken_media_refs']),
    renamedTo: json['renamed_to'] as String?,
  );

  /// Receipt ids restored, containers first when a chain was asked for.
  final List<String> restored;
  final int projects;
  final int environments;
  final int collections;
  final int entries;
  final int assets;

  /// Media the content still refers to that the library no longer holds.
  final List<String> brokenMediaRefs;

  /// The name the subject came back under, when a collision forced a rename.
  final String? renamedTo;
}

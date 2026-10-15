/// Where the thing was. A restore anchors on the ids; the names can be stale.
final class TrashOrigin {
  const TrashOrigin({
    this.projectId,
    this.projectName,
    this.environmentId,
    this.environmentName,
    this.collectionId,
    this.collectionName,
    this.folder,
  });

  factory TrashOrigin.fromJson(Map<String, Object?> json) => TrashOrigin(
    projectId: json['project_id'] as String?,
    projectName: json['project_name'] as String?,
    environmentId: json['env_id'] as String?,
    environmentName: json['env_name'] as String?,
    collectionId: json['collection_id'] as String?,
    collectionName: json['collection_name'] as String?,
    folder: json['folder'] as String?,
  );

  final String? projectId;
  final String? projectName;
  final String? environmentId;
  final String? environmentName;
  final String? collectionId;
  final String? collectionName;

  /// Media only: the library path.
  final String? folder;
}

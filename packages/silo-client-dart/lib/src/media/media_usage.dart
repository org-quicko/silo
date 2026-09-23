/// One entry's reference to an asset.
final class MediaUsage {
  const MediaUsage(this.mediaId, this.project, this.environment, this.collection, this.entryId);

  /// Lenient, because it also reads the referrers inside an error body.
  factory MediaUsage.fromJson(Map<String, Object?> json) => MediaUsage(
    json['media_id'] as String? ?? '',
    json['project'] as String? ?? '',
    json['env'] as String? ?? '',
    json['collection'] as String? ?? '',
    json['entry_id'] as String? ?? '',
  );

  final String mediaId;
  final String project;
  final String environment;
  final String collection;
  final String entryId;
}

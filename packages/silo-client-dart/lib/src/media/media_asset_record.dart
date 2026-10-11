import '../transport/json_values.dart';
import '../transport/timestamps.dart';
import 'media_state.dart';

/// Everything an asset is, as a value.
final class MediaAssetRecord {
  const MediaAssetRecord({
    required this.id,
    required this.filename,
    required this.folder,
    required this.blobKey,
    required this.sizeInBytes,
    required this.contentType,
    required this.hash,
    required this.state,
    required this.tags,
    required this.url,
    required this.usageCount,
    required this.createdAt,
    required this.updatedAt,
  });

  factory MediaAssetRecord.fromJson(Map<String, Object?> json) => MediaAssetRecord(
    id: json['id'] as String,
    filename: json['filename'] as String,
    folder: json['folder'] as String,
    blobKey: json['blob_key'] as String,
    sizeInBytes: json['size'] as int,
    contentType: json['content_type'] as String,
    hash: json['hash'] as String,
    state: MediaState.of(json['state']),
    tags: JsonValues.strings(json['tags']),
    url: json['url'] as String,
    usageCount: json['usage_count'] as int? ?? 0,
    createdAt: Timestamps.parse(json['created_at']),
    updatedAt: Timestamps.parse(json['updated_at']),
  );

  final String id;
  final String filename;
  final String folder;
  final String blobKey;
  final int sizeInBytes;
  final String contentType;
  final String hash;
  final MediaState state;
  final List<String> tags;
  final String url;
  final int usageCount;
  final DateTime createdAt;
  final DateTime updatedAt;
}

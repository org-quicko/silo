/// What `Media.list` accepts.
final class MediaQuery {
  const MediaQuery({
    this.text,
    this.folder,
    this.recursive,
    this.type,
    this.extension,
    this.tag,
    this.modifiedAfter,
    this.modifiedBefore,
    this.limit,
    this.offset,
    this.sort,
  });

  /// Substring of the filename.
  final String? text;
  final String? folder;
  final bool? recursive;

  /// Substring of the content type, such as `image/`.
  final String? type;

  /// No dot.
  final String? extension;
  final String? tag;
  final DateTime? modifiedAfter;
  final DateTime? modifiedBefore;
  final int? limit;
  final int? offset;

  /// `-created_at` (default), `created_at`, `filename`, `-filename`, `size`, `-size`.
  final String? sort;

  /// Without the window, which each page adds.
  Map<String, Object?> toWire() => {
    'q': ?text,
    'folder': ?folder,
    'recursive': ?recursive,
    'type': ?type,
    'ext': ?extension,
    'tag': ?tag,
    'modified_after': ?modifiedAfter?.toUtc().toIso8601String(),
    'modified_before': ?modifiedBefore?.toUtc().toIso8601String(),
    'sort': ?sort,
  };
}

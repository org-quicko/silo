/// What rode along, counted at delete time.
final class TrashContents {
  const TrashContents(this.collections, this.entries, this.assets, this.bytes);

  factory TrashContents.fromJson(Map<String, Object?> json) => TrashContents(
    json['collections'] as int? ?? 0,
    json['entries'] as int? ?? 0,
    json['assets'] as int? ?? 0,
    json['bytes'] as int? ?? 0,
  );

  final int collections;
  final int entries;
  final int assets;
  final int bytes;
}

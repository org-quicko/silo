/// One entry: silo's envelope beside your [fields]. A plain value with no
/// transport, so it logs as its own contents. Writes go through the collection.
final class Entry<F> {
  const Entry({
    required this.id,
    required this.rev,
    required this.createdAt,
    required this.updatedAt,
    required this.fields,
  });

  final String id;

  /// What `replace` and `delete` need back.
  final int rev;
  final DateTime createdAt;
  final DateTime updatedAt;
  final F fields;

  @override
  String toString() => 'Entry(id: $id, rev: $rev, createdAt: $createdAt, updatedAt: $updatedAt, fields: $fields)';
}

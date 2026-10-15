/// What a trash receipt stands for (D113).
enum TrashKind {
  project('project'),
  environment('environment'),
  collection('collection'),
  entry('entry'),
  media('media'),
  mediaFolder('media_folder');

  const TrashKind(this.wire);

  final String wire;

  /// Strict: a kind this client does not know is a client change.
  static TrashKind of(Object? value) =>
      values.firstWhere((kind) => kind.wire == value, orElse: () => throw FormatException('unknown trash kind', value));
}

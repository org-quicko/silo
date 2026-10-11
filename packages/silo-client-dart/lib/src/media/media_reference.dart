/// The `silo://media/<id>` an entry field holds. Only the scheme form is
/// recognised, so a stored `asset.url` is never mistaken for one.
abstract final class MediaReference {
  static const _scheme = 'silo://media/';

  static String of(String id) => '$_scheme$id';

  /// The id [value] names, ignoring any trailing path, query or fragment.
  static String? idOf(Object? value) {
    if (value is! String || !value.startsWith(_scheme)) return null;
    final id = value.substring(_scheme.length).split(RegExp('[#?/]')).first;
    return id.isEmpty ? null : id;
  }
}

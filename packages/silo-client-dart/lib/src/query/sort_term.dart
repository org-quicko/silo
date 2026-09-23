import 'sort_direction.dart';

/// One sort key, represented as the `sort` parameter's own string, so a raw
/// [String] is accepted wherever a term is.
extension type const SortTerm._(String _wire) implements String {
  SortTerm(String path) : this._(path);

  SortDirection get direction => _wire.startsWith('-') ? SortDirection.descending : SortDirection.ascending;

  String get path => direction == SortDirection.descending ? _wire.substring(1) : _wire;

  SortTerm ascending() => SortTerm._(path);

  SortTerm descending() => SortTerm._('-$path');
}

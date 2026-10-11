import 'field_path.dart';
import 'sort_term.dart';

/// Builds sorts. No `each`: a sort path selects at most one node.
abstract final class Sort {
  static SortTerm by(String name) => SortTerm(FieldPath.field(name));

  static SortTerm meta(String name) => SortTerm(FieldPath.meta(name));

  /// `updated_at`, newest first.
  static SortTerm recentlyUpdated() => meta('updated_at').descending();

  static SortTerm recentlyCreated() => meta('created_at').descending();

  static String of(Iterable<SortTerm> terms) => terms.join(',');
}

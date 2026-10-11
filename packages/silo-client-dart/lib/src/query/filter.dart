import 'field_path.dart';
import 'filter_expression.dart';
import 'filter_field.dart';
import 'filter_node.dart';

/// Builds filters. `each('tags').notEquals('x')` is "some tag is not x";
/// `not(each('tags').equals('x'))` is "no tag is". A misspelled field
/// matches nothing rather than failing to compile.
abstract final class Filter {
  static FilterField field(String name) => FilterField(FieldPath.field(name));

  /// Writes the `[*]` wildcard.
  static FilterField each(String name) => FilterField(FieldPath.each(name));

  /// Addresses the envelope, not your data.
  static FilterField meta(String name) => FilterField(FieldPath.meta(name));

  static FilterExpression and(FilterExpression left, FilterExpression right) => left.and(right);

  static FilterExpression or(FilterExpression left, FilterExpression right) => left.or(right);

  static FilterExpression not(FilterExpression expression) => expression.not();

  static FilterExpression raw(FilterNode node) => FilterExpression(node);
}

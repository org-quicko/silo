import 'filter_node.dart';
import 'filter_operator.dart';

/// A built filter. Combining answers a new expression and never mutates this one.
final class FilterExpression {
  const FilterExpression(this.node);

  final FilterNode node;

  FilterExpression and(FilterExpression other) =>
      FilterExpression(FilterNode(FilterOperator.and, args: [node, other.node]));

  FilterExpression or(FilterExpression other) =>
      FilterExpression(FilterNode(FilterOperator.or, args: [node, other.node]));

  FilterExpression not() => FilterExpression(FilterNode(FilterOperator.not, args: [node]));

  /// What `?filter=` sends.
  Map<String, Object?> toJson() => node.toJson();
}

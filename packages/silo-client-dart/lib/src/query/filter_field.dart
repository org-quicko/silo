import 'filter_expression.dart';
import 'filter_node.dart';
import 'filter_operator.dart';

/// One path awaiting an operator.
final class FilterField {
  const FilterField(this._path);

  final String _path;

  FilterExpression equals(Object? value) => _leaf(FilterOperator.equals, value);

  FilterExpression notEquals(Object? value) => _leaf(FilterOperator.notEquals, value);

  FilterExpression contains(Object? value) => _leaf(FilterOperator.contains, value);

  FilterExpression greaterThan(Object? value) => _leaf(FilterOperator.greaterThan, value);

  FilterExpression atLeast(Object? value) => _leaf(FilterOperator.atLeast, value);

  FilterExpression lessThan(Object? value) => _leaf(FilterOperator.lessThan, value);

  FilterExpression atMost(Object? value) => _leaf(FilterOperator.atMost, value);

  FilterExpression oneOf(List<Object?> values) => _leaf(FilterOperator.oneOf, values);

  FilterExpression exists() => FilterExpression(FilterNode(FilterOperator.exists, path: _path));

  FilterExpression _leaf(FilterOperator op, Object? value) =>
      FilterExpression(FilterNode(op, path: _path, value: value));
}

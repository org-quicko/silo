import 'filter_operator.dart';

/// One node of the filter AST: a leaf tests [path] against [value], a group
/// combines [args].
final class FilterNode {
  const FilterNode(this.op, {this.path, this.value, this.args = const []});

  final FilterOperator op;
  final String? path;
  final Object? value;
  final List<FilterNode> args;

  Map<String, Object?> toJson() => {
    'op': op.wire,
    'path': ?path,
    'value': ?value,
    if (args.isNotEmpty) 'args': [for (final argument in args) argument.toJson()],
  };
}

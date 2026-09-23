import '../query/filter_expression.dart';

/// Everything `list` accepts. [sort] takes a `SortTerm` or a raw string.
final class EntryListQuery {
  const EntryListQuery({this.where, this.sort, this.limit, this.offset});

  final FilterExpression? where;
  final String? sort;
  final int? limit;
  final int? offset;

  EntryListQuery copyWith({int? limit, int? offset}) =>
      EntryListQuery(where: where, sort: sort, limit: limit ?? this.limit, offset: offset ?? this.offset);
}

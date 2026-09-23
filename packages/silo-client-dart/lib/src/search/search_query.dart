import '../query/filter_expression.dart';

/// Everything a search accepts. [text] is the wire's `q`; without [sort],
/// results rank by relevance.
final class SearchQuery {
  const SearchQuery({this.text, this.where, this.sort, this.limit, this.offset});

  final String? text;
  final FilterExpression? where;
  final String? sort;
  final int? limit;
  final int? offset;

  SearchQuery copyWith({int? limit, int? offset}) =>
      SearchQuery(text: text, where: where, sort: sort, limit: limit ?? this.limit, offset: offset ?? this.offset);
}

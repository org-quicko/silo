/// The filter AST's operators: nine leaves and three groups.
enum FilterOperator {
  equals('eq'),
  notEquals('neq'),
  greaterThan('gt'),
  atLeast('gte'),
  lessThan('lt'),
  atMost('lte'),
  oneOf('in'),
  contains('contains'),
  exists('exists'),
  and('and'),
  or('or'),
  not('not');

  const FilterOperator(this.wire);

  final String wire;
}

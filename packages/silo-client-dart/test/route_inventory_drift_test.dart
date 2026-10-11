import 'dart:io';

import 'package:silo_client/silo_client.dart';
import 'package:test/test.dart';

/// Holds this client to the TypeScript one, whose inventory is checked against
/// the server's own routes. Skips when that package is not beside this one.
void main() {
  final inventory = File('../silo-client/src/transport/route-inventory.ts');
  final operators = File('../silo-client/src/query/filter-operator.ts');
  final skip = inventory.existsSync() ? false : 'the TypeScript client is not checked out beside this package';

  Set<String> quoted(String source, String opening, String closing) {
    final start = source.indexOf(opening) + opening.length;
    final body = source.substring(start, source.indexOf(closing, start));
    return {for (final match in RegExp('"([^"]+)"').allMatches(body)) match.group(1)!};
  }

  test('covers exactly what the TypeScript client covers', () {
    final source = inventory.readAsStringSync();
    expect(RouteInventory.covered.toSet(), quoted(source, 'Covered: readonly string[] = [', '];'));
  }, skip: skip);

  test('leaves out exactly what the TypeScript client leaves out', () {
    final source = inventory.readAsStringSync();
    final keys = quoted(
      source,
      'OutOfScope: Readonly<Record<string, string>> = {',
      '};',
    ).where((candidate) => RegExp(r'^(GET|POST|PUT|PATCH|DELETE|ALL) /').hasMatch(candidate));
    expect(RouteInventory.outOfScope.keys.toSet(), keys.toSet());
  }, skip: skip);

  test('offers the same filter operators', () {
    final source = operators.readAsStringSync();
    expect(FilterOperator.values.map((operator) => operator.wire).toSet(), quoted(source, 'Object.freeze([', ']'));
  }, skip: skip);
}

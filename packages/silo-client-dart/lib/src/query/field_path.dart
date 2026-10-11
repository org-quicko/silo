/// The JSONPath strings filters and sorts address.
abstract final class FieldPath {
  static String field(String name) => '\$.data.$name';

  static String each(String name) => '\$.data.$name[*]';

  static String meta(String name) => '\$.$name';
}

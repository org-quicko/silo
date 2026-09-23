/// Reads silo's ISO-8601 timestamps, with a `Z` or an explicit offset.
abstract final class Timestamps {
  static DateTime parse(Object? value) => DateTime.parse(value as String);
}

/// Reads the arrays a wire body carries.
abstract final class JsonValues {
  static List<Map<String, Object?>> objects(Object? value) =>
      value is List ? [for (final item in value) item as Map<String, Object?>] : const [];

  static List<String> strings(Object? value) => value is List ? [for (final item in value) item as String] : const [];
}

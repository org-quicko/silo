/// How a collection's fields become [F] and back.
final class FieldsConverter<F> {
  const FieldsConverter({required this.fromJson, required this.toJson});

  static const map = FieldsConverter<Map<String, Object?>>(fromJson: _same, toJson: _same);

  final F Function(Map<String, Object?> json) fromJson;
  final Map<String, Object?> Function(F fields) toJson;

  static Map<String, Object?> _same(Map<String, Object?> json) => json;
}

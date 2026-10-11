import '../transport/timestamps.dart';

/// One `{{NAME}}` as one environment sees it. [value] is null when this
/// environment has set nothing; `''` is a value.
final class Variable {
  const Variable({
    required this.name,
    required this.description,
    required this.value,
    required this.setIn,
    required this.createdAt,
    required this.updatedAt,
  });

  factory Variable.fromJson(Map<String, Object?> json) => Variable(
    name: json['name'] as String,
    description: json['description'] as String,
    value: json['value'] as String?,
    setIn: json['set_in'] as int,
    createdAt: Timestamps.parse(json['created_at']),
    updatedAt: Timestamps.parse(json['updated_at']),
  );

  final String name;
  final String description;
  final String? value;
  final int setIn;
  final DateTime createdAt;
  final DateTime updatedAt;
}

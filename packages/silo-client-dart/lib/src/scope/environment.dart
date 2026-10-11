/// An environment record. [id] never changes; [name] is what paths address.
final class Environment {
  const Environment(this.id, this.name);

  factory Environment.fromJson(Map<String, Object?> json) => Environment(json['id'] as String, json['name'] as String);

  final String id;
  final String name;
}

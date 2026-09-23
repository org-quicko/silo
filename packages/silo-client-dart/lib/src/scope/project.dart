/// A project record. [id] never changes; [name] is what paths address.
final class Project {
  const Project(this.id, this.name);

  factory Project.fromJson(Map<String, Object?> json) => Project(json['id'] as String, json['name'] as String);

  final String id;
  final String name;
}

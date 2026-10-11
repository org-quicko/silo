final class HealthReport {
  const HealthReport(this.status, this.version);

  factory HealthReport.fromJson(Map<String, Object?> json) =>
      HealthReport(json['status'] as String, json['version'] as String);

  final String status;
  final String version;
}

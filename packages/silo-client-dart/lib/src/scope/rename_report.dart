import '../transport/json_values.dart';

/// What a rename did or would do. Pass [id] as `expectedId` to turn a dry run
/// into the real call.
final class RenameReport {
  const RenameReport(this.id, this.from, this.to, this.rewrittenClaims, this.patternAffectedClaims);

  factory RenameReport.fromJson(Map<String, Object?> json) => RenameReport(
    json['id'] as String,
    json['from'] as String,
    json['to'] as String,
    JsonValues.strings(json['rewritten_claims']),
    JsonValues.strings(json['pattern_affected_claims']),
  );

  final String id;
  final String from;
  final String to;
  final List<String> rewrittenClaims;
  final List<String> patternAffectedClaims;
}

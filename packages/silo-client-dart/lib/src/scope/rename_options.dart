import '../request_options.dart';

/// [expectedId] binds the rename to the record a caller already read.
final class RenameOptions extends RequestOptions {
  const RenameOptions({this.expectedId, this.dryRun = false, super.timeout, super.cancellation});

  final String? expectedId;
  final bool dryRun;
}

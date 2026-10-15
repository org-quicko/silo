import '../request_options.dart';

/// [chain] restores the containers blocking the receipt first. [rename]
/// applies to the subject alone, for when its name was taken meanwhile.
final class TrashRestoreOptions extends RequestOptions {
  const TrashRestoreOptions({this.rename, this.chain = false, super.timeout, super.cancellation});

  final String? rename;
  final bool chain;
}
